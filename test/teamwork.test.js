import test from "node:test";
import assert from "node:assert/strict";
import { addPlayer, createRoom, publicState, reload, shoot, startMatch, tickRoom, updatePlayer, useAmmoSupply } from "../server/game.js";
import { activateClassAbility, awardAssists, awardTeamwork, createTeamObjective, damageContributors,
  damageOperator, pingTeam, requestTeamInteraction, tickTeamObjective, tickTeamwork } from "../server/teamwork.js";
import { canOccupyPosition, getMapObstacles, groundedPosition, hasLineOfSight, playerStance } from "../shared/gameplay.js";
import { MAPS } from "../shared/progression.js";
import { eventContentAvailable } from "../shared/events.js";
import { BLEEDOUT_MS, DOWNED_SPEED, TEAM_XP_CAP, validTeamMetadata } from "../shared/teamwork.js";
import { movementSpeed, movementVelocity } from "../shared/movement.js";
import { normalizeBindings, DEFAULT_BINDINGS } from "../src/ui-preferences.js";
import { markerPlacement, teamInteractionTarget, teamPingPayload } from "../src/team-ui.js";
import { TouchInput } from "../src/touch-controls.js";
import { createCommandGuard } from "../server/anti-cheat.js";
import { validReward } from "../server/reward-records.js";

function fixture(count = 2, mode = "operation", mapId = "airfield") {
  const room = createRoom("COOP05", mapId, mode);
  const players = Array.from({ length: count }, (_, index) =>
    addPlayer(room, { id: `player-${index}` }, `private-${index}`,
      { xp: 10000, level: 10, ownedWeapons: ["rifle"] }, `Operator ${index}`));
  startMatch(room, 10000);
  room.enemies.clear();
  for (const [index, player] of players.entries()) {
    player.position = groundedPosition(mapId, { x: -3 + index * 1.5, z: 20 }, playerStance(false).eyeHeight);
    player.protectedUntil = 0;
  }
  return { room, players, player: players[0], ally: players[1] };
}
function down(room, player, at = 10000) {
  player.health = 10;
  damageOperator(room, player, 20, at);
}
function hold(room, reviver, targetId, from, duration) {
  for (let elapsed = 50; elapsed <= duration; elapsed += 50) {
    const now = from + elapsed;
    assert.equal(requestTeamInteraction(room, reviver.socketId, targetId, now).ok, true);
    tickTeamwork(room, .05, now);
  }
}

test("co-op lethal damage creates a real low crawl, forbids weapons and validates crawl speed and jumping", () => {
  const { room, player } = fixture();
  down(room, player);
  assert.equal(player.downedUntil, 10000 + BLEEDOUT_MS);
  assert.equal(player.deadUntil, 0);
  assert.equal(player.health, 0);
  assert.equal(player.crouching, true);
  assert.equal(player.position.y, playerStance(true).eyeHeight);
  assert.equal(reload(room, player.socketId, 10100), false);
  assert.equal(shoot(room, player.socketId, { direction: { x: 0, y: 0, z: -1 } }, 10100).ok, false);
  assert.equal(useAmmoSupply(room, player.socketId, "ammo-0").ok, false);
  player.lastMove = 10000;
  const crawl = { position: { ...player.position, x: player.position.x + .18 }, yaw: 0, pitch: 0, crouching: true };
  assert.equal(updatePlayer(room, player.socketId, crawl, 10200), true);
  assert.equal(updatePlayer(room, player.socketId, { ...crawl, position: { ...player.position, x: player.position.x + 1 } }, 10300), false);
  assert.equal(updatePlayer(room, player.socketId, { ...crawl, position: { ...player.position, y: 2 } }, 10500), false);
  assert.equal(movementSpeed({ downed: true, sprinting: true }), DOWNED_SPEED);
  assert.ok(movementVelocity({ x: 0, z: 0 }, { x: 1, z: 0 }, .1, { downed: true }).x <= DOWNED_SPEED);
});

