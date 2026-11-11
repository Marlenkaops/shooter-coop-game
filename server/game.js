import crypto from "node:crypto";
import { chooseEnemyCover, chooseEnemyTarget, coordinatedApproach, enemyCallout, enemySearchGoal,
  sentinelStep, squadFlankGoal, updateEnemyIntel } from "./enemy-tactics.js";
import { canStartEnemyAttack, createEnemyDirector, updateEnemyDirector } from "./enemy-director.js";
import { AI_DIFFICULTIES, DEFAULT_DIFFICULTY, ENEMY_ROLES } from "../shared/enemy-ai.js";
import { dropEnemyLoot, restockChests } from "./loot.js";
import { getTerrainHeight } from "../shared/arena-layout.js";
import {
  DEFAULT_WEAPON_ID, TOKENS_PER_KILL, damageForHit, offsetShotDirection, shotDirections, weaponFor, tokensForMatch
} from "../shared/weapons.js";
import { canAccessMap, CAMPAIGN_MAPS } from "../shared/progression.js";
import { canAccessMode, FFA_DURATION_MS, FFA_SCORE_LIMIT, MODES } from "../shared/modes.js";
import { leaderSocketId } from "./lobby.js";
import { DEFAULT_SKIN_ID } from "../shared/skins.js";
import { eventContentAvailable } from "../shared/events.js";
import { PRACTICE_MAP, RANGE_TARGETS, TARGET_RESET_MS, rangeSpawnPoint } from "../shared/practice.js";
import { RAID_REACH, raidObjective } from "../shared/raid.js";
import { ableOperator, DEFAULT_CLASS, DOWNED_SPEED } from "../shared/teamwork.js";
import { effectiveWeapon, endgameAllowed, validMutators } from "../shared/career.js";
import { applyCombatLoadout } from "./combat-loadout.js";
import { awardAssists, awardTeamwork, createTeamObjective, damageContributors, damageOperator,
  resetTeamwork, teamPlayerState, tickTeamObjective, tickTeamwork } from "./teamwork.js";
import {
  ENEMY_ACCELERATION, ENEMY_ATTACK_RANGE, ENEMY_RADIUS, ENEMY_WINDUP_MS, SKIRMISHER_WINDUP_MS,
  SENTINEL_ATTACK_RANGE,
  SENTINEL_WINDUP_MS, PLAYER_MAX_HEALTH, MEDKIT_HEAL, STARTING_MEDKITS, FLIGHT_CEILING,
  PLAYER_CROUCH_SPEED, PLAYER_MAX_MOVE_SPEED, RESPAWN_MS, SPAWN_PROTECTION_MS, playerStance,
  canOccupyPosition, canTraverse, canWalkTerrain, chooseEnemyStep, enemyStats, getSupportHeight, groundedPosition,
  hasLineOfSight, mapRayHit, raySphereHit, validPosition, waveEnemyCount,
  xpForMatch
} from "../shared/gameplay.js";
import { rankedEligibility } from "../shared/rankings.js";
import { createDestructibles, damageProps, geometryForProps, propAtRay } from "../shared/destructibles.js";

const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
const spawnPoint = (index = 0) => v((index % 2 ? 1 : -1) * (3 + index), 1.7, 10);

export function createRoom(code, mapId, mode = "campaign", difficulty = DEFAULT_DIFFICULTY, mutators = []) {
  if (!eventContentAvailable(mapId)) throw new RangeError("This event has ended.");
  if (!Object.hasOwn(MODES, mode)) throw new RangeError("Unknown game mode");
  if ((mode === "practice") !== (mapId === PRACTICE_MAP.id)) throw new RangeError("Practice requires the shooting range");
  if (!Object.hasOwn(AI_DIFFICULTIES, difficulty) ||
    ["practice", "ffa"].includes(mode) && difficulty !== DEFAULT_DIFFICULTY) throw new RangeError("Unknown or unavailable tactical difficulty");
  if (!validMutators(mutators) || ["practice", "ffa"].includes(mode) && mutators.length) throw new RangeError("Unavailable mutators");
  const props = createDestructibles(mapId);
  return {
    props, geometry: geometryForProps(mapId, props),
    code, mapId, mode, difficulty, mutators: [...mutators].sort(), director: null, callouts: [], nextCalloutId: 1, nextCalloutAt: 0,
    leaderId: null, phase: "lobby", wave: 0, enemies: new Map(), players: new Map(),
    chat: [], nextChatId: 1, chatLastSent: new Map(), kickedIdentities: new Set(),
    startedAt: 0, matchEndsAt: 0, pendingResult: null, raid: null, rankedSquad: null, rankedAssisted: false,
    teamPings: [], nextTeamPingId: 1, teamFields: [], teamRewardKeys: new Set(),
    teamObjective: null, objectiveContributors: new Set(),
    countdown: 0, objective: "Assemble your squad", won: false, advancingUntil: 0,
    advancingIdentities: null, campaignRejoined: null,
    nextEnemyId: 1, nextAttackId: 1, enemyContacts: new Map(),
    pendingNpcTokens: new Map(),
    attackEvents: [], supplies: new Map(), loot: new Map(), lootGeneration: 1, endedAt: 0
  };
}

export function addPlayer(room, socket, identity, profile, name) {
  const weaponId = eventContentAvailable(profile.equippedWeaponId) ? profile.equippedWeaponId || DEFAULT_WEAPON_ID : DEFAULT_WEAPON_ID;
  const weapon = weaponFor(weaponId);
  const player = {
    ...teamPlayerState(profile.classId || DEFAULT_CLASS),
    socketId: socket.id, identity, name: String(name || profile.username).slice(0, 18),
    playerTag: identity.slice(0, 8).toUpperCase(),
    position: room.mode === "practice" ? rangeSpawnPoint() : groundedPosition(room.geometry || room.mapId, spawnPoint(room.players.size)),
    yaw: 0, pitch: 0, health: PLAYER_MAX_HEALTH,
    medkits: room.mode === "practice" ? 0 : STARTING_MEDKITS,
    staffRole: null, flying: false, crouching: false,
    weaponId, skinId: profile.equippedSkinId || DEFAULT_SKIN_ID,
    ammo: weapon.magSize, reserve: weapon.reserve, reloadingUntil: 0, reloadDuration: 0,
    unlimitedAmmo: room.mode === "practice",
    practiceStats: room.mode === "practice" ? { shots: 0, hits: 0, headshots: 0, targets: 0 } : null,
    reloadType: null, lastShot: 0, lastShotPosition: null, lastShotHearingRange: 30, deadUntil: 0,
    protectedUntil: Date.now() + SPAWN_PROTECTION_MS,
    kills: 0, deaths: 0, connected: true, lastMove: Date.now(), moveSpeed: 0, movementCredit: .75,
    verticalMovementCredit: .25, shotSequence: 0, profile
  };
  applyCombatLoadout(player, room);
  const equipped = effectiveWeapon(player.weaponId, player);
  player.ammo = equipped.magSize;
  player.reserve = equipped.reserve;
  player.matchProgress = { weaponXp: {}, shots: 0, hits: 0, damage: 0 };
  player.rankingJoinedAt = Date.now();
  player.rankingLate = ["playing", "between"].includes(room.phase);
  room.players.set(socket.id, player);
  if (!room.leaderId) room.leaderId = identity;
  return player;
}

