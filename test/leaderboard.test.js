import test from "node:test";
import assert from "node:assert/strict";
import { mountLeaderboard } from "../src/leaderboard.js";

class Element {
  children = [];
  dataset = {};
  attributes = {};
  listeners = new Map();
  open = false;
  classList = { toggle() {} };
  after() {}
  constructor(tag = "div") { this.tagName = tag.toUpperCase(); }
  set textContent(value) { this.content = String(value); this.children = []; }
  get textContent() { return (this.content || "") + this.children.map((child) => child.textContent).join(""); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.content = ""; this.children = children; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  showModal() { this.open = true; }
  close() { this.open = false; this.listeners.get("close")?.(); }
  click() { if (!this.disabled) this.onclick?.(); }
}

function fixture(t) {
  const ids = ["leaderboardPanel", "leaderboardRefresh", "leaderboardPrevious", "leaderboardNext",
    "leaderboardScore", "leaderboardEntries", "leaderboardOwn", "leaderboardCount", "leaderboardError", "leaderboardClose",
    "rankingPeriod", "rankingMetric", "rankingScope", "rankingRoute", "rankingRouteLabel"];
  const nodes = new Map(ids.map((id) => [`#${id}`, new Element()]));
  const tabs = ["xp", "kills", "season", "records"].map((ranking) => {
    const button = new Element("button");
    button.dataset.ranking = ranking;
    return button;
  });
  const open = new Element("button");
  nodes.get("#leaderboardPanel").querySelectorAll = () => tabs;
  nodes.get("#leaderboardPanel").querySelector = () => ({ after: (filters) => nodes.set("#rankingFilters", filters) });
  for (const [id, value] of Object.entries({ rankingPeriod: "daily", rankingMetric: "score", rankingScope: "global" })) nodes.get(`#${id}`).value = value;
  const saved = Object.getOwnPropertyDescriptor(globalThis, "document");
  globalThis.document = {
    querySelector: (selector) => {
      assert.ok(nodes.has(selector), `Unexpected selector ${selector}`);
      return nodes.get(selector);
    },
    querySelectorAll: (selector) => { assert.equal(selector, ".leaderboard-open"); return [open]; },
    createElement: (tag) => new Element(tag)
  };
  t.after(() => {
    if (saved) Object.defineProperty(globalThis, "document", saved);
    else delete globalThis.document;
  });
  const requests = [], listeners = new Map();
  const socket = {
    connected: true,
    timeout(ms) { assert.equal(ms, 6000); return this; },
    emit(event, input, callback) { assert.ok(["leaderboard", "rankings"].includes(event)); requests.push({ event, input, callback }); },
    on(event, callback) { listeners.set(event, callback); }
  };
  const profiles = [];
  const controller = mountLeaderboard(socket, { openProfile: (tag) => profiles.push(tag) });
  const node = (id) => nodes.get(`#${id}`);
  return { node, tabs, open, socket, requests, listeners, controller, profiles };
}

function reply(overrides = {}) {
  const entry = { rank: 1, username: "<img src=x onerror=alert(1)>", playerTag: "abcdefgh",
    xp: 900, level: 3, totalKills: 17, matches: 2, self: true };
  return { ok: true, sort: "xp", entries: [entry], self: entry, offset: 0, total: 1, nextOffset: null, ...overrides };
}

test("leaderboard safely renders both rankings, your rank and empty states", (t) => {
  const { node, tabs, open, requests } = fixture(t);
  open.click();
  assert.equal(node("leaderboardPanel").open, true);
  assert.equal(node("leaderboardRefresh").disabled, true);
  requests.shift().callback(null, reply());
  const rows = node("leaderboardEntries").children;
  assert.equal(rows[0].className, "leaderboard-self");
  assert.match(rows[0].textContent, /<img src=x/);
  assert.equal(rows[0].children[1].children[0].children[0].tagName, "STRONG", "username is text inside the profile button, not HTML");
  assert.match(node("leaderboardOwn").textContent, /Your rank: #1.*900 XP/);
  assert.equal(node("leaderboardNext").disabled, true);
  tabs[1].click();
  assert.deepEqual(requests[0].input, { sort: "kills", offset: 0 });
  requests.shift().callback(null, reply({ sort: "kills" }));
  assert.equal(node("leaderboardScore").textContent, "Eliminations");
  assert.match(node("leaderboardOwn").textContent, /17 eliminations/);
  assert.equal(tabs[1].attributes["aria-pressed"], "true");
  node("leaderboardRefresh").click();
  requests.shift().callback(null, reply({ entries: [], self: null, total: 0 }));
  assert.equal(node("leaderboardCount").textContent, "No ranked operators yet.");
  assert.match(node("leaderboardOwn").textContent, /not ranked yet/);
  assert.equal(node("leaderboardEntries").children.length, 0);
});

test("verified record controls send every filter, render times/accuracy and open public profiles", (t) => {
  const { node, tabs, open, requests, profiles } = fixture(t);
  open.click(); requests.shift().callback(null, reply());
  tabs[3].click();
  assert.equal(requests[0].event, "rankings");
  assert.deepEqual(requests[0].input, { period: "daily", metric: "score", scope: "global", route: "foundry:campaign", offset: 0 });
  requests.shift().callback(null, reply({ entries: [{ ...reply().entries[0], value: 750 }], self: null }));
  node("leaderboardEntries").children[0].children[1].children[0].click();
  assert.deepEqual(profiles, ["ABCDEFGH"]);
  node("rankingMetric").value = "fastest"; node("rankingPeriod").value = "monthly"; node("rankingScope").value = "squads";
  node("rankingFilters").onchange();
  assert.equal(requests[0].input.scope, "squads");
  requests.shift().callback(null, reply({ entries: [{ playerTag: "TEAM", username: "Squad", matches: 1, value: 60123, clearDifficulty: 4, members: 2, archived: true }], self: null }));
  assert.match(node("leaderboardEntries").textContent, /60.12sNightmare/);
  assert.match(node("leaderboardEntries").textContent, /archived/);
  node("rankingMetric").value = "accuracy"; node("rankingScope").value = "friends"; node("rankingFilters").onchange();
  requests.shift().callback(null, reply({ entries: [{ ...reply().entries[0], value: 7525, hits: 301, shots: 400 }], self: null }));
  assert.match(node("leaderboardEntries").textContent, /75.25%301\/400 shots/);
});

test("leaderboard paginates, ignores stale replies, and clears results on close", (t) => {
  const { node, tabs, open, requests } = fixture(t);
  open.click();
  const oldXp = requests.shift();
  tabs[1].click();
  const current = requests.shift();
  oldXp.callback(null, reply());
  assert.equal(node("leaderboardEntries").children.length, 0);
  current.callback(null, reply({ sort: "kills", nextOffset: 20, total: 25 }));
  node("leaderboardNext").click();
  assert.deepEqual(requests[0].input, { sort: "kills", offset: 20 });
  requests.shift().callback(null, reply({ sort: "kills", offset: 20, total: 25 }));
  assert.equal(node("leaderboardPrevious").disabled, false);
  node("leaderboardPrevious").click();
  assert.equal(requests[0].input.offset, 0);
  node("leaderboardClose").click();
  requests.shift().callback(null, reply());
  assert.equal(node("leaderboardPanel").open, false);
  assert.equal(node("leaderboardEntries").children.length, 0);
  open.click();
  const pending = requests.shift();
  node("leaderboardPanel").close();
  pending.callback(null, reply());
  assert.equal(node("leaderboardEntries").children.length, 0);
});

test("leaderboard exposes failures, retries and reconnects without accepting old-session replies", (t) => {
  const { node, open, socket, requests, listeners } = fixture(t);
  open.click();
  requests.shift().callback(new Error("timeout"));
  assert.match(node("leaderboardError").textContent, /timed out/);
  assert.equal(node("leaderboardRefresh").disabled, false);
  node("leaderboardRefresh").click();
  requests.shift().callback(null, { ok: false, error: "Leaderboard unavailable." });
  assert.match(node("leaderboardError").textContent, /unavailable/);
  node("leaderboardRefresh").click();
  const pending = requests.shift();
  socket.connected = false;
  listeners.get("disconnect")();
  pending.callback(null, reply());
  assert.equal(node("leaderboardEntries").children.length, 0);
  assert.match(node("leaderboardError").textContent, /Connection lost/);
  assert.equal(node("leaderboardRefresh").disabled, true);
  socket.connected = true;
  listeners.get("identity")();
  requests.shift().callback(null, reply());
  assert.equal(node("leaderboardError").textContent, "");
  assert.equal(node("leaderboardEntries").children.length, 1);
  listeners.get("matchStarted")();
  assert.equal(node("leaderboardPanel").open, false);
});
