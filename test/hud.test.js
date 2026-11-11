import test from "node:test";
import assert from "node:assert/strict";
import { ammoHeaderMarkup, escapeHtml, setHudMarkup } from "../src/hud.js";

test("the touch wallet shares the scaled ammo header and keeps escaped labels and live balances", () => {
  const first = ammoHeaderMarkup('Rifle <test> & "focus"', 1234567);
  assert.match(first, /class="ammo-header"/);
  assert.match(first, /Rifle &lt;test&gt; &amp; &quot;focus&quot;/);
  assert.match(first, /class="hud-ammo-wallet" aria-label="Token balance"/);
  assert.ok(first.includes(`data-token-balance>${(1234567).toLocaleString()}</strong>`));
  assert.notEqual(ammoHeaderMarkup("Rifle", 18), ammoHeaderMarkup("Rifle", 19));
  assert.equal(escapeHtml("'"), "&#039;");
  for (const value of [-1, NaN, "18", 1.5]) assert.throws(() => ammoHeaderMarkup("Rifle", value), RangeError);
});

test("unchanged HUD snapshots preserve existing DOM instead of rebuilding it at 20 Hz", () => {
  let writes = 0, content;
  const element = { set innerHTML(value) { content = value; writes++; } };
  assert.equal(setHudMarkup(element, "<b>30</b>"), true);
  for (let tick = 0; tick < 200; tick++) assert.equal(setHudMarkup(element, "<b>30</b>"), false);
  assert.equal(writes, 1);
  assert.equal(content, "<b>30</b>");
  assert.equal(setHudMarkup(element, "<b>29</b>"), true);
  assert.equal(writes, 2);
});

test("HUD caching is per element and never suppresses changing reload progress or replacement panels", () => {
  const ammo = {}, squad = {}, replacement = {};
  for (const progress of [0, 25, 50, 75, 100]) {
    const markup = `<i style="width:${progress}%"></i>`;
    assert.equal(setHudMarkup(ammo, markup), true);
    assert.equal(ammo.innerHTML, markup);
  }
  assert.equal(setHudMarkup(squad, ammo.innerHTML), true);
  assert.equal(setHudMarkup(replacement, ammo.innerHTML), true);
  assert.equal(setHudMarkup(ammo, ""), true);
  assert.equal(ammo.innerHTML, "");
});
