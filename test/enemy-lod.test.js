import test from "node:test";
import assert from "node:assert/strict";
import { needsDetailedEnemy } from "../src/enemy-lod.js";

test("distant enemies use cheap silhouettes and detail has hysteresis", () => {
  assert.equal(needsDetailedEnemy(36 ** 2, false, false), false);
  assert.equal(needsDetailedEnemy(23 ** 2, false, false), true);
  assert.equal(needsDetailedEnemy(30 ** 2, true, false), true);
  assert.equal(needsDetailedEnemy(35 ** 2, true, false), false);
  assert.equal(needsDetailedEnemy(18 ** 2, false, true), false);
  assert.equal(needsDetailedEnemy(14 ** 2, false, true), true);
  assert.equal(needsDetailedEnemy(20 ** 2, true, true), true);
});
