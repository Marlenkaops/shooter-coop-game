import test from "node:test";
import assert from "node:assert/strict";
import {
  canOccupyPosition, getMapObstacles, PLAYER_MAX_MOVE_SPEED, playerStance
} from "../shared/gameplay.js";
import { MAPS } from "../shared/progression.js";
import { eventContentAvailable } from "../shared/events.js";
import { addPlayer, createRoom, publicState, shoot, startMatch, tickRoom, updatePlayer } from "../server/game.js";
import { createCommandGuard } from "../server/anti-cheat.js";

function fixture(mapId = "foundry", mode = "campaign") {
  const room = createRoom("STANCE", mapId, mode);
  const player = addPlayer(room, { id: "one" }, "identity",
    { xp: 2000, level: 5, equippedWeaponId: "rifle" }, "Tester");
  return { room, player };
}

test("crouch and stand transitions preserve feet, replicate stance and do not spend jump credit on every map", () => {
  for (const { id } of MAPS.filter((map) => eventContentAvailable(map.id))) {
    const { room, player } = fixture(id);
    player.lastMove = 1000;
    const feet = player.position.y - playerStance(false).eyeHeight;
    const credit = player.verticalMovementCredit;
    for (let index = 0; index < 20; index++) {
      const crouching = index % 2 === 0;
      const position = { ...player.position, y: feet + playerStance(crouching).eyeHeight };
      assert.equal(updatePlayer(room, "one", { position, crouching }, 1000), true, `${id} transition ${index}`);
      assert.equal(publicState(room).players[0].crouching, crouching);
      assert.ok(Math.abs(player.verticalMovementCredit - credit) < 1e-8);
    }
    assert.ok(Math.abs(player.position.y - playerStance(false).eyeHeight - feet) < 1e-8);
  }
});

test("standing up cannot intersect a roof, and a rejected stance leaves the authoritative pose unchanged", () => {
  const { room, player } = fixture("airfield");
  const roof = getMapObstacles(room.mapId).find((obstacle) => obstacle.kind === "roof");
  player.crouching = true;
  player.position = { x: roof.x, z: roof.z, y: roof.base - .4 };
  player.lastMove = 1000;
  assert.equal(canOccupyPosition(room.mapId, player.position, undefined, true), true);
  const position = { ...player.position, y: player.position.y + .57 };
  assert.equal(canOccupyPosition(room.mapId, position), false);
  assert.equal(updatePlayer(room, "one", { position, crouching: false }, 1100), false);
  assert.equal(player.crouching, true);
  assert.notDeepEqual(player.position, position);
});

test("crouching movement is accepted at its intended speed but cannot sustain sprint speed", () => {
  for (const speed of [2.1, 6.4]) {
    const { room, player } = fixture("range", "practice");
    player.crouching = true;
    player.position = { x: 0, y: 1, z: 20 };
    player.lastMove = 1000;
    let rejected = 0;
    for (let packet = 1; packet <= 40; packet++) {
      const position = { ...player.position, z: player.position.z - speed * .05 };
      if (!updatePlayer(room, "one", { position, crouching: true }, 1000 + packet * 50)) rejected++;
    }
    assert.equal(rejected === 0, speed === 2.1, `${speed} m/s crouching`);
    assert.ok(20 - player.position.z <= (2.1 + .5) * 2 + .75 + 1e-8);
  }
});

test("the old 10 m/s walk cannot be sustained under the new shared movement budget", () => {
  const { room, player } = fixture("range", "practice");
  player.position = { x: 0, y: 1.7, z: 20 };
  player.lastMove = 1000;
  let rejected = 0;
  for (let packet = 1; packet <= 20; packet++) {
    if (!updatePlayer(room, "one", {
      position: { ...player.position, z: player.position.z - .5 }
    }, 1000 + packet * 50)) rejected++;
  }
  assert.ok(rejected > 0);
  assert.ok(20 - player.position.z <= PLAYER_MAX_MOVE_SPEED + .75 + 1e-8);
});

test("movement payloads accept only a boolean stance and continue rejecting forged stats", () => {
  for (const crouching of [undefined, false, true]) {
    const guard = createCommandGuard();
    assert.equal(guard.check(["move", { position: { x: 0, y: 1, z: 0 }, yaw: 0, pitch: 0, crouching }], false).ok, true);
  }
  for (const extra of [{ crouching: "true" }, { crouching: 1 }, { crouching: true, xp: 999 }]) {
    const guard = createCommandGuard();
    assert.equal(guard.check(["move", { position: { x: 0, y: 1, z: 0 }, yaw: 0, pitch: 0, ...extra }], false).ok, false);
  }
});

test("PvP head hitboxes follow the crouched eye, not the old standing head, and respawn clears stance", () => {
  for (const aimAtOldHead of [true, false]) {
    const { room, player } = fixture("airfield", "ffa");
    const victim = addPlayer(room, { id: "two" }, "other", player.profile, "Other");
    startMatch(room, 10_000);
    player.position = { x: 0, y: 1.57, z: 15 };
    victim.position = { x: 0, y: 1, z: 10 };
    victim.crouching = true;
    const dy = aimAtOldHead ? 0 : victim.position.y + .045 - player.position.y;
    const length = Math.hypot(dy, 5);
    player.pitch = Math.atan2(dy, 5);
    const result = shoot(room, "one", { direction: { x: 0, y: dy / length, z: -5 / length } }, 12_000);
    assert.equal(result.hit, !aimAtOldHead);
    if (!aimAtOldHead) assert.equal(result.hitZone, "head");
    victim.deadUntil = 12_001;
    tickRoom(room, 0, 12_002);
    assert.equal(victim.crouching, false);
    assert.equal(victim.position.y, 1.7);
  }
});
