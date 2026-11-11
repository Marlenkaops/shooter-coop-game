import test from "node:test";
import assert from "node:assert/strict";
import { AI_DIFFICULTIES, ENEMY_CALLOUTS, ENEMY_ROLES } from "../shared/enemy-ai.js";
import { MAPS } from "../shared/progression.js";
import { eventContentAvailable } from "../shared/events.js";
import { canOccupyPosition, canWalkTerrain, ENEMY_RADIUS, getMapObstacles, groundedPosition, hasLineOfSight } from "../shared/gameplay.js";
import { addPlayer, createRoom, publicState, startMatch, tickRoom } from "../server/game.js";
import { canStartEnemyAttack, createEnemyDirector, updateEnemyDirector } from "../server/enemy-director.js";
import { chooseEnemyCover, enemyCallout, squadFlankGoal, updateEnemyIntel } from "../server/enemy-tactics.js";
import { createCommandGuard } from "../server/anti-cheat.js";
import { audibleEnemyCallout } from "../src/enemy-comms.js";

function fixture(difficulty = "standard", mapId = "airfield") {
  const room = createRoom("TACTIC", mapId, "campaign", difficulty);
  const player = addPlayer(room, { id: "one" }, "private-identity",
    difficulty === "nightmare" ? { level: 10, xp: 4500 } : { level: 1 }, "Tester");
  room.phase = "playing";
  room.director = createEnemyDirector(10000);
  player.protectedUntil = 0;
  player.position = groundedPosition(mapId, { x: -3, z: 20 }, 1.7);
  return { room, player };
}

function hostile(role, id = "1", z = 25) {
  return { id, role, squadId: "squad", type: role === "rusher" ? "skirmisher" :
    role === "sniper" ? "sentinel" : role === "heavy" ? "brute" : "drone",
  position: { x: -3, y: 1, z }, health: 100, maxHealth: 100, speed: 3, damage: 10,
  lastAttack: 0, velocity: { x: 0, z: 0 } };
}

test("authored waves combine five explicit squad roles without changing difficulty health, speed or damage", () => {
  const tiers = [];
  for (const difficulty of Object.keys(AI_DIFFICULTIES)) {
    const { room } = fixture(difficulty);
    room.phase = "lobby";
    startMatch(room, 10000);
    const allRoles = new Set();
    const snapshots = [];
    for (let wave = 1; wave <= 3; wave++) {
      for (const enemy of room.enemies.values()) {
        allRoles.add(enemy.role);
        assert.ok(Object.hasOwn(ENEMY_ROLES, enemy.role));
        assert.ok(enemy.squadId.startsWith(`${wave}-`));
        if (enemy.role === "rusher") assert.ok([...room.enemies.values()].some((ally) =>
          ally.squadId === enemy.squadId && ["support", "heavy", "sniper"].includes(ally.role)),
        "each rusher's own squad must contain covering fire");
      }
      snapshots.push([...room.enemies.values()].map(({ role, health, damage, speed }) => ({ role, health, damage, speed })));
      room.enemies.clear();
      tickRoom(room, 0, 10000 + wave * 10000);
      if (wave < 3) tickRoom(room, 0, room.countdown);
    }
    assert.deepEqual([...allRoles].sort(), Object.keys(ENEMY_ROLES).sort());
    tiers.push(snapshots);
  }
  for (const tier of tiers.slice(1)) assert.deepEqual(tiers[0], tier);
});

test("director deterministically builds, peaks, takes a bounded break and resumes for every tier", () => {
  for (const difficulty of Object.keys(AI_DIFFICULTIES)) {
    const { room, player } = fixture(difficulty);
    const tuning = AI_DIFFICULTIES[difficulty];
    assert.equal(updateEnemyDirector(room, [player], 10000).attackLimit, tuning.buildAttackers);
    assert.equal(updateEnemyDirector(room, [player], 18999).phase, "buildup");
    assert.equal(updateEnemyDirector(room, [player], 19000).attackLimit, tuning.peakAttackers);
    assert.equal(updateEnemyDirector(room, [player], 32999).phase, "peak");
    const recovery = updateEnemyDirector(room, [player], 33000);
    assert.equal(recovery.phase, "recovery");
    assert.equal(recovery.attackLimit, 0);
    assert.equal(updateEnemyDirector(room, [player], 33000 + tuning.recoveryMs - 1).phase, "recovery");
    assert.equal(updateEnemyDirector(room, [player], 33000 + tuning.recoveryMs).phase, "buildup");
    assert.ok(room.director.until > 33000 + tuning.recoveryMs);
  }
});

