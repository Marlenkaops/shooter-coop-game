export const DEFAULT_DIFFICULTY = "standard";
export const AI_DIFFICULTIES = Object.freeze({
  recruit: Object.freeze({
    name: "Recruit", description: "Fewer simultaneous threats. Squads cover their rushers; longer regroup windows.",
    memoryMs: 4000, flankRiflemen: false, useCover: false,
    buildAttackers: 1, peakAttackers: 2, recoveryMs: 5000
  }),
  standard: Object.freeze({
    name: "Standard", description: "Fire and movement. Riflemen use cover while support covers flanking rushers.",
    memoryMs: 6000, flankRiflemen: false, useCover: true,
    buildAttackers: 2, peakAttackers: 3, recoveryMs: 4000
  }),
  veteran: Object.freeze({
    name: "Veteran", description: "Coordinated crossfire. Riflemen also flank; squads remember contacts longer.",
    memoryMs: 8000, flankRiflemen: true, useCover: true,
    buildAttackers: 3, peakAttackers: 4, recoveryMs: 3000
  }),
  nightmare: Object.freeze({
    name: "Nightmare", description: "Level 10. Relentless coordinated crossfire, persistent contacts and very short regroup windows.",
    memoryMs: 10000, flankRiflemen: true, useCover: true,
    buildAttackers: 5, peakAttackers: 7, recoveryMs: 1500
  })
});

export const ENEMY_ROLES = Object.freeze({
  rusher: Object.freeze({ name: "Rusher", weaponId: "smg", range: 1.85, windupMs: 340, cooldownMs: 1050 }),
  rifleman: Object.freeze({ name: "Rifleman", weaponId: "rifle", range: 8, windupMs: 650, cooldownMs: 1500 }),
  sniper: Object.freeze({ name: "Sniper", weaponId: "marksman", range: 11, windupMs: 900, cooldownMs: 1800 }),
  heavy: Object.freeze({ name: "Heavy", weaponId: "lmg", range: 7, windupMs: 850, cooldownMs: 1650 }),
  support: Object.freeze({ name: "Support", weaponId: "lmg", range: 9, windupMs: 700, cooldownMs: 1150 })
});

export const ENEMY_CALLOUTS = Object.freeze({
  contact: "Contact! Weapons up!",
  investigate: "Contact reported. Check that lane.",
  sound: "Heard shots. Check that lane.",
  search: "Lost contact. Sweep the sector.",
  flank: "Going around! Cover me!",
  suppress: "Covering fire! Move!",
  recover: "Hit! Falling back!",
  cover: "Taking cover!"
});

export const DIRECTOR_LABELS = Object.freeze({
  buildup: "Contact building",
  peak: "Enemy offensive",
  recovery: "Enemy regrouping"
});
