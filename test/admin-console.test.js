import test from "node:test";
import assert from "node:assert/strict";
import { mountAdminConsole } from "../src/admin-console.js";

class Element {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => this.classes.add(name)),
      remove: (...names) => names.forEach((name) => this.classes.delete(name)),
      contains: (name) => this.classes.has(name),
      toggle: (name, force = !this.classes.has(name)) => {
        if (force) this.classes.add(name);
        else this.classes.delete(name);
        return force;
      }
    };
  }
  set textContent(value) { this.content = String(value); this.children = []; }
  get textContent() { return (this.content || "") + this.children.map((child) => child.textContent).join(""); }
  set className(value) { this.classes = new Set(value.split(/\s+/)); }
  get className() { return [...this.classes].join(" "); }
  append(...children) { this.children.push(...children); }
  setAttribute(name, value) { this[`attribute:${name}`] = String(value); }
  replaceChildren(...children) { this.content = ""; this.children = children; }
  click() { this.onclick?.(); }
  requestSubmit() { this.onsubmit?.({ preventDefault() {} }); }
  querySelectorAll(selector) {
    assert.equal(selector, "button");
    return this.children.flatMap((child) => [
      ...(child.tagName === "BUTTON" ? [child] : []), ...child.querySelectorAll(selector)
    ]);
  }
}

const profile = {
  id: "11111111-1111-4111-8111-111111111111", username: "TestPlayer", level: 1,
  xp: 0, tokens: 0, ownedWeapons: ["rifle"], unlockedMaps: ["foundry"], campaignCompleted: []
};

function fixture(t) {
  const ids = ["adminProfileError", "adminProfileNotice", "adminProgression", "adminSelectedProfile",
    "adminLevel", "adminProfileQuery", "adminProfileResults", "adminProfileNext", "adminProfilePrevious",
    "adminProfileSearch", "adminProfileSelf", "adminLogError", "adminLogKind", "adminLogEntries",
    "adminLogOlder", "adminLogRefresh", "adminLogSection", "adminRoomSection", "adminSupport",
    "adminGun", "adminGrantGun", "adminHeal", "adminAmmo", "adminStorageError", "adminStorageStatus",
    "adminStorageRefresh", "adminStorageSection", "adminReportSection", "adminReportStatus",
    "adminReportEntries", "adminReportError", "adminReportRefresh", "adminReportNext",
    "adminBanSection", "adminBanRefresh", "adminBanNext", "adminBanEntries", "adminBanError",
    "adminCommandForm", "adminCommandInput", "adminCommandSubmit", "adminCommandHelp",
    "adminCommandOutput", "adminCommandError", "adminPrivateCodes", "adminClearCodes",
    "adminAppealSection", "adminAppealStatus", "adminAppealRefresh", "adminAppealNext", "adminAppealEntries", "adminAppealError"];
  const nodes = new Map(ids.map((id) => [`#${id}`, new Element()]));
  nodes.get("#adminProfileQuery").value = nodes.get("#adminLogKind").value = "";
  nodes.get("#adminReportStatus").value = "open";
  nodes.get("#adminAppealStatus").value = "open";
  nodes.get("#adminCommandInput").value = "";
  const controls = ["setLevel", "unlockAll", "unlockWeapons", "unlockMaps"].map((operation) => {
    const button = new Element("button");
    button.dataset = { operation };
    return button;
  });
  nodes.get("#adminProgression").append(...controls);
  nodes.get("#adminProgression").classList.add("hidden");
  const savedDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  globalThis.document = {
    querySelector: (selector) => {
      assert.ok(nodes.has(selector), `Unexpected selector ${selector}`);
      return nodes.get(selector);
    },
    createElement: (tag) => new Element(tag)
  };
  globalThis.window = { confirm: () => true };
  t.after(() => {
    if (savedDocument) Object.defineProperty(globalThis, "document", savedDocument);
    else delete globalThis.document;
    if (savedWindow) Object.defineProperty(globalThis, "window", savedWindow);
    else delete globalThis.window;
  });
  const pending = [];
  const socket = {
    timeout(milliseconds) { assert.equal(milliseconds, 6000); return this; },
    emit(event, input, callback) { pending.push({ event, input, callback }); }
  };
  const take = (event) => {
    const index = pending.findIndex((request) => request.event === event);
    assert.ok(index >= 0, `Missing ${event} request`);
    return pending.splice(index, 1)[0];
  };
  const role = { owner: false };
  const controller = mountAdminConsole(socket, { isAdmin: () => true, isOwner: () => role.owner, currentProfile: () => profile });
  const node = (id) => nodes.get(`#${id}`);
  const load = (updated = profile) => take("adminProfile").callback(null, { ok: true, profile: updated, online: true });
  const submit = (operation) => node("adminProgression").onsubmit({
    preventDefault() {}, submitter: controls.find((button) => button.dataset.operation === operation)
  });
  return { controller, node, load, take, submit, controls, pending, role };
}

