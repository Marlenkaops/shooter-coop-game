import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAppealLimiter, createAppealStore, MAX_APPEALS } from "../server/appeals.js";

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "last-light-appeals-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const ban = { id: crypto.randomUUID(), targetId: crypto.randomUUID(), targetName: "BannedPlayer",
    kind: "player", at: 10_000, until: null, reason: "Disrupting the match", key: "private-ban-key" };
  return { directory, ban, store: createAppealStore(directory, { now: () => 20_000 }) };
}

test("appeals persist privately, retain ban context, deduplicate and record review", (t) => {
  const { directory, store, ban } = fixture(t);
  assert.equal(store.submit(ban, "too short").ok, false);
  assert.equal(store.submit(ban, "x".repeat(1001)).ok, false);
  assert.equal(store.submit(ban, "Invalid\u0000message").ok, false);
  assert.deepEqual(store.submit(ban, "  I believe this ban was a mistake.  "), { ok: true, status: "open", alreadySubmitted: false });
  assert.deepEqual(store.submit(ban, "A second explanation should not replace the first."), { ok: true, status: "open", alreadySubmitted: true });
  const restored = createAppealStore(directory);
  const [appeal] = restored.list().appeals;
  assert.equal(appeal.reason, "I believe this ban was a mistake.");
  assert.equal(appeal.banReason, ban.reason);
  assert.equal(appeal.banId, ban.id);
  assert.equal(Object.hasOwn(appeal, "key"), false);
  assert.equal(fs.statSync(path.join(directory, "ban-appeals.json")).mode & 0o777, 0o600);
  assert.equal(restored.review(appeal.id, "open", "moderator").ok, false);
  assert.equal(restored.review(appeal.id, "approved", "moderator").ok, true);
  assert.equal(restored.list().total, 0);
  assert.equal(restored.list({ status: "approved" }).appeals[0].reviewedBy, "moderator");
  assert.equal(restored.review(appeal.id, "rejected", "moderator").ok, false);
  assert.equal(restored.submit(ban, "Trying to submit again after approval.").status, "approved");
  assert.equal(restored.list({ status: "unknown" }).ok, false);
  assert.equal(restored.list({ offset: -1 }).ok, false);
});

test("appeal capacity protects open requests, paginates and only replaces reviewed records", (t) => {
  const { directory, ban, store } = fixture(t);
  store.submit(ban, "Please review what happened to my connection.");
  const template = store.list().appeals[0];
  const entries = Array.from({ length: MAX_APPEALS }, () => ({ ...template, id: crypto.randomUUID(), banId: crypto.randomUUID() }));
  fs.writeFileSync(path.join(directory, "ban-appeals.json"), JSON.stringify(entries));
  const full = createAppealStore(directory);
  assert.match(full.submit(ban, "Please review my ban carefully.").error, /inbox is full/);
  assert.equal(full.list().appeals.length, 20);
  assert.equal(full.list().nextOffset, 20);
  assert.equal(full.list({ offset: 480 }).nextOffset, null);
  full.review(entries[0].id, "rejected", "moderator");
  assert.equal(full.submit(ban, "Please review my ban carefully.").ok, true);
  assert.equal(full.list().total, MAX_APPEALS);
  assert.equal(full.get(entries[0].id), undefined);
});

test("appeal storage failures are not reported as successes, and invalid stores fail visibly", (t) => {
  const { directory, ban, store } = fixture(t);
  fs.mkdirSync(path.join(directory, "ban-appeals.json.next"));
  assert.throws(() => store.submit(ban, "Please check this moderation decision."), /EISDIR/);
  assert.equal(store.list().total, 0);
  fs.writeFileSync(path.join(directory, "ban-appeals.json"), JSON.stringify([{ id: "invalid" }]));
  assert.throws(() => createAppealStore(directory), /Invalid ban appeal store/);
});

test("appeal submissions have bounded per-address rate limiting", () => {
  let clock = 0;
  const allow = createAppealLimiter({ now: () => clock });
  for (let i = 0; i < 5; i++) assert.equal(allow("address"), true);
  assert.equal(allow("address"), false);
  assert.equal(allow("other-address"), true);
  clock = 60_000;
  assert.equal(allow("address"), true);
  for (let i = 0; i < 4999; i++) assert.equal(allow(`address-${i}`), true);
  assert.equal(allow("one-too-many"), false);
});
