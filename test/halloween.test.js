import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { addHalloween, planHalloween } from "../src/halloween.js";
import { ARENA_LIMIT, getMapObstacles, positionHitsObstacle } from "../shared/gameplay.js";
import { MAPS } from "../shared/progression.js";
import { disposeSceneResources } from "../src/scene-resources.js";
import { getMapBuildings } from "../shared/gameplay.js";
import { planWickfallDecor, wickfallStoneTexture } from "../src/wickfall-decor.js";

const mapIds = [...MAPS.map((map) => map.id), "range"];

test("Halloween decor stays deterministic, outside traversal, and flush to existing cover", () => {
  for (const mapId of mapIds) {
    const plan = planHalloween(mapId);
    assert.deepEqual(planHalloween(mapId), plan);
    assert.equal(plan.pumpkins.length, 16);
    assert.ok(plan.emblems.length > 0 && plan.emblems.length <= 10, mapId);
    for (const item of plan.pumpkins) {
      assert.ok(Math.max(Math.abs(item.x), Math.abs(item.z)) - .48 * item.size > ARENA_LIMIT);
    }
    for (const item of plan.emblems) {
      const cover = getMapObstacles(mapId).find((obstacle) => obstacle.id === item.obstacleId);
      assert.ok(item.y > (cover.base || 0) && item.y < (cover.base || 0) + cover.height);
      assert.equal(positionHitsObstacle(item, cover, .02), true);
      assert.ok(-item.x * Math.sin(item.yaw) + (10 - item.z) * Math.cos(item.yaw) > 0,
        "faces must point toward the deployment area, including long side barriers");
    }
    assert.equal(planHalloween(mapId, 0).pumpkins.length, 8);
    for (const item of [...plan.clusters, ...plan.candles]) {
      const cover = getMapObstacles(mapId).find((obstacle) => obstacle.id === item.obstacleId);
      assert.equal(item.y, (cover.base || 0) + cover.height + .01);
      const dx = item.x - cover.x, dz = item.z - cover.z;
      const x = Math.cos(cover.rotation) * dx - Math.sin(cover.rotation) * dz;
      const z = Math.sin(cover.rotation) * dx + Math.cos(cover.rotation) * dz;
      const radius = item.size ? item.size * .48 : .065;
      assert.ok(Math.abs(x) + radius < cover.width / 2, "ornaments stay on supported cover tops");
      assert.ok(Math.abs(z) + radius < cover.depth / 2, "ornaments do not create new ground obstacles");
      assert.equal(Boolean(cover.buildingId), false, "vault roofs and event chests remain clear");
    }
  }
});

test("decorations and light updates stay bounded, matte and phone friendly", () => {
  for (const mapId of mapIds) {
    const scene = new THREE.Scene();
    const decoration = addHalloween(scene, mapId, { pointLights: 20 });
    assert.ok(decoration.meshes.length <= (mapId === "wickfall" ? 19 : 11));
    assert.equal(decoration.lights.length, 2);
    for (const mesh of decoration.meshes) {
      assert.ok(mesh.isInstancedMesh);
      assert.ok(mesh.count > 0 && mesh.count <= 450);
      if (mesh.material.isMeshStandardMaterial) {
        assert.equal(mesh.material.roughness, 1);
        assert.equal(mesh.material.metalness, 0);
      }
      assert.ok([...mesh.instanceMatrix.array].every(Number.isFinite));
    }
    decoration.update(.25, new THREE.Vector3(0, 1.7, 10));
    assert.ok(decoration.lights.every((light) => !light.castShadow && light.intensity > 0));
    decoration.setEnabled(false);
    assert.equal(decoration.root.visible, false);
    const before = decoration.lights[0].intensity;
    decoration.update(10, new THREE.Vector3(10, 1.7, 10));
    assert.equal(decoration.lights[0].intensity, before);
    decoration.setEnabled(true);
    decoration.update(.016, new THREE.Vector3(10, 1.7, 10));
    assert.equal(decoration.root.visible, true);
    disposeSceneResources(scene);
    const phone = addHalloween(new THREE.Scene(), mapId, { detail: 0, pointLights: 0, reducedMotion: true });
    const material = phone.meshes.find((mesh) => mesh.material.emissiveIntensity > 1).material;
    phone.update(.016, new THREE.Vector3());
    const glow = material.emissiveIntensity;
    phone.update(5, new THREE.Vector3());
    assert.equal(material.emissiveIntensity, glow, "reduced motion disables flicker");
    assert.equal(phone.lights.length, 0, "phones need no dynamic lights");
    disposeSceneResources(phone.root);
  }
});

