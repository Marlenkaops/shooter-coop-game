import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { HALLOWEEN_EVENT, eventContentAvailable } from "../shared/events.js";
import { MAPS, CAMPAIGN_MAPS, canAccessMap } from "../shared/progression.js";
import { WEAPONS } from "../shared/weapons.js";
import { getMapObstacles, PLAYER_WALK_SPEED, PLAYER_SPRINT_SPEED, PLAYER_MAX_MOVE_SPEED } from "../shared/gameplay.js";
import { addPlayer, createRoom } from "../server/game.js";
import { collectLoot, restockChests } from "../server/loot.js";
import { atmosphereProfile, createAtmosphere } from "../src/atmosphere.js";
import { disposeSceneResources } from "../src/scene-resources.js";

test("owner-ended Halloween content retains its archived definitions but its map and guns are unavailable", () => {
  const map = MAPS.find((map) => map.id === HALLOWEEN_EVENT.mapId);
  assert.equal(map.campaign, false);
  assert.equal(map.level, 1);
  assert.equal(canAccessMap(0, map.id), false);
  assert.equal(CAMPAIGN_MAPS.includes(map), false);
  const active = { ...HALLOWEEN_EVENT, active: true };
  assert.equal(HALLOWEEN_EVENT.active, false);
  for (const id of [map.id, ...HALLOWEEN_EVENT.weaponIds]) {
    assert.equal(eventContentAvailable(id, active), true);
    assert.equal(eventContentAvailable(id), false, "ownership does not bypass event closure");
  }
  for (const id of ["foundry", "rifle", "sniper"]) assert.equal(eventContentAvailable(id), true);
  for (const id of HALLOWEEN_EVENT.weaponIds) assert.equal(WEAPONS[id].event, HALLOWEEN_EVENT.id);
  assert.notDeepEqual(getMapObstacles(map.id), getMapObstacles("foundry"));
});

test("the retired arena cannot be opened and ordinary chests never restock its guns", () => {
  assert.throws(() => createRoom("WICK", HALLOWEEN_EVENT.mapId), /event has ended/);
  for (const map of MAPS.filter((map) => !map.event)) {
    const regular = createRoom("BASE", map.id);
    restockChests(regular, () => .999);
    assert.ok([...regular.loot.values()].every((loot) => !HALLOWEEN_EVENT.weaponIds.includes(loot.weaponId)));
  }
});

test("event arenas use the same tactical traversal limits as regular operations", () => {
  assert.equal(PLAYER_WALK_SPEED, 4.2);
  assert.equal(PLAYER_SPRINT_SPEED, 6.4);
  assert.ok(PLAYER_MAX_MOVE_SPEED > PLAYER_SPRINT_SPEED);
});

test("retired weapon drops cannot grant a gun or become ammunition even for an existing collector", () => {
  const room = createRoom("LOOT", "foundry");
  room.phase = "playing";
  restockChests(room, () => 0);
  const player = addPlayer(room, { id: "collector" }, "identity",
    { username: "Collector", ownedWeapons: ["rifle"], equippedWeaponId: "rifle" });
  player.reserve = 0;
  for (const [index, weaponId] of HALLOWEEN_EVENT.weaponIds.entries()) {
    const loot = [...room.loot.values()][index];
    loot.weaponId = weaponId;
    player.position = { ...loot.position, y: loot.position.y + 1.28 };
    for (const owned of [false, true]) {
      if (owned) player.profile.ownedWeapons.push(weaponId);
      const result = collectLoot(room, "collector", loot.id, () => { throw Error("Must not grant retired content"); });
      assert.equal(result.ok, false);
      assert.match(result.error, /event has ended/);
      assert.equal(player.weaponId, "rifle");
      assert.equal(player.reserve, 0);
      assert.equal(room.loot.has(loot.id), true);
    }
  }
});

