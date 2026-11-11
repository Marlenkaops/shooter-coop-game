import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addPlayer, advanceCampaignRoom, createRoom, publicState, reload, shoot, startMatch, tickRoom } from "../server/game.js";
import { leaderSocketId, lobbyChat, MAX_CHAT_MESSAGES, removeRoomPlayer, transferLeader } from "../server/lobby.js";
import { createReportStore } from "../server/reports.js";
import { canAccessMode, FFA_DURATION_MS, FFA_SCORE_LIMIT } from "../shared/modes.js";
import { MAPS } from "../shared/progression.js";
import { eventContentAvailable } from "../shared/events.js";
import { canOccupyPosition, canTraverse, canWalkTerrain, groundedPosition, getMapObstacles } from "../shared/gameplay.js";
import { createCommandGuard } from "../server/anti-cheat.js";

function fixture(mode = "ffa", mapId = "airfield") {
  const room = createRoom("ABCDEF", mapId, mode);
  const first = addPlayer(room, { id: "first" }, "identity-first",
    { xp: 2000, level: 5, ownedWeapons: ["rifle"], equippedWeaponId: "rifle" }, "First");
  const second = addPlayer(room, { id: "second" }, "identity-second",
    { xp: 2000, level: 5, ownedWeapons: ["rifle"], equippedWeaponId: "rifle" }, "Second");
  return { room, first, second };
}

test("Free-for-All requires actual XP level five, two operators, and valid mode IDs", () => {
  assert.equal(canAccessMode(1999, "ffa"), false);
  assert.equal(canAccessMode(2000, "ffa"), true);
  assert.equal(canAccessMode(99999, "__proto__"), false);
  assert.throws(() => createRoom("ROOM", "foundry", "missing"), RangeError);
  const { room, second } = fixture();
  second.profile = { ...second.profile, xp: 1999, level: 999 };
  assert.equal(startMatch(room), false);
  second.profile.xp = 2000;
  removeRoomPlayer(room, "first");
  assert.equal(startMatch(room), false);
});

test("all arenas have collision-safe, separated PvP spawns and fresh authoritative round limits", () => {
  for (const map of MAPS.filter((map) => eventContentAvailable(map.id))) {
    const { room, first, second } = fixture("ffa", map.id);
    assert.equal(startMatch(room, 10_000), true);
    assert.equal(room.enemies.size, 0);
    assert.equal(room.matchEndsAt, 10_000 + FFA_DURATION_MS);
    assert.ok(canOccupyPosition(map.id, first.position));
    assert.ok(canOccupyPosition(map.id, second.position));
    assert.ok(Math.hypot(first.position.x - second.position.x, first.position.z - second.position.z) > 20);
    assert.equal(publicState(room).scoreLimit, FFA_SCORE_LIMIT);
    assert.equal(publicState(room).mode, "ffa");
  }
});

test("PvP traces reject forged aim, shielded or dead victims and stop at shared cover", () => {
  const { room, first, second } = fixture();
  startMatch(room, 10_000);
  first.position = { x: 0, y: 1.7, z: 15 };
  second.position = { x: 0, y: 1.7, z: 10 };
  assert.equal(shoot(room, "first", { direction: { x: 1, y: 0, z: 0 } }, 10_010).reason, "Invalid aim");
  assert.equal(first.ammo, 24);
  assert.equal(shoot(room, "first", { direction: { x: 0, y: 0, z: -1 } }, 10_010).hit, false);
  assert.equal(first.protectedUntil, 0, "firing gives up the shooter's shield");
  second.deadUntil = 20_000;
  assert.equal(shoot(room, "first", { direction: { x: 0, y: 0, z: -1 } }, 12_000).hit, false);
  second.deadUntil = 0;
  first.position = { x: -11, y: 1.7, z: 7 };
  second.position = { x: -11, y: 1.7, z: -7 };
  assert.equal(shoot(room, "first", { direction: { x: 0, y: 0, z: -1 } }, 13_000).impact, "cover");
  assert.equal(second.health, 100);
});

test("PvP kills count once, cancel victim reload, drop loot, respawn safely and finish at score limit once", () => {
  const { room, first, second } = fixture();
  startMatch(room, 10_000);
  first.position = { x: 0, y: 1.7, z: 15 };
  second.position = { x: 0, y: 1.7, z: 10 };
  second.health = 1;
  second.ammo = 0;
  assert.equal(reload(room, "second", 12_000), true);
  first.kills = FFA_SCORE_LIMIT - 1;
  const shot = shoot(room, "first", { direction: { x: 0, y: 0, z: -1 } }, 12_010);
  assert.equal(shot.killed, true);
  assert.equal(shot.hits[0].playerId, "second");
  assert.equal(first.kills, FFA_SCORE_LIMIT);
  assert.equal(second.deaths, 1);
  assert.equal(second.reloadingUntil, 0);
  assert.equal(room.loot.size, 5);
  const result = tickRoom(room, 0, 12_020);
  assert.equal(result.winnerId, "first");
  assert.equal(result.mode, "ffa");
  assert.equal(tickRoom(room, 0, 12_030), null);
  assert.equal(shoot(room, "first", { direction: { x: 0, y: 0, z: -1 } }, 13_000).ok, false);
  assert.equal(advanceCampaignRoom(room, [first.profile, second.profile]).ok, false);

  startMatch(room, 20_000);
  second.deadUntil = 24_000;
  second.reserve = 0;
  tickRoom(room, 0, 24_001);
  assert.equal(second.deadUntil, 0);
  assert.equal(second.health, 100);
  assert.ok(second.reserve > 0);
  assert.ok(second.protectedUntil > 24_001);
  assert.ok(canOccupyPosition(room.mapId, second.position));
});

