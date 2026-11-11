import test from "node:test";
import assert from "node:assert/strict";
import { ACHIEVEMENTS, applyClaim, applyMatchProgress, ATTACHMENTS, careerFor, CHALLENGES,
  claimOffer, classLevelXp, effectiveWeapon, endgameAllowed, equippedKit, masteryLevel, newCareer,
  parseMatchProgress, periodFor, perkUnlocked, prestigeRequired, seasonAt, SEASON_DAYS, validCareer,
  validMatchProgress, validMutators, weaponLevelXp } from "../shared/career.js";
import { addPlayer, createRoom, publicState, reload, shoot, startMatch, tickRoom, useAmmoSupply, useMedkit } from "../server/game.js";
import { activateClassAbility, tickTeamwork } from "../server/teamwork.js";
import { applyCombatLoadout } from "../server/combat-loadout.js";
import { createCommandGuard } from "../server/anti-cheat.js";
import { validReward } from "../server/reward-records.js";
import { AI_DIFFICULTIES } from "../shared/enemy-ai.js";
import { WEAPONS } from "../shared/weapons.js";
import { createWeaponModel } from "../src/weapon-model.js";
import { careerMarkup } from "../src/career-ui.js";
import { createRecoilState, kickRecoil } from "../src/weapon-feedback.js";

const now = Date.UTC(2026, 10, 8, 12);
const profile = (career = newCareer()) => ({ id: "operator", username: "Fixture", xp: 10000, level: 21, classId: "assault",
  equippedWeaponId: "rifle", ownedWeapons: ["rifle"], totalRevives: 0, totalObjectiveScore: 0, career });
function reward(options = {}) {
  return { id: "11111111-1111-4111-8111-111111111111", identity: "operator", kind: "match",
    xp: 1000, tokens: 10, kills: 12, won: true, wave: 5, mapId: "foundry",
    progression: JSON.stringify({ classId: "assault", weaponXp: { rifle: 240 }, shots: 30, hits: 20, damage: 720,
      at: now, difficulty: "standard", mutators: [], mode: "campaign", activeMs: 120000 }), ...options };
}
function roomWith(kit = {}, mutators = []) {
  const c = newCareer();
  c.weaponXp.rifle = weaponLevelXp(10);
  c.classXp.assault = classLevelXp(3);
  c.perkId = kit.perkId || "none";
  c.loadouts.rifle = { attachmentId: kit.attachmentId || "none", finishId: "copper" };
  const room = createRoom("CAREER", "foundry", "campaign", "nightmare", mutators);
  const player = addPlayer(room, { id: "one" }, "private-id", profile(c), "Fixture");
  assert.equal(startMatch(room, now), true);
  room.enemies.clear();
  player.protectedUntil = 0;
  return { room, player };
}