test("director cuts a sustained peak short for a struggling squad without permanently stopping combat", () => {
  const { room, player } = fixture();
  updateEnemyDirector(room, [player], 19000);
  player.health = 20;
  assert.equal(updateEnemyDirector(room, [player], 21999).phase, "peak");
  assert.equal(updateEnemyDirector(room, [player], 22000).phase, "recovery");
  assert.equal(updateEnemyDirector(room, [player], 26000).phase, "buildup");
});

test("attack budgets enforce both room and per-player pressure without blocking another free target", () => {
  const enemies = [hostile("support"), hostile("rifleman", "2"), hostile("rifleman", "3")];
  enemies[0].attackWindup = { targetId: "one" };
  enemies[1].attackWindup = { targetId: "one" };
  const budget = { attackLimit: 4, perTargetLimit: 2 };
  assert.equal(canStartEnemyAttack(enemies[2], enemies, "one", budget), false);
  assert.equal(canStartEnemyAttack(enemies[2], enemies, "two", budget), true);
  assert.equal(canStartEnemyAttack(enemies[2], enemies, "two", { ...budget, attackLimit: 2 }), false);
  assert.equal(canStartEnemyAttack(enemies[2], enemies, "two", { ...budget, attackLimit: 0 }), false);
});

test("every role announces its actual windup before one server-resolved attack", () => {
  for (const [role, rules] of Object.entries(ENEMY_ROLES)) {
    const { room, player } = fixture();
    const enemy = hostile(role, "1", role === "rusher" ? 21.5 : 25);
    room.enemies.set(enemy.id, enemy);
    tickRoom(room, .05, 10000);
    assert.equal(player.health, 100, role);
    assert.equal(publicState(room, 10000).enemies[0].threat.remainingMs, rules.windupMs, role);
    assert.equal(enemy.intent, ["support", "heavy"].includes(role) ? "suppress" : "aim", role);
    tickRoom(room, .05, 10000 + rules.windupMs);
    assert.equal(player.health, 90, role);
    assert.equal(room.attackEvents.length, 1, role);
    tickRoom(room, .05, 10001 + rules.windupMs);
    assert.equal(player.health, 90, `${role}: cooldown prevents duplicate damage`);
  }
});

test("director recovery stops new attacks, lets telegraphed attacks finish, then resumes", () => {
  const { room, player } = fixture();
  const enemy = hostile("support");
  room.enemies.set(enemy.id, enemy);
  room.director = { ...createEnemyDirector(0), phase: "peak", phaseAt: 0, until: 10001 };
  tickRoom(room, .05, 10000);
  assert.ok(enemy.attackWindup);
  tickRoom(room, .05, 10700);
  assert.equal(room.director.phase, "recovery");
  assert.equal(player.health, 90);
  for (let at = 10750; at < 14700; at += 50) tickRoom(room, .05, at);
  assert.equal(player.health, 90);
  assert.equal(enemy.attackWindup, null);
  tickRoom(room, .05, 14700);
  assert.equal(room.director.phase, "buildup");
  assert.ok(enemy.attackWindup);
});

