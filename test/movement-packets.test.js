import test from "node:test";
import assert from "node:assert/strict";
import { createMovementPackets } from "../src/movement-packets.js";

test("stationary players send a 4 Hz heartbeat instead of redundant movement packets", () => {
  const packets = createMovementPackets(), position = { x: 0, y: 1.57, z: 0 };
  const sent = [];
  for (let now = 0; now < 2000; now += 10) if (packets.next(now, position, 0, 0, false)) sent.push(now);
  assert.deepEqual(sent, [0, 250, 500, 750, 1000, 1250, 1500, 1750]);
});

test("position, aiming and stance changes retain the existing movement send cadence", () => {
  const packets = createMovementPackets(), position = { x: 0, y: 1.57, z: 0 };
  const first = packets.next(0, position, 0, 0, false);
  position.x = 1;
  assert.equal(first.position.x, 0, "queued packet snapshots cannot follow a mutable physics vector");
  assert.equal(packets.next(45, position, 0, 0, false), null);
  assert.equal(packets.next(46, position, 0, 0, false).position.x, 1);
  assert.equal(packets.next(92, position, .1, 0, false).yaw, .1);
  assert.equal(packets.next(138, position, .1, .2, false).pitch, .2);
  assert.equal(packets.next(184, position, .1, .2, true).crouching, true);
  packets.reset();
  assert.ok(packets.next(185, position, .1, .2, true), "new matches send immediately");
});

test("submillimeter resting contact jitter is coalesced without suppressing actual travel", () => {
  const packets = createMovementPackets(), position = { x: 0, y: 1.57, z: 0 };
  packets.next(0, position, 0, 0, false);
  position.y += .00001;
  assert.equal(packets.next(100, position, 0, 0, false), null);
  position.z -= .01;
  assert.ok(packets.next(110, position, 0, 0, false));
});

test("stopping sends a final stationary packet so server-owned firing spread settles promptly", () => {
  const packets = createMovementPackets(), position = { x: 0, y: 1.57, z: 0 };
  packets.next(0, position, 0, 0, false);
  position.z = -.21;
  assert.ok(packets.next(50, position, 0, 0, false));
  assert.ok(packets.next(100, position, 0, 0, false), "report zero movement at the usual cadence");
  assert.equal(packets.next(150, position, 0, 0, false), null);
  assert.equal(packets.next(349, position, 0, 0, false), null);
  assert.ok(packets.next(350, position, 0, 0, false));
});
