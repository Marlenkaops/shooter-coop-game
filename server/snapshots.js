import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { batches, decodeFiles, documentDigest, durableState, DurableState, encodeFiles, PERSISTENCE_SCHEMA,
  REQUIRED_FILES, SCOPE, usePersistence, validFilename, validateFiles } from "./persistence.js";
import { createBanStore } from "./bans.js";
import { createReportStore } from "./reports.js";
import { createAppealStore } from "./appeals.js";
import { createAuditLog } from "./audit.js";
import { createStaffAccess } from "./staff-access.js";
import { normalizeAdminCredentials } from "./admin-login.js";
import { validateRewards } from "./reward-records.js";
import { SKINS } from "../shared/skins.js";

const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const textFiles = new Set([...REQUIRED_FILES, "identity-secret", "admin-login.json", "players.backup.json", "squads.json"]);
const semanticChecksum = (files, dataset) => documentDigest(encodeFiles(files, dataset));

export function validateSnapshotSemantics(files) {
  validateFiles(files);
  const previous = durableState;
  const view = { files, validators: new Map(), read(name) {
    if (!files.has(name)) throw new Error("Missing required snapshot state.");
    return files.get(name);
  } };
  usePersistence(view);
  try {
    createBanStore(""); createReportStore(""); createAppealStore(""); createAuditLog(""); createStaffAccess("");
    if (files.has("admin-login.json")) normalizeAdminCredentials(JSON.parse(files.get("admin-login.json")));
    validateRewards(JSON.parse(files.get("pending-rewards.json")));
    validateRewards(JSON.parse(files.get("reward-receipts.json")));
    for (const file of ["players.json", "players.backup.json"]) {
      if (!files.has(file)) continue;
      const names = new Set();
      for (const [id, record] of Object.entries(JSON.parse(files.get(file)))) {
        const name = (record.username || `Ranger-${id.slice(0, 8)}`).toLocaleLowerCase();
        const skins = ["standard", ...(record.ownedSkins || [])];
        if (names.has(name) || record.ownedSkins !== undefined && !Array.isArray(record.ownedSkins) ||
          skins.some((skin) => !Object.hasOwn(SKINS, skin)) ||
          record.equippedSkinId !== undefined && !skins.includes(record.equippedSkinId) ||
          record.username !== undefined && (typeof record.username !== "string" ||
            !/^[\p{L}\p{N}][\p{L}\p{N} _-]{2,17}$/u.test(record.username)) ||
          ["ownedWeapons", "lootedWeapons", "campaignCompleted"].some((key) => record[key] !== undefined &&
            (!Array.isArray(record[key]) || record[key].some((value) => typeof value !== "string")))) {
          throw new Error("Invalid saved profile semantics.");
        }
        names.add(name);
      }
    }
  } finally { usePersistence(previous); }
  return files;
}

export function verifyIdentity(identity, files, environment = process.env) {
  if (!identity || !["file", "environment"].includes(identity.source) || !/^[a-f0-9]{64}$/.test(identity.fingerprint)) {
    throw new Error("Missing expected identity signing fingerprint.");
  }
  const value = identity.source === "environment" ? environment.IDENTITY_SECRET : files.get("identity-secret")?.trim();
  if (!value || sha(value) !== identity.fingerprint ||
    environment.IDENTITY_SECRET && sha(environment.IDENTITY_SECRET) !== identity.fingerprint) {
    throw new Error("Identity signing material does not match the initialized dataset.");
  }
}

export function makeBundle(files, identity) {
  validateSnapshotSemantics(files);
  if (!identity || !["file", "environment"].includes(identity.source) || !/^[a-f0-9]{64}$/.test(identity.fingerprint)) {
    throw new Error("Missing expected identity signing fingerprint.");
  }
  if (identity.source === "file") verifyIdentity(identity, files, {});
  const entries = [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, value]) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    return { name, binary: Buffer.isBuffer(value), checksum: sha(bytes), data: bytes.toString("base64") };
  });
  return { schema: 1, identity, profiles: Object.keys(JSON.parse(files.get("players.json"))).length,
    digest: sha(JSON.stringify(entries)), files: entries };
}