test("ranged roles recheck actual victim line of sight, protection, life and range at resolution", () => {
  for (const role of ["rifleman", "support", "sniper", "heavy"]) for (const reason of ["cover", "shield", "dead", "range", "disconnected"]) {
    const { room, player } = fixture();
    const enemy = hostile(role);
    room.enemies.set(enemy.id, enemy);
    tickRoom(room, .05, 10000);
    assert.ok(enemy.attackWindup, `${role}: attack starts`);
    if (reason === "cover") {
      const cover = getMapObstacles(room.mapId).find((item) => item.kind === "generator" && item.rotation === 0);
      assert.ok(cover);
      player.position = groundedPosition(room.mapId, { x: cover.x + cover.width / 2 + 1, z: cover.z }, 1.7);
      enemy.position = groundedPosition(room.mapId, { x: cover.x - cover.width / 2 - 1, z: cover.z }, 1);
      assert.equal(hasLineOfSight(room.mapId, { ...enemy.position, y: enemy.position.y + .25 },
        { ...player.position, y: player.position.y - .45 }), false);
    } else if (reason === "shield") player.protectedUntil = 20000;
    else if (reason === "dead") player.deadUntil = 20000;
    else if (reason === "range") player.position = { x: -3, y: 1.7, z: 39 };
    else player.connected = false;
    tickRoom(room, .05, 10000 + ENEMY_ROLES[role].windupMs);
    assert.equal(player.health, 100, `${role}: ${reason}`);
    assert.equal(room.attackEvents.length, 0, `${role}: ${reason}`);
  }
});

test("healthy riflemen move into actual occluding cover after firing and resume instead of camping", () => {
  for (const difficulty of ["standard", "veteran"]) {
    const { room, player } = fixture(difficulty, "foundry");
    player.position = { x: -6, y: 1.7, z: -4 };
    const enemy = hostile("rifleman");
    enemy.position = { x: -6, y: 1, z: 3 };
    enemy.lastAttack = 9500;
    room.enemies.set(enemy.id, enemy);
    room.enemyContacts.set(player.socketId, { socketId: player.socketId, position: { ...player.position }, at: 9900 });
    tickRoom(room, .05, 10000);
    assert.equal(enemy.intent, "cover");
    const goal = { ...enemy.coverGoal };
    assert.equal(hasLineOfSight(room.mapId, { ...goal, y: goal.y + .25 }, { ...player.position, y: player.position.y - .45 }), false);
    assert.equal(canOccupyPosition(room.mapId, goal, ENEMY_RADIUS), true);
    for (let at = 10050; at <= 11500; at += 50) {
      const previous = { ...enemy.position };
      tickRoom(room, .05, at);
      assert.equal(canWalkTerrain(room.mapId, previous, enemy.position, ENEMY_RADIUS), true);
    }
    assert.notEqual(enemy.intent, "cover");
    assert.equal(enemy.coverGoal, null);
    assert.equal(enemy.coverCooldown, 16500);
  }
});

test("wounded roles retreat to reserved cover for a bounded time without healing themselves", () => {
  for (const role of Object.keys(ENEMY_ROLES)) {
    const { room, player } = fixture("standard", "foundry");
    player.position = { x: -6, y: 1.7, z: -4 };
    const enemy = hostile(role);
    enemy.position = { x: -6, y: 1, z: 3 };
    enemy.health = role === "heavy" ? 20 : 30;
    room.enemies.set(enemy.id, enemy);
    room.enemyContacts.set(player.socketId, { socketId: player.socketId, position: { ...player.position }, at: 9900 });
    tickRoom(room, .05, 10000);
    assert.equal(enemy.intent, "recover");
    assert.ok(enemy.coverGoal);
    assert.equal(room.callouts[0].kind, "recover", "urgent retreats take priority over contact chatter");
    const alternative = chooseEnemyCover(room.mapId, { ...enemy, id: "2", coverGoal: null }, player.position, [enemy]);
    if (alternative) assert.ok(Math.hypot(alternative.x - enemy.coverGoal.x, alternative.z - enemy.coverGoal.z) >= 1.6);
    tickRoom(room, .05, 11601);
    assert.notEqual(enemy.intent, "recover");
    assert.equal(enemy.health, role === "heavy" ? 20 : 30);
  }
});

test("same-squad covering fire enables bounded flanks and veteran riflemen gain a different tactic", () => {
  for (const difficulty of Object.keys(AI_DIFFICULTIES)) for (const role of ["rusher", "rifleman"]) {
    const { room, player } = fixture(difficulty);
    const enemy = hostile(role);
    const support = hostile("support", "2", 26);
    support.attackWindup = { targetId: player.socketId };
    const goal = squadFlankGoal(room, enemy, player, [enemy, support], 10000);
    const expected = role === "rusher" || AI_DIFFICULTIES[difficulty].flankRiflemen;
    assert.equal(Boolean(goal), expected);
    if (expected) {
      assert.notEqual(goal.x, player.position.x);
      assert.equal(canOccupyPosition(room.mapId, goal, ENEMY_RADIUS), true);
      assert.equal(squadFlankGoal(room, enemy, player, [enemy, support], 11000), goal);
      assert.equal(squadFlankGoal(room, enemy, player, [enemy, support], 11801), null, "must stop circling and close in");
    }
    enemy.squadFlankCooldown = 0;
    enemy.squadFlankUntil = 0;
    support.squadId = "other-squad";
    assert.equal(squadFlankGoal(room, enemy, player, [enemy, support], 20000), null);
  }
});