export function publicState(room, now = Date.now()) {
  return {
    code: room.code, mapId: room.mapId, mode: room.mode, difficulty: room.difficulty, mutators: room.mutators, leaderSocketId: leaderSocketId(room, now),
    director: room.director && room.phase === "playing" ? { phase: room.director.phase } : null,
    callouts: room.phase === "playing" ? room.callouts.filter((callout) => callout.expiresAt > now)
      .map((callout) => ({ ...callout, position: { ...callout.position } })) : [],
    chat: room.chat, phase: room.phase, wave: room.wave, serverNow: now,
    matchEndsAt: room.matchEndsAt, scoreLimit: room.mode === "ffa" ? FFA_SCORE_LIMIT : null,
    maxWaves: MODES[room.mode].waves,
    props: room.props.map((prop) => ({ ...prop })),
    raid: room.raid ? { ...room.raid, position: { ...room.raid.position } } : null,
    teamObjective: room.teamObjective ? structuredClone(room.teamObjective) : null,
    teamPings: room.teamPings.filter((ping) => ping.expiresAt > now).map((ping) => ({ ...ping, position: { ...ping.position } })),
    teamFields: room.teamFields.filter((field) => field.expiresAt > now)
      .map(({ usedBy, ...field }) => ({ ...field, position: { ...field.position } })),
    countdown: room.phase === "between"
      ? Math.max(0, Math.ceil((room.countdown - now) / 1000))
      : 0,
    objective: room.objective,
    players: [...room.players.values()].map(({
      identity, matchProgress, rankingJoinedAt, rankingLate, reloadingUntil, reloadDuration, reloadType, interaction, lastHurtAt, nextPingAt,
      lastMove, moveSpeed, movementCredit, verticalMovementCredit, profile, shotSequence, lastShotPosition, lastShotHearingRange, ...player
    }) => ({
      ...player,
      interactingWith: interaction?.targetId || null,
      level: profile.level,
      reloading: reloadingUntil > now,
      reloadEndsAt: reloadingUntil > now ? reloadingUntil : 0,
      reloadDuration: reloadingUntil > now ? reloadDuration : 0,
      reloadType: reloadingUntil > now ? reloadType : null
    })),
    enemies: [...room.enemies.values()].map(({ attackWindup, flankUntil, flankSide, velocity, targetId, staggerUntil,
      coverGoal, retreatUntil, retreatCooldown, coverUntil, coverCooldown,
      squadFlankGoal: privateFlankGoal, squadFlankUntil, squadFlankCooldown,
      nextCalloutAt, calloutKind, repeatCalloutAt, searchGoal, searchIndex, searchUntil, contributors, ...enemy }) => ({
      ...enemy,
      staggerRemainingMs: Math.max(0, (staggerUntil || 0) - now),
      threat: attackWindup ? {
        targetId: attackWindup.targetId,
        remainingMs: Math.max(0, attackWindup.endsAt - now)
      } : null
    })),
    supplies: [...room.supplies.values()].map(({ usedBy, ...supply }) => ({
      ...supply, usedBy: [...room.players.values()]
        .filter((player) => usedBy.has(player.identity)).map((player) => player.socketId)
    })),
    loot: [...room.loot.values()],
    attacks: room.attackEvents.map((attack) => ({ ...attack }))
  };
}

export function startMatch(room, now = Date.now()) {
  if (room.rewardQueue || room.pendingResult || room.pendingNpcTokens.size) return false;
  if (room.phase !== "lobby" && room.phase !== "ended") return false;
  if (room.mode === "ffa" && (room.players.size < 2 ||
    [...room.players.values()].some((player) => !canAccessMode(player.profile.xp, room.mode)))) return false;
  if (room.mode === "practice" && room.players.size !== 1) return false;
  if ([...room.players.values()].some((player) => !endgameAllowed(player.profile, room.difficulty, room.mutators))) return false;
  room.phase = "playing";
  room.startedAt = now;
  room.props = createDestructibles(room.mapId);
  room.geometry = geometryForProps(room.mapId, room.props);
  room.rankedSquad = null;
  room.rankedAssisted = false;
  room.matchEndsAt = room.mode === "ffa" ? now + FFA_DURATION_MS : 0;
  room.pendingResult = null;
  room.raid = null;
  resetTeamwork(room);
  room.won = false;
  room.advancingUntil = 0;
  room.advancingIdentities = null;
  room.campaignRejoined = null;
  room.wave = 1;
  room.enemies.clear();
  room.enemyContacts.clear();
  room.director = null;
  room.callouts = [];
  room.nextCalloutAt = 0;
  room.loot.clear();
  room.supplies.clear();
  for (const [index, player] of [...room.players.values()].entries()) {
    const weapon = applyCombatLoadout(player, room);
    player.matchProgress = { weaponXp: {}, shots: 0, hits: 0, damage: 0 };
    player.rankingJoinedAt = now;
    player.rankingLate = false;
    Object.assign(player, {
      ...teamPlayerState(player.classId),
      position: room.mode === "practice" ? rangeSpawnPoint() :
        room.mode === "ffa" ? freeForAllSpawn(room, player.socketId, index) : groundedPosition(room.geometry || room.mapId, spawnPoint(index)),
      health: PLAYER_MAX_HEALTH,
      medkits: room.mode === "practice" ? 0 : STARTING_MEDKITS,
      flying: false, crouching: false,
      ammo: weapon.magSize, reserve: weapon.reserve,
      deadUntil: 0, protectedUntil: now + SPAWN_PROTECTION_MS,
      kills: 0, deaths: 0, reloadingUntil: 0, reloadDuration: 0, reloadType: null,
      lastShot: 0, lastShotPosition: null, lastShotHearingRange: 30, lastMove: now,
      moveSpeed: 0, movementCredit: .75, verticalMovementCredit: .25, shotSequence: 0
    });
    if (player.practiceStats) player.practiceStats = { shots: 0, hits: 0, headshots: 0, targets: 0 };
  }
  if (room.mode === "ffa") {
    room.wave = 0;
    room.objective = `Free-for-All · first to ${FFA_SCORE_LIMIT}`;
    restockChests(room);
    placeSupplies(room);
  } else if (room.mode === "practice") {
    room.wave = 0;
    room.objective = "10 / 25 / 45 m targets · unlimited reserve · no rewards";
    spawnPracticeTargets(room);
  } else if (room.mode === "operation") {
    room.teamObjective = createTeamObjective(room.geometry || room.mapId, 0);
    spawnWave(room, now);
    room.objective = room.teamObjective.title;
  } else if (room.mode === "raid") spawnRaidStage(room, 0, now);
  else spawnWave(room, now);
  return true;
}

export function advanceCampaignRoom(room, profiles) {
  if (room.rewardQueue || room.pendingResult || room.pendingNpcTokens.size) return { ok: false, error: "Wait for match rewards to finish saving." };
  if (room.mode !== "campaign") return { ok: false, error: "This mode does not advance the campaign." };
  if (room.phase !== "ended" || !room.won) {
    return { ok: false, error: "Win this operation before continuing the campaign." };
  }
  const currentIndex = CAMPAIGN_MAPS.findIndex((map) => map.id === room.mapId);
  if (currentIndex < 0) return { ok: false, error: "Unknown campaign operation." };
  const next = CAMPAIGN_MAPS[currentIndex + 1];
  if (!next) return { ok: false, error: "The campaign is complete." };
  const players = [...room.players.values()];
  if (players.length !== profiles.length) {
    return { ok: false, error: "Fireteam records are unavailable." };
  }
  for (const [index, player] of players.entries()) {
    if (!profiles[index]?.campaignCompleted?.includes(room.mapId)) {
      return { ok: false, error: `${player.name} must clear this operation in campaign order.` };
    }
    if (!canAccessMap(profiles[index].xp, next.id, profiles[index].adminUnlockedMaps)) {
      return { ok: false, error: `${player.name} needs level ${next.level} for ${next.name}.` };
    }
  }
  room.mapId = next.id;
  room.props = createDestructibles(room.mapId);
  room.geometry = geometryForProps(room.mapId, room.props);
  room.phase = "lobby";
  room.wave = 0;
  room.won = false;
  room.objective = `Stage operation ${CAMPAIGN_MAPS.indexOf(next) + 1}: ${next.name}`;
  room.advancingUntil = Date.now() + 30_000;
  room.advancingIdentities = new Set(players.map((player) => player.identity));
  room.campaignRejoined = new Set();
  room.enemies.clear();
  room.supplies.clear();
  room.loot.clear();
  return { ok: true, mapId: next.id, code: room.code };
}

