import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAddressResolver, createBanStore, MAX_BANS, normalizeAddress } from "../server/bans.js";
import { createCommandGuard } from "../server/anti-cheat.js";

const report = { id: crypto.randomUUID(), targetId: "reported-player", targetName: "Reported" };
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "last-light-bans-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, store: createBanStore(directory, { now: () => 12345 }) };
}

test("addresses normalize IPv4, IPv6 and IPv4-mapped IPv6 without trusting arbitrary headers", () => {
  assert.equal(normalizeAddress("192.0.2.1"), "192.0.2.1");
  assert.equal(normalizeAddress("::ffff:192.0.2.1"), "192.0.2.1");
  assert.equal(normalizeAddress("::ffff:c000:201"), "192.0.2.1");
  assert.equal(normalizeAddress("2001:0DB8:0:0:0:0:0:1"), "2001:db8::1");
  for (const invalid of [null, "unknown", "[::1]:123", "1.2.3.4:80", "999.1.2.3", "fe80::1%eth0"]) {
    assert.equal(normalizeAddress(invalid), null);
  }
  const request = { socket: { remoteAddress: "::ffff:192.0.2.2" },
    headers: { "x-forwarded-for": "198.51.100.9, 203.0.113.8" } };
  assert.equal(createAddressResolver({})(request), "192.0.2.2");
  assert.equal(createAddressResolver({ CLIENT_IP_SOURCE: "azure" })(request), "203.0.113.8");
  assert.equal(createAddressResolver({ CONTAINER_APP_NAME: "game", CONTAINER_APP_ENV_DNS_SUFFIX: "example" })(request), "203.0.113.8");
  assert.equal(createAddressResolver({ CLIENT_IP_SOURCE: "direct", CONTAINER_APP_NAME: "game",
    CONTAINER_APP_ENV_DNS_SUFFIX: "example" })(request), "192.0.2.2");
  for (const header of [undefined, "spoofed, unknown", "198.51.100.9, ", ["198.51.100.9"]]) {
    assert.equal(createAddressResolver({ CLIENT_IP_SOURCE: "azure" })({ ...request, headers: { "x-forwarded-for": header } }), null);
  }
  assert.throws(() => createAddressResolver({ CLIENT_IP_SOURCE: "trust-everything" }), /CLIENT_IP_SOURCE/);
});

test("player and IP bans persist privately and independently until manually removed", (t) => {
  const { directory, store } = fixture(t);
  const address = "192.0.2.1", targetAddressHash = store.hashAddress(address);
  const recorded = { ...report, targetAddressHash };
  assert.equal(store.hashAddress("::ffff:192.0.2.1"), targetAddressHash);
  assert.equal(store.hashAddress("invalid"), null);
  assert.equal(store.ban(recorded, "player", "staff").ok, true);
  assert.equal(store.ban(recorded, "ip", "staff").ok, true);
  assert.equal(store.ban(recorded, "ip", "staff").ok, false);
  let restored = createBanStore(directory);
  assert.equal(restored.isBanned("player", report.targetId), true);
  assert.equal(restored.isBanned("ip", restored.hashAddress(address)), true);
  assert.equal(restored.isBanned("ip", restored.hashAddress("192.0.2.2")), false);
  const listing = restored.list();
  assert.equal(listing.total, 2);
  assert.ok(listing.bans.every((ban) => !Object.hasOwn(ban, "key")));
  assert.equal(listing.bans[0].at, 12345);
  assert.equal(restored.remove(listing.bans.find((ban) => ban.kind === "player").id).ok, true);
  restored = createBanStore(directory);
  assert.equal(restored.isBanned("player", report.targetId), false);
  assert.equal(restored.isBanned("ip", restored.hashAddress(address)), true);
  assert.equal(restored.remove("missing").ok, false);
  assert.equal(restored.list({ offset: -1 }).ok, false);
  assert.equal(restored.ban(report, "ip", "staff").ok, false);
  assert.equal(restored.ban(report, "unknown", "staff").ok, false);
  for (const file of ["bans.json", "moderation-secret"]) {
    assert.equal(fs.statSync(path.join(directory, file)).mode & 0o777, 0o600);
    assert.ok(!fs.readFileSync(path.join(directory, file), "utf8").includes(address));
  }
});

