import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { bloodSegmentHit, BLOOD_GRAVITY, BLOOD_STEP, createBloodSimulation } from "../src/blood-physics.js";
import { createBloodEffects } from "../src/blood-effects.js";

const point = (x, y, z) => ({ x, y, z });
const seed = () => {
  let value = 12345;
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
};
test("swept blood collisions hit floors and arena walls without tunneling", () => {
  const floor = bloodSegmentHit(point(0, 2, 0), point(0, -3, 0));
  assert.ok(Math.abs(floor.position.y - .006) < 1e-9);
  assert.deepEqual(floor.normal, point(0, 1, 0));
  const wall = bloodSegmentHit(point(40, 2, 0), point(46, 2, 0));
  assert.equal(wall.position.x, 42);
  assert.deepEqual(wall.normal, point(-1, 0, 0));
  assert.equal(bloodSegmentHit(point(40, 6, 0), point(46, 6, 0)), null);
});

test("oriented cover collisions return the nearest face with its rotated normal", () => {
  const cover = { id: "rotated", x: 0, z: 0, width: 2, depth: 4, height: 2, rotation: Math.PI / 4 };
  const hit = bloodSegmentHit(point(5, 1, 5), point(-5, 1, -5), [cover]);
  assert.ok(hit);
  assert.ok(Math.abs(hit.normal.x - Math.SQRT1_2) < 1e-9);
  assert.ok(Math.abs(hit.normal.z - Math.SQRT1_2) < 1e-9);
  const top = bloodSegmentHit(point(0, 4, 0), point(0, -1, 0), [cover]);
  assert.equal(top.position.y, 2);
  assert.deepEqual(top.normal, point(0, 1, 0));
  assert.equal(top.obstacle, cover);
});

test("droplets obey gravitational acceleration and damp their velocity through drag", () => {
  const simulation = createBloodSimulation({ obstacles: [], random: seed() });
  const drop = simulation.droplets[0];
  Object.assign(drop, { active: true, position: point(0, 3, 0), velocity: point(2, 0, 0), radius: .005, life: 1 });
  simulation.update(BLOOD_STEP);
  assert.ok(Math.abs(drop.position.y - (3 - .5 * BLOOD_GRAVITY * BLOOD_STEP ** 2)) < 1e-12);
  assert.ok(drop.velocity.y < 0 && drop.velocity.x < 2 && drop.velocity.x > 1.9);
});

test("blood integrates consistently at 30 and 60 fps and deposits floor stains", () => {
  const first = createBloodSimulation({ obstacles: [], random: seed() });
  const second = createBloodSimulation({ obstacles: [], random: seed() });
  for (const sim of [first, second]) sim.emit(point(0, 1.5, 0), point(0, 0, 1));
  for (let index = 0; index < 60; index++) first.update(1 / 60);
  for (let index = 0; index < 30; index++) second.update(1 / 30);
  assert.deepEqual(first.droplets, second.droplets);
  assert.deepEqual(first.stains, second.stains);
  assert.ok(first.stains.some((stain) => stain.active && stain.normal.y === 1));
  assert.ok(first.droplets.filter((drop) => drop.active).length < 18);
});

test("stains coalesce, dry, drip down vertical surfaces, fade, and clear within bounded pools", () => {
  const simulation = createBloodSimulation({ compact: true, obstacles: [], random: seed() });
  assert.equal(simulation.droplets.length, 72);
  assert.equal(simulation.stains.length, 48);
  for (let index = 0; index < 100; index++) {
    simulation.emit(point(41.9, 1, 0), point(1, 0, 0), { killed: true });
    simulation.update(.1);
  }
  const wall = simulation.stains.find((stain) => stain.active && stain.surface === "wall-x+");
  assert.ok(wall);
  const height = wall.position.y;
  for (let index = 0; index < 10; index++) simulation.update(.1);
  assert.ok(wall.position.y <= height);
  assert.ok(simulation.stains.filter((stain) => stain.active).length <= 48);
  for (let index = 0; index < 500; index++) simulation.update(.1);
  assert.ok(simulation.stains.every((stain) => !stain.active));
  simulation.emit(point(0, 1, 0), point(0, 0, 1));
  simulation.clear();
  assert.ok(simulation.droplets.every((drop) => !drop.active));
  assert.throws(() => simulation.update(NaN), RangeError);
  assert.throws(() => simulation.emit(point(NaN, 1, 0), point(1, 0, 0)), RangeError);
});

test("blood rendering owns exactly two draw objects and releases all of its resources", () => {
  const scene = new THREE.Scene(), effects = createBloodEffects(scene, { compact: true });
  assert.equal(effects.group.children.length, 2);
  let geometries = 0, materials = 0, textures = 0;
  effects.group.traverse((object) => {
    object.geometry?.addEventListener("dispose", () => geometries++);
    object.material?.addEventListener("dispose", () => materials++);
    object.material?.map?.addEventListener("dispose", () => textures++);
  });
  effects.emit(point(0, 1, 0), point(0, 0, 1));
  for (let index = 0; index < 15; index++) effects.update(.1);
  assert.ok(effects.simulation.stains.some((stain) => stain.active));
  effects.clear();
  assert.ok(effects.group.children.every((object) => !object.visible));
  effects.dispose();
  assert.equal(scene.children.length, 0);
  assert.equal(geometries, 2);
  assert.equal(materials, 2);
  assert.equal(textures, 1);
});

test("blood on asymmetrically rotated cover lands on the rendered face", () => {
  const cover = { id: "angled", x: 0, z: 0, width: 6, depth: 1, height: 2, rotation: .5 };
  const mesh = new THREE.Object3D();
  mesh.rotation.y = cover.rotation;
  mesh.updateMatrixWorld();
  const face = new THREE.Vector3(2.5, 1, .5).applyMatrix4(mesh.matrixWorld);
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion);
  const from = face.clone().addScaledVector(normal, 2), to = face.clone().addScaledVector(normal, -.2);
  const hit = bloodSegmentHit(from, to, [cover]);
  assert.ok(Math.abs(hit.distance - 2) < 1e-6);
  assert.ok(new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z).distanceTo(normal) < 1e-9);
});
