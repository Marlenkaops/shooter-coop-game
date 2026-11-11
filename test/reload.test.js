import test from "node:test";
import assert from "node:assert/strict";
import { reloadPose, reloadProgress } from "../src/reload.js";

test("reload choreography removes the old magazine and seats a new one", () => {
  const idle = reloadPose(0, false);
  const removed = reloadPose(.43, true);
  const empty = reloadPose(.47, true);
  const incoming = reloadPose(.55, true);
  const seated = reloadPose(.78, true);
  assert.equal(idle.magazine.y, -.2);
  assert.equal(idle.magazine.visible, true);
  assert.ok(removed.magazine.y < -.55);
  assert.equal(empty.magazine.visible, false);
  assert.equal(incoming.magazine.visible, true);
  assert.ok(incoming.magazine.y < -.4);
  assert.ok(Math.abs(seated.magazine.y - idle.magazine.y) < 1e-9);
  assert.equal(seated.stage, "Seat magazine");
  assert.ok(reloadPose(.82, true).hand.y > seated.hand.y);
});

test("support hand charges the bolt then returns without a pose jump", () => {
  const idle = reloadPose(0, false);
  const charging = reloadPose(.9, true);
  const completed = reloadPose(1, true);
  assert.equal(reloadPose(.87, true).boltZ, 0);
  assert.ok(charging.boltZ > .1);
  assert.ok(charging.hand.y > idle.hand.y);
  assert.ok(charging.hand.z > reloadPose(.86, true).hand.z);
  assert.ok(Math.abs(completed.boltZ) < 1e-9);
  assert.deepEqual(completed.hand, idle.hand);
  assert.ok(Math.abs(completed.tilt) < 1e-9);
  assert.ok(Math.abs(completed.handRoll) < 1e-9);
});

test("an interrupted reload resets the magazine and hand", () => {
  assert.deepEqual(reloadPose(.63, false), reloadPose(0, false));
  assert.deepEqual(reloadPose(2, true), reloadPose(1, true));
  assert.throws(() => reloadPose(NaN, true), RangeError);
  assert.throws(() => reloadPose(.4, true, "invalid"), RangeError);
});

test("tactical reload retains its old magazine and skips the bolt", () => {
  const removed = reloadPose(.43, true, "tactical");
  const stowed = reloadPose(.48, true, "tactical");
  const ready = reloadPose(.9, true, "tactical");
  const finished = reloadPose(1, true, "tactical");
  assert.ok(removed.magazine.y < -.55);
  assert.equal(stowed.magazine.visible, false);
  assert.equal(stowed.stage, "Stow magazine");
  assert.equal(ready.stage, "Weapon ready");
  assert.equal(ready.boltZ, 0);
  assert.deepEqual(finished.hand, reloadPose(0, false).hand);
});

test("reload progress uses server timestamps instead of the client's wall clock", () => {
  assert.equal(reloadProgress(false), 0);
  assert.equal(reloadProgress(true, 52_100, 2100, 50_000, 0), 0);
  assert.equal(reloadProgress(true, 52_100, 2100, 50_000, 1050), .5);
  assert.equal(reloadProgress(true, 51_650, 1650, 50_000, 1650), 1);
  assert.equal(reloadProgress(true, 51_650, 1650, 50_000, 2000), 1);
  assert.throws(() => reloadProgress(true, 52_100, 0, 50_000, 100), RangeError);
});

test("top-fed and bullpup magazines reload at their actual mounting points", () => {
  for (const type of ["empty", "tactical"]) {
    const under = reloadPose(0, false, type);
    const top = reloadPose(0, false, type, "top");
    const rear = reloadPose(0, false, type, "rear");
    assert.ok(top.magazine.y > 0);
    assert.ok(rear.magazine.z > 0);
    assert.deepEqual(top.hand, under.hand);
    assert.deepEqual(rear.hand, under.hand);
    assert.ok(reloadPose(.43, true, type, "top").magazine.y > top.magazine.y + .3);
    assert.ok(reloadPose(.43, true, type, "rear").magazine.y < rear.magazine.y - .3);
    for (const mount of ["top", "rear"]) {
      const idle = reloadPose(0, false, type, mount);
      const complete = reloadPose(1, true, type, mount);
      assert.deepEqual(complete.hand, idle.hand);
      assert.ok(Math.abs(complete.magazine.y - idle.magazine.y) < 1e-9);
      assert.ok(Math.abs(complete.magazine.z - idle.magazine.z) < 1e-9);
      assert.deepEqual(reloadPose(.5, false, type, mount), idle);
    }
  }
  assert.throws(() => reloadPose(0, false, "empty", "unknown"), RangeError);
});
