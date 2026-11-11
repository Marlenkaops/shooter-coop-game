import test from "node:test";
import assert from "node:assert/strict";
import { addPlayer, createRoom, publicState, startMatch, tickRoom, useMedkit } from "../server/game.js";
import { collectLoot, dropEnemyLoot } from "../server/loot.js";
import { createCommandGuard } from "../server/anti-cheat.js";
import { MAX_MEDKITS, MEDKIT_HEAL, STARTING_MEDKITS, groundedPosition } from "../shared/gameplay.js";
import { createLootVisual } from "../src/loot-visuals.js";

function fixture(mode = "raid") {
  const room = createRoom("MEDKIT", mode === "practice" ? "range" : "foundry", mode);
  const player = addPlayer(room, { id: "one" }, "identity-one",
    { xp: 0, level: 1, ownedWeapons: ["rifle"], equippedWeaponId: "rifle" }, "Medic");
  startMatch(room, 10_000);
  return { room, player };
}

test("medkits heal exactly 50 HP, clamp to 100, consume once and expose the carried count", () => {
  const { room, player } = fixture();
  assert.equal(STARTING_MEDKITS, 1);
  assert.equal(MAX_MEDKITS, 3);
  assert.equal(MEDKIT_HEAL, 50);
  assert.equal(player.medkits, 1);
  player.health = 25;
  assert.deepEqual(useMedkit(room, "one"), { ok: true, healed: 50, health: 75, medkits: 0 });
  assert.equal(useMedkit(room, "one").ok, false);
  assert.equal(player.health, 75);
  player.medkits = 2;
  assert.deepEqual(useMedkit(room, "one"), { ok: true, healed: 25, health: 100, medkits: 1 });
  assert.equal(useMedkit(room, "one").ok, false);
  assert.equal(player.medkits, 1);
  assert.equal(publicState(room).players[0].medkits, 1);
});

test("medkits reject missing players, full health, downed/disconnected users, ended rooms and practice", () => {
  const { room, player } = fixture();
  assert.equal(useMedkit(undefined, "one").ok, false);
  assert.equal(useMedkit(room, "missing").ok, false);
  assert.equal(useMedkit(room, "one").ok, false);
  player.health = 40;
  player.deadUntil = 20_000;
  assert.equal(useMedkit(room, "one").ok, false);
  player.deadUntil = 0;
  player.connected = false;
  assert.equal(useMedkit(room, "one").ok, false);
  player.connected = true;
  player.health = 0;
  assert.equal(useMedkit(room, "one").ok, false);
  player.health = 40;
  for (const phase of ["lobby", "ended"]) {
    room.phase = phase;
    assert.equal(useMedkit(room, "one").ok, false);
    assert.equal(player.medkits, 1);
  }
  room.phase = "between";
  assert.equal(useMedkit(room, "one").ok, true);
  const practice = fixture("practice");
  assert.equal(practice.player.medkits, 0);
  practice.player.health = 10;
  assert.equal(useMedkit(practice.room, "one").ok, false);
});

test("medical drops are distance/cover validated, capped at three, single-use and do not save profiles", () => {
  const { room, player } = fixture();
  const noSave = () => { throw new Error("Medkits must not modify saved weapons or tokens"); };
  dropEnemyLoot(room, { type: "drone", position: { x: 0, y: 1, z: 7 } }, Date.now(), () => .9);
  const drop = [...room.loot.values()].find((item) => item.kind === "medkit");
  assert.ok(drop);
  assert.equal(collectLoot(room, "one", drop.id, noSave).ok, false);
  player.position = groundedPosition(room.mapId, drop.position);
  player.deadUntil = Date.now() + 1000;
  assert.equal(collectLoot(room, "one", drop.id, noSave).ok, false);
  player.deadUntil = 0;
  player.medkits = 3;
  assert.equal(collectLoot(room, "one", drop.id, noSave).ok, false);
  assert.equal(room.loot.has(drop.id), true);
  player.medkits = 2;
  assert.deepEqual(collectLoot(room, "one", drop.id, noSave), { ok: true, kind: "medkit", granted: 1, medkits: 3 });
  assert.equal(collectLoot(room, "one", drop.id, noSave).ok, false);
  assert.equal(player.medkits, 3);
  player.position = { x: -6, y: 1.7, z: 1.9 };
  room.loot.set("blocked", { id: "blocked", source: "enemy", kind: "medkit",
    position: { x: -6, y: 1, z: -1 }, expiresAt: null });
  player.medkits = 0;
  assert.equal(collectLoot(room, "one", "blocked", noSave).ok, false);
  assert.equal(player.medkits, 0);
});

test("medkits remain across respawns and reloads, but reset for a fresh combat match", () => {
  const { room, player } = fixture();
  player.medkits = 2;
  player.health = 40;
  player.reloadingUntil = 50_000;
  assert.equal(useMedkit(room, "one").ok, true);
  assert.equal(player.reloadingUntil, 50_000);
  player.deadUntil = 11_000;
  room.enemies.clear();
  tickRoom(room, 0, 11_001);
  assert.equal(player.health, 100);
  assert.equal(player.medkits, 1);
  room.phase = "ended";
  player.medkits = 3;
  assert.equal(startMatch(room, 20_000), true);
  assert.equal(player.medkits, 1);
});

test("medkit commands cannot carry forged healing, inventory or player fields", () => {
  const guard = createCommandGuard();
  assert.equal(guard.check(["useMedkit"], false).ok, true);
  for (const value of [50, 3, null, {}, { health: 100 }, { medkits: 99 }, { playerId: "other" }]) {
    assert.equal(guard.check(["useMedkit", value], false).ok, false);
  }
});

test("medkit drops have a distinct reusable matte medical-case visual", () => {
  const first = createLootVisual({ source: "enemy", kind: "medkit" });
  const second = createLootVisual({ source: "enemy", kind: "medkit" });
  const ammo = createLootVisual({ source: "enemy", kind: "ammo" });
  assert.equal(first.geometry, second.geometry);
  assert.notEqual(first.geometry, ammo.geometry);
  assert.equal(first.geometry.groups.length, 2);
  assert.ok(first.geometry.attributes.position.count < 1000);
  for (const material of first.material) {
    assert.equal(material.metalness, 0);
    assert.equal(material.roughness, 1);
  }
});