export function campaignSquadReady(room, now = Date.now()) {
  return room.advancingUntil <= now ||
    [...(room.advancingIdentities || [])].every((identity) =>
      room.campaignRejoined?.has(identity));
}

function spawnPracticeTargets(room) {
  for (const target of RANGE_TARGETS) {
    room.enemies.set(target.id, {
      ...target, position: { ...target.position }, health: 35, maxHealth: 35, resetAt: 0,
      speed: 0, damage: 0, lastAttack: 0, attackWindup: null, flankUntil: 0, flankSide: 0,
      staggerUntil: 0, targetId: null, velocity: { x: 0, z: 0 }, type: "practice"
    });
  }
}

export function practiceWeapon(room, socketId, weaponId, now = Date.now()) {
  if (!eventContentAvailable(weaponId)) return { ok: false, error: "This event weapon is no longer available." };
  const player = room?.players.get(socketId);
  if (room?.mode !== "practice" || room.phase !== "playing" || !player) {
    return { ok: false, error: "Enter the shooting range before changing practice guns." };
  }
  if (!player.profile.ownedWeapons.includes(weaponId)) return { ok: false, error: "Collect this gun before practising with it." };
  const weapon = applyCombatLoadout(player, room, weaponId);
  Object.assign(player, {
    weaponId, ammo: weapon.magSize, reserve: weapon.reserve,
    reloadingUntil: 0, reloadDuration: 0, reloadType: null, lastShot: now, shotSequence: 0
  });
  return { ok: true, weaponId };
}

function spawnWave(room, now = Date.now()) {
  room.phase = "playing";
  room.director = createEnemyDirector(now);
  room.callouts = [];
  room.objective = `Eliminate wave ${room.wave}`;
  restockChests(room);
  placeSupplies(room);
  const stats = enemyStats(room.mode === "blitz" ? room.wave + 1 : room.wave);
  const count = waveEnemyCount(room.wave, room.players.size);
  const squadCount = Math.max(1, Math.floor(count / 5));
  for (let i = 0; i < count; i++) {
    const side = i % 4;
    const offset = -28 + ((i * 13) % 56);
    const position = side === 0 ? v(-36, 1, offset) : side === 1 ? v(36, 1, offset)
      : side === 2 ? v(offset, 1, -36) : v(offset, 1, 36);
    position.y = getTerrainHeight(room.mapId, position.x, position.z) + 1;
    const brute = room.wave % 3 === 0 && i === 0;
    const sentinel = !brute && room.wave >= 2 && i === count - 1;
    const skirmisher = room.wave >= 2 && i === 1;
    const role = brute ? "heavy" : sentinel ? "sniper" : skirmisher || i % 5 === 0
      ? "rusher" : i % 5 === 2 ? "support" : "rifleman";
    const health = brute ? Math.round(stats.health * 1.65) :
      skirmisher ? Math.round(stats.health * .72) : stats.health;
    room.enemies.set(String(room.nextEnemyId), {
      id: String(room.nextEnemyId++), position, health, maxHealth: health,
      speed: brute ? stats.speed * .82 : sentinel ? stats.speed * .8 :
        skirmisher ? stats.speed * 1.3 : stats.speed,
      damage: brute ? Math.round(stats.damage * 1.35) :
        sentinel ? Math.max(7, Math.round(stats.damage * .7)) :
          skirmisher ? Math.max(6, Math.round(stats.damage * .75)) : stats.damage,
      lastAttack: 0, attackWindup: null, flankUntil: 0, flankSide: 0, staggerUntil: 0, targetId: null,
      velocity: { x: 0, z: 0 }, role,
      squadId: `${room.wave}-${Math.min(squadCount - 1, Math.floor(i / 5))}`,
      type: brute ? "brute" : sentinel ? "sentinel" : skirmisher ? "skirmisher" : "drone"
    });
  }
}

function spawnRaidStage(room, stage, now = Date.now()) {
  room.raid = raidObjective(room.geometry || room.mapId, stage);
  room.wave = stage + 1;
  const firstId = String(room.nextEnemyId);
  spawnWave(room, now);
  room.objective = room.raid.title;
  if (stage === 2) {
    const boss = room.enemies.get(firstId);
    Object.assign(boss, {
      isRaidBoss: true, type: "brute", role: "heavy", health: 240 + 90 * (room.players.size - 1),
      maxHealth: 240 + 90 * (room.players.size - 1), damage: 22, speed: 2.3,
      position: { ...room.raid.position, y: room.raid.position.y + .45 }
    });
    room.raid.bossId = boss.id;
  }
}

function atRaidObjective(room, player) {
  const point = room.raid.position;
  return Math.hypot(player.position.x - point.x, player.position.y - point.y,
    player.position.z - point.z) <= RAID_REACH &&
    hasLineOfSight(room.geometry || room.mapId, player.position, { ...point, y: point.y + .4 });
}

export function raidInteract(room, socketId, objectiveId) {
  const player = room?.players.get(socketId);
  if (room?.mode !== "raid" || room.phase !== "playing" || !player || !ableOperator(player) ||
    room.raid.stage !== 1 || objectiveId !== room.raid.id) return { ok: false, error: "Raid objective unavailable." };
  if (!atRaidObjective(room, player)) return { ok: false, error: "Move closer to the marked cache, with a clear path." };
  if (room.enemies.size) return { ok: false, error: "Eliminate the guards before recovering the cache." };
  awardTeamwork(room, player, "objective", `raid:1:${player.identity}`, 35, 100);
  spawnRaidStage(room, 2);
  return { ok: true };
}

function tickRaid(room, dt, now) {
  const objective = room.raid;
  if (objective.stage === 0) {
    objective.contested = [...room.enemies.values()].some((enemy) =>
      Math.hypot(enemy.position.x - objective.position.x, enemy.position.z - objective.position.z) < 6 &&
      hasLineOfSight(room.geometry || room.mapId, { ...enemy.position, y: enemy.position.y + .2 },
        { ...objective.position, y: objective.position.y + .4 }));
    const occupants = [...room.players.values()].filter((player) =>
      ableOperator(player) && atRaidObjective(room, player));
    if (occupants.length && !objective.contested) {
      for (const player of occupants) room.objectiveContributors.add(player.identity);
      objective.progressMs = Math.min(objective.requiredMs,
        objective.progressMs + Math.max(0, Math.min(.1, dt)) * 1000);
      if (objective.progressMs === objective.requiredMs) {
        for (const player of room.players.values()) if (room.objectiveContributors.has(player.identity)) {
          awardTeamwork(room, player, "objective", `raid:0:${player.identity}`, 35, 100);
        }
        room.objectiveContributors.clear();
        spawnRaidStage(room, 1, now);
      }
    }
  } else if (objective.stage === 2 && objective.bossDefeated && room.enemies.size === 0) {
    for (const player of room.players.values()) if (player.kills > 0) {
      awardTeamwork(room, player, "objective", `raid:2:${player.identity}`, 35, 100);
    }
    return endMatch(room, true);
  }
  return null;
}

