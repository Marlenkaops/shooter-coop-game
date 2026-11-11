import test from "node:test";
import assert from "node:assert/strict";
import { addPlayer, advanceCampaignRoom, createRoom, publicState, raidInteract, shoot, startMatch, tickRoom } from "../server/game.js";
import { createCommandGuard } from "../server/anti-cheat.js";
import { canOccupyPosition, canWalkTerrain, groundedPosition, hasLineOfSight } from "../shared/gameplay.js";
import { canAccessMode, MODES } from "../shared/modes.js";
import { MAPS } from "../shared/progression.js";
import { RAID_CAPTURE_MS, RAID_REACH, raidObjective } from "../shared/raid.js";
import { TOKENS_PER_KILL, tokensForMatch } from "../shared/weapons.js";
import { createRaidMarker } from "../src/raid-visuals.js";

function fixture(count = 1, mapId = "foundry") {
  const room = createRoom("RAID", mapId, "raid");
  for (let index = 0; index < count; index++) {
    const player = addPlayer(room, { id: `p${index}` }, `identity-${index}`,
      { xp: 0, level: 1, ownedWeapons: ["rifle"], equippedWeaponId: "rifle" }, `Raider ${index}`);
    player.protectedUntil = Number.MAX_SAFE_INTEGER;
  }
  startMatch(room, 10_000);
  for (const player of room.players.values()) player.protectedUntil = Number.MAX_SAFE_INTEGER;
  return { room, player: room.players.get("p0") };
}

function capture(room, player) {
  player.position = groundedPosition(room.mapId, room.raid.position);
  for (let index = 0; index < RAID_CAPTURE_MS / 100; index++) tickRoom(room, .1, 10_000 + index * 100);
  assert.equal(room.raid.stage, 1);
}

test("Raid is open at level one with one to four operators and no campaign advancement", () => {
  assert.equal(canAccessMode(0, "raid"), true);
  assert.equal(MODES.raid.waves, 3);
  for (const count of [1, 4]) {
    const { room } = fixture(count);
    assert.equal(room.phase, "playing");
    assert.equal(room.raid.stage, 0);
    assert.equal(advanceCampaignRoom(room, [...room.players.values()].map((player) => player.profile)).ok, false);
  }
});

test("all three Raid objective routes are reachable on every arena and have unobstructed interaction space", () => {
  for (const map of MAPS) {
    const start = groundedPosition(map.id, { x: -3, z: 10 });
    const visited = new Set(["-3,10"]), queue = [start];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const from = queue[cursor];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next = groundedPosition(map.id, { x: from.x + dx, z: from.z + dz }), key = `${next.x},${next.z}`;
        if (!visited.has(key) && canWalkTerrain(map.id, from, next)) { visited.add(key); queue.push(next); }
      }
    }
    for (let stage = 0; stage < 3; stage++) {
      const objective = raidObjective(map.id, stage), point = objective.position;
      assert.ok(canOccupyPosition(map.id, groundedPosition(map.id, point), stage === 2 ? 1.7 : 1.2));
      assert.ok(queue.some((position) => Math.hypot(position.x - point.x, position.y - point.y,
        position.z - point.z) <= RAID_REACH && hasLineOfSight(map.id, position, { ...point, y: point.y + .4 })),
      `${map.id}: stage ${stage + 1} must be reachable`);
    }
  }
  assert.throws(() => raidObjective("foundry", 3), RangeError);
});

test("uplink capture requires a living connected operator, pauses while contested and cannot skip stages", () => {
  const { room, player } = fixture(2);
  room.enemies.clear();
  assert.equal(raidInteract(room, "p0", "raid-cache").ok, false);
  tickRoom(room, .1, 10_100);
  assert.equal(room.raid.progressMs, 0);
  player.position = groundedPosition(room.mapId, room.raid.position);
  player.connected = false;
  tickRoom(room, .1, 10_200);
  assert.equal(room.raid.progressMs, 0);
  player.connected = true;
  player.deadUntil = 50_000;
  tickRoom(room, .1, 10_300);
  assert.equal(room.raid.progressMs, 0);
  player.deadUntil = 0;
  tickRoom(room, .1, 10_400);
  assert.equal(room.raid.progressMs, 100);
  room.enemies.set("guard", { id: "guard", type: "drone", health: 50, maxHealth: 50, speed: 0, damage: 0,
    position: groundedPosition(room.mapId, { x: player.position.x + 1, z: player.position.z }, 1),
    velocity: { x: 0, z: 0 }, attackWindup: null, lastAttack: 0 });
  tickRoom(room, .1, 10_500);
  assert.equal(room.raid.contested, true);
  assert.equal(room.raid.progressMs, 100);
  room.enemies.clear();
  tickRoom(room, 999, 10_600);
  assert.equal(room.raid.progressMs, 200, "a long or malformed tick cannot fast-forward capture");
  assert.equal(room.wave, 1);
});

