import test from "node:test";
import assert from "node:assert/strict";
import {
  damageForHit, offsetShotDirection, shotDirections, WEAPONS, tokensForMatch, weaponFor
} from "../shared/weapons.js";
import { addPlayer, createRoom, reload, shoot, startMatch, tickRoom } from "../server/game.js";
import { opticReticle } from "../src/optics.js";
import { scopeLensFov } from "../src/aim.js";
import { eventContentAvailable } from "../shared/events.js";

function readyRoom(weaponId) {
  const room = createRoom("GUNS", "foundry");
  const player = addPlayer(room, { id: "one" }, "operator",
    { level: 1, equippedWeaponId: weaponId }, "Tester");
  startMatch(room);
  room.enemies.clear();
  room.enemies.set("target", {
    id: "target", type: "drone", health: 500, maxHealth: 500,
    position: { x: player.position.x, y: 1, z: 5 }
  });
  return { room, player };
}

test("token rewards are server-calculated and all weapon definitions have distinct tradeoffs", () => {
  assert.equal(tokensForMatch(1, 0, false), 18);
  assert.equal(tokensForMatch(5, 10, true), 195);
  assert.equal(weaponFor("missing"), WEAPONS.rifle);
  assert.ok(WEAPONS.smg.fireInterval < WEAPONS.rifle.fireInterval);
  assert.ok(WEAPONS.smg.bodyDamage < WEAPONS.rifle.bodyDamage);
  assert.ok(WEAPONS.marksman.headDamage > WEAPONS.rifle.headDamage);
  assert.ok(WEAPONS.marksman.magSize < WEAPONS.rifle.magSize);
});

test("every gun has a defined optic and the four new weapons have unique authoritative profiles", () => {
  assert.equal(Object.keys(WEAPONS).length, 14);
  const profiles = new Set();
  for (const weapon of Object.values(WEAPONS)) {
    assert.ok(Object.isFrozen(weapon.optic));
    assert.ok(weapon.optic.zoom >= 1 && weapon.optic.zoom <= 6);
    assert.ok(opticReticle(weapon.optic.reticle).includes("<circle"));
    assert.ok(Number.isFinite(scopeLensFov(76, weapon.optic.zoom, 280, 720)));
    profiles.add([weapon.magSize, weapon.fireInterval, weapon.bodyDamage, weapon.optic.zoom].join(","));
    const { room, player } = readyRoom(weapon.id);
    if (!eventContentAvailable(weapon.id)) {
      assert.equal(player.weaponId, "rifle", "saved event gear cannot bypass closure");
      player.weaponId = weapon.id;
      assert.equal(shoot(room, "one", { direction: { x: 0, y: -.1, z: -.995 } }, 2000).ok, false);
      continue;
    }
    const result = shoot(room, "one", { direction: { x: 0, y: -.1, z: -.995 } }, 2000);
    assert.equal(result.ok, true);
    assert.equal(player.ammo, weapon.magSize - 1);
    assert.equal(result.rays.length, weapon.pellets || 1);
    assert.equal(shoot(room, "one", { direction: { x: 0, y: -.1, z: -.995 } }, 2000 + weapon.fireInterval - 1).reason, "Fire rate");
  }
  assert.equal(profiles.size, 14);
  assert.equal(WEAPONS.carbine.fireMode, "semi");
  assert.equal(WEAPONS.battle.fireMode, "semi");
  assert.ok(WEAPONS.pdw.fireInterval < WEAPONS.smg.fireInterval);
  assert.ok(WEAPONS.autoshotgun.fireInterval < WEAPONS.shotgun.fireInterval);
  assert.equal(shotDirections("autoshotgun", { x: 0, y: 0, z: -1 }).length, 6);
});

