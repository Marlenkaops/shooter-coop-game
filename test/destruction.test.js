import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import * as CANNON from "cannon-es";
import { MAPS } from "../shared/progression.js";
import { createDestructibles, destructibleLayout, geometryForProps, MAX_DESTRUCTIBLES, PROP_HEALTH } from "../shared/destructibles.js";
import { canOccupyPosition, canTraverse, canWalkTerrain, chooseEnemyStep, getMapObstacles, getSupportHeight,
  hasLineOfSight, mapRayHit } from "../shared/gameplay.js";
import { getTerrainHeight } from "../shared/arena-layout.js";
import { addPlayer, createRoom, publicState, shoot, startMatch, updatePlayer } from "../server/game.js";
import { createDestructibleCover } from "../src/destructible-cover.js";
import { createPlayerBody, stepPlayerPhysics } from "../src/player-physics.js";
import { createBloodSimulation } from "../src/blood-physics.js";

function encounter(mode = "campaign", weaponId = "rifle") {
  const room = createRoom("BROKEN", "foundry", mode);
  const profile = { level: 10, xp: 10000, equippedWeaponId: weaponId, ownedWeapons: [weaponId] };
  const player = addPlayer(room, { id: "one" }, "one", profile, "Lead");
  if (mode === "ffa") addPlayer(room, { id: "two" }, "two", profile, "Wing");
  assert.equal(startMatch(room, 10000), true);
  room.enemies.clear();
  const prop = destructibleLayout(room.mapId)[0];
  player.position = { x: prop.x, y: prop.base + 1.57, z: prop.z + 3 };
  Object.assign(player, { yaw: 0, pitch: 0, protectedUntil: 0, lastMove: 10000 });
  return { room, player, prop };
}
const shot = { direction: { x: 0, y: 0, z: -1 } };

test("destructible placement is deterministic, bounded and separate from static terrain on every map", () => {
  assert.deepEqual(destructibleLayout("range"), []);
  for (const { id } of MAPS) {
    const layout = destructibleLayout(id), staticCover = getMapObstacles(id);
    assert.ok(layout.length >= 2 && layout.length <= MAX_DESTRUCTIBLES, id);
    assert.strictEqual(layout, destructibleLayout(id));
    assert.ok(Object.isFrozen(layout) && layout.every(Object.isFrozen));
    assert.ok(layout.some((prop) => prop.kind === "generator"));
    for (const prop of layout) {
      assert.equal(canOccupyPosition(id, { x: prop.x, y: prop.base + 1.57, z: prop.z }, 1.8), true);
      assert.equal(getTerrainHeight(id, prop.x, prop.z), prop.base);
    }
    const geometry = geometryForProps(id, createDestructibles(id));
    assert.deepEqual(geometry.obstacles.slice(0, staticCover.length), staticCover);
    assert.strictEqual(getMapObstacles(id), staticCover);
  }
});

test("collision, LOS, bullets, crouch, support and navigation open together, with isolated room caches", () => {
  const { room, prop } = encounter(), other = createRoom("OTHERS", "foundry");
  const center = { x: prop.x, y: prop.base + 1.57, z: prop.z };
  const from = { ...center, z: center.z + 1.5 }, to = { ...center, z: center.z - 1.5 };
  const before = room.geometry;
  assert.equal(canOccupyPosition(before, center), false);
  assert.equal(canOccupyPosition(before, { ...center, y: prop.base + 1 }, undefined, true), false);
  assert.equal(canTraverse(before, from, to, .2), false);
  assert.equal(canWalkTerrain(before, from, to, .2), false);
  assert.equal(hasLineOfSight(before, from, to), false);
  assert.ok(mapRayHit(before, from, shot.direction, 3) < 1.5);
  assert.equal(getSupportHeight(before, { ...center, y: prop.base + prop.height + .01 }), prop.base + prop.height);
  chooseEnemyStep(before, { ...from, z: from.z + 1 }, { ...to, z: to.z - 1 }, .4);
  for (let index = 0; index < 4; index++) shoot(room, "one", shot, 11000 + index * 1000);
  assert.notStrictEqual(room.geometry, before);
  assert.equal(canOccupyPosition(room.geometry, center), true);
  assert.equal(canTraverse(room.geometry, from, to, .2), true);
  assert.equal(canWalkTerrain(room.geometry, from, to, .2), true);
  assert.equal(hasLineOfSight(room.geometry, from, to), true);
  assert.equal(mapRayHit(room.geometry, from, shot.direction, 3), null);
  assert.equal(getSupportHeight(room.geometry, { ...center, y: prop.base + prop.height + .01 }), prop.base);
  const next = chooseEnemyStep(room.geometry, from, to, .4, .2);
  assert.ok(next.z < from.z && Math.abs(next.x - from.x) < 1e-8);
  assert.equal(canOccupyPosition(other.geometry, center), false);
  assert.equal(canOccupyPosition(before, center), false, "old immutable topology remains intact");
});

