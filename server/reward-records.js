import { parseMatchProgress } from "../shared/career.js";
import { parseRankingEvidence } from "../shared/rankings.js";

const validProgress = (value, kills) => {
  if (value === undefined) return true;
  try {
    const match = parseMatchProgress(value);
    return Object.values(match.weaponXp).reduce((total, xp) => total + xp, 0) === kills * 20;
  } catch { return false; }
};
const validRanking = (reward) => {
  if (reward.ranking === undefined) return true;
  try { return typeof reward.ranking === "string" && reward.ranking.length <= 2048 && Boolean(parseRankingEvidence(reward)); }
  catch { return false; }
};
export const validReward = (reward) => reward && /^[0-9a-f-]{36}$/i.test(reward.id) &&
  typeof reward.identity === "string" && reward.identity.length > 0 &&
  ["npc", "match", "claim"].includes(reward.kind) && Number.isSafeInteger(reward.tokens) && reward.tokens >= 0 &&
  (reward.kind === "claim" ?
    Number.isSafeInteger(reward.xp) && reward.xp >= 0 && reward.xp <= 1000 &&
    Number.isSafeInteger(reward.at) && reward.at >= 0 && reward.tokens <= 400 &&
    ["challenge", "season", "prestige"].includes(reward.claimType) &&
    typeof reward.claimKey === "string" && reward.claimKey.length <= 32 &&
    typeof reward.claimPeriod === "string" && /^(?:[dws]-?\d{1,8}|lifetime)$/.test(reward.claimPeriod) :
    reward.kind === "npc" ? reward.tokens > 0 :
    Number.isSafeInteger(reward.xp) && reward.xp >= 0 && Number.isSafeInteger(reward.kills) && reward.kills >= 0 &&
    Number.isSafeInteger(reward.wave) && reward.wave >= 0 && typeof reward.won === "boolean" &&
    (reward.mapId === null || typeof reward.mapId === "string") &&
    ["assists", "revives", "objectiveScore", "teamXp"].every((key) => reward[key] === undefined ||
      Number.isSafeInteger(reward[key]) && reward[key] >= 0) &&
    (reward.teamXp === undefined || reward.teamXp <= 250) &&
    (reward.teamXp === undefined || reward.teamXp <= reward.xp) && validProgress(reward.progression, reward.kills) && validRanking(reward));

export function validateRewards(records) {
  if (!records || typeof records !== "object" || Array.isArray(records) ||
    Object.entries(records).some(([id, reward]) => id !== reward.id || !validReward(reward))) {
    throw new Error("Invalid durable reward journal.");
  }
}