test("capturing preserves guards, the cache requires clearance and proximity, and the commander scales with the squad", () => {
  for (const count of [1, 4]) {
    const { room, player } = fixture(count);
    const guardIds = [...room.enemies.keys()];
    capture(room, player);
    assert.ok(guardIds.every((id) => room.enemies.has(id)), "old guards persist rather than silently disappearing");
    assert.equal(raidInteract(room, "missing", "raid-cache").ok, false);
    assert.equal(raidInteract(room, "p0", "raid-commander").ok, false);
    assert.equal(raidInteract(room, "p0", "raid-cache").ok, false);
    player.position = groundedPosition(room.mapId, room.raid.position);
    assert.equal(raidInteract(room, "p0", "raid-cache").ok, false, "guards must be defeated");
    room.enemies.clear();
    player.deadUntil = 50_000;
    assert.equal(raidInteract(room, "p0", "raid-cache").ok, false);
    player.deadUntil = 0;
    assert.equal(raidInteract(room, "p0", "raid-cache").ok, true);
    const boss = room.enemies.get(room.raid.bossId);
    assert.equal(room.raid.stage, 2);
    assert.equal(boss.isRaidBoss, true);
    assert.equal(boss.health, 240 + 90 * (count - 1));
    assert.equal(raidInteract(room, "p0", "raid-cache").ok, false, "a repeated cache command cannot spawn more enemies");
    const state = publicState(room);
    assert.equal(state.raid.bossId, boss.id);
    assert.notEqual(state.raid.position, room.raid.position);
  }
});

test("commander kills pay once, victory waits for escorts, completion has no duplicate kill tokens and replay resets the Raid", () => {
  const { room, player } = fixture();
  room.enemies.clear();
  capture(room, player);
  room.enemies.clear();
  player.position = groundedPosition(room.mapId, room.raid.position);
  assert.equal(raidInteract(room, "p0", "raid-cache").ok, true);
  const boss = room.enemies.get(room.raid.bossId);
  Object.assign(boss, { health: 1, position: { x: 0, y: 1, z: 5 } });
  player.position = { x: 0, y: 1.7, z: 10 };
  player.yaw = player.pitch = 0;
  const shot = shoot(room, "p0", { direction: { x: 0, y: -.1, z: -.995 } }, 30_000);
  assert.equal(shot.killed, true);
  assert.equal(room.raid.bossDefeated, true);
  assert.equal(player.kills, 1);
  assert.equal(room.pendingNpcTokens.get(player.identity).tokens, TOKENS_PER_KILL);
  assert.equal(shoot(room, "p0", { direction: { x: 0, y: -.1, z: -.995 } }, 30_000).ok, false);
  assert.equal(tickRoom(room, 0, 30_010), null, "remaining escorts prevent victory");
  room.enemies.clear();
  const result = tickRoom(room, 0, 30_020);
  assert.equal(result.won, true);
  assert.equal(result.mode, "raid");
  assert.equal(result.wave, 3);
  assert.equal(result.rewards[0].tokens, tokensForMatch(3, 0, true));
  assert.equal(result.rewards[0].killTokens, TOKENS_PER_KILL);
  assert.equal(tickRoom(room, 0, 30_030), null);
  assert.equal(startMatch(room, 40_000), false, "pending kill rewards must save before replay");
  room.pendingNpcTokens.clear();
  assert.equal(startMatch(room, 40_000), true);
  assert.equal(room.raid.stage, 0);
  assert.equal(room.raid.progressMs, 0);
  assert.equal(room.raid.bossDefeated, false);
  assert.equal(player.kills, 0);
});

test("a fully downed Raid squad fails instead of capturing or winning", () => {
  const { room, player } = fixture();
  player.position = groundedPosition(room.mapId, room.raid.position);
  player.health = 0;
  player.deadUntil = 14_000;
  const result = tickRoom(room, .1, 10_100);
  assert.equal(result.won, false);
  assert.equal(result.mode, "raid");
  assert.equal(room.raid.progressMs, 0);
  assert.equal(room.phase, "ended");
  assert.equal(raidInteract(room, "p0", "raid-cache").ok, false);
});

test("Raid only accepts the cache interaction ID, not client-supplied progress, stages or boss health", () => {
  const guard = createCommandGuard();
  assert.equal(guard.check(["raidInteract", "raid-cache"], false).ok, true);
  for (const input of ["raid-uplink", "raid-commander", {}, { stage: 2 }, { progressMs: 12000 }, { bossHealth: 0 }]) {
    assert.equal(guard.check(["raidInteract", input], false).ok, false);
  }
  for (let stage = 0; stage < 3; stage++) {
    const marker = createRaidMarker(raidObjective("foundry", stage));
    assert.ok(marker.children.length >= 4);
    marker.traverse((object) => {
      if (object.material?.isMeshStandardMaterial) {
        assert.equal(object.material.metalness, 0);
        assert.equal(object.material.roughness, 1);
      }
    });
  }
});
