import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { addArenaDressing, dressingTheme, planArenaDressing } from "../src/arena-dressing.js";
import { MAPS } from "../shared/progression.js";
import { PRACTICE_MAP, RANGE_LANES } from "../shared/practice.js";
import { ARENA_LIMIT, getMapBuildings, getMapObstacles, positionHitsObstacle } from "../shared/gameplay.js";
import { getTerrainHeight } from "../shared/arena-layout.js";

const mapIds = [...MAPS.map((map) => map.id), PRACTICE_MAP.id];
const items = (plan) => Object.entries(plan).filter(([, value]) => Array.isArray(value)).flatMap(([, value]) => value);

test("every arena and the range has its own deterministic dressing theme", () => {
  const signatures = new Set();
  for (const mapId of mapIds) {
    const theme = dressingTheme(mapId);
    signatures.add(JSON.stringify(theme));
    assert.deepEqual(planArenaDressing(mapId, 2), planArenaDressing(mapId, 2));
    assert.ok(items(planArenaDressing(mapId, 2)).length > 300, mapId);
  }
  assert.equal(signatures.size, mapIds.length);
  assert.throws(() => planArenaDressing("unknown"), RangeError);
});

test("dressing never sits inside cover, buildings, outside the arena or on uneven ground", () => {
  for (const mapId of mapIds) {
    const obstacles = getMapObstacles(mapId).filter((obstacle) => obstacle.kind !== "roof");
    const buildings = getMapBuildings(mapId) || [];
    for (const item of items(planArenaDressing(mapId, 3))) {
      assert.ok(Math.abs(item.x) < ARENA_LIMIT - 1 && Math.abs(item.z) < ARENA_LIMIT - 1, `${mapId} bounds`);
      assert.ok(!obstacles.some((obstacle) => positionHitsObstacle(item, obstacle, .01)), `${mapId} ${item.x},${item.z}`);
      assert.ok(!buildings.some((building) => Math.abs(item.x - building.x) < building.width / 2 &&
        Math.abs(item.z - building.z) < building.depth / 2), `${mapId} building`);
      assert.equal(item.y, getTerrainHeight(mapId, item.x, item.z));
    }
  }
});

test("range lanes stay clear except for brass at the firing line", () => {
  const plan = planArenaDressing(PRACTICE_MAP.id, 3);
  for (const [kind, list] of Object.entries(plan)) {
    if (!Array.isArray(list) || kind === "casings" || kind === "cracks") continue;
    for (const item of list) assert.ok(!(item.z > -40 && item.z < 20 && RANGE_LANES.some((lane) => Math.abs(item.x - lane) < 4)), kind);
  }
  assert.ok(plan.casings.length > 100);
  assert.ok(plan.casings.every((item) => item.z > 14 && item.z < 16.5));
});

test("battery saver keeps a fraction of the scenery and Ultra stays bounded", () => {
  for (const mapId of mapIds) {
    const counts = [0, 1, 2, 3].map((detail) => items(planArenaDressing(mapId, detail)).length);
    assert.ok(counts[0] < counts[1] && counts[1] < counts[2] && counts[2] < counts[3], mapId);
    assert.ok(counts[0] <= counts[2] * .35, mapId);
    assert.ok(counts[3] < 2600, `${mapId} ${counts[3]}`);
    assert.equal(planArenaDressing(mapId, 0).motes, 0);
  }
  assert.equal(planArenaDressing("harbor", 3).motes, 0);
  assert.equal(planArenaDressing("spillway", 3).motes, 0);
});

test("scenery renders as a few instanced draw calls with matte, non-reflective materials", () => {
  for (const mapId of mapIds) {
    const scene = new THREE.Scene();
    const dressing = addArenaDressing(scene, mapId, { detail: 2 });
    assert.ok(dressing.meshes.length <= 12, mapId);
    for (const mesh of dressing.meshes) {
      assert.ok(mesh.isInstancedMesh);
      assert.equal(mesh.material.metalness, 0);
      assert.equal(mesh.material.roughness, 1);
      assert.ok(mesh.count > 0);
      if (mesh.material.transparent) assert.equal(mesh.material.depthWrite, false);
    }
    dressing.update(.016, new THREE.Vector3(5, 1.7, 5));
    if (dressing.motes) {
      const positions = dressing.motes.geometry.attributes.position.array;
      for (let index = 0; index < positions.length; index += 3) {
        assert.ok(Math.abs(positions[index] - 5) <= 11.01 && Math.abs(positions[index + 2] - 5) <= 11.01);
      }
    }
  }
});