test("a teammate must genuinely hold in clear reach; completion restores health and awards bounded shared XP", () => {
  const { room, player, ally } = fixture();
  down(room, player);
  hold(room, ally, player.socketId, 10000, 2750);
  assert.ok(player.downedUntil);
  assert.equal(player.reviveProgressMs, 2750);
  hold(room, ally, player.socketId, 12750, 50);
  assert.equal(player.downedUntil, 0);
  assert.equal(player.health, 45);
  assert.equal(player.protectedUntil, 14000);
  assert.equal(ally.revives, 1);
  assert.equal(ally.teamXp, 25);
  assert.equal(player.teamXp, 3);
  player.protectedUntil = 0;
  down(room, player, 15000);
  hold(room, ally, player.socketId, 15000, 2800);
  assert.equal(ally.revives, 1, "same victim cannot farm revive credit within a wave");
  assert.equal(ally.teamXp, 25);
});

test("medics and engineer stations shorten actual held revives rather than bypassing them", () => {
  for (const support of ["medic", "engineer"]) {
    const { room, player, ally } = fixture();
    ally.classId = support;
    if (support === "engineer") activateClassAbility(room, ally.socketId, 10000);
    down(room, player);
    hold(room, ally, player.socketId, 10000, 1450);
    assert.ok(player.downedUntil);
    hold(room, ally, player.socketId, 11450, 50);
    assert.equal(player.health, 45);
  }
});

for (const interruption of ["release", "movement", "damage", "disconnect", "range", "timeout"]) {
  test(`revive progress is discarded after ${interruption}`, () => {
    const { room, player, ally } = fixture();
    down(room, player);
    hold(room, ally, player.socketId, 10000, 500);
    if (interruption === "release") requestTeamInteraction(room, ally.socketId, null, 10501);
    if (interruption === "movement") ally.position.z += .7;
    if (interruption === "damage") damageOperator(room, ally, 1, 10501);
    if (interruption === "disconnect") room.players.delete(ally.socketId);
    if (interruption === "range") player.position.z += 5;
    tickTeamwork(room, .05, interruption === "timeout" ? 11000 : 10550);
    assert.equal(player.reviveProgressMs, 0);
    assert.equal(player.revivedBy, null);
    assert.equal(ally.revives, 0);
  });
}

test("bleedout becomes real death, while a fully incapacitated squad ends instead of stalling", () => {
  const { room, player, ally } = fixture();
  down(room, player);
  tickTeamwork(room, .05, 10000 + BLEEDOUT_MS);
  assert.equal(player.downedUntil, 0);
  assert.ok(player.deadUntil > 10000 + BLEEDOUT_MS);
  const next = fixture();
  down(next.room, next.player);
  down(next.room, next.ally);
  const result = tickRoom(next.room, .05, 10050);
  assert.equal(result.won, false);
  assert.equal(next.room.phase, "ended");
  assert.equal(ally.revives, 0);
});

test("a disconnected final standing teammate cannot strand a downed operator", () => {
  const { room, player, ally } = fixture();
  down(room, player);
  room.players.delete(ally.socketId);
  assert.equal(tickRoom(room, .05, 10050).won, false);
});

test("solo, practice and competitive mode preserve their existing death and reward rules", () => {
  for (const mode of ["campaign", "blitz", "raid"]) {
    const { room, player } = fixture(1, mode);
    down(room, player);
    assert.equal(player.downedUntil, 0);
    assert.ok(player.deadUntil);
  }
  const { room, player } = fixture(2, "ffa");
  assert.equal(activateClassAbility(room, player.socketId, 10001).ok, false);
  assert.equal(pingTeam(room, player.socketId, { kind: "route", position: { x: -3, y: 0, z: 16 } }, 10001).ok, false);
  assert.equal(awardTeamwork(room, player, "revive", "forged", 25), false);
});

