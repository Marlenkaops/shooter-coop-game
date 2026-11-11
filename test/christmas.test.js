import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { CHRISTMAS_EVENT, HALLOWEEN_EVENT, eventContentAvailable } from "../shared/events.js";
import { MAPS } from "../shared/progression.js";
import { ARENA_LIMIT, getMapObstacles } from "../shared/gameplay.js";
import { addChristmas, planChristmas } from "../src/christmas.js";
import { createPracticeTarget } from "../src/practice-range.js";
import { disposeSceneResources } from "../src/scene-resources.js";
import { loadoutMarkup } from "../src/loadout.js";

const maps = [...MAPS.filter((map) => eventContentAvailable(map.id)).map((map) => map.id), "range"];

test("Christmas replaces Halloween presentation without adding an unlock, resetting collections or reopening retired content", () => {
  assert.equal(CHRISTMAS_EVENT.active, true);
  assert.equal(CHRISTMAS_EVENT.name, "Winterwatch");
  assert.equal(HALLOWEEN_EVENT.active, false);
  for (const id of ["wickfall", "jackolantern", "graveglass"]) assert.equal(eventContentAvailable(id), false);
  const profile = { ownedWeapons: ["rifle", "jackolantern", "graveglass"], equippedWeaponId: "rifle" };
  const before = structuredClone(profile);
  const markup = loadoutMarkup(profile);
  assert.doesNotMatch(markup, /jackolantern|graveglass/);
  assert.match(markup, /1 \/ 12/);
  assert.deepEqual(profile, before);
});

test("Christmas placement is deterministic, bounded, clear of traversal and supported by existing rotated cover", () => {
  for (const id of maps) for (const detail of [0, 1, 2, 3]) {
    const plan = planChristmas(id, detail);
    assert.deepEqual(planChristmas(id, detail), plan);
    assert.equal(plan.trees.length, detail > 1 ? 12 : 8);
    assert.equal(plan.bulbs.length, detail > 1 ? 164 : 84);
    for (const item of plan.trees) {
      assert.ok(Math.max(Math.abs(item.x), Math.abs(item.z)) - 1.8 > ARENA_LIMIT);
    }
    for (const item of plan.bulbs) {
      assert.ok(Math.max(Math.abs(item.x), Math.abs(item.z)) - .11 > ARENA_LIMIT);
      assert.ok(item.y > 5.5);
    }
    assert.ok(plan.gifts.length > 0 && plan.gifts.length <= 16, id);
    for (const item of plan.gifts) {
      const cover = getMapObstacles(id).find((cover) => cover.id === item.obstacleId);
      assert.equal(item.y, (cover.base || 0) + cover.height + .01);
      const dx = item.x - cover.x, dz = item.z - cover.z;
      assert.ok(Math.abs(Math.cos(cover.rotation) * dx - Math.sin(cover.rotation) * dz) + .21 < cover.width / 2);
      assert.ok(Math.abs(Math.sin(cover.rotation) * dx + Math.cos(cover.rotation) * dz) + .21 < cover.depth / 2);
      assert.equal(Boolean(cover.buildingId), false);
    }
  }
});

test("Christmas keeps eight static draw batches plus one bounded snowfall batch, no new lights and fully disposable resources", () => {
  for (const id of maps) for (const detail of [0, 3]) {
    const scene = new THREE.Scene(), decor = addChristmas(scene, id, { detail });
    assert.equal(decor.root.children.length, 9);
    assert.equal(decor.meshes.length, 7);
    const before = decor.meshes.map((mesh) => [...mesh.instanceMatrix.array]);
    let lights = 0, disposed = 0;
    const resources = new Set();
    decor.root.traverse((object) => {
      if (object.isLight) lights++;
      for (const resource of [object.geometry, object.material]) if (resource && !resources.has(resource)) {
        resources.add(resource); resource.addEventListener("dispose", () => disposed++);
      }
    });
    assert.equal(lights, 0);
    for (const mesh of decor.meshes) {
      assert.ok(mesh.count > 0 && mesh.count <= 272);
      assert.ok([...mesh.instanceMatrix.array].every(Number.isFinite));
      assert.equal(mesh.castShadow, false);
      assert.equal(mesh.material.roughness, 1);
      assert.equal(mesh.material.metalness, 0);
    }
    decor.update(1);
    assert.deepEqual(decor.meshes.map((mesh) => [...mesh.instanceMatrix.array]), before);
    decor.setEnabled(false); assert.equal(decor.root.visible, false);
    decor.setEnabled(true); assert.equal(decor.root.visible, true);
    const glow = decor.meshes.find((mesh) => mesh.material.emissiveIntensity > .5).material;
    decor.update(1, true); const staticGlow = glow.emissiveIntensity;
    decor.update(5, true); assert.equal(glow.emissiveIntensity, staticGlow);
    assert.throws(() => decor.update(NaN), RangeError);
    disposeSceneResources(scene);
    assert.equal(disposed, resources.size);
  }
});