function placeSupplies(room) {
  room.supplies.clear();
  for (const [index, x] of [-4, 4].entries()) {
    const candidates = [16, 20, 24, 12];
    const z = candidates.find((candidate) =>
      canOccupyPosition(room.geometry || room.mapId, v(x, 1, candidate), ENEMY_RADIUS));
    if (z === undefined) throw new Error(`No ammo supply position on ${room.mapId}`);
    room.supplies.set(`ammo-${index}`, {
      id: `ammo-${index}`, position: groundedPosition(room.geometry || room.mapId, v(x, 0, z), .55), usedBy: new Set()
    });
  }
}

function freeForAllSpawn(room, socketId, index) {
  const candidates = [[-32, 32], [32, -32], [32, 32], [-32, -32], [-20, 35], [20, -35],
    [-35, -20], [35, 20], [0, 35], [0, -35]];
  const others = [...room.players.values()].filter((player) => player.socketId !== socketId && !player.deadUntil);
  const safe = candidates.map(([x, z], order) => ({ position: groundedPosition(room.geometry || room.mapId, v(x, 0, z)), order: (order - index + candidates.length) % candidates.length }))
    .filter(({ position }) => canOccupyPosition(room.geometry || room.mapId, position))
    .map((candidate) => ({ ...candidate, distance: Math.min(100,
      ...others.map((player) => Math.hypot(player.position.x - candidate.position.x, player.position.z - candidate.position.z))) }))
    .sort((a, b) => b.distance - a.distance || a.order - b.order);
  if (!safe.length) throw new Error(`No Free-for-All spawn on ${room.mapId}`);
  return safe[0].position;
}

export function useMedkit(room, socketId) {
  const player = room?.players.get(socketId);
  if (!player || !["playing", "between"].includes(room.phase) || room.mode === "practice" ||
    !player.connected || player.deadUntil || player.health <= 0) {
    return { ok: false, error: "Medkits are unavailable while downed or outside combat." };
  }
  if (room.mutators.includes("iron")) return { ok: false, error: "No medkits mutator is active. Rely on Medic and revives." };
  if (player.health >= PLAYER_MAX_HEALTH) return { ok: false, error: "Health is already full." };
  if (player.medkits <= 0) return { ok: false, error: "No medkits left. Collect a medical case from enemy loot." };
  const healed = Math.min(MEDKIT_HEAL, PLAYER_MAX_HEALTH - player.health);
  player.medkits--;
  player.health += healed;
  return { ok: true, healed, health: player.health, medkits: player.medkits };
}

export function useAmmoSupply(room, socketId, supplyId) {
  const player = room.players.get(socketId);
  const supply = typeof supplyId === "string" ? room.supplies.get(supplyId) : null;
  if (!player || !supply || room.phase !== "playing" || player.deadUntil || player.downedUntil ||
    supply.usedBy.has(player.identity)) return { ok: false, error: "Ammo supply unavailable." };
  if (Math.hypot(player.position.x - supply.position.x, player.position.y - supply.position.y,
    player.position.z - supply.position.z) > 3 ||
    !hasLineOfSight(room.geometry || room.mapId, player.position, { ...supply.position, y: supply.position.y + .2 })) {
    return { ok: false, error: "Move closer to the ammo container." };
  }
  const weapon = effectiveWeapon(player.weaponId, player);
  const granted = Math.min(weapon.reserve - player.reserve, weapon.magSize * 2);
  if (granted <= 0) return { ok: false, error: "Reserve ammunition already full." };
  player.reserve += granted;
  supply.usedBy.add(player.identity);
  return { ok: true, granted, reserve: player.reserve };
}

export function updatePlayer(room, socketId, data, now = Date.now()) {
  const player = room.players.get(socketId);
  if (!player || player.deadUntil || !validPosition(data?.position) ||
    (data.crouching !== undefined && typeof data.crouching !== "boolean")) return false;
  const downed = player.downedUntil > now;
  const crouching = downed || data.crouching === true;
  const stance = playerStance(crouching);
  const from = { ...player.position,
    y: player.position.y + stance.eyeHeight - playerStance(player.crouching).eyeHeight };
  if (!canOccupyPosition(room.geometry || room.mapId, from, undefined, crouching)) return false;
  const dt = Math.max(0, Math.min(1, (now - player.lastMove) / 1000));
  const dx = data.position.x - player.position.x;
  const dz = data.position.z - player.position.z;
  const distance = Math.hypot(dx, dz);
  const maxSpeed = downed ? DOWNED_SPEED + .1 : crouching && !player.flying ? PLAYER_CROUCH_SPEED + .5 : PLAYER_MAX_MOVE_SPEED;
  const credit = Math.min(maxSpeed + (downed ? .1 : .75), (player.movementCredit ?? .75) + maxSpeed * dt);
  if (distance > credit) return false;
  const floor = getSupportHeight(room.geometry || room.mapId, { ...data.position, y: data.position.y - stance.eyeHeight + .17 });
  const nextPosition = { ...data.position };
  const verticalChange = Math.abs(nextPosition.y - from.y);
  const verticalCredit = Math.min(15.25, (player.verticalMovementCredit ?? .25) + 15 * dt);
  const falling = nextPosition.y <= from.y;
  if (nextPosition.y < floor + stance.eyeHeight - .22 ||
    nextPosition.y > (player.flying ? FLIGHT_CEILING : Math.max(floor + stance.eyeHeight + (downed ? .25 : 1.93), falling ? from.y : 0)) ||
    verticalChange > verticalCredit) return false;
  if (!canTraverse(room.geometry || room.mapId, from, nextPosition, undefined, crouching)) return false;
  player.position = nextPosition;
  player.crouching = crouching;
  player.movementCredit = credit - distance;
  player.verticalMovementCredit = verticalCredit - verticalChange;
  player.moveSpeed = distance / Math.max(.016, dt);
  player.yaw = Number.isFinite(data.yaw)
    ? Math.atan2(Math.sin(data.yaw), Math.cos(data.yaw))
    : player.yaw;
  player.pitch = Number.isFinite(data.pitch) ? Math.max(-1.5, Math.min(1.5, data.pitch)) : player.pitch;
  player.lastMove = now;
  return true;
}

export function reload(room, socketId, now = Date.now()) {
  const player = room.players.get(socketId);
  if (!player) return false;
  const weapon = effectiveWeapon(player.weaponId, player);
  finishReload(player, now);
  if (room.phase !== "playing" || player.deadUntil || player.downedUntil ||
    player.reloadingUntil > now || player.ammo >= weapon.magSize || player.reserve <= 0) return false;
  player.reloadType = player.ammo === 0 ? "empty" : "tactical";
  player.reloadDuration = player.reloadType === "empty" ? weapon.reloadMs : weapon.tacticalReloadMs;
  player.reloadingUntil = now + player.reloadDuration;
  return true;
}

function finishReload(player, now) {
  if (player.reloadingUntil && player.reloadingUntil <= now) {
    const needed = effectiveWeapon(player.weaponId, player).magSize - player.ammo;
    const moved = Math.min(needed, player.reserve);
    player.ammo += moved;
    if (!player.unlimitedAmmo) player.reserve -= moved;
    player.reloadingUntil = 0;
    player.reloadDuration = 0;
    player.reloadType = null;
  }
}