test("command help and private codes use text-only output, bounded pending requests and explicit clearing", (t) => {
  const { node, take, controller } = fixture(t);
  node("adminCommandHelp").click();
  const help = take("adminCommand");
  assert.equal(help.input, "?help");
  help.callback(null, { ok: true, lines: ["?help", "<img src=x onerror=alert(1)>"] });
  assert.match(node("adminCommandOutput").textContent, /<img/);
  assert.ok(node("adminCommandOutput").children.every((child) => child.tagName === "P"));
  node("adminCommandInput").value = "?codes TestPlayer";
  node("adminCommandForm").requestSubmit();
  const request = take("adminCommand");
  assert.equal(node("adminCommandSubmit").disabled, true);
  request.callback(null, { ok: true, codes: ["012345", "123456", "234567"], lines: ["Private codes"] });
  assert.equal(node("adminCommandSubmit").disabled, false);
  assert.equal(node("adminPrivateCodes").classList.contains("hidden"), false);
  assert.match(node("adminPrivateCodes").textContent, /012345/);
  node("adminClearCodes").click();
  assert.equal(node("adminPrivateCodes").textContent, "");
  assert.equal(node("adminPrivateCodes").classList.contains("hidden"), true);
  node("adminCommandHelp").click();
  const stale = take("adminCommand");
  controller.reset();
  stale.callback(null, { ok: true, codes: ["999999"], lines: ["stale"] });
  assert.equal(node("adminPrivateCodes").textContent, "");
  assert.equal(node("adminCommandOutput").textContent, "");
});

test("administrator-target ban controls require an owner and warn about removed admin access", (t) => {
  const { node, take, role } = fixture(t);
  const reports = [{ id: "report", targetAdmin: true, targetName: "AdminTarget", targetId: "target",
    reporterName: "Reporter", reporterId: "r", status: "open", at: 100, roomCode: "ABC123", reason: "Claim", canBanIp: true }];
  const refresh = () => {
    node("adminReportRefresh").onclick();
    take("adminReports").callback(null, { ok: true, reports, total: 1, nextOffset: null });
  };
  refresh();
  assert.ok(node("adminReportEntries").querySelectorAll("button").filter((button) =>
    ["Ban player", "IP ban"].includes(button.textContent)).every((button) => button.disabled));
  assert.match(node("adminReportEntries").textContent, /only the owner login/);
  role.owner = true;
  refresh();
  const ban = node("adminReportEntries").querySelectorAll("button").find((button) => button.textContent === "Ban player");
  assert.equal(ban.disabled, false);
  let warning;
  globalThis.window.confirm = (message) => { warning = message; return true; };
  ban.onclick();
  assert.match(warning, /administrator.*lose game and admin access/);
  assert.equal(take("adminBanReport").input.reportId, "report");
});

test("admin console opens on your compact profile and preserves the selected player", (t) => {
  const { controller, node, take, pending } = fixture(t);
  controller.open();
  const request = take("adminProfile");
  assert.equal(request.input, profile.id);
  request.callback(null, { ok: true, profile, online: true });
  assert.match(node("adminSelectedProfile").textContent, /TestPlayer.*Online.*Level 1/);
  assert.match(node("adminSelectedProfile").textContent, /Operator ID: 11111111/);
  assert.equal(node("adminProgression").classList.contains("hidden"), false);
  assert.equal(node("adminLevel").value, 1);
  controller.open();
  assert.equal(pending.length, 0);
});

