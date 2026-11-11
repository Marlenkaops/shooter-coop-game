import { levelForXp } from "./progression.js";

export const MODES = Object.freeze({
  campaign: Object.freeze({ id: "campaign", name: "Co-op survival", level: 1, waves: 5,
    description: "Five waves. Ordered campaign victories advance your campaign." }),
  blitz: Object.freeze({ id: "blitz", name: "Co-op Blitz", level: 1, waves: 3,
    description: "Three escalating waves. Earn loot and XP without campaign credit." }),
  raid: Object.freeze({ id: "raid", name: "Raid", level: 1, waves: 3,
    description: "1–4 operators. Secure the uplink, recover the encrypted cache, then defeat the armored commander and escorts. Earn loot, XP and tokens without campaign credit." }),
  operation: Object.freeze({ id: "operation", name: "Team operation", level: 1, waves: 4,
    description: "1–4 operators. Defend, escort, synchronize two hack terminals and extract together. Solo needs one terminal. Teamwork XP; no campaign credit." }),
  practice: Object.freeze({ id: "practice", name: "Shooting range", level: 1, waves: 0,
    description: "Solo practice with resettable targets and unlimited reserve ammo. No XP, tokens, loot or campaign rewards." }),
  ffa: Object.freeze({ id: "ffa", name: "Free-for-All", level: 5, waves: 0,
    description: "2–4 players. First to 12 eliminations or the best score after three minutes." })
});
export const MAX_ROOM_PLAYERS = 4;
export const FFA_DURATION_MS = 180_000;
export const FFA_SCORE_LIMIT = 12;

export function canAccessMode(xp, id) {
  return Object.hasOwn(MODES, id) && levelForXp(xp) >= MODES[id].level;
}