export function shoot(room, socketId, shot, now = Date.now()) {
  const player = room.players.get(socketId);
  if (!player || room.phase !== "playing" || player.deadUntil || player.downedUntil) return { ok: false, reason: "Unavailable" };
  if (!eventContentAvailable(player.weaponId)) return { ok: false, reason: "This event weapon is no longer available." };
  const weapon = effectiveWeapon(player.weaponId, player);
  finishReload(player, now);
  if (player.reloadingUntil > now) return { ok: false, reason: "Reloading" };
  if (now - player.lastShot < weapon.fireInterval) return { ok: false, reason: "Fire rate" };
  if (player.ammo <= 0) return { ok: false, reason: "Empty" };
  const direction = shot?.direction;
  if (!direction || !["x", "y", "z"].every((key) => Number.isFinite(direction[key]))) return { ok: false, reason: "Invalid aim" };
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (length < 0.9 || length > 1.1) return { ok: false, reason: "Invalid aim" };
  const suppliedDirection = {
    x: direction.x / length,
    y: direction.y / length,
    z: direction.z / length
  };
  const expectedDirection = {
    x: -Math.sin(player.yaw) * Math.cos(player.pitch),
    y: Math.sin(player.pitch),
    z: -Math.cos(player.yaw) * Math.cos(player.pitch)
  };
  const alignment = suppliedDirection.x * expectedDirection.x +
    suppliedDirection.y * expectedDirection.y +
    suppliedDirection.z * expectedDirection.z;
  if (alignment < Math.cos(Math.PI / 9)) return { ok: false, reason: "Invalid aim" };
  const continuedBurst = player.lastShot && now - player.lastShot <= 460;
  player.shotSequence = continuedBurst ? player.shotSequence + 1 : 0;
  const recentMoveSpeed = now - player.lastMove <= 250 ? player.moveSpeed : 0;
  const movementSpread = Math.min(0.016, Math.max(0, recentMoveSpeed - 1.2) * 0.0017);
  const recoilSpread = Math.min(0.006, player.shotSequence * 0.00125);
  const spread = (movementSpread + recoilSpread) * weapon.spreadMultiplier;
  const shotDirection = applyDeterministicSpread(suppliedDirection, spread, player.shotSequence);
  player.ammo--;
  player.lastShot = now;
  player.lastShotPosition = { ...player.position };
  player.lastShotHearingRange = ["carbine", "heavyPistol"].includes(weapon.id) ? 12 : 30;
  if (room.mode === "ffa") player.protectedUntil = 0;
  const rays = shotDirections(weapon.id, shotDirection).map((direction) =>
    traceShot(room, player.position, direction, weapon.range || 100, socketId, now));
  damageProps(room, rays, weapon.id);
  if (room.mode === "ffa") return resolvePlayerShots(room, player, weapon, rays, shotDirection, spread, now);
  const grouped = new Map();
  for (const ray of rays) {
    if (ray.impact !== "enemy") continue;
    const damage = damageForHit(weapon.id, ray.hitZone, ray.distance);
    const hit = grouped.get(ray.enemyId);
    if (hit) {
      hit.damage += damage;
      hit.pellets++;
      if (ray.hitZone === "head") hit.hitZone = "head";
      if (ray.distance < hit.distance) {
        hit.distance = ray.distance;
        hit.direction = ray.direction;
        hit.position = ray.position;
        hit.contactZone = ray.hitZone;
      }
    } else {
      grouped.set(ray.enemyId, {
        enemyId: ray.enemyId, damage, hitZone: ray.hitZone, distance: ray.distance,
        direction: ray.direction, position: ray.position, contactZone: ray.hitZone, pellets: 1, killed: false
      });
    }
  }
  const hits = [...grouped.values()];
  if (!["practice", "ffa"].includes(room.mode)) {
    player.matchProgress.shots++;
    if (hits.length) player.matchProgress.hits++;
  }
  if (player.practiceStats) {
    player.practiceStats.shots++;
    if (hits.length) player.practiceStats.hits++;
    if (hits.some((hit) => hit.hitZone === "head")) player.practiceStats.headshots++;
  }
  for (const hit of hits) {
    const enemy = room.enemies.get(hit.enemyId);
    if (player.rallyUntil > now && enemy.scannedUntil > now) hit.damage = Math.round(hit.damage * 1.25);
    damageContributors(room, enemy, player, Math.min(enemy.health, hit.damage), now);
    if (room.mode !== "practice") player.matchProgress.damage += Math.min(enemy.health, hit.damage);
    enemy.health -= hit.damage;
    if (hit.hitZone === "head") enemy.staggerUntil = now + 240;
    if (hit.hitZone === "head" && enemy.attackWindup) {
      enemy.attackWindup = null;
      enemy.lastAttack = now;
    }
    if (enemy.health <= 0) {
      if (room.mode === "practice") {
        enemy.health = 0;
        enemy.resetAt = now + TARGET_RESET_MS;
        player.practiceStats.targets++;
      } else {
        awardAssists(room, enemy, player, now);
        dropEnemyLoot(room, enemy, now);
        const pending = room.pendingNpcTokens.get(player.identity);
        if (pending) pending.tokens += TOKENS_PER_KILL;
        else room.pendingNpcTokens.set(player.identity, { tokens: TOKENS_PER_KILL, retryAt: 0 });
        room.enemies.delete(enemy.id);
        if (enemy.isRaidBoss) room.raid.bossDefeated = true;
        player.kills++;
        player.matchProgress.weaponXp[weapon.id] = (player.matchProgress.weaponXp[weapon.id] || 0) + 20;
      }
      hit.killed = true;
    }
  }
  hits.sort((a, b) => Number(b.killed) - Number(a.killed) || a.distance - b.distance);
  const closest = hits[0];
  return {
    ok: true, hit: hits.length > 0, killed: hits.some((hit) => hit.killed),
    kills: hits.filter((hit) => hit.killed).length,
    enemyId: closest?.enemyId, hitZone: closest?.hitZone || null,
    damage: hits.reduce((total, hit) => total + hit.damage, 0),
    distance: closest?.distance ?? rays[0].distance, ammo: player.ammo,
    direction: shotDirection, spread, impact: rays[0].impact, rays, hits
  };
}

function traceShot(room, origin, direction, range, shooterId, now) {
  let closest = null;
  const coverDistance = mapRayHit(room.geometry || room.mapId, origin, direction, range) ?? Infinity;
  const targets = room.mode === "ffa"
    ? [...room.players.values()].filter((player) => player.socketId !== shooterId && !player.deadUntil && player.protectedUntil <= now)
      .map((player) => ({ id: player.socketId, position: player.position, crouching: player.crouching, type: "player" }))
    : room.enemies.values();
  for (const enemy of targets) {
    if (enemy.health <= 0) continue;
    const bodyDistance = raySphereHit(
      origin,
      direction,
      { ...enemy.position, y: enemy.position.y + (enemy.type === "player" ? enemy.crouching ? -.25 : -.5 : .2) },
      enemy.type === "brute" ? 1.6 : enemy.type === "practice" ? .6 : enemy.type === "player" ? enemy.crouching ? .36 : .46 : .9
    );
    const headDistance = raySphereHit(
      origin,
      direction,
      { ...enemy.position, y: enemy.position.y + (enemy.type === "brute" ? 1.1 : enemy.type === "player" ? .045 : .9) },
      enemy.type === "brute" ? 0.4 : ["player", "practice"].includes(enemy.type) ? .24 : .28
    );
    const hitZone = headDistance !== null ? "head" : bodyDistance !== null ? "body" : null;
    const distance = hitZone === "head" ? headDistance : bodyDistance;
    if (distance !== null && distance <= range && distance < coverDistance && (!closest || distance < closest.distance)) {
      closest = { enemy, distance, hitZone };
    }
  }
  if (!closest) {
    return {
      direction,
      impact: Number.isFinite(coverDistance) ? "cover" : "none",
      propId: Number.isFinite(coverDistance) ? propAtRay(room, origin, direction, coverDistance) : undefined,
      distance: Number.isFinite(coverDistance) ? coverDistance : undefined
    };
  }
  return {
    direction, impact: room.mode === "ffa" ? "player" : "enemy",
    ...(room.mode === "ffa" ? { playerId: closest.enemy.id } : { enemyId: closest.enemy.id }),
    hitZone: closest.hitZone, distance: closest.distance,
    position: {
      x: origin.x + direction.x * closest.distance,
      y: origin.y + direction.y * closest.distance,
      z: origin.z + direction.z * closest.distance
    }
  };
}

