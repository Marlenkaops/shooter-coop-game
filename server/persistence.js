import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { validTeamMetadata } from "../shared/teamwork.js";
import { validCareer } from "../shared/career.js";
import { validRecordMetadata, validSocialGraph, validSquads } from "../shared/rankings.js";

const context = new AsyncLocalStorage();
export const PERSISTENCE_SCHEMA = 1;
export const SCOPE = "game";
export const CHUNK_BYTES = 16 * 1024;
const MAX_BATCH_BYTES = 1_500_000;
export const REQUIRED_FILES = ["players.json", "staff-access.json", "moderation-secret",
  "bans.json", "reports.json", "ban-appeals.json", "audit.json", "pending-rewards.json", "reward-receipts.json"];
const DICTIONARY_FILES = ["players.json", "players.backup.json", "pending-rewards.json", "reward-receipts.json", "squads.json"];
const ARRAY_FILES = ["bans.json", "reports.json", "ban-appeals.json"];
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const canonical = (value) => JSON.stringify(value);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const failure = (message, ErrorType = Error) => Object.assign(new ErrorType(message), { code: "STORAGE_UNAVAILABLE" });

export function validFilename(name) {
  return typeof name === "string" && name.length > 0 && !name.includes("\\") &&
    !name.includes("\0") && !path.posix.isAbsolute(name) &&
    name.split("/").every((part) => part && part !== "." && part !== "..");
}

export function validateFiles(files) {
  for (const name of REQUIRED_FILES) if (!files.has(name)) throw failure("Incomplete persistence dataset.");
  for (const [name, content] of files) {
    if (!validFilename(name) || typeof content !== "string" && !Buffer.isBuffer(content)) throw failure("Invalid persistence file.");
    if (name.endsWith(".json")) {
      try { JSON.parse(content); } catch { throw failure("Invalid persistence JSON."); }
    }
  }
  for (const name of ["players.json", "players.backup.json"]) {
    if (!files.has(name)) continue;
    const records = JSON.parse(files.get(name));
    if (!records || typeof records !== "object" || Array.isArray(records) ||
      Object.entries(records).some(([id, record]) => !record || typeof record !== "object" ||
        Array.isArray(record) || record.id !== id ||
        !Number.isSafeInteger(record.xp) || record.xp < 0 || !validTeamMetadata(record) || !validCareer(record) || !validRecordMetadata(record) ||
        ["tokens", "matches", "totalKills"].some((key) => record[key] !== undefined &&
          (!Number.isSafeInteger(record[key]) || record[key] < 0)))) throw failure("Invalid persistence profiles.");
    files.set(name, canonical(Object.fromEntries(Object.entries(records).sort(([a], [b]) => compare(a, b)))));
  }
  if (files.has("squads.json") && !validSquads(JSON.parse(files.get("squads.json")))) throw failure("Invalid persistence squads.");
  if (!validSocialGraph(JSON.parse(files.get("players.json")), JSON.parse(files.get("squads.json") || "{}"))) {
    throw failure("Inconsistent saved friends or squad membership.");
  }
  if (!/^[0-9a-f]{64}$/.test(files.get("moderation-secret"))) throw failure("Invalid moderation signing material.");
  if (files.has("identity-secret") && files.get("identity-secret").trim().length < 32) {
    throw failure("Invalid identity signing material.");
  }
  return files;
}