test("snow falls around the player on every available map, wraps after teleports and reuses bounded buffers", () => {
  for (const id of maps) for (const detail of [0, 3]) {
    const scene = new THREE.Scene(), decor = addChristmas(scene, id, { detail, reducedMotion: detail === 0 });
    const attribute = decor.snow.geometry.attributes.position, array = attribute.array;
    assert.ok(attribute.count >= 40 && attribute.count <= 150);
    assert.equal(decor.snow.castShadow, false);
    assert.equal(decor.snow.material.depthWrite, false);
    assert.equal(decor.snow.material.map.image.width, 16);
    const camera = new THREE.Vector3(4, 1.6, 8);
    decor.update(0, undefined, camera);
    if (detail === 0) assert.equal(decor.snow.visible, false);
    decor.update(0, false, camera);
    assert.equal(decor.snow.visible, true);
    const before = array.slice();
    decor.update(.1, false, camera);
    assert.ok(array.some((value, index) => index % 3 === 1 && value < before[index] - .05));
    camera.set(1500, 30, -1500);
    decor.update(100, false, camera);
    for (let index = 0; index < attribute.count; index++) {
      assert.ok(Math.abs(attribute.getX(index) - camera.x) <= 12);
      assert.ok(Math.abs(attribute.getZ(index) - camera.z) <= 12);
      assert.ok(attribute.getY(index) >= camera.y - 1.601 && attribute.getY(index) <= camera.y + 9.401);
    }
    assert.equal(attribute.array, array);
    const paused = array.slice();
    decor.update(1, true, camera);
    assert.equal(decor.snow.visible, false);
    assert.deepEqual(array, paused);
    decor.update(.1, false, camera);
    assert.equal(decor.snow.visible, true);
    decor.setEnabled(false); decor.update(1, false, camera);
    assert.equal(decor.root.visible, false);
    let disposed = false;
    decor.snow.material.map.addEventListener("dispose", () => { disposed = true; });
    disposeSceneResources(scene);
    assert.equal(disposed, true);
  }
});

test("Christmas range graphics preserve both authoritative plate silhouettes and hit feedback with a live toggle", (t) => {
  const previous = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ({
    fillRect() {}, fillText() {}, set fillStyle(value) {}, set font(value) {}, set textAlign(value) {}
  }) }) };
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  const target = createPracticeTarget({ distance: 25 }, { christmas: false });
  const festive = target.plates.getObjectByName("christmas-target");
  assert.equal(festive.visible, false);
  target.setChristmasEnabled(true); assert.equal(festive.visible, true);
  assert.equal(target.plates.children.length, 2, "merged plates do not create a draw per ring");
  const positions = festive.geometry.attributes.position;
  for (let index = 0; index < positions.count; index++) {
    const x = positions.getX(index), y = positions.getY(index);
    assert.ok(Math.hypot(x, y - .2) <= .60001 || Math.hypot(x, y - .9) <= .24001,
      "visible seasonal aiming surfaces match the existing server body/head circles");
  }
  assert.ok(target.steel.emissive);
  target.setChristmasEnabled(false); assert.equal(festive.visible, false);
  disposeSceneResources(target.mesh);
});
