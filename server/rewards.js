import crypto from "node:crypto";
import { dataDir } from "./data.js";
import { persistentFile, transaction } from "./persistence.js";
import { creditNpcTokens, getProfile, progressionClaimOffer, rewardPlayer, rewardProgression } from "./store.js";
import { validReward, validateRewards } from "./reward-records.js";
import { recordRankedResult } from "./records.js";

const pending = persistentFile(dataDir, "pending-rewards.json", { initial: {}, validate: validateRewards });
const receipts = persistentFile(dataDir, "reward-receipts.json", { initial: {}, validate: validateRewards });
const same = (left, right) => Object.keys(left).sort().every((key) => left[key] === right[key]) &&
  Object.keys(left).length === Object.keys(right).length;

export async function stageReward(reward) {
  return stageRewards([reward]);
}

export async function stageRewards(rewards) {
  if (!Array.isArray(rewards) || rewards.some((reward) => !validReward(reward))) throw new Error("Invalid reward intent.");
  return transaction(() => {
    const next = { ...pending.value }, applied = receipts.value;
    let changed = false;
    for (const reward of rewards) {
      const saved = applied[reward.id] || next[reward.id];
      if (saved && !same(saved, reward)) throw new Error("Reward ID was reused with different contents.");
      if (!saved) { next[reward.id] = reward; changed = true; }
    }
    if (changed) pending.save(next);
  });
}

export async function applyReward(reward) {
  return transaction(() => applyStagedReward(reward));
}

function applyStagedReward(reward) {
  const previous = receipts.value[reward.id];
  if (previous) {
    if (!same(previous, reward)) throw new Error("Reward ID was reused with different contents.");
    return getProfile(reward.identity);
  }
  if (!same(pending.value[reward.id] || {}, reward)) throw new Error("Reward intent has not been durably staged.");
  let profile = reward.kind === "claim" ? rewardProgression(reward.identity, reward) :
    reward.kind === "npc" ? creditNpcTokens(reward.identity, reward.tokens) :
    rewardPlayer(reward.identity, reward.xp, reward.kills, reward.wave, reward.won, reward.mapId, reward.tokens, reward);
  if (reward.kind === "match" && reward.ranking !== undefined) {
    recordRankedResult(reward);
    profile = getProfile(reward.identity);
  }
  receipts.save({ ...receipts.value, [reward.id]: reward });
  const remaining = { ...pending.value };
  delete remaining[reward.id];
  pending.save(remaining);
  return profile;
}

export function claimProgression(identity, request, now = Date.now()) {
  return transaction(() => {
    const digest = crypto.createHash("sha256").update(JSON.stringify([identity, request.type, request.period, request.key])).digest("hex");
    const id = `${digest.slice(0,8)}-${digest.slice(8,12)}-${digest.slice(12,16)}-${digest.slice(16,20)}-${digest.slice(20,32)}`;
    if (receipts.value[id]) return { ok: true, profile: getProfile(identity), alreadyClaimed: true };
    let reward = pending.value[id];
    if (!reward) {
      const offer = progressionClaimOffer(identity, request, now);
      if (!offer) return { ok: false, error: "Reward is locked, expired or already claimed." };
      reward = { id, kind: "claim", identity, claimType: request.type, claimKey: request.key,
        claimPeriod: request.period, at: now, ...offer };
      if (!validReward(reward)) throw new Error("Invalid progression reward intent.");
      pending.save({ ...pending.value, [id]: reward });
    }
    return { ok: true, profile: applyStagedReward(reward) };
  });
}

export async function commitReward(reward) {
  await stageReward(reward);
  return applyReward(reward);
}

export async function recoverRewards() {
  const rewards = await transaction(() => Object.values(pending.value));
  for (const reward of rewards) await applyReward(reward);
}