export function encodeFiles(files, dataset) {
  const documents = new Map();
  for (const [file, content] of [...files].sort(([a], [b]) => compare(a, b))) {
    const add = (suffix, body) => {
      const id = `${dataset}:${sha(`${file}:${suffix}`)}`;
      const document = { id, scope: SCOPE, dataset, ...body, file };
      if (Buffer.byteLength(canonical(document), "utf16le") > 60 * 1024) throw failure("Persistence entity exceeds the safe Table property limit.");
      documents.set(id, document);
    };
    const chunks = (value, prefix) => {
      const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
      const count = Math.max(1, Math.ceil(buffer.length / CHUNK_BYTES));
      for (let index = 0; index < count; index++) add(`${prefix}:${index}`, {
        kind: prefix, index, data: buffer.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES).toString("base64")
      });
      return count;
    };
    if (DICTIONARY_FILES.includes(file) || ARRAY_FILES.includes(file) || ["audit.json", "staff-access.json"].includes(file)) {
      const parsed = JSON.parse(content);
      const format = DICTIONARY_FILES.includes(file) ? "object" : ARRAY_FILES.includes(file) ? "array" :
        file === "audit.json" ? "audit" : "staff";
      const values = format === "audit" ? parsed.entries : format === "staff" ? parsed.staff : parsed;
      const ordered = ["array", "audit"].includes(format);
      const entries = ordered ? values.map((value) => [String(value.id), value]) :
        Object.entries(values).sort(([a], [b]) => compare(a, b));
      for (const [key, value] of entries) add(`profile:${key}`, { kind: "profile", key, value });
      const orderCount = ordered ? chunks(canonical(entries.map(([key]) => key)), "order") : 0;
      const metadata = format === "audit" ? { nextId: parsed.nextId } :
        format === "staff" ? { version: parsed.version, salt: parsed.salt } : {};
      const normalized = format === "object" ? Object.fromEntries(entries) :
        format === "staff" ? { ...metadata, staff: Object.fromEntries(entries) } :
        format === "audit" ? { entries: values, ...metadata } : values;
      add("manifest", { kind: "profiles", format, metadata, orderCount,
        count: entries.length, checksum: sha(canonical(normalized)) });
    } else {
      const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
      add("manifest", { kind: "file", encoding: Buffer.isBuffer(content) ? "binary" : "utf8",
        count: chunks(buffer, "chunk"), checksum: sha(buffer) });
    }
  }
  return documents;
}

export function documentDigest(documents) {
  return sha([...documents].sort(([a], [b]) => compare(a, b))
    .map(([id, body]) => `${id}:${sha(canonical(body))}`).join("\n"));
}

export function decodeFiles(documents, root) {
  if (!root || root.id !== "active" || root.scope !== SCOPE ||
    root.schema !== PERSISTENCE_SCHEMA || root.initialized !== true ||
    !Number.isSafeInteger(root.revision) || root.revision < 0 ||
    !Number.isSafeInteger(root.updatedAt) || root.updatedAt < 0 ||
    !/^[0-9a-f-]{36}$/i.test(root.transaction || "") ||
    root.count !== documents.size || root.digest !== documentDigest(documents)) {
    throw failure("Persistence dataset is missing, corrupt or uninitialized.");
  }
  const grouped = Map.groupBy([...documents.values()], (document) => document.file);
  const files = new Map();
  for (const [file, entries] of grouped) {
    const manifests = entries.filter((entry) => ["file", "profiles"].includes(entry.kind));
    if (manifests.length !== 1) throw failure("Invalid persistence manifest.");
    const manifest = manifests[0];
    const joinChunks = (kind, count) => {
      const chunks = entries.filter((entry) => entry.kind === kind).sort((a, b) => a.index - b.index);
      if (chunks.length !== count || chunks.some((chunk, index) => chunk.index !== index)) throw failure("Incomplete persistence chunks.");
      return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.data, "base64")));
    };
    let content;
    if (manifest.kind === "profiles") {
      const profiles = entries.filter((entry) => entry.kind === "profile").sort((a, b) => compare(a.key, b.key));
      if (profiles.length !== manifest.count || entries.length !== profiles.length + 1 + manifest.orderCount ||
        new Set(profiles.map((entry) => entry.key)).size !== profiles.length) throw failure("Incomplete profile dataset.");
      const records = Object.fromEntries(profiles.map((entry) => [entry.key, entry.value]));
      let value = records;
      if (["array", "audit"].includes(manifest.format)) {
        const order = JSON.parse(joinChunks("order", manifest.orderCount).toString("utf8"));
        if (order.length !== profiles.length || new Set(order).size !== profiles.length ||
          order.some((key) => !Object.hasOwn(records, key))) throw failure("Invalid persistence order.");
        value = order.map((key) => records[key]);
        if (manifest.format === "audit") value = { entries: value, ...manifest.metadata };
      } else if (manifest.format === "staff") value = { ...manifest.metadata, staff: records };
      else if (manifest.format !== "object") throw failure("Invalid persistence collection.");
      content = canonical(value);
    } else {
      if (entries.length !== manifest.count + 1) throw failure("Incomplete persistence file.");
      const buffer = joinChunks("chunk", manifest.count);
      content = manifest.encoding === "binary" ? buffer : buffer.toString("utf8");
    }
    if (sha(content) !== manifest.checksum) throw failure("Persistence file checksum mismatch.");
    files.set(file, content);
  }
  return validateFiles(files);
}

