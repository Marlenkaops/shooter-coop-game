import test from "node:test";
import assert from "node:assert/strict";
import * as CANNON from "cannon-es";
import { MAPS } from "../shared/progression.js";
import { eventContentAvailable } from "../shared/events.js";
import { getMapTerrain, getTerrainHeight, rayTerrainHit, terrainHeightAt } from "../shared/arena-layout.js";
import {
  canOccupyPosition, canTraverse, canWalkTerrain, ENEMY_RADIUS, getMapBuildings, getMapObstacles,
  groundedPosition, hasLineOfSight, mapRayHit, PLAYER_RADIUS, rayObstacleHit
} from "../shared/gameplay.js";
import { addPlayer, createRoom, shoot, tickRoom, updatePlayer, useAmmoSupply } from "../server/game.js";
import { collectLoot, dropEnemyLoot, restockChests } from "../server/loot.js";
import { bloodSegmentHit } from "../src/blood-physics.js";
import { terrainBody, terrainGeometry } from "../src/arena-terrain.js";

function fixture(mapId) {
  const room = createRoom("HEIGHT", mapId);
  const player = addPlayer(room, { id: "one" }, "identity", {
    level: 1, ownedWeapons: ["rifle"], equippedWeaponId: "rifle"
  }, "Tester");
  room.phase = "playing";
  player.lastMove = 1000;
  player.protectedUntil = 0;
  return { room, player };
}

test("all nine arenas have open two-ended interiors and connected ascent/descent routes", () => {
  for (const { id } of MAPS) {
    assert.ok(Object.isFrozen(getMapTerrain(id)));
    for (const building of getMapBuildings(id)) {
      const local = (x, z) => ({
        x: building.x + Math.cos(building.rotation) * x + Math.sin(building.rotation) * z,
        y: building.base + 1.7,
        z: building.z - Math.sin(building.rotation) * x + Math.cos(building.rotation) * z
      });
      assert.ok(canOccupyPosition(id, local(0, 0)), `${id} interior ${building.id}`);
      assert.ok(canTraverse(id, local(0, -building.depth / 2 - 1), local(0, building.depth / 2 + 1)),
        `${id} both entrances ${building.id}`);
      assert.ok(!canOccupyPosition(id, local(building.width / 2, 0)), `${id} solid side wall`);
      assert.ok(!hasLineOfSight(id, local(0, 0), local(building.width / 2 + 2, 0)), `${id} wall occlusion`);
      const origin = local(0, 0);
      assert.ok(mapRayHit(id, origin, { x: 0, y: 1, z: 0 }, 10) < 4, `${id} roof occlusion`);
    }
    for (const side of [-1, 1]) {
      let from = groundedPosition(id, { x: side * 34, z: 20 }), highest = 0;
      for (let z = 19.5; z >= -20; z -= .5) {
        const to = groundedPosition(id, { x: side * 34, z });
        assert.ok(canWalkTerrain(id, from, to), `${id} continuous ramp at ${z}`);
        assert.ok(canTraverse(id, from, to), `${id} accepted elevated sweep at ${z}`);
        highest = Math.max(highest, to.y - 1.7);
        from = to;
      }
      assert.ok(highest >= 1.6 - 1e-8, `${id} real vertical gain`);
      assert.ok(!canWalkTerrain(id, groundedPosition(id, { x: side * 28, z: 0 }),
        groundedPosition(id, { x: side * 34, z: 0 })), `${id} cannot walk straight through terrace retaining wall`);
    }
  }
});

