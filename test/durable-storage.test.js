import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { io } from "socket.io-client";
import { batches, CHUNK_BYTES, decodeFiles, documentDigest, DurableState, encodeFiles, SCOPE,
  usePersistence } from "../server/persistence.js";
import { captureDirectory, importBundle, makeBundle, readBundle, restoreDirectory,
  validateSnapshotSemantics, verifyDataset, verifyIdentity } from "../server/snapshots.js";
import { createTableAdapter, tableEntity } from "../server/tables.js";
import { createStaffAccess } from "../server/staff-access.js";
import { newCareer, periodFor, seasonAt } from "../shared/career.js";

const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";
const signing = "a".repeat(64), salt = "b".repeat(32);
const fingerprint = (code) => crypto.scryptSync(code, Buffer.from(salt, "hex"), 32).toString("hex");
const identity = { source: "file", fingerprint: crypto.createHash("sha256").update(signing).digest("hex") };
function fixtureFiles() {
  const players = Object.fromEntries([firstId, secondId].map((id, index) => [id, {
    id, username: `Fixture ${index}`, xp: 1000, tokens: 240, matches: 3, totalKills: 12,
    ownedWeapons: ["rifle", "smg"], equippedWeaponId: "smg", lootedWeapons: ["smg"],
    ownedSkins: ["standard"], equippedSkinId: "standard", campaignCompleted: ["foundry"]
  }]));
  return new Map(Object.entries({
    "players.json": JSON.stringify(players), "players.backup.json": JSON.stringify(players),
    "identity-secret": signing, "moderation-secret": "c".repeat(64),
    "bans.json": JSON.stringify([{ id: "44444444-4444-4444-8444-444444444444", kind: "player", key: secondId,
      targetId: secondId, targetName: "Fixture 1", reportId: "33333333-3333-4333-8333-333333333333",
      actorId: firstId, at: 100, reason: "Fixture moderation", until: null }]),
    "reports.json": JSON.stringify([{ id: "33333333-3333-4333-8333-333333333333", at: 90, status: "open",
      reason: "Fixture report reason", reporterId: firstId, reporterName: "Fixture 0",
      targetId: secondId, targetName: "Fixture 1", roomCode: "ABC123", mode: "campaign", mapId: "foundry",
      targetAddressHash: "e".repeat(64), targetWasAdmin: false, reviewedAt: null, reviewedBy: null }]),
    "ban-appeals.json": JSON.stringify([{ id: "55555555-5555-4555-8555-555555555555",
      banId: "44444444-4444-4444-8444-444444444444", targetId: secondId, targetName: "Fixture 1",
      kind: "player", banReason: "Fixture moderation", banAt: 100, banUntil: null,
      reason: "Fixture appeal reason", at: 200, status: "open", reviewedAt: null, reviewedBy: null }]),
    "audit.json": JSON.stringify({ entries: [{ id: 1, at: 10, kind: "admin", action: "fixture",
      actorId: firstId, result: "applied", count: 1 }], nextId: 2 }),
    "pending-rewards.json": "{}", "reward-receipts.json": "{}",
    "staff-access.json": JSON.stringify({ version: 1, salt, staff: {
      [firstId]: { role: "owner", revision: "d".repeat(32),
        codes: [{ hash: fingerprint("123456"), used: true }, { hash: fingerprint("654321"), used: false }] }
    } })
  }));
}

class FakeTable {
  rows = new Map();
  revision = 0;
  calls = 0;
  failBatch = 0;
  failReads = 0;
  loseResponse = false;
  failReadAfterCommit = 0;
  gate = null;
  async readRoot() {
    if (this.failReads > 0) { this.failReads--; throw Object.assign(new Error("Unavailable"), { code: 503 }); }
    return structuredClone(this.rows.get("active") || null);
  }
  async readDocuments(dataset) {
    return new Map([...this.rows].filter(([id, value]) => id !== "active" && value.dataset === dataset)
      .map(([id, { _etag, ...document }]) => [id, structuredClone(document)]));
  }
  async batch(operations) {
    this.calls++;
    assert.ok(operations.length <= 100);
    assert.equal(new Set(operations.map((operation) => operation.id)).size, operations.length);
    if (this.gate) await this.gate;
    if (this.failBatch === this.calls) throw Object.assign(new Error("Unavailable"), { code: 503 });
    const next = new Map(this.rows);
    for (const operation of operations) {
      const current = next.get(operation.id);
      if (operation.ifMatch && current?._etag !== operation.ifMatch) throw Object.assign(new Error("Conflict"), { code: 412 });
      if (operation.operationType === "Create" && current) throw Object.assign(new Error("Exists"), { code: 409 });
      if (operation.operationType === "Replace" && !current) throw Object.assign(new Error("Missing"), { code: 404 });
      if (operation.operationType === "Delete") next.delete(operation.id);
      else {
        tableEntity(operation.resourceBody);
        assert.equal(operation.resourceBody.scope, SCOPE);
        next.set(operation.id, { ...structuredClone(operation.resourceBody), _etag: String(++this.revision) });
      }
    }
    this.rows = next;
    this.failReads = this.failReadAfterCommit;
    this.failReadAfterCommit = 0;
    if (this.loseResponse) { this.loseResponse = false; throw Object.assign(new Error("Lost response"), { code: "ETIMEDOUT" }); }
  }
}

