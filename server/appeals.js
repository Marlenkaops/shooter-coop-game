import crypto from "node:crypto";
import { persistentFile } from "./persistence.js";

export const MAX_APPEALS = 500;
export const APPEAL_STATUSES = ["open", "approved", "rejected"];
const text = (value, max) => typeof value === "string" && value.length > 0 && value.length <= max;
const uuid = (value) => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export const validAppealReason = (value) => text(value, 1000) && value.trim().length >= 10 &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);

function validAppeal(appeal) {
  return appeal && uuid(appeal.id) && uuid(appeal.banId) &&
    text(appeal.targetId, 100) && text(appeal.targetName, 18) &&
    ["player", "ip"].includes(appeal.kind) && typeof appeal.banReason === "string" && appeal.banReason.length <= 300 &&
    Number.isSafeInteger(appeal.banAt) && appeal.banAt >= 0 &&
    (appeal.banUntil === null || Number.isSafeInteger(appeal.banUntil) && appeal.banUntil > appeal.banAt) &&
    validAppealReason(appeal.reason) && Number.isSafeInteger(appeal.at) && appeal.at >= 0 &&
    APPEAL_STATUSES.includes(appeal.status) &&
    (appeal.status === "open" ? appeal.reviewedAt === null && appeal.reviewedBy === null :
      Number.isSafeInteger(appeal.reviewedAt) && appeal.reviewedAt >= 0 && text(appeal.reviewedBy, 100));
}

export function createAppealStore(directory, { now = Date.now } = {}) {
  const state = persistentFile(directory, "ban-appeals.json", { initial: [], maxBytes: 4_000_000, validate(appeals) {
    if (!Array.isArray(appeals) || appeals.length > MAX_APPEALS || appeals.some((appeal) => !validAppeal(appeal)) ||
      new Set(appeals.map((appeal) => appeal.id)).size !== appeals.length ||
      new Set(appeals.map((appeal) => appeal.banId)).size !== appeals.length) {
      throw new Error("Invalid ban appeal store.");
    }
  } });
  const save = (next) => state.save(next);
  return {
    submit(ban, reason) {
      const appeals = state.value;
      if (!validAppealReason(reason)) return { ok: false, error: "Explain your appeal in 10-1000 characters using normal text." };
      const existing = appeals.find((appeal) => appeal.banId === ban.id);
      if (existing) return { ok: true, status: existing.status, alreadySubmitted: true };
      const appeal = { id: crypto.randomUUID(), banId: ban.id, targetId: ban.targetId, targetName: ban.targetName,
        kind: ban.kind, banReason: ban.reason || "", banAt: ban.at, banUntil: ban.until ?? null,
        reason: reason.trim(), at: now(), status: "open", reviewedAt: null, reviewedBy: null };
      if (!validAppeal(appeal)) return { ok: false, error: "Invalid ban appeal." };
      const next = [...appeals];
      if (next.length >= MAX_APPEALS) {
        const reviewed = next.findIndex((item) => item.status !== "open");
        if (reviewed === -1) return { ok: false, error: "The appeal inbox is full. Please try again later." };
        next.splice(reviewed, 1);
      }
      save([...next, appeal]);
      return { ok: true, status: "open", alreadySubmitted: false };
    },
    get(id) { return state.value.find((appeal) => appeal.id === id); },
    list({ status = "open", offset = 0 } = {}) {
      const appeals = state.value;
      if (!APPEAL_STATUSES.includes(status) || !Number.isSafeInteger(offset) || offset < 0) {
        return { ok: false, error: "Invalid appeal filter." };
      }
      const matching = appeals.filter((appeal) => appeal.status === status).toReversed();
      return { ok: true, appeals: matching.slice(offset, offset + 20), total: matching.length,
        nextOffset: offset + 20 < matching.length ? offset + 20 : null };
    },
    review(id, status, actorId) {
      const appeals = state.value;
      const appeal = appeals.find((item) => item.id === id);
      if (!appeal || !["approved", "rejected"].includes(status) || !text(actorId, 100)) {
        return { ok: false, error: "Appeal or decision not found." };
      }
      if (appeal.status !== "open") return { ok: false, error: "This appeal has already been reviewed. Refresh the inbox." };
      save(appeals.map((item) => item.id === id ? { ...item, status, reviewedAt: now(), reviewedBy: actorId } : item));
      return { ok: true };
    }
  };
}

export function createAppealLimiter({ now = Date.now } = {}) {
  const attempts = new Map();
  return (key) => {
    const at = now();
    for (const [id, entry] of attempts) if (at >= entry.until) attempts.delete(id);
    let entry = attempts.get(key);
    if (!entry) {
      if (attempts.size >= 5000) return false;
      entry = { count: 0, until: at + 60_000 };
      attempts.set(key, entry);
    }
    return ++entry.count <= 5;
  };
}