test("class abilities obey cooldowns, range, real health limits and station-specific combos", () => {
  const { room, player, ally } = fixture();
  player.classId = "engineer";
  ally.reserve = 0;
  assert.equal(activateClassAbility(room, player.socketId, 10000).ok, true);
  assert.equal(activateClassAbility(room, player.socketId, 10001).ok, false);
  tickTeamwork(room, .05, 10050);
  const reserve = ally.reserve;
  assert.ok(reserve > 0);
  tickTeamwork(room, .05, 10100);
  assert.equal(ally.reserve, reserve, "one resupply per station and identity");
  ally.health = 20;
  ally.classId = "medic";
  assert.equal(activateClassAbility(room, ally.socketId, 10200).ok, true);
  assert.equal(ally.health, 70, "engineer station improves real medic healing");
  const before = ally.health;
  damageOperator(room, ally, 10, 10300);
  assert.equal(ally.health, before - 7);
  tickTeamwork(room, .05, 22001);
  assert.equal(room.teamFields.length, 0);
  damageOperator(room, ally, 10, 22002);
  assert.equal(ally.health, before - 17);
});

test("rally guard absorbs actual attacks and recon+rally increases only authoritative scanned-target hits", () => {
  const { room, player, ally } = fixture();
  player.classId = "assault";
  ally.classId = "recon";
  room.enemies.set("target", { id: "target", type: "drone", health: 1000, maxHealth: 1000, position: { x: -3, y: 1, z: 16 } });
  const direction = { x: 0, y: 0, z: -1 };
  const base = shoot(room, player.socketId, { direction }, 10001).damage;
  assert.ok(base > 0);
  activateClassAbility(room, player.socketId, 10002);
  activateClassAbility(room, ally.socketId, 10002);
  const combo = shoot(room, player.socketId, { direction }, 11000);
  assert.equal(combo.damage, Math.round(base * 1.25));
  const health = player.health;
  damageOperator(room, player, 25, 11001);
  assert.equal(player.health, health - 5);
  assert.equal(player.guard, 0);
  room.enemies.get("target").scannedUntil = 0;
  assert.equal(shoot(room, player.socketId, { direction }, 12000).damage, base);
});

test("assists need recent meaningful actual damage, exclude killers and cannot repeat", () => {
  const { room, player, ally } = fixture();
  const enemy = { id: "assist", health: 100, maxHealth: 100 };
  damageContributors(room, enemy, ally, 10, 10000);
  awardAssists(room, enemy, player, 10001);
  awardAssists(room, enemy, player, 10002);
  assert.equal(ally.assists, 1);
  assert.equal(ally.teamXp, 8);
  assert.equal(player.teamXp, 3);
  assert.equal(player.assists, 0);
  const tiny = { id: "tiny", health: 100, maxHealth: 100 };
  damageContributors(room, tiny, ally, 1, 10000);
  awardAssists(room, tiny, player, 10001);
  assert.equal(ally.assists, 1);
  awardAssists(room, { id: "expired", maxHealth: 100, contributors: enemy.contributors }, player, 18001);
  assert.equal(ally.assists, 1);
  for (let index = 0; index < 100; index++) awardTeamwork(room, ally, "assist", `bounded:${index}`, 8);
  assert.equal(ally.teamXp, TEAM_XP_CAP);
});

test("shots, kills and assists are connected to the actual ray/damage path", () => {
  const { room, player, ally } = fixture();
  ally.position = { ...player.position };
  room.enemies.set("assist", { id: "assist", type: "drone", health: 40, maxHealth: 40,
    position: { x: -3, y: 1, z: 16 } });
  assert.equal(shoot(room, ally.socketId, { direction: { x: 0, y: 0, z: -1 } }, 10001).killed, false);
  assert.equal(shoot(room, player.socketId, { direction: { x: 0, y: 0, z: -1 } }, 10002).killed, true);
  assert.equal(ally.assists, 1);
  assert.equal(player.kills, 1);
});

