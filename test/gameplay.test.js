import test from "node:test";
import assert from "node:assert/strict";
import {
  BODY_DAMAGE, ENEMY_ACCELERATION, ENEMY_RADIUS, ENEMY_WINDUP_MS, HEADSHOT_DAMAGE, RELOAD_MS,
  SENTINEL_ATTACK_RANGE, SENTINEL_WINDUP_MS, SKIRMISHER_WINDUP_MS, TACTICAL_RELOAD_MS, PLAYER_SPRINT_SPEED,
  PLAYER_WALK_SPEED, canOccupyPosition, canTraverse, canWalkTerrain, groundedPosition,
  enemyStats, getMapObstacles, hasLineOfSight, positionHitsObstacle,
  rayObstacleHit, raySphereHit, validPosition, waveEnemyCount, xpForMatch
} from "../shared/gameplay.js";
import {
  addPlayer, advanceCampaignRoom, campaignSquadReady, createRoom, publicState, reload, shoot, startMatch, tickRoom, updatePlayer,
  useAmmoSupply
} from "../server/game.js";
import { WEAPONS } from "../shared/weapons.js";
import { MAPS } from "../shared/progression.js";
import { eventContentAvailable } from "../shared/events.js";

const socket = (id) => ({ id });
const profile = { level: 1 };

test("wave scaling grows with players and wave", () => {
  assert.equal(waveEnemyCount(1, 1), 5);
  assert.equal(waveEnemyCount(1, 2), 7);
  assert.ok(waveEnemyCount(4, 2) > waveEnemyCount(1, 2));
  assert.ok(enemyStats(5).health > enemyStats(1).health);
});

test("only server-cleared fifth wave yields a campaign-eligible win", () => {
  const room = createRoom("ABC123", "foundry");
  addPlayer(room, socket("one"), "identity", profile, "Tester");
  startMatch(room);
  for (let wave = 1; wave <= 5; wave++) {
    assert.equal(room.wave, wave);
    room.enemies.clear();
    const result = tickRoom(room, 0, wave * 10000);
    if (wave < 5) {
      assert.equal(result, null);
      assert.equal(room.phase, "between");
      tickRoom(room, 0, room.countdown);
    } else {
      assert.equal(result.won, true);
      assert.equal(result.wave, 5);
      assert.equal(room.phase, "ended");
    }
  }
});

test("a won campaign advances the same fireteam only when every player is cleared and leveled", () => {
  const room = createRoom("ABC123", "foundry");
  addPlayer(room, socket("one"), "one", profile, "Lead");
  addPlayer(room, socket("two"), "two", profile, "Wing");
  assert.equal(advanceCampaignRoom(room, []).ok, false);
  startMatch(room);
  room.wave = 5;
  room.enemies.clear();
  assert.equal(tickRoom(room, 0, 10_000).won, true);
  const cleared = { xp: 1000, campaignCompleted: ["foundry"] };
  assert.match(advanceCampaignRoom(room, [cleared, { xp: 1000, campaignCompleted: [] }]).error,
    /Wing must clear/);
  assert.match(advanceCampaignRoom(room, [cleared, { xp: 999, campaignCompleted: ["foundry"] }]).error,
    /Wing needs level 3/);
  assert.equal(room.mapId, "foundry");
  const advanced = advanceCampaignRoom(room, [cleared, cleared]);
  assert.deepEqual({ ok: advanced.ok, mapId: advanced.mapId, code: advanced.code },
    { ok: true, mapId: "tundra", code: "ABC123" });
  assert.equal(room.phase, "lobby");
  assert.equal(room.wave, 0);
  assert.equal(room.enemies.size, 0);
  assert.deepEqual([...room.advancingIdentities], ["one", "two"]);
  assert.equal(campaignSquadReady(room), false);
  room.campaignRejoined.add("one");
  assert.equal(campaignSquadReady(room), false);
  room.campaignRejoined.add("two");
  assert.equal(campaignSquadReady(room), true);
  room.campaignRejoined.delete("two");
  assert.equal(campaignSquadReady(room, room.advancingUntil), true);
  assert.equal(startMatch(room), true);
  assert.equal(room.wave, 1);
  assert.equal(room.won, false);
  assert.equal(room.campaignRejoined, null);
  assert.equal(room.advancingIdentities, null);
  assert.equal(advanceCampaignRoom(room, [cleared, cleared]).ok, false);
  room.wave = 5;
  room.enemies.clear();
  assert.equal(tickRoom(room, 0, 20_000).won, true);
  assert.equal(advanceCampaignRoom(room, [
    { xp: 2000, campaignCompleted: ["foundry", "tundra"] },
    { xp: 2000, campaignCompleted: ["foundry", "tundra"] }
  ]).mapId, "void");
  startMatch(room);
  room.wave = 5;
  room.enemies.clear();
  tickRoom(room, 0, 30_000);
  assert.match(advanceCampaignRoom(room, [
    { xp: 2000, campaignCompleted: ["foundry", "tundra", "void"] },
    { xp: 2000, campaignCompleted: ["foundry", "tundra", "void"] }
  ]).error, /complete/);
});

test("ray sphere hit detects forward targets only", () => {
  const origin = { x: 0, y: 1, z: 0 };
  assert.equal(raySphereHit(origin, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: -5 }, 1), 4);
  assert.equal(raySphereHit(origin, { x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 5 }, 1), null);
  assert.equal(raySphereHit(origin, { x: 0, y: 0, z: -1 }, { x: 4, y: 1, z: -5 }, 1), null);
});

