export const WEAPONS = Object.freeze({
  rifle: Object.freeze({
    id: "rifle", name: "AR-17 Rifle", category: "Balanced assault", cost: 0,
    description: "Reliable all-rounder · controlled bursts",
    magSize: 24, reserve: 120, fireInterval: 140, bodyDamage: 20, headDamage: 40,
    reloadMs: 2100, tacticalReloadMs: 1650, spreadMultiplier: 1, recoil: 0.38,
    aimSpeed: 10, model: "rifle", optic: Object.freeze({ zoom: 1, reticle: "holo", label: "Holographic 1x" })
  }),
  smg: Object.freeze({
    id: "smg", name: "Viper SMG", category: "Close quarters", cost: 120,
    description: "Fast handling · larger magazine · lower damage",
    magSize: 36, reserve: 180, fireInterval: 95, bodyDamage: 12, headDamage: 24,
    reloadMs: 1800, tacticalReloadMs: 1400, spreadMultiplier: 1.35, recoil: 0.27,
    aimSpeed: 16, model: "smg", optic: Object.freeze({ zoom: 1, reticle: "dot", label: "Reflex 1x" })
  }),
  marksman: Object.freeze({
    id: "marksman", name: "Longwatch DMR", category: "Precision rifle", cost: 280,
    description: "Slow firing · high damage · precise shots",
    magSize: 12, reserve: 72, fireInterval: 430, bodyDamage: 38, headDamage: 76,
    reloadMs: 2350, tacticalReloadMs: 1900, spreadMultiplier: 0.65, recoil: 0.65,
    aimSpeed: 8.5, model: "marksman", optic: Object.freeze({ zoom: 3, reticle: "chevron", label: "Prism 3x" })
  }),
  sniper: Object.freeze({
    id: "sniper", name: "Sentinel SR", category: "Campaign reward", cost: 0,
    description: "Clear operations 01 and 02 in order · 6× scope",
    magSize: 6, reserve: 36, fireInterval: 1050, bodyDamage: 82, headDamage: 160,
    reloadMs: 2900, tacticalReloadMs: 2350, spreadMultiplier: 0.35, recoil: 0.82,
    aimSpeed: 5.5, model: "sniper", optic: Object.freeze({ zoom: 6, reticle: "mildot", label: "Precision 6x" })
  }),
  shotgun: Object.freeze({
    id: "shotgun", name: "Rook-12 Breacher", category: "Semi-auto shotgun", cost: 160,
    description: "Eight buckshot pellets · devastating up close · tap to fire",
    magSize: 8, reserve: 48, fireInterval: 680, bodyDamage: 10, headDamage: 15,
    reloadMs: 2600, tacticalReloadMs: 2050, spreadMultiplier: 1.1, recoil: 0.76,
    fireMode: "semi", pellets: 8, pelletSpread: 0.075, range: 38,
    falloffStart: 8, falloffEnd: 26, minimumDamage: 0.2, aimSpeed: 12,
    model: "shotgun", optic: Object.freeze({ zoom: 1, reticle: "ring", label: "Wide ring 1x" })
  }),
  lmg: Object.freeze({
    id: "lmg", name: "Bastion K60", category: "Support machine gun", cost: 340,
    description: "60-round box · sustained fire · heavy handling and reload",
    magSize: 60, reserve: 240, fireInterval: 105, bodyDamage: 18, headDamage: 34,
    reloadMs: 3850, tacticalReloadMs: 3150, spreadMultiplier: 1.65, recoil: 0.46,
    aimSpeed: 6, model: "lmg", optic: Object.freeze({ zoom: 2, reticle: "cross", label: "Support 2x" })
  }),
  carbine: Object.freeze({
    id: "carbine", name: "Kestrel C9", category: "Suppressed scout carbine", cost: 230,
    description: "Quick semi-auto taps · compact suppressor · 2x scout optic",
    magSize: 20, reserve: 140, fireInterval: 220, bodyDamage: 28, headDamage: 56,
    reloadMs: 1900, tacticalReloadMs: 1450, spreadMultiplier: .55, recoil: .32, fireMode: "semi",
    aimSpeed: 14, model: "carbine", optic: Object.freeze({ zoom: 2, reticle: "chevron", label: "Scout 2x" })
  }),
  pdw: Object.freeze({
    id: "pdw", name: "Mako P48", category: "Compact personal defense", cost: 200,
    description: "48-round top magazine · rapid fire · fine blue reflex",
    magSize: 48, reserve: 192, fireInterval: 80, bodyDamage: 10, headDamage: 21,
    reloadMs: 2250, tacticalReloadMs: 1750, spreadMultiplier: 1.5, recoil: .21,
    aimSpeed: 15, model: "pdw", optic: Object.freeze({ zoom: 1, reticle: "dot", label: "Micro reflex 1x" })
  }),
  battle: Object.freeze({
    id: "battle", name: "Atlas B14", category: "Heavy battle rifle", cost: 420,
    description: "Bullpup receiver · powerful semi-auto shots · 4x combat optic",
    magSize: 14, reserve: 84, fireInterval: 580, bodyDamage: 49, headDamage: 98,
    reloadMs: 2750, tacticalReloadMs: 2150, spreadMultiplier: .5, recoil: .72,
    fireMode: "semi", aimSpeed: 8, model: "battle",
    optic: Object.freeze({ zoom: 4, reticle: "cross", label: "Combat 4x" })
  }),
  pistol: Object.freeze({
    id: "pistol", name: "Kite P12", category: "Compact service pistol", cost: 90,
    description: "12-round grip magazine · fast semi-auto taps · light handling",
    magSize: 12, reserve: 84, fireInterval: 210, bodyDamage: 24, headDamage: 48,
    reloadMs: 1500, tacticalReloadMs: 1150, spreadMultiplier: .9, recoil: .30,
    fireMode: "semi", aimSpeed: 17, range: 55, model: "pistol",
    optic: Object.freeze({ zoom: 1, reticle: "dot", label: "Pistol reflex 1x" })
  }),
  heavyPistol: Object.freeze({
    id: "heavyPistol", name: "Ember H8", category: "Suppressed heavy pistol", cost: 210,
    description: "Eight powerful rounds · long slide and suppressor · deliberate semi-auto fire",
    magSize: 8, reserve: 56, fireInterval: 490, bodyDamage: 45, headDamage: 90,
    reloadMs: 1900, tacticalReloadMs: 1450, spreadMultiplier: .65, recoil: .66,
    fireMode: "semi", aimSpeed: 13, range: 70, model: "heavyPistol",
    optic: Object.freeze({ zoom: 1, reticle: "holo", label: "Heavy reflex 1x" })
  }),
  jackolantern: Object.freeze({
    id: "jackolantern", name: "Jack-o'-Six", category: "Halloween lantern repeater", cost: 0,
    event: "halloween-2026", description: "Event-only · six shells · nine-pellet fan · lantern cage and copper twin tubes",
    magSize: 6, reserve: 42, fireInterval: 900, bodyDamage: 9, headDamage: 14,
    reloadMs: 2750, tacticalReloadMs: 2200, spreadMultiplier: 1.15, recoil: .84,
    fireMode: "semi", pellets: 9, pelletSpread: .068, range: 34,
    falloffStart: 7, falloffEnd: 25, minimumDamage: .18, aimSpeed: 10,
    model: "jackolantern", optic: Object.freeze({ zoom: 1, reticle: "ring", label: "Lantern ring 1x" })
  }),
  graveglass: Object.freeze({
    id: "graveglass", name: "Graveglass G9", category: "Halloween suppressed precision", cost: 0,
    event: "halloween-2026", description: "Event-only · nine obsidian rounds · quiet semi-auto fire · spectral 3x prism",
    magSize: 9, reserve: 63, fireInterval: 390, bodyDamage: 43, headDamage: 86,
    reloadMs: 2300, tacticalReloadMs: 1800, spreadMultiplier: .42, recoil: .58,
    fireMode: "semi", aimSpeed: 11, range: 85, model: "graveglass",
    optic: Object.freeze({ zoom: 3, reticle: "chevron", label: "Spectral prism 3x" })
  }),
  autoshotgun: Object.freeze({
    id: "autoshotgun", name: "Cyclone D12", category: "Automatic drum shotgun", cost: 390,
    description: "12-shell drum · six-pellet automatic fire · tight 1.5x ring optic",
    magSize: 12, reserve: 60, fireInterval: 410, bodyDamage: 8, headDamage: 12,
    reloadMs: 3400, tacticalReloadMs: 2800, spreadMultiplier: 1.3, recoil: .62,
    pellets: 6, pelletSpread: .085, range: 32, falloffStart: 6, falloffEnd: 22, minimumDamage: .2,
    aimSpeed: 9, model: "autoshotgun", optic: Object.freeze({ zoom: 1.5, reticle: "ring", label: "Assault ring 1.5x" })
  })
});