test("elevated boxes and sloped terrain occlude exact rays, with doorway clearance below lintels", () => {
  const roof = getMapObstacles("outpost").find((obstacle) => obstacle.kind === "roof" && obstacle.base > 0);
  assert.equal(rayObstacleHit({ x: roof.x, y: roof.base - 1, z: roof.z }, { x: 0, y: 1, z: 0 }, roof), 1);
  const ramp = getMapTerrain("void").find((surface) => surface.slope !== 0);
  const height = terrainHeightAt(ramp, ramp.x, ramp.z);
  assert.equal(rayTerrainHit({ x: ramp.x, y: height + 3, z: ramp.z }, { x: 0, y: -1, z: 0 }, ramp), 3);
  const geometry = terrainGeometry(ramp, 88);
  assert.equal(geometry.attributes.position.count, 36);
  assert.ok([...geometry.attributes.normal.array].every(Number.isFinite));
  geometry.dispose();
  const from = { x: 27, y: .8, z: 0 }, to = { x: 40, y: .8, z: 0 };
  assert.equal(hasLineOfSight("void", from, to), false);
  const hit = bloodSegmentHit({ x: ramp.x, y: height + 1, z: ramp.z },
    { x: ramp.x, y: height - 1, z: ramp.z }, [], [ramp]);
  assert.ok(Math.abs(hit.position.y - height) < 1e-8);
  assert.ok(Math.abs(hit.normal.z) > .1, "blood lands aligned with the ramp");
});

test("server accepts uphill/downhill movement but rejects vertical teleports and reusable height credit", () => {
  for (const { id } of MAPS.filter((map) => eventContentAvailable(map.id))) {
    const { room, player } = fixture(id);
    player.position = groundedPosition(id, { x: 34, z: 20 });
    let now = 1000;
    for (let z = 19.5; z >= -20; z -= .5) {
      now += 125;
      assert.ok(updatePlayer(room, "one", { position: groundedPosition(id, { x: 34, z }) }, now), `${id} movement ${z}`);
    }
    assert.equal(updatePlayer(room, "one", { position: { ...player.position, y: 9 } }, now + 50), false);
  }
  const { room, player } = fixture("foundry");
  player.position = { x: 0, y: 1.7, z: 20 };
  let accepted = 0;
  for (let i = 0; i < 100; i++) {
    if (updatePlayer(room, "one", { position: { ...player.position, y: player.position.y + .1 } }, 1000)) accepted++;
  }
  assert.ok(accepted <= 2);
  assert.equal(updatePlayer(room, "one", { position: { ...player.position, y: .5 } }, 1050), false);
});

test("real Cannon capsules walk ramps and doorways in every arena, matching accepted server movement", () => {
  for (const { id } of MAPS.filter((map) => eventContentAvailable(map.id))) {
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) });
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.defaultContactMaterial.friction = .08;
    world.defaultContactMaterial.restitution = 0;
    world.defaultContactMaterial.contactEquationStiffness = 1e8;
    world.defaultContactMaterial.contactEquationRelaxation = 4;
    const floor = new CANNON.Body({ mass: 0, collisionFilterGroup: 1, collisionFilterMask: 2, shape: new CANNON.Plane() });
    floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(floor);
    for (const surface of getMapTerrain(id)) world.addBody(terrainBody(surface));
    for (const obstacle of getMapObstacles(id)) {
      const body = new CANNON.Body({ mass: 0, collisionFilterGroup: 1, collisionFilterMask: 2,
        position: new CANNON.Vec3(obstacle.x, (obstacle.base || 0) + obstacle.height / 2, obstacle.z),
        shape: new CANNON.Box(new CANNON.Vec3(obstacle.width / 2, obstacle.height / 2, obstacle.depth / 2)) });
      body.quaternion.setFromEuler(0, obstacle.rotation, 0);
      world.addBody(body);
    }
    const body = new CANNON.Body({ mass: 72, fixedRotation: true, linearDamping: .02,
      position: new CANNON.Vec3(34, 1, 20), collisionFilterGroup: 2, collisionFilterMask: 1 });
    body.addShape(new CANNON.Cylinder(PLAYER_RADIUS, PLAYER_RADIUS, .82, 12));
    body.addShape(new CANNON.Sphere(PLAYER_RADIUS), new CANNON.Vec3(0, .41, 0));
    body.addShape(new CANNON.Sphere(PLAYER_RADIUS), new CANNON.Vec3(0, -.41, 0));
    body.updateMassProperties();
    world.addBody(body);
    const { room, player } = fixture(id);
    player.position = { x: 34, y: 1.7, z: 20 };
    let highest = 0;
    for (let step = 1; step <= 1200; step++) {
      body.velocity.x = 0;
      body.velocity.z = -4.2;
      world.step(1 / 60);
      highest = Math.max(highest, body.position.y - .87);
      if (step % 3 === 0) assert.ok(updatePlayer(room, "one", {
        position: { x: body.position.x, y: body.position.y + .7, z: body.position.z }
      }, 1000 + step * 1000 / 60), `${id} physical move at ${body.position.z.toFixed(2)}, y=${body.position.y.toFixed(2)}`);
      if (body.position.z < -19) break;
    }
    assert.ok(body.position.z < -19, `${id} capsule traversed the entire building and both ramps: ${body.position.z}`);
    assert.ok(highest > 1.5, `${id} capsule gained real height`);
    assert.ok(body.position.y < 1.1, `${id} capsule descended back to ground`);
  }
});