export function batches(operations) {
  const result = [];
  let batch = [], size = 0;
  for (const operation of operations) {
    // Include conservative per-entity HTTP/MIME overhead in addition to escaped JSON payloads.
    const bytes = Buffer.byteLength(canonical({ payload: canonical(operation) })) + 2048;
    if (bytes > MAX_BATCH_BYTES) throw failure("Persistence operation is too large.");
    if (batch.length >= 90 || size + bytes > MAX_BATCH_BYTES) {
      result.push(batch); batch = []; size = 0;
    }
    batch.push(operation); size += bytes;
  }
  if (batch.length) result.push(batch);
  return result;
}

export class DurableState {
  constructor(adapter, dataset, validate = null) {
    if (!dataset || !/^[0-9a-f-]{36}$/i.test(dataset)) throw failure("An expected PERSISTENCE_DATASET_ID is required.");
    this.adapter = adapter;
    this.dataset = dataset;
    this.files = new Map();
    this.documents = new Map();
    this.root = null;
    this.tail = Promise.resolve();
    this.validators = new Map();
    this.available = false;
    this.validate = validate;
  }
  async refresh() {
    const root = await this.adapter.readRoot();
    if (!root || root.dataset !== this.dataset || root.initialized !== true || typeof root._etag !== "string") throw failure("Expected initialized dataset not found.");
    if (this.root?._etag === root._etag) return;
    const documents = await this.adapter.readDocuments(this.dataset);
    const confirmed = await this.adapter.readRoot();
    if (!confirmed || confirmed._etag !== root._etag) throw failure("Dataset changed during retrieval. Retry.");
    const files = decodeFiles(documents, root);
    this.validate?.(files);
    for (const [name, validate] of this.validators) validate(files.get(name));
    this.files = files;
    this.documents = documents;
    this.root = root;
  }
  async initialize() {
    await this.refresh();
    this.available = true;
    return this;
  }
  run(work) {
    const execute = async () => {
      const effects = [];
      try {
        await this.refresh();
        const draft = new Map(this.files);
        const active = { engine: this, files: draft, effects, closed: false };
        let result;
        try { result = context.run(active, work); } finally { active.closed = true; }
        if (result?.then) throw failure("Transaction rules must be synchronous; await only the outer commit.");
        validateFiles(draft);
        this.validate?.(draft);
        for (const [name, validate] of this.validators) validate(draft.get(name));
        const documents = encodeFiles(draft, this.dataset);
        const operations = [];
        for (const [id, resourceBody] of documents) if (canonical(this.documents.get(id)) !== canonical(resourceBody)) {
          operations.push({ operationType: this.documents.has(id) ? "Replace" : "Create", id, resourceBody });
        }
        for (const id of this.documents.keys()) if (!documents.has(id)) operations.push({ operationType: "Delete", id });
        if (operations.length) {
          if (!Number.isSafeInteger(this.root.revision + 1)) throw failure("Dataset revision limit reached.");
          const transaction = crypto.randomUUID();
          const root = { id: "active", scope: SCOPE, dataset: this.dataset, schema: PERSISTENCE_SCHEMA,
            identity: this.root.identity,
            initialized: true, revision: this.root.revision + 1, transaction,
            count: documents.size, digest: documentDigest(documents), updatedAt: Date.now() };
          operations.push({ operationType: "Replace", id: "active", resourceBody: root,
            ifMatch: this.root._etag });
          if (batches(operations).length !== 1) throw failure("Mutation exceeds one atomic transaction. Nothing was saved.");
          try {
            await this.adapter.batch(operations);
          } catch (error) {
            // A timeout may follow a committed batch. Resolve it by its durable transaction ID.
            const observed = await this.adapter.readRoot();
            if (observed?.transaction !== transaction) throw error;
          }
          const confirmed = await this.adapter.readRoot();
          if (confirmed?.transaction === transaction) {
            this.files = draft; this.documents = documents; this.root = confirmed;
          } else {
            this.root = null;
            await this.refresh();
          }
        }
        this.available = true;
        for (const effect of effects) context.exit(effect);
        return result;
      } catch (error) {
        this.available = false;
        throw error;
      }
    };
    const result = this.tail.then(execute);
    this.tail = result.catch(() => {});
    return result;
  }
  read(name, fallback) {
    const active = context.getStore();
    const files = !active?.closed && active?.engine === this ? active.files : this.files;
    if (!files.has(name)) {
      if (fallback !== undefined) return fallback;
      throw failure("Required durable file is missing.");
    }
    return files.get(name);
  }
  write(name, content) {
    const active = context.getStore();
    if (active?.closed || active?.engine !== this) throw failure("Durable writes require an asynchronous transaction.");
    active.files.set(name, content);
  }
}

