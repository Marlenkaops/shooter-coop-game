import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { ARENA_LIMIT } from "../shared/gameplay.js";
import { mergedTiledBoxes, tiledBox } from "../src/scene-geometry.js";

test("batched arena walls retain every vertex, normal, texture coordinate and collision-aligned bound", () => {
  const walls = [
    [0, 2.5, -ARENA_LIMIT - .5, ARENA_LIMIT * 2 + 2, 5, 1],
    [0, 2.5, ARENA_LIMIT + .5, ARENA_LIMIT * 2 + 2, 5, 1],
    [-ARENA_LIMIT - .5, 2.5, 0, 1, 5, ARENA_LIMIT * 2 + 2],
    [ARENA_LIMIT + .5, 2.5, 0, 1, 5, ARENA_LIMIT * 2 + 2]
  ];
  const originals = walls.map(([x, y, z, width, height, depth]) =>
    tiledBox(width, height, depth, 2.8).translate(x, y, z));
  const merged = mergedTiledBoxes(walls, 2.8);
  for (const attribute of ["position", "normal", "uv"]) {
    assert.deepEqual([...merged.attributes[attribute].array],
      originals.flatMap((geometry) => [...geometry.attributes[attribute].array]));
  }
  merged.computeBoundingBox();
  const bounds = new THREE.Box3();
  for (const geometry of originals) { geometry.computeBoundingBox(); bounds.union(geometry.boundingBox); }
  assert.ok(bounds.equals(merged.boundingBox));
  assert.equal(merged.index.count, originals.reduce((total, geometry) => total + geometry.index.count, 0));
  assert.deepEqual(merged.groups, [], "one material requires one draw, not four wall submissions");
  for (const geometry of [...originals, merged]) geometry.dispose();
});
