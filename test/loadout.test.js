import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadoutMarkup } from "../src/loadout.js";
import { WEAPONS } from "../shared/weapons.js";

const profile = { equippedWeaponId: "rifle", ownedWeapons: ["rifle", "smg", "pistol"] };

test("loadout slots show the saved equipped gun, optic, starting ammo and only collected guns", () => {
  const markup = loadoutMarkup(profile);
  assert.match(markup, /Your loadout/);
  assert.match(markup, /Ready to deploy/);
  assert.match(markup, /Starting magazine<\/dt><dd>24 \/ 24/);
  assert.match(markup, /Starting reserve<\/dt><dd>120 rounds/);
  assert.match(markup, /Holographic 1x/);
  assert.match(markup, /Collected guns <span>3 \/ 12/);
  assert.equal((markup.match(/class="weapon-slot/g) || []).length, 4, "one list plus three cards");
  assert.match(markup, /weapon-slot equipped[^]*AR-17 Rifle/);
  assert.ok(!markup.includes("Sentinel SR"));
  assert.ok(!markup.includes("<button"));
});

test("live loadouts use actual held gun, ammo and reload state instead of future saved equipment", () => {
  const markup = loadoutMarkup({ ...profile, equippedWeaponId: "pistol" },
    { weaponId: "smg", ammo: 5, reserve: 42, reloading: true });
  assert.match(markup, /Reloading/);
  assert.match(markup, /Magazine<\/dt><dd>5 \/ 36/);
  assert.match(markup, /Reserve<\/dt><dd>42 rounds/);
  assert.match(markup, /Reflex 1x/);
  assert.match(markup, /weapon-slot equipped[^]*Viper SMG/);
  assert.match(markup, /You carry one gun/);
  assert.ok(!markup.includes("Starting magazine"));
});

test("loot equipment, all gun types and zero-ammo snapshots retain correct optics and fire modes", () => {
  for (const weapon of Object.values(WEAPONS)) {
    const markup = loadoutMarkup({ equippedWeaponId: weapon.id, ownedWeapons: Object.keys(WEAPONS) },
      { weaponId: weapon.id, ammo: 0, reserve: 0, reloading: false });
    assert.match(markup, /In mission/);
    assert.ok(markup.includes(`<dd>0 / ${weapon.magSize}</dd>`));
    assert.ok(markup.includes(weapon.optic.label));
    assert.ok(markup.includes(weapon.fireMode === "semi" ? "Semi-auto" : "Automatic"));
    assert.ok(markup.includes(`/weapon-previews/${weapon.id}.png`));
  }
});

test("disconnected loadouts are explicitly stale; missing profiles do not invent a weapon", () => {
  assert.match(loadoutMarkup(profile, null, false), /Last synced/);
  assert.match(loadoutMarkup(profile, { weaponId: "rifle", ammo: 0, reserve: 0 }, false), /Last synced/);
  assert.ok(!loadoutMarkup(null).includes("AR-17"));
});

test("malformed loadouts fail explicitly and never create untrusted image URLs or ammo text", () => {
  assert.throws(() => loadoutMarkup({ ...profile, equippedWeaponId: "__proto__" }), /Invalid saved/);
  assert.throws(() => loadoutMarkup({ ...profile, ownedWeapons: ["<script>"] }), /Invalid saved/);
  assert.throws(() => loadoutMarkup(profile, { weaponId: "invalid", ammo: 1, reserve: 1 }), /Invalid active/);
  assert.throws(() => loadoutMarkup(profile, { weaponId: "rifle", ammo: NaN, reserve: 1 }), /ammunition/);
});

test("every catalog weapon has a real, bounded PNG preview", () => {
  for (const id of Object.keys(WEAPONS)) {
    const bytes = fs.readFileSync(new URL(`../public/weapon-previews/${id}.png`, import.meta.url));
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(bytes.readUInt32BE(16), 320);
    assert.equal(bytes.readUInt32BE(20), 160);
    assert.ok(bytes.length < 60_000);
  }
});
