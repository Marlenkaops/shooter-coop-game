import { durableState, inTransaction, persistentFile } from "./persistence.js";

const kinds = new Set(["admin", "auth", "anti-cheat"]);
const textFields = ["action", "actorId", "targetId", "roomCode", "reason", "result"];

export function createAuditLog(directory, { now = Date.now, maxEntries = 1000 } = {}) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new RangeError("Invalid audit retention.");
  const state = persistentFile(directory, "audit.json", {
    initial: { entries: [], nextId: 1 },
    parse(content) {
      try { return JSON.parse(content); }
      catch { throw new Error("Unable to load the private audit log."); }
    },
    validate(saved) {
    if (!Array.isArray(saved.entries) || !Number.isSafeInteger(saved.nextId) || saved.nextId < 1 ||
      Object.keys(saved).some((key) => !["entries", "nextId"].includes(key)) ||
      saved.entries.some((entry, index) => !entry || typeof entry !== "object" ||
        Object.keys(entry).some((key) => !["id", "at", "kind", "count", "lastAt", "level", ...textFields].includes(key)) ||
        !Number.isSafeInteger(entry.id) || entry.id < 1 || entry.id >= saved.nextId ||
        (index > 0 && entry.id <= saved.entries[index - 1].id) ||
        !Number.isFinite(entry.at) || entry.at < 0 || !Number.isSafeInteger(entry.count) || entry.count < 1 ||
        (entry.lastAt !== undefined && (!Number.isFinite(entry.lastAt) || entry.lastAt < entry.at)) ||
        (entry.level !== undefined && !Number.isSafeInteger(entry.level)) ||
        typeof entry.action !== "string" || !kinds.has(entry.kind) || textFields.some((key) => entry[key] !== undefined &&
          (typeof entry[key] !== "string" || entry[key].length > 128)))) {
      throw new Error("Unable to load the private audit log.");
    }
  } });
  let buffered = state.value, timer, dirty = false, error = null;
  const current = () => durableState || inTransaction() ? state.value : buffered;

  function flush() {
    clearTimeout(timer);
    timer = null;
    if (!dirty && !error) return;
    try {
      state.save(current());
      dirty = false;
      error = null;
    } catch (failure) {
      error = failure.code || failure.name;
      throw new Error("Audit storage unavailable. Check server logs.");
    }
  }

  function record(input, { immediate = false, aggregate = false } = {}) {
    if (!kinds.has(input.kind) || typeof input.action !== "string") throw new TypeError("Invalid audit event.");
    const saved = current();
    const entries = saved.entries.slice(-maxEntries);
    let nextId = saved.nextId;
    const at = now();
    const key = [input.kind, ...textFields.map((field) => input[field] || "")].join("|");
    const previous = aggregate && entries.findLast((entry) =>
      [entry.kind, ...textFields.map((field) => entry[field] || "")].join("|") === key);
    if (previous && at - previous.at < 5000) {
      previous.count++;
      previous.lastAt = at;
    } else {
      const entry = { id: nextId++, at, kind: input.kind, count: 1 };
      for (const field of textFields) {
        if (typeof input[field] === "string") entry[field] = input[field].slice(0, 128);
      }
      if (Number.isSafeInteger(input.level)) entry.level = input.level;
      entries.push(entry);
      if (entries.length > maxEntries) entries.shift();
    }
    if (durableState || inTransaction()) {
      try { state.save({ entries, nextId }); }
      catch { throw new Error("Audit storage unavailable. Check server logs."); }
      return;
    }
    buffered = { entries, nextId };
    dirty = true;
    if (immediate) flush();
    else if (!timer) timer = setTimeout(() => {
      try { flush(); } catch {
        console.error("Audit log persistence failed:", error);
      }
    }, 250).unref();
  }

  function read({ kind, before, limit = 50 } = {}) {
    if (error) throw new Error("Audit storage unavailable. Check server logs.");
    if ((kind !== undefined && !kinds.has(kind)) ||
      (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) ||
      !Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError("Invalid audit query.");
    const matches = current().entries.filter((entry) => (!kind || entry.kind === kind) &&
      (!before || entry.id < before)).slice().reverse();
    const page = matches.slice(0, limit).map((entry) => ({ ...entry }));
    return { entries: page, nextBefore: matches.length > limit ? page.at(-1).id : null };
  }

  return { record, read, flush };
}
