import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createStaffAccess } from "../server/staff-access.js";
import { executeAdminCommand, ADMIN_COMMAND_HELP } from "../server/admin-commands.js";
import { addPlayer, createRoom, startMatch, updatePlayer } from "../server/game.js";
import { createCommandGuard } from "../server/anti-cheat.js";
import { staffLabel } from "../shared/staff.js";
import { TouchInput } from "../src/touch-controls.js";

function fixture(t, options) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "last-light-staff-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, staff: createStaffAccess(directory, options) };
}

test("each staff identity gets three unique six-digit one-use codes; only salted hashes persist", (t) => {
  const { directory, staff } = fixture(t);
  const first = crypto.randomUUID(), second = crypto.randomUUID();
  assert.equal(staff.setRole(first, "owner").ok, true);
  assert.equal(staff.setRole(second, "admin").ok, true);
  const one = staff.issue(first), two = staff.issue(second);
  assert.equal(one.codes.length, 3);
  assert.equal(new Set([...one.codes, ...two.codes]).size, 6);
  for (const code of [...one.codes, ...two.codes]) assert.match(code, /^[0-9]{6}$/);
  const content = fs.readFileSync(path.join(directory, "staff-access.json"), "utf8");
  for (const code of [...one.codes, ...two.codes]) assert.equal(content.includes(`"${code}"`), false);
  assert.equal(fs.statSync(path.join(directory, "staff-access.json")).mode & 0o777, 0o600);
  assert.equal(staff.verify(first, one.codes[0]).ok, true);
  assert.equal(staff.verify(first, one.codes[0]).ok, false);
  const restored = createStaffAccess(directory);
  assert.equal(restored.verify(first, one.codes[0]).ok, false);
  assert.equal(restored.verify(first, one.codes[1]).ok, true);
});

test("a code moves its role to a new Operator ID once and revokes the old identity", (t) => {
  let at = 1000;
  const { staff } = fixture(t, { now: () => at }), lost = crypto.randomUUID(), current = crypto.randomUUID();
  staff.setRole(lost, "owner");
  const { codes } = staff.issue(lost), revision = staff.revision(lost);
  assert.equal(staff.verify(current, codes[0]).ok, false);
  assert.equal(staff.role(current), null);
  const moved = staff.verify(current, codes[0], { allowMove: true });
  assert.deepEqual(moved, { ok: true, movedFrom: lost });
  assert.equal(staff.role(current), "owner");
  assert.equal(staff.role(lost), null);
  assert.notEqual(staff.revision(current), revision);
  assert.equal(staff.verify(current, codes[0]).ok, false);
  assert.deepEqual(staff.verify(current, codes[1]), { ok: true, movedFrom: null });
  assert.equal(staff.verify(lost, codes[2], { allowMove: true }).ok, true);
  assert.equal(staff.role(lost), "owner");
  assert.equal(staff.role(current), null);
  // Guessing across many fresh identities is capped globally.
  for (let index = 0; index < 30; index++) staff.verify(crypto.randomUUID(), "000000");
  assert.match(staff.verify(crypto.randomUUID(), "000001").error, /busy/);
  at += 60_000;
  assert.equal(staff.verify(crypto.randomUUID(), "000001").error, "Invalid or already used verification code.");
});

test("code rotation changes the session revision, invalidates old codes and protects the last owner", (t) => {
  const { staff } = fixture(t), owner = crypto.randomUUID();
  staff.setRole(owner, "owner");
  const old = staff.issue(owner), revision = staff.revision(owner);
  const next = staff.issue(owner);
  assert.notEqual(staff.revision(owner), revision);
  assert.equal(staff.verify(owner, old.codes[0]).ok, false);
  assert.equal(staff.verify(owner, next.codes[0]).ok, true);
  assert.equal(staff.setRole(owner, "none").ok, false);
  const replacement = crypto.randomUUID();
  staff.setRole(replacement, "owner");
  assert.equal(staff.setRole(owner, "none").ok, true);
  assert.equal(staff.role(owner), null);
  assert.equal(staff.issue("constructor").ok, false);
  assert.equal(staff.setRole(crypto.randomUUID(), "__proto__").ok, false);
  assert.equal(staffLabel("owner"), "Owner");
  assert.equal(staffLabel("__proto__"), "");
});

test("verification guessing is bounded per identity and storage failures do not consume a code", (t) => {
  let at = 1000;
  const { directory, staff } = fixture(t, { now: () => at }), id = crypto.randomUUID();
  staff.setRole(id, "owner");
  const { codes } = staff.issue(id);
  for (let index = 0; index < 5; index++) assert.equal(staff.verify(id, "wrong").ok, false);
  assert.match(staff.verify(id, codes[0]).error, /Too many/);
  at += 60_000;
  const temporary = path.join(directory, "staff-access.json.next");
  fs.mkdirSync(temporary);
  assert.throws(() => staff.verify(id, codes[0]));
  fs.rmdirSync(temporary);
  assert.equal(staff.verify(id, codes[0]).ok, true);
});

test("staff persistence refuses malformed state and concurrent offline edits instead of silently overwriting", (t) => {
  const { directory, staff } = fixture(t), id = crypto.randomUUID();
  staff.setRole(id, "owner");
  const other = createStaffAccess(directory);
  other.issue(id);
  assert.throws(() => staff.issue(id), /another process/);
  fs.writeFileSync(path.join(directory, "staff-access.json"), '{"version":1,"staff":[]}');
  assert.throws(() => createStaffAccess(directory), /Invalid staff/);
});

