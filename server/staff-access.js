import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { STAFF_ROLES } from "../shared/staff.js";
import { durableState, persistentFile } from "./persistence.js";

const uuid = (id) => typeof id === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id);
const hex = (value, length) => typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`).test(value);

export function validStaffData(data) {
  return !(!data || data.version !== 1 || !hex(data.salt, 32) || !data.staff || typeof data.staff !== "object" ||
    Array.isArray(data.staff) || Object.keys(data.staff).length > 1000 ||
    Object.entries(data.staff).some(([id, record]) => !uuid(id) || !record ||
      !Object.hasOwn(STAFF_ROLES, record.role) || !hex(record.revision, 32) ||
      !Array.isArray(record.codes) || record.codes.length > 3 ||
      record.codes.some((code) => !code || !hex(code.hash, 64) || typeof code.used !== "boolean")) ||
    new Set(Object.values(data.staff).flatMap((record) => record.codes.map((code) => code.hash))).size !==
      Object.values(data.staff).reduce((count, record) => count + record.codes.length, 0));
}

export function encodeStaffSeed(directory) {
  const data = JSON.parse(fs.readFileSync(path.join(directory, "staff-access.json"), "utf8"));
  if (!validStaffData(data)) throw new Error("Invalid staff access file.");
  return Buffer.from(JSON.stringify(data)).toString("base64url");
}

function decodeStaffSeed(seed) {
  let data = null;
  try {
    if (seed.length > 200_000) throw new Error("too large");
    data = JSON.parse(Buffer.from(seed, "base64url").toString("utf8"));
  } catch { /* reported below */ }
  if (!validStaffData(data)) throw new Error("Invalid STAFF_ACCESS_SEED. Generate it with npm run setup:staff -- --seed.");
  return data;
}

export function createStaffAccess(directory, { now = Date.now, seed = null } = {}) {
  const filename = path.join(directory, "staff-access.json");
  let previous = null;
  if (!durableState) {
    try { previous = fs.readFileSync(filename, "utf8"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const state = persistentFile(directory, "staff-access.json", {
    maxBytes: 2_000_000,
    initial: () => seed ? decodeStaffSeed(seed) : { version: 1, salt: crypto.randomBytes(16).toString("hex"), staff: {} },
    validate(data) { if (!validStaffData(data)) throw new Error("Invalid staff access file. Restore the private staff backup."); }
  });
  function save(next) {
    if (!durableState) {
      let current = null;
      try { current = fs.readFileSync(filename, "utf8"); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      if (current !== previous) throw new Error("Staff access changed in another process. Restart before making further changes.");
      if (fs.existsSync(`${filename}.next`)) throw new Error("Staff access save already in progress.");
    }
    state.save(next);
    previous = JSON.stringify(next);
  }
  const hash = (code) => crypto.scryptSync(code, Buffer.from(state.value.salt, "hex"), 32).toString("hex");
  const attempts = new Map(), failures = new Map();
  return {
    role(id) { const data = state.value; return Object.hasOwn(data.staff, id) ? data.staff[id].role : null; },
    revision(id) { const data = state.value; return Object.hasOwn(data.staff, id) ? data.staff[id].revision : null; },
    setRole(id, role) {
      const data = state.value;
      if (!uuid(id) || role !== "none" && !Object.hasOwn(STAFF_ROLES, role)) return { ok: false, error: "Invalid staff role or Operator ID." };
      const current = data.staff[id];
      if (current?.role === "owner" && role !== "owner" &&
        Object.values(data.staff).filter((record) => record.role === "owner").length === 1) {
        return { ok: false, error: "Assign another owner before removing the last owner." };
      }
      if (!current && Object.keys(data.staff).length >= 1000) return { ok: false, error: "Staff storage is full." };
      const staff = { ...data.staff };
      if (role === "none") delete staff[id];
      else staff[id] = { role, revision: crypto.randomBytes(16).toString("hex"), codes: current?.codes || [] };
      save({ ...data, staff });
      return { ok: true, role };
    },
    issue(id) {
      const data = state.value;
      const record = Object.hasOwn(data.staff, id) ? data.staff[id] : null;
      if (!record) return { ok: false, error: "Assign a staff role before issuing codes." };
      const used = new Set(Object.values(data.staff).flatMap((member) => member.codes.map((code) => code.hash)));
      const codes = [], hashes = [];
      while (codes.length < 3) {
        const code = String(crypto.randomInt(1_000_000)).padStart(6, "0"), fingerprint = hash(code);
        if (used.has(fingerprint)) continue;
        used.add(fingerprint);
        codes.push(code);
        hashes.push({ hash: fingerprint, used: false });
      }
      save({ ...data, staff: { ...data.staff, [id]: {
        ...record, revision: crypto.randomBytes(16).toString("hex"), codes: hashes
      } } });
      return { ok: true, codes };
    },
    verify(id, code, { allowMove = false, limitKey = null } = {}) {
      const data = state.value;
      const at = now();
      for (const [key, entry] of attempts) if (at - entry.at >= 60_000) attempts.delete(key);
      // Identities are free to mint, so code-only sign-in also limits attempts per client address.
      const keys = limitKey === null ? [id] : [id, `address:${limitKey}`];
      if (attempts.size >= 2048 && keys.some((key) => !attempts.has(key))) return { ok: false, error: "Verification is busy. Try again in a minute." };
      const entries = keys.map((key) => attempts.get(key) || { at, count: 0 });
      if (entries.some((entry) => entry.count >= 5)) return { ok: false, error: "Too many verification attempts. Try again in a minute." };
      entries.forEach((entry, index) => { entry.count++; attempts.set(keys[index], entry); });
      const record = Object.hasOwn(data.staff, id) ? data.staff[id] : null;
      const invalid = { ok: false, error: "Invalid or already used verification code." };
      if (!uuid(id) || typeof code !== "string" || !/^[0-9]{6}$/.test(code)) return invalid;
      for (const [key, failure] of failures) if (at - failure >= 60_000) failures.delete(key);
      if (failures.size >= 30) return { ok: false, error: "Verification is busy. Try again in a minute." };
      const supplied = Buffer.from(hash(code), "hex");
      const matches = (saved) => !saved.used && crypto.timingSafeEqual(supplied, Buffer.from(saved.hash, "hex"));
      // After a password check, a code issued to a lost Operator ID moves that role to the caller.
      const ownerId = record?.codes.some(matches) ? id
        : allowMove ? Object.keys(data.staff).find((key) => data.staff[key].codes.some(matches)) : undefined;
      if (!ownerId) {
        failures.set(`${at}:${crypto.randomUUID()}`, at);
        return invalid;
      }
      const source = data.staff[ownerId];
      const index = source.codes.findIndex(matches);
      const codes = source.codes.map((saved, position) => position === index ? { ...saved, used: true } : saved);
      const staffMembers = { ...data.staff };
      if (ownerId === id) staffMembers[id] = { ...source, codes };
      else {
        delete staffMembers[ownerId];
        staffMembers[id] = { role: source.role, revision: crypto.randomBytes(16).toString("hex"), codes };
      }
      save({ ...data, staff: staffMembers });
      for (const key of keys) attempts.delete(key);
      return { ok: true, movedFrom: ownerId === id ? null : ownerId };
    }
  };
}