function resolvePlayerShots(room, player, weapon, rays, direction, spread, now) {
  const grouped = new Map();
  for (const ray of rays) {
    if (ray.impact !== "player") continue;
    const hit = grouped.get(ray.playerId);
    const damage = damageForHit(weapon.id, ray.hitZone, ray.distance);
    if (hit) {
      hit.damage += damage;
      hit.pellets++;
      if (ray.hitZone === "head") hit.hitZone = "head";
    } else grouped.set(ray.playerId, { playerId: ray.playerId, damage, pellets: 1, distance: ray.distance,
      direction: ray.direction, position: ray.position, contactZone: ray.hitZone, hitZone: ray.hitZone, killed: false });
  }
  const hits = [...grouped.values()];
  for (const hit of hits) {
    const victim = room.players.get(hit.playerId);
    victim.health = Math.max(0, victim.health - hit.damage);
    if (victim.health === 0) {
      Object.assign(victim, { deadUntil: now + RESPAWN_MS, deaths: victim.deaths + 1,
        reloadingUntil: 0, reloadDuration: 0, reloadType: null });
      player.kills++;
      hit.killed = true;
      dropEnemyLoot(room, { type: "drone", position: victim.position }, now);
    }
  }
  if (player.kills >= FFA_SCORE_LIMIT) room.pendingResult = endFreeForAll(room, now);
  return { ok: true, hit: hits.length > 0, killed: hits.some((hit) => hit.killed),
    kills: hits.filter((hit) => hit.killed).length, playerId: hits[0]?.playerId,
    hitZone: hits[0]?.hitZone ?? null, damage: hits.reduce((total, hit) => total + hit.damage, 0),
    distance: hits[0]?.distance ?? rays[0].distance, ammo: player.ammo, direction, spread,
    impact: rays[0].impact, rays, hits };
}

function applyDeterministicSpread(direction, spread, sequence) {
  if (spread <= 0) return direction;
  const pattern = [
    [.32, .28], [.42, .78], [-.58, .84], [.7, .52],
    [-.76, .35], [.31, .92], [-.24, .68], [.62, .74]
  ][sequence % 8];
  return offsetShotDirection(direction, pattern[0] * spread, pattern[1] * spread);
}

