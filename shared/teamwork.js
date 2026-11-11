export const DEFAULT_CLASS = "assault";
export const SQUAD_CLASSES = Object.freeze({
  medic: Object.freeze({ name: "Medic", ability: "Triage pulse", cooldownMs: 25000,
    description: "Heal nearby allies for 30 HP (50 in an engineer station). Revive in 1.5 seconds." }),
  assault: Object.freeze({ name: "Assault", ability: "Rally", cooldownMs: 30000,
    description: "Nearby allies gain 20 guard for 8 seconds. Rallied shots deal 25% more damage to recon-scanned enemies." }),
  recon: Object.freeze({ name: "Recon", ability: "Sweep", cooldownMs: 25000,
    description: "Scan visible enemies within 22 m for 8 seconds. Combine with Assault Rally for bonus damage." }),
  engineer: Object.freeze({ name: "Engineer", ability: "Field station", cooldownMs: 30000,
    description: "Place a 12-second station: one magazine per ally, 30% damage reduction and faster revives within 4 m." })
});
export const TEAM_STATS = Object.freeze(["totalAssists", "totalRevives", "totalObjectiveScore", "teamworkXp"]);
export const DOWNED_SPEED = .9;
export const BLEEDOUT_MS = 20000;
export const REVIVE_REACH = 3;
export const TEAM_XP_CAP = 250;
export const TEAM_OBJECTIVES = Object.freeze([
  Object.freeze({ kind: "defend", title: "Defend the relay", hint: "Hold the relay and clear enemies within 6 m.", requiredMs: 10000 }),
  Object.freeze({ kind: "escort", title: "Escort the relay drone", hint: "Stay within 5 m. The drone stops near enemies; clear its route.", requiredMs: 1 }),
  Object.freeze({ kind: "hack", title: "Synchronize the terminals", hint: "Hold Interact at a terminal. Two operators must use different terminals; solo needs one.", requiredMs: 5000 }),
  Object.freeze({ kind: "extract", title: "Extract the fireteam", hint: "Clear the sector and gather every connected operator in the extraction zone.", requiredMs: 5000 })
]);
export const cooperativeMode = (mode) => !["practice", "ffa"].includes(mode);
export const ableOperator = (player) => player.connected && player.health > 0 && !player.deadUntil && !player.downedUntil;
export function validTeamMetadata(record) {
  return (record.classId === undefined || typeof record.classId === "string" && Object.hasOwn(SQUAD_CLASSES, record.classId)) &&
    TEAM_STATS.every((key) => record[key] === undefined || Number.isSafeInteger(record[key]) && record[key] >= 0);
}