test("PvP timer uses kills then deaths; ties draw and abandoned rounds award no farming rewards", () => {
  const { room, first, second } = fixture();
  startMatch(room, 10_000);
  first.kills = second.kills = 3;
  first.deaths = 2; second.deaths = 1;
  assert.equal(tickRoom(room, 0, room.matchEndsAt).winnerId, "second");
  startMatch(room, 300_000);
  assert.equal(tickRoom(room, 0, room.matchEndsAt).winnerId, null);
  startMatch(room, 600_000);
  first.kills = 5;
  removeRoomPlayer(room, "second");
  const result = tickRoom(room, 0, 601_000);
  assert.equal(result.abandoned, true);
  assert.equal(result.rewards[0].xp, 0);
  assert.equal(result.rewards[0].tokens, 0);
});

test("PvP shotgun pellets can hit two operators but award each death and drop only once", () => {
  const { room, first, second } = fixture();
  const third = addPlayer(room, { id: "third" }, "identity-third", { ...second.profile }, "Third");
  first.weaponId = "shotgun";
  startMatch(room, 10_000);
  first.position = { x: 0, y: 1.7, z: 15 };
  second.position = { x: -.48, y: 1.7, z: 10 };
  third.position = { x: .48, y: 1.7, z: 10 };
  second.health = third.health = 1;
  const shot = shoot(room, "first", { direction: { x: 0, y: -.1, z: -1 } }, 12_000);
  assert.equal(shot.rays.length, 8);
  assert.equal(shot.kills, 2);
  assert.equal(first.kills, 2);
  assert.equal(second.deaths, 1);
  assert.equal(third.deaths, 1);
  assert.equal(room.loot.size, 6);
});

test("Co-op Blitz ends at three waves without campaign advancement and keeps friendly fire disabled", () => {
  const { room, first, second } = fixture("blitz");
  startMatch(room);
  first.position = { x: 0, y: 1.7, z: 15 }; second.position = { x: 0, y: 1.7, z: 10 };
  room.enemies.clear();
  assert.equal(shoot(room, "first", { direction: { x: 0, y: 0, z: -1 } }).hit, false);
  assert.equal(second.health, 100);
  for (let wave = 1; wave < 3; wave++) {
    room.enemies.clear();
    tickRoom(room, 0);
    tickRoom(room, 0, room.countdown);
  }
  room.enemies.clear();
  const result = tickRoom(room, 0);
  assert.equal(result.won, true);
  assert.equal(result.maxWaves, 3);
  assert.equal(advanceCampaignRoom(room, [first.profile, second.profile]).ok, false);
});

test("Practice range lets a lone operator shoot resetting targets without ending a rewarded match", () => {
  const room = createRoom("PRACTICE", "range", "practice");
  const first = addPlayer(room, { id: "first" }, "identity-first",
    { xp: 2000, level: 5, ownedWeapons: ["rifle"], equippedWeaponId: "rifle" }, "First");
  assert.equal(startMatch(room, 10_000), true);
  assert.equal(room.phase, "playing");
  assert.equal(room.enemies.size, 12);
  const target = [...room.enemies.values()][0];
  first.position = { x: target.position.x, y: 1.7, z: 14 };
  first.pitch = Math.atan2(-.5, 10);
  target.health = 1;
  const shot = shoot(room, "first", { direction: { x: 0, y: Math.sin(first.pitch), z: -Math.cos(first.pitch) } }, 10_001);
  assert.equal(shot.killed, true);
  assert.equal(tickRoom(room, 0, 10_002), null);
  assert.equal(target.health, 0);
  assert.equal(first.kills, 0);
  assert.equal(first.practiceStats.targets, 1);
  assert.equal(room.pendingNpcTokens.size, 0);
  assert.equal(tickRoom(room, 0, 11_201), null);
  assert.equal(target.health, target.maxHealth);
  assert.equal(room.phase, "playing");
});