test("SMG damage, fire cadence and ammunition ignore forged client weapon claims", () => {
  const { room, player } = readyRoom("smg");
  assert.equal(player.ammo, WEAPONS.smg.magSize);
  assert.equal(player.reserve, WEAPONS.smg.reserve);
  const shot = { direction: { x: 0, y: -0.1, z: -0.995 }, weaponId: "marksman", damage: 999 };
  const first = shoot(room, "one", shot, 1000);
  assert.equal(first.damage, WEAPONS.smg.bodyDamage);
  assert.equal(shoot(room, "one", shot, 1094).reason, "Fire rate");
  assert.equal(shoot(room, "one", shot, 1095).ok, true);
  assert.equal(player.ammo, WEAPONS.smg.magSize - 2);
  player.ammo = 0;
  assert.equal(reload(room, "one", 2000), true);
  assert.equal(player.reloadDuration, WEAPONS.smg.reloadMs);
  tickRoom(room, 0, 2000 + WEAPONS.smg.reloadMs);
  assert.equal(player.ammo, WEAPONS.smg.magSize);
  assert.equal(player.reserve, WEAPONS.smg.reserve - WEAPONS.smg.magSize);
});

test("marksman headshot, slower cadence and tactical reload are authoritative", () => {
  const { room, player } = readyRoom("marksman");
  const shot = { direction: { x: 0, y: 0.04, z: -0.9992 }, weaponId: "smg", damage: 1 };
  const first = shoot(room, "one", shot, 1000);
  assert.equal(first.hitZone, "head");
  assert.equal(first.damage, WEAPONS.marksman.headDamage);
  assert.equal(shoot(room, "one", shot, 1429).reason, "Fire rate");
  assert.equal(shoot(room, "one", shot, 1430).ok, true);
  assert.equal(reload(room, "one", 2000), true);
  assert.equal(player.reloadDuration, WEAPONS.marksman.tacticalReloadMs);
  tickRoom(room, 0, 2000 + WEAPONS.marksman.tacticalReloadMs);
  assert.equal(player.ammo, WEAPONS.marksman.magSize);
});

test("earned sniper has six rounds and server-authoritative high-damage, slow fire", () => {
  const { room, player } = readyRoom("sniper");
  assert.equal(player.ammo, 6);
  const shot = { direction: { x: 0, y: .04, z: -.9992 }, damage: 9999 };
  const hit = shoot(room, "one", shot, 2000);
  assert.equal(hit.hitZone, "head");
  assert.equal(hit.damage, WEAPONS.sniper.headDamage);
  assert.equal(shoot(room, "one", shot, 3000).reason, "Fire rate");
  assert.equal(shoot(room, "one", shot, 3050).ok, true);
  assert.equal(player.ammo, 4);
});

test("buckshot directions are deterministic, normalized and bounded, including vertical aim", () => {
  for (const direction of [{ x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 }]) {
    const rays = shotDirections("shotgun", direction);
    assert.equal(rays.length, 8);
    assert.deepEqual(rays, shotDirections("shotgun", direction));
    assert.deepEqual(rays[0], direction);
    for (const ray of rays) {
      assert.ok(Math.abs(Math.hypot(ray.x, ray.y, ray.z) - 1) < 1e-12);
      const alignment = ray.x * direction.x + ray.y * direction.y + ray.z * direction.z;
      assert.ok(alignment >= Math.cos(WEAPONS.shotgun.pelletSpread));
    }
  }
  assert.deepEqual(shotDirections("rifle", { x: 0, y: 0, z: -1 }), [{ x: 0, y: 0, z: -1 }]);
  assert.ok(Number.isFinite(offsetShotDirection({ x: 0, y: -1, z: 0 }, .02, .02).x));
});