export const DEFAULT_WEAPON_ID = "rifle";
export const TOKENS_PER_KILL = 6;

export function weaponFor(id) {
  return Object.hasOwn(WEAPONS, id) ? WEAPONS[id] : WEAPONS[DEFAULT_WEAPON_ID];
}

export function offsetShotDirection(direction, horizontal, vertical) {
  const rightLength = Math.hypot(direction.x, direction.z);
  const right = rightLength > 1e-8
    ? { x: -direction.z / rightLength, y: 0, z: direction.x / rightLength }
    : { x: 1, y: 0, z: 0 };
  const up = {
    x: -direction.y * right.z,
    y: direction.x * right.z - direction.z * right.x,
    z: direction.y * right.x
  };
  const adjusted = {
    x: direction.x + right.x * horizontal + up.x * vertical,
    y: direction.y + right.y * horizontal + up.y * vertical,
    z: direction.z + right.z * horizontal + up.z * vertical
  };
  const length = Math.hypot(adjusted.x, adjusted.y, adjusted.z);
  return { x: adjusted.x / length, y: adjusted.y / length, z: adjusted.z / length };
}

export function shotDirections(weaponId, direction) {
  const weapon = weaponFor(weaponId);
  if (!weapon.pellets) return [direction];
  return Array.from({ length: weapon.pellets }, (_, index) => {
    if (index === 0) return direction;
    const angle = index * 2.399963229728653;
    const radius = weapon.pelletSpread * Math.sqrt(index / (weapon.pellets - 1));
    return offsetShotDirection(direction, Math.cos(angle) * radius, Math.sin(angle) * radius);
  });
}

export function damageForHit(weaponId, hitZone, distance) {
  const weapon = weaponFor(weaponId);
  const damage = hitZone === "head" ? weapon.headDamage : weapon.bodyDamage;
  if (!weapon.falloffEnd) return damage;
  const falloff = Math.max(0, Math.min(1,
    (distance - weapon.falloffStart) / (weapon.falloffEnd - weapon.falloffStart)));
  return Math.max(1, Math.round(damage * (1 - falloff * (1 - weapon.minimumDamage))));
}

export function tokensForMatch(wave, kills, won) {
  return Math.max(0, Math.floor(wave) * 18 + Math.max(0, Math.floor(kills)) * TOKENS_PER_KILL + (won ? 45 : 0));
}