test("leadership transfers without relying on insertion order and succeeds safely on disconnect", () => {
  const { room, first, second } = fixture("campaign");
  assert.equal(leaderSocketId(room), "first");
  assert.equal(transferLeader(room, "second", "first").ok, false);
  assert.equal(transferLeader(room, "first", "second").ok, true);
  assert.equal([...room.players.keys()][0], "first");
  assert.equal(publicState(room).leaderSocketId, "second");
  assert.equal(room.leaderId, second.identity);
  removeRoomPlayer(room, "second");
  assert.equal(room.leaderId, first.identity);
  assert.equal(leaderSocketId(room), "first");
  startMatch(room);
  assert.equal(transferLeader(room, "first", "second").ok, false);
});

test("bounded lobby chat uses verified names, identity cooldowns and rejects control characters or live-match chat", () => {
  const { room } = fixture("campaign");
  assert.equal(lobbyChat(room, "missing", "Hello").ok, false);
  assert.equal(lobbyChat(room, "first", " ").ok, false);
  assert.equal(lobbyChat(room, "first", "bad\nmessage").ok, false);
  assert.equal(lobbyChat(room, "first", "<img src=x> hello", 10_000).message.name, "First");
  assert.equal(lobbyChat(room, "first", "Again", 10_001).ok, false);
  for (let index = 1; index < 80; index++) lobbyChat(room, "first", `Message ${index}`, 10_000 + index * 1500);
  assert.equal(room.chat.length, MAX_CHAT_MESSAGES);
  assert.equal(publicState(room).chat.at(-1).text, "Message 79");
  startMatch(room);
  assert.equal(lobbyChat(room, "first", "Live chat").ok, false);
});

test("typed reports persist privately, enforce peer/identity limits, and support manual review", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "last-light-reports-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let time = 10_000;
  const store = createReportStore(directory, { now: () => time }), { room } = fixture();
  assert.equal(store.submit(room, "first", "first", "Self report reason").ok, false);
  assert.equal(store.submit(room, "first", "unknown", "Unknown player reason").ok, false);
  assert.equal(store.submit(room, "first", "second", "short").ok, false);
  const saved = store.submit(room, "first", "second", "<script> claimed cheating </script>");
  assert.equal(saved.ok, true);
  assert.deepEqual(Object.keys(saved).sort(), ["id", "ok"]);
  assert.equal(store.submit(room, "first", "second", "Repeated cheating").ok, false);
  time += 31_000;
  assert.equal(store.submit(room, "first", "second", "Another incident").ok, true);
  time += 31_000;
  assert.equal(store.submit(room, "first", "second", "Third incident").ok, true);
  time += 31_000;
  assert.equal(store.submit(room, "first", "second", "Fourth incident").ok, false);
  assert.equal(store.review(saved.id, "reviewed", "staff").ok, true);
  assert.equal(store.list({ status: "reviewed" }).reports[0].reviewedBy, "staff");
  const restored = createReportStore(directory);
  assert.equal(restored.list().total, 2);
  assert.equal(restored.list({ status: "reviewed" }).total, 1);
  assert.equal(fs.statSync(path.join(directory, "reports.json")).mode & 0o777, 0o600);
  assert.equal(room.players.get("second").health, 100, "reports do not automatically punish");
  const guard = createCommandGuard();
  assert.equal(guard.check(["adminReports", {}], false).ok, false);
  assert.equal(guard.check(["reportPlayer", { playerId: "second", reason: "Invalid", targetId: "spoof" }], false).ok, false);
});

test("report storage failures do not acknowledge or retain unsaved reports; corruption fails visibly", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "last-light-report-failure-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createReportStore(directory), { room } = fixture();
  fs.mkdirSync(path.join(directory, "reports.json.next"));
  assert.throws(() => store.submit(room, "first", "second", "Disk storage failed"));
  assert.equal(store.list().total, 0);
  fs.writeFileSync(path.join(directory, "reports.json"), "{bad");
  assert.throws(() => createReportStore(directory), SyntaxError);
});

test("new authored arenas have unique cover and navigable routes to every chest and supply", () => {
  for (const mapId of ["spillway", "depot"]) {
    const { room } = fixture("campaign", mapId);
    startMatch(room);
    const visited = new Set(["-3,10"]), queue = [{ x: -3, y: 1.7, z: 10 }];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const from = queue[cursor];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const next = groundedPosition(mapId, { x: from.x + dx, z: from.z + dz }), key = `${next.x},${next.z}`;
        if (!visited.has(key) && canWalkTerrain(mapId, from, next)) { visited.add(key); queue.push(next); }
      }
    }
    for (const item of [...room.loot.values(), ...room.supplies.values()]) {
      assert.ok(queue.some((position) => Math.hypot(position.x - item.position.x, position.z - item.position.z) < 2 &&
        canWalkTerrain(mapId, position, groundedPosition(mapId, item.position))), `${mapId}: ${item.id}`);
    }
  }
  assert.notDeepEqual(getMapObstacles("spillway"), getMapObstacles("depot"));
});