let domain;
async function setup(t, files = fixtureFiles()) {
  const adapter = new FakeTable();
  const imported = await importBundle(adapter, makeBundle(files, identity));
  const engine = await new DurableState(adapter, imported.dataset, validateSnapshotSemantics).initialize();
  usePersistence(engine);
  if (!domain) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deadlight-durable-domain-"));
    // The domain modules must never inherit production endpoints or signing credentials.
    process.env.DATA_DIR = directory;
    process.env.PERSISTENCE_BACKEND = "file";
    process.env.IDENTITY_SECRET = "";
    delete process.env.TABLES_ENDPOINT;
    delete process.env.COSMOS_ENDPOINT;
    domain = { ...await import("../server/store.js"), ...await import("../server/rewards.js"),
      ...await import("../server/auth.js") };
    fs.rmdirSync(directory);
  }
  t.after(() => usePersistence(null));
  return { adapter, engine, dataset: imported.dataset, ...domain };
}

test("success and effects wait for durable commit; rejected writes roll back and restart from saved state", async (t) => {
  const { adapter, engine, dataset, buySkin, getProfile } = await setup(t);
  let release, effect = false;
  const { afterCommit } = await import("../server/persistence.js");
  adapter.gate = new Promise((resolve) => { release = resolve; });
  const purchase = engine.run(() => {
    const result = buySkin(firstId, "nightwatch");
    afterCommit(() => { effect = true; });
    return result;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(effect, false);
  assert.equal(getProfile(firstId).tokens, 240);
  release(); adapter.gate = null;
  assert.equal((await purchase).profile.tokens, 120);
  assert.equal(effect, true);
  adapter.failBatch = adapter.calls + 1;
  effect = false;
  await assert.rejects(engine.run(() => {
    domain.creditNpcTokens(firstId, 20);
    afterCommit(() => { effect = true; });
  }));
  assert.equal(effect, false);
  assert.equal(getProfile(firstId).tokens, 120);
  const restart = await new DurableState(adapter, dataset).initialize();
  assert.equal(JSON.parse(restart.read("players.json"))[firstId].tokens, 120);
});

test("serialized purchases cannot double-spend and concurrent username claims remain unique", async (t) => {
  const { engine, buySkin, getProfile, updateUsername } = await setup(t);
  const purchases = await Promise.all([engine.run(() => buySkin(firstId, "nightwatch")),
    engine.run(() => buySkin(firstId, "nightwatch"))]);
  assert.equal(purchases.filter((result) => result.ok).length, 1);
  assert.equal(getProfile(firstId).tokens, 120);
  assert.equal(getProfile(firstId).ownedSkins.filter((id) => id === "nightwatch").length, 1);
  const names = await Promise.all([engine.run(() => updateUsername(firstId, "Unique Name")),
    engine.run(() => updateUsername(secondId, "unique name"))]);
  assert.equal(names.filter((result) => result.ok).length, 1);
});

test("overlapping writers are fenced atomically and refresh stale caches before a later retry", async (t) => {
  const { adapter, engine, dataset } = await setup(t);
  const other = await new DurableState(adapter, dataset).initialize();
  let release;
  adapter.gate = new Promise((resolve) => { release = resolve; });
  const change = (state, id, amount) => state.run(() => {
    const players = JSON.parse(state.read("players.json"));
    players[id].tokens += amount;
    state.write("players.json", JSON.stringify(players));
  });
  const first = change(engine, firstId, 10), second = change(other, secondId, 30);
  await new Promise((resolve) => setImmediate(resolve));
  release(); adapter.gate = null;
  const outcomes = await Promise.allSettled([first, second]);
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
  const failed = outcomes[0].status === "rejected" ? engine : other;
  const retryId = failed === engine ? firstId : secondId;
  await change(failed, retryId, failed === engine ? 10 : 30);
  const fresh = await new DurableState(adapter, dataset).initialize();
  const players = JSON.parse(fresh.read("players.json"));
  assert.equal(players[firstId].tokens, 250);
  assert.equal(players[secondId].tokens, 270);
});

test("identity signatures and used staff hashes survive restart; one code can be consumed only once", async (t) => {
  const { engine, adapter, dataset, issueToken, verifyToken } = await setup(t);
  const token = issueToken(firstId), staff = createStaffAccess("");
  assert.equal(verifyToken(token), firstId);
  assert.equal((await engine.run(() => staff.verify(firstId, "123456"))).ok, false);
  const results = await Promise.all([engine.run(() => staff.verify(firstId, "654321")),
    engine.run(() => staff.verify(firstId, "654321"))]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  const restarted = await new DurableState(adapter, dataset).initialize();
  usePersistence(restarted);
  const restoredStaff = createStaffAccess("");
  assert.equal(verifyToken(token), firstId);
  assert.equal(restoredStaff.role(firstId), "owner");
  assert.equal((await restarted.run(() => restoredStaff.verify(firstId, "654321"))).ok, false);
});

test("serialized role/code replacement revokes old codes and cannot remove the last owner", async (t) => {
  const { engine } = await setup(t);
  const staff = createStaffAccess("");
  const issued = await Promise.all([engine.run(() => staff.issue(firstId)), engine.run(() => staff.issue(firstId))]);
  assert.equal((await engine.run(() => staff.verify(firstId, issued[0].codes[0]))).ok, false);
  assert.equal((await engine.run(() => staff.verify(firstId, issued[1].codes[0]))).ok, true);
  const roles = await Promise.all([engine.run(() => staff.setRole(secondId, "owner")),
    engine.run(() => staff.setRole(firstId, "none"))]);
  assert.ok(roles.every((result) => result.ok));
  assert.equal(staff.role(firstId), null);
  assert.equal(staff.role(secondId), "owner");
  assert.equal((await engine.run(() => staff.setRole(secondId, "none"))).ok, false);
});

test("oversized individual profile payloads fail before any durable mutation", async (t) => {
  const { engine, adapter } = await setup(t);
  const before = adapter.calls, root = await adapter.readRoot();
  await assert.rejects(engine.run(() => {
    const players = JSON.parse(engine.read("players.json"));
    players[firstId].oversizedFixture = "😀".repeat(16_000);
    engine.write("players.json", JSON.stringify(players));
  }), /Table property limit/);
  assert.equal(adapter.calls, before);
  assert.equal((await adapter.readRoot()).digest, root.digest);
});

test("staged NPC and match intents recover after restart and lost responses cannot duplicate rewards", async (t) => {
  const { engine, adapter, dataset, stageReward, applyReward, commitReward, recoverRewards, getProfile } = await setup(t);
  const npc = { id: crypto.randomUUID(), identity: firstId, kind: "npc", tokens: 6 };
  await stageReward(npc);
  const restarted = await new DurableState(adapter, dataset).initialize();
  usePersistence(restarted);
  await recoverRewards();
  assert.equal(getProfile(firstId).tokens, 246);
  await commitReward(npc);
  assert.equal(getProfile(firstId).tokens, 246);
  const match = { id: crypto.randomUUID(), identity: firstId, kind: "match", tokens: 50,
    xp: 100, kills: 4, wave: 5, won: true, mapId: "tundra" };
  await stageReward(match);
  adapter.loseResponse = true;
  adapter.failReadAfterCommit = 1;
  await assert.rejects(applyReward(match), /Unavailable/);
  const afterLostResponse = await new DurableState(adapter, dataset).initialize();
  usePersistence(afterLostResponse);
  await recoverRewards();
  await commitReward(match);
  assert.equal(getProfile(firstId).tokens, 296);
  assert.equal(getProfile(firstId).xp, 1100);
  assert.equal(getProfile(firstId).matches, 4);
  assert.deepEqual(getProfile(firstId).campaignCompleted, ["foundry", "tundra"]);
  await assert.rejects(commitReward({ ...npc, tokens: 12 }), /different contents/);
  usePersistence(engine);
});

test("class choices and flat teamwork rewards survive committed writes, snapshots, restart and receipt retries", async (t) => {
  const { engine, adapter, dataset, selectClass, getProfile, stageReward, commitReward, recoverRewards } = await setup(t);
  assert.equal(getProfile(firstId).classId, "assault", "legacy records default without rewriting progression");
  assert.equal((await engine.run(() => selectClass(firstId, "medic"))).ok, true);
  const reward = { id: crypto.randomUUID(), identity: firstId, kind: "match", tokens: 10,
    xp: 180, kills: 2, wave: 4, won: true, mapId: null, assists: 2, revives: 1, objectiveScore: 400, teamXp: 140 };
  await stageReward(reward);
  const restart = await new DurableState(adapter, dataset, validateSnapshotSemantics).initialize();
  usePersistence(restart);
  await recoverRewards();
  await commitReward(JSON.parse(JSON.stringify(reward)));
  const profile = getProfile(firstId);
  assert.equal(profile.classId, "medic");
  assert.equal(profile.xp, 1180);
  assert.equal(profile.totalAssists, 2);
  assert.equal(profile.totalRevives, 1);
  assert.equal(profile.totalObjectiveScore, 400);
  assert.equal(profile.teamworkXp, 140);
  assert.deepEqual(profile.campaignCompleted, ["foundry"]);
  const documents = await adapter.readDocuments(dataset);
  const files = decodeFiles(documents, await adapter.readRoot());
  const restored = readBundle(makeBundle(files, identity));
  const saved = JSON.parse(restored.get("players.json"))[firstId];
  assert.equal(saved.classId, "medic");
  assert.equal(saved.teamworkXp, 140);
  assert.equal(JSON.parse(restored.get("reward-receipts.json"))[reward.id].revives, 1);
  await assert.rejects(commitReward({ ...reward, revives: 2 }), /different contents/);
});

test("snapshot validators fail closed on invalid new profile counters and teamwork journal contents", () => {
  for (const name of ["players.json", "players.backup.json"]) {
    for (const metadata of [{ classId: "owner" }, { totalRevives: -1 }, { teamworkXp: .5 }]) {
      const files = fixtureFiles();
      const records = JSON.parse(files.get(name));
      Object.assign(records[firstId], metadata);
      files.set(name, JSON.stringify(records));
      assert.throws(() => makeBundle(files, identity));
    }
  }
  for (const file of ["pending-rewards.json", "reward-receipts.json"]) {
    const files = fixtureFiles();
    const reward = { id: crypto.randomUUID(), identity: firstId, kind: "match", tokens: 0,
      xp: 1, kills: 0, wave: 1, won: false, mapId: null, teamXp: 999 };
    files.set(file, JSON.stringify({ [reward.id]: reward }));
    assert.throws(() => makeBundle(files, identity));
  }
});

test("career mastery, archived seasons, claims, cosmetics and prestige round-trip Table snapshots and lost acknowledgements exactly once", async (t) => {
  const { adapter, dataset, getProfile, commitReward, claimProgression, equipProgression, recoverRewards } = await setup(t);
  const at = Date.now(), period = periodFor("daily", at), season = seasonAt(at).id;
  const reward = { id: crypto.randomUUID(), identity: firstId, kind: "match", tokens: 10,
    xp: 20000, kills: 200, wave: 5, won: true, mapId: "tundra", revives: 1, objectiveScore: 400,
    progression: JSON.stringify({ classId: "medic", weaponXp: { rifle: 4000 }, shots: 800, hits: 600, damage: 12000,
      at, difficulty: "nightmare", mutators: ["iron"], mode: "campaign", activeMs: 300000 }) };
  await commitReward(reward);
  const before = getProfile(firstId);
  const request = { type: "challenge", key: "daily-kills", period };
  adapter.loseResponse = true; adapter.failReadAfterCommit = 1;
  await assert.rejects(claimProgression(firstId, request, at));
  const restarted = await new DurableState(adapter, dataset, validateSnapshotSemantics).initialize();
  usePersistence(restarted);
  await recoverRewards();
  await claimProgression(firstId, request, at);
  assert.equal(getProfile(firstId).xp, before.xp + 150);
  assert.equal(getProfile(firstId).tokens, before.tokens + 30);
  await claimProgression(firstId, { type: "season", key: "4", period: season }, at);
  assert.equal((await restarted.run(() => equipProgression(firstId, { kind: "finish", id: "aurora", weaponId: "rifle" }))).ok, true);
  await claimProgression(firstId, { type: "prestige", key: "1", period: "lifetime" }, at);
  await commitReward(reward);
  const final = getProfile(firstId);
  assert.equal(final.career.weaponXp.rifle, 4000);
  assert.equal(final.career.classXp.medic, 10000);
  assert.equal(final.career.prestige, 1);
  assert.deepEqual(final.campaignCompleted, ["foundry", "tundra"]);
  const bundle = makeBundle(decodeFiles(await adapter.readDocuments(dataset), await adapter.readRoot()), identity);
  const files = readBundle(bundle);
  assert.deepEqual(JSON.parse(files.get("players.json"))[firstId].career, final.career);
  assert.ok(JSON.parse(files.get("players.backup.json"))[firstId].career);
  const another = new FakeTable();
  const imported = await importBundle(another, bundle);
  const restored = await new DurableState(another, imported.dataset, validateSnapshotSemantics).initialize();
  usePersistence(restored);
  await recoverRewards();
  await claimProgression(firstId, request, at);
  assert.equal(getProfile(firstId).tokens, final.tokens);
  assert.equal(getProfile(firstId).xp, final.xp);
  assert.equal(getProfile(firstId).career.loadouts.rifle.finishId, "aurora");
});

test("current/backup career records and progression receipt payloads fail snapshot validation when corrupt", () => {
  for (const name of ["players.json", "players.backup.json"]) {
    for (const career of [{ ...newCareer(), prestige: -1 }, { ...newCareer(), weaponXp: { rifle: "40" } },
      { ...newCareer(), seasons: { s1: { xp: 0, claimed: [4] } } }]) {
      const files = fixtureFiles(), records = JSON.parse(files.get(name));
      records[firstId].career = career; files.set(name, JSON.stringify(records));
      assert.throws(() => makeBundle(files, identity));
    }
  }
  const files = fixtureFiles(), id = crypto.randomUUID();
  files.set("pending-rewards.json", JSON.stringify({ [id]: { id, kind: "match", identity: firstId,
    xp: 100, tokens: 0, kills: 1, wave: 1, won: false, mapId: null, progression: "{}" } }));
  assert.throws(() => makeBundle(files, identity));
});

test("rankings, accepted friends and squads survive atomic lost-ACK recovery and old optional-file snapshots", async (t) => {
  const { engine, adapter, dataset, getProfile, commitReward, recoverRewards } = await setup(t);
  const { socialAction, socialStatus, readRankings } = await import("../server/records.js");
  assert.equal(engine.files.has("squads.json"), false);
  const action = (id, input) => engine.run(() => {
    const result = socialAction(id, input); assert.equal(result.ok, true, result.error);
  });
  await action(firstId, { action: "friendRequest", tag: "22222222" });
  await action(secondId, { action: "friendAccept", tag: "11111111" });
  await action(firstId, { action: "squadCreate", name: "Durable squad" });
  await action(firstId, { action: "squadInvite", tag: "22222222" });
  await action(secondId, { action: "squadAccept", tag: "11111111" });
  const at = Date.now(), reward = { id: crypto.randomUUID(), identity: firstId, kind: "match",
    xp: 100, tokens: 10, kills: 1, wave: 5, won: true, mapId: "foundry",
    progression: JSON.stringify({ classId: "assault", weaponXp: { rifle: 20 }, shots: 20, hits: 1, damage: 20,
      at, difficulty: "standard", mutators: [], mode: "campaign", activeMs: 60000 }),
    ranking: JSON.stringify({ version: 1, mapId: "foundry", personalMs: 60000, full: true, eligible: true,
      team: { tag: "11111111", anchor: true, size: 2 } }) };
  adapter.loseResponse = true; adapter.failReadAfterCommit = 1;
  await assert.rejects(commitReward(reward));
  const restarted = await new DurableState(adapter, dataset, validateSnapshotSemantics).initialize();
  usePersistence(restarted); await recoverRewards(); await commitReward(reward);
  assert.equal(getProfile(firstId).ranking.lifetime.kills, 1);
  assert.equal(readRankings(firstId, { period: "allTime", metric: "score", scope: "squads" }).self.value, 350);
  assert.equal(socialStatus(secondId).squad.members.length, 2);
  const files = decodeFiles(await adapter.readDocuments(dataset), await adapter.readRoot());
  const bundle = makeBundle(files, identity), copy = new FakeTable();
  const imported = await importBundle(copy, bundle);
  const restored = await new DurableState(copy, imported.dataset, validateSnapshotSemantics).initialize();
  usePersistence(restored);
  await commitReward(reward);
  assert.equal(getProfile(firstId).ranking.lifetime.kills, 1);
  assert.equal(socialStatus(firstId).friends[0].playerTag, "22222222");
  assert.equal(readBundle(bundle).has("squads.json"), true);
  await restored.run(() => socialAction(firstId, { action: "squadLeave" }));
  await commitReward({ ...reward, id: crypto.randomUUID(), identity: secondId,
    ranking: JSON.stringify({ ...JSON.parse(reward.ranking), team: { tag: "11111111", anchor: false, size: 2 } }) });
  const archived = readRankings(firstId, { period: "allTime", metric: "score", scope: "squads" }).entries[0];
  assert.equal(archived.value, 450); assert.equal(archived.matches, 1); assert.equal(archived.archived, true);
});

test("current/backup ranked corruption and inconsistent social/squad snapshots fail closed", () => {
  for (const name of ["players.json", "players.backup.json"]) {
    const files = fixtureFiles(), records = JSON.parse(files.get(name));
    records[firstId].ranking = { version: 1, since: 0, lifetime: {}, periods: {} };
    files.set(name, JSON.stringify(records)); assert.throws(() => makeBundle(files, identity));
  }
  const files = fixtureFiles(), records = JSON.parse(files.get("players.json"));
  records[firstId].social = { friends: ["22222222"], incoming: [], squadTag: null };
  files.set("players.json", JSON.stringify(records));
  assert.throws(() => makeBundle(files, identity), /Inconsistent/);
  files.set("players.json", fixtureFiles().get("players.json"));
  files.set("squads.json", "{");
  assert.throws(() => makeBundle(files, identity));
});

test("missing, corrupt, uninitialized or foreign datasets never fall back to empty/local progress", async (t) => {
  const { adapter, dataset, engine } = await setup(t);
  const writes = adapter.calls;
  adapter.failReads = 1;
  await assert.rejects(engine.run(() => assert.fail("outage must reject before domain logic")));
  assert.equal(adapter.calls, writes);
  await assert.rejects(new DurableState(adapter, crypto.randomUUID()).initialize(), /Expected/);
  const missing = new FakeTable();
  await assert.rejects(new DurableState(missing, dataset).initialize(), /Expected/);
  assert.equal(missing.rows.size, 0);
  const active = adapter.rows.get("active");
  for (const invalid of [{ revision: -1 }, { revision: "0" }, { schema: 2 },
    { initialized: false }, { scope: "foreign" }, { transaction: "invalid" }, { updatedAt: -1 }]) {
    adapter.rows.set("active", { ...active, ...invalid });
    await assert.rejects(new DurableState(adapter, dataset).initialize(), /missing, corrupt|Expected/);
  }
  adapter.rows.set("active", active);
  assert.equal(adapter.calls, writes);
  const recordId = [...adapter.rows.keys()].find((id) => id !== "active");
  adapter.rows.delete(recordId);
  await assert.rejects(new DurableState(adapter, dataset).initialize(), /missing, corrupt/);
});

test("full-size staged imports publish only after checksum verification; partial imports stay inactive", async () => {
  const files = fixtureFiles();
  files.set("backups/opaque.bin", Buffer.from([0, 255, 17, 128]));
  files.set("backups/large.bin", Buffer.alloc(2_100_000, 42));
  const bundle = makeBundle(files, identity);
  const failed = new FakeTable();
  failed.failBatch = 2;
  await assert.rejects(importBundle(failed, bundle));
  assert.equal(await failed.readRoot(), null);
  assert.ok(failed.rows.size > 0);
  const adapter = new FakeTable();
  const imported = await importBundle(adapter, bundle);
  assert.ok(adapter.calls > 2);
  const state = await verifyDataset(adapter, imported.dataset, bundle);
  assert.deepEqual(state.files.get("backups/opaque.bin"), Buffer.from([0, 255, 17, 128]));
  await assert.rejects(importBundle(adapter, bundle), /already exists/);
  const bad = structuredClone(bundle);
  bad.files[0].data += "corrupt";
  assert.throws(() => readBundle(bad), /manifest/);
  const incomplete = fixtureFiles();
  incomplete.delete("players.json");
  assert.throws(() => makeBundle(incomplete, identity), /Incomplete/);
});

test("lost import activation responses recover a verified UUID only against the exact expected bundle", async () => {
  const adapter = new FakeTable(), bundle = makeBundle(fixtureFiles(), identity);
  const batch = adapter.batch.bind(adapter);
  adapter.batch = async (operations) => {
    await batch(operations);
    if (operations.some((operation) => operation.id === "active")) {
      adapter.failReads = 1;
      throw new Error("Lost activation response");
    }
  };
  await assert.rejects(importBundle(adapter, bundle), /Unavailable/);
  const writes = adapter.calls;
  const recovered = await verifyDataset(adapter, undefined, bundle);
  assert.equal(recovered.dataset, (await adapter.readRoot()).dataset);
  await assert.rejects(verifyDataset(adapter), /expected dataset/);
  const other = fixtureFiles();
  const players = JSON.parse(other.get("players.json"));
  players[firstId].tokens++;
  other.set("players.json", JSON.stringify(players));
  await assert.rejects(verifyDataset(adapter, undefined, makeBundle(other, identity)), /expected snapshot/);
  await assert.rejects(verifyDataset(adapter, undefined, { ...bundle,
    identity: { source: "environment", fingerprint: "e".repeat(64) } }), /expected snapshot/);
  adapter.failReads = 1;
  await assert.rejects(verifyDataset(adapter, undefined, bundle), /Unavailable/);
  assert.equal(adapter.calls, writes);
});

test("snapshot pack/restore preserves every surface, refuses corrupt sources and verifies identity references", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deadlight-snapshot-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const [name, content] of fixtureFiles()) fs.writeFileSync(path.join(directory, name), content, { mode: 0o600 });
  const bundle = captureDirectory(directory, { expectedProfiles: 2, environment: {} });
  verifyIdentity(bundle.identity, readBundle(bundle), {});
  assert.throws(() => verifyIdentity(bundle.identity, readBundle(bundle), { IDENTITY_SECRET: "wrong" }), /does not match/);
  const output = path.join(directory, "restored");
  restoreDirectory(output, bundle);
  assert.equal(fs.statSync(path.join(output, "staff-access.json")).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output, "staff-access.json"))),
    JSON.parse(fs.readFileSync(path.join(directory, "staff-access.json"))));
  assert.throws(() => captureDirectory(directory, { expectedProfiles: 9, environment: {} }), /count/);
  fs.writeFileSync(path.join(directory, "players.json"), "{bad");
  assert.throws(() => captureDirectory(directory, { expectedProfiles: 2, environment: {} }));
});