test("offline setup rejects unsupported roles before mutating existing staff access", (t) => {
  const { directory, staff } = fixture(t), id = crypto.randomUUID();
  staff.setRole(id, "admin");
  staff.issue(id);
  const filename = path.join(directory, "staff-access.json");
  const original = fs.readFileSync(filename, "utf8");
  for (const role of ["none", "__proto__", "not-a-role"]) {
    const result = spawnSync(process.execPath, ["scripts/setup-staff.mjs", "--player-id", id, "--role", role], {
      env: { ...process.env, DATA_DIR: directory },
      encoding: "utf8"
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Staff setup cannot remove roles/);
    assert.equal(result.stdout, "");
    assert.equal(fs.readFileSync(filename, "utf8"), original);
  }
});

test("a private seed restores provisioned staff on an empty ephemeral data directory", (t) => {
  const { directory } = fixture(t), id = crypto.randomUUID();
  const seedFile = path.join(directory, "seed.txt"), empty = path.join(directory, "empty");
  const result = spawnSync(process.execPath, ["scripts/setup-staff.mjs", "--player-id", id, "--role", "owner",
    "--seed-file", seedFile], { env: { ...process.env, DATA_DIR: path.join(directory, "untouched") }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(directory, "untouched")), false);
  assert.equal(fs.statSync(seedFile).mode & 0o777, 0o600);
  const codes = result.stdout.split("\n").filter((line) => /^[0-9]{6}$/.test(line));
  assert.equal(codes.length, 3);
  const seed = fs.readFileSync(seedFile, "utf8");
  for (const code of codes) assert.equal(seed.includes(code), false);
  const staff = createStaffAccess(empty, { seed });
  assert.equal(staff.role(id), "owner");
  assert.equal(staff.verify(id, codes[0]).ok, true);
  assert.equal(staff.verify(id, codes[0]).ok, false);
  // An existing data file wins over the seed until the host is reset.
  assert.equal(createStaffAccess(empty, { seed }).verify(id, codes[0]).ok, false);
  assert.throws(() => createStaffAccess(path.join(directory, "other"), { seed: "not-a-seed" }), /Invalid STAFF_ACCESS_SEED/);
  const again = spawnSync(process.execPath, ["scripts/setup-staff.mjs", "--player-id", id, "--role", "owner",
    "--seed-file", seedFile], { encoding: "utf8" });
  assert.equal(again.status, 1);
  assert.match(again.stderr, /already exists/);
});

test("the command panel lists every supported command, resolves quoted names, and never evaluates input", () => {
  let invoked;
  const profile = { id: crypto.randomUUID(), username: "Player Name" };
  const operations = {
    owner: true,
    resolve: (query) => { assert.equal(query, "Player Name"); return { ok: true, profile }; },
    fly: (target, setting) => { invoked = [target.id, setting]; return { ok: true }; },
    ban: () => ({ ok: true }), announce: (message) => ({ ok: true, message }),
    role: () => ({ ok: true }), codes: () => ({ ok: true })
  };
  assert.equal(executeAdminCommand("?help", operations).lines, ADMIN_COMMAND_HELP);
  assert.equal(ADMIN_COMMAND_HELP.filter((line) => line.startsWith("?")).length, 7);
  assert.equal(executeAdminCommand('?fly "Player Name" on', operations).ok, true);
  assert.deepEqual(invoked, [profile.id, "on"]);
  assert.equal(executeAdminCommand("?announcement <b>plain text only</b>", operations).message, "<b>plain text only</b>");
  for (const line of ["fly Player", "?eval anything", "?fly \"unterminated", "?announcement", "?help extra", "?fly x\n?ban y"]) {
    assert.equal(executeAdminCommand(line, operations).ok, false, line);
  }
  for (const line of ['?codes "Player Name"', '?role "Player Name" owner']) {
    assert.equal(executeAdminCommand(line, { ...operations, owner: false }).ok, false);
  }
  const guard = createCommandGuard();
  assert.equal(guard.check(["adminCommand", "?help"], false).ok, false);
  assert.equal(guard.check(["adminCommand", "?help"], true).ok, true);
  assert.equal(guard.check(["adminCommand", { command: "?fly", owner: true }], true).ok, false);
  assert.equal(guard.check(["createRoom", { mapId: "foundry", staffRole: "owner" }], false).ok, false);
});

test("only a server-granted flight flag permits rising above jump height, with collision/altitude limits retained", () => {
  const room = createRoom("FLIGHT", "foundry");
  const player = addPlayer(room, { id: "one" }, crypto.randomUUID(),
    { xp: 0, level: 1, ownedWeapons: ["rifle"], equippedWeaponId: "rifle" }, "Flyer");
  startMatch(room, 1000);
  const data = { position: { x: -3, y: 8, z: 10 }, yaw: 0, pitch: 0 };
  assert.equal(updatePlayer(room, "one", data, 2000), false);
  player.flying = true;
  assert.equal(updatePlayer(room, "one", data, 2000), true);
  assert.equal(updatePlayer(room, "one", { ...data, position: { x: -3, y: 9.6, z: 10 } }, 3000), false);
  player.flying = false;
  assert.equal(updatePlayer(room, "one", { ...data, position: { x: -3, y: 8.1, z: 10 } }, 3000), false);
  assert.equal(updatePlayer(room, "one", { ...data, position: { x: -3, y: 7, z: 10 } }, 3000), true);
  const guard = createCommandGuard();
  assert.equal(guard.check(["move", { ...data, flying: true }], false).ok, false);
});

test("phone flight actions remain held independently and clear on release or reset", () => {
  const input = new TouchInput();
  input.begin(1, "jump", { x: 0, y: 0 });
  input.begin(2, "descend", { x: 0, y: 0 });
  assert.equal(input.state.ascending, true);
  assert.equal(input.state.descending, true);
  input.end(1);
  assert.equal(input.state.ascending, false);
  assert.equal(input.state.descending, true);
  input.reset();
  assert.equal(input.state.descending, false);
});
