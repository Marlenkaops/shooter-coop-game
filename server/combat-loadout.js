import { effectiveWeapon, equippedKit } from "../shared/career.js";

export function applyCombatLoadout(player, room, weaponId = player.weaponId) {
  Object.assign(player, { weaponId, ...equippedKit(player.profile, weaponId, player.classId, room.mode),
    ammoScale: room.mutators?.includes("scarcity") ? .5 : 1 });
  return effectiveWeapon(weaponId, player);
}