test("Table encoding measures UTF16 payload properties and conservative transaction bytes", () => {
  assert.equal(CHUNK_BYTES, 16 * 1024);
  const files = fixtureFiles();
  files.set("archive.bin", Buffer.alloc(100_000, 255));
  for (const document of encodeFiles(files, crypto.randomUUID()).values()) {
    assert.ok(Buffer.byteLength(tableEntity(document).payload, "utf16le") <= 60 * 1024);
  }
  assert.throws(() => tableEntity({ id: "oversized", value: "😀".repeat(16_000) }), /property limit/);
  assert.ok(batches(Array.from({ length: 200 }, (_, index) => ({
    operationType: "Create", id: String(index), resourceBody: { payload: "x".repeat(20_000) }
  }))).every((batch) => batch.length <= 90));
});

test("the full 5000-ban limit imports in stages and one removal remains a bounded atomic mutation", async (t) => {
  const files = fixtureFiles();
  const bans = Array.from({ length: 5000 }, (_, index) => ({
    id: crypto.randomUUID(), kind: "player", key: `fixture-target-${index}`, targetId: `fixture-target-${index}`,
    targetName: "Fixture", reportId: secondId, actorId: firstId, at: index + 1,
    reason: "Fixture ban reason ".repeat(10), until: null
  }));
  files.set("bans.json", JSON.stringify(bans));
  assert.ok(Buffer.byteLength(files.get("bans.json")) < 4_000_000);
  const { engine, adapter } = await setup(t, files);
  const { createBanStore } = await import("../server/bans.js");
  const store = createBanStore("");
  const before = adapter.calls;
  assert.equal((await engine.run(() => store.remove(bans[0].id))).ok, true);
  assert.equal(adapter.calls, before + 1);
  assert.equal((await engine.run(() => store.list())).total, 4999);
});