test("authoritative rusher actually flanks under supporting fire using collision-safe steps", () => {
  const { room, player } = fixture();
  const rusher = hostile("rusher", "1", 27), support = hostile("support", "2", 25);
  support.position.x = -1;
  support.attackWindup = { targetId: player.socketId, endsAt: 10700 };
  room.enemies.set(rusher.id, rusher);
  room.enemies.set(support.id, support);
  const before = { ...rusher.position };
  tickRoom(room, .05, 10000);
  assert.equal(rusher.intent, "flank");
  assert.notEqual(rusher.position.x, before.x);
  assert.equal(canWalkTerrain(room.mapId, before, rusher.position, ENEMY_RADIUS), true);
  assert.equal(support.intent, "suppress");
  assert.equal(player.health, 100);
});

test("sound investigation remembers only the audible origin and tiers bound that memory", () => {
  for (const difficulty of Object.keys(AI_DIFFICULTIES)) {
    const { room, player } = fixture(difficulty, "foundry");
    const enemy = hostile("rifleman");
    enemy.position = { x: -6, y: 1, z: -2 };
    player.position = { x: -6, y: 1.7, z: 16 };
    player.lastShot = 10000;
    player.lastShotPosition = { ...player.position };
    room.enemies.set(enemy.id, enemy);
    const contact = updateEnemyIntel(room, [player], 10000)[0];
    assert.equal(contact.source, "sound");
    player.position = { ...player.position, z: 20 };
    tickRoom(room, .05, 10100);
    assert.equal(enemy.intent, "investigate");
    assert.deepEqual(room.enemyContacts.get(player.socketId).position, player.lastShotPosition);
    assert.deepEqual(updateEnemyIntel(room, [player], 10001 + AI_DIFFICULTIES[difficulty].memoryMs), []);
  }
});

test("callouts are server-enumerated, globally throttled, bounded and do not leak tactical or identity fields", () => {
  const { room } = fixture();
  const enemy = hostile("support");
  enemy.coverGoal = { x: 1, y: 1, z: 1 };
  enemy.squadFlankGoal = { x: 3, y: 1, z: 3 };
  room.enemies.set(enemy.id, enemy);
  enemyCallout(room, enemy, "suppress", 10000);
  enemyCallout(room, hostile("rusher", "2"), "flank", 10001);
  enemyCallout(room, enemy, "recover", 11000);
  assert.equal(room.callouts.length, 1);
  assert.equal(room.callouts[0].kind, "suppress");
  for (let index = 1; index < 8; index++) enemyCallout(room, enemy, "suppress", 10000 + index * 10000);
  assert.equal(room.callouts.length, 4);
  const snapshot = publicState(room, 80000);
  const serialized = JSON.stringify(snapshot);
  for (const key of ["private-identity", "coverGoal", "squadFlankGoal", "nextCalloutAt", "calloutKind",
    "repeatCalloutAt", "health\":null", "attackLimit", "enemyContacts"]) assert.equal(serialized.includes(key), false, key);
  assert.deepEqual(snapshot.director, { phase: "buildup" });
  assert.equal(snapshot.enemies[0].role, "support");
  assert.ok(snapshot.callouts.every((item) => Object.hasOwn(ENEMY_CALLOUTS, item.kind)));
  assert.equal(publicState(room, 90000).callouts.length, 0);
});

