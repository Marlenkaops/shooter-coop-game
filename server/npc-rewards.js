import crypto from "node:crypto";

export function flushNpcRewards(room, { credit, saved, failed }, now = Date.now()) {
  for (const [identity, reward] of room.pendingNpcTokens) {
    if (now < reward.retryAt) continue;
    let profile;
    try { profile = credit(identity, reward.tokens); } catch (error) {
      reward.retryAt = now + 5000;
      failed(identity, error);
      continue;
    }

    room.pendingNpcTokens.delete(identity);
    saved(identity, profile, reward.tokens);
  }
}

// Called by the simulation only to schedule work; no network request is awaited by a frame.
export function flushNpcRewardsAsync(room, { credit, saved, failed }, now = Date.now()) {
  for (const [identity, reward] of room.pendingNpcTokens) {
    if (reward.saving || now < reward.retryAt) continue;
    reward.batch ||= { id: crypto.randomUUID(), identity, kind: "npc", tokens: reward.tokens };
    reward.saving = true;
    Promise.resolve().then(() => credit(reward.batch)).then((profile) => {
      reward.tokens -= reward.batch.tokens;
      const tokens = reward.batch.tokens;
      reward.batch = null;
      if (!reward.tokens) room.pendingNpcTokens.delete(identity);
      saved(identity, profile, tokens);
    }).catch((error) => {
      reward.retryAt = Date.now() + 5000;
      failed(identity, error);
    }).finally(() => { reward.saving = false; });
  }
}
