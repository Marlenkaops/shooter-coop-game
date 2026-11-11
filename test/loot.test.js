import test from "node:test";
import assert from "node:assert/strict";
import { addPlayer, createRoom, publicState, shoot, startMatch, tickRoom } from "../server/game.js";
import { collectLoot, dropEnemyLoot, MAX_LOOT, restockChests, supportPlayer } from "../server/loot.js";
import { MAPS } from "../shared/progression.js";
import { eventContentAvailable } from "../shared/events.js";
import { canOccupyPosition, groundedPosition } from "../shared/gameplay.js";
import { WEAPONS } from "../shared/weapons.js";
import { createLootVisual } from "../src/loot-visuals.js";
import crypto from "node:crypto";

function fixture(mapId = "foundry") {
  const room = createRoom("ABCDEF", mapId);
  const player = addPlayer(room, { id: "one" }, "identity", {
    level: 1, ownedWeapons: ["rifle"], equippedWeaponId: "rifle"
  }, "Tester");
  startMatch(room);
  return { room, player };
}
test("every arena receives four reachable, collision-safe weapon chests with fresh IDs", () => {
  for (const map of MAPS.filter((map) => eventContentAvailable(map.id))) {
    const { room } = fixture(map.id);
    assert.equal(room.loot.size, 4);
    const previous = [...room.loot.keys()];
    for (const chest of room.loot.values()) {
      assert.ok(canOccupyPosition(map.id, groundedPosition(map.id, chest.position), .75));
      assert.ok(Object.hasOwn(WEAPONS, chest.weaponId));
    }
    restockChests(room, () => .5);
    assert.equal(room.loot.size, 4);
    assert.ok([...room.loot.keys()].every((id) => !previous.includes(id)));
    assert.equal(publicState(room).loot.length, 4);
  }
});
test("loot validates distance, cover, player state, IDs, and persistence before consuming a chest", () => {
  const { room, player } = fixture();
  const chest = [...room.loot.values()][0];
  assert.equal(collectLoot(room, "one", "fake", () => { throw Error("must not save"); }).ok, false);
  player.position = { x: 30, y: 1.7, z: 30 };
  assert.equal(collectLoot(room, "one", chest.id, () => { throw Error("must not save"); }).ok, false);
  player.position = groundedPosition(room.mapId, chest.position);
  player.deadUntil = Date.now() + 1000;
  assert.equal(collectLoot(room, "one", chest.id, () => { throw Error("must not save"); }).ok, false);
  player.deadUntil = 0;
  assert.throws(() => collectLoot(room, "one", chest.id, () => { throw Error("disk failure"); }), /disk failure/);
  assert.ok(room.loot.has(chest.id));
  assert.equal(player.weaponId, "rifle");
  let saves = 0;
  const grant = (id, gun, equip) => {
    assert.equal(id, "identity"); assert.equal(equip, true); saves++;
    return { ok: true, profile: { ...player.profile, ownedWeapons: ["rifle", gun], equippedWeaponId: gun } };
  };
  assert.equal(collectLoot(room, "one", chest.id, grant).kind, "weapon");
  assert.equal(player.weaponId, chest.weaponId);
  assert.equal(room.loot.has(chest.id), false);
  assert.equal(collectLoot(room, "one", chest.id, grant).ok, false);
  assert.equal(saves, 1);
});
test("duplicate guns refill ammo without regranting and full-ammo loot stays for the squad", () => {
  const { room, player } = fixture();
  const chest = [...room.loot.values()][0];
  player.profile.ownedWeapons.push(chest.weaponId);
  player.position = groundedPosition(room.mapId, chest.position);
  assert.equal(collectLoot(room, "one", chest.id, () => { throw Error("duplicate save"); }).ok, false);
  assert.ok(room.loot.has(chest.id));
  player.reserve = 0;
  const result = collectLoot(room, "one", chest.id, () => { throw Error("duplicate save"); });
  assert.equal(result.kind, "ammo");
  assert.equal(result.granted, WEAPONS.rifle.magSize * 2);
});
test("cover prevents remote loot, and abandoned enemy drops expire within a bounded pool", () => {
  const { room, player } = fixture();
  const id = "blocked";
  player.position = { x: -6, y: 1.7, z: 1.9 };
  room.loot.set(id, { id, source: "chest", kind: "ammo", position: { x: -6, y: 1, z: -1 }, expiresAt: null });
  player.reserve = 0;
  assert.equal(collectLoot(room, "one", id, () => {}).ok, false);
  room.loot.delete(id);
  const enemy = { type: "drone", position: { x: 0, y: 1, z: 5 } }, now = Date.now();
  for (let index = 0; index < 200; index++) dropEnemyLoot(room, enemy, now, () => .9);
  assert.equal(room.loot.size, MAX_LOOT);
  assert.equal([...room.loot.values()].filter((item) => item.source === "chest").length, 4);
  tickRoom(room, 0, now + 120_001);
  assert.equal([...room.loot.values()].filter((item) => item.source === "enemy").length, 0);
});
test("confirmed enemy kills drop loot once; rejected, missed and blocked shots do not", () => {
  const { room, player } = fixture();
  room.enemies.clear();
  room.enemies.set("target", { id: "target", type: "drone", health: 1, maxHealth: 1,
    position: { x: player.position.x, y: 1, z: 5 } });
  const result = shoot(room, "one", { direction: { x: 0, y: -.1, z: -.995 } }, Date.now());
  assert.equal(result.killed, true);
  assert.equal(room.loot.size, 5);
  assert.equal(shoot(room, "one", { direction: { x: 0, y: -.1, z: -.995 } }, Date.now()).ok, false);
  assert.equal(room.loot.size, 5);
});
test("live support handles health, ammo and reload coherently without reviving downed players", () => {
  const { player } = fixture();
  player.health = 3; player.ammo = 0; player.reserve = 0; player.reloadingUntil = Date.now() + 2000;
  assert.equal(supportPlayer(player, "heal").ok, true);
  assert.equal(player.health, 100);
  assert.equal(supportPlayer(player, "ammo").ok, true);
  assert.equal(player.ammo, 24);
  assert.equal(player.reloadingUntil, 0);
  player.deadUntil = Date.now() + 2000;
  assert.equal(supportPlayer(player, "heal").ok, false);
  assert.equal(supportPlayer(player, "invalid").ok, false);
});
test("loot models share resources while all dropped guns have unique geometry and grounded silhouettes", () => {
  const signatures = new Set();
  for (const weapon of Object.values(WEAPONS)) {
    const descriptor = { kind: "weapon", source: "enemy", weaponId: weapon.id };
    const first = createLootVisual(descriptor), second = createLootVisual(descriptor);
    assert.equal(first.geometry, second.geometry);
    assert.equal(first.material, second.material);
    assert.equal(first.geometry.groups.length, 2);
    assert.ok(first.geometry.attributes.position.count < 1000);
    first.geometry.computeBoundingBox();
    signatures.add(crypto.createHash("sha256").update(Buffer.from(first.geometry.attributes.position.array.buffer)).digest("hex"));
  }
  assert.equal(signatures.size, 14);
});
test("restocking a full loot pool cannot grow it beyond the configured budget", () => {
  const { room } = fixture();
  for (let index = 0; index < MAX_LOOT; index++) {
    dropEnemyLoot(room, { type: "drone", position: { x: 0, y: 1, z: 5 } }, Date.now(), () => .9);
  }
  room.loot.delete([...room.loot.keys()][0]);
  dropEnemyLoot(room, { type: "drone", position: { x: 0, y: 1, z: 5 } }, Date.now(), () => .9);
  restockChests(room);
  assert.equal(room.loot.size, MAX_LOOT);
  assert.equal([...room.loot.values()].filter((item) => item.source === "chest").length, 4);
});
