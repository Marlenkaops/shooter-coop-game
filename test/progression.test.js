import test from "node:test";
import assert from "node:assert/strict";
import {
  addXp, CAMPAIGN_MAPS, campaignOperationNumber, campaignProgress, canAccessMap, completeOperation, levelForXp, MAPS,
  newlyUnlockedMaps, unlockedMaps, xpProgress
} from "../shared/progression.js";
import { eventContentAvailable } from "../shared/events.js";

test("campaign result numbers exclude seasonal and side-operation map slots", () => {
  assert.equal(campaignOperationNumber("foundry"), 1);
  assert.equal(campaignOperationNumber("tundra"), 2);
  assert.equal(campaignOperationNumber("void"), 3);
  for (const id of ["wickfall", "harbor", "unknown", undefined]) {
    assert.throws(() => campaignOperationNumber(id), RangeError);
  }
});

test("levels advance every 500 XP and reject invalid XP", () => {
  assert.equal(levelForXp(0), 1);
  assert.equal(levelForXp(499), 1);
  assert.equal(levelForXp(500), 2);
  assert.equal(levelForXp(2000), 5);
  assert.equal(levelForXp(-10), 1);
});

test("campaign victory is credited in order, independently of XP map access", () => {
  assert.deepEqual(campaignProgress(["foundry", "void"]), ["foundry"]);
  assert.deepEqual(completeOperation([], "tundra", true), []);
  assert.deepEqual(completeOperation([], "foundry", false), []);
  assert.deepEqual(completeOperation([], "foundry", true), ["foundry"]);
  assert.deepEqual(completeOperation(["foundry"], "foundry", true), ["foundry"]);
  assert.deepEqual(completeOperation(["foundry"], "tundra", true), ["foundry", "tundra"]);
  assert.deepEqual(completeOperation(["foundry", "tundra"], "void", true),
    ["foundry", "tundra", "void"]);
  assert.equal(canAccessMap(2000, "void"), true);
});

test("campaign clearance and side-operation access have independent progression", () => {
  assert.deepEqual(unlockedMaps(0), ["foundry", "harbor"]);
  assert.deepEqual(unlockedMaps(500), ["foundry", "harbor", "outpost", "spillway"]);
  assert.deepEqual(unlockedMaps(1000), ["foundry", "tundra", "harbor", "outpost", "airfield", "spillway"]);
  assert.deepEqual(unlockedMaps(2000), MAPS.filter((map) => eventContentAvailable(map.id)).map((map) => map.id));
  assert.deepEqual(CAMPAIGN_MAPS.map((map) => map.id), ["foundry", "tundra", "void"]);
  assert.deepEqual(completeOperation([], "harbor", true), []);
  assert.deepEqual(completeOperation(["foundry", "tundra", "void"], "outpost", true),
    ["foundry", "tundra", "void"]);
  assert.equal(canAccessMap(499, "outpost"), false);
  assert.equal(canAccessMap(500, "outpost"), true);
  assert.equal(canAccessMap(999, "tundra"), false);
  assert.equal(canAccessMap(1000, "tundra"), true);
  assert.equal(canAccessMap(99999, "missing"), false);
});

test("XP rewards cannot reduce progression", () => {
  const profile = addXp({ id: "a", xp: 480 }, 40);
  assert.equal(profile.xp, 520);
  assert.equal(profile.level, 2);
  assert.deepEqual(profile.unlockedMaps, ["foundry", "harbor", "outpost", "spillway"]);
  assert.equal(addXp(profile, -500).xp, 520);
});

test("after-action progression details are deterministic at level boundaries", () => {
  assert.deepEqual(xpProgress(1240), {
    current: 240, required: 500, remaining: 260, percent: 48
  });
  assert.deepEqual(newlyUnlockedMaps(980, 1010), ["tundra", "airfield"]);
  assert.deepEqual(newlyUnlockedMaps(1499, 1500), ["citadel"]);
  assert.deepEqual(newlyUnlockedMaps(1990, 2000), ["void", "depot"]);
  assert.deepEqual(newlyUnlockedMaps(2000, 2500), []);
  assert.deepEqual(xpProgress(Infinity), {
    current: 0, required: 500, remaining: 500, percent: 0
  });
});
