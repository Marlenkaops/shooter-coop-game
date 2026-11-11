import { weaponFor } from "../shared/weapons.js";
import { effectiveWeapon } from "../shared/career.js";
import { canOccupyPosition, chooseEnemyStep, groundedPosition, hasLineOfSight,
  PLAYER_MAX_HEALTH, RESPAWN_MS, playerStance, validPosition } from "../shared/gameplay.js";
import { raidObjective } from "../shared/raid.js";
import { ableOperator, BLEEDOUT_MS, cooperativeMode, DEFAULT_CLASS, REVIVE_REACH,
  SQUAD_CLASSES, TEAM_OBJECTIVES, TEAM_XP_CAP } from "../shared/teamwork.js";

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const clearPath = (room, from, to) => hasLineOfSight(room.geometry || room.mapId, from, { ...to, y: to.y + .2 });
const inReach = (room, player, point, reach) => distance(player.position, point) <= reach && clearPath(room, player.position, point);

export function teamPlayerState(classId = DEFAULT_CLASS) {
  return { classId, downedUntil: 0, reviveProgressMs: 0, revivedBy: null, nextPingAt: 0,
    abilityReadyAt: 0, guard: 0, guardUntil: 0, rallyUntil: 0,
    assists: 0, revives: 0, objectiveScore: 0, teamXp: 0,
    interaction: null, lastHurtAt: 0 };
}

export function resetTeamwork(room) {
  room.teamPings = [];
  room.nextTeamPingId = 1;
  room.teamFields = [];
  room.teamRewardKeys = new Set();
  room.teamObjective = null;
  room.objectiveContributors = new Set();
}

export function awardTeamwork(room, player, kind, key, xp, score = 1) {
  if (!cooperativeMode(room.mode) || !player.connected || room.teamRewardKeys.has(key)) return false;
  room.teamRewardKeys.add(key);
  player.teamXp = Math.min(TEAM_XP_CAP, player.teamXp + xp);
  if (kind === "revive") player.revives++;
  if (kind === "assist") player.assists++;
  if (kind === "objective") player.objectiveScore += score;
  for (const ally of room.players.values()) if (ally !== player && ableOperator(ally)) {
    ally.teamXp = Math.min(TEAM_XP_CAP, ally.teamXp + 3);
  }
  return true;
}

export function damageContributors(room, enemy, attacker, damage, now) {
  if (!cooperativeMode(room.mode)) return;
  enemy.contributors ||= new Map();
  const previous = enemy.contributors.get(attacker.identity);
  enemy.contributors.set(attacker.identity, { damage: (previous?.damage || 0) + damage, at: now });
}

export function awardAssists(room, enemy, killer, now) {
  for (const ally of room.players.values()) {
    const contribution = enemy.contributors?.get(ally.identity);
    if (ally !== killer && contribution && now - contribution.at <= 8000 &&
      contribution.damage >= Math.min(10, enemy.maxHealth * .1)) {
      awardTeamwork(room, ally, "assist", `assist:${enemy.id}:${ally.identity}`, 8);
    }
  }
}

export function fieldFor(room, player, now) {
  return room.teamFields.find((field) => field.expiresAt > now && inReach(room, player, field.position, 4));
}

export function damageOperator(room, player, damage, now) {
  if (player.deadUntil || player.downedUntil || player.protectedUntil > now || !player.connected) return 0;
  let amount = fieldFor(room, player, now) ? Math.ceil(damage * .7) : damage;
  if (player.guardUntil > now) {
    const absorbed = Math.min(player.guard, amount);
    player.guard -= absorbed;
    amount -= absorbed;
  }
  player.lastHurtAt = now;
  player.interaction = null;
  const dealt = Math.min(player.health, amount);
  player.health -= dealt;
  if (player.health === 0) {
    player.reloadingUntil = player.reloadDuration = 0;
    player.reloadType = null;
    player.flying = false;
    const teammate = cooperativeMode(room.mode) && [...room.players.values()].some((ally) => ally !== player && ableOperator(ally));
    if (teammate) {
      player.downedUntil = now + BLEEDOUT_MS;
      player.position.y += playerStance(true).eyeHeight - playerStance(player.crouching).eyeHeight;
      player.crouching = true;
      player.movementCredit = 0;
    } else player.deadUntil = now + RESPAWN_MS;
  }
  return dealt;
}

