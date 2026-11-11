import { levelForXp } from "./progression.js";
import { SQUAD_CLASSES } from "./teamwork.js";
import { WEAPONS, weaponFor } from "./weapons.js";

const DAY = 86_400_000;
const EPOCH = Date.UTC(2026, 0, 5);
export const SEASON_DAYS = 28;
export const SEASON_TIER_XP = 1000;
export const SEASON_TIERS = 20;
export const ENDGAME_LEVEL = 10;
export const ATTACHMENTS = Object.freeze({
  none: { name: "Standard", level: 1, description: "Original weapon handling." },
  grip: { name: "Control grip", level: 2, description: "15% less spread, 10% less recoil." },
  quick: { name: "Quick-change kit", level: 4, description: "10% faster tactical and empty reloads." },
  reserve: { name: "Reserve carrier", level: 8, description: "One extra magazine of reserve capacity." }
});
export const WEAPON_FINISHES = Object.freeze({
  standard: { name: "Service", level: 1, color: null },
  copper: { name: "Burnished copper", level: 3, color: 0xb47c52 },
  arctic: { name: "Arctic", level: 10, color: 0xa2bbc3 },
  aurora: { name: "Season aurora", level: null, color: 0x638d95 }
});
export const PERKS = Object.freeze({
  none: { name: "No perk", description: "Original operator rules." },
  scavenger: { name: "Prepared", playerLevel: 2, description: "One extra magazine of reserve capacity." },
  triage: { name: "Advanced triage", classId: "medic", description: "Medic pulse heals 10 more HP." },
  loader: { name: "Drilled reload", classId: "assault", description: "10% faster reloads." },
  focus: { name: "Steady focus", classId: "recon", description: "15% less weapon spread." },
  station: { name: "Extended station", classId: "engineer", description: "Engineer station lasts 15 instead of 12 seconds." }
});
export const MUTATORS = Object.freeze({
  scarcity: { name: "Scarce ammunition", description: "Half reserve capacity, including supplies." },
  iron: { name: "No medkits", description: "Medkits cannot be used; rely on Medic and revives." }
});
export const CHALLENGES = Object.freeze({
  "daily-kills": { name: "Daily patrol", cadence: "daily", metric: "kills", target: 12, xp: 150, tokens: 30 },
  "daily-team": { name: "Daily fieldwork", cadence: "daily", metric: "team", target: 3, xp: 150, tokens: 30 },
  "daily-clear": { name: "Daily extraction", cadence: "daily", metric: "wins", target: 1, xp: 200, tokens: 40 },
  "weekly-kills": { name: "Weekly offensive", cadence: "weekly", metric: "kills", target: 200, xp: 1000, tokens: 180 },
  "weekly-team": { name: "Weekly fireteam", cadence: "weekly", metric: "team", target: 25, xp: 750, tokens: 120 },
  "weekly-clear": { name: "Weekly operations", cadence: "weekly", metric: "wins", target: 10, xp: 1000, tokens: 180 }
});
export const ACHIEVEMENTS = Object.freeze({
  firstBlood: { name: "First contact", description: "Earn your first PvE elimination." },
  veteran: { name: "Field veteran", description: "Earn 1,000 PvE eliminations." },
  lifesaver: { name: "No one left behind", description: "Revive 25 allies." },
  coordinator: { name: "Objective specialist", description: "Earn 10,000 objective score." },
  classMaster: { name: "Class specialist", description: "Reach class level 20." },
  weaponMaster: { name: "Weapon master", description: "Reach weapon level 25." },
  nightmare: { name: "Against all odds", description: "Win a Nightmare mission." },
  prestige: { name: "Distinguished service", description: "Earn a prestige rank." }
});
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const uint = (value) => Number.isSafeInteger(value) && value >= 0;
const only = (value, names) => object(value) && Object.keys(value).every((key) => names.includes(key));
const numericMap = (value, names) => object(value) && Object.entries(value).every(([key, xp]) => names.includes(key) && uint(xp));
const uniqueKeys = (values, names) => Array.isArray(values) && new Set(values).size === values.length && values.every((id) => names.includes(id));
const add = (left, right) => {
  if (!uint(left) || !uint(right) || !Number.isSafeInteger(left + right)) throw new RangeError("Progression limit reached.");
  return left + right;
};

