import crypto from "node:crypto";
import { validAddressHash } from "./bans.js";
import { persistentFile } from "./persistence.js";

export const MAX_REPORTS = 500;
export const REPORT_STATUSES = ["open", "reviewed", "dismissed"];
const boundedText = (value, maximum) => typeof value === "string" && value.length > 0 && value.length <= maximum;
function validReport(report) {
  return report && /^[0-9a-f-]{36}$/i.test(report.id) && Number.isSafeInteger(report.at) && report.at >= 0 &&
    REPORT_STATUSES.includes(report.status) && boundedText(report.reason, 500) && report.reason.trim().length >= 8 &&
    boundedText(report.reporterId, 100) && boundedText(report.targetId, 100) &&
    boundedText(report.reporterName, 18) && boundedText(report.targetName, 18) &&
    boundedText(report.roomCode, 6) && boundedText(report.mode, 20) && boundedText(report.mapId, 30) &&
    (report.reviewedAt === null || Number.isSafeInteger(report.reviewedAt) && report.reviewedAt >= 0) &&
    (report.reviewedBy === null || boundedText(report.reviewedBy, 100)) &&
    (report.targetWasAdmin === undefined || typeof report.targetWasAdmin === "boolean") &&
    (report.targetAddressHash === undefined || report.targetAddressHash === null || validAddressHash(report.targetAddressHash));
}

export function createReportStore(directory, { now = Date.now } = {}) {
  const state = persistentFile(directory, "reports.json", { initial: [], maxBytes: 2_000_000, validate(reports) {
    if (!Array.isArray(reports) || reports.length > MAX_REPORTS || reports.some((report) => !validReport(report)) ||
      new Set(reports.map((report) => report.id)).size !== reports.length) {
      throw new Error("Invalid report store");
    }
  } });
  const save = (next) => state.save(next);
  return {
    moderation(actor, target, reason, targetWasAdmin, targetAddressHash = null) {
      const reports = state.value;
      const report = { id: crypto.randomUUID(), at: now(), status: "reviewed",
        roomCode: "ADMIN", mode: "moderation", mapId: "none",
        reporterId: actor.id, reporterName: actor.username, targetId: target.id, targetName: target.username,
        reason: `Administrator command: ${reason}`, targetAddressHash, targetWasAdmin,
        reviewedAt: now(), reviewedBy: actor.id };
      if (!validReport(report)) return { ok: false, error: "Invalid administrative ban record." };
      save([...reports, report].slice(-MAX_REPORTS));
      return { ok: true, report };
    },
    submit(room, socketId, targetSocketId, reason, targetAddressHash = null, targetWasAdmin = false) {
      const reports = state.value;
      const reporter = room?.players.get(socketId), target = room?.players.get(targetSocketId);
      if (!reporter || !target || reporter.identity === target.identity) {
        return { ok: false, error: "Choose another player currently in your room." };
      }
      if (typeof reason !== "string" || reason.length > 500 || reason.trim().length < 8 ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(reason)) {
        return { ok: false, error: "Describe the reason in 8–500 characters using normal text." };
      }
      if (targetAddressHash !== null && !validAddressHash(targetAddressHash)) throw new Error("Invalid reported address hash.");
      if (typeof targetWasAdmin !== "boolean") throw new Error("Invalid reported administrator status.");
      const at = now(), recent = reports.filter((report) => report.reporterId === reporter.identity && at - report.at < 600_000);
      if (recent.length >= 3 || recent.some((report) => at - report.at < 30_000)) {
        return { ok: false, error: "Report limit reached. Wait before submitting again." };
      }
      const report = { id: crypto.randomUUID(), at, status: "open", roomCode: room.code,
        mode: room.mode, mapId: room.mapId, reporterId: reporter.identity, reporterName: reporter.name,
        targetId: target.identity, targetName: target.name, reason: reason.trim(), targetAddressHash, targetWasAdmin,
        reviewedAt: null, reviewedBy: null };
      save([...reports, report].slice(-MAX_REPORTS));
      return { ok: true, id: report.id };
    },
    get(id) { return state.value.find((report) => report.id === id); },
    list({ status = "open", offset = 0 } = {}) {
      const reports = state.value;
      if (!REPORT_STATUSES.includes(status) || !Number.isSafeInteger(offset) || offset < 0) {
        return { ok: false, error: "Invalid report filter." };
      }
      const matching = reports.filter((report) => report.status === status).toReversed();
      return { ok: true, reports: matching.slice(offset, offset + 20), total: matching.length,
        nextOffset: offset + 20 < matching.length ? offset + 20 : null };
    },
    review(id, status, actorId) {
      const reports = state.value;
      const report = reports.find((item) => item.id === id);
      if (!report || !REPORT_STATUSES.includes(status)) return { ok: false, error: "Report or status not found." };
      save(reports.map((item) => item.id === id ? { ...item, status, reviewedAt: now(), reviewedBy: actorId } : item));
      return { ok: true };
    }
  };
}