test("server validates movement bounds and speed", () => {
  const room = createRoom("ABC123", "foundry");
  addPlayer(room, socket("one"), "identity", profile, "Tester");
  const player = room.players.get("one");
  player.lastMove = 1000;
  assert.equal(updatePlayer(room, "one", { position: { x: -2, y: 1.7, z: 10 } }, 1100), true);
  assert.equal(updatePlayer(room, "one", { position: { x: 40, y: 1.7, z: 10 } }, 1200), false);
  assert.equal(validPosition({ x: Infinity, y: 1, z: 0 }), false);
});

test("movement tolerance is a shared time budget, not reusable speed credit on every packet", () => {
  const room = createRoom("ABC123", "foundry");
  const player = addPlayer(room, socket("one"), "identity", profile, "Tester");
  player.position = { x: 0, y: 1.7, z: 20 };
  player.lastMove = 1000;
  let accepted = 0;
  for (let index = 0; index < 100; index++) {
    if (updatePlayer(room, "one", { position: { ...player.position, x: player.position.x + .1 } }, 1000)) accepted++;
  }
  assert.ok(accepted <= 8);
  assert.ok(player.position.x <= .75 + 1e-8);
  assert.equal(Object.hasOwn(publicState(room).players[0], "movementCredit"), false);
});

test("server accepts tactical walking and sprinting, including a delayed update", () => {
  const room = createRoom("ABC123", "foundry");
  addPlayer(room, socket("one"), "identity", profile, "Tester");
  const player = room.players.get("one");
  player.position = { x: 0, y: 1.7, z: 14 };
  player.lastMove = 1000;
  const walking = { x: 0, y: 1.7, z: 14 - PLAYER_WALK_SPEED * 0.05 };
  assert.equal(updatePlayer(room, "one", { position: walking }, 1050), true);
  const sprinting = { x: 0, y: 1.7, z: walking.z - PLAYER_SPRINT_SPEED * 0.05 };
  assert.equal(updatePlayer(room, "one", { position: sprinting }, 1100), true);
  const delayed = { x: 0, y: 1.7, z: sprinting.z - PLAYER_SPRINT_SPEED * 0.6 };
  assert.equal(updatePlayer(room, "one", { position: delayed }, 1700), true);
  assert.equal(updatePlayer(room, "one", {
    position: { x: 25, y: 1.7, z: delayed.z }
  }, 1750), false);
});

test("mission spawn accepts an initial WASD-sized movement update", () => {
  for (const { id: mapId } of MAPS.filter((map) => eventContentAvailable(map.id))) {
    const room = createRoom("ABC123", mapId);
    addPlayer(room, socket("one"), "identity", profile, "Tester");
    startMatch(room);
    const player = room.players.get("one");
    player.lastMove = 1000;
    assert.equal(updatePlayer(room, "one", {
      position: { ...player.position, z: player.position.z - 0.25 },
      yaw: 0,
      pitch: 0
    }, 1045), true, `${mapId} spawn should permit forward movement`);
  }
});

test("authored side arenas have distinct cover, clear squad spawns and accessible supply routes", () => {
  const layouts = ["harbor", "outpost"].map(getMapObstacles);
  assert.notDeepEqual(layouts[0], layouts[1]);
  assert.ok(layouts[0].some((obstacle) => obstacle.kind === "container"));
  assert.ok(layouts[1].some((obstacle) => obstacle.kind === "sandbag"));
  for (const mapId of ["harbor", "outpost", "airfield", "citadel"]) {
    const room = createRoom("SIDE", mapId);
    for (let index = 0; index < 8; index++) {
      addPlayer(room, socket(`player-${index}`), `identity-${index}`, profile, `Player ${index}`);
    }
    startMatch(room);
    for (const player of room.players.values()) {
      assert.ok(canOccupyPosition(mapId, player.position), `${mapId} squad spawn`);
      assert.ok(canTraverse(mapId, player.position, { ...player.position, z: 9.5 }));
    }
    for (const enemy of room.enemies.values()) {
      assert.ok(canOccupyPosition(mapId, enemy.position, ENEMY_RADIUS), `${mapId} enemy spawn`);
    }
    for (const supply of room.supplies.values()) {
      assert.ok(canOccupyPosition(mapId, supply.position, ENEMY_RADIUS));
      assert.ok(canTraverse(mapId, { x: supply.position.x, y: 1.7, z: 10 },
        { ...supply.position, y: 1.7 }), `${mapId} resupply approach`);
    }
    assert.ok(Object.isFrozen(getMapObstacles(mapId)));
    assert.ok(getMapObstacles(mapId).every(Object.isFrozen));
    room.phase = "ended";
    room.won = true;
    assert.equal(advanceCampaignRoom(room, []).ok, false);
  }
});