test("desktop and phone captions use only live nearby server callouts and canonical labels", () => {
  const position = { x: 0, y: 1.7, z: 20 };
  const callout = { id: 1, role: "support", kind: "suppress", position, at: 10000, expiresAt: 13200 };
  assert.deepEqual(audibleEnemyCallout([callout], position, 11000), {
    id: 1, speaker: "Support", text: ENEMY_CALLOUTS.suppress
  });
  assert.equal(audibleEnemyCallout([callout], { ...position, z: 47 }, 11000), null);
  assert.equal(audibleEnemyCallout([callout], position, 13200), null);
  assert.equal(audibleEnemyCallout([{ ...callout, kind: "<script>" }], position, 11000), null);
  assert.equal(audibleEnemyCallout([{ ...callout, role: "__proto__" }], position, 11000), null);
  assert.equal(audibleEnemyCallout([callout], position, 9999), null);
});

test("tactical difficulty input cannot forge tactics, stats or use co-op tiers in PvP or practice", () => {
  for (const difficulty of Object.keys(AI_DIFFICULTIES)) {
    assert.equal(createCommandGuard().check(["createRoom", { mapId: "foundry", difficulty }], false).ok, true);
    assert.equal(createCommandGuard().check(["quickMatch", { mapId: "foundry", difficulty }], false).ok, true);
  }
  for (const payload of [{ difficulty: "__proto__" }, { difficulty: {} }, { difficulty: "impossible" },
    { difficulty: "veteran", damage: 1 }, { difficulty: "veteran", director: { phase: "recovery" } },
    { mode: "ffa", difficulty: "veteran" }, { mapId: "range", mode: "practice", difficulty: "recruit" }]) {
    assert.equal(createCommandGuard().check(["createRoom", { mapId: "foundry", ...payload }], false).reason, "invalid_payload");
  }
  assert.throws(() => createRoom("BAD", "foundry", "campaign", "impossible"), /difficulty/);
  assert.throws(() => createRoom("BAD", "foundry", "ffa", "veteran"), /difficulty/);
  assert.throws(() => createRoom("BAD", "range", "practice", "recruit"), /difficulty/);
  const guard = createCommandGuard({ now: () => 10000 });
  assert.ok(Array.from({ length: 30 }, () => guard.check(["quickMatch", { mapId: "foundry", difficulty: "veteran" }], false))
    .some((result) => result.reason === "command_rate"));
});

test("replay resets director, contacts and callouts but preserves the selected tactical tier", () => {
  const { room, player } = fixture("veteran");
  room.phase = "ended";
  room.director.phase = "recovery";
  room.callouts.push({ id: 1, expiresAt: 99999 });
  room.enemyContacts.set(player.socketId, { socketId: player.socketId, position: player.position, at: 10000 });
  assert.equal(startMatch(room, 50000), true);
  assert.equal(room.difficulty, "veteran");
  assert.equal(room.director.phase, "buildup");
  assert.equal(room.director.until, 59000);
  assert.deepEqual(room.callouts, []);
  assert.equal(room.enemyContacts.size, 0);
});

test("every arena preserves collision-safe squad roles and server-visible attacks over a deterministic encounter", () => {
  for (const map of MAPS.filter((map) => eventContentAvailable(map.id))) {
    const { room, player } = fixture("veteran", map.id);
    room.phase = "lobby";
    startMatch(room, 10000);
    player.protectedUntil = 0;
    const run = () => {
      const trace = [];
      for (let at = 10000; at < 13000; at += 50) {
        const previous = new Map([...room.enemies.values()].map((enemy) => [enemy.id, { ...enemy.position }]));
        tickRoom(room, .05, at);
        for (const enemy of room.enemies.values()) {
          assert.equal(canOccupyPosition(room.mapId, enemy.position, ENEMY_RADIUS), true, `${map.id}: ${enemy.id}`);
          assert.equal(canWalkTerrain(room.mapId, previous.get(enemy.id), enemy.position, ENEMY_RADIUS), true, map.id);
        }
        for (const attack of room.attackEvents) assert.equal(hasLineOfSight(room.mapId, attack.origin,
          { ...attack.target, y: attack.target.y - .45 }), true, map.id);
        trace.push(publicState(room, at));
      }
      return trace;
    };
    const initial = structuredClone(room), first = run();
    Object.assign(room, initial);
    assert.deepEqual(run(), first, `${map.id}: repeated input gives identical output`);
  }
});
