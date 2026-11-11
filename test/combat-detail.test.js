import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { combatDetailBudget, createImpactDecals, createMuzzleSmoke, createSurfaceImpacts, impactSurface } from "../src/combat-detail.js";
import { disposeSceneResources } from "../src/scene-resources.js";
import { getMapObstacles, mapRayHit } from "../shared/gameplay.js";

test("combat debris budgets scale with detail and are lower on compact devices", () => {
  const budgets = [0, 1, 2, 3].map((detail) => combatDetailBudget(detail));
  assert.equal(budgets[0].decals, 0);
  assert.equal(budgets[0].smoke, 0);
  assert.equal(budgets[0].casingRest, 0);
  for (let level = 1; level < 4; level++) {
    assert.ok(budgets[level].decals > budgets[level - 1].decals);
    assert.ok(budgets[level].casings >= budgets[level - 1].casings);
  }
  assert.ok(combatDetailBudget(3, true).decals < budgets[3].decals);
  assert.ok(budgets[3].decals <= 64 && budgets[3].casings <= 36);
});

test("bullet marks land on the face of the cover the server reported, with its normal", () => {
  let checked = 0;
  for (const mapId of ["foundry", "harbor", "citadel"]) {
    for (const obstacle of getMapObstacles(mapId).filter((item) => item.kind !== "roof").slice(0, 12)) {
      const target = { x: obstacle.x, y: (obstacle.base || 0) + Math.min(1.2, obstacle.height / 2), z: obstacle.z };
      const origin = { x: obstacle.x + 9, y: target.y + .3, z: obstacle.z + 7 };
      const direction = new THREE.Vector3(target.x - origin.x, target.y - origin.y, target.z - origin.z).normalize();
      const distance = mapRayHit(mapId, origin, direction, 60);
      if (distance === null || distance < .5) continue;
      const surface = impactSurface(mapId, origin, direction, distance);
      assert.ok(surface, `${mapId} ${obstacle.id}`);
      assert.ok(Math.abs(surface.distance - distance) < .02);
      const normal = new THREE.Vector3(surface.normal.x, surface.normal.y, surface.normal.z);
      assert.ok(Math.abs(normal.length() - 1) < 1e-6);
      assert.ok(normal.dot(direction) < 0, "the mark faces the shooter");
      checked++;
    }
  }
  assert.ok(checked > 20);
  assert.equal(impactSurface("foundry", { x: 0, y: 1.7, z: 0 }, { x: 0, y: -1, z: 0 }, 40), null);
  assert.equal(impactSurface("foundry", { x: 0, y: 1.7, z: 0 }, { x: 0, y: 0, z: 0 }, 3), null);
  assert.equal(impactSurface("foundry", { x: 0, y: 1.7, z: 0 }, { x: 1, y: 0, z: 0 }, Number.NaN), null);
});

test("bullet marks reuse a fixed ring buffer and muzzle smoke is rate limited and fades out", () => {
  const scene = new THREE.Scene();
  const decals = createImpactDecals(scene, { count: 3 });
  const hit = { position: { x: 1, y: 1, z: 1 }, normal: { x: 0, y: 0, z: 1 } };
  for (let index = 0; index < 7; index++) assert.equal(decals.add(hit, { random: () => .5 }), true);
  assert.equal(decals.mesh.count, 3);
  assert.equal(decals.add(null), false);
  assert.equal(createImpactDecals(scene, { count: 0 }).add(hit), false);

  const smoke = createMuzzleSmoke(scene, { count: 2, interval: .1 });
  const muzzle = new THREE.Vector3(0, 1.5, 0), forward = new THREE.Vector3(0, 0, -1);
  assert.equal(smoke.emit(muzzle, forward), true);
  assert.equal(smoke.emit(muzzle, forward), false);
  smoke.update(.11);
  assert.equal(smoke.emit(muzzle, forward), true);
  assert.ok(smoke.puffs.every((puff) => puff.visible));
  for (let step = 0; step < 120; step++) smoke.update(1 / 60);
  assert.ok(smoke.puffs.every((puff) => !puff.visible));
  assert.equal(createMuzzleSmoke(scene, { count: 0 }).emit(muzzle, forward), false);
});

test("sparks, splinters and rupture blasts saturate one fixed pool and release every GPU resource", () => {
  for (const count of [24, 72]) {
    const scene = new THREE.Scene(), impacts = createSurfaceImpacts(scene, { count });
    const hit = { position: new THREE.Vector3(1, 1, 1), normal: new THREE.Vector3(0, 1, 0) };
    const children = [...scene.children], buffers = [...Object.values(impacts.points.geometry.attributes)];
    for (let cycle = 0; cycle < 100; cycle++) {
      for (const kind of ["metal", "wood", "debris", "blast", "dirt"]) impacts.emit(hit, kind, () => .5);
      impacts.update(1 / 60);
      assert.equal(impacts.particles.length, count);
      assert.ok(impacts.points.geometry.attributes.impactSize.array.every(Number.isFinite));
      assert.equal(scene.children.length, 1);
    }
    assert.deepEqual(scene.children, children);
    assert.deepEqual(Object.values(impacts.points.geometry.attributes), buffers);
    impacts.update(3);
    assert.equal(impacts.points.visible, false);
    const resources = [impacts.points.geometry, impacts.points.material], released = new Map();
    for (const resource of resources) resource.addEventListener("dispose", () => released.set(resource, (released.get(resource) || 0) + 1));
    disposeSceneResources(scene);
    for (const resource of resources) assert.equal(released.get(resource), 1);
    assert.throws(() => impacts.update(NaN), RangeError);
  }
  assert.throws(() => createSurfaceImpacts(new THREE.Scene(), { count: 0 }), RangeError);
});
