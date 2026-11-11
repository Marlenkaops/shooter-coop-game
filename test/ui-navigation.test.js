import test from "node:test";
import assert from "node:assert/strict";
import { mountMenuNavigation } from "../src/ui-navigation.js";

function fixture(t) {
  const saved = new Map(), events = new Map(), rootEvents = new Map();
  const replace = (key, value) => {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  const document = { activeElement: null };
  let poll, stopped = false, dialog = null, surface = true;
  const pad = { buttons: Array.from({ length: 16 }, () => ({ pressed: false })), axes: [0, 0] };
  const items = ["first", "range", "last"].map((id) => ({
    id, tagName: "BUTTON", getClientRects: () => [1], closest: () => null,
    matches: (selector) => id === "range" && selector === 'input[type="range"]',
    focus() { document.activeElement = this; }, scrollIntoView() {}, click() { this.clicked = true; },
    dispatchEvent(event) { this.event = event.type; }
  }));
  Object.assign(items[1], { tagName: "INPUT", min: "0", max: "1", step: ".1", value: ".5" });
  const root = {
    addEventListener: (name, listener) => rootEvents.set(name, listener),
    querySelector(selector) {
      if (selector === "dialog[open]") return dialog;
      if (selector === ".admin-panel:not(.hidden), .ban-screen") return null;
      return surface ? { querySelectorAll: () => items } : null;
    }
  };
  replace("document", document);
  replace("navigator", { getGamepads: () => [pad] });
  replace("addEventListener", (name, listener) => events.set(name, listener));
  replace("setInterval", (callback) => { poll = callback; return 42; });
  replace("clearInterval", () => { stopped = true; });
  t.after(() => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  mountMenuNavigation(root);
  return { items, document, rootEvents, events, pad, poll: () => poll(), stopped: () => stopped,
    setDialog: (value) => { dialog = value; }, setSurface: (value) => { surface = value; } };
}

test("keyboard menu navigation wraps, leaves native inputs alone and does not capture gameplay", (t) => {
  const f = fixture(t), key = f.rootEvents.get("keydown");
  let prevented = false;
  const event = { code: "ArrowDown", target: { matches: () => false },
    preventDefault: () => { prevented = true; }, stopPropagation() {} };
  key(event);
  assert.equal(f.document.activeElement, f.items[0]); assert.equal(prevented, true);
  f.document.activeElement = null; key({ ...event, code: "ArrowUp" });
  assert.equal(f.document.activeElement, f.items[2]);
  f.items[2].focus(); key(event); assert.equal(f.document.activeElement, f.items[0]);
  prevented = false; key({ ...event, target: { matches: () => true } });
  assert.equal(prevented, false);
  f.setSurface(false); key(event); assert.equal(prevented, false);
});

test("controller menus debounce buttons, adjust bounded sliders, accept and close dialogs", (t) => {
  const f = fixture(t);
  f.pad.buttons[13].pressed = true; f.poll();
  assert.equal(f.document.activeElement, f.items[0]);
  f.poll(); assert.equal(f.document.activeElement, f.items[0], "held button does not repeat every poll");
  f.pad.buttons[13].pressed = false; f.poll();
  f.items[1].focus(); f.pad.axes[0] = 1; f.poll();
  assert.equal(Number(f.items[1].value), .6); assert.equal(f.items[1].event, "input");
  f.pad.axes[0] = 0; f.poll();
  f.items[1].value = "1"; f.pad.axes[0] = 1; f.poll(); assert.equal(Number(f.items[1].value), 1);
  f.pad.axes[0] = 0; f.poll(); f.items[2].focus();
  f.pad.buttons[0].pressed = true; f.poll(); assert.equal(f.items[2].clicked, true);
  f.pad.buttons[0].pressed = false; f.poll();
  let closed = false;
  f.setDialog({ querySelectorAll: () => f.items, close: () => { closed = true; } });
  f.pad.buttons[1].pressed = true; f.poll(); assert.equal(closed, true);
  globalThis.navigator.getGamepads = () => [];
  f.events.get("gamepaddisconnected")(); assert.equal(f.stopped(), true);
});
