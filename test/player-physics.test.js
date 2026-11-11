import test from "node:test";
import assert from "node:assert/strict";
import * as CANNON from "cannon-es";
import { createPlayerBody, setPlayerCrouching, stepPlayerPhysics } from "../src/player-physics.js";
import { PLAYER_CROUCH_SPEED, PLAYER_WALK_SPEED, PLAYER_SPRINT_SPEED, playerStance } from "../shared/gameplay.js";

function fixture(hz) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0), allowSleep: true });
  const material = new CANNON.Material("world");
  const floor = new CANNON.Body({
    mass: 0, material, collisionFilterGroup: 1, collisionFilterMask: 2,
    shape: new CANNON.Plane()
  });
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(floor);
  const body = createPlayerBody(world, { x: 0, y: 1.7, z: 0 }, material);
  for (let frame = 0; frame < 60; frame++) world.step(1 / 60);
  let accumulator = 0;
  const previous = new CANNON.Vec3();
  return { world, body, material,
    run(seconds, direction, sprinting = false, options = {}) {
      for (let frame = 0; frame < Math.round(seconds * hz); frame++) {
        accumulator = stepPlayerPhysics(world, body, previous, direction, 1 / hz, accumulator,
          { sprinting, ...options });
      }
    }
  };
}

test("the actual grounded capsule reaches walk, sprint and normalized diagonal speed at different render cadences", () => {
  for (const hz of [15, 30, 60, 120]) for (const kind of ["walk", "sprint", "diagonal"]) {
    const { body, run } = fixture(hz);
    const direction = { x: kind === "diagonal" ? 1 : 0, z: -1 }, sprinting = kind === "sprint";
    run(.5, direction, sprinting);
    const x = body.position.x, z = body.position.z;
    run(2, direction, sprinting);
    const speed = Math.hypot(body.position.x - x, body.position.z - z) / 2;
    const expected = sprinting ? PLAYER_SPRINT_SPEED : PLAYER_WALK_SPEED;
    assert.ok(speed > expected * .99 && speed <= expected, `${hz}Hz ${kind}: ${speed}`);
    assert.ok(body.position.y > .85 && body.position.y < .89);
  }
});

test("controller braking stops the capsule while physical walls still block it and allow sliding", () => {
  const { world, body, material, run } = fixture(60);
  run(.5, { x: 0, z: -1 });
  const start = body.position.z;
  run(.4, { x: 0, z: 0 });
  assert.ok(Math.abs(body.velocity.z) < .001);
  assert.ok(Math.abs(body.position.z - start) < .8);
  world.addBody(new CANNON.Body({
    mass: 0, position: new CANNON.Vec3(2, 2, -15), material,
    collisionFilterGroup: 1, collisionFilterMask: 2,
    shape: new CANNON.Box(new CANNON.Vec3(.25, 2, 20))
  }));
  const before = body.position.z;
  run(2, { x: 1, z: -1 });
  assert.ok(body.position.x < 1.31 && body.position.x > 1.2, "cannot tunnel through a wall");
  assert.ok(body.position.z < before - PLAYER_WALK_SPEED * Math.SQRT1_2 * 1.8,
    "wall contact must preserve at least 90% of unobstructed forward travel");
  assert.equal(body.quaternion.x, 0);
  assert.equal(body.quaternion.z, 0);
});

test("the production fixed-step loop preserves acceleration, reversal and braking distance at 30/60/120 fps", () => {
  const results = [30, 60, 120].map((hz) => {
    const { body, run } = fixture(hz);
    run(.1, { x: 0, z: -1 });
    const accelerating = body.position.z;
    run(.4, { x: 0, z: -1 }, true);
    const sprinting = body.position.z;
    run(.2, { x: 0, z: 1 });
    run(.3, { x: 0, z: 0 });
    return { accelerating, sprinting, final: body.position.z, velocity: body.velocity.z };
  });
  for (const result of results.slice(1)) for (const key of Object.keys(result)) {
    assert.ok(Math.abs(result[key] - results[0][key]) < 1e-8, `${key} must not depend on render cadence`);
  }
});