export function weaponLevelXp(level) {
  return level <= 1 ? 0 : 40 + 80 * (level - 2) ** 2;
}
export function classLevelXp(level) {
  return level * (level - 1) * 75;
}
export function masteryLevel(xp, kind = "weapon") {
  const maximum = kind === "weapon" ? 25 : 20, threshold = kind === "weapon" ? weaponLevelXp : classLevelXp;
  let level = 1;
  while (level < maximum && xp >= threshold(level + 1)) level++;
  return level;
}
export function periodFor(cadence, at = Date.now()) {
  return cadence === "daily" ? `d${Math.floor(at / DAY)}` : `w${Math.floor((at - EPOCH) / (7 * DAY))}`;
}
export function seasonAt(at = Date.now()) {
  const number = Math.max(0, Math.floor((at - EPOCH) / (SEASON_DAYS * DAY)));
  return { id: `s${number}`, name: `Season ${number + 1}`, startsAt: EPOCH + number * SEASON_DAYS * DAY,
    endsAt: EPOCH + (number + 1) * SEASON_DAYS * DAY };
}
export function newCareer() {
  return { version: 1, classXp: {}, weaponXp: {}, loadouts: {}, perkId: "none", periods: {}, seasons: {},
    achievements: [], prestige: 0, prestigeXp: 0, pveKills: 0, wins: 0, shots: 0, hits: 0, damage: 0 };
}
export function validCareer(record) {
  const c = record.career;
  if (c === undefined) return true;
  return only(c, Object.keys(newCareer())) && c.version === 1 &&
    numericMap(c.classXp, Object.keys(SQUAD_CLASSES)) && numericMap(c.weaponXp, Object.keys(WEAPONS)) &&
    Object.hasOwn(PERKS, c.perkId) && ["prestige", "prestigeXp", "pveKills", "wins", "shots", "hits", "damage"].every((key) => uint(c[key])) &&
    c.hits <= c.shots && uniqueKeys(c.achievements, Object.keys(ACHIEVEMENTS)) &&
    object(c.periods) && object(c.seasons) && object(c.loadouts) && Object.entries(c.loadouts).every(([id, kit]) => Object.hasOwn(WEAPONS, id) &&
      only(kit, ["attachmentId", "finishId"]) && Object.hasOwn(ATTACHMENTS, kit.attachmentId) &&
      Object.hasOwn(WEAPON_FINISHES, kit.finishId) &&
      masteryLevel(c.weaponXp[id] || 0) >= ATTACHMENTS[kit.attachmentId].level &&
      (kit.finishId === "aurora" ? Object.values(c.seasons).some((season) => Array.isArray(season?.claimed) && season.claimed.includes(4)) :
        masteryLevel(c.weaponXp[id] || 0) >= WEAPON_FINISHES[kit.finishId].level)) &&
    object(c.periods) && Object.entries(c.periods).every(([id, progress]) => /^[dw]-?\d{1,8}$/.test(id) &&
      only(progress, ["kills", "team", "wins", "claimed"]) && ["kills", "team", "wins"].every((key) => uint(progress[key])) &&
      uniqueKeys(progress.claimed, Object.keys(CHALLENGES).filter((key) => periodFor(CHALLENGES[key].cadence, EPOCH)[0] === id[0]))) &&
    object(c.seasons) && Object.entries(c.seasons).every(([id, progress]) => /^s\d{1,6}$/.test(id) &&
      only(progress, ["xp", "claimed"]) && uint(progress.xp) && uniqueKeys(progress.claimed,
        Array.from({ length: SEASON_TIERS }, (_, index) => index + 1)) &&
      progress.claimed.every((tier) => progress.xp >= tier * SEASON_TIER_XP));
}
export function careerFor(profile) {
  if (!validCareer(profile)) throw new Error("Invalid saved career progression.");
  return profile.career || newCareer();
}
export function perkUnlocked(profile, id, classId = profile.classId) {
  const perk = PERKS[id];
  return Boolean(perk && (!perk.playerLevel || levelForXp(profile.xp) >= perk.playerLevel) &&
    (!perk.classId || perk.classId === classId && masteryLevel(careerFor(profile).classXp[classId] || 0, "class") >= 3));
}
export function equippedKit(profile, weaponId, classId, mode = "campaign") {
  const c = careerFor(profile);
  const kit = c.loadouts[weaponId] || { attachmentId: "none", finishId: "standard" };
  return { ...kit, perkId: mode === "ffa" || !perkUnlocked(profile, c.perkId, classId) ? "none" : c.perkId,
    attachmentId: mode === "ffa" ? "none" : kit.attachmentId };
}
export function effectiveWeapon(weaponId, kit = {}) {
  const base = weaponFor(weaponId);
  const quick = (kit.attachmentId === "quick" ? .9 : 1) * (kit.perkId === "loader" ? .9 : 1);
  const reserve = base.reserve + base.magSize * (Number(kit.attachmentId === "reserve") + Number(kit.perkId === "scavenger"));
  return { ...base, reserve: Math.max(base.magSize, Math.floor(reserve * (kit.ammoScale ?? 1))),
    reloadMs: Math.round(base.reloadMs * quick), tacticalReloadMs: Math.round(base.tacticalReloadMs * quick),
    spreadMultiplier: base.spreadMultiplier * (kit.attachmentId === "grip" ? .85 : 1) * (kit.perkId === "focus" ? .85 : 1),
    recoil: base.recoil * (kit.attachmentId === "grip" ? .9 : 1) };
}
export function validMutators(values) {
  return uniqueKeys(values, Object.keys(MUTATORS)) && values.length <= 2;
}
export function endgameAllowed(profile, difficulty, mutators = []) {
  return (difficulty !== "nightmare" && !mutators.length) || levelForXp(profile.xp) >= ENDGAME_LEVEL;
}
export function validMatchProgress(value) {
  return only(value, ["classId", "weaponXp", "shots", "hits", "damage", "at", "difficulty", "mutators", "mode", "activeMs"]) &&
    Object.hasOwn(SQUAD_CLASSES, value.classId) && numericMap(value.weaponXp, Object.keys(WEAPONS)) &&
    ["shots", "hits", "damage", "at", "activeMs"].every((key) => uint(value[key])) && value.hits <= value.shots &&
    ["recruit", "standard", "veteran", "nightmare"].includes(value.difficulty) && validMutators(value.mutators) &&
    ["campaign", "blitz", "raid", "operation"].includes(value.mode);
}
export function parseMatchProgress(serialized) {
  if (typeof serialized !== "string" || serialized.length > 4096) throw new Error("Invalid match progression.");
  const value = JSON.parse(serialized);
  if (!validMatchProgress(value)) throw new Error("Invalid match progression.");
  return value;
}
export function applyMatchProgress(profile, reward) {
  const c = structuredClone(careerFor(profile));
  if (reward.progression === undefined) return c;
  const match = parseMatchProgress(reward.progression);
  if (!reward.kills && !reward.assists && !reward.revives && !reward.objectiveScore) return c;
  c.classXp[match.classId] = add(c.classXp[match.classId] || 0, Math.floor(reward.xp / 2));
  for (const [id, xp] of Object.entries(match.weaponXp)) c.weaponXp[id] = add(c.weaponXp[id] || 0, xp);
  for (const key of ["shots", "hits", "damage"]) c[key] = add(c[key], match[key]);
  c.prestigeXp = add(c.prestigeXp, reward.xp);
  c.pveKills = add(c.pveKills, reward.kills);
  c.wins = add(c.wins, Number(reward.won));
  const metrics = { kills: reward.kills, team: (reward.assists || 0) + (reward.revives || 0) + Math.floor((reward.objectiveScore || 0) / 100),
    wins: Number(reward.won) };
  for (const cadence of ["daily", "weekly"]) {
    const key = periodFor(cadence, match.at), progress = c.periods[key] ||= { kills: 0, team: 0, wins: 0, claimed: [] };
    for (const metric of Object.keys(metrics)) progress[metric] = add(progress[metric], metrics[metric]);
  }
  for (const prefix of ["d", "w"]) {
    const expired = Object.keys(c.periods).filter((key) => key.startsWith(prefix))
      .sort((a, b) => Number(b.slice(1)) - Number(a.slice(1))).slice(8);
    for (const key of expired) delete c.periods[key];
  }
  const season = c.seasons[seasonAt(match.at).id] ||= { xp: 0, claimed: [] };
  season.xp = add(season.xp, reward.xp);
  const earned = { firstBlood: c.pveKills >= 1, veteran: c.pveKills >= 1000,
    lifesaver: (profile.totalRevives || 0) + (reward.revives || 0) >= 25,
    coordinator: (profile.totalObjectiveScore || 0) + (reward.objectiveScore || 0) >= 10000,
    classMaster: Object.values(c.classXp).some((xp) => masteryLevel(xp, "class") === 20),
    weaponMaster: Object.values(c.weaponXp).some((xp) => masteryLevel(xp) === 25),
    nightmare: reward.won && match.difficulty === "nightmare" };
  for (const [id, eligible] of Object.entries(earned)) if (eligible && !c.achievements.includes(id)) c.achievements.push(id);
  return c;
}
export function prestigeRequired(rank) {
  return 20000 * (rank + 1) * (rank + 2) / 2;
}
export function claimOffer(profile, request, now = Date.now()) {
  const c = careerFor(profile), { type, key, period } = request;
  if (type === "challenge") {
    const challenge = CHALLENGES[key], progress = c.periods[period];
    if (!challenge || period !== periodFor(challenge.cadence, now) || !progress ||
      progress[challenge.metric] < challenge.target || progress.claimed.includes(key)) return null;
    return { xp: challenge.xp, tokens: challenge.tokens };
  }
  if (type === "season") {
    const tier = Number(key), season = c.seasons[period];
    if (!Number.isInteger(tier) || String(tier) !== key || tier < 1 || tier > SEASON_TIERS ||
      !season || season.xp < tier * SEASON_TIER_XP || season.claimed.includes(tier)) return null;
    return { xp: 0, tokens: tier * 20 };
  }
  if (type === "prestige" && period === "lifetime" && key === String(c.prestige + 1) &&
    c.prestigeXp >= prestigeRequired(c.prestige)) return { xp: 0, tokens: 250 };
  return null;
}
export function applyClaim(profile, reward) {
  const request = { type: reward.claimType, key: reward.claimKey, period: reward.claimPeriod };
  const offer = claimOffer(profile, request, reward.at);
  if (!offer || offer.xp !== reward.xp || offer.tokens !== reward.tokens) throw new Error("Progression reward is not earned.");
  const c = structuredClone(careerFor(profile));
  if (request.type === "challenge") c.periods[request.period].claimed.push(request.key);
  else if (request.type === "season") c.seasons[request.period].claimed.push(Number(request.key));
  else {
    c.prestige++;
    if (!c.achievements.includes("prestige")) c.achievements.push("prestige");
  }
  return c;
}