test("enemy, ammunition and route pings are visible, limited, expire and never track hidden movement", () => {
  const { room, player } = fixture();
  const enemy = { id: "pinged", health: 100, position: { x: -3, y: 1, z: 16 } };
  room.enemies.set(enemy.id, enemy);
  assert.equal(pingTeam(room, player.socketId, { kind: "enemy", targetId: enemy.id }, 10000).ok, true);
  enemy.position.x += 1;
  assert.equal(room.teamPings[0].position.x, -3);
  assert.equal(pingTeam(room, player.socketId, { kind: "enemy", targetId: enemy.id }, 10001).ok, false);
  assert.equal(pingTeam(room, player.socketId, { kind: "enemy", targetId: "missing" }, 11000).ok, false);
  room.supplies.set("ammo", { id: "ammo", position: { x: -3, y: .55, z: 18 }, usedBy: new Set() });
  assert.equal(pingTeam(room, player.socketId, { kind: "ammo", targetId: "ammo" }, 11000).ok, true);
  assert.equal(pingTeam(room, player.socketId, { kind: "route", position: { x: -3, y: .55, z: 16 } }, 12000).ok, true);
  assert.equal(room.teamPings.length, 1, "each manual ping replaces this operator's old ping");
  assert.equal(pingTeam(room, player.socketId, { kind: "route", position: { x: 40, y: 0, z: 40 } }, 13000).ok, false);
  tickTeamwork(room, .05, 18001);
  assert.equal(room.teamPings.length, 0);
});

test("teamwork private identity sets, damage contributors and interaction credit never enter public state", () => {
  const { room, player } = fixture();
  player.interaction = { targetId: "terminal-0", origin: { ...player.position }, at: 10000, private: "secret" };
  player.classId = "engineer";
  activateClassAbility(room, player.socketId, 10000);
  const enemy = { id: "enemy", health: 100, maxHealth: 100, position: { x: -3, y: 1, z: 16 } };
  room.enemies.set(enemy.id, enemy);
  damageContributors(room, enemy, player, 10, 10000);
  tickTeamwork(room, .05, 10001);
  const output = JSON.stringify(publicState(room, 10002));
  assert.equal(output.includes("private-"), false);
  assert.equal(output.includes("contributors"), false);
  assert.equal(output.includes("lastHurtAt"), false);
  assert.equal(output.includes('"interaction"'), false);
  assert.equal(output.includes("secret"), false);
});

test("nearby operators cannot revive, heal, scan or ping through actual occluding cover", () => {
  const { room, player, ally } = fixture();
  let pair;
  for (const obstacle of getMapObstacles(room.mapId)) {
    for (const axis of ["width", "depth"]) {
      if (obstacle[axis] > 1.5 || obstacle.height < 2) continue;
      const offset = obstacle[axis] / 2 + .5;
      const dx = (axis === "width" ? Math.cos(obstacle.rotation) : -Math.sin(obstacle.rotation)) * offset;
      const dz = (axis === "width" ? Math.sin(obstacle.rotation) : Math.cos(obstacle.rotation)) * offset;
      const first = groundedPosition(room.mapId, { x: obstacle.x - dx, z: obstacle.z - dz }, 1.57);
      const second = groundedPosition(room.mapId, { x: obstacle.x + dx, z: obstacle.z + dz }, 1.57);
      if (canOccupyPosition(room.mapId, first) && canOccupyPosition(room.mapId, second) &&
        Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z) < 2.8 &&
        !hasLineOfSight(room.mapId, first, second)) { pair = [first, second]; break; }
    }
    if (pair) break;
  }
  assert.ok(pair, "fixture needs actual cover with clear standing spaces on both sides");
  [player.position, ally.position] = pair;
  player.classId = "medic";
  player.health = ally.health = 20;
  activateClassAbility(room, player.socketId, 10001);
  assert.equal(ally.health, 20);
  player.classId = "recon"; player.abilityReadyAt = 0;
  room.enemies.set("occluded", { id: "occluded", health: 100, position: { ...ally.position } });
  activateClassAbility(room, player.socketId, 10002);
  assert.equal(room.enemies.get("occluded").scannedUntil, undefined);
  assert.equal(pingTeam(room, player.socketId, { kind: "enemy", targetId: "occluded" }, 10003).ok, false);
  down(room, ally, 10004);
  assert.ok(Math.hypot(player.position.x - ally.position.x, player.position.y - ally.position.y,
    player.position.z - ally.position.z) < 3);
  assert.equal(requestTeamInteraction(room, player.socketId, ally.socketId, 10005).ok, false);
});