export let durableState = null;
export function usePersistence(engine) { durableState = engine; }
let localDirectory = null, localTail = Promise.resolve();
const localCells = new Map();

function atomicWrite(filename, content) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const file = fs.openSync(`${filename}.next`, "w", 0o600);
  try { fs.fchmodSync(file, 0o600); fs.writeFileSync(file, content); fs.fsyncSync(file); }
  finally { fs.closeSync(file); }
  fs.renameSync(`${filename}.next`, filename);
  const directory = fs.openSync(path.dirname(filename), "r");
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}

function recoverLocal() {
  const journal = path.join(localDirectory, ".transaction.json");
  if (!fs.existsSync(journal)) return;
  const saved = JSON.parse(fs.readFileSync(journal, "utf8"));
  if (saved.schema !== 1 || !Array.isArray(saved.files) || saved.digest !== sha(canonical(saved.files)) ||
    saved.files.some(([name, content]) => !validFilename(name) || typeof content !== "string")) {
    throw failure("Invalid local transaction journal. Restore the private snapshot.");
  }
  for (const [name, content] of saved.files) atomicWrite(path.join(localDirectory, name), content);
  fs.unlinkSync(journal);
}

function localTransaction(work) {
  const execute = async () => {
    if (!localDirectory) return work();
    fs.mkdirSync(localDirectory, { recursive: true });
    const lockPath = path.join(localDirectory, ".writer.lock");
    try {
      const lock = fs.openSync(lockPath, "wx", 0o600);
      fs.writeFileSync(lock, String(process.pid)); fs.closeSync(lock);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const pid = Number(fs.readFileSync(lockPath, "utf8"));
      if (!Number.isSafeInteger(pid) || pid <= 0) throw failure("Invalid local writer lock.");
      try { process.kill(pid, 0); throw failure("Another local writer is active."); }
      catch (probe) { if (probe.code !== "ESRCH") throw probe; }
      fs.unlinkSync(lockPath);
      return execute();
    }
    try {
      recoverLocal();
      for (const cell of localCells.values()) cell.reload();
      const active = { local: true, files: new Map(), effects: [], closed: false };
      let result;
      try { result = context.run(active, work); } finally { active.closed = true; }
      if (result?.then) throw failure("Transaction rules must be synchronous.");
      if (active.files.size) {
        const files = [...active.files].map(([filename, content]) => [path.relative(localDirectory, filename).split(path.sep).join("/"), content]);
        if (files.some(([name]) => !validFilename(name))) throw failure("Local transaction path is outside DATA_DIR.");
        atomicWrite(path.join(localDirectory, ".transaction.json"), canonical({ schema: 1, files, digest: sha(canonical(files)) }));
        recoverLocal();
        for (const cell of localCells.values()) cell.reload();
      }
      for (const effect of active.effects) context.exit(effect);
      return result;
    } finally { fs.unlinkSync(lockPath); }
  };
  const result = localTail.then(execute);
  localTail = result.catch(() => {});
  return result;
}

export async function initializePersistence(environment = process.env) {
  const mode = environment.PERSISTENCE_BACKEND || (environment.TABLES_ENDPOINT ? "tables" : "file");
  if (!["file", "tables"].includes(mode) || mode === "file" && environment.TABLES_ENDPOINT ||
    environment.COSMOS_ENDPOINT) {
    throw failure("Invalid persistence backend configuration.");
  }
  if (mode === "file") {
    localDirectory = path.resolve(environment.DATA_DIR || "data");
    if (fs.existsSync(path.join(localDirectory, ".transaction.json"))) await localTransaction(() => {});
    return null;
  }
  const { createTableAdapter } = await import("./tables.js");
  const { validateSnapshotSemantics, verifyIdentity } = await import("./snapshots.js");
  durableState = await new DurableState(await createTableAdapter(environment), environment.PERSISTENCE_DATASET_ID,
    validateSnapshotSemantics).initialize();
  verifyIdentity(durableState.root.identity, durableState.files, environment);
  return durableState;
}

export function afterCommit(effect) {
  const active = context.getStore();
  if (active && !active.closed) active.effects.push(effect);
  else effect();
}

export function inTransaction() { return Boolean(context.getStore() && !context.getStore().closed); }
export function transaction(work) {
  if (inTransaction()) throw failure("Do not start asynchronous transactions inside synchronous domain rules.");
  return durableState ? durableState.run(work) : localTransaction(work);
}