test("normal shots chip cover without crediting damage, hits, kills, weapon XP or tokens", () => {
  const { room, player, prop } = encounter();
  room.enemies.set("target", { id: "target", type: "drone", health: 100, maxHealth: 100,
    position: { x: prop.x, y: prop.base + 1, z: prop.z - 3 } });
  for (let index = 0; index < 4; index++) {
    const result = shoot(room, "one", shot, 11000 + index * 1000);
    assert.equal(result.ok, true);
    assert.equal(result.rays[0].propId, prop.id);
    assert.equal(result.hit, false, "even the breaking trigger cannot penetrate cover");
    assert.equal(room.props[0].health, PROP_HEALTH - (index + 1) * 20);
    assert.equal(room.enemies.get("target").health, 100);
  }
  assert.equal(player.matchProgress.shots, 4);
  assert.deepEqual({ ...player.matchProgress, shots: 0 }, { shots: 0, hits: 0, damage: 0, weaponXp: {} });
  assert.equal(player.kills, 0);
  assert.equal(room.pendingNpcTokens.size, 0);
  assert.equal(shoot(room, "one", shot, 16000).hit, true);
  assert.equal(room.enemies.get("target").health, 80);
});

test("navigation overlays retain static walls and isolate cached routes across destruction and restoration", () => {
  const intact = createDestructibles("foundry"), partial = createDestructibles("foundry");
  partial[0].health = 0;
  const contexts = [geometryForProps("foundry", intact), geometryForProps("foundry", partial),
    geometryForProps("foundry", partial.map((state) => ({ ...state, health: 0 }))),
    geometryForProps("foundry", intact)];
  for (const geometry of contexts) {
    let position = { x: -18, y: 1, z: 13 };
    const target = { x: 0, y: 1, z: -13 };
    for (let step = 0; step < 180 && Math.hypot(position.x - target.x, position.z - target.z) > .3; step++) {
      const next = chooseEnemyStep(geometry, position, target, .3);
      assert.equal(canWalkTerrain(geometry, position, next, .56), true);
      position = next;
    }
    assert.ok(Math.hypot(position.x - target.x, position.z - target.z) < .3,
      `a complete valid route survives topology changes: ${JSON.stringify(position)}`);
  }
});

test("all shotgun pellets see the pre-trigger topology and cover health never underflows", () => {
  const { room, prop } = encounter("campaign", "shotgun");
  room.enemies.set("target", { id: "target", type: "drone", health: 100,
    position: { x: prop.x, y: prop.base + 1, z: prop.z - 3 } });
  room.props[0].health = 1;
  const result = shoot(room, "one", shot, 11000);
  assert.equal(result.rays.length, 8);
  assert.ok(result.rays.every((ray) => ray.propId === prop.id));
  assert.equal(room.props[0].health, 0);
  assert.equal(room.enemies.get("target").health, 100);
});

test("FFA cover absorbs player hits too and cannot be bypassed by firing faster or invalid aim", () => {
  const { room, player, prop } = encounter("ffa");
  const opponent = room.players.get("two");
  Object.assign(opponent, { protectedUntil: 0, position: { x: prop.x, y: prop.base + 1.57, z: prop.z - 3 } });
  assert.equal(shoot(room, player.socketId, shot, 11000).hit, false);
  assert.equal(room.props[0].health, 60);
  assert.equal(shoot(room, player.socketId, shot, 11001).ok, false);
  assert.equal(shoot(room, player.socketId, { direction: { x: 1, y: 0, z: 0 } }, 12000).ok, false);
  assert.equal(room.props[0].health, 60);
  for (let index = 0; index < 3; index++) shoot(room, player.socketId, shot, 13000 + index * 1000);
  assert.equal(shoot(room, player.socketId, shot, 17000).hit, true);
  assert.equal(opponent.health, 60, "the later unobstructed ray reaches the standing player's head");
});

test("movement authority blocks entering intact props and accepts the same destination after destruction", () => {
  const { room, player, prop } = encounter();
  const move = { position: { x: prop.x, y: prop.base + 1.57, z: prop.z }, yaw: 0, pitch: 0 };
  player.movementCredit = 4;
  assert.equal(updatePlayer(room, "one", move, 11000), false);
  for (let index = 0; index < 4; index++) shoot(room, "one", shot, 12000 + index * 1000);
  player.movementCredit = 4;
  assert.equal(updatePlayer(room, "one", move, 16000), true);
});