test("crouching changes the real capsule without lifting its feet or losing ground contact", () => {
  for (const hz of [30, 60, 120]) {
    const { world, body, run } = fixture(hz);
    const floor = body.position.y - playerStance(false).height / 2;
    setPlayerCrouching(body, true);
    assert.ok(Math.abs(body.position.y - playerStance(true).height / 2 - floor) < 1e-8);
    run(.5, { x: 0, z: -1 }, false, { crouching: true });
    const start = body.position.z;
    run(1, { x: 0, z: -1 }, false, { crouching: true });
    assert.ok(Math.abs(body.position.z - start + PLAYER_CROUCH_SPEED) < .01);
    assert.ok(Math.abs(body.position.y - playerStance(true).height / 2) < .005);
    for (let index = 0; index < 100; index++) setPlayerCrouching(body, index % 2 === 0);
    setPlayerCrouching(body, false);
    assert.equal(body.shapes.length, 3);
    assert.equal(world.contactmaterials.length, 1);
    assert.ok(Math.abs(body.position.y - playerStance(false).height / 2) < .005);
  }
});

test("the smaller capsule passes under cover that physically blocks standing movement", () => {
  const simulate = (crouching) => {
    const { world, body, material, run } = fixture(60);
    world.addBody(new CANNON.Body({
      mass: 0, material, position: new CANNON.Vec3(0, 1.5, -2),
      collisionFilterGroup: 1, collisionFilterMask: 2,
      shape: new CANNON.Box(new CANNON.Vec3(2, .15, .5))
    }));
    setPlayerCrouching(body, crouching);
    run(2, { x: 0, z: -1 }, false, { crouching });
    return body.position.z;
  };
  assert.ok(simulate(false) > -1.1);
  assert.ok(simulate(true) < -3.5);
});

test("resting capsules sleep without contacts and wake for movement, crouching and jumping", () => {
  const { world, body, run } = fixture(60);
  run(3, { x: 0, z: 0 });
  assert.equal(body.sleepState, CANNON.Body.SLEEPING);
  assert.equal(world.contacts.length, 0);
  const start = body.position.z;
  run(.5, { x: 0, z: -1 });
  assert.ok(body.position.z < start - 1.5);
  run(3, { x: 0, z: 0 });
  assert.equal(body.sleepState, CANNON.Body.SLEEPING);
  setPlayerCrouching(body, true);
  assert.equal(body.sleepState, CANNON.Body.AWAKE);
  run(3, { x: 0, z: 0 }, false, { crouching: true });
  assert.equal(body.sleepState, CANNON.Body.SLEEPING);
  body.wakeUp();
  body.velocity.y = 7.7;
  run(.1, { x: 0, z: 0 }, false, { crouching: true });
  assert.ok(body.position.y > 1.2);
});

test("authorized flight keeps sleeping capsules awake to hover, ascend, descend and land", () => {
  const { world, body, run } = fixture(60);
  run(3, { x: 0, z: 0 });
  assert.equal(body.sleepState, CANNON.Body.SLEEPING);
  let flying = true, vertical = 0;
  world.addEventListener("preStep", () => {
    if (!flying) return;
    body.force.y -= world.gravity.y * body.mass;
    body.velocity.y = vertical;
  });
  body.position.y = 4;
  run(3, { x: 0, z: 0 }, false, { flying });
  assert.ok(Math.abs(body.position.y - 4) < .001);
  assert.notEqual(body.sleepState, CANNON.Body.SLEEPING);
  vertical = 2;
  run(1, { x: 0, z: 0 }, false, { flying });
  assert.ok(Math.abs(body.position.y - 6) < .01);
  vertical = -2;
  run(1, { x: 0, z: 0 }, false, { flying });
  assert.ok(Math.abs(body.position.y - 4) < .01);
  flying = false;
  run(4, { x: 0, z: 0 });
  assert.ok(Math.abs(body.position.y - playerStance(false).height / 2) < .01);
  assert.equal(body.sleepState, CANNON.Body.SLEEPING);
});