test("Table adapter submits the root ETag fence in the same partition transaction and rejects CLI runtime auth", async () => {
  const calls = [];
  const environment = { TABLES_ENDPOINT: "https://fixtureaccount.table.core.windows.net",
    TABLES_CLIENT_ID: crypto.randomUUID() };
  const adapter = await createTableAdapter(environment, { client: {
    async submitTransaction(actions) { calls.push(actions); return { subResponses: actions.map(() => ({ status: 204 })) }; }
  } });
  await adapter.batch([{ operationType: "Replace", id: "active", ifMatch: "expected-etag",
    resourceBody: { id: "active", scope: SCOPE, dataset: crypto.randomUUID() } }]);
  assert.equal(calls[0][0][3].etag, "expected-etag");
  assert.equal(calls[0][0][1].partitionKey, "game");
  await assert.rejects(createTableAdapter({ ...environment, TABLES_AUTH_MODE: "azure-cli" }), /Runtime requires/);
  await assert.rejects(createTableAdapter({ ...environment, TABLES_ENDPOINT: "https://fixtureaccount-secondary.table.core.windows.net" }), /primary Azure/);
});

test("the actual Azure SDK wire batch retains the root fence and stays below measured property/transaction limits", async () => {
  const { TableClient } = await import("@azure/data-tables");
  let captured;
  const endpoint = "https://fixtureaccount.table.core.windows.net";
  const client = new TableClient(endpoint, "state", {
    async getToken() { return { token: "synthetic-fixture-token", expiresOnTimestamp: Date.now() + 3_600_000 }; }
  }, {
    retryOptions: { maxRetries: 0 },
    httpClient: { async sendRequest(request) {
      captured = request;
      throw new Error("SYNTHETIC_TRANSPORT_CAPTURE");
    } }
  });
  const adapter = await createTableAdapter({ TABLES_ENDPOINT: endpoint, TABLES_CLIENT_ID: crypto.randomUUID() }, { client });
  const files = fixtureFiles(), dataset = crypto.randomUUID();
  files.set("archive.bin", Buffer.alloc(600_000, 255));
  const documents = encodeFiles(files, dataset);
  const operations = [...documents].map(([id, resourceBody]) => ({ operationType: "Create", id, resourceBody }));
  operations.push({ operationType: "Replace", id: "active", ifMatch: "expected-etag",
    resourceBody: { id: "active", scope: SCOPE, dataset } });
  assert.equal(batches(operations).length, 1);
  await assert.rejects(adapter.batch(operations), /SYNTHETIC_TRANSPORT_CAPTURE/);
  assert.match(captured.body, /if-match: expected-etag/i);
  assert.ok(Buffer.byteLength(captured.body) < 1_500_000);
  const entities = captured.body.split(/\r?\n/).filter((line) => line.startsWith("{")).map((line) => JSON.parse(line));
  assert.equal(entities.length, operations.length);
  for (const entity of entities) {
    assert.equal(entity.PartitionKey, "game");
    assert.ok(Buffer.byteLength(entity.payload, "utf16le") <= 60 * 1024);
  }
});