export function tickRoom(room, dt, now = Date.now()) {
  if (room.pendingResult) {
    const result = room.pendingResult;
    room.pendingResult = null;
    return result;
  }
  for (const [id, loot] of room.loot) if (loot.expiresAt !== null && loot.expiresAt <= now) room.loot.delete(id);
  room.attackEvents = room.attackEvents.filter((attack) => now - attack.at <= 300);
  room.callouts = room.callouts.filter((callout) => callout.expiresAt > now);
  if (room.phase !== "playing") {
    if (room.phase === "between") {
      tickTeamwork(room, dt, now);
      if (![...room.players.values()].some(ableOperator) &&
        [...room.players.values()].some((player) => player.connected)) return endMatch(room, false);
    }
    if (room.phase === "between" && now >= room.countdown) {
      room.wave++;
      spawnWave(room, now);
    }
    return null;
  }
  if (room.mode === "practice") {
    for (const player of room.players.values()) finishReload(player, now);
    for (const enemy of room.enemies.values()) {
      if (enemy.resetAt && now >= enemy.resetAt) {
        enemy.health = enemy.maxHealth;
        enemy.resetAt = 0;
        enemy.staggerUntil = 0;
      }
    }
    return null;
  }
  for (const [playerIndex, player] of [...room.players.values()].entries()) {
    if (player.flying || player.unlimitedAmmo) room.rankedAssisted = true;
    finishReload(player, now);
    if (player.deadUntil && now >= player.deadUntil) {
      player.deadUntil = 0;
      player.downedUntil = 0;
      player.interaction = null;
      player.health = PLAYER_MAX_HEALTH;
      player.flying = false;
      player.crouching = false;
      player.ammo = effectiveWeapon(player.weaponId, player).magSize;
      player.position = room.mode === "ffa" ? freeForAllSpawn(room, player.socketId, playerIndex) : groundedPosition(room.geometry || room.mapId, spawnPoint(playerIndex));
      if (room.mode === "ffa") player.reserve = effectiveWeapon(player.weaponId, player).reserve;
      player.lastMove = now;
      player.movementCredit = .75;
      player.verticalMovementCredit = .25;
      player.protectedUntil = now + SPAWN_PROTECTION_MS;
    }
  }
  if (room.mode === "ffa") {
    if (room.players.size < 2 || now >= room.matchEndsAt) return endFreeForAll(room, now, room.players.size < 2);
    return null;
  }
  tickTeamwork(room, dt, now);
  const living = [...room.players.values()].filter(ableOperator);
  const targetable = living.filter((player) => player.protectedUntil <= now);
  const enemies = [...room.enemies.values()].sort((a, b) => Number(a.id) - Number(b.id));
  const budget = updateEnemyDirector(room, living, now);
  const tuning = AI_DIFFICULTIES[room.difficulty];
  const contacts = updateEnemyIntel(room, targetable, now);
  const pressure = new Map();
  for (const enemy of enemies) if (enemy.attackWindup) {
    const id = enemy.attackWindup.targetId;
    pressure.set(id, (pressure.get(id) || 0) + 1);
  }
  for (const enemy of enemies) {
    if (enemy.staggerUntil > now) {
      enemy.velocity = { x: 0, z: 0 };
      continue;
    }
    enemy.intent = "advance";
    const role = ENEMY_ROLES[enemy.role];
    const attackRange = role?.range ?? (enemy.type === "sentinel" ? SENTINEL_ATTACK_RANGE : ENEMY_ATTACK_RANGE);
    const attackIntent = ["support", "heavy"].includes(enemy.role) ? "suppress" : "aim";
    if (enemy.attackWindup) {
      const victim = targetable.find((player) => ableOperator(player) && player.protectedUntil <= now &&
        player.socketId === enemy.attackWindup.targetId);
      const inRange = victim && Math.hypot(
        victim.position.x - enemy.position.x, victim.position.y - .7 - enemy.position.y,
        victim.position.z - enemy.position.z
      ) <= attackRange;
      const origin = { ...enemy.position, y: enemy.position.y + .25 };
      const targetPosition = victim && { ...victim.position, y: victim.position.y - .45 };
      if (inRange && hasLineOfSight(room.geometry || room.mapId, origin, targetPosition)) {
        enemy.intent = attackIntent;
        if (attackIntent === "suppress") enemyCallout(room, enemy, "suppress", now);
        enemy.velocity = { x: 0, z: 0 };
        if (now >= enemy.attackWindup.endsAt) {
          const dealt = damageOperator(room, victim, enemy.damage, now);
          enemy.lastAttack = now;
          room.attackEvents.push({
            id: room.nextAttackId++, enemyId: enemy.id, targetId: victim.socketId,
            origin, target: { ...victim.position }, at: now, damage: dealt
          });
          enemy.attackWindup = null;
        }
        continue;
      }
      enemy.attackWindup = null;
    }
    const target = chooseEnemyTarget(room.geometry || room.mapId, enemy,
      contacts.filter((contact) => targetable.some((player) => player.socketId === contact.socketId && ableOperator(player))), pressure);
    if (!target) {
      enemy.intent = "search";
      if (enemy.targetId) enemyCallout(room, enemy, "search", now);
      enemy.targetId = null;
      enemy.coverGoal = null;
      enemy.squadFlankGoal = null;
      const search = enemySearchGoal(room.geometry || room.mapId, enemy, now);
      advanceEnemy(room.geometry || room.mapId, enemy, chooseEnemyStep(room.geometry || room.mapId, enemy.position, search, enemy.speed * dt), dt);
      continue;
    }
    enemy.searchGoal = null;
    const newContact = enemy.targetId !== target.socketId;
    enemy.targetId = target.socketId;
    pressure.set(target.socketId, (pressure.get(target.socketId) || 0) + 1);
    const visible = hasLineOfSight(room.geometry || room.mapId, { ...enemy.position, y: enemy.position.y + .25 },
      { ...target.position, y: target.position.y - .45 });
    const contactCallout = !visible || target.source === "sound"
      ? target.source === "sound" ? "sound" : "investigate" : newContact ? "contact" : null;
    if (!visible || target.source === "sound") {
      enemy.intent = "investigate";
    }
    if ((enemy.type !== "brute" || enemy.role === "heavy") &&
      enemy.health <= enemy.maxHealth * (enemy.role === "heavy" ? .2 : .35) && now >= (enemy.retreatCooldown || 0)) {
      enemy.coverGoal = chooseEnemyCover(room.geometry || room.mapId, enemy, target.position, enemies);
      enemy.retreatUntil = now + 1600;
      enemy.retreatCooldown = now + 6000;
    }
    if (enemy.retreatUntil > now) {
      enemy.intent = "recover";
      enemyCallout(room, enemy, "recover", now);
      const desired = enemy.coverGoal
        ? Math.hypot(enemy.coverGoal.x - enemy.position.x, enemy.coverGoal.z - enemy.position.z) > .25
          ? chooseEnemyStep(room.geometry || room.mapId, enemy.position, enemy.coverGoal, enemy.speed * dt) : enemy.position
        : sentinelStep(room.geometry || room.mapId, enemy, target.position,
          Math.hypot(target.position.x - enemy.position.x, target.position.z - enemy.position.z), enemy.speed * dt);
      advanceEnemy(room.geometry || room.mapId, enemy, desired, dt);
      continue;
    }
    const takeCover = role && tuning.useCover && ["rifleman", "support", "sniper"].includes(enemy.role) &&
      enemy.lastAttack > 0 && now - enemy.lastAttack < 1800 &&
      now >= (enemy.coverCooldown || 0);
    if (takeCover) {
      enemy.coverGoal = chooseEnemyCover(room.geometry || room.mapId, enemy, target.position, enemies);
      enemy.coverUntil = enemy.coverGoal ? now + 1400 : 0;
      enemy.coverCooldown = now + 6500;
    }
    if (enemy.coverUntil > now && enemy.coverGoal) {
      enemy.intent = "cover";
      enemyCallout(room, enemy, "cover", now);
      const desired = Math.hypot(enemy.coverGoal.x - enemy.position.x, enemy.coverGoal.z - enemy.position.z) > .25
        ? chooseEnemyStep(room.geometry || room.mapId, enemy.position, enemy.coverGoal, enemy.speed * dt) : enemy.position;
      advanceEnemy(room.geometry || room.mapId, enemy, desired, dt);
      continue;
    }
    enemy.coverGoal = null;
    const distance = Math.hypot(target.position.x - enemy.position.x,
      target.position.y - .7 - enemy.position.y, target.position.z - enemy.position.z);
    if (distance > attackRange) {
      if (enemy.flankUntil > now && hasLineOfSight(room.geometry || room.mapId,
        { ...enemy.position, y: enemy.position.y + .25 }, { ...target.position, y: target.position.y - .45 })) {
        enemy.flankUntil = 0;
        enemy.flankSide = 0;
      }
      let desired;
      if (enemy.flankUntil > now) {
        desired = flankTarget(room.geometry || room.mapId, enemy, target.position, enemy.speed * dt);
      } else {
        const squadGoal = squadFlankGoal(room, enemy, target, enemies, now);
        const approach = squadGoal || (role ? target.position : coordinatedApproach(room.geometry || room.mapId, enemy, target, enemies));
        if (approach !== target.position) enemy.intent = "flank";
        if (enemy.intent === "flank") enemyCallout(room, enemy, "flank", now);
        const pursuit = approach !== target.position ? approach : enemy.type === "skirmisher" && distance > 3 &&
          hasLineOfSight(room.geometry || room.mapId, { ...enemy.position, y: enemy.position.y + .25 },
            { ...target.position, y: target.position.y - .45 })
          ? skirmisherTarget(room.geometry || room.mapId, enemy, target.position, distance) : target.position;
        const next = chooseEnemyStep(room.geometry || room.mapId, enemy.position, pursuit, enemy.speed * dt);
        if (Math.hypot(next.x - enemy.position.x, next.z - enemy.position.z) > .01) {
          desired = next;
        } else {
          enemy.flankUntil = now + 1200;
          enemy.velocity = { x: 0, z: 0 };
          desired = flankTarget(room.geometry || room.mapId, enemy, target.position, enemy.speed * dt);
        }
      }
      advanceEnemy(room.geometry || room.mapId, enemy, desired, dt);
    } else {
      const origin = { ...enemy.position, y: enemy.position.y + .25 };
      const targetPosition = { ...target.position, y: target.position.y - .45 };
      if (!hasLineOfSight(room.geometry || room.mapId, origin, targetPosition)) {
        advanceEnemy(room.geometry || room.mapId, enemy,
          chooseEnemyStep(room.geometry || room.mapId, enemy.position, target.position, enemy.speed * dt), dt);
      } else if (now - enemy.lastAttack >
        (role?.cooldownMs ?? (enemy.type === "sentinel" ? 1800 : enemy.type === "skirmisher" ? 1050 : 850)) &&
        canStartEnemyAttack(enemy, enemies, target.socketId, budget)) {
        enemy.flankUntil = 0;
        enemy.flankSide = 0;
        enemy.velocity = { x: 0, z: 0 };
        enemy.intent = attackIntent;
        if (attackIntent === "suppress") enemyCallout(room, enemy, "suppress", now);
        enemy.attackWindup = {
          targetId: target.socketId,
          endsAt: now + (role?.windupMs ?? (enemy.type === "sentinel" ? SENTINEL_WINDUP_MS :
            enemy.type === "skirmisher" ? SKIRMISHER_WINDUP_MS :
              ENEMY_WINDUP_MS + (enemy.type === "brute" ? 180 : 0)))
        };
      } else {
        enemy.intent = budget.phase === "recovery" ? "regroup" : "ready";
        if (enemy.type === "sentinel") {
          advanceEnemy(room.geometry || room.mapId, enemy,
            sentinelStep(room.geometry || room.mapId, enemy, target.position, distance, enemy.speed * dt * .6), dt);
        } else enemy.velocity = { x: 0, z: 0 };
      }
    }
    if (contactCallout) enemyCallout(room, enemy, contactCallout, now);
  }
  separateEnemies(room, enemies);
  if (![...room.players.values()].some(ableOperator) &&
    [...room.players.values()].some((player) => player.connected)) return endMatch(room, false);
  if (room.mode === "operation") {
    if (tickTeamObjective(room, dt, now)) {
      if (room.teamObjective.stage === 3) return endMatch(room, true);
      room.teamObjective = createTeamObjective(room.geometry || room.mapId, room.teamObjective.stage + 1);
      room.wave++;
      room.enemies.clear();
      spawnWave(room, now);
      room.objective = room.teamObjective.title;
    }
    return null;
  }
  if (room.mode === "raid") {
    if (living.length === 0 && [...room.players.values()].every((player) => player.deadUntil - now > 1000)) {
      return endMatch(room, false);
    }
    return tickRaid(room, dt, now);
  }
  if (room.enemies.size === 0) {
    if (room.wave >= MODES[room.mode].waves) return endMatch(room, true);
    room.phase = "between";
    room.countdown = now + 5000;
    room.objective = `Wave cleared — regroup`;
  } else if (living.length === 0 && [...room.players.values()].every((player) => player.deadUntil - now > 1000)) {
    return endMatch(room, false);
  }
  return null;
}