test("report review is explicit, text-safe, paginated and cannot restore a logged-out view", (t) => {
  const { controller, node, take } = fixture(t);
  node("adminReportSection").open = true;
  node("adminReportSection").ontoggle();
  const request = take("adminReports");
  assert.deepEqual(request.input, { status: "open", offset: 0 });
  request.callback(null, { ok: true, total: 21, nextOffset: 20, reports: [{
    id: "report-id", targetName: "Target", reporterName: "Reporter", reporterId: "a", targetId: "b",
    status: "open", roomCode: "ABCDEF", at: 10_000, reason: "<script>Not executed</script>"
  }] });
  assert.match(node("adminReportEntries").textContent, /<script>Not executed<\/script>/);
  const review = node("adminReportEntries").querySelectorAll("button")[0];
  review.onclick();
  assert.equal(take("adminReviewReport").input.status, "reviewed");
  node("adminReportNext").onclick();
  const next = take("adminReports");
  assert.equal(next.input.offset, 20);
  controller.reset();
  next.callback(null, { ok: true, reports: [{ reason: "private stale data" }], total: 1, nextOffset: null });
  assert.equal(node("adminReportEntries").textContent, "");
});

test("report bans require confirmation, show IP availability and recover from failure", (t) => {
  const { controller, node, take, pending } = fixture(t);
  const reports = [
    { id: "new-report", targetName: "Target", reporterName: "Reporter", reporterId: "a", targetId: "b",
      status: "open", roomCode: "ABCDEF", at: 10_000, reason: "Reported misconduct", canBanIp: true },
    { id: "old-report", targetName: "Offline", reporterName: "Reporter", reporterId: "a", targetId: "c",
      status: "open", roomCode: "ABCDEF", at: 10_000, reason: "Old report" }
  ];
  node("adminReportRefresh").onclick();
  take("adminReports").callback(null, { ok: true, total: 2, nextOffset: null, reports });
  const buttons = node("adminReportEntries").querySelectorAll("button");
  const playerBan = buttons.find((button) => button.textContent === "Ban player");
  const ipBan = buttons.find((button) => button.textContent === "IP ban");
  assert.equal(ipBan.disabled, false);
  assert.equal(buttons.filter((button) => button.textContent === "IP ban")[1].disabled, true);
  globalThis.window.confirm = () => false;
  playerBan.onclick();
  assert.equal(pending.length, 0);
  let confirmation = "";
  globalThis.window.confirm = (message) => { confirmation = message; return true; };
  ipBan.onclick();
  assert.match(confirmation, /Everyone sharing this IP/);
  assert.match(confirmation, /until an administrator removes/);
  assert.equal(ipBan.disabled, true);
  const denied = take("adminBanReport");
  assert.deepEqual(denied.input, { reportId: "new-report", kind: "ip", duration: "perm" });
  denied.callback(null, { ok: false, error: "This address is shared with an administrator." });
  assert.match(node("adminReportError").textContent, /shared with an administrator/);
  assert.equal(ipBan.disabled, false);
  playerBan.onclick();
  const accepted = take("adminBanReport");
  assert.equal(accepted.input.kind, "player");
  accepted.callback(null, { ok: true });
  const refreshed = take("adminReports");
  controller.reset();
  refreshed.callback(null, { ok: true, reports, total: 2, nextOffset: null });
  assert.equal(node("adminReportEntries").textContent, "");
});

test("active bans offer confirmed removal, pagination, error recovery and stale-session protection", (t) => {
  const { controller, node, take, pending } = fixture(t);
  node("adminBanSection").open = true;
  node("adminBanSection").ontoggle();
  assert.deepEqual(take("adminBans").input, { offset: 0 });
  node("adminBanRefresh").onclick();
  take("adminBans").callback(null, { ok: true, total: 21, nextOffset: 20,
    bans: [{ id: "ban-id", kind: "ip", targetName: "<img src=x>", targetId: "target", actorId: "staff", at: 100, reportId: "report" }] });
  assert.match(node("adminBanEntries").textContent, /<img src=x>/);
  const remove = node("adminBanEntries").querySelectorAll("button")[0];
  globalThis.window.confirm = () => false;
  remove.onclick();
  assert.equal(pending.length, 0);
  globalThis.window.confirm = () => true;
  remove.onclick();
  const failed = take("adminUnban");
  assert.equal(failed.input, "ban-id");
  failed.callback(null, { ok: false, error: "Storage unavailable." });
  assert.equal(remove.disabled, false);
  assert.equal(node("adminBanError").textContent, "Storage unavailable.");
  remove.onclick();
  take("adminUnban").callback(null, { ok: true });
  take("adminBans");
  node("adminBanNext").onclick();
  const next = take("adminBans");
  assert.equal(next.input.offset, 20);
  controller.reset();
  next.callback(null, { ok: true, bans: [], total: 1, nextOffset: null });
  assert.equal(node("adminBanEntries").textContent, "");
  assert.equal(node("adminBanSection").open, false);
});

