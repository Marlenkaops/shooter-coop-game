import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createAuditLog } from "../server/audit.js";
import { createCommandGuard } from "../server/anti-cheat.js";

test("audit log persists privately, redacts unapproved fields, aggregates and bounds retention", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "last-light-audit-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let time = 1000;
  const audit = createAuditLog(directory, { now: () => time, maxEntries: 3 });
  audit.record({ kind: "auth", action: "adminSignIn", password: "never-save-this", token: "never-save-token" });
  audit.record({ kind: "anti-cheat", action: "move", actorId: "one", reason: "speed" }, { aggregate: true });
  audit.record({ kind: "anti-cheat", action: "move", actorId: "one", reason: "speed" }, { aggregate: true });
  assert.equal(audit.read({ kind: "anti-cheat" }).entries[0].count, 2);
  time += 5001;
  audit.record({ kind: "admin", action: "setLevel", level: 7 }, { immediate: true });
  audit.record({ kind: "admin", action: "unlockAll", targetId: "one" }, { immediate: true });
  assert.equal(audit.read().entries.length, 3);
  const filename = path.join(directory, "audit.json");
  assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
  const saved = fs.readFileSync(filename, "utf8");
  assert.ok(!saved.includes("never-save"));
  const restored = createAuditLog(directory);
  const first = restored.read({ limit: 2 });
  assert.equal(first.entries.length, 2);
  assert.equal(restored.read({ before: first.nextBefore }).entries.length, 1);
  assert.throws(() => restored.read({ limit: 10000 }), /Invalid audit/);
  fs.writeFileSync(filename, JSON.stringify({ entries: [{ ...first.entries[0], password: "unsafe-field" }], nextId: 99 }));
  assert.throws(() => createAuditLog(directory), /Unable to load/);
  fs.writeFileSync(filename, JSON.stringify({ entries: [{ ...first.entries[0], count: -1 }], nextId: 99 }));
  assert.throws(() => createAuditLog(directory), /Unable to load/);
  fs.writeFileSync(filename, "{broken");
  assert.throws(() => createAuditLog(directory), /Unable to load/);
});

test("audit storage failure is visible and prevents success-shaped audit retrieval", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "last-light-audit-failure-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const audit = createAuditLog(directory);
  fs.mkdirSync(path.join(directory, "audit.json.next"));
  assert.throws(() => audit.record({ kind: "admin", action: "setLevel" }, { immediate: true }), /storage unavailable/);
  assert.throws(() => audit.read(), /storage unavailable/);
});

test("command guard rejects role spoofing, forged data, extra args and malformed commands", () => {
  const guard = createCommandGuard();
  assert.equal(guard.check(["adminSetProgression", { playerId: "self", operation: "unlockAll" }], false).reason, "permission_denied");
  assert.equal(guard.check(["move", { position: { x: 0, y: 1.7, z: 0 }, yaw: 0, pitch: 0 }], false).ok, true);
  assert.equal(guard.check(["shoot", { direction: { x: 0, y: 0, z: -1 }, damage: 999 }], false).reason, "invalid_payload");
  assert.equal(guard.check(["move", { position: { x: NaN, y: 1.7, z: 0 }, yaw: 0, pitch: 0 }], false).ok, false);
  assert.equal(guard.check(["startMatch", {}, () => {}], false).ok, false);
  assert.equal(guard.check(["joinRoom", null], false).ok, false);
  assert.equal(guard.check(["equipWeapon", "__proto__"], false).ok, false);
  assert.equal(guard.check(["unknown"], false).reason, "unknown_command");
  assert.equal(guard.check(["adminSetProgression", { playerId: "self", operation: "setLevel", level: Infinity }], true).ok, false);
  assert.equal(guard.check(["adminSetProgression", { playerId: "self", operation: "setLevel", level: 12 }], true).ok, true);
});

test("command budgets allow normal 20Hz movement but reject a flood without automatic bans", () => {
  let time = 1000;
  const guard = createCommandGuard({ now: () => time });
  const packet = ["move", { position: { x: 0, y: 1.7, z: 0 }, yaw: 0, pitch: 0 }];
  for (let index = 0; index < 200; index++) {
    assert.equal(guard.check(packet, false).ok, true);
    time += 50;
  }
  assert.ok(Array.from({ length: 150 }, () => guard.check(packet, false)).some((reply) => !reply.ok));
  time += 3000;
  assert.equal(guard.check(packet, false).ok, true);
});

test("leaderboard requests are read-only, strictly validated and separately rate limited", () => {
  for (const input of [null, [], { sort: "tokens" }, { offset: -1 }, { offset: 1.5 },
    { offset: Number.MAX_SAFE_INTEGER + 1 }, { score: 999 }, { playerId: "another" }, { admin: true }]) {
    assert.equal(createCommandGuard().check(["leaderboard", input], false).reason, "invalid_payload");
  }
  let time = 0;
  const guard = createCommandGuard({ now: () => time });
  const packet = ["leaderboard", { sort: "kills", offset: 20 }, () => {}];
  for (let index = 0; index < 6; index++) assert.equal(guard.check(packet, false).ok, true);
  assert.equal(guard.check(packet, false).reason, "command_rate");
  assert.equal(guard.check(["reload"], false).ok, true, "ranking requests do not consume gameplay budget");
  time += 1000;
  assert.equal(guard.check(packet, false).ok, true);
});

test("administrator progression grants persist independently of campaign victories and unknown profiles are not created", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "last-light-admin-profile-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const run = (code) => {
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
      cwd: path.resolve("."), env: { ...process.env, DATA_DIR: directory }, encoding: "utf8"
    });
    assert.equal(child.status, 0, child.stderr);
    return JSON.parse(child.stdout);
  };
  const result = run(`
    import { existingProfile, getProfile, adminSetProgression, searchProfiles, updateUsername, rewardPlayer } from "./server/store.js";
    getProfile("one"); updateUsername("one", "OfflineRanger");
    console.log(JSON.stringify({ missing: existingProfile("unknown"),
      search: searchProfiles("offlineranger"), invalid: adminSetProgression("one","setLevel",-1),
      level: adminSetProgression("one","setLevel",42), unlocked: adminSetProgression("one","unlockAll"),
      after: rewardPlayer("one", 20, 1, 1, false, "airfield"), absent: adminSetProgression("unknown","unlockAll") }));
  `);
  assert.equal(result.missing, null);
  assert.equal(result.absent.ok, false);
  assert.equal(result.invalid.ok, false);
  assert.equal(result.level.profile.level, 42);
  assert.equal(result.search.profiles[0].username, "OfflineRanger");
  assert.deepEqual(result.after.campaignCompleted, []);
  assert.equal(result.unlocked.profile.ownedWeapons.length, 12);
  assert.equal(result.unlocked.profile.unlockedMaps.length, 9);
  const restarted = run(`
    import { getProfile, adminSetProgression, equipWeapon } from "./server/store.js";
    adminSetProgression("one","setLevel",1);
    console.log(JSON.stringify({ profile:getProfile("one"), sniper:equipWeapon("one","sniper") }));
  `);
  assert.equal(restarted.profile.level, 1);
  assert.equal(restarted.profile.unlockedMaps.length, 9);
  assert.equal(restarted.profile.ownedWeapons.length, 12);
  assert.equal(restarted.sniper.ok, true);
});