test("every authored arena enemy spawn connects to the squad without crossing solid cover", () => {
  for (const mapId of ["harbor", "outpost", "airfield", "citadel"]) {
    const room = createRoom("PATH", mapId);
    addPlayer(room, socket("one"), "identity", profile, "Tester");
    startMatch(room);
    const visited = new Set(["-3,10"]);
    const queue = [groundedPosition(mapId, { x: -3, z: 10 })];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const from = queue[cursor];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const to = groundedPosition(mapId, { x: from.x + dx, z: from.z + dz });
        const key = `${to.x},${to.z}`;
        if (visited.has(key) || !canWalkTerrain(mapId, from, to, ENEMY_RADIUS)) continue;
        visited.add(key);
        queue.push(to);
      }
    }
    for (const enemy of room.enemies.values()) {
      assert.ok(visited.has(`${enemy.position.x},${enemy.position.z}`), `${mapId} spawn ${enemy.id}`);
    }
  }
});

test("shared deterministic cover blocks occupancy and traversal", () => {
  const first = getMapObstacles("foundry");
  assert.strictEqual(first, getMapObstacles("foundry"));
  assert.equal(Object.isFrozen(first), true);
  assert.deepEqual(first, getMapObstacles("foundry"));
  assert.notDeepEqual(first, getMapObstacles("tundra"));
  const cover = first[0];
  const center = { x: cover.x, y: 1.7, z: cover.z };
  assert.equal(positionHitsObstacle(center, cover), true);
  assert.equal(canOccupyPosition("foundry", center), false);
  assert.equal(canTraverse("foundry",
    { x: cover.x - cover.width, y: 1.7, z: cover.z },
    { x: cover.x + cover.width, y: 1.7, z: cover.z }), false);
  assert.equal(canOccupyPosition("foundry", { x: 0, y: 1.7, z: 12 }), true);
});

