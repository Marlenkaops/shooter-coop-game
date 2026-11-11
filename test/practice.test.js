import test from "node:test";
import assert from "node:assert/strict";
import { addPlayer, createRoom, practiceWeapon, publicState, reload, shoot, startMatch, tickRoom } from "../server/game.js";
import { createCommandGuard } from "../server/anti-cheat.js";
import { canOccupyPosition, getMapBuildings, hasLineOfSight, mapRayHit } from "../shared/gameplay.js";
import { getMapTerrain } from "../shared/arena-layout.js";
import { RANGE_TARGETS, TARGET_RESET_MS, rangeSpawnPoint } from "../shared/practice.js";
import { WEAPONS } from "../shared/weapons.js";
import { loadoutMarkup } from "../src/loadout.js";

function fixture(weaponId = "rifle") {
  const profile = { xp: 0, level: 1, tokens: 100, matches: 3, totalKills: 7,
    equippedWeaponId: weaponId, ownedWeapons: ["rifle", "shotgun", "sniper"], campaignCompleted: [] };
  const room = createRoom("RANGE", "range", "practice");
  const player = addPlayer(room, { id: "solo" }, "identity", profile, "Solo");
  assert.equal(startMatch(room, 10_000), true);
  return { room, player, profile };
}

function aimedShot(room, player, target, now, zone = "body") {
  const point = { ...target.position, y: target.position.y + (zone === "head" ? .9 : .2) };
  const dx = point.x - player.position.x, dy = point.y - player.position.y, dz = point.z - player.position.z;
  const length = Math.hypot(dx, dy, dz);
  player.yaw = Math.atan2(-dx, -dz);
  player.pitch = Math.asin(dy / length);
  return shoot(room, player.socketId, { direction: { x: dx / length, y: dy / length, z: dz / length } }, now);
}

test("only the range/practice pairing is accepted, including strict temporary weapon packets", () => {
  for (const [mapId, mode, valid] of [["range", "practice", true], ["foundry", "practice", false],
    ["range", "campaign", false], ["range", "blitz", false], ["range", "ffa", false]]) {
    const guard = createCommandGuard();
    assert.equal(guard.check(["createRoom", { mapId, mode }], false).ok, valid);
    if (!valid) assert.throws(() => createRoom("ROOM", mapId, mode), RangeError);
  }
  const guard = createCommandGuard();
  assert.equal(guard.check(["practiceWeapon", "rifle"], false).ok, true);
  for (const input of ["__proto__", "missing", { weaponId: "rifle", owned: true }]) {
    assert.equal(guard.check(["practiceWeapon", input], false).ok, false);
  }
  const { room, player } = fixture();
  room.players.set("second", { ...player, socketId: "second" });
  room.phase = "lobby";
  assert.equal(startMatch(room), false);
});

test("all twelve staggered steel targets have unobstructed firing-lane sightlines and collision-safe spawns", () => {
  assert.equal(RANGE_TARGETS.length, 12);
  assert.deepEqual(getMapTerrain("range"), []);
  assert.deepEqual(getMapBuildings("range"), []);
  for (const target of RANGE_TARGETS) {
    const spawn = rangeSpawnPoint(target.lane - 1);
    assert.equal(canOccupyPosition("range", spawn), true);
    for (const offset of [.2, .9]) {
      const point = { ...target.position, y: target.position.y + offset };
      assert.equal(hasLineOfSight("range", spawn, point), true, target.id);
      const dx = point.x - spawn.x, dy = point.y - spawn.y, dz = point.z - spawn.z;
      const distance = Math.hypot(dx, dy, dz);
      const cover = mapRayHit("range", spawn, { x: dx / distance, y: dy / distance, z: dz / distance }, distance);
      assert.equal(cover, null, target.id);
    }
    const { room, player } = fixture("sniper");
    player.position = spawn;
    const hit = aimedShot(room, player, room.enemies.get(target.id), 12_000);
    assert.equal(hit.enemyId, target.id, `A nearer target hides ${target.id}`);
    assert.equal(hit.hitZone, "body");
  }
});