test("Wickfall is visibly dressed even on phones, without decorating open doors or traversal lanes", () => {
  for (const detail of [0, 1, 2, 3]) {
    const plan = planHalloween("wickfall", detail), cemetery = plan.cemetery;
    assert.deepEqual(cemetery, planWickfallDecor(detail));
    assert.ok(plan.clusters.length >= 16, "nearby pumpkins are not just distant perimeter props");
    assert.ok(plan.candles.length >= 24);
    assert.equal(cemetery.headstones.length, 18);
    assert.equal(cemetery.arches.length, 12);
    assert.ok(cemetery.lanterns.length >= 12);
    assert.ok(cemetery.webs.length >= 30);
    assert.ok(cemetery.trees.length >= 10);
    for (const block of cemetery.blocks) if (block.height > 2) {
      const building = getMapBuildings("wickfall").find((building) => building.id === block.buildingId);
      assert.ok(building);
      const dx = block.x - building.x, dz = block.z - building.z;
      const localX = Math.cos(building.rotation) * dx - Math.sin(building.rotation) * dz;
      assert.ok(Math.abs(localX) - block.width / 2 >= Math.min(3.2, building.width * .5) / 2,
        "stone door posts must not narrow the authoritative opening");
    }
    for (const web of cemetery.webs.filter((web) => web.buildingId)) {
      const building = getMapBuildings("wickfall").find((building) => building.id === web.buildingId);
      assert.ok(Math.abs(web.x - building.x) - web.size >= Math.min(3.2, building.width * .5) / 2);
    }
    for (const item of cemetery.iron) assert.ok(Math.max(Math.abs(item.x), Math.abs(item.z)) > ARENA_LIMIT);
    for (const item of cemetery.lanterns.filter((item) => item.hanging)) {
      assert.ok(item.y - .21 * item.size > 4.5, "canopy lanterns clear normal walking and jumps");
    }
  }
});

test("all cemetery draw calls, triangles, exterior silhouettes and resources have honest bounded budgets", () => {
  for (const detail of [0, 3]) {
    const scene = new THREE.Scene(), decoration = addHalloween(scene, "wickfall", { detail });
    let calls = 0, triangles = 0, disposed = 0;
    const geometries = new Set(), materials = new Set(), textures = new Set();
    decoration.root.traverse((object) => {
      if (object.geometry) {
        calls++;
        if (object.isMesh) triangles += (object.geometry.index?.count || object.geometry.attributes.position.count) / 3 *
          (object.isInstancedMesh ? object.count : 1);
        assert.ok([...object.geometry.attributes.position.array].every(Number.isFinite));
        geometries.add(object.geometry);
      }
      if (object.material) {
        materials.add(object.material);
        if (object.material.map) textures.add(object.material.map);
      }
    });
    assert.ok(calls <= 24, `all decoration draws, including paths and line art: ${calls}`);
    assert.ok(triangles < (detail === 0 ? 24000 : 45000), `decoration triangles: ${triangles}`);
    const trees = decoration.root.getObjectByName("crooked-trees");
    const matrix = new THREE.Matrix4(), bounds = trees.geometry;
    bounds.computeBoundingBox();
    for (let index = 0; index < trees.count; index++) {
      trees.getMatrixAt(index, matrix);
      const box = bounds.boundingBox.clone().applyMatrix4(matrix);
      assert.ok(box.min.x > ARENA_LIMIT || box.max.x < -ARENA_LIMIT ||
        box.min.z > ARENA_LIMIT || box.max.z < -ARENA_LIMIT, "entire tree stays outside playable collision");
    }
    const resources = [...geometries, ...materials, ...textures];
    resources.forEach((resource) => resource.addEventListener("dispose", () => disposed++));
    disposeSceneResources(scene);
    assert.equal(disposed, resources.length, "map changes dispose every new resource exactly once");
  }
  const first = wickfallStoneTexture(), second = wickfallStoneTexture();
  assert.deepEqual(first.image.data, second.image.data);
  assert.equal(first.colorSpace, THREE.SRGBColorSpace);
  assert.equal(first.generateMipmaps, true, "distant paving must not sparkle with nearest-filter aliasing");
  assert.equal(first.minFilter, THREE.LinearMipmapLinearFilter);
  first.dispose(); second.dispose();
});