test("shared cover ray test respects height and rotation", () => {
  const cover = { x: 0, z: -5, width: 5, depth: 1, height: 2, rotation: Math.PI / 8 };
  assert.ok(rayObstacleHit({ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, cover) > 0);
  assert.equal(rayObstacleHit({ x: 0, y: 4, z: 0 }, { x: 0, y: 0, z: -1 }, cover), null);
  assert.equal(rayObstacleHit({ x: 8, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, cover), null);
});

test("server rejects walking through deterministic cover", () => {
  const room = createRoom("ABC123", "foundry");
  addPlayer(room, socket("one"), "identity", profile, "Tester");
  const player = room.players.get("one");
  const cover = getMapObstacles("foundry").find((item) => item.id.endsWith("center-a"));
  player.position = { x: cover.x - cover.width / 2 - 0.6, y: 1.7, z: cover.z };
  player.lastMove = 1000;
  const destination = { x: cover.x + cover.width / 2 + 0.6, y: 1.7, z: cover.z };
  assert.equal(updatePlayer(room, "one", { position: destination }, 2000), false);
});

test("authoritative shooting consumes ammo, respects rate and applies damage", () => {
  const room = createRoom("ABC123", "foundry");
  addPlayer(room, socket("one"), "identity", profile, "Tester");
  startMatch(room);
  room.enemies.clear();
  room.enemies.set("target", {
    id: "target", type: "drone", health: 20, maxHealth: 20,
    position: { x: room.players.get("one").position.x, y: 1, z: 5 }
  });
  const shooter = room.players.get("one");
  const bodyDelta = {
    x: 0,
    y: 1.2 - shooter.position.y,
    z: 5 - shooter.position.z
  };
  const bodyLength = Math.hypot(bodyDelta.x, bodyDelta.y, bodyDelta.z);
  const result = shoot(room, "one", {
    direction: {
      x: bodyDelta.x / bodyLength,
      y: bodyDelta.y / bodyLength,
      z: bodyDelta.z / bodyLength
    },
    hitZone: "head",
    damage: 9999
  }, 1000);
  assert.equal(result.hit, true);
  assert.equal(result.hitZone, "body");
  assert.equal(result.damage, BODY_DAMAGE);
  assert.equal(result.killed, true);
  assert.ok(result.distance > 0 && result.distance < 5);
  assert.equal(room.players.get("one").ammo, WEAPONS.rifle.magSize - 1);
  assert.equal(shoot(room, "one", { direction: { x: 0, y: 0, z: -1 } }, 1050).ok, false);
});

test("authoritative shooting resolves a smaller elevated head zone", () => {
  const room = createRoom("ABC123", "foundry");
  addPlayer(room, socket("one"), "identity", profile, "Tester");
  startMatch(room);
  const shooter = room.players.get("one");
  room.enemies.clear();
  room.enemies.set("target", {
    id: "target", type: "drone", health: 100, maxHealth: 100,
    position: { x: shooter.position.x, y: 1, z: 5 }
  });
  const target = { x: shooter.position.x, y: 1.9, z: 5 };
  const delta = {
    x: target.x - shooter.position.x,
    y: target.y - shooter.position.y,
    z: target.z - shooter.position.z
  };
  const length = Math.hypot(delta.x, delta.y, delta.z);
  const result = shoot(room, "one", {
    direction: { x: delta.x / length, y: delta.y / length, z: delta.z / length }
  }, 1000);
  assert.equal(result.hit, true);
  assert.equal(result.hitZone, "head");
  assert.equal(result.damage, HEADSHOT_DAMAGE);
  assert.equal(room.enemies.get("target").health, 100 - HEADSHOT_DAMAGE);
});

test("server rejects shot directions that disagree with authoritative aim", () => {
  const room = createRoom("ABC123", "foundry");
  addPlayer(room, socket("one"), "identity", profile, "Tester");
  startMatch(room);
  const result = shoot(room, "one", { direction: { x: 1, y: 0, z: 0 } }, 1000);
  assert.deepEqual(result, { ok: false, reason: "Invalid aim" });
  assert.equal(room.players.get("one").ammo, WEAPONS.rifle.magSize);
});

test("server movement spread is bounded and deterministic", () => {
  const fireMovingShot = () => {
    const room = createRoom("ABC123", "foundry");
    addPlayer(room, socket("one"), "identity", profile, "Tester");
    startMatch(room);
    room.enemies.clear();
    const player = room.players.get("one");
    player.moveSpeed = 9.2;
    player.lastMove = 900;
    return shoot(room, "one", { direction: { x: 0, y: 0, z: -1 } }, 1000);
  };
  const first = fireMovingShot();
  const second = fireMovingShot();
  assert.ok(first.spread > 0 && first.spread <= 0.016);
  assert.deepEqual(first.direction, second.direction);
  assert.equal(Math.abs(Math.hypot(
    first.direction.x, first.direction.y, first.direction.z
  ) - 1) < 1e-12, true);
});

test("reload and match XP rules are bounded", () => {
  const room = createRoom("ABC123", "foundry");
  addPlayer(room, socket("one"), "identity", profile, "Tester");
  room.phase = "playing";
  const player = room.players.get("one");
  player.ammo = 2;
  player.reserve = 20;
  assert.equal(reload(room, "one", 1000), true);
  assert.equal(reload(room, "one", 1100), false);
  assert.equal(player.reloadType, "tactical");
  assert.equal(player.reloadingUntil, 1000 + TACTICAL_RELOAD_MS);
  assert.deepEqual(
    { type: publicState(room, 1100).players[0].reloadType,
      duration: publicState(room, 1100).players[0].reloadDuration },
    { type: "tactical", duration: TACTICAL_RELOAD_MS }
  );
  const direction = { x: 0, y: 0, z: -1 };
  assert.equal(shoot(room, "one", { direction }, 1000 + TACTICAL_RELOAD_MS - 1).reason, "Reloading");
  assert.equal(player.ammo, 2);
  tickRoom(room, 0, 1000 + TACTICAL_RELOAD_MS);
  assert.equal(player.ammo, 22);
  assert.equal(player.reserve, 0);
  assert.equal(player.reloadingUntil, 0);
  room.phase = "playing";
  player.ammo = 0;
  player.reserve = 10;
  assert.equal(reload(room, "one", 3000), true);
  assert.equal(player.reloadType, "empty");
  assert.equal(player.reloadingUntil, 3000 + RELOAD_MS);
  assert.equal(shoot(room, "one", { direction }, 3000 + RELOAD_MS - 1).reason, "Reloading");
  tickRoom(room, 0, 3000 + RELOAD_MS);
  assert.equal(player.ammo, 10);
  assert.equal(player.reserve, 0);
  assert.equal(player.reloadType, null);
  assert.equal(xpForMatch(3, 4, true), 283);
  assert.equal(xpForMatch(-10, -4, false), 0);
});

function combatRoom(now = 10_000) {
  const room = createRoom("ABC123", "foundry");
  addPlayer(room, socket("one"), "identity", profile, "Tester");
  room.phase = "playing";
  room.players.get("one").protectedUntil = now - 1;
  room.enemies.clear();
  return room;
}

function enemy(id, position) {
  return {
    id, type: "drone", position: { ...position }, health: 100, maxHealth: 100,
    speed: 4, damage: 10, lastAttack: 0
  };
}

test("server enemy movement cannot enter or traverse deterministic cover", () => {
  const room = combatRoom();
  const cover = getMapObstacles("foundry").find((item) => item.id.endsWith("center-a"));
  const hostile = enemy("1", { x: cover.x - 5, y: 1, z: cover.z });
  room.enemies.set(hostile.id, hostile);
  room.players.get("one").position = { x: cover.x + 5, y: 1.7, z: cover.z };
  room.enemyContacts.set("one", { socketId: "one", position: { ...room.players.get("one").position }, at: 10000 });
  for (let i = 0; i < 80; i++) {
    const previous = { ...hostile.position };
    tickRoom(room, 0.05, 10_000 + i * 50);
    assert.equal(canTraverse(room.mapId, previous, hostile.position, ENEMY_RADIUS), true);
    assert.equal(canOccupyPosition(room.mapId, hostile.position, ENEMY_RADIUS), true);
  }
  assert.ok(Math.hypot(hostile.position.x - room.players.get("one").position.x,
    hostile.position.z - room.players.get("one").position.z) < 6);
  assert.equal(hasLineOfSight(room.mapId,
    { ...hostile.position, y: 1.25 },
    { ...room.players.get("one").position, y: 1.25 }), true);
});

test("enemies follow both elevated ramp approaches in every arena without clipping or falling", () => {
  for (const { id } of MAPS.filter((map) => eventContentAvailable(map.id))) for (const side of [-1, 1]) {
    const room = createRoom("RAMPS", id);
    const player = addPlayer(room, socket("one"), "identity", profile, "Tester");
    room.phase = "playing";
    player.protectedUntil = 0;
    player.position = groundedPosition(id, { x: side * 34, z: 0 }, 1.57);
    player.lastShot = 10000;
    player.lastShotPosition = { ...player.position };
    const hostile = enemy("1", groundedPosition(id, { x: side * 34, z: 20 }, 1));
    hostile.damage = 0;
    room.enemies.set(hostile.id, hostile);
    assert.ok(canOccupyPosition(id, player.position), `${id}: target clearance`);
    let highest = 0;
    for (let frame = 0; frame < 400; frame++) {
      const previous = { ...hostile.position };
      tickRoom(room, .05, 10000 + frame * 50);
      assert.ok(canTraverse(id, previous, hostile.position, ENEMY_RADIUS), `${id}: blocked ramp movement`);
      assert.ok(canOccupyPosition(id, hostile.position, ENEMY_RADIUS), `${id}: terrain/cover penetration`);
      assert.ok(Math.abs(hostile.position.y - groundedPosition(id, hostile.position, 1).y) < 1e-8,
        `${id}: grounded ramp pursuit`);
      highest = Math.max(highest, hostile.position.y - 1);
      for (const attack of room.attackEvents) {
        assert.ok(hasLineOfSight(id, attack.origin, { ...attack.target, y: attack.target.y - .45 }),
          `${id}: attack must remain unoccluded`);
      }
    }
    assert.ok(highest >= 1.6 - 1e-8, `${id}: enemy must climb the elevated approach`);
    assert.ok(Math.hypot(hostile.position.x - player.position.x, hostile.position.z - player.position.z) < 2,
      `${id}: enemy stuck on ${side < 0 ? "west" : "east"} ramp`);
  }
});

test("opponents accelerate into motion instead of teleporting to full speed", () => {
  const room = combatRoom();
  const player = room.players.get("one");
  player.position = { x: -3, y: 1.7, z: 20 };
  const hostile = enemy("1", { x: -3, y: 1, z: 25 });
  room.enemies.set(hostile.id, hostile);
  const steps = [];
  for (let i = 0; i < 4; i++) {
    const previous = { ...hostile.position };
    const velocity = { ...(hostile.velocity || { x: 0, z: 0 }) };
    tickRoom(room, .05, 10_000 + i * 50);
    steps.push(Math.hypot(hostile.position.x - previous.x, hostile.position.z - previous.z));
    assert.ok(Math.hypot(hostile.velocity.x - velocity.x,
      hostile.velocity.z - velocity.z) <= ENEMY_ACCELERATION * .05 + 1e-8);
    assert.equal(canTraverse(room.mapId, previous, hostile.position, ENEMY_RADIUS), true);
  }
  assert.ok(steps[0] > 0 && steps[0] < hostile.speed * .05);
  assert.ok(steps[1] > steps[0]);
  assert.ok(steps[2] > steps[1]);
  assert.equal("velocity" in publicState(room).enemies[0], false);
});

test("server enemies cannot damage through cover", () => {
  const room = combatRoom();
  const cover = getMapObstacles("foundry").find((item) => item.id.endsWith("center-a"));
  const hostile = enemy("1", { x: cover.x, y: 1, z: cover.z - 0.8 });
  room.enemies.set(hostile.id, hostile);
  const player = room.players.get("one");
  player.position = { x: cover.x, y: 1.7, z: cover.z + 0.8 };
  assert.equal(hasLineOfSight(room.mapId,
    { x: hostile.position.x, y: 1.25, z: hostile.position.z },
    { x: player.position.x, y: 1.25, z: player.position.z }), false);
  tickRoom(room, 0.05, 10_000);
  assert.equal(player.health, 100);
  assert.equal(room.attackEvents.length, 0);
});

test("opaque cover blocks an in-range enemy windup and player bullets in every arena", () => {
  for (const { id } of MAPS.filter((map) => eventContentAvailable(map.id))) {
    const probe = getMapObstacles(id).filter((cover) => !cover.base && cover.height >= 1.8 &&
      cover.width >= 1.5 && cover.width <= 6).map((cover) => {
      const offset = cover.width / 2 + 1;
      return {
        hostile: groundedPosition(id, { x: cover.x - Math.cos(cover.rotation) * offset,
          z: cover.z + Math.sin(cover.rotation) * offset }, 1),
        player: groundedPosition(id, { x: cover.x + Math.cos(cover.rotation) * offset,
          z: cover.z - Math.sin(cover.rotation) * offset }, 1.57)
      };
    }).find((point) => canOccupyPosition(id, point.hostile, ENEMY_RADIUS) &&
      canOccupyPosition(id, point.player) && !hasLineOfSight(id,
        { ...point.hostile, y: point.hostile.y + .25 }, { ...point.player, y: point.player.y - .45 }));
    assert.ok(probe, `${id}: an accessible opaque-cover fixture is required`);
    const room = createRoom("COVER", id);
    const player = addPlayer(room, socket("one"), "identity", profile, "Tester");
    room.phase = "playing";
    player.position = probe.player;
    player.protectedUntil = 0;
    const hostile = enemy("1", probe.hostile);
    hostile.type = "sentinel";
    hostile.attackWindup = { targetId: "one", endsAt: 10000 };
    room.enemies.set(hostile.id, hostile);
    assert.ok(Math.hypot(player.position.x - hostile.position.x, player.position.z - hostile.position.z) < SENTINEL_ATTACK_RANGE);
    tickRoom(room, 0, 10000);
    assert.equal(player.health, 100, `${id}: cover cancels the ready attack`);
    assert.equal(room.attackEvents.length, 0);
    const delta = { x: hostile.position.x - player.position.x,
      y: hostile.position.y + .2 - player.position.y, z: hostile.position.z - player.position.z };
    const distance = Math.hypot(delta.x, delta.y, delta.z);
    const direction = Object.fromEntries(Object.entries(delta).map(([axis, value]) => [axis, value / distance]));
    player.yaw = Math.atan2(-direction.x, -direction.z);
    player.pitch = Math.asin(direction.y);
    const shot = shoot(room, "one", { direction }, 11000);
    assert.equal(shot.ok, true);
    assert.equal(shot.hit, false, `${id}: bullets cannot pass through cover`);
    assert.equal(hostile.health, 100);
    assert.ok(["cover", "terrain"].includes(shot.impact));
  }
});

test("wounded enemies reposition to cover without crossing walls or exposing internal tactics", () => {
  const room = combatRoom();
  const player = room.players.get("one");
  player.position = { x: -6, y: 1.7, z: -4 };
  const hostile = enemy("1", { x: -6, y: 1, z: 3 });
  hostile.health = 30;
  room.enemies.set(hostile.id, hostile);
  room.enemyContacts.set(player.socketId, { socketId: player.socketId, position: { ...player.position }, at: 9900 });
  tickRoom(room, .05, 10000);
  assert.equal(hostile.intent, "recover");
  assert.ok(hostile.coverGoal);
  for (let frame = 1; frame < 20; frame++) {
    const previous = { ...hostile.position };
    tickRoom(room, .05, 10000 + frame * 50);
    assert.equal(canTraverse(room.mapId, previous, hostile.position, ENEMY_RADIUS), true);
    assert.equal(player.health, 100);
  }
  const snapshot = publicState(room, 11000).enemies[0];
  for (const field of ["coverGoal", "retreatUntil", "retreatCooldown", "velocity", "targetId"]) {
    assert.equal(Object.hasOwn(snapshot, field), false);
  }
  assert.equal(hostile.retreatCooldown, 16000);
});

test("enemy announces an attack before damage, and a dodging player cancels it", () => {
  const room = combatRoom();
  const player = room.players.get("one");
  player.position = { x: 0, y: 1.7, z: 14 };
  room.enemies.set("1", enemy("1", { x: 0, y: 1, z: 15.2 }));
  tickRoom(room, 0.05, 10_000);
  const threat = publicState(room, 10_000).enemies[0].threat;
  assert.deepEqual(threat, { targetId: "one", remainingMs: ENEMY_WINDUP_MS });
  assert.equal(player.health, 100);
  assert.equal(room.attackEvents.length, 0);
  player.position = { x: 8, y: 1.7, z: 14 };
  tickRoom(room, 0.05, 10_000 + ENEMY_WINDUP_MS);
  assert.equal(player.health, 100);
  assert.equal(publicState(room, 10_000 + ENEMY_WINDUP_MS).enemies[0].threat, null);
});

test("death cancels an unfinished reload without spending reserve ammunition", () => {
  const room = combatRoom();
  const player = room.players.get("one");
  player.position = { x: 0, y: 1.7, z: 14 };
  player.ammo = 2;
  player.reserve = 20;
  const hostile = enemy("1", { x: 0, y: 1, z: 15.2 });
  hostile.damage = 100;
  room.enemies.set("1", hostile);
  assert.equal(reload(room, "one", 10_000), true);
  tickRoom(room, 0.05, 10_000);
  tickRoom(room, 0.05, 10_000 + ENEMY_WINDUP_MS);
  assert.equal(player.health, 0);
  assert.ok(player.deadUntil > 10_000);
  assert.equal(player.reloadingUntil, 0);
  assert.equal(player.reserve, 20);
  assert.equal(publicState(room, 10_000 + ENEMY_WINDUP_MS).players[0].reloading, false);
});

test("brute opponents are slower, tougher and hit harder", () => {
  const room = combatRoom();
  room.phase = "between";
  room.wave = 2;
  room.countdown = 10_000;
  tickRoom(room, 0, 10_000);
  const [brute, rifleman] = [...room.enemies.values()];
  assert.equal(brute.type, "brute");
  assert.ok(brute.health > rifleman.health);
  assert.ok(brute.damage > rifleman.damage);
  assert.ok(brute.speed < rifleman.speed);
});

test("skirmishers join later waves with lighter armor and faster lateral pursuit", () => {
  const room = combatRoom();
  assert.equal([...room.enemies.values()].some((enemy) => enemy.type === "skirmisher"), false);
  room.phase = "between";
  room.wave = 1;
  room.countdown = 10_000;
  tickRoom(room, 0, 10_000);
  const skirmishers = [...room.enemies.values()].filter((enemy) => enemy.type === "skirmisher");
  assert.equal(skirmishers.length, 1);
  const standard = [...room.enemies.values()].find((enemy) => enemy.type === "drone");
  assert.ok(skirmishers[0].health < standard.health);
  assert.ok(skirmishers[0].damage < standard.damage);
  assert.ok(skirmishers[0].speed > standard.speed);
  room.enemies.clear();
  const skirmisher = skirmishers[0];
  skirmisher.position = { x: -3, y: 1, z: 25 };
  skirmisher.velocity = { x: 0, z: 0 };
  room.enemies.set(skirmisher.id, skirmisher);
  const player = room.players.get("one");
  player.protectedUntil = 0;
  player.position = { x: -3, y: 1.7, z: 20 };
  assert.equal(hasLineOfSight(room.mapId, skirmisher.position, player.position), true);
  const before = { ...skirmisher.position };
  tickRoom(room, .05, 11_000);
  assert.notEqual(skirmisher.position.x, before.x);
  assert.ok(Math.hypot(skirmisher.position.x - player.position.x,
    skirmisher.position.z - player.position.z) <
    Math.hypot(before.x - player.position.x, before.z - player.position.z));
  assert.equal(canTraverse(room.mapId, before, skirmisher.position, ENEMY_RADIUS), true);

  skirmisher.position = { x: -3, y: 1, z: 21.5 };
  skirmisher.velocity = { x: 0, z: 0 };
  tickRoom(room, .05, 12_000);
  assert.equal(publicState(room, 12_000).enemies[0].threat.remainingMs, SKIRMISHER_WINDUP_MS);
  assert.equal(player.health, 100);
  tickRoom(room, .05, 12_000 + SKIRMISHER_WINDUP_MS);
  assert.equal(player.health, 100 - skirmisher.damage);
  assert.equal(room.attackEvents[0].enemyId, skirmisher.id);
});

test("sentinels hold distance, warn before ranged fire, and cannot shoot through cover", () => {
  const room = combatRoom();
  room.phase = "between";
  room.wave = 1;
  room.countdown = 10_000;
  tickRoom(room, 0, 10_000);
  const sentinel = [...room.enemies.values()].find((item) => item.type === "sentinel");
  assert.ok(sentinel);
  assert.ok(sentinel.speed < [...room.enemies.values()].find((item) => item.type === "drone").speed);
  room.enemies.clear();
  room.enemies.set(sentinel.id, sentinel);
  const player = room.players.get("one");
  player.protectedUntil = 0;
  player.position = { x: -3, y: 1.7, z: 20 };
  sentinel.position = { x: -3, y: 1, z: 25 };
  assert.ok(Math.hypot(player.position.x - sentinel.position.x,
    player.position.z - sentinel.position.z) < SENTINEL_ATTACK_RANGE);
  const initial = { ...sentinel.position };
  tickRoom(room, .05, 11_000);
  assert.deepEqual(sentinel.position, initial);
  assert.equal(publicState(room, 11_000).enemies[0].threat.remainingMs, SENTINEL_WINDUP_MS);
  assert.equal(player.health, 100);
  tickRoom(room, .05, 11_000 + SENTINEL_WINDUP_MS);
  assert.ok(player.health < 100);
  const cover = getMapObstacles("foundry").find((item) => item.id.endsWith("center-a"));
  player.position = { x: cover.x, y: 1.7, z: cover.z + 1.8 };
  sentinel.position = { x: cover.x, y: 1, z: cover.z - 1.8 };
  sentinel.lastAttack = 0;
  const before = player.health;
  tickRoom(room, .05, 13_000);
  assert.equal(sentinel.attackWindup, null);
  assert.equal(player.health, before);
});

test("headshots interrupt an announced attack without trusting the client hit zone", () => {
  const room = combatRoom();
  const player = room.players.get("one");
  player.position = { x: 0, y: 1.7, z: 14 };
  const hostile = enemy("1", { x: 0, y: 1, z: 12.5 });
  room.enemies.set("1", hostile);
  tickRoom(room, .05, 10_000);
  assert.ok(hostile.attackWindup);
  const result = shoot(room, "one", {
    direction: { x: 0, y: .13, z: -.9915 }, hitZone: "body"
  }, 10_100);
  assert.equal(result.hitZone, "head");
  assert.equal(hostile.attackWindup, null);
  assert.equal(publicState(room, 10_100).enemies[0].staggerRemainingMs, 240);
  const initial = { ...hostile.position };
  tickRoom(room, .05, 10_300);
  assert.deepEqual(hostile.position, initial);
  assert.equal(hostile.attackWindup, null);
  assert.equal(player.health, 100);
  tickRoom(room, .05, 10_000 + ENEMY_WINDUP_MS);
  assert.equal(player.health, 100);
});

test("ammo containers resupply each nearby living teammate only once per wave", () => {
  const room = createRoom("ABC123", "foundry");
  addPlayer(room, socket("one"), "one-id", profile, "One");
  addPlayer(room, socket("two"), "two-id", profile, "Two");
  startMatch(room);
  const supply = room.supplies.get("ammo-0");
  assert.ok(supply);
  const [first, second] = [...room.players.values()];
  first.reserve = 0;
  second.reserve = 0;
  assert.equal(useAmmoSupply(room, "one", supply.id).ok, false);
  first.position = { ...supply.position, y: 1.7 };
  second.position = { ...supply.position, y: 1.7 };
  const forged = useAmmoSupply(room, "one", "missing");
  assert.equal(forged.ok, false);
  const granted = useAmmoSupply(room, "one", supply.id);
  assert.deepEqual(granted, { ok: true, granted: WEAPONS.rifle.magSize * 2,
    reserve: WEAPONS.rifle.magSize * 2 });
  assert.equal(useAmmoSupply(room, "one", supply.id).ok, false);
  assert.equal(useAmmoSupply(room, "two", supply.id).ok, true);
  assert.deepEqual(publicState(room).supplies[0].usedBy, ["one", "two"]);
  room.players.delete("one");
  const rejoined = addPlayer(room, socket("rejoined"), "one-id", profile, "One");
  rejoined.reserve = 0;
  rejoined.position = { ...supply.position, y: 1.7 };
  assert.equal(useAmmoSupply(room, "rejoined", supply.id).ok, false);
  assert.deepEqual(publicState(room).supplies[0].usedBy, ["two", "rejoined"]);
  room.phase = "between";
  room.countdown = 10_000;
  tickRoom(room, 0, 10_000);
  assert.deepEqual(publicState(room).supplies[0].usedBy, []);
});

test("server enemies separate deterministically instead of stacking", () => {
  const room = combatRoom();
  room.players.get("one").protectedUntil = 20_000;
  const first = enemy("1", { x: 0, y: 1, z: 14 });
  const second = enemy("2", { x: 0, y: 1, z: 14 });
  room.enemies.set(first.id, first);
  room.enemies.set(second.id, second);
  for (let i = 0; i < 8; i++) tickRoom(room, 0.05, 10_000 + i * 50);
  assert.ok(Math.hypot(first.position.x - second.position.x,
    first.position.z - second.position.z) > ENEMY_RADIUS);
  assert.equal(canOccupyPosition(room.mapId, first.position, ENEMY_RADIUS), true);
  assert.equal(canOccupyPosition(room.mapId, second.position, ENEMY_RADIUS), true);
});

test("spawn protection excludes a player from enemy targeting and damage", () => {
  const room = combatRoom();
  const player = room.players.get("one");
  player.position = { x: 0, y: 1.7, z: 14 };
  player.protectedUntil = 11_800;
  room.enemies.set("1", enemy("1", { x: 0, y: 1, z: 15.2 }));
  tickRoom(room, 0.05, 10_000);
  assert.equal(player.health, 100);
  assert.equal(room.attackEvents.length, 0);
  tickRoom(room, 0.05, 12_000);
  assert.equal(player.health, 100);
  assert.equal(publicState(room, 12_000).enemies[0].threat.remainingMs, ENEMY_WINDUP_MS);
  tickRoom(room, 0.05, 12_000 + ENEMY_WINDUP_MS - 1);
  assert.equal(player.health, 100);
  tickRoom(room, 0.05, 12_000 + ENEMY_WINDUP_MS);
  assert.equal(player.health, 90);
  assert.deepEqual(
    { enemyId: room.attackEvents[0].enemyId, targetId: room.attackEvents[0].targetId },
    { enemyId: "1", targetId: "one" }
  );
});

test("late players enter playing and between-wave rooms with protection without resetting the squad or wave", () => {
  for (const phase of ["playing", "between"]) {
    const room = combatRoom();
    room.phase = phase;
    room.wave = 3;
    room.countdown = Date.now() + 5000;
    const previous = room.players.get("one");
    previous.health = 65;
    previous.ammo = 7;
    const hostile = enemy("7", { x: 0, y: 1, z: 20 });
    room.enemies.set("7", hostile);
    const countdown = room.countdown;
    const late = addPlayer(room, socket("late"), "late-id", profile, "LateAdmin");
    assert.equal(room.phase, phase);
    assert.equal(room.wave, 3);
    assert.equal(room.countdown, countdown);
    assert.equal(room.enemies.get("7"), hostile);
    assert.equal(previous.health, 65);
    assert.equal(previous.ammo, 7);
    assert.equal(late.health, 100);
    assert.ok(late.protectedUntil > Date.now());
    assert.equal(publicState(room).players.length, 2);
  }
});

test("public protection state does not expose persistent identity", () => {
  const room = combatRoom();
  const player = publicState(room).players[0];
  assert.equal(Number.isFinite(player.protectedUntil), true);
  assert.equal("identity" in player, false);
  assert.equal("profile" in player, false);
});

test("rotated cover collision and shot occlusion match the rendered Three.js orientation", async () => {
  const THREE = await import("three");
  const { positionHitsObstacle, rayObstacleHit } = await import("../shared/gameplay.js");
  const cover = { x: 2, z: -1, width: 7, depth: 1, height: 2, rotation: .5 };
  const mesh = new THREE.Object3D();
  mesh.position.set(cover.x, 0, cover.z);
  mesh.rotation.y = cover.rotation;
  mesh.updateMatrixWorld();
  const end = new THREE.Vector3(3.2, 0, 0).applyMatrix4(mesh.matrixWorld);
  const mirrored = new THREE.Vector3(3.2, 0, 0).applyMatrix4(new THREE.Matrix4().makeRotationY(-cover.rotation))
    .add(new THREE.Vector3(cover.x, 0, cover.z));
  assert.equal(positionHitsObstacle({ x: end.x, z: end.z }, cover, .01), true);
  assert.equal(positionHitsObstacle({ x: mirrored.x, z: mirrored.z }, cover, .01), false);
  const face = new THREE.Vector3(3.2, 0, .5).applyMatrix4(mesh.matrixWorld);
  const normal = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), cover.rotation);
  const origin = face.clone().addScaledVector(normal, 4).setY(1);
  const hit = rayObstacleHit(origin, normal.clone().negate(), cover);
  assert.ok(Math.abs(hit - 4) < 1e-6);
});