function skirmisherTarget(mapId, enemy, target, distance) {
  const offset = Math.min(2.8, (distance - 3) * .4);
  const side = Number(enemy.id) % 2 ? 1 : -1;
  const dx = target.x - enemy.position.x;
  const dz = target.z - enemy.position.z;
  const approach = {
    ...target,
    x: target.x - side * dz / distance * offset,
    z: target.z + side * dx / distance * offset
  };
  return canOccupyPosition(mapId, approach, ENEMY_RADIUS) ? approach : target;
}

function advanceEnemy(mapId, enemy, desired, dt) {
  if (dt <= 0) return;
  const velocity = enemy.velocity || { x: 0, z: 0 };
  const desiredX = (desired.x - enemy.position.x) / dt;
  const desiredZ = (desired.z - enemy.position.z) / dt;
  const changeX = desiredX - velocity.x;
  const changeZ = desiredZ - velocity.z;
  const change = Math.hypot(changeX, changeZ);
  const fraction = Math.min(1, ENEMY_ACCELERATION * dt / (change || 1));
  const nextVelocity = {
    x: velocity.x + changeX * fraction,
    z: velocity.z + changeZ * fraction
  };
  const position = enemy.position;
  const candidate = groundedPosition(mapId, {
    ...position, x: position.x + nextVelocity.x * dt, z: position.z + nextVelocity.z * dt
  }, 1);
  if (canWalkTerrain(mapId, position, candidate, ENEMY_RADIUS)) {
    enemy.position = candidate;
    enemy.velocity = nextVelocity;
    return;
  }
  if (canWalkTerrain(mapId, position, desired, ENEMY_RADIUS)) {
    enemy.position = groundedPosition(mapId, desired, 1);
    enemy.velocity = {
      x: (desired.x - position.x) / dt,
      z: (desired.z - position.z) / dt
    };
    return;
  }
  for (const slide of [
    { ...position, x: candidate.x },
    { ...position, z: candidate.z }
  ]) {
    if (canWalkTerrain(mapId, position, slide, ENEMY_RADIUS)) {
      enemy.position = groundedPosition(mapId, slide, 1);
      enemy.velocity = {
        x: slide.x === position.x ? 0 : nextVelocity.x,
        z: slide.z === position.z ? 0 : nextVelocity.z
      };
      return;
    }
  }
  enemy.velocity = { x: 0, z: 0 };
}

function flankTarget(mapId, enemy, target, step) {
  const dx = target.x - enemy.position.x;
  const dz = target.z - enemy.position.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 1e-6) return enemy.position;
  const side = enemy.flankSide || (Number(enemy.id) % 2 ? 1 : -1);
  for (const direction of [side, -side]) {
    const candidate = {
      ...enemy.position,
      x: enemy.position.x - direction * dz / distance * step,
      z: enemy.position.z + direction * dx / distance * step
    };
    if (canWalkTerrain(mapId, enemy.position, candidate, ENEMY_RADIUS)) {
      enemy.flankSide = direction;
      return groundedPosition(mapId, candidate, 1);
    }
  }
  return enemy.position;
}

export function separateEnemies(room, enemies = [...room.enemies.values()]) {
  const minimum = ENEMY_RADIUS * 2;
  const maxCorrection = 0.14;
  for (let i = 0; i < enemies.length; i++) {
    for (let j = i + 1; j < enemies.length; j++) {
      const a = enemies[i], b = enemies[j];
      let dx = b.position.x - a.position.x;
      let dz = b.position.z - a.position.z;
      let distance = Math.hypot(dx, dz);
      if (distance >= minimum) continue;
      if (distance < 1e-6) {
        const angle = ((Number(a.id) * 97 + Number(b.id) * 53) % 360) * Math.PI / 180;
        dx = Math.cos(angle); dz = Math.sin(angle); distance = 1;
      }
      const correction = Math.min(maxCorrection, (minimum - distance) * 0.5);
      const nx = dx / distance, nz = dz / distance;
      const candidates = [
        [a, { ...a.position, x: a.position.x - nx * correction, z: a.position.z - nz * correction }],
        [b, { ...b.position, x: b.position.x + nx * correction, z: b.position.z + nz * correction }]
      ];
      for (const [enemy, candidate] of candidates) {
        if (canWalkTerrain(room.geometry || room.mapId, enemy.position, candidate, ENEMY_RADIUS)) {
          enemy.position = groundedPosition(room.geometry || room.mapId, candidate, 1);
        }
      }
    }
  }
}

function endMatch(room, won) {
  room.phase = "ended";
  room.won = won;
  room.endedAt = Date.now();
  room.objective = won ? "Sector secured" : "Squad overwhelmed";
  const rewards = [...room.players.values()].map((player) => ({
      socketId: player.socketId, identity: player.identity, kills: player.kills,
      xp: xpForMatch(room.wave, player.kills, won) + player.teamXp,
      assists: player.assists, revives: player.revives, objectiveScore: player.objectiveScore, teamXp: player.teamXp,
      progression: JSON.stringify({ ...player.matchProgress, classId: player.classId, at: room.endedAt,
        difficulty: room.difficulty, mutators: room.mutators, mode: room.mode,
        activeMs: Math.max(0, room.endedAt - room.startedAt) }),
      ranking: JSON.stringify({ version: 1, mapId: room.mapId, full: !player.rankingLate,
        personalMs: Math.max(0, room.endedAt - Math.max(room.startedAt, player.rankingJoinedAt)),
        eligible: !room.rankedAssisted && !player.flying && !player.unlimitedAmmo, team: null }),
      tokens: tokensForMatch(room.wave, 0, won),
      killTokens: player.kills * TOKENS_PER_KILL
    }));
  const team = room.rankedSquad;
  const teamEligible = team && team.identities.length === rewards.length &&
    rewards.every((reward) => team.identities.includes(reward.identity) && rankedEligibility({ ...reward, won }).ok) &&
    [...room.players.values()].every((player) => !player.rankingLate);
  for (const [index, reward] of rewards.entries()) {
    if (teamEligible) reward.ranking = JSON.stringify({ ...JSON.parse(reward.ranking),
      team: { tag: team.tag, anchor: index === 0, size: rewards.length } });
    const eligibility = rankedEligibility({ ...reward, won });
    reward.ranked = eligibility.ok;
    reward.rankedReason = eligibility.ok ? "Verified PvE result" : eligibility.reason;
  }
  return { won, wave: room.wave, mode: room.mode, maxWaves: MODES[room.mode].waves, rewards };
}

function endFreeForAll(room, now, abandoned = false) {
  const ranked = [...room.players.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  const first = ranked[0], second = ranked[1];
  const winnerId = !abandoned && first && (!second || first.kills !== second.kills || first.deaths !== second.deaths)
    ? first.socketId : null;
  room.phase = "ended";
  room.won = false;
  room.endedAt = now;
  room.objective = abandoned ? "Free-for-All ended: not enough players" : winnerId ? `${first.name} wins` : "Free-for-All draw";
  return { won: false, mode: "ffa", wave: 0, maxWaves: 0, winnerId, abandoned,
    rewards: ranked.map((player) => ({ socketId: player.socketId, identity: player.identity,
      kills: player.kills, deaths: player.deaths, xp: abandoned ? 0 : player.kills * 20 + (now - room.startedAt >= 30_000 ? 20 : 0),
      tokens: abandoned ? 0 : tokensForMatch(0, player.kills, false) })) };
}

export function roomCode() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}
