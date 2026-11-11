import test from "node:test";
import assert from "node:assert/strict";
import { movementSpeed, movementVelocity } from "../shared/movement.js";
import { PLAYER_CROUCH_SPEED, PLAYER_MAX_MOVE_SPEED, PLAYER_SPRINT_SPEED, PLAYER_WALK_SPEED } from "../shared/gameplay.js";

test("tactical target speeds and directional penalties are locked independently of the controller", () => {
  assert.equal(PLAYER_WALK_SPEED, 4.2);
  assert.equal(PLAYER_SPRINT_SPEED, 6.4);
  assert.equal(PLAYER_CROUCH_SPEED, 2.1);
  assert.equal(PLAYER_MAX_MOVE_SPEED, 6.9);
  assert.equal(movementSpeed(), 4.2);
  assert.equal(movementSpeed({ sprinting: true }), 6.4);
  assert.equal(movementSpeed({ sprinting: true, crouching: true }), 2.1);
  assert.equal(movementSpeed({ forward: 0, strafe: 1, sprinting: true }), 4.2 * .85);
  assert.equal(movementSpeed({ forward: -1, sprinting: true }), 4.2 * .8);
  assert.ok(movementSpeed({ forward: 1, strafe: 1 }) < 4.2);
});

test("movement accelerates, brakes and reverses promptly without snapping to full speed", () => {
  const first = movementVelocity({ x: 0, z: 0 }, { x: 1, z: 0 }, 1 / 60);
  assert.ok(first.x > 0 && first.x < 1);
  let velocity = first;
  for (let frame = 0; frame < 12; frame++) velocity = movementVelocity(velocity, { x: 1, z: 0 }, 1 / 60);
  assert.equal(velocity.x, PLAYER_WALK_SPEED);
  const reversal = movementVelocity(velocity, { x: -1, z: 0 }, 1 / 60);
  assert.ok(reversal.x > 0 && reversal.x < velocity.x);
  for (let frame = 0; frame < 12; frame++) velocity = movementVelocity(velocity, { x: 0, z: 0 }, 1 / 60);
  assert.deepEqual(velocity, { x: 0, z: 0 });
});

test("normalized sprint and analog walking remain within authoritative speed limits", () => {
  let sprint = { x: 0, z: 0 }, analog = { x: 0, z: 0 };
  for (let frame = 0; frame < 120; frame++) {
    sprint = movementVelocity(sprint, { x: 1, z: 1 }, 1 / 60, { sprinting: true });
    analog = movementVelocity(analog, { x: .5, z: 0 }, 1 / 60);
    assert.ok(Math.hypot(sprint.x, sprint.z) < PLAYER_MAX_MOVE_SPEED);
  }
  assert.ok(Math.abs(Math.hypot(sprint.x, sprint.z) - PLAYER_SPRINT_SPEED) < 1e-8);
  assert.equal(analog.x, PLAYER_WALK_SPEED * .5);
});

test("airborne traversal retains momentum with limited steering and stops safely when disabled", () => {
  const initial = { x: 8, z: 0 };
  const coast = movementVelocity(initial, { x: 0, z: 0 }, .05, { grounded: false });
  assert.ok(coast.x > 7.5 && coast.x < 8);
  const air = movementVelocity(initial, { x: -1, z: 0 }, .05, { grounded: false });
  const ground = movementVelocity(initial, { x: -1, z: 0 }, .05);
  assert.ok(air.x > ground.x);
  let paused = initial;
  for (let frame = 0; frame < 20; frame++) paused = movementVelocity(paused, { x: 1, z: 0 }, 1 / 60,
    { grounded: false, enabled: false });
  assert.deepEqual(paused, { x: 0, z: 0 });
});

test("ground movement is cadence independent and rejects non-finite physics input", () => {
  const run = (hz) => {
    let velocity = { x: 0, z: 0 };
    for (let frame = 0; frame < hz / 10; frame++) velocity = movementVelocity(velocity, { x: .8, z: .6 }, 1 / hz);
    return velocity;
  };
  const slow = run(30), fast = run(120);
  assert.ok(Math.hypot(slow.x - fast.x, slow.z - fast.z) < 1e-9);
  for (const dt of [-1, NaN, Infinity]) assert.throws(() => movementVelocity({ x: 0, z: 0 }, { x: 0, z: 0 }, dt), RangeError);
  assert.throws(() => movementVelocity({ x: Infinity, z: 0 }, { x: 0, z: 0 }, .01), RangeError);
});