test("appeal inbox renders safely, confirms decisions, recovers from errors and clears on logout", (t) => {
  const { controller, node, take, pending } = fixture(t);
  node("adminAppealSection").open = true;
  node("adminAppealSection").ontoggle();
  const initial = take("adminAppeals");
  assert.deepEqual(initial.input, { status: "open", offset: 0 });
  initial.callback(null, { ok: true, total: 21, nextOffset: 20, appeals: [{
    id: "appeal-id", targetName: "Target", targetId: "target", kind: "ip", status: "open",
    reason: "<img src=x onerror=alert(1)>", banReason: "Harassing players", at: 1000, banUntil: null
  }] });
  assert.match(node("adminAppealEntries").textContent, /<img src=x/);
  assert.match(node("adminAppealEntries").textContent, /shared network address/);
  const [approve, reject] = node("adminAppealEntries").querySelectorAll("button");
  globalThis.window.confirm = () => false;
  approve.onclick();
  assert.equal(pending.length, 0);
  globalThis.window.confirm = () => true;
  approve.onclick();
  assert.equal(reject.disabled, true);
  const failure = take("adminReviewAppeal");
  assert.deepEqual(failure.input, { id: "appeal-id", status: "approved" });
  failure.callback(null, { ok: false, error: "Storage unavailable." });
  assert.equal(approve.disabled, false);
  assert.equal(node("adminAppealError").textContent, "Storage unavailable.");
  reject.onclick();
  const denied = take("adminReviewAppeal");
  assert.equal(denied.input.status, "rejected");
  denied.callback(null, { ok: true });
  take("adminAppeals");
  node("adminAppealNext").onclick();
  const next = take("adminAppeals");
  assert.equal(next.input.offset, 20);
  controller.reset();
  next.callback(null, { ok: true, total: 1, nextOffset: null, appeals: [{ reason: "stale private message" }] });
  assert.equal(node("adminAppealEntries").textContent, "");
  assert.equal(node("adminAppealSection").open, false);
});

test("unlock controls do not require a level and successful updates retain their notice", (t) => {
  const { controller, node, load, take, submit, controls } = fixture(t);
  controller.open();
  load();
  node("adminLevel").value = "";
  submit("unlockAll");
  const request = take("adminSetProgression");
  assert.deepEqual(request.input, { playerId: profile.id, operation: "unlockAll" });
  assert.ok(controls.every((button) => button.disabled));
  request.callback(null, { ok: true });
  load();
  assert.match(node("adminProfileNotice").textContent, /^Saved\./);
  assert.ok(controls.every((button) => !button.disabled));
  node("adminLevel").value = 0;
  submit("setLevel");
  assert.match(node("adminProfileError").textContent, /valid whole-number level/);
});

test("a previous admin session cannot re-enable controls during a newer session's update", (t) => {
  const { controller, node, load, take, submit, controls } = fixture(t);
  controller.open();
  load();
  submit("unlockAll");
  const oldUpdate = take("adminSetProgression");
  controller.reset();
  assert.ok(controls.every((button) => !button.disabled));
  controller.open();
  load();
  submit("unlockMaps");
  const newUpdate = take("adminSetProgression");
  oldUpdate.callback(null, { ok: true });
  assert.ok(controls.every((button) => button.disabled));
  assert.equal(node("adminProfileNotice").textContent, "Saving changes…");
  newUpdate.callback(null, { ok: true });
  load();
  assert.ok(controls.every((button) => !button.disabled));
});

test("profile errors stop loading and leave progression unavailable", (t) => {
  const { controller, node, take } = fixture(t);
  controller.open();
  take("adminProfile").callback(null, { ok: false, error: "Profile unavailable." });
  assert.equal(node("adminProfileError").textContent, "Profile unavailable.");
  assert.match(node("adminSelectedProfile").textContent, /could not be loaded/);
  assert.equal(node("adminProgression").classList.contains("hidden"), true);
});

test("activity loads on expansion and stale responses cannot restore reset data", (t) => {
  const { controller, node, take } = fixture(t);
  node("adminLogSection").open = true;
  node("adminLogSection").ontoggle();
  const logs = take("adminAuditLogs");
  assert.deepEqual(logs.input, { limit: 30 });
  controller.reset();
  logs.callback(null, { ok: true, entries: [{ kind: "admin", action: "unlockAll", at: 1 }], nextBefore: null });
  assert.equal(node("adminLogEntries").textContent, "");
  assert.equal(node("adminLogSection").open, false);
  assert.equal(node("adminRoomSection").open, false);
});