test("legacy profiles gain empty mastery without modifying original XP, collections or counters", () => {
  const legacy = { xp: 2500, ownedWeapons: ["rifle"], tokens: 70 };
  assert.equal(validCareer(legacy), true);
  assert.deepEqual(careerFor(legacy), newCareer());
  assert.equal(Object.hasOwn(legacy, "career"), false);
  assert.equal(legacy.xp, 2500);
});
test("first weapon unlock requires exactly two confirmed kills; long mastery thresholds remain monotonic", () => {
  assert.equal(masteryLevel(39), 1);
  assert.equal(masteryLevel(40), 2);
  assert.equal(ATTACHMENTS.grip.level, 2);
  for (const kind of ["weapon", "class"]) {
    const threshold = kind === "weapon" ? weaponLevelXp : classLevelXp;
    for (let rank = 2; rank <= (kind === "weapon" ? 25 : 20); rank++) {
      assert.equal(masteryLevel(threshold(rank) - 1, kind), rank - 1);
      assert.equal(masteryLevel(threshold(rank), kind), rank);
    }
  }
  assert.equal(weaponLevelXp(25), 42360);
  assert.equal(classLevelXp(20), 28500);
  assert.ok(prestigeRequired(4) > prestigeRequired(3));
});
test("server match evidence advances the deployed class, actual used weapons, challenges and season only once per application", () => {
  const p = profile(), r = reward();
  const c = applyMatchProgress(p, r);
  assert.equal(c.weaponXp.rifle, 240);
  assert.equal(c.classXp.assault, 500);
  assert.equal(c.periods[periodFor("daily", now)].kills, 12);
  assert.equal(c.periods[periodFor("weekly", now)].wins, 1);
  assert.equal(c.seasons[seasonAt(now).id].xp, 1000);
  assert.deepEqual(c.achievements, ["firstBlood"]);
  assert.equal(validCareer({ career: c }), true);
  assert.deepEqual(p.career, newCareer(), "pure update does not mutate prior snapshots");
});
test("idle wipes and legacy/FFA rewards do not advance new mastery, contracts, seasons or prestige", () => {
  assert.deepEqual(applyMatchProgress(profile(), reward({ progression: undefined })), newCareer());
  const idle = reward({ kills: 0, won: false });
  assert.deepEqual(applyMatchProgress(profile(), idle), newCareer());
  assert.equal(validMatchProgress({ ...JSON.parse(reward().progression), mode: "ffa" }), false);
  assert.equal(validMatchProgress({ ...JSON.parse(reward().progression), mode: "practice" }), false);
});
test("weapon XP journals cannot invent kills or submit malformed/new private counters", () => {
  assert.equal(validReward(reward()), true);
  assert.equal(validReward(reward({ kills: 0 })), false);
  assert.equal(validReward(reward({ progression: "{}" })), false);
  assert.throws(() => parseMatchProgress(JSON.stringify({ ...JSON.parse(reward().progression), shots: -1 })));
  assert.equal(validMatchProgress({ ...JSON.parse(reward().progression), hits: 100 }), false);
});
test("daily and weekly UTC boundaries roll forward independently, without deleting prior periods", () => {
  const sunday = Date.UTC(2026, 10, 8, 23, 59, 59, 999), monday = sunday + 1;
  assert.notEqual(periodFor("daily", sunday), periodFor("daily", monday));
  assert.notEqual(periodFor("weekly", sunday), periodFor("weekly", monday));
  const c = applyMatchProgress(profile(), reward());
  const p = profile(c), request = { type: "challenge", key: "daily-kills", period: periodFor("daily", now) };
  assert.deepEqual(claimOffer(p, request, now), { xp: 150, tokens: 30 });
  assert.equal(claimOffer(p, request, now + 86400000), null);
  const claimed = applyClaim(p, { ...request, claimType: request.type, claimKey: request.key, claimPeriod: request.period, at: now, xp: 150, tokens: 30 });
  assert.equal(claimOffer(profile(claimed), request, now), null);
  assert.equal(claimed.periods[request.period].kills, 12);
});
test("all six challenge rewards require their stored authoritative target and exact catalog grant", () => {
  for (const [key, challenge] of Object.entries(CHALLENGES)) {
    const c = newCareer(), period = periodFor(challenge.cadence, now);
    c.periods[period] = { kills: 0, team: 0, wins: 0, claimed: [] };
    const request = { type: "challenge", key, period };
    c.periods[period][challenge.metric] = challenge.target - 1;
    assert.equal(claimOffer(profile(c), request, now), null);
    c.periods[period][challenge.metric]++;
    const grant = { claimType: "challenge", claimKey: key, claimPeriod: period, at: now, xp: challenge.xp, tokens: challenge.tokens };
    assert.throws(() => applyClaim(profile(c), { ...grant, xp: 9999 }));
    assert.ok(applyClaim(profile(c), grant).periods[period].claimed.includes(key));
  }
});
test("multi-year contract rotation stays bounded without resetting lifetime mastery, seasons or prestige", () => {
  let c = newCareer();
  for (let day = 0; day < 730; day++) c = applyMatchProgress(profile(c),
    reward({ progression: JSON.stringify({ ...JSON.parse(reward().progression), at: now + day * 86400000 }) }));
  assert.ok(Object.keys(c.periods).length <= 16);
  assert.equal(c.pveKills, 12 * 730);
  assert.equal(c.prestigeXp, 1000 * 730);
  assert.equal(c.weaponXp.rifle, 240 * 730);
  assert.ok(Object.keys(c.seasons).length >= 26);
  assert.ok(Buffer.byteLength(JSON.stringify(c), "utf16le") < 20000, "career fits within a Table profile property over a multi-year horizon");
});
test("season rollover preserves old track ownership and lifetime state and never transfers old XP into a new season", () => {
  const c = applyMatchProgress(profile(), reward({ xp: 4000 })), current = seasonAt(now);
  const request = { type: "season", key: "4", period: current.id };
  const claimed = applyClaim(profile(c), { claimType: "season", claimKey: "4", claimPeriod: current.id, at: now, xp: 0, tokens: 80 });
  const nextAt = current.endsAt;
  assert.equal(nextAt - current.startsAt, SEASON_DAYS * 86400000);
  assert.notEqual(seasonAt(nextAt).id, current.id);
  assert.equal(claimed.seasons[seasonAt(nextAt).id], undefined);
  assert.equal(claimOffer(profile(claimed), request, nextAt), null);
  claimed.loadouts.rifle = { attachmentId: "none", finishId: "aurora" };
  assert.equal(validCareer({ career: claimed }), true);
  assert.deepEqual(equippedKit(profile(claimed), "rifle", "assault").finishId, "aurora");
  assert.equal(claimOffer(profile(c), request, nextAt)?.tokens, 80, "earned past-season track remains claimable");
});
test("prestige consumes no lifetime progression or equipment and requires cumulative earned match XP", () => {
  const c = applyMatchProgress(profile(), reward({ xp: 20000 }));
  c.loadouts.rifle = { attachmentId: "grip", finishId: "copper" };
  const grant = { claimType: "prestige", claimKey: "1", claimPeriod: "lifetime", at: now, xp: 0, tokens: 250 };
  const next = applyClaim(profile(c), grant);
  assert.equal(next.prestige, 1);
  assert.equal(next.prestigeXp, 20000);
  assert.deepEqual(next.weaponXp, c.weaponXp);
  assert.deepEqual(next.loadouts, c.loadouts);
  assert.ok(next.achievements.includes("prestige"));
  assert.equal(claimOffer(profile(next), { type: "prestige", key: "2", period: "lifetime" }, now), null);
});
test("achievement badges reflect real lifetime/mastery/difficulty milestones and have no duplicate entries", () => {
  const c = newCareer();
  c.weaponXp.rifle = weaponLevelXp(25);
  c.classXp.assault = classLevelXp(20);
  const p = { ...profile(c), totalRevives: 24, totalObjectiveScore: 9900 };
  const r = reward({ kills: 1000, revives: 1, objectiveScore: 100,
    progression: JSON.stringify({ ...JSON.parse(reward().progression), difficulty: "nightmare" }) });
  const next = applyMatchProgress(p, r);
  for (const key of ["firstBlood", "veteran", "lifesaver", "coordinator", "classMaster", "weaponMaster", "nightmare"]) assert.ok(next.achievements.includes(key));
  assert.equal(new Set(next.achievements).size, next.achievements.length);
  assert.equal(Object.keys(ACHIEVEMENTS).length, 8);
});
test("player and class perks require the right level/class and FFA explicitly disables gameplay bonuses", () => {
  const c = newCareer(), p = { ...profile(c), xp: 0 };
  assert.equal(perkUnlocked(p, "scavenger"), false);
  p.xp = 500;
  assert.equal(perkUnlocked(p, "scavenger"), true);
  c.classXp.assault = classLevelXp(3);
  c.perkId = "loader";
  assert.equal(perkUnlocked(p, "loader", "assault"), true);
  assert.equal(perkUnlocked(p, "loader", "medic"), false);
  assert.equal(equippedKit(p, "rifle", "assault", "ffa").perkId, "none");
});
test("attachments and perks alter authoritative reload timing, recoil prediction, spread and supply caps identically", () => {
  const { room, player } = roomWith({ attachmentId: "quick", perkId: "loader" }, ["scarcity"]);
  const expected = effectiveWeapon("rifle", player);
  assert.equal(expected.reloadMs, Math.round(2100 * .9 * .9));
  assert.equal(player.reserve, 60);
  player.ammo = 0;
  assert.equal(reload(room, player.socketId, now + 100), true);
  assert.equal(player.reloadDuration, expected.reloadMs);
  tickRoom(room, 0, now + 100 + expected.reloadMs);
  assert.equal(player.ammo, 24);
  room.phase = "playing";
  player.reserve = 59;
  const supply = [...room.supplies.values()][0];
  player.position = { ...supply.position, y: supply.position.y + 1 };
  assert.equal(useAmmoSupply(room, player.socketId, supply.id).granted, 1);
  assert.equal(player.reserve, 60);
  const recoil = createRecoilState(), gripRecoil = createRecoilState();
  kickRecoil(recoil, "rifle", 0);
  kickRecoil(gripRecoil, "rifle", 0, 0, .9);
  assert.equal(gripRecoil.pitchVelocity, recoil.pitchVelocity * .9);
  assert.equal(effectiveWeapon("rifle", { attachmentId: "grip" }).spreadMultiplier, .85);
});
test("earned medic and engineer perks change actual healing and station lifetime", () => {
  const { room, player } = roomWith();
  const ally = addPlayer(room, { id: "two" }, "ally", profile(), "Ally");
  player.position = { x: -3, y: 1.57, z: 20 }; ally.position = { ...player.position, x: -2 };
  player.classId = "medic"; player.perkId = "triage"; player.health = 20;
  assert.equal(activateClassAbility(room, player.socketId, now).ok, true);
  assert.equal(player.health, 60);
  player.classId = "engineer"; player.perkId = "station"; player.abilityReadyAt = 0;
  activateClassAbility(room, player.socketId, now);
  assert.equal(room.teamFields[0].expiresAt, now + 15000);
  tickTeamwork(room, 0, now + 14999);
  assert.equal(room.teamFields.length, 1);
});
test("Nightmare and both mutators are validated on creation, eligibility, deployment and real medkit use", () => {
  assert.equal(endgameAllowed({ xp: 4499 }, "nightmare"), false);
  assert.equal(endgameAllowed({ xp: 4500 }, "nightmare"), true);
  assert.equal(endgameAllowed({ xp: 0 }, "standard", ["iron"]), false);
  assert.equal(validMutators(["iron", "iron"]), false);
  assert.equal(validMutators(["damage999"]), false);
  assert.throws(() => createRoom("BAD", "foundry", "ffa", "standard", ["iron"]));
  const { room, player } = roomWith({}, ["iron"]);
  player.health = 50;
  assert.match(useMedkit(room, player.socketId).error, /mutator/);
  assert.equal(player.health, 50);
  assert.ok(AI_DIFFICULTIES.nightmare.peakAttackers > AI_DIFFICULTIES.veteran.peakAttackers);
  assert.ok(AI_DIFFICULTIES.nightmare.recoveryMs < AI_DIFFICULTIES.veteran.recoveryMs);
  assert.equal(publicState(room).players[0].matchProgress, undefined);
  player.profile.xp = 0; room.phase = "ended";
  assert.equal(startMatch(room), false);
});
test("real shots build per-weapon match evidence and a first unlock can settle within the ten-minute balance budget", () => {
  const room = createRoom("NEW", "foundry");
  const player = addPlayer(room, { id: "one" }, "fresh", { ...profile(), xp: 0, career: newCareer() }, "Newcomer");
  startMatch(room, Date.now());
  const enemy = [...room.enemies.values()][0];
  room.enemies.clear();
  for (const id of ["one", "two"]) room.enemies.set(id, { ...enemy, id, health: 20, maxHealth: 20,
    position: { x: player.position.x, y: 1, z: 5 }, speed: 0 });
  for (const at of [now, now + 1000]) assert.equal(shoot(room, "one", { direction: { x: 0, y: -.1, z: -.995 } }, at).killed, true);
  player.deadUntil = Date.now() + 4000;
  const ended = tickRoom(room, 0, Date.now());
  const r = ended.rewards[0], evidence = parseMatchProgress(r.progression);
  assert.ok(evidence.activeMs < 600000);
  assert.equal(masteryLevel(applyMatchProgress(profile(), { ...r, won: false }).weaponXp.rifle), 2);
  assert.equal(evidence.shots, 2);
  assert.equal(evidence.hits, 2);
});
test("career metadata validators reject corrupt current/backup fields instead of silently resetting them", () => {
  for (const c of [null, {}, { ...newCareer(), weaponXp: { rifle: -1 } }, { ...newCareer(), hits: 1 },
    { ...newCareer(), loadouts: { rifle: { attachmentId: "quick", finishId: "standard" } } },
    { ...newCareer(), seasons: { s1: { xp: 0, claimed: [4] } } },
    { ...newCareer(), periods: { d100: { kills: 1, team: 0, wins: 0, claimed: ["weekly-kills"] } } }]) {
    assert.equal(validCareer({ career: c }), false);
    assert.throws(() => careerFor({ career: c }));
  }
});
test("command guard rejects forged progression, XP amounts, unrecognized items and unavailable mode mutators", () => {
  const guard = createCommandGuard();
  for (const packet of [["equipProgression", { kind: "attachment", id: "grip", weaponId: "rifle", xp: 999 }],
    ["claimProgression", { type: "challenge", key: "daily-kills", period: "d123", xp: 999 }],
    ["claimProgression", { type: "season", key: "21", period: "s1" }],
    ["equipProgression", { kind: "perk", id: "owner" }],
    ["createRoom", { mapId: "range", mode: "practice", mutators: ["iron"] }]]) assert.equal(guard.check(packet, false).ok, false);
  assert.equal(guard.check(["equipProgression", { kind: "attachment", id: "grip", weaponId: "rifle" }], false).ok, true);
});
test("all attachment models retain the merged-material draw budget and finishes visibly change the coating", () => {
  const count = (model) => { let value = 0; model.root.traverse((node) => { if (node.isMesh) value++; }); return value; };
  for (const weaponId of Object.keys(WEAPONS)) {
    const standard = createWeaponModel(weaponId, { compact: true });
    for (const attachmentId of ["grip", "quick", "reserve"]) {
      const variant = createWeaponModel(weaponId, { compact: true, attachmentId, finishId: "copper" });
      assert.equal(count(variant), count(standard));
      const colors = (model) => { const result = []; model.root.traverse((node) => { if (node.isMesh) result.push(node.material.color?.getHex()); }); return result; };
      assert.notDeepEqual(colors(variant), colors(standard));
    }
  }
});
test("career UI exposes usable/locked equipment, challenge claims, archived seasons and earned badge names", () => {
  const p = profile(applyMatchProgress(profile(), reward({ xp: 4000 })));
  assert.match(careerMarkup(p), /Control grip/);
  assert.match(careerMarkup(p), /Weapon level 4/);
  assert.match(careerMarkup(p, { tab: "contracts", now }), /data-career-claim="challenge"/);
  assert.match(careerMarkup(p, { tab: "season", now: seasonAt(now).endsAt }), /Aurora finish/);
  assert.match(careerMarkup(p, { tab: "honors" }), /First contact/);
  assert.match(careerMarkup(p, { tab: "honors" }), /Badge earned/);
});