test("headshots and resetting targets only update session statistics; no loot, attacks or rewards", () => {
  const { room, player, profile } = fixture("sniper");
  const saved = structuredClone(profile);
  const target = [...room.enemies.values()][0];
  const hit = aimedShot(room, player, target, 12_000, "head");
  assert.equal(hit.hitZone, "head");
  assert.equal(hit.killed, true);
  assert.deepEqual(player.practiceStats, { shots: 1, hits: 1, headshots: 1, targets: 1 });
  assert.equal(target.resetAt, 12_000 + TARGET_RESET_MS);
  assert.equal(tickRoom(room, .1, target.resetAt - 1), null);
  assert.equal(target.health, 0);
  assert.equal(aimedShot(room, player, target, target.resetAt - 1).hit, false);
  assert.equal(tickRoom(room, .1, target.resetAt), null);
  assert.equal(target.health, 35);
  assert.equal(target.resetAt, 0);
  for (const now of [30_000, 600_000, 3_600_000]) assert.equal(tickRoom(room, .1, now), null);
  assert.equal(room.phase, "playing");
  assert.equal(player.health, 100);
  assert.equal(player.kills, 0);
  assert.equal(room.loot.size + room.supplies.size + room.pendingNpcTokens.size + room.attackEvents.length, 0);
  assert.deepEqual(profile, saved);
  const state = publicState(room);
  assert.equal(state.players[0].unlimitedAmmo, true);
  assert.deepEqual(state.players[0].practiceStats, player.practiceStats);
  assert.equal(Object.hasOwn(state.players[0], "tokens"), false);
  assert.match(loadoutMarkup(profile, state.players[0]), /Practice[\s\S]*Unlimited/);
});

test("unlimited reserve retains tactical and empty reload timing through more than a full reserve", () => {
  const { room, player } = fixture();
  const weapon = WEAPONS.rifle;
  let now = 12_000;
  for (let index = 0; index < 8; index++) {
    player.ammo = index === 0 ? 1 : 0;
    assert.equal(reload(room, "solo", now), true);
    const duration = index === 0 ? weapon.tacticalReloadMs : weapon.reloadMs;
    assert.equal(player.reloadDuration, duration);
    assert.equal(shoot(room, "solo", { direction: { x: 0, y: 0, z: -1 } }, now + 1).reason, "Reloading");
    tickRoom(room, .1, now + duration - 1);
    assert.equal(player.ammo, index === 0 ? 1 : 0);
    tickRoom(room, .1, now + duration);
    assert.equal(player.ammo, weapon.magSize);
    assert.equal(player.reserve, weapon.reserve);
    now += duration + 100;
  }
});

test("shotgun pellets count once per trigger and temporary owned weapons never overwrite the saved loadout", () => {
  const { room, player, profile } = fixture("shotgun");
  const target = [...room.enemies.values()][0];
  player.position = { x: target.position.x, y: 1.7, z: target.position.z + 3 };
  const hit = aimedShot(room, player, target, 12_000);
  assert.equal(hit.killed, true);
  assert.ok(hit.hits[0].pellets > 1);
  assert.equal(player.practiceStats.hits, 1);
  assert.equal(player.practiceStats.shots, 1);
  assert.equal(player.practiceStats.targets, 1);
  assert.equal(practiceWeapon(room, "solo", "marksman").ok, false);
  assert.equal(practiceWeapon(room, "stranger", "rifle").ok, false);
  assert.equal(practiceWeapon(room, "solo", "rifle", 13_000).ok, true);
  assert.equal(profile.equippedWeaponId, "shotgun");
  assert.equal(player.weaponId, "rifle");
  assert.equal(player.ammo, WEAPONS.rifle.magSize);
  assert.equal(player.reloadingUntil, 0);
  assert.equal(player.practiceStats.targets, 1);
  room.mode = "campaign";
  assert.equal(practiceWeapon(room, "solo", "sniper").ok, false);
});