test("Breacher consumes one shell for eight authoritative pellets and applies range falloff", () => {
  const { room, player } = readyRoom("shotgun");
  const result = shoot(room, "one", {
    direction: { x: 0, y: -0.1, z: -0.995 },
    weaponId: "sniper", damage: 9999, pellets: 500, pelletSpread: 0
  }, 1000);
  assert.equal(result.rays.length, 8);
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].pellets, 8);
  assert.equal(result.damage, WEAPONS.shotgun.bodyDamage * 8);
  assert.equal(player.ammo, WEAPONS.shotgun.magSize - 1);
  assert.equal(room.enemies.get("target").health, 500 - result.damage);
  assert.equal(shoot(room, "one", { direction: { x: 0, y: 0, z: -1 } }, 1679).reason, "Fire rate");
  assert.equal(damageForHit("shotgun", "body", 8), 10);
  assert.equal(damageForHit("shotgun", "body", 17), 6);
  assert.equal(damageForHit("shotgun", "body", 26), 2);
  assert.equal(damageForHit("shotgun", "head", 26), 3);
  assert.equal(damageForHit("rifle", "body", 80), WEAPONS.rifle.bodyDamage);
});

test("buckshot can hit two adjacent targets but awards each elimination only once", () => {
  const { room, player } = readyRoom("shotgun");
  room.enemies.clear();
  for (const [id, offset] of [["left", -.88], ["right", .88]]) {
    room.enemies.set(id, {
      id, type: "drone", health: 1, maxHealth: 1,
      position: { x: player.position.x + offset, y: 1, z: 5 }
    });
  }
  const result = shoot(room, "one", { direction: { x: 0, y: -.1, z: -.995 } }, 1000);
  assert.equal(result.hits.length, 2);
  assert.equal(result.kills, 2);
  assert.equal(player.kills, 2);
  assert.equal(room.enemies.size, 0);
  assert.equal(player.ammo, 7);
  assert.equal(result.hits.reduce((count, hit) => count + hit.pellets, 0), 8);
});

test("every pellet stops at shared cover and targets outside shotgun range remain unharmed", () => {
  const { room, player } = readyRoom("shotgun");
  player.position = { x: -6, y: 1.1, z: 6 };
  room.enemies.get("target").position = { x: -6, y: 1, z: -6 };
  const blocked = shoot(room, "one", { direction: { x: 0, y: 0, z: -1 } }, 1000);
  assert.equal(blocked.hit, false);
  assert.ok(blocked.rays.every((ray) => ray.impact === "cover"));
  assert.equal(room.enemies.get("target").health, 500);
  player.position = { x: -39, y: 1.7, z: 20 };
  room.enemies.get("target").position = { x: -39, y: 1, z: -30 };
  const distant = shoot(room, "one", {
    direction: { x: 0, y: 0, z: -1 }, range: 1000
  }, 2000);
  assert.equal(distant.hit, false);
  assert.equal(room.enemies.get("target").health, 500);
});

test("Bastion has distinct sustained-fire spread, capacity and heavy reload timings", () => {
  const { room, player } = readyRoom("lmg");
  assert.equal(player.ammo, 60);
  assert.equal(player.reserve, 240);
  const aim = { direction: { x: 0, y: -.1, z: -.995 } };
  const first = shoot(room, "one", aim, 1000);
  assert.equal(first.damage, WEAPONS.lmg.bodyDamage);
  assert.equal(shoot(room, "one", aim, 1104).reason, "Fire rate");
  const sustained = shoot(room, "one", aim, 1105);
  assert.ok(sustained.spread > first.spread);
  assert.equal(player.ammo, 58);
  assert.equal(reload(room, "one", 2000), true);
  assert.equal(player.reloadDuration, WEAPONS.lmg.tacticalReloadMs);
  tickRoom(room, 0, 2000 + WEAPONS.lmg.tacticalReloadMs);
  assert.equal(player.ammo, 60);
  player.ammo = 0;
  assert.equal(reload(room, "one", 7000), true);
  assert.equal(player.reloadDuration, WEAPONS.lmg.reloadMs);
  assert.ok(WEAPONS.lmg.aimSpeed < WEAPONS.shotgun.aimSpeed);
});