test("enemies pursue an elevated interior through the ramp and cannot melee across levels", () => {
  for (const { id } of MAPS.filter((map) => eventContentAvailable(map.id))) {
    const { room, player } = fixture(id);
    player.position = groundedPosition(id, { x: 34, z: 0 });
    const enemy = { id: "1", type: "drone", position: groundedPosition(id, { x: 27, z: 0 }, 1),
      health: 100, maxHealth: 100, speed: 4, damage: 10, lastAttack: 0, velocity: { x: 0, z: 0 } };
    room.enemies.set("1", enemy);
    for (let step = 0; step < 500 && player.health === 100; step++) {
      const before = { ...enemy.position };
      tickRoom(room, .05, 10_000 + step * 50);
      assert.ok(canWalkTerrain(id, before, enemy.position, ENEMY_RADIUS), `${id} legal AI route`);
      assert.ok(Math.abs(enemy.position.y - getTerrainHeight(id, enemy.position.x, enemy.position.z) - 1) < 1e-6);
    }
    assert.ok(enemy.position.y > 2.5, `${id} hostile climbed ramp`);
    assert.ok(player.health < 100, `${id} hostile reached the interior and attacked`);
  }
  const { room, player } = fixture("void");
  player.position = { x: 28.7, y: 1.7, z: 0 };
  const enemy = { id: "1", type: "drone", position: groundedPosition("void", { x: 29.5, z: 0 }, 1),
    health: 100, speed: 0, damage: 10, lastAttack: 0, attackWindup: { targetId: "one", endsAt: 1000 } };
  room.enemies.set("1", enemy);
  tickRoom(room, .05, 2000);
  assert.equal(player.health, 100);
});

test("raised interior loot and supplies require the correct level and a clear path", () => {
  const { room, player } = fixture("void");
  restockChests(room, () => 0);
  const chest = [...room.loot.values()].find((item) => item.position.x === 34);
  assert.ok(chest.position.y > 3);
  player.position = { x: 34, y: 1.7, z: 0 };
  assert.equal(collectLoot(room, "one", chest.id, () => { throw Error("must not save below terrain"); }).ok, false);
  player.position = groundedPosition("void", { x: 34, z: 0 });
  assert.equal(collectLoot(room, "one", chest.id, () => ({
    ok: true, profile: { ...player.profile, ownedWeapons: ["rifle", chest.weaponId] }
  })).ok, true);
  dropEnemyLoot(room, { position: groundedPosition("void", { x: 34, z: 1 }, 1), type: "drone" }, 1000, () => .9);
  const drop = [...room.loot.values()].find((item) => item.source === "enemy");
  assert.ok(Math.abs(drop.position.y - getTerrainHeight("void", 34, 1) - .18) < 1e-8);
  room.supplies.set("raised", { id: "raised", position: groundedPosition("void", { x: 34, z: 0 }, .55), usedBy: new Set() });
  player.reserve = 0;
  player.position = { x: 34, y: 1.7, z: 0 };
  assert.equal(useAmmoSupply(room, "one", "raised").ok, false);
  player.position = groundedPosition("void", { x: 34, z: 0 });
  assert.equal(useAmmoSupply(room, "one", "raised").ok, true);
  player.position = groundedPosition("void", { x: 34, z: 6 });
  player.pitch = -.2;
  assert.equal(shoot(room, "one", { direction: { x: 0, y: Math.sin(-.2), z: -Math.cos(-.2) } }, Date.now() + 1000).ok, true);
});