export function requestTeamInteraction(room, socketId, targetId, now = Date.now()) {
  const player = room.players.get(socketId);
  if (!cooperativeMode(room.mode) || !["playing", "between"].includes(room.phase) || !player || !ableOperator(player)) {
    return { ok: false, error: "Team interaction unavailable." };
  }
  if (targetId === null) { player.interaction = null; return { ok: true }; }
  const victim = room.players.get(targetId);
  const terminal = room.teamObjective?.kind === "hack" && room.teamObjective.terminals.find((item) => item.id === targetId);
  if (!(victim?.downedUntil > now && victim.connected && victim !== player && inReach(room, player, victim.position, REVIVE_REACH)) &&
    !(terminal && inReach(room, player, terminal.position, 2.5))) {
    player.interaction = null;
    return { ok: false, error: "Move into clear reach of a downed teammate or active terminal." };
  }
  if (player.interaction?.targetId !== targetId) {
    player.interaction = { targetId, at: now, startedAt: now, origin: { ...player.position } };
  } else player.interaction.at = now;
  return { ok: true };
}

export function activateClassAbility(room, socketId, now = Date.now()) {
  const player = room.players.get(socketId);
  if (!player || !cooperativeMode(room.mode) || !["playing", "between"].includes(room.phase) || !ableOperator(player)) {
    return { ok: false, error: "Class abilities require an active, standing co-op operator." };
  }
  if (now < player.abilityReadyAt) return { ok: false, error: "Class ability is cooling down." };
  const allies = [...room.players.values()].filter((ally) => ableOperator(ally) && inReach(room, player, ally.position, 6));
  if (player.classId === "medic") {
    for (const ally of allies) ally.health = Math.min(PLAYER_MAX_HEALTH, ally.health +
      (fieldFor(room, ally, now) ? 50 : 30) + (player.perkId === "triage" ? 10 : 0));
  } else if (player.classId === "assault") {
    for (const ally of allies) { ally.guard = 20; ally.guardUntil = ally.rallyUntil = now + 8000; }
  } else if (player.classId === "recon") {
    const visible = [...room.enemies.values()].filter((enemy) => enemy.health > 0 &&
      distance(player.position, enemy.position) <= 22 && clearPath(room, player.position, enemy.position));
    for (const enemy of visible) enemy.scannedUntil = now + 8000;
    for (const enemy of visible.slice(0, 3)) addPing(room, player, "enemy", enemy.position, enemy.id, now, false);
  } else if (player.classId === "engineer") {
    room.teamFields = room.teamFields.filter((field) => field.ownerId !== player.socketId && field.expiresAt > now);
    room.teamFields.push({ id: `field-${player.socketId}`, ownerId: player.socketId,
      position: groundedPosition(room.geometry || room.mapId, player.position, .55), expiresAt: now + (player.perkId === "station" ? 15000 : 12000), usedBy: new Set() });
  }
  player.abilityReadyAt = now + SQUAD_CLASSES[player.classId].cooldownMs;
  return { ok: true, readyAt: player.abilityReadyAt };
}

function addPing(room, player, kind, position, targetId, now, replace = true) {
  if (replace) room.teamPings = room.teamPings.filter((ping) => ping.byId !== player.socketId);
  room.teamPings.push({ id: room.nextTeamPingId++, byId: player.socketId, kind, targetId,
    position: { ...position }, expiresAt: now + 6000 });
  room.teamPings = room.teamPings.slice(-12);
}

