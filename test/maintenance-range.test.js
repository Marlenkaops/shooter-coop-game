import test from "node:test";
import assert from "node:assert/strict";
import { mountMaintenanceRange, newRound, registerShot, ROUND_MS, targetCell } from "../public/maintenance-range.js";

test("standby range scores hits and bounded combos, tracks misses and does not mutate prior rounds", () => {
  const initial = newRound(1000);
  assert.equal(ROUND_MS, 30000);
  assert.equal(initial.endsAt, 31000);
  let round = registerShot(initial, true, 1100);
  assert.equal(initial.score, 0);
  assert.equal(round.score, 100);
  round = registerShot(round, true, 1200);
  assert.deepEqual({ score: round.score, hits: round.hits, shots: round.shots, streak: round.streak },
    { score: 210, hits: 2, shots: 2, streak: 2 });
  round = registerShot(round, false, 1300);
  assert.equal(round.score, 210);
  assert.equal(round.hits, 2);
  assert.equal(round.shots, 3);
  assert.equal(round.streak, 0);
  for (let shot = 0; shot < 20; shot++) round = registerShot(round, true, 1400 + shot);
  assert.equal(round.streak, 20);
  const next = registerShot(round, true, 1500);
  assert.equal(next.score - round.score, 190, "combo bonus caps at 90 points");
});

test("standby range rejects late hits at the exact round deadline and starts cleanly on restart", () => {
  const round = registerShot(newRound(1000), true, 30999);
  const ended = registerShot(round, true, 31000);
  assert.equal(ended.active, false);
  assert.equal(ended.hits, 1);
  assert.equal(ended.shots, 1);
  assert.equal(ended.score, 100);
  assert.equal(registerShot(ended, true, 32000), ended);
  assert.deepEqual(newRound(50000), { endsAt: 80000, score: 0, hits: 0, shots: 0, streak: 0, active: true });
});

test("standby targets stay within a nine-cell phone-friendly grid and never repeat the same cell", () => {
  for (const previous of [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8]) {
    const choices = new Set();
    for (let index = 0; index < 100; index++) {
      const cell = targetCell(previous, () => index / 100);
      assert.ok(Number.isInteger(cell) && cell >= 0 && cell < 9);
      assert.notEqual(cell, previous);
      choices.add(cell);
    }
    assert.equal(choices.size, previous === -1 ? 9 : 8);
  }
  for (const value of [-1, 1, NaN, Infinity]) assert.throws(() => targetCell(0, () => value), RangeError);
});

test("the mounted Christmas challenge cycles accessible target artwork without changing scoring or keyboard focus", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const nodes = new Map(), handlers = new Map();
  const root = { querySelector(selector) {
    if (!nodes.has(selector)) nodes.set(selector, { dataset: {}, style: {}, hidden: true,
      classList: { add() {}, remove() {} },
      setAttribute(key, value) { this[key] = value; },
      addEventListener(event, handler) { handlers.set(`${selector}:${event}`, handler); },
      contains(node) { return node === this; }, focus() { this.focused = true; } });
    return nodes.get(selector);
  } };
  mountMaintenanceRange(root);
  handlers.get("#rangeStart:click")();
  const target = nodes.get("#rangeTarget");
  assert.equal(target.focused, true);
  assert.equal(target.hidden, false);
  for (const kind of ["ornament", "gift", "snowflake"]) {
    assert.equal(target.dataset.kind, kind);
    assert.equal(target["aria-label"], `Shoot Christmas ${kind}`);
    handlers.get("#rangeBoard:click")({ target });
  }
  assert.equal(nodes.get("#rangeScore").textContent, "330");
  assert.equal(nodes.get("#rangeAccuracy").textContent, "100%");
  assert.equal(nodes.get("#rangeCombo").textContent, "3x");
  handlers.get("#rangeBoard:click")({ target: nodes.get("#rangeBoard") });
  assert.equal(nodes.get("#rangeScore").textContent, "330");
  assert.equal(nodes.get("#rangeCombo").textContent, "0x");
});
