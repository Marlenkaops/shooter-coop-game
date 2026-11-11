import test from "node:test";
import assert from "node:assert/strict";
import { enemyFacingYaw } from "../src/enemy.js";
import { chooseEnemyCover, chooseEnemyTarget, coordinatedApproach, sentinelStep, updateEnemyIntel } from "../server/enemy-tactics.js";
import { canOccupyPosition, canTraverse, ENEMY_RADIUS, hasLineOfSight } from "../shared/gameplay.js";

test("opponents favor visible targets and retain a target across minor distance changes", () => {
  const enemy = { id: "1", position: { x: -6, y: 1, z: -2 } };
  const hidden = { socketId: "hidden", position: { x: -6, y: 1.7, z: 2 } };
  const visible = { socketId: "visible", position: { x: -10, y: 1.7, z: -4 } };
  assert.equal(hasLineOfSight("foundry", { ...enemy.position, y: 1.25 }, { ...hidden.position, y: 1.25 }), false);
  assert.equal(hasLineOfSight("foundry", { ...enemy.position, y: 1.25 }, { ...visible.position, y: 1.25 }), true);
  assert.equal(chooseEnemyTarget("foundry", enemy, [hidden, visible]), visible);
  enemy.position = { x: 0, y: 1, z: 20 };
  enemy.targetId = "visible";
  visible.position = { x: 0, y: 1.7, z: 25 };
  hidden.position = { x: 0, y: 1.7, z: 24.7 };
  assert.equal(chooseEnemyTarget("foundry", enemy, [hidden, visible]), visible);
  assert.equal(chooseEnemyTarget("foundry", enemy, []), null);
});

test("sentinels retreat up close and strafe during cooldown without traversing cover", () => {
  const enemy = { id: "1", position: { x: 0, y: 1, z: 20 } };
  const target = { x: 0, y: 1.7, z: 22 };
  const retreat = sentinelStep("airfield", enemy, target, 2, .2);
  assert.ok(retreat.z < enemy.position.z);
  assert.ok(canTraverse("airfield", enemy.position, retreat));
  target.z = 28;
  const strafe = sentinelStep("airfield", enemy, target, 8, .2);
  assert.notEqual(strafe.x, enemy.position.x);
  assert.equal(strafe.z, enemy.position.z);
  assert.ok(canTraverse("airfield", enemy.position, strafe));
});

test("animated soldiers face their direction of travel and attack", () => {
  for (const [dx, dz] of [[0, -1], [1, 0], [-1, 1], [0, 1]]) {
    const yaw = enemyFacingYaw(dx, dz, true);
    const length = Math.hypot(dx, dz);
    assert.ok(Math.abs(-Math.sin(yaw) - dx / length) < 1e-10);
    assert.ok(Math.abs(-Math.cos(yaw) - dz / length) < 1e-10);
  }
  assert.equal(enemyFacingYaw(0, 1, false), 0);
});

test("squad contacts remember last sightings without tracking hidden players, then expire", () => {
  const enemy = { id: "1", position: { x: -6, y: 1, z: -2 } };
  const player = { socketId: "one", position: { x: -10, y: 1.7, z: -4 }, lastShot: 0 };
  const room = { mapId: "foundry", enemies: new Map([["1", enemy]]), enemyContacts: new Map() };
  assert.deepEqual(updateEnemyIntel(room, [player], 1000)[0].position, player.position);
  const seen = { ...player.position };
  player.position = { x: -6, y: 1.7, z: 2 };
  assert.equal(hasLineOfSight(room.mapId, { ...enemy.position, y: 1.25 }, { ...player.position, y: 1.25 }), false);
  assert.deepEqual(updateEnemyIntel(room, [player], 1200)[0].position, seen);
  assert.deepEqual(updateEnemyIntel(room, [player], 7001), []);
  player.position = seen;
  updateEnemyIntel(room, [player], 8000);
  assert.deepEqual(updateEnemyIntel(room, [], 8001), [], "dead and protected targets are forgotten");
});

test("unseen gunshots reveal only the shot origin and suppressors reduce investigation range", () => {
  const enemy = { id: "1", position: { x: -6, y: 1, z: -2 } };
  const position = { x: -6, y: 1.7, z: 16 };
  const player = { socketId: "one", position, lastShotPosition: { ...position }, lastShot: 1000, weaponId: "rifle" };
  const room = { mapId: "foundry", enemies: new Map([["1", enemy]]), enemyContacts: new Map() };
  assert.equal(hasLineOfSight(room.mapId, { ...enemy.position, y: 1.25 }, { ...position, y: 1.25 }), false);
  assert.equal(updateEnemyIntel(room, [player], 1100).length, 1);
  player.position = { ...position, z: 20 };
  assert.deepEqual(updateEnemyIntel(room, [player], 1200)[0].position, position);
  room.enemyContacts.clear();
  player.weaponId = "carbine";
  assert.equal(updateEnemyIntel(room, [player], 1200).length, 0);
  player.lastShotHearingRange = 30;
  assert.equal(updateEnemyIntel(room, [player], 1200).length, 1, "changing weapons cannot silence an earlier shot");
});

test("squad target pressure spreads threats and ranged support enables lateral approaches", () => {
  const enemy = { id: "1", type: "drone", position: { x: -3, y: 1, z: 25 } };
  const first = { socketId: "one", position: { x: -3, y: 1.7, z: 20 } };
  const second = { socketId: "two", position: { x: -1, y: 1.7, z: 20 } };
  assert.equal(chooseEnemyTarget("airfield", enemy, [first, second], new Map([["one", 3]])), second);
  assert.deepEqual(coordinatedApproach("airfield", enemy, first, [enemy]), first.position);
  const support = { type: "sentinel", targetId: "one", attackWindup: { targetId: "one" } };
  const approach = coordinatedApproach("airfield", enemy, first, [support, enemy]);
  assert.notEqual(approach.x, first.position.x);
  assert.equal(canOccupyPosition("airfield", approach, ENEMY_RADIUS), true);
});

test("wounded enemies select real occluding cover and avoid allies' reserved positions", () => {
  const enemy = { id: "1", position: { x: -6, y: 1, z: 3 } };
  const threat = { x: -6, y: 1.7, z: -4 };
  const cover = chooseEnemyCover("foundry", enemy, threat);
  assert.ok(cover);
  assert.equal(canOccupyPosition("foundry", cover, ENEMY_RADIUS), true);
  assert.equal(hasLineOfSight("foundry", { ...cover, y: cover.y + .25 }, { ...threat, y: threat.y - .45 }), false);
  const alternative = chooseEnemyCover("foundry", enemy, threat, [enemy, { coverGoal: cover }]);
  if (alternative) assert.ok(Math.hypot(alternative.x - cover.x, alternative.z - cover.z) >= 1.6);
});