test("fog preserves near-combat contrast with bounded mobile rendering and static reduced motion", () => {
  const profile = atmosphereProfile("wickfall", true);
  assert.equal(profile.wisps, 8);
  assert.ok(Math.exp(-((profile.density * 20) ** 2)) > .85);
  assert.ok(Math.exp(-((profile.density * 60) ** 2)) < .3);
  const scene = new THREE.Scene();
  const atmosphere = createAtmosphere(scene, "wickfall", { compact: true, reducedMotion: true });
  assert.equal(scene.fog.density, profile.density);
  const before = [...atmosphere.mist.instanceMatrix.array];
  atmosphere.update(30);
  assert.deepEqual([...atmosphere.mist.instanceMatrix.array], before);
  assert.equal(atmosphere.mist.count, 8);
  assert.ok([...atmosphere.mist.instanceMatrix.array].every(Number.isFinite));
  assert.equal(atmosphere.mist.material.depthWrite, false);
  for (const mesh of scene.children.filter((mesh) => mesh.userData.eventLandmark)) {
    assert.ok(new THREE.Box3().setFromObject(mesh, true).max.z < -42, "landmarks do not add untracked playable collision");
  }
  assert.throws(() => atmosphere.update(NaN), RangeError);
  disposeSceneResources(scene);
});

test("ending the event rejects saved, admin-granted, practice and forged combat access without deleting collections", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "last-light-event-ended-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const folder of ["shared", "server"]) {
    fs.mkdirSync(path.join(directory, folder));
    const source = new URL(`../${folder}/`, import.meta.url);
    for (const name of fs.readdirSync(source).filter((name) => name.endsWith(".js"))) {
      fs.copyFileSync(new URL(name, source), path.join(directory, folder, name));
    }
  }
  fs.writeFileSync(path.join(directory, "package.json"), '{"type":"module"}');
  const data = path.join(directory, "data");
  fs.mkdirSync(data);
  const saved = { id: "collector", username: "Collector", xp: 0,
    ownedWeapons: ["rifle", "jackolantern", "graveglass"], equippedWeaponId: "graveglass",
    adminUnlockedMaps: true, adminUnlockedWeapons: true };
  fs.writeFileSync(path.join(data, "players.json"), JSON.stringify({ collector: saved }));
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import fs from "node:fs";
    import { getProfile, equipWeapon, grantWeapon, adminSetProgression } from "./server/store.js";
    import { canAccessMap } from "./shared/progression.js";
    import { createRoom, addPlayer, practiceWeapon, shoot } from "./server/game.js";
    const profile = getProfile("collector");
    assert.equal(profile.equippedWeaponId, "rifle");
    for (const id of ["jackolantern", "graveglass"]) {
      assert.equal(profile.ownedWeapons.includes(id), false);
      assert.equal(equipWeapon("collector", id).ok, false);
      assert.equal(grantWeapon("collector", id, true).ok, false);
    }
    assert.equal(canAccessMap(99999, "wickfall", true), false);
    assert.equal(profile.unlockedMaps.includes("wickfall"), false);
    assert.equal(adminSetProgression("collector", "unlockAll").profile.ownedWeapons.includes("graveglass"), false);
    assert.throws(() => createRoom("END", "wickfall"), /event has ended/);
    const room = createRoom("SAFE", "range", "practice");
    const player = addPlayer(room, { id: "socket" }, "collector", ${JSON.stringify(saved)}, "Collector");
    assert.equal(player.weaponId, "rifle");
    room.phase = "playing";
    assert.equal(practiceWeapon(room, "socket", "graveglass").ok, false);
    player.weaponId = "graveglass";
    assert.equal(shoot(room, "socket", { direction: { x: 0, y: 0, z: -1 } }).ok, false);
    const raw = JSON.parse(fs.readFileSync(process.env.DATA_DIR + "/players.json", "utf8")).collector;
    assert.ok(raw.ownedWeapons.includes("graveglass"));
  `], { cwd: directory, env: { ...process.env, DATA_DIR: data, IDENTITY_SECRET: "" }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