export function readBundle(bundle) {
  if (bundle?.schema !== 1 || !Array.isArray(bundle.files) || bundle.digest !== sha(JSON.stringify(bundle.files))) {
    throw new Error("Invalid private snapshot manifest.");
  }
  const files = new Map();
  for (const entry of bundle.files) {
    if (!validFilename(entry.name) || files.has(entry.name) || typeof entry.data !== "string") throw new Error("Invalid private snapshot file.");
    const bytes = Buffer.from(entry.data, "base64");
    if (sha(bytes) !== entry.checksum) throw new Error("Private snapshot checksum mismatch.");
    files.set(entry.name, entry.binary ? bytes : bytes.toString("utf8"));
  }
  validateSnapshotSemantics(files);
  if (!bundle.identity || !["file", "environment"].includes(bundle.identity.source) ||
    !/^[a-f0-9]{64}$/.test(bundle.identity.fingerprint)) throw new Error("Invalid snapshot identity metadata.");
  if (bundle.identity.source === "file") verifyIdentity(bundle.identity, files, {});
  if (Object.keys(JSON.parse(files.get("players.json"))).length !== bundle.profiles) throw new Error("Snapshot profile count mismatch.");
  return files;
}

export function captureDirectory(directory, { expectedProfiles, identitySource = "file", normalizeMissing = false,
  environment = process.env } = {}) {
  if (!Number.isSafeInteger(expectedProfiles) || expectedProfiles < 0) throw new Error("An explicit expected profile count is required.");
  const files = new Map();
  function visit(relative = "") {
    for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink() || !validFilename(name) || entry.name.endsWith(".next") ||
        [".writer.lock", ".transaction.json"].includes(entry.name)) throw new Error("Snapshot is not a quiescent regular-file directory.");
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile()) {
        const content = fs.readFileSync(path.join(directory, name));
        files.set(name, textFiles.has(name) ? content.toString("utf8") : content);
      } else throw new Error("Unsupported snapshot entry.");
    }
  }
  visit();
  if (!files.has("players.json") || !files.has("moderation-secret")) throw new Error("Core snapshot files are missing.");
  if (normalizeMissing) {
    for (const name of ["bans.json", "reports.json", "ban-appeals.json"]) if (!files.has(name)) files.set(name, "[]");
    if (!files.has("audit.json")) files.set("audit.json", '{"entries":[],"nextId":1}');
    if (!files.has("staff-access.json")) {
      const data = environment.STAFF_ACCESS_SEED ? JSON.parse(Buffer.from(environment.STAFF_ACCESS_SEED, "base64url").toString("utf8")) :
        { version: 1, salt: crypto.randomBytes(16).toString("hex"), staff: {} };
      files.set("staff-access.json", JSON.stringify(data));
    }
  }
  // These journals did not exist in the legacy file-backed game.
  for (const name of ["pending-rewards.json", "reward-receipts.json"]) if (!files.has(name)) files.set(name, "{}");
  validateSnapshotSemantics(files);
  if (Object.keys(JSON.parse(files.get("players.json"))).length !== expectedProfiles) throw new Error("Source profile count does not match the explicit expectation.");
  const signing = identitySource === "environment" ? environment.IDENTITY_SECRET : files.get("identity-secret")?.trim();
  if (!signing) throw new Error("Expected identity signing material is missing.");
  const identity = { source: identitySource, fingerprint: sha(signing) };
  verifyIdentity(identity, files, environment);
  return makeBundle(files, identity);
}

