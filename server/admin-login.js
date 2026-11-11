import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { durableState } from "./persistence.js";

const scrypt = promisify(crypto.scrypt);
const hashPattern = /^scrypt:([a-f0-9]{32}):([a-f0-9]{128})$/;

export const ADMIN_SESSION_MS = 15 * 60 * 1000;

export function validateAdminCredentials(credentials) {
  if (!credentials || typeof credentials.username !== "string" ||
    !/^[a-zA-Z0-9._-](?:[a-zA-Z0-9._ -]{0,62}[a-zA-Z0-9._-])?$/.test(credentials.username) ||
    typeof credentials.passwordHash !== "string" || !hashPattern.test(credentials.passwordHash)) {
    throw new Error("Invalid administrator credentials. Configure a username and a salted scrypt password hash.");
  }
  return { username: credentials.username, passwordHash: credentials.passwordHash };
}

export function normalizeAdminCredentials(credentials) {
  if (credentials === null || credentials === undefined) return [];
  if (Array.isArray(credentials)) return credentials.map((entry) => validateAdminCredentials(entry));
  return [validateAdminCredentials(credentials)];
}

export function loadAdminCredentials(directory, environment = process.env) {
  const username = environment.ADMIN_LOGIN_USER;
  const passwordHash = environment.ADMIN_LOGIN_PASSWORD_HASH;
  const credentialList = environment.ADMIN_LOGIN_CREDENTIALS;
  const finalize = (credentials) => {
    const normalized = normalizeAdminCredentials(credentials);
    return normalized.length === 1 ? normalized[0] : normalized;
  };
  if (credentialList !== undefined) {
    let parsed;
    try {
      parsed = JSON.parse(credentialList);
    } catch {
      throw new Error("Invalid administrator credentials environment. Expected JSON with a list of { username, passwordHash } objects.");
    }
    return finalize(parsed);
  }
  if (username !== undefined || passwordHash !== undefined) {
    return finalize({ username, passwordHash });
  }
  let content;
  try {
    if (durableState && !durableState.files.has("admin-login.json")) return null;
    content = durableState ? durableState.read("admin-login.json") : fs.readFileSync(path.join(directory, "admin-login.json"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  let credentials;
  try {
    credentials = JSON.parse(content);
  } catch {
    throw new Error("Invalid administrator credential file. Expected JSON with a username and passwordHash.");
  }
  return finalize(credentials);
}

export async function hashAdminPassword(password) {
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    throw new Error("Administrator passwords must contain 8 to 128 characters.");
  }
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function createAdminLogin(credentials, { now = Date.now } = {}) {
  const configured = Array.isArray(credentials) ? credentials.map((entry) => validateAdminCredentials(entry)) :
    credentials ? [validateAdminCredentials(credentials)] : [];
  const entries = configured.map((entry) => {
    const parts = entry.passwordHash.match(hashPattern);
    return {
      username: entry.username,
      usernameHash: crypto.createHash("sha256").update(entry.username).digest(),
      passwordSalt: Buffer.from(parts[1], "hex"),
      passwordHash: Buffer.from(parts[2], "hex")
    };
  });
  const attempts = new Map();
  let pending = 0;
  const windowMs = 60_000;
  const invalid = { ok: false, error: "Incorrect administrator username or password." };

  return {
    enabled: entries.length > 0,
    async authenticate(input, address) {
      if (entries.length === 0) return { ok: false, error: "Admin sign-in is not configured on this server." };
      const time = now();
      for (const [key, record] of attempts) {
        if (time - record.updated >= windowMs) attempts.delete(key);
      }
      const key = typeof address === "string" ? address : "unknown";
      if (!attempts.has(key) && attempts.size >= 2048) {
        return { ok: false, error: "Admin sign-in is busy. Try again in a minute." };
      }
      const record = attempts.get(key) || { times: [], updated: time };
      record.times = record.times.filter((attempt) => time - attempt < windowMs);
      if (record.times.length >= 5) {
        return { ok: false, error: "Too many sign-in attempts. Try again in a minute." };
      }
      record.times.push(time);
      record.updated = time;
      attempts.set(key, record);
      if (!input || typeof input !== "object" || Array.isArray(input) ||
        typeof input.username !== "string" || input.username.length > 64 ||
        typeof input.password !== "string" || !input.password.length || input.password.length > 128) {
        return invalid;
      }
      if (pending >= 2) return { ok: false, error: "Admin sign-in is busy. Try again shortly." };
      pending++;
      try {
        const suppliedUsername = crypto.createHash("sha256").update(input.username).digest();
        for (const entry of entries) {
          const suppliedPassword = await scrypt(input.password, entry.passwordSalt, 64);
          const nameMatches = crypto.timingSafeEqual(suppliedUsername, entry.usernameHash);
          const passwordMatches = crypto.timingSafeEqual(suppliedPassword, entry.passwordHash);
          if (nameMatches && passwordMatches) {
            attempts.delete(key);
            return { ok: true };
          }
        }
        return invalid;
      } finally {
        pending--;
      }
    }
  };
}

export function hasAdminSession(socket, now = Date.now()) {
  return Number.isFinite(socket.data.adminSessionUntil) && socket.data.adminSessionUntil > now;
}
