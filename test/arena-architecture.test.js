import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as THREE from "three";
import { MAPS } from "../shared/progression.js";
import { eventContentAvailable } from "../shared/events.js";
import { ARENA_LIMIT, getMapObstacles } from "../shared/gameplay.js";
import { destructibleLayout } from "../shared/destructibles.js";
import { addArenaArchitecture } from "../src/arena-architecture.js";
import { disposeSceneResources } from "../src/scene-resources.js";

const maps = [...MAPS.filter((map) => eventContentAvailable(map.id)).map((map) => map.id), "range"];
const signature = (mesh) => createHash("sha256").update(Buffer.from(mesh.geometry.attributes.position.array.buffer)).digest("hex");

test("each available arena has distinct deterministic architecture with two static matte draw batches", () => {
  const signatures = new Set();
  for (const id of maps) {
    const scene = new THREE.Scene(), before = structuredClone(getMapObstacles(id));
    const architecture = addArenaArchitecture(scene, id);
    const second = addArenaArchitecture(new THREE.Scene(), id);
    assert.equal(architecture.meshes.length, 2);
    assert.equal(signature(architecture.meshes[0]), signature(second.meshes[0]));
    assert.equal(signature(architecture.meshes[1]), signature(second.meshes[1]));
    signatures.add(signature(architecture.meshes[0]));
    for (const mesh of architecture.meshes) {
      assert.equal(mesh.castShadow, false);
      assert.equal(mesh.geometry.attributes.position.usage, THREE.StaticDrawUsage);
      assert.equal(mesh.material.roughness, 1);
      assert.equal(mesh.material.metalness, 0);
      assert.equal(mesh.material.map, null);
      for (const name of ["position", "normal", "color"]) assert.ok([...mesh.geometry.attributes[name].array].every(Number.isFinite));
    }
    let lights = 0;
    scene.traverse((object) => { if (object.isLight) lights++; });
    assert.equal(lights, 0);
    assert.deepEqual(getMapObstacles(id), before);
    disposeSceneResources(scene); disposeSceneResources(second.root);
  }
  assert.equal(signatures.size, maps.length);
  assert.throws(() => addArenaArchitecture(new THREE.Scene(), "unknown"), RangeError);
  for (const detail of [-1, 4, NaN, 1.5]) assert.throws(() => addArenaArchitecture(new THREE.Scene(), "foundry", { detail }), RangeError);
});

test("every complete background primitive stays beyond the authoritative playable boundary", () => {
  for (const id of maps) for (const detail of [0, 3]) {
    const scene = new THREE.Scene(), architecture = addArenaArchitecture(scene, id, { detail });
    for (const { bounds } of architecture.skylineParts) {
      assert.ok(bounds.max.x < -ARENA_LIMIT - 2 || bounds.min.x > ARENA_LIMIT + 2 ||
        bounds.max.z < -ARENA_LIMIT - 2 || bounds.min.z > ARENA_LIMIT + 2, id);
    }
    disposeSceneResources(scene);
  }
});

test("cover detailing stays within existing rotated solid cover and never paints a destructible hole", () => {
  for (const id of maps) {
    const scene = new THREE.Scene(), architecture = addArenaArchitecture(scene, id);
    const obstacles = getMapObstacles(id), props = new Set(destructibleLayout(id).map((prop) => prop.id));
    const position = architecture.meshes[1].geometry.attributes.position;
    for (const span of architecture.coverParts) {
      const obstacle = obstacles.find((item) => item.id === span.owner);
      assert.ok(obstacle);
      assert.equal(props.has(span.owner), false);
      assert.ok(!["roof", "furniture", "sandbag"].includes(obstacle.kind));
      for (let index = span.start; index < span.end; index++) {
        const dx = position.getX(index) - obstacle.x, dz = position.getZ(index) - obstacle.z;
        const x = Math.cos(obstacle.rotation) * dx - Math.sin(obstacle.rotation) * dz;
        const z = Math.sin(obstacle.rotation) * dx + Math.cos(obstacle.rotation) * dz;
        const y = position.getY(index) - (obstacle.base || 0);
        assert.ok(Math.abs(x) <= obstacle.width / 2 + .008 && Math.abs(z) <= obstacle.depth / 2 + .008 &&
          y >= -.001 && y <= obstacle.height + .001, `${id}:${span.owner}`);
      }
    }
    disposeSceneResources(scene);
  }
});

test("phone detail reduces geometry without losing map landmarks and all resources dispose once", () => {
  for (const id of maps) {
    const low = addArenaArchitecture(new THREE.Scene(), id, { detail: 0 });
    const high = addArenaArchitecture(new THREE.Scene(), id, { detail: 3, shadows: true });
    const count = (architecture) => architecture.meshes.reduce((sum, mesh) => sum + mesh.geometry.attributes.position.count, 0);
    assert.ok(count(low) < count(high), id);
    assert.ok(count(high) < 20000, id);
    assert.ok(low.skylineParts.length >= 5);
    assert.ok(high.meshes.every((mesh) => mesh.receiveShadow));
    const resources = new Set(high.meshes.flatMap((mesh) => [mesh.geometry, mesh.material]));
    let disposed = 0;
    for (const resource of resources) resource.addEventListener("dispose", () => disposed++);
    disposeSceneResources(low.root); disposeSceneResources(high.root);
    assert.equal(disposed, resources.size);
  }
});