test("regroup permits genuine revives and resolves disconnect wipes before starting another wave", () => {
  const { room, player, ally } = fixture(2, "campaign");
  room.phase = "between"; room.countdown = 50000;
  down(room, player);
  hold(room, ally, player.socketId, 10000, 2800);
  assert.equal(player.health, 45);
  player.protectedUntil = 0;
  down(room, player, 14000);
  room.players.delete(ally.socketId);
  assert.equal(tickRoom(room, .05, 14050).won, false);
});

test("all four objectives have collision-safe layouts and every escort route completes without teleporting", () => {
  for (const map of MAPS.filter((map) => eventContentAvailable(map.id))) {
    const { room, player } = fixture(1, "operation", map.id);
    for (let stage = 0; stage < 4; stage++) {
      const objective = createTeamObjective(map.id, stage);
      for (const point of [objective.position, ...objective.terminals.map((terminal) => terminal.position)]) {
        assert.ok(canOccupyPosition(map.id, { ...point, y: point.y + 1.02 }), `${map.id} stage ${stage}`);
      }
    }
    room.teamObjective = createTeamObjective(map.id, 1);
    let completed = false;
    for (let index = 0; index < 2400; index++) {
      const previous = { ...room.teamObjective.position };
      player.position = groundedPosition(map.id, previous);
      completed = tickTeamObjective(room, .05, 10000 + index * 50);
      assert.ok(Math.hypot(previous.x - room.teamObjective.position.x, previous.z - room.teamObjective.position.z) <= .071);
      if (completed) break;
    }
    assert.equal(completed, true, map.id);
    assert.equal(player.objectiveScore, 100);
  }
});

test("defend and escort require nearby operators and halt under actual contesting enemies", () => {
  const { room, player } = fixture(1);
  const objective = room.teamObjective;
  tickTeamObjective(room, .1, 10000);
  assert.equal(objective.progressMs, 0);
  player.position = groundedPosition(room.mapId, objective.position);
  room.enemies.set("contester", { position: { ...player.position }, health: 100 });
  tickTeamObjective(room, .1, 10100);
  assert.equal(objective.contested, true);
  assert.equal(objective.progressMs, 0);
  room.enemies.clear();
  tickTeamObjective(room, .1, 10200);
  assert.equal(objective.progressMs, 100);
  room.teamObjective = createTeamObjective(room.mapId, 1);
  const before = { ...room.teamObjective.position };
  player.position.z += 15;
  tickTeamObjective(room, .1, 10300);
  assert.deepEqual(room.teamObjective.position, before);
});

test("two operators must hold different hack terminals simultaneously; release and hurt reset synchronization", () => {
  const { room, player, ally } = fixture();
  room.teamObjective = createTeamObjective(room.mapId, 2);
  const [first, second] = room.teamObjective.terminals;
  player.position = groundedPosition(room.mapId, first.position);
  ally.position = groundedPosition(room.mapId, second.position);
  hold(room, player, first.id, 10000, 500);
  tickTeamObjective(room, .05, 10500);
  assert.equal(room.teamObjective.progressMs, 0);
  for (let elapsed = 50; elapsed <= 4950; elapsed += 50) {
    const now = 10500 + elapsed;
    requestTeamInteraction(room, player.socketId, first.id, now);
    requestTeamInteraction(room, ally.socketId, second.id, now);
    tickTeamwork(room, .05, now);
    assert.equal(tickTeamObjective(room, .05, now), false);
  }
  assert.equal(room.teamObjective.progressMs, 4950);
  requestTeamInteraction(room, ally.socketId, null, 15500);
  tickTeamwork(room, .05, 15500);
  tickTeamObjective(room, .05, 15500);
  assert.equal(room.teamObjective.progressMs, 0);
  for (let elapsed = 50; elapsed <= 5000; elapsed += 50) {
    const now = 15500 + elapsed;
    requestTeamInteraction(room, player.socketId, first.id, now);
    requestTeamInteraction(room, ally.socketId, second.id, now);
    tickTeamwork(room, .05, now);
    const complete = tickTeamObjective(room, .05, now);
    assert.equal(complete, elapsed === 5000);
  }
  assert.equal(player.objectiveScore, 100);
  assert.equal(ally.objectiveScore, 100);
});

