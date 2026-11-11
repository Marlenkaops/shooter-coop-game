import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function runIn(dataDir, code) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    cwd: path.resolve("."),
    env: { ...process.env, DATA_DIR: dataDir, IDENTITY_SECRET: "" },
    encoding: "utf8"
  });
}

test("global rankings page all saved players, protect private data and survive restart", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "last-light-ranking-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const players = Object.fromEntries(Array.from({ length: 45 }, (_, index) => {
    const id = `operator-${String(index).padStart(3, "0")}-private-id`;
    return [id, { id, username: `Ranger ${String(index).padStart(3, "0")}`, xp: (45 - index) * 100,
      totalKills: index, matches: 1, tokens: 123, privateField: "do-not-share" }];
  }));
  players.visitor = { id: "visitor", xp: 0 };
  fs.writeFileSync(path.join(directory, "players.json"), JSON.stringify(players));
  const code = `
    import assert from "node:assert/strict";
    import { readLeaderboard, getProfile, storageStatus } from "./server/store.js";
    const identity = "operator-044-private-id";
    const first = readLeaderboard(identity);
    assert.equal(first.total, 45);
    assert.equal(first.entries.length, 20);
    assert.equal(first.nextOffset, 20);
    assert.equal(first.self.rank, 45);
    assert.equal(first.entries[0].xp, 4500);
    assert.equal(first.entries[0].self, false);
    const kills = readLeaderboard(identity, {sort:"kills", offset:20});
    assert.equal(kills.entries[0].totalKills, 24);
    assert.equal(kills.entries[0].rank, 21);
    assert.equal(kills.self.rank, 1);
    const last = readLeaderboard(identity, {offset:40});
    assert.equal(last.entries.length, 5);
    assert.equal(last.nextOffset, null);
    assert.equal(readLeaderboard(identity, {offset:900}).offset, 40);
    assert.equal(readLeaderboard("visitor").self, null);
    assert.equal(readLeaderboard("missing").self, null);
    assert.equal(storageStatus().profiles, 46, "reading does not create a profile");
    assert.deepEqual(Object.keys(first.entries[0]).sort(),
      ["rank","username","playerTag","level","xp","totalKills","matches","self"].sort());
    assert.ok(!JSON.stringify(first).includes("private-id"));
    assert.ok(!JSON.stringify(first).includes("do-not-share"));
    for (const request of [{sort:"tokens"},{offset:-1},{offset:0.5},{offset:Infinity}]) {
      assert.equal(readLeaderboard(identity,request).ok,false);
    }
    console.log(JSON.stringify(first));
  `;
  const first = runIn(directory, code);
  assert.equal(first.status, 0, first.stderr);
  const restarted = runIn(directory, code);
  assert.equal(restarted.status, 0, restarted.stderr);
  assert.deepEqual(JSON.parse(restarted.stdout), JSON.parse(first.stdout));
});