test("escaped asynchronous work cannot mutate a closed transaction draft", async (t) => {
  const { engine } = await setup(t);
  let deferred;
  await engine.run(() => {
    deferred = new Promise((resolve) => setImmediate(() => {
      assert.throws(() => engine.write("pending-rewards.json", "{}"), /asynchronous transaction/);
      resolve();
    }));
  });
  await deferred;
});

test("local transaction journals recover atomically before profiles are loaded; corrupt journals fail closed", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deadlight-journal-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const files = fixtureFiles();
  for (const [name, content] of files) fs.writeFileSync(path.join(directory, name), content);
  const players = JSON.parse(files.get("players.json"));
  players[firstId].tokens = 777;
  const writes = [["players.json", JSON.stringify(players)], ["reward-receipts.json", "{}"]];
  const journal = { schema: 1, files: writes,
    digest: crypto.createHash("sha256").update(JSON.stringify(writes)).digest("hex") };
  fs.writeFileSync(path.join(directory, ".transaction.json"), JSON.stringify(journal), { mode: 0o600 });
  const environment = { ...process.env, DATA_DIR: directory, PERSISTENCE_BACKEND: "file", TABLES_ENDPOINT: "", COSMOS_ENDPOINT: "" };
  const recovered = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import {getProfile} from "./server/store.js";
    if (getProfile(${JSON.stringify(firstId)}).tokens !== 777) process.exit(2);
  `], { env: environment, encoding: "utf8" });
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal(fs.existsSync(path.join(directory, ".transaction.json")), false);
  fs.writeFileSync(path.join(directory, ".transaction.json"), '{"schema":1,"files":[],"digest":"bad"}');
  const invalid = spawnSync(process.execPath, ["--input-type=module", "-e", 'import "./server/store.js";'],
    { env: environment, encoding: "utf8" });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Persistence startup unavailable/);
  fs.writeFileSync(path.join(directory, ".transaction.json"), '{"private":"SYNTHETIC_PRIVATE_SENTINEL",bad}');
  const malformed = spawnSync(process.execPath, ["--input-type=module", "-e", 'import "./server/store.js";'],
    { env: environment, encoding: "utf8" });
  assert.notEqual(malformed.status, 0);
  assert.match(malformed.stderr, /Persistence startup unavailable/);
  assert.doesNotMatch(malformed.stderr, /SYNTHETIC_PRIVATE_SENTINEL/);
});

test("real Socket.IO command ACKs/profile effects wait for fake remote commits and staff failures retain codes", { timeout: 20_000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deadlight-durable-sockets-"));
  const listener = net.createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const script = `
    import assert from "node:assert/strict";
    import {DurableState,usePersistence,SCOPE} from "./server/persistence.js";
    import {importBundle,makeBundle,validateSnapshotSemantics} from "./server/snapshots.js";
    import {tableEntity} from "./server/tables.js";
    const adapter = new (${FakeTable.toString()})();
    const imported = await importBundle(adapter,makeBundle(new Map(${JSON.stringify([...fixtureFiles()])}),${JSON.stringify(identity)}));
    usePersistence(await new DurableState(adapter,imported.dataset,validateSnapshotSemantics).initialize());
    let release;
    process.on("message", (input) => {
      if (input === "hold") adapter.gate = new Promise(resolve => { release = resolve; });
      if (input === "release") { adapter.gate = null; release(); }
      if (input === "fail") adapter.failBatch = adapter.calls + 1;
      if (input === "unavailable") adapter.rows.delete("active");
      process.send({ack:input});
    });
    await import("./server/index.js");
    process.send({ready:true});
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    cwd: path.resolve("."), stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), DATA_DIR: directory,
      PERSISTENCE_BACKEND: "file", TABLES_ENDPOINT: "", COSMOS_ENDPOINT: "", IDENTITY_SECRET: "",
      STAFF_ACCESS_SEED: "", ADMIN_SIGN_IN: "code", ADMIN_PLAYER_IDS: "" }
  });
  let errors = "";
  child.stderr.on("data", (chunk) => { errors += chunk; });
  t.after(async () => {
    child.kill("SIGTERM");
    await once(child, "exit");
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await Promise.race([new Promise((resolve) => child.on("message", (message) => { if (message.ready) resolve(); })),
    once(child, "exit").then(() => assert.fail(`Fixture exited: ${errors}`))]);
  const command = async (input) => {
    const response = new Promise((resolve) => {
      const receive = (message) => { if (message.ack === input) { child.off("message", receive); resolve(); } };
      child.on("message", receive);
    });
    child.send(input);
    await response;
  };
  const payload = Buffer.from(JSON.stringify({ playerId: firstId })).toString("base64url");
  const token = `${payload}.${crypto.createHmac("sha256", signing).update(payload).digest("base64url")}`;
  const socket = io(`http://127.0.0.1:${port}`, { transports: ["websocket"], auth: { token }, reconnection: false });
  t.after(() => socket.close());
  const [initial] = await once(socket, "identity");
  assert.equal(initial.profile.tokens, 240);
  const request = (event, input) => new Promise((resolve, reject) => {
    socket.timeout(5000).emit(event, input, (error, value) => error ? reject(error) : resolve(value));
  });
  await command("hold");
  let acknowledged = false, profiles = 0;
  socket.on("profile", () => { profiles++; });
  const purchase = request("buySkin", "nightwatch").then((value) => { acknowledged = true; return value; });
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(acknowledged, false);
  assert.equal(profiles, 0);
  await command("release");
  assert.equal((await purchase).profile.tokens, 120);
  await command("fail");
  assert.equal((await request("adminSignIn", { code: "654321" })).ok, false);
  assert.equal((await request("adminSignIn", { code: "654321" })).admin, true);
  assert.equal((await request("adminSignIn", { code: "654321" })).ok, false);
  await command("unavailable");
  assert.equal((await request("equipSkin", "nightwatch")).ok, false);
  const health = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(health.status, 503);
});
