import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "three";
import { SKINS, skinFor } from "../shared/skins.js";
import { skinShopMarkup } from "../src/skin-shop.js";
import { createTacticalEnemy } from "../src/tactical-enemies.js";
import { createWeaponHands } from "../src/weapon-hands.js";
import { decodeTacticalBody } from "../src/tactical-body.js";
import { createCommandGuard } from "../server/anti-cheat.js";

test("outfit catalog contains only original cosmetic palettes with fixed server prices", () => {
  assert.equal(skinFor("standard").cost, 0);
  assert.deepEqual(Object.values(SKINS).map((skin) => skin.cost), [0, 120, 240, 360]);
  assert.throws(() => skinFor("__proto__"), /Unknown outfit/);
  assert.throws(() => skinFor("<script>"), /Unknown outfit/);
  for (const skin of Object.values(SKINS)) {
    assert.deepEqual(Object.keys(skin).sort(), ["accent", "cost", "description", "id", "name", "palette"]);
    assert.equal(Object.isFrozen(skin), true);
    assert.match(skin.id, /^[a-z]+$/);
    const preview = fs.readFileSync(new URL(`../public/skin-previews/${skin.id}.png`, import.meta.url));
    assert.equal(preview.subarray(1, 4).toString(), "PNG");
    assert.equal(preview.readUInt32BE(16), 240);
    assert.equal(preview.readUInt32BE(20), 320);
    assert.ok(preview.length < 100_000);
  }
});

test("shop shows balance, ownership, price and disabled unaffordable purchases", () => {
  const markup = skinShopMarkup({ tokens: 120, ownedSkins: ["standard"], equippedSkinId: "standard" });
  assert.match(markup, /120 tokens/);
  assert.match(markup, /data-skin="nightwatch" data-skin-action="buySkin"\s*>Buy/);
  assert.match(markup, /data-skin="copperline" data-skin-action="buySkin"\s*disabled/);
  assert.match(markup, /Earn 6 tokens for each NPC/);
  assert.match(markup, /no combat bonuses/);
  const equipped = skinShopMarkup({ tokens: 0, ownedSkins: ["standard", "nightwatch"], equippedSkinId: "nightwatch" });
  assert.match(equipped, /data-skin="standard" data-skin-action="equipSkin"\s*>Equip outfit/);
  assert.match(equipped, /data-skin="nightwatch" data-skin-action="equipSkin"\s*disabled/);
  assert.match(skinShopMarkup(null), /when connected/);
});

test("outfit packets reject unknown IDs and client-supplied prices or balances", () => {
  for (const event of ["buySkin", "equipSkin"]) {
    for (const id of Object.keys(SKINS)) assert.equal(createCommandGuard().check([event, id], false).ok, true);
    for (const invalid of ["__proto__", "unknown", null, { skinId: "nightwatch", cost: 0 }, 120]) {
      assert.equal(createCommandGuard().check([event, invalid], false).ok, false);
    }
  }
});

test("player outfit templates differ without recoloring NPCs or changing geometry", () => {
  const enemy = { id: "one", type: "drone" }, options = { mapId: "foundry", weaponId: "rifle" };
  const npc = createTacticalEnemy(enemy, options);
  const standard = createTacticalEnemy(enemy, { ...options, skinId: "standard" });
  const custom = createTacticalEnemy(enemy, { ...options, skinId: "nightwatch" });
  const materials = (model) => {
    const colors = [];
    model.mesh.traverse((node) => { if (node.isMesh) colors.push({
      materials: (Array.isArray(node.material) ? node.material : [node.material]).map((material) => material.color?.getHex() ?? null),
      vertices: Array.from(node.geometry.getAttribute("color")?.array || [])
    }); });
    return colors;
  };
  assert.deepEqual(materials(npc), materials(standard));
  assert.notDeepEqual(materials(custom), materials(standard));
  assert.equal(materials(custom).length, materials(standard).length);
  assert.deepEqual(materials(createTacticalEnemy(enemy, options)), materials(npc));
  assert.ok(custom.mesh instanceof THREE.Group);
});

test("purchased outfits change first-person sleeves and gloves, not the hand rig", () => {
  const metadata = JSON.parse(fs.readFileSync(new URL("../public/models/tactical-body.json", import.meta.url)));
  const bytes = fs.readFileSync(new URL("../public/models/tactical-body.bin", import.meta.url));
  const body = decodeTacticalBody(metadata, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const defaultHands = createWeaponHands(body, "foundry");
  const customHands = createWeaponHands(body, "foundry", "copperline");
  const colors = (hands) => {
    const result = [];
    hands.root.traverse((node) => { if (node.isMesh) result.push(Array.from(node.geometry.getAttribute("color")?.array || [])); });
    return result;
  };
  assert.notDeepEqual(colors(defaultHands), colors(customHands));
  assert.equal(colors(defaultHands).length, colors(customHands).length);
  assert.deepEqual(Object.keys(defaultHands), Object.keys(customHands));
});