test("leaderboard ordering is deterministic and refreshes only after successful profile saves", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "last-light-ranking-save-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const result = runIn(directory, `
    import assert from "node:assert/strict";
    import fs from "node:fs"; import path from "node:path";
    import { getProfile, rewardPlayer, readLeaderboard, adminSetProgression, updateUsername } from "./server/store.js";
    for (const id of ["cccccccc", "bbbbbbbb", "aaaaaaaa"]) rewardPlayer(id, 100, 3);
    assert.deepEqual(readLeaderboard("aaaaaaaa").entries.map(p=>p.playerTag), ["aaaaaaaa","bbbbbbbb","cccccccc"]);
    updateUsername("cccccccc", "Alpha");
    assert.equal(readLeaderboard("cccccccc").self.rank, 1);
    rewardPlayer("bbbbbbbb", 0, 1);
    assert.equal(readLeaderboard("bbbbbbbb").self.rank, 1, "XP ties use eliminations");
    assert.equal(readLeaderboard("bbbbbbbb",{sort:"kills"}).self.rank, 1);
    const before = readLeaderboard("aaaaaaaa");
    fs.mkdirSync(path.join(process.env.DATA_DIR, "players.json.next"));
    assert.throws(()=>rewardPlayer("aaaaaaaa", 10000, 100));
    assert.deepEqual(readLeaderboard("aaaaaaaa"), before, "failed save must not publish new stats");
    fs.rmdirSync(path.join(process.env.DATA_DIR, "players.json.next"));
    rewardPlayer("aaaaaaaa", 200, 10);
    assert.equal(readLeaderboard("aaaaaaaa").self.rank, 1);
    assert.equal(readLeaderboard("aaaaaaaa",{sort:"kills"}).self.rank, 1);
    adminSetProgression("cccccccc","setLevel",10);
    assert.equal(readLeaderboard("cccccccc").self.rank, 1, "XP uses saved progression including admin changes");
    assert.equal(readLeaderboard("aaaaaaaa",{sort:"kills"}).self.rank, 1);
    console.log("PASS");
  `);
  assert.equal(result.status, 0, result.stderr);
});

test("season rankings roll over their cached view without resetting lifetime scores or archived rewards", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deadlight-season-ranking-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const first = runIn(directory, `
    import assert from "node:assert/strict";
    import fs from "node:fs"; import path from "node:path";
    import { newCareer, seasonAt, claimOffer } from "./shared/career.js";
    let now = Date.UTC(2026, 10, 8, 12);
    Date.now = () => now;
    const current = seasonAt(), old = "s0";
    const players = Object.fromEntries(["alpha", "bravo", "retired"].map((id, index) => {
      const career = newCareer();
      career.seasons[old] = { xp: 50000, claimed: [] };
      if (id !== "retired") career.seasons[current.id] = { xp: 1000 + index * 1000, claimed: [] };
      return [id, { id, username: id, xp: 10000 - index * 1000, matches: 10, totalKills: 50, career }];
    }));
    fs.writeFileSync(path.join(process.env.DATA_DIR, "players.json"), JSON.stringify(players));
    const { readLeaderboard, getProfile, rewardPlayer } = await import("./server/store.js");
    const lifetime = readLeaderboard("alpha");
    const seasonal = readLeaderboard("alpha", { sort: "season" });
    assert.equal(seasonal.season, current.id);
    assert.equal(seasonal.total, 2, "past-season-only profiles are not ranked in the current season");
    assert.deepEqual(seasonal.entries.map(p => p.username), ["bravo", "alpha"]);
    assert.equal(seasonal.self.seasonXp, 1000);
    assert.deepEqual(Object.keys(seasonal.entries[0]).sort(),
      ["rank","username","playerTag","level","xp","totalKills","matches","self","seasonXp"].sort());
    now = current.endsAt;
    const reset = readLeaderboard("alpha", { sort: "season" });
    assert.notEqual(reset.season, current.id);
    assert.equal(reset.total, 0, "a season boundary invalidates the cached ranking even without a profile write");
    assert.equal(reset.self, null);
    assert.deepEqual(readLeaderboard("alpha"), lifetime);
    assert.deepEqual(claimOffer(getProfile("alpha"), { type: "season", key: "4", period: old }, now), { xp: 0, tokens: 80 });
    const progression = JSON.stringify({ classId: "assault", weaponXp: { rifle: 40 }, shots: 2, hits: 2,
      damage: 40, at: now, difficulty: "standard", mutators: [], mode: "campaign", activeMs: 10000 });
    rewardPlayer("alpha", 100, 2, 1, false, "foundry", 10, { progression });
    const next = readLeaderboard("alpha", { sort: "season" });
    assert.equal(next.self.rank, 1);
    assert.equal(next.self.seasonXp, 100);
    assert.equal(getProfile("alpha").career.seasons[current.id].xp, 1000);
    assert.equal(getProfile("alpha").career.seasons[old].xp, 50000);
    console.log(JSON.stringify(getProfile("alpha")));
  `);
  assert.equal(first.status, 0, first.stderr);
  const restarted = runIn(directory, `import {getProfile} from "./server/store.js"; console.log(JSON.stringify(getProfile("alpha")));`);
  assert.equal(restarted.status, 0, restarted.stderr);
  assert.deepEqual(JSON.parse(restarted.stdout), JSON.parse(first.stdout));
});

test("invalid saved leaderboard statistics fail visibly instead of publishing fake scores", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "last-light-ranking-invalid-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, "players.json"), JSON.stringify({ invalid: { id: "invalid", xp: 50, totalKills: -1 } }));
  const result = runIn(directory, `
    import assert from "node:assert/strict";
    import {readLeaderboard} from "./server/store.js";
    assert.throws(()=>readLeaderboard("invalid"), /Invalid saved leaderboard statistics/);
  `);
  assert.equal(result.status, 0, result.stderr);
});

test("outfits and immediate NPC credits migrate legacy records and persist without duplicate purchases", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "last-light-skins-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dataDir, "players.json"), JSON.stringify({ veteran: { id: "veteran", xp: 800 } }));
  const result = runIn(dataDir, `
    import assert from "node:assert/strict";
    import { getProfile, creditNpcTokens, buySkin, equipSkin, rewardPlayer } from "./server/store.js";
    const old = getProfile("veteran");
    assert.deepEqual(old.ownedSkins, ["standard"]); assert.equal(old.equippedSkinId, "standard");
    assert.equal(buySkin("veteran", "nightwatch").ok, false);
    assert.equal(equipSkin("veteran", "nightwatch").ok, false);
    assert.equal(buySkin("veteran", "__proto__").ok, false);
    assert.throws(() => creditNpcTokens("veteran", -1));
    assert.throws(() => creditNpcTokens("veteran", 1.5));
    const credited = creditNpcTokens("veteran", 120);
    assert.equal(credited.xp, 800); assert.equal(credited.matches, undefined);
    assert.equal(buySkin("veteran", "nightwatch").profile.tokens, 0);
    assert.equal(buySkin("veteran", "nightwatch").ok, false);
    assert.equal(equipSkin("veteran", "nightwatch").ok, true);
    rewardPlayer("veteran", 100, 20, 5, true, null, 135);
    console.log(JSON.stringify(getProfile("veteran")));
  `);
  assert.equal(result.status, 0, result.stderr);
  const profile = JSON.parse(result.stdout);
  assert.equal(profile.tokens, 135);
  assert.equal(profile.totalKills, 20);
  assert.equal(profile.equippedSkinId, "nightwatch");
  assert.deepEqual(profile.ownedSkins, ["standard", "nightwatch"]);
  const restarted = runIn(dataDir, `import {getProfile} from "./server/store.js"; console.log(JSON.stringify(getProfile("veteran")));`);
  assert.equal(restarted.status, 0, restarted.stderr);
  assert.deepEqual(JSON.parse(restarted.stdout), profile);
  assert.equal(fs.statSync(path.join(dataDir, "players.json")).mode & 0o777, 0o600);
});

test("failed outfit purchases, equips and NPC token writes roll back the entire profile", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "last-light-skin-rollback-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const result = runIn(dataDir, `
    import assert from "node:assert/strict"; import fs from "node:fs"; import path from "node:path";
    import { getProfile, creditNpcTokens, buySkin, equipSkin } from "./server/store.js";
    getProfile("fixture"); creditNpcTokens("fixture", 1000); buySkin("fixture", "nightwatch");
    const before = getProfile("fixture");
    fs.mkdirSync(path.join(process.env.DATA_DIR, "players.json.next"));
    for (const mutation of [() => buySkin("fixture", "glacier"), () => equipSkin("fixture", "nightwatch"),
      () => creditNpcTokens("fixture", 6)]) { assert.throws(mutation); assert.deepEqual(getProfile("fixture"), before); }
    fs.rmdirSync(path.join(process.env.DATA_DIR, "players.json.next"));
    assert.equal(buySkin("fixture", "glacier").profile.tokens, 520);
    assert.equal(equipSkin("fixture", "glacier").ok, true);
    console.log(JSON.stringify(getProfile("fixture")));
  `);
  assert.equal(result.status, 0, result.stderr);
  const profile = JSON.parse(result.stdout);
  assert.equal(profile.tokens, 520);
  assert.equal(profile.equippedSkinId, "glacier");
});

test("player rewards and signed identities survive a process restart on a mounted data directory", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "last-light-data-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  const first = runIn(dataDir, `
    import { issueToken } from "./server/auth.js";
    import { rewardPlayer } from "./server/store.js";
    rewardPlayer("player-123", 1000, 3);
    console.log(issueToken("player-123"));
  `);
  assert.equal(first.status, 0, first.stderr);
  const token = first.stdout.trim();

  const restarted = runIn(dataDir, `
    import { verifyToken } from "./server/auth.js";
    import { getProfile } from "./server/store.js";
    console.log(JSON.stringify({ id: verifyToken(${JSON.stringify(token)}), profile: getProfile("player-123") }));
  `);
  assert.equal(restarted.status, 0, restarted.stderr);
  const result = JSON.parse(restarted.stdout);
  assert.equal(result.id, "player-123");
  assert.equal(result.profile.xp, 1000);
  assert.equal(result.profile.totalKills, 3);
  assert.deepEqual(result.profile.unlockedMaps, ["foundry", "tundra", "harbor", "outpost", "airfield", "spillway"]);
  assert.ok(fs.existsSync(path.join(dataDir, "players.json")));
  assert.ok(fs.existsSync(path.join(dataDir, "identity-secret")));
});

test("usernames persist with operator IDs, reject duplicates and invalid input", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "last-light-names-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const initial = runIn(dataDir, `
    import { getProfile, updateUsername } from "./server/store.js";
    console.log(JSON.stringify({
      first: getProfile("player-123").username,
      second: getProfile("player-456").username,
      updated: updateUsername("player-123", "  Alpha  One  "),
      duplicate: updateUsername("player-456", "alpha one"),
      invalid: updateUsername("player-456", "<script>"),
      unchanged: getProfile("player-456").username
    }));
  `);
  assert.equal(initial.status, 0, initial.stderr);
  const result = JSON.parse(initial.stdout);
  assert.notEqual(result.first, result.second);
  assert.equal(result.updated.profile.username, "Alpha One");
  assert.match(result.duplicate.error, /already in use/);
  assert.match(result.invalid.error, /Username must/);
  assert.equal(result.unchanged, result.second);
  const restarted = runIn(dataDir, `
    import { getProfile } from "./server/store.js";
    console.log(JSON.stringify(getProfile("player-123")));
  `);
  assert.equal(restarted.status, 0, restarted.stderr);
  assert.equal(JSON.parse(restarted.stdout).username, "Alpha One");
});

test("new loot and previous progression survive restart; failed mutations roll back without corrupting backups", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "last-light-loot-save-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const setup = runIn(dataDir, `
    import fs from "node:fs"; import path from "node:path";
    import { getProfile, grantWeapon, rewardPlayer, updateUsername, equipWeapon, adminSetProgression } from "./server/store.js";
    getProfile("fixture");
    rewardPlayer("fixture", 2200, 9, 5, true, "foundry");
    grantWeapon("fixture", "heavyPistol", true);
    const before = getProfile("fixture");
    fs.mkdirSync(path.join(process.env.DATA_DIR, "players.json.next"));
    const failures = [];
    for (const mutation of [
      () => rewardPlayer("fixture", 100, 3),
      () => updateUsername("fixture", "ChangedName"),
      () => equipWeapon("fixture", "rifle"),
      () => grantWeapon("fixture", "pistol", true),
      () => adminSetProgression("fixture", "setLevel", 1)
    ]) { try { mutation(); } catch (error) { failures.push(error.code); } }
    console.log(JSON.stringify({ before, after: getProfile("fixture"), failures }));
  `);
  assert.equal(setup.status, 0, setup.stderr);
  const result = JSON.parse(setup.stdout);
  assert.equal(result.failures.length, 5);
  assert.deepEqual(result.after, result.before);
  const persisted = runIn(dataDir, `import { getProfile } from "./server/store.js"; console.log(JSON.stringify(getProfile("fixture")));`);
  assert.equal(persisted.status, 0, persisted.stderr);
  assert.deepEqual(JSON.parse(persisted.stdout), result.before);
  assert.equal(result.before.equippedWeaponId, "heavyPistol");
  assert.equal(result.before.xp, 2200);
  assert.equal(result.before.totalKills, 9);
  const backup = JSON.parse(fs.readFileSync(path.join(dataDir, "players.backup.json")));
  assert.equal(backup.fixture.xp, 2200);
});

test("corrupt persistent player data fails visibly instead of resetting progression", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "last-light-corrupt-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const file = path.join(dataDir, "players.json");
  fs.writeFileSync(file, "{broken");

  const result = runIn(dataDir, 'import "./server/store.js";');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /SyntaxError/);
  assert.equal(fs.readFileSync(file, "utf8"), "{broken");
});

test("legacy profiles acquire a free rifle; tokens, purchases and loadout persist across restarts", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "last-light-armory-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dataDir, "players.json"),
    JSON.stringify({ veteran: { id: "veteran", xp: 800, matches: 2, totalKills: 7 } }));

  const purchase = runIn(dataDir, `
    import { buyWeapon, equipWeapon, getProfile, rewardPlayer } from "./server/store.js";
    console.log(JSON.stringify({
      legacy: getProfile("veteran"),
      denied: buyWeapon("veteran", "smg"),
      award: rewardPlayer("veteran", 100, 5, 5, true),
      invalid: buyWeapon("veteran", "__proto__"),
      smg: buyWeapon("veteran", "smg"),
      repeat: buyWeapon("veteran", "smg"),
      unowned: equipWeapon("veteran", "marksman"),
      equipped: equipWeapon("veteran", "smg")
    }));
  `);
  assert.equal(purchase.status, 0, purchase.stderr);
  const result = JSON.parse(purchase.stdout);
  assert.equal(result.legacy.tokens, 0);
  assert.deepEqual(result.legacy.ownedWeapons, ["rifle"]);
  assert.equal(result.denied.ok, false);
  assert.equal(result.award.tokens, 165);
  assert.equal(result.invalid.ok, false);
  assert.equal(result.smg.profile.tokens, 45);
  assert.equal(result.repeat.ok, false);
  assert.equal(result.unowned.ok, false);
  assert.equal(result.equipped.profile.equippedWeaponId, "smg");

  const restarted = runIn(dataDir, `
    import { getProfile } from "./server/store.js";
    console.log(JSON.stringify(getProfile("veteran")));
  `);
  assert.equal(restarted.status, 0, restarted.stderr);
  const profile = JSON.parse(restarted.stdout);
  assert.equal(profile.tokens, 45);
  assert.equal(profile.xp, 900);
  assert.deepEqual(profile.ownedWeapons, ["rifle", "smg"]);
  assert.equal(profile.equippedWeaponId, "smg");
});

test("sniper is earned only by ordered campaign victories and persists on restart", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "last-light-campaign-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const first = runIn(dataDir, `
    import { buyWeapon, equipWeapon, getProfile, rewardPlayer } from "./server/store.js";
    const start = getProfile("player");
    const rejected = buyWeapon("player", "sniper");
    const skipped = rewardPlayer("player", 2000, 0, 5, true, "tundra");
    const foundry = rewardPlayer("player", 100, 0, 5, true, "foundry");
    const failed = rewardPlayer("player", 100, 0, 5, false, "tundra");
    const tundra = rewardPlayer("player", 100, 0, 5, true, "tundra");
    const equipped = equipWeapon("player", "sniper");
    console.log(JSON.stringify({ start, rejected, skipped, foundry, failed, tundra, equipped }));
  `);
  assert.equal(first.status, 0, first.stderr);
  const result = JSON.parse(first.stdout);
  assert.equal(result.rejected.ok, false);
  assert.deepEqual(result.skipped.campaignCompleted, []);
  assert.deepEqual(result.foundry.campaignCompleted, ["foundry"]);
  assert.deepEqual(result.failed.campaignCompleted, ["foundry"]);
  assert.equal(result.failed.ownedWeapons.includes("sniper"), false);
  assert.deepEqual(result.tundra.campaignCompleted, ["foundry", "tundra"]);
  assert.equal(result.tundra.ownedWeapons.includes("sniper"), true);
  assert.equal(result.equipped.ok, true);
  const restarted = runIn(dataDir, `
    import { getProfile } from "./server/store.js";
    console.log(JSON.stringify(getProfile("player")));
  `);
  assert.equal(restarted.status, 0, restarted.stderr);
  assert.equal(JSON.parse(restarted.stdout).equippedWeaponId, "sniper");
});

test("new weapons persist and side-operation victories do not alter campaign credit", (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "last-light-side-armory-"));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const purchase = runIn(dataDir, `
    import { buyWeapon, equipWeapon, getProfile, rewardPlayer } from "./server/store.js";
    rewardPlayer("player", 600, 100, 5, true, "harbor");
    const shotgun = buyWeapon("player", "shotgun");
    const lmg = buyWeapon("player", "lmg");
    const equipped = equipWeapon("player", "lmg");
    console.log(JSON.stringify({ shotgun, lmg, equipped, profile: getProfile("player") }));
  `);
  assert.equal(purchase.status, 0, purchase.stderr);
  const result = JSON.parse(purchase.stdout);
  assert.equal(result.shotgun.ok, true);
  assert.equal(result.lmg.ok, true);
  assert.equal(result.equipped.ok, true);
  assert.deepEqual(result.profile.campaignCompleted, []);
  assert.equal(result.profile.tokens, 235);
  const restarted = runIn(dataDir, `
    import { getProfile } from "./server/store.js";
    console.log(JSON.stringify(getProfile("player")));
  `);
  assert.equal(restarted.status, 0, restarted.stderr);
  const profile = JSON.parse(restarted.stdout);
  assert.deepEqual(profile.ownedWeapons, ["rifle", "shotgun", "lmg"]);
  assert.equal(profile.equippedWeaponId, "lmg");
  assert.equal(profile.unlockedMaps.includes("outpost"), true);
});

test("only explicitly allowlisted signed identities receive admin access", () => {
  const id = crypto.randomUUID();
  const code = `import { isAdmin } from "./server/admin.js";
    console.log(JSON.stringify([isAdmin(${JSON.stringify(id)}), isAdmin("stranger")]));`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    cwd: path.resolve("."), encoding: "utf8",
    env: { ...process.env, ADMIN_PLAYER_IDS: `invalid,${id}` }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [true, false]);
});