test("solo hacking scales to one terminal, but a dead connected teammate does not turn co-op into solo", () => {
  for (const count of [1, 2]) {
    const { room, player, ally } = fixture(count);
    room.teamObjective = createTeamObjective(room.mapId, 2);
    const terminal = room.teamObjective.terminals[0];
    player.position = groundedPosition(room.mapId, terminal.position);
    if (ally) { ally.health = 0; ally.deadUntil = 50000; }
    for (let elapsed = 50; elapsed <= 5000; elapsed += 50) {
      requestTeamInteraction(room, player.socketId, terminal.id, 10000 + elapsed);
      tickTeamwork(room, .05, 10000 + elapsed);
      tickTeamObjective(room, .05, 10000 + elapsed);
    }
    assert.equal(room.teamObjective.progressMs, count === 1 ? 5000 : 0);
  }
});

test("extraction needs a cleared sector and every connected operator; no one can abandon a downed ally", () => {
  const { room, player, ally } = fixture();
  room.teamObjective = createTeamObjective(room.mapId, 3);
  player.position = groundedPosition(room.mapId, room.teamObjective.position);
  tickTeamObjective(room, .1, 10000);
  assert.equal(room.teamObjective.progressMs, 0);
  ally.position = groundedPosition(room.mapId, room.teamObjective.position);
  down(room, ally);
  tickTeamObjective(room, .1, 10100);
  assert.equal(room.teamObjective.progressMs, 0);
  ally.downedUntil = 0; ally.health = 45;
  room.enemies.set("last", { health: 100, position: { x: 30, y: 1, z: 30 } });
  tickTeamObjective(room, .1, 10200);
  assert.equal(room.teamObjective.progressMs, 0);
  room.enemies.clear();
  for (let index = 0; index < 50; index++) assert.equal(tickTeamObjective(room, .1, 10300 + index * 100), index === 49);
  assert.equal(player.objectiveScore, 100);
  assert.equal(ally.objectiveScore, 100);
});

test("authoritative operation advances stages, preserves XP and ends only after real extraction", () => {
  const { room, player } = fixture(1);
  for (let stage = 0; stage < 4; stage++) {
    assert.equal(room.teamObjective.stage, stage);
    room.enemies.clear();
    let result = null;
    for (let index = 0; index < 2400; index++) {
      const objective = room.teamObjective;
      player.position = groundedPosition(room.mapId, objective.kind === "hack" ? objective.terminals[0].position : objective.position);
      const now = 10000 + stage * 150000 + index * 50;
      if (objective.kind === "hack") requestTeamInteraction(room, player.socketId, objective.terminals[0].id, now);
      result = tickRoom(room, .05, now);
      if (result || room.teamObjective.stage !== stage) break;
    }
    if (stage === 3) {
      assert.equal(result.won, true);
      assert.equal(result.rewards[0].objectiveScore, 400);
      assert.equal(result.rewards[0].teamXp, 140);
      assert.ok(result.rewards[0].xp >= 140);
    } else assert.equal(room.teamObjective.stage, stage + 1);
  }
});