export function pingTeam(room, socketId, input, now = Date.now()) {
  const player = room.players.get(socketId);
  if (!player || !cooperativeMode(room.mode) || !["playing", "between"].includes(room.phase) ||
    !player.connected || player.deadUntil) return { ok: false, error: "Squad pings unavailable." };
  if (now < (player.nextPingAt || 0)) return { ok: false, error: "Wait briefly before another ping." };
  let point, targetId = null;
  if (input.kind === "enemy") {
    const enemy = room.enemies.get(input.targetId);
    if (enemy?.health > 0 && inReach(room, player, enemy.position, 26)) {
      point = enemy.position; targetId = enemy.id;
    }
  } else if (input.kind === "ammo") {
    const supply = room.supplies.get(input.targetId) || room.loot.get(input.targetId);
    if (supply && (supply.kind === undefined || supply.kind === "ammo") &&
      inReach(room, player, supply.position, 26)) { point = supply.position; targetId = supply.id; }
  } else if (input.kind === "route" && validPosition(input.position)) {
    const grounded = groundedPosition(room.geometry || room.mapId, input.position, .55);
    if (canOccupyPosition(room.geometry || room.mapId, { ...grounded, y: grounded.y + 1.02 }) &&
      inReach(room, player, grounded, 22)) point = grounded;
  }
  if (!point) return { ok: false, error: "Ping a visible nearby enemy, ammo source or walkable route." };
  addPing(room, player, input.kind, point, targetId, now);
  player.nextPingAt = now + 1000;
  return { ok: true };
}

export function tickTeamwork(room, dt, now) {
  if (!cooperativeMode(room.mode)) return;
  const step = Math.max(0, Math.min(.1, dt)) * 1000;
  room.teamPings = room.teamPings.filter((ping) => ping.expiresAt > now && room.players.has(ping.byId));
  room.teamFields = room.teamFields.filter((field) => field.expiresAt > now && room.players.has(field.ownerId));
  for (const player of room.players.values()) {
    if (player.guardUntil <= now) player.guard = 0;
    if (player.downedUntil && player.downedUntil <= now) {
      player.downedUntil = 0;
      player.deadUntil = now + RESPAWN_MS;
    }
    if (!ableOperator(player) || !player.interaction || now - player.interaction.at > 450 ||
      player.lastHurtAt >= player.interaction.startedAt ||
      distance(player.interaction.origin, player.position) > .5) player.interaction = null;
    const field = ableOperator(player) && fieldFor(room, player, now);
    if (field && !field.usedBy.has(player.identity)) {
      const weapon = effectiveWeapon(player.weaponId, player);
      player.reserve = Math.min(weapon.reserve, player.reserve + weapon.magSize);
      field.usedBy.add(player.identity);
    }
  }
  for (const victim of room.players.values()) {
    if (!victim.downedUntil) { victim.reviveProgressMs = 0; victim.revivedBy = null; continue; }
    const reviver = [...room.players.values()].find((player) => ableOperator(player) &&
      player.interaction?.targetId === victim.socketId && victim.connected &&
      inReach(room, player, victim.position, REVIVE_REACH));
    if (!reviver) { victim.reviveProgressMs = 0; victim.revivedBy = null; continue; }
    if (victim.revivedBy !== reviver.socketId) victim.reviveProgressMs = 0;
    victim.revivedBy = reviver.socketId;
    const requiredMs = reviver.classId === "medic" || fieldFor(room, reviver, now) ? 1500 : 2800;
    victim.reviveProgressMs += step;
    if (victim.reviveProgressMs >= requiredMs) {
      victim.downedUntil = 0;
      victim.health = 45;
      victim.protectedUntil = now + 1200;
      victim.reviveProgressMs = 0;
      victim.revivedBy = null;
      reviver.interaction = null;
      awardTeamwork(room, reviver, "revive", `revive:${room.wave}:${victim.identity}`, 25);
    }
  }
}

