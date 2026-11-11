import test from "node:test";
import assert from "node:assert/strict";
import { mountUpdates } from "../src/updates.js";
import { RELEASE } from "../src/release.js";

function fixture(t, seen = null, canAutoShow = () => true) {
  class Element {
    children = [];
    listeners = new Map();
    open = false;
    append(...children) { this.children.push(...children); }
    addEventListener(event, callback) { this.listeners.set(event, callback); }
    showModal() { this.open = true; }
    close() { this.open = false; }
  }
  const nodes = new Map(["updatesPanel", "updateChanges", "updateRelease", "updateDate", "updatesClose"]
    .map((id) => [`#${id}`, new Element()]));
  const buttons = [new Element(), new Element()];
  const store = new Map(seen ? [["lastLightSeenRelease", seen]] : []);
  const prior = ["document", "localStorage"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const state = { blocked: false };
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    querySelector: (selector) => selector.startsWith("dialog[open]") ? state.blocked ? {} : null : nodes.get(selector),
    querySelectorAll: () => buttons,
    createElement: () => new Element()
  } });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value)
  } });
  t.after(() => {
    for (const [key, descriptor] of prior) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const listeners = new Map();
  const controller = mountUpdates({ on: (event, callback) => listeners.set(event, callback) }, { canAutoShow });
  return { nodes, buttons, store, state, listeners, controller, panel: nodes.get("#updatesPanel") };
}

test("release notes show once per release, persist dismissal, and can always be reopened", (t) => {
  const { nodes, buttons, store, listeners, panel } = fixture(t, "previous-release");
  assert.equal(nodes.get("#updateChanges").children.length, RELEASE.changes.length);
  assert.equal(nodes.get("#updateRelease").textContent, RELEASE.title);
  listeners.get("identity")();
  assert.equal(panel.open, true);
  nodes.get("#updatesClose").onclick();
  assert.equal(store.get("lastLightSeenRelease"), RELEASE.id);
  listeners.get("identity")();
  assert.equal(panel.open, false);
  buttons[1].onclick();
  assert.equal(panel.open, true);
  let prevented = false;
  panel.listeners.get("cancel")({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(panel.open, false);
});

test("seen releases do not reopen automatically and server transitions close notes without marking them read", (t) => {
  const { buttons, store, listeners, panel } = fixture(t, RELEASE.id);
  listeners.get("identity")();
  assert.equal(panel.open, false);
  for (const event of ["joined", "matchStarted", "banned"]) {
    buttons[0].onclick();
    listeners.get(event)();
    assert.equal(panel.open, false);
  }
  assert.equal(store.get("lastLightSeenRelease"), RELEASE.id);
});

test("release notes do not interrupt gameplay or another modal", (t) => {
  let allowed = false;
  const { state, listeners, panel, store } = fixture(t, null, () => allowed);
  listeners.get("identity")();
  assert.equal(panel.open, false);
  allowed = true;
  state.blocked = true;
  listeners.get("identity")();
  assert.equal(panel.open, false);
  state.blocked = false;
  listeners.get("identity")();
  assert.equal(panel.open, true);
  listeners.get("joined")();
  assert.equal(store.has("lastLightSeenRelease"), false);
});