test("full ban storage refuses new bans without evicting existing bans; pages omit hashes", (t) => {
  const { directory, store } = fixture(t);
  store.ban(report, "player", "staff");
  const base = JSON.parse(fs.readFileSync(path.join(directory, "bans.json")))[0];
  const entries = Array.from({ length: MAX_BANS }, (_, index) => ({ ...base,
    id: crypto.randomUUID(), key: `player-${index}`, targetId: `player-${index}` }));
  fs.writeFileSync(path.join(directory, "bans.json"), JSON.stringify(entries));
  const full = createBanStore(directory);
  assert.equal(full.ban(report, "player", "staff").ok, false);
  assert.equal(full.list().total, MAX_BANS);
  assert.equal(full.list().nextOffset, 20);
  assert.equal(full.list({ offset: MAX_BANS - 20 }).bans.length, 20);
  assert.equal(full.list({ offset: MAX_BANS - 20 }).nextOffset, null);
  assert.equal(full.isBanned("player", "player-0"), true);
});

test("failed ban/unban writes do not apply changes and damaged stores/keys fail visibly", (t) => {
  const { directory, store } = fixture(t);
  const blocked = path.join(directory, "bans.json.next");
  fs.mkdirSync(blocked);
  assert.throws(() => store.ban(report, "player", "staff"));
  assert.equal(store.isBanned("player", report.targetId), false);
  fs.rmdirSync(blocked);
  store.ban(report, "player", "staff");
  fs.mkdirSync(blocked);
  assert.throws(() => store.remove(store.list().bans[0].id));
  assert.equal(store.isBanned("player", report.targetId), true);
  fs.writeFileSync(path.join(directory, "bans.json"), "{corrupt");
  assert.throws(() => createBanStore(directory));
  fs.unlinkSync(path.join(directory, "moderation-secret"));
  assert.throws(() => createBanStore(directory), /secret is missing/);
});

test("ban commands reject unauthorized admins, spoofed addresses, arbitrary targets and malformed input", () => {
  for (const [event, input] of [["adminBanReport", { reportId: report.id, kind: "ip" }],
    ["adminBans", {}], ["adminUnban", report.id]]) {
    assert.equal(createCommandGuard().check([event, input], false).reason, "permission_denied");
    assert.equal(createCommandGuard().check([event, input], true).ok, true);
  }
  for (const input of [null, { reportId: report.id, kind: "all" },
    { reportId: report.id, kind: "ip", ip: "192.0.2.1" },
    { reportId: report.id, kind: "player", playerId: "innocent" }]) {
    assert.equal(createCommandGuard().check(["adminBanReport", input], true).ok, false);
  }
});

test("temporary bans carry a reason, expire on their own and can be reapplied", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "last-light-bans-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let clock = 1000;
  const store = createBanStore(directory, { now: () => clock });
  assert.equal(store.ban(report, "player", "staff", { durationMs: 0 }).ok, false);
  const applied = store.ban(report, "player", "staff", { durationMs: 60_000, reason: "  Spamming\nchat  " });
  assert.deepEqual(applied.ban, { kind: "player", reason: "Spamming chat", at: 1000, until: 61_000 });
  assert.deepEqual(store.notice(store.active("player", report.targetId)), applied.ban);
  assert.equal(createBanStore(directory, { now: () => clock }).isBanned("player", report.targetId), true, "temporary bans persist");
  clock = 61_000;
  assert.equal(store.isBanned("player", report.targetId), false);
  assert.equal(store.list().total, 0);
  assert.equal(store.ban(report, "player", "staff").ban.until, null);
  assert.equal(store.isBanned("player", report.targetId), true);
});