test("protocol rejects forged class, revive progress, damage, XP, target shapes and ability spam", () => {
  for (const packet of [["classAbility", { damage: 999 }], ["teamInteract", { targetId: "one", progress: 999 }],
    ["teamPing", { kind: "enemy", targetId: "1", xp: 999 }], ["teamPing", { kind: "route", position: { x: NaN, y: 0, z: 0 } }],
    ["selectClass", "owner"], ["teamPing", { kind: "ammo", targetId: [] }]]) {
    assert.equal(createCommandGuard().check(packet, false).ok, false);
  }
  for (const packet of [["classAbility"], ["teamInteract", null], ["teamInteract", "player"], ["selectClass", "medic"],
    ["teamPing", { kind: "enemy", targetId: "1" }], ["teamPing", { kind: "route", position: { x: 0, y: 0, z: 0 } }]]) {
    assert.equal(createCommandGuard().check(packet, false).ok, true);
  }
  const guard = createCommandGuard({ now: () => 10000 });
  assert.ok(Array.from({ length: 40 }, () => guard.check(["classAbility"], false)).some((result) => !result.ok));
});

test("saved class, reward metadata and legacy fields validate without resetting or accepting corrupt counters", () => {
  assert.equal(validTeamMetadata({ xp: 50 }), true);
  assert.equal(validTeamMetadata({ classId: "engineer", totalAssists: 2, totalRevives: 1, totalObjectiveScore: 400, teamworkXp: 150 }), true);
  for (const value of [{ classId: "owner" }, { totalAssists: -1 }, { teamworkXp: .1 }, { totalRevives: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.equal(validTeamMetadata(value), false);
  }
  const reward = { id: "11111111-1111-4111-8111-111111111111", identity: "test", kind: "match",
    xp: 500, kills: 4, wave: 4, won: true, mapId: null, tokens: 10, assists: 2, revives: 1, objectiveScore: 400, teamXp: 150 };
  assert.equal(validReward(reward), true);
  for (const change of [{ teamXp: 251 }, { xp: 10 }, { assists: -1 }, { revives: "1" }, { objectiveScore: NaN }]) {
    assert.equal(validReward({ ...reward, ...change }), false);
  }
});

test("old custom bindings preserve occupied new keys, and touch hold ownership releases cleanly", () => {
  const legacy = { ...DEFAULT_BINDINGS, reload: "KeyG" };
  for (const action of ["ability", "pingEnemy", "pingAmmo", "pingRoute"]) delete legacy[action];
  const migrated = normalizeBindings(legacy);
  assert.equal(migrated.reload, "KeyG");
  assert.notEqual(migrated.pingEnemy, "KeyG");
  assert.equal(new Set(Object.values(migrated)).size, Object.keys(DEFAULT_BINDINGS).length);
  const touch = new TouchInput();
  touch.begin(1, "interact", { x: 0, y: 0 });
  touch.begin(2, "move", { x: 0, y: 0 });
  assert.equal(touch.state.interacting, true);
  touch.end(1);
  assert.equal(touch.state.interacting, false);
  touch.begin(3, "interact", { x: 0, y: 0 });
  touch.reset();
  assert.equal(touch.state.interacting, false);
});

test("desktop and touch target helpers match server reach and ping last-known rather than arbitrary targets", () => {
  const { room, player, ally } = fixture();
  down(room, ally);
  room.enemies.set("visible", { id: "visible", health: 100, position: { x: -3, y: 1, z: 16 } });
  const state = publicState(room, 10001);
  assert.equal(teamInteractionTarget(state, player.socketId, player.position).id, ally.socketId);
  assert.equal(teamInteractionTarget(state, ally.socketId, ally.position), null);
  assert.deepEqual(teamPingPayload("enemy", state, player.position, 0, 0), { kind: "enemy", targetId: "visible" });
  assert.equal(teamPingPayload("enemy", state, player.position, Math.PI, 0), null);
  assert.equal(teamPingPayload("route", state, player.position, 0, 0).position.z, 10);
  assert.deepEqual(markerPlacement({ x: 0, y: 0, z: 0 }, 844, 390), { x: 422, y: 195, behind: false });
  assert.equal(markerPlacement({ x: NaN, y: 0, z: 0 }, 844, 390), null);
});