export function createTeamObjective(mapId, stage) {
  const definition = TEAM_OBJECTIVES[stage];
  if (!definition) throw new RangeError("Unknown cooperative objective");
  const start = raidObjective(mapId, stage === 3 ? 0 : stage);
  const objective = { ...definition, stage, id: `team-${definition.kind}`, position: { ...start.position },
    progressMs: 0, contested: false, terminals: [] };
  if (stage === 1) {
    objective.position = { ...raidObjective(mapId, 0).position };
    objective.destination = { ...start.position };
  }
  if (stage === 2) {
    const candidates = [[-2, 0], [2, 0], [0, -2], [0, 2], [-3, -2], [3, 2], [-3, 2], [3, -2]]
      .map(([x, z]) => groundedPosition(mapId, { x: start.position.x + x, z: start.position.z + z }, .55))
      .filter((position) => canOccupyPosition(mapId, { ...position, y: position.y + 1.02 }) &&
        clearPath({ mapId }, { ...start.position, y: start.position.y + 1.02 }, position));
    const first = candidates[0], second = candidates.find((point) => first && distance(first, point) >= 3);
    if (!first || !second) throw new Error(`No safe cooperative terminals on ${mapId}`);
    objective.terminals = [first, second].map((position, index) => ({ id: `terminal-${index}`, position, occupiedBy: null }));
  }
  return objective;
}

export function tickTeamObjective(room, dt, now) {
  const objective = room.teamObjective;
  if (!objective) return false;
  const step = Math.max(0, Math.min(.1, dt));
  const players = [...room.players.values()].filter(ableOperator);
  const nearby = players.filter((player) => inReach(room, player, objective.position, 5));
  objective.contested = [...room.enemies.values()].some((enemy) => distance(enemy.position, objective.position) < 6 &&
    clearPath(room, { ...enemy.position, y: enemy.position.y + .25 }, objective.position));
  let active = [];
  if (objective.kind === "defend") active = !objective.contested ? nearby : [];
  else if (objective.kind === "escort" && nearby.length && !objective.contested) {
    const from = { ...objective.position, y: groundedPosition(room.geometry || room.mapId, objective.position, 1).y };
    const next = chooseEnemyStep(room.geometry || room.mapId, from, objective.destination, step * 1.4);
    objective.position = groundedPosition(room.geometry || room.mapId, next, .55);
    for (const player of nearby) room.objectiveContributors.add(player.identity);
    if (distance(objective.position, objective.destination) <= 1.5) objective.progressMs = 1;
  } else if (objective.kind === "hack") {
    for (const terminal of objective.terminals) {
      const operator = players.find((player) => player.interaction?.targetId === terminal.id &&
        inReach(room, player, terminal.position, 2.5));
      terminal.occupiedBy = operator?.socketId || null;
      if (operator) active.push(operator);
    }
    if (new Set(active.map((player) => player.socketId)).size < Math.min(2, [...room.players.values()].filter((player) => player.connected).length) ||
      [...room.players.values()].some((player) => player.connected && player.downedUntil) || !active.length ||
      objective.contested) active = [];
  } else if (objective.kind === "extract" && !room.enemies.size &&
    [...room.players.values()].filter((player) => player.connected).every((player) => ableOperator(player) &&
      inReach(room, player, objective.position, 5))) active = nearby;
  if (active.length) {
    objective.progressMs = Math.min(objective.requiredMs, objective.progressMs + step * 1000);
    for (const player of active) room.objectiveContributors.add(player.identity);
  } else if (objective.kind === "extract" || objective.kind === "hack") objective.progressMs = 0;
  if (objective.progressMs < objective.requiredMs) return false;
  for (const player of room.players.values()) if (room.objectiveContributors.has(player.identity)) {
    awardTeamwork(room, player, "objective", `objective:${objective.stage}:${player.identity}`, 35, 100);
  }
  room.objectiveContributors.clear();
  return true;
}