export async function importBundle(adapter, bundle) {
  const files = readBundle(bundle);
  if (await adapter.readRoot()) throw new Error("An active dataset already exists; import never replaces it.");
  const dataset = crypto.randomUUID();
  const documents = encodeFiles(files, dataset);
  const root = { id: "active", scope: SCOPE, schema: PERSISTENCE_SCHEMA, dataset, identity: bundle.identity,
    initialized: true, revision: 0, transaction: crypto.randomUUID(), count: documents.size,
    digest: documentDigest(documents), updatedAt: Date.now() };
  for (const batch of batches([...documents].map(([id, resourceBody]) => ({ operationType: "Create", id, resourceBody })))) {
    await adapter.batch(batch);
  }
  const staged = await adapter.readDocuments(dataset);
  validateSnapshotSemantics(decodeFiles(staged, root));
  if (documentDigest(staged) !== root.digest) throw new Error("Staged dataset verification failed.");
  try { await adapter.batch([{ operationType: "Create", id: "active", resourceBody: root }]); }
  catch (error) { if ((await adapter.readRoot())?.dataset !== dataset) throw error; }
  const verified = await new DurableState(adapter, dataset).initialize();
  if (verified.root.digest !== root.digest) throw new Error("Published dataset verification failed.");
  return { dataset, profiles: bundle.profiles, entities: documents.size };
}

export async function verifyDataset(adapter, dataset, bundle = null) {
  if (!dataset) {
    if (!bundle) throw new Error("An expected dataset or snapshot bundle is required.");
    dataset = (await adapter.readRoot())?.dataset;
  }
  const state = await new DurableState(adapter, dataset).initialize();
  validateSnapshotSemantics(state.files);
  if (bundle && (semanticChecksum(readBundle(bundle), dataset) !== state.root.digest ||
    bundle.identity.source !== state.root.identity?.source ||
    bundle.identity.fingerprint !== state.root.identity?.fingerprint)) {
    throw new Error("Dataset does not match the expected snapshot.");
  }
  return state;
}

export function writeBundle(filename, bundle) {
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const file = fs.openSync(filename, "wx", 0o600);
  try { fs.writeFileSync(file, JSON.stringify(bundle)); fs.fsyncSync(file); }
  finally { fs.closeSync(file); }
}

export function restoreDirectory(directory, bundle) {
  const files = readBundle(bundle);
  fs.mkdirSync(directory, { mode: 0o700 });
  for (const [name, content] of files) {
    const filename = path.join(directory, name);
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    const file = fs.openSync(filename, "wx", 0o600);
    try { fs.writeFileSync(file, content); fs.fsyncSync(file); } finally { fs.closeSync(file); }
  }
}

export function createFixtureBundle() {
  const secret = crypto.randomBytes(32).toString("hex"), salt = crypto.randomBytes(16).toString("hex");
  const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
  const players = Object.fromEntries(ids.map((id, index) => [id, {
    id, username: `Storage Fixture ${index}`, xp: 1000, tokens: 240, matches: 3, totalKills: 12,
    ownedWeapons: ["rifle", "smg"], equippedWeaponId: "smg", lootedWeapons: ["smg"],
    ownedSkins: ["standard"], equippedSkinId: "standard", campaignCompleted: ["foundry"]
  }]));
  const files = new Map(Object.entries({
    "players.json": JSON.stringify(players), "players.backup.json": JSON.stringify(players),
    "identity-secret": secret, "moderation-secret": crypto.randomBytes(32).toString("hex"),
    "bans.json": "[]", "reports.json": "[]", "ban-appeals.json": "[]",
    "audit.json": '{"entries":[],"nextId":1}', "pending-rewards.json": "{}", "reward-receipts.json": "{}",
    "staff-access.json": JSON.stringify({ version: 1, salt, staff: {
      [ids[0]]: { role: "owner", revision: crypto.randomBytes(16).toString("hex"), codes: [
        { hash: crypto.scryptSync("000000", Buffer.from(salt, "hex"), 32).toString("hex"), used: true },
        { hash: crypto.scryptSync("000001", Buffer.from(salt, "hex"), 32).toString("hex"), used: false }
      ] }
    } })
  }));
  return makeBundle(files, { source: "file", fingerprint: sha(secret) });
}
