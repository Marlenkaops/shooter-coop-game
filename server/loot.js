import crypto from "node:crypto";
import { MAX_MEDKITS, canOccupyPosition, groundedPosition, hasLineOfSight } from "../shared/gameplay.js";
import { WEAPONS, weaponFor } from "../shared/weapons.js";
import { HALLOWEEN_EVENT, eventContentAvailable } from "../shared/events.js";
import { effectiveWeapon } from "../shared/career.js";
import { applyCombatLoadout } from "./combat-loadout.js";

export const MAX_LOOT = 64;
export const LOOT_REACH = 3.2;
const randomUnit = () => crypto.randomInt(0x1000000) / 0x1000000;
const common = ["smg", "carbine", "pdw", "shotgun", "pistol"];
const advanced = ["marksman", "battle", "lmg", "autoshotgun", "sniper", "heavyPistol"];

function weaponLoot(wave, random) {
  const pool = wave >= 3 ? [...common, ...advanced] : common;
  return pool[Math.floor(random() * pool.length)];
}

export function restockChests(room, random = randomUnit) {
  for (const [id, item] of room.loot) if (item.source === "chest") room.loot.delete(id);
  const quadrants = [
    [[-34, 0], [-8, 13], [-12, 12], [-14, 16], [-16, 8], [-8, 24]],
    [[34, 0], [8, 13], [12, 12], [14, 16], [16, 8], [8, 24]],
    [[-16, -13], [-12, -18], [-20, -8], [-26, -28], [-34, -34]],
    [[16, -13], [12, -18], [20, -8], [26, -28], [34, -34]]
  ];
  for (const [index, candidates] of quadrants.entries()) {
    while (room.loot.size >= MAX_LOOT) {
      const oldest = [...room.loot.values()].find((item) => item.source !== "chest");
      if (!oldest) throw new Error("Loot capacity exhausted by chests");
      room.loot.delete(oldest.id);
    }
    const location = candidates.find(([x, z]) => canOccupyPosition(room.geometry || room.mapId, groundedPosition(room.geometry || room.mapId, { x, z }), .75));
    if (!location) throw new Error(`No safe loot chest position on ${room.mapId}`);
    const id = `chest-${room.lootGeneration++}`;
    const eventWeapon = HALLOWEEN_EVENT.active && room.mapId === HALLOWEEN_EVENT.mapId
      ? HALLOWEEN_EVENT.weaponIds[index] : null;
    room.loot.set(id, { id, source: "chest", kind: "weapon", weaponId: eventWeapon || weaponLoot(room.wave, random),
      position: groundedPosition(room.geometry || room.mapId, { x: location[0], z: location[1] }, .42), expiresAt: null });
  }
}

export function dropEnemyLoot(room, enemy, now, random = randomUnit) {
  while (room.loot.size >= MAX_LOOT) {
    const oldest = [...room.loot.values()].find((item) => item.source !== "chest");
    if (!oldest) throw new Error("Loot capacity exhausted by chests");
    room.loot.delete(oldest.id);
  }
  const roll = random();
  const gun = roll < (enemy.type === "brute" ? .65 : enemy.type === "sentinel" ? .45 : .22);
  const kind = gun ? "weapon" : roll >= .8 ? "medkit" : "ammo";
  const id = `drop-${room.lootGeneration++}`;
  room.loot.set(id, { id, source: "enemy", kind,
    ...(gun ? { weaponId: weaponLoot(room.wave, random) } : {}),
    position: groundedPosition(room.geometry || room.mapId, enemy.position, gun ? .15 : .18),
    expiresAt: now + 120_000 });
}

export function collectLoot(room, socketId, id, grantWeapon, effect = (work) => work()) {
  const player = room.players.get(socketId), loot = typeof id === "string" ? room.loot.get(id) : null;
  if (!player || !loot || !["playing", "between"].includes(room.phase) || player.deadUntil || player.downedUntil) {
    return { ok: false, error: "Loot unavailable." };
  }
  if (loot.expiresAt !== null && loot.expiresAt <= Date.now()) {
    return { ok: false, error: "This drop has expired." };
  }
  if (loot.kind === "weapon" && !eventContentAvailable(loot.weaponId)) {
    return { ok: false, error: "This weapon's event has ended." };
  }
  if (Math.hypot(player.position.x - loot.position.x, player.position.y - loot.position.y,
    player.position.z - loot.position.z) > LOOT_REACH || !hasLineOfSight(room.geometry || room.mapId,
    player.position, { ...loot.position, y: loot.position.y + .2 })) {
    return { ok: false, error: "Move closer to the loot, with a clear path." };
  }
  if (loot.kind === "medkit") {
    if (player.medkits >= MAX_MEDKITS) return { ok: false, error: "Medkits are full; leave this case for a teammate." };
    const medkits = player.medkits + 1;
    effect(() => { player.medkits = medkits; room.loot.delete(id); });
    return { ok: true, kind: "medkit", granted: 1, medkits };
  }
  if (loot.kind === "weapon" && !player.profile.ownedWeapons.includes(loot.weaponId)) {
    const saved = grantWeapon(player.identity, loot.weaponId, true);
    if (!saved.ok) return saved;
    effect(() => {
      player.profile = saved.profile;
      const weapon = applyCombatLoadout(player, room, loot.weaponId);
      Object.assign(player, { weaponId: loot.weaponId, ammo: weapon.magSize,
      reserve: Math.min(weapon.reserve, weapon.magSize * 2), reloadingUntil: 0, reloadDuration: 0, reloadType: null,
      lastShot: Date.now(), shotSequence: 0 });
      room.loot.delete(id);
    });
    return { ok: true, kind: "weapon", weaponId: loot.weaponId, profile: saved.profile };
  }
  const weapon = effectiveWeapon(player.weaponId, player);
  const granted = Math.min(weapon.reserve - player.reserve, weapon.magSize * (loot.source === "chest" ? 2 : 1));
  if (granted <= 0) return { ok: false, error: "Ammunition is full; leave this loot for a teammate." };
  const reserve = player.reserve + granted;
  effect(() => { player.reserve = reserve; room.loot.delete(id); });
  return { ok: true, kind: "ammo", granted, reserve };
}

export function supportPlayer(player, operation) {
  if (!player || player.deadUntil || player.downedUntil) return { ok: false, error: "Player is down or not in an active mission." };
  if (operation === "heal") player.health = 100;
  else if (operation === "ammo") {
    const weapon = effectiveWeapon(player.weaponId, player);
    Object.assign(player, { ammo: weapon.magSize, reserve: weapon.reserve, reloadingUntil: 0, reloadDuration: 0, reloadType: null });
  } else return { ok: false, error: "Unknown support action." };
  return { ok: true };
}