// Domain rules remain synchronous; in cloud mode they only edit a transaction's memory draft.
// The outer asynchronous boundary commits that draft before releasing any success or effects.
export function persistentFile(directory, name, { initial, parse = JSON.parse, stringify = canonical,
  validate = () => {}, backup = false, maxBytes = Infinity, optional = false } = {}) {
  const filename = path.join(directory, name);
  const initialContent = () => optional ? stringify(typeof initial === "function" ? initial() : initial) : undefined;
  let local, localRevision, savedAt = null;
  const decode = (content) => {
    if (Buffer.byteLength(content) > maxBytes) throw failure("Persistence file exceeds its size limit.");
    let value;
    try { value = parse(content); }
    catch (error) {
      throw failure("Invalid persisted state. Restore a verified private snapshot.", error instanceof SyntaxError ? SyntaxError : Error);
    }
    validate(value);
    if (Buffer.byteLength(stringify(value)) > maxBytes) throw failure("Persistence file exceeds its size limit.");
    return value;
  };
  const reload = () => {
    try {
      if (fs.statSync(filename).size > maxBytes) throw failure("Persistence file exceeds its size limit.");
      localRevision = fs.readFileSync(filename, "utf8");
      local = decode(localRevision);
    } catch (error) {
      if (name === "audit.json" && error.code !== "ENOENT") throw new Error("Audit storage unavailable. Unable to load the private audit log.");
      if (error.code !== "ENOENT") throw error;
      if (local === undefined) local = typeof initial === "function" ? initial() : structuredClone(initial);
      validate(local);
      localRevision ??= stringify(local);
    }
  };
  if (durableState) {
    decode(durableState.read(name, initialContent()));
    durableState.validators.set(name, (content) => decode(content === undefined ? initialContent() : content));
  } else {
    if (localDirectory && fs.existsSync(path.join(localDirectory, ".transaction.json"))) {
      // Recovery runs under the writer lock at the first command, before any acknowledgements.
      // Reject startup here rather than reading a partially applied journal.
      throw failure("Pending local transaction requires recovery before startup.");
    }
    reload();
    localCells.set(filename, { reload });
  }
  return {
    get revision() {
      if (durableState) return durableState.read(name, initialContent());
      const active = context.getStore();
      return active && !active.closed && active.files.has(filename) ? active.files.get(filename) : localRevision;
    },
    get value() {
      if (durableState) return decode(durableState.read(name, initialContent()));
      const active = context.getStore();
      const staged = active && !active.closed ? active.files : null;
      return staged?.has(filename) ? decode(staged.get(filename)) : inTransaction() ? structuredClone(local) : local;
    },
    get exists() { return durableState ? durableState.files.has(name) : fs.existsSync(filename); },
    get backupExists() {
      return durableState ? durableState.files.has(name.replace(/\.json$/, ".backup.json")) :
        fs.existsSync(filename.replace(/\.json$/, ".backup.json"));
    },
    get savedAt() { return savedAt ?? (!durableState && fs.existsSync(filename) ? fs.statSync(filename).mtimeMs : null); },
    save(value) {
      validate(value);
      if (Buffer.byteLength(stringify(value)) > maxBytes) throw failure("Persistence file exceeds its size limit.");
      if (durableState) {
        if (backup) durableState.write(name.replace(/\.json$/, ".backup.json"), durableState.read(name));
        durableState.write(name, stringify(value));
      } else {
        const active = context.getStore();
        if (active?.local && !active.closed) {
          if (fs.existsSync(`${filename}.next`) && !fs.statSync(`${filename}.next`).isFile()) {
            throw failure("Local save path is unavailable.");
          }
          if (backup) active.files.set(filename.replace(/\.json$/, ".backup.json"), stringify(this.value));
          active.files.set(filename, stringify(value));
          return;
        }
        fs.mkdirSync(directory, { recursive: true });
        if (backup && fs.existsSync(filename)) {
          fs.copyFileSync(filename, `${filename.replace(/\.json$/, ".backup.json")}.next`);
          fs.chmodSync(`${filename.replace(/\.json$/, ".backup.json")}.next`, 0o600);
          fs.renameSync(`${filename.replace(/\.json$/, ".backup.json")}.next`, filename.replace(/\.json$/, ".backup.json"));
        }
        const temporary = `${filename}.next`, file = fs.openSync(temporary, "w", 0o600);
        try { fs.fchmodSync(file, 0o600); fs.writeFileSync(file, stringify(value)); fs.fsyncSync(file); }
        finally { fs.closeSync(file); }
        fs.renameSync(temporary, filename);
        local = value;
        localRevision = stringify(value);
        savedAt = Date.now();
      }
    }
  };
}
