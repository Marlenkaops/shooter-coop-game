import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { BAN_REASON_MAX, MAX_BAN_MS, cleanBanReason } from "../shared/bans.js";
import { persistentFile } from "./persistence.js";

export const MAX_BANS = 5000;
const text = (value, limit) => typeof value === "string" && value.length > 0 && value.length <= limit;
const uuid = (value) => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export const validAddressHash = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

export function normalizeAddress(value) {
  if (typeof value !== "string" || value.includes("%") || !net.isIP(value)) return null;
  if (net.isIPv4(value)) return value;
  const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(canonical);
  if (!mapped) return canonical;
  const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

export function createAddressResolver(environment = process.env) {
  const source = environment.CLIENT_IP_SOURCE || (environment.CONTAINER_APP_NAME &&
    environment.CONTAINER_APP_ENV_DNS_SUFFIX ? "azure" : "direct");
  if (!["direct", "azure"].includes(source)) throw new Error("CLIENT_IP_SOURCE must be direct or azure.");
  return (request) => {
    if (source === "direct") return normalizeAddress(request.socket.remoteAddress);
    // Azure ingress appends the only trustworthy address at the right end.
    const forwarded = request.headers["x-forwarded-for"];
    return typeof forwarded === "string" ? normalizeAddress(forwarded.split(",").at(-1).trim()) : null;
  };
}

export function createBanStore(directory, { now = Date.now } = {}) {
  const filename = path.join(directory, "bans.json");
  const signing = persistentFile(directory, "moderation-secret", {
    parse: (value) => value, stringify: (value) => value,
    validate(secret) { if (!/^[0-9a-f]{64}$/.test(secret)) throw new Error("Invalid moderation secret."); },
    initial() {
    if (fs.existsSync(filename) || (fs.existsSync(path.join(directory, "reports.json")) &&
      JSON.parse(fs.readFileSync(path.join(directory, "reports.json"), "utf8")).some((report) => report.targetAddressHash))) {
      throw new Error("Moderation secret is missing. Restore it with the reports and bans.");
    }
    return crypto.randomBytes(32).toString("hex");
    }
  });
  if (!signing.exists) signing.save(signing.value);
  const state = persistentFile(directory, "bans.json", { initial: [], maxBytes: 4_000_000, validate(bans) {
    if (!Array.isArray(bans) || bans.length > MAX_BANS || bans.some((ban) => !ban ||
      Object.keys(ban).some((key) => !["id", "kind", "key", "targetId", "targetName", "reportId", "actorId", "at", "reason", "until"].includes(key)) ||
      !uuid(ban.id) || !["player", "ip"].includes(ban.kind) ||
      !(ban.kind === "ip" ? validAddressHash(ban.key) : text(ban.key, 100) && ban.key === ban.targetId) ||
      !text(ban.targetId, 100) || !text(ban.targetName, 18) || !uuid(ban.reportId) ||
      !text(ban.actorId, 100) || !Number.isSafeInteger(ban.at) || ban.at < 0 ||
      (ban.reason !== undefined && !text(ban.reason, BAN_REASON_MAX)) ||
      (ban.until !== undefined && ban.until !== null && (!Number.isSafeInteger(ban.until) || ban.until <= ban.at))) ||
      new Set(bans.map((ban) => ban.id)).size !== bans.length ||
      new Set(bans.map((ban) => `${ban.kind}:${ban.key}`)).size !== bans.length) {
      throw new Error("Invalid ban store.");
    }
  } });
  const save = (next) => state.save(next);
  const live = (ban) => ban.until === undefined || ban.until === null || ban.until > now();
  const active = (kind, key) => key ? state.value.find((ban) => ban.kind === kind && ban.key === key && live(ban)) || null : null;
  const isBanned = (kind, key) => Boolean(active(kind, key));
  const prune = () => { const bans = state.value; if (bans.some((ban) => !live(ban))) save(bans.filter(live)); };
  // Details a banned player may see: never the key, address hash, actor or report.
  const notice = (ban) => ban && { kind: ban.kind, reason: ban.reason || null, at: ban.at, until: ban.until ?? null };
  return {
    hashAddress(address) {
      const normalized = normalizeAddress(address);
      return normalized ? crypto.createHmac("sha256", signing.value).update(normalized).digest("hex") : null;
    },
    isBanned,
    active,
    notice,
    ban(report, kind, actorId, { durationMs = null, reason = "" } = {}) {
      if (!report || !["player", "ip"].includes(kind) || !text(actorId, 100) ||
        !(durationMs === null || Number.isSafeInteger(durationMs) && durationMs > 0 && durationMs <= MAX_BAN_MS)) {
        return { ok: false, error: "Invalid ban request." };
      }
      const key = kind === "player" ? report.targetId : report.targetAddressHash;
      if (!uuid(report.id) || !text(report.targetId, 100) || !text(report.targetName, 18) ||
        !(kind === "ip" ? validAddressHash(key) : text(key, 100))) {
        return { ok: false, error: "No verified address is available for this report." };
      }
      prune();
      const bans = state.value;
      if (isBanned(kind, key)) return { ok: false, error: "This ban is already active." };
      if (bans.length >= MAX_BANS) return { ok: false, error: "Ban storage is full. Remove an old ban first." };
      const ban = { id: crypto.randomUUID(), kind, key, targetId: report.targetId,
        targetName: report.targetName, reportId: report.id, actorId, at: now(), until: null };
      const note = cleanBanReason(reason);
      if (note) ban.reason = note;
      if (durationMs !== null) ban.until = ban.at + durationMs;
      save([...bans, ban]);
      return { ok: true, ban: notice(ban) };
    },
    list({ offset = 0 } = {}) {
      if (!Number.isSafeInteger(offset) || offset < 0) return { ok: false, error: "Invalid ban page." };
      prune();
      const bans = state.value;
      const matching = bans.toReversed();
      return { ok: true, bans: matching.slice(offset, offset + 20).map(({ key, ...ban }) => ban),
        total: matching.length, nextOffset: offset + 20 < matching.length ? offset + 20 : null };
    },
    get(id) { return state.value.find((ban) => ban.id === id); },
    remove(id) {
      const bans = state.value;
      if (!bans.some((ban) => ban.id === id)) return { ok: false, error: "Ban not found." };
      save(bans.filter((ban) => ban.id !== id));
      return { ok: true };
    }
  };
}
