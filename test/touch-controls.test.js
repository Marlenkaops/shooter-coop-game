import test from "node:test";
import assert from "node:assert/strict";
import { joystickVector, TouchInput, triggerCanFire } from "../src/touch-controls.js";
import { WEAPONS } from "../shared/weapons.js";

test("joystick has a dead zone, analog walking and a bounded diagonal speed", () => {
  assert.deepEqual(joystickVector(2, -3, 50), { strafe: 0, forward: 0 });
  const walking = joystickVector(0, -25, 50);
  assert.ok(walking.forward > 0 && walking.forward < 1);
  const diagonal = joystickVector(100, -100, 50);
  assert.ok(Math.abs(Math.hypot(diagonal.strafe, diagonal.forward) - 1) < 1e-12);
  assert.equal(joystickVector(0, 100, 50).forward, -1);
  assert.throws(() => joystickVector(0, 0, 0), RangeError);
});

test("independent fingers can move, look and fire without stealing the movement stick", () => {
  const input = new TouchInput();
  assert.equal(input.begin(1, "move", { x: 0, y: 0, centerX: 0, centerY: 0, radius: 50 }), true);
  input.move(1, 25, -25);
  assert.equal(input.begin(2, "move", { x: 0, y: 0 }), false);
  input.begin(2, "fire", { x: 300, y: 180 });
  assert.equal(input.state.firing, true);
  assert.deepEqual(input.move(2, 320, 170), { x: 20, y: -10 });
  input.end(2);
  assert.equal(input.state.firing, false);
  assert.ok(input.state.forward > 0);
  input.begin(3, "look", { x: 300, y: 200 });
  assert.deepEqual(input.move(3, 280, 240), { x: -20, y: 40 });
  assert.equal(input.state.firing, false);
  input.end(1);
  assert.equal(input.state.forward, 0);
  assert.equal(input.state.strafe, 0);
});

test("focus, sprint and crouch toggle for two-thumb play, and lifecycle resets release all actions", () => {
  const input = new TouchInput();
  input.begin(1, "aim", { x: 0, y: 0 });
  input.end(1);
  assert.equal(input.state.aiming, true);
  input.begin(2, "sprint", { x: 0, y: 0 });
  input.end(2);
  assert.equal(input.state.sprinting, true);
  input.begin(4, "crouch", { x: 0, y: 0 });
  input.end(4);
  assert.equal(input.state.crouching, true);
  input.begin(5, "crouch", { x: 0, y: 0 });
  input.end(5);
  assert.equal(input.state.crouching, false);
  input.begin(3, "fire", { x: 0, y: 0 });
  input.reset();
  assert.deepEqual(input.state, { strafe: 0, forward: 0, firing: false, aiming: false, sprinting: false, crouching: false, ascending: false, descending: false, interacting: false });
  assert.equal(input.pointers.size, 0);
  assert.equal(input.move(3, 100, 100), null);
});

test("shotgun requires a new trigger press while automatic weapons retain held fire", () => {
  assert.equal(triggerCanFire(WEAPONS.shotgun, true, false), true);
  assert.equal(triggerCanFire(WEAPONS.shotgun, true, true), false);
  assert.equal(triggerCanFire(WEAPONS.rifle, true, true), true);
  assert.equal(triggerCanFire(WEAPONS.lmg, true, true), true);
  assert.equal(triggerCanFire(WEAPONS.shotgun, false, false), false);
});