test("public snapshots contain only bounded prop IDs/health, late joins retain damage and replays reset it", () => {
  const { room } = encounter();
  shoot(room, "one", shot, 11000);
  addPlayer(room, { id: "late" }, "late", { level: 1 }, "Late");
  assert.equal(publicState(room).props[0].health, 60);
  assert.deepEqual(Object.keys(publicState(room).props[0]).sort(), ["health", "id"]);
  assert.equal("geometry" in publicState(room), false);
  room.phase = "ended";
  assert.equal(startMatch(room, 12000), true);
  assert.ok(room.props.every((prop) => prop.health === PROP_HEALTH));
  assert.throws(() => geometryForProps("foundry", [{ id: "prop-0", health: -1 }]), /snapshot/);
});

test("Three instances and Cannon boxes share the exact rotated bounds; destruction wakes supported players", () => {
  const scene = new THREE.Scene(), world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) });
  const material = new CANNON.Material("cover"), broken = [];
  const cover = createDestructibleCover(scene, world, "foundry", { material, onBreak: (prop) => broken.push(prop.id) });
  const states = createDestructibles("foundry"), layout = destructibleLayout("foundry"), matrix = new THREE.Matrix4();
  for (const [index, prop] of layout.entries()) {
    cover.mesh.getMatrixAt(index, matrix);
    const bounds = new THREE.Box3().setFromBufferAttribute(cover.mesh.geometry.attributes.position).applyMatrix4(matrix);
    const body = cover.bodies.get(prop.id); body.updateAABB();
    assert.ok(Math.abs(bounds.min.x - body.aabb.lowerBound.x) < 1e-5);
    assert.ok(Math.abs(bounds.max.z - body.aabb.upperBound.z) < 1e-5);
    assert.ok(Math.abs(bounds.max.y - body.aabb.upperBound.y) < 1e-5);
  }
  const prop = layout[0], player = createPlayerBody(world, { x: prop.x, y: prop.base + prop.height + 1.57, z: prop.z }, material);
  player.sleep();
  const before = player.position.y;
  states[0].health = 0; cover.sync(states);
  assert.equal(cover.bodies.has(prop.id), false);
  assert.equal(player.sleepState, CANNON.Body.AWAKE);
  for (let step = 0; step < 20; step++) world.step(1 / 60);
  assert.ok(player.position.y < before - .5);
  assert.deepEqual(broken, [prop.id]);
  cover.sync(states); assert.deepEqual(broken, [prop.id]);
  cover.sync(createDestructibles("foundry"), false);
  assert.equal(cover.bodies.size, layout.length);
  cover.dispose();
  assert.equal(world.bodies.length, 1);
  assert.equal(scene.children.length, 0);
});

test("removed cover loses attached blood stains instead of leaving invisible stain-bearing walls", () => {
  const states = createDestructibles("foundry"), prop = destructibleLayout("foundry")[0];
  let geometry = geometryForProps("foundry", states);
  const simulation = createBloodSimulation({ geometry: () => geometry });
  Object.assign(simulation.stains[0], { active: true, obstacle: prop, age: 0 });
  states[0].health = 0; geometry = geometryForProps("foundry", states);
  simulation.update(1 / 60);
  assert.equal(simulation.stains[0].active, false);
});

test("Cannon contact slop never sends prediction inside the exact authoritative rotated cover", () => {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) });
  const material = new CANNON.Material("floor");
  const floor = new CANNON.Body({ mass: 0, material, shape: new CANNON.Plane(), collisionFilterGroup: 1 });
  floor.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
  world.addBody(floor);
  const cover = createDestructibleCover(new THREE.Scene(), world, "foundry", { material });
  const prop = destructibleLayout("foundry")[0];
  const player = createPlayerBody(world, { x: prop.x, y: prop.base + 1.57, z: prop.z + 3 }, material);
  const previous = player.position.clone();
  for (let frame = 0; frame < 60; frame++) {
    stepPlayerPhysics(world, player, previous, { x: 0, z: -1 }, 1 / 60, 0, { geometry: cover.geometry, grounded: true });
    const position = { x: player.position.x, y: player.position.y + .7, z: player.position.z };
    assert.equal(canOccupyPosition(cover.geometry, position), true, `contact frame ${frame}`);
    assert.equal(canTraverse(cover.geometry, { x: previous.x, y: previous.y + .7, z: previous.z }, position), true);
  }
  const states = createDestructibles("foundry"); states[0].health = 0; cover.sync(states);
  player.position.set(prop.x, prop.base + .87, prop.z + 3);
  for (let frame = 0; frame < 72; frame++) stepPlayerPhysics(world, player, previous, { x: 0, z: -1 }, 1 / 60, 0,
    { geometry: cover.geometry, grounded: true });
  assert.ok(player.position.z < prop.z - 1, JSON.stringify({ position: player.position, velocity: player.velocity, prop }));
  cover.dispose();
});
