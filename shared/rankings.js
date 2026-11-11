import { ACHIEVEMENTS, careerFor, parseMatchProgress, periodFor, seasonAt } from "./career.js";
import { MAPS } from "./progression.js";
import { WEAPONS } from "./weapons.js";

export const RANKED_MIN_MS = 30000;
const weapons = Object.values(WEAPONS);
const fastestTriggerMs = Math.min(...weapons.map((weapon) => weapon.fireInterval));
const mostPellets = Math.max(...weapons.map((weapon) => weapon.pellets || 1));
const maxTriggerDamage = Math.max(...weapons.map((weapon) => Math.ceil(weapon.headDamage * 1.25) * (weapon.pellets || 1)));
export const RANK_PERIODS = Object.freeze({ daily: "Today", weekly: "This week", monthly: "This month", season: "This season", allTime: "All time" });
export const RANK_METRICS = Object.freeze({ score: "Teamwork score", kills: "Eliminations", assists: "Assists", revives: "Revives",
  objectiveScore: "Objective score", accuracy: "Accuracy (20+ shots)", damage: "Damage", fastest: "Fastest clear", difficulty: "Highest clear" });
export const RANK_DIFFICULTIES = ["Unrecorded", "Recruit", "Standard", "Veteran", "Nightmare"];
export const RANK_MODES = ["campaign", "blitz", "raid", "operation"];
export const publicTag = (id) => id.slice(0, 8).toUpperCase();
export const validTag = (tag) => typeof tag === "string" && /^[A-Z0-9_-]{1,8}$/i.test(tag);
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const only = (v, keys) => object(v) && Object.keys(v).every((k) => keys.includes(k));
const uint = (v) => Number.isSafeInteger(v) && v >= 0;
const tags = (v, max) => Array.isArray(v) && v.length <= max && new Set(v).size === v.length && v.every((tag) => validTag(tag) && tag === tag.toUpperCase());
export const validRoute = (route) => typeof route === "string" && MAPS.some((map) => RANK_MODES.some((mode) => route === `${map.id}:${mode}`));
const fields = ["matches", "wins", "xp", "kills", "assists", "revives", "objectiveScore", "shots", "hits", "damage", "score", "highestDifficulty"];
export function emptyRankStats() {
  return { ...Object.fromEntries(fields.map((key) => [key, 0])), bestTimes: {} };
}
export function rankingPeriod(period, at = Date.now()) {
  if (period === "allTime") return "allTime";
  if (period === "season") return seasonAt(at).id;
  if (period === "monthly") { const date = new Date(at); return `m${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`; }
  return periodFor(period, at);
}
export function newRanking(at) {
  return { version: 1, since: at, lifetime: emptyRankStats(), periods: {} };
}
export function validRankStats(stats) {
  return only(stats, [...fields, "bestTimes"]) && fields.every((key) => uint(stats[key])) && stats.wins <= stats.matches &&
    stats.hits <= stats.shots && stats.highestDifficulty <= 4 && object(stats.bestTimes) &&
    stats.score === stats.kills * 100 + stats.assists * 50 + stats.revives * 150 + stats.objectiveScore + stats.wins * 250 &&
    Object.entries(stats.bestTimes).every(([route, value]) => validRoute(route) && Array.isArray(value) && value.length === 2 &&
      uint(value[0]) && value[0] >= RANKED_MIN_MS && Number.isInteger(value[1]) && value[1] >= 1 && value[1] <= 4);
}
export function validRanking(ranking) {
  return only(ranking, ["version", "since", "lifetime", "periods"]) && ranking.version === 1 && uint(ranking.since) &&
    validRankStats(ranking.lifetime) && object(ranking.periods) && Object.keys(ranking.periods).length <= 4 &&
    Object.entries(ranking.periods).every(([key, stats]) => /^(?:[dw]-?\d{1,8}|m\d{6}|s\d{1,6})$/.test(key) && validRankStats(stats)) &&
    ["d", "w", "m", "s"].every((prefix) => Object.keys(ranking.periods).filter((key) => key.startsWith(prefix)).length <= 1);
}
export function validRecordMetadata(profile) {
  const social = profile.social;
  return (profile.ranking === undefined || validRanking(profile.ranking)) &&
    (social === undefined || only(social, ["friends", "incoming", "squadTag"]) && tags(social.friends, 100) &&
      tags(social.incoming, 30) && (social.squadTag === null || validTag(social.squadTag) && social.squadTag === social.squadTag.toUpperCase())) &&
    (profile.showcase === undefined || Array.isArray(profile.showcase) && profile.showcase.length <= 3 &&
      new Set(profile.showcase).size === profile.showcase.length &&
      profile.showcase.every((id) => Object.hasOwn(ACHIEVEMENTS, id) && careerFor(profile).achievements.includes(id)));
}
export function validSocialGraph(players, squads = {}) {
  const byTag = new Map();
  for (const [id, player] of Object.entries(players)) {
    const tag = publicTag(id);
    byTag.set(tag, byTag.has(tag) ? null : player);
  }
  for (const [id, player] of Object.entries(players)) {
    const tag = publicTag(id), social = player.social;
    if (!social) continue;
    if (social.friends.some((peer) => peer === tag || !byTag.get(peer)?.social?.friends.includes(tag)) ||
      social.incoming.some((peer) => peer === tag || !byTag.get(peer) || social.friends.includes(peer))) return false;
    if (social.squadTag && (!squads[social.squadTag]?.active || !squads[social.squadTag].members.includes(tag))) return false;
  }
  return Object.values(squads).every((squad) => squad.active
    ? squad.members.every((tag) => byTag.get(tag)?.social?.squadTag === squad.tag) && squad.invites.every((tag) => byTag.get(tag))
    : !squad.members.length && !squad.invites.length);
}
export function validSquads(records) {
  return object(records) && Object.entries(records).every(([tag, squad]) =>
    validTag(tag) && tag === squad.tag && only(squad, ["tag", "name", "active", "members", "invites", "ranking"]) &&
    typeof squad.name === "string" && /^[\p{L}\p{N}][\p{L}\p{N} _-]{2,23}$/u.test(squad.name) &&
    typeof squad.active === "boolean" && tags(squad.members, 4) && tags(squad.invites, 4) &&
    (!squad.active || squad.members.includes(tag)) && squad.members.every((member) => !squad.invites.includes(member)) &&
    validRanking(squad.ranking));
}
export function parseRankingEvidence(reward) {
  const value = JSON.parse(reward.ranking), match = parseMatchProgress(reward.progression);
  if (!only(value, ["version", "mapId", "personalMs", "full", "eligible", "team"]) || value.version !== 1 ||
    !MAPS.some((map) => map.id === value.mapId) || !uint(value.personalMs) || value.personalMs > match.activeMs ||
    typeof value.full !== "boolean" || typeof value.eligible !== "boolean" ||
    !(value.team === null || only(value.team, ["tag", "anchor", "size"]) && validTag(value.team.tag) &&
      typeof value.team.anchor === "boolean" && Number.isInteger(value.team.size) && value.team.size >= 2 && value.team.size <= 4)) {
    throw new Error("Invalid ranked match evidence.");
  }
  return { ...value, match };
}
export function rankedEligibility(reward) {
  if (reward.ranking === undefined) return { ok: false, reason: "Historical result; detailed tracking unavailable." };
  const evidence = parseRankingEvidence(reward), match = evidence.match;
  if (!evidence.eligible) return { ok: false, reason: "Assisted match; ranked credit excluded." };
  if (evidence.personalMs < RANKED_MIN_MS) return { ok: false, reason: "Ranked results need at least 30 seconds of participation." };
  if (!reward.kills && !reward.assists && !reward.revives && !reward.objectiveScore && !match.hits) {
    return { ok: false, reason: "No verified combat or objective contribution." };
  }
  if (match.activeMs > 6 * 60 * 60 * 1000 || match.shots > Math.floor(evidence.personalMs / fastestTriggerMs) + 2 ||
    reward.kills > match.hits * mostPellets || match.damage > match.hits * maxTriggerDamage || reward.kills > 1000 ||
    (reward.assists || 0) > 3000 || (reward.revives || 0) > 30 || (reward.objectiveScore || 0) > 10000 || reward.xp > 100000) {
    return { ok: false, reason: "Result exceeds ranked gameplay bounds." };
  }
  return { ok: true, evidence };
}
export function applyRankedResult(previous, reward, { team = false } = {}) {
  const eligible = rankedEligibility(reward);
  if (!eligible.ok) return previous;
  const { evidence } = eligible, match = evidence.match;
  const result = structuredClone(previous || newRanking(match.at));
  result.since = Math.min(result.since, match.at);
  const count = !team || evidence.team.anchor;
  const won = reward.won && evidence.full && count;
  const increments = { matches: Number(count), wins: Number(won), xp: reward.xp, kills: reward.kills,
    assists: reward.assists || 0, revives: reward.revives || 0, objectiveScore: reward.objectiveScore || 0,
    shots: match.shots, hits: match.hits, damage: match.damage };
  increments.score = increments.kills * 100 + increments.assists * 50 + increments.revives * 150 +
    increments.objectiveScore + increments.wins * 250;
  const update = (stats) => {
    for (const [key, value] of Object.entries(increments)) {
      if (!uint(stats[key] + value)) throw new RangeError("Ranked statistic limit reached.");
      stats[key] += value;
    }
    if (won) {
      const difficulty = RANK_DIFFICULTIES.indexOf(match.difficulty[0].toUpperCase() + match.difficulty.slice(1));
      stats.highestDifficulty = Math.max(stats.highestDifficulty, difficulty);
      const route = `${evidence.mapId}:${match.mode}`, prior = stats.bestTimes[route];
      if (!match.mutators.length && (!prior || match.activeMs < prior[0])) stats.bestTimes[route] = [match.activeMs, difficulty];
    }
  };
  update(result.lifetime);
  for (const period of ["daily", "weekly", "monthly", "season"]) {
    const key = rankingPeriod(period, match.at);
    update(result.periods[key] ||= emptyRankStats());
    const expired = Object.keys(result.periods).filter((id) => id[0] === key[0]).sort((a, b) => Number(b.slice(1)) - Number(a.slice(1))).slice(1);
    for (const id of expired) delete result.periods[id];
  }
  return result;
}
export function metricValue(stats, metric, route = "foundry:campaign") {
  if (!stats) return null;
  if (metric === "fastest") return stats.bestTimes[route]?.[0] ?? null;
  if (metric === "accuracy") return stats.shots >= 20 ? Math.round(stats.hits * 10000 / stats.shots) : null;
  if (metric === "difficulty") return stats.highestDifficulty || null;
  return stats[metric] > 0 ? stats[metric] : null;
}
export function validRankingQuery(input) {
  return only(input, ["period", "metric", "scope", "offset", "route"]) &&
    Object.hasOwn(RANK_PERIODS, input.period) && Object.hasOwn(RANK_METRICS, input.metric) &&
    ["global", "friends", "squads"].includes(input.scope) &&
    (input.offset === undefined || uint(input.offset)) &&
    (input.route === undefined || validRoute(input.route));
}
