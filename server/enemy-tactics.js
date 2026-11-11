import {
  canOccupyPosition, canWalkTerrain, ENEMY_RADIUS, getMapBuildings, getMapObstacles, groundedPosition, hasLineOfSight, SENTINEL_ATTACK_RANGE
} from "../shared/gameplay.js";
import { AI_DIFFICULTIES, DEFAULT_DIFFICULTY, ENEMY_CALLOUTS } from "../shared/enemy-ai.js";

export function chooseEnemyTarget(mapId, enemy, players, pressure = new Map()) {
  let target = null, best = Infinity;
  for (const player of players) {
    const distance = Math.hypot(player.position.x - enemy.position.x, player.position.y - .7 - enemy.position.y, player.position.z - enemy.position.z);
    const visible = hasLineOfSight(mapId, { ...enemy.position, y: enemy.position.y + .25 }, { ...player.position, y: player.position.y - .45 });
    const score = distance * (visible ? .75 : 1) * (player.socketId === enemy.targetId ? .85 : 1) *
      (1 + (pressure.get(player.socketId) || 0) * .35);
    if (score < best) { best = score; target = player; }
  }
  return target;
}

export function updateEnemyIntel(room, players, now) {
  const memoryMs = AI_DIFFICULTIES[room.difficulty || DEFAULT_DIFFICULTY].memoryMs;
  const contacts = room.enemyContacts;
  const enemies = [...room.enemies.values()];
  const liveIds = new Set(players.map((player) => player.socketId));
  for (const [id, contact] of contacts) {
    if (!liveIds.has(id) || now - contact.at > memoryMs) contacts.delete(id);
  }
  for (const player of players) {
    const visible = enemies.some((enemy) => hasLineOfSight(room.geometry || room.mapId,
      { ...enemy.position, y: enemy.position.y + .25 }, { ...player.position, y: player.position.y - .45 }));
    const noise = player.lastShotPosition;
    const hearingRange = player.lastShotHearingRange ?? (["carbine", "heavyPistol"].includes(player.weaponId) ? 12 : 30);
    const audible = noise && player.lastShot > 0 && now - player.lastShot >= 0 && now - player.lastShot <= 1200 &&
      enemies.some((enemy) =>
        Math.hypot(enemy.position.x - noise.x, enemy.position.z - noise.z) <= hearingRange);
    if (visible || audible && (!contacts.has(player.socketId) || contacts.get(player.socketId).at < player.lastShot)) {
      contacts.set(player.socketId, { socketId: player.socketId,
        position: { ...(visible ? player.position : noise) }, at: visible ? now : player.lastShot,
        source: visible ? "sight" : "sound" });
    }
  }
  return [...contacts.values()];
}

export function squadFlankGoal(room, enemy, target, allies, now) {
  const tuning = AI_DIFFICULTIES[room.difficulty || DEFAULT_DIFFICULTY];
  if (enemy.role !== "rusher" && !(enemy.role === "rifleman" && tuning.flankRiflemen)) return null;
  if (enemy.squadFlankUntil > now && enemy.squadFlankGoal &&
    Math.hypot(enemy.squadFlankGoal.x - enemy.position.x, enemy.squadFlankGoal.z - enemy.position.z) > .8) {
    return enemy.squadFlankGoal;
  }
  enemy.squadFlankGoal = null;
  if (now < (enemy.squadFlankCooldown || 0)) return null;
  const support = allies.some((ally) => ally !== enemy && ally.squadId === enemy.squadId &&
    ["support", "heavy", "sniper"].includes(ally.role) && ally.attackWindup?.targetId === target.socketId &&
    Math.hypot(ally.position.x - enemy.position.x, ally.position.z - enemy.position.z) <= 18);
  const dx = target.position.x - enemy.position.x, dz = target.position.z - enemy.position.z;
  const distance = Math.hypot(dx, dz);
  if (!support || distance < 4) return null;
  const side = Number(enemy.id) % 2 ? 1 : -1;
  const offset = Math.min(4, distance * .35);
  const goal = groundedPosition(room.geometry || room.mapId, {
    ...target.position, x: target.position.x - dz / distance * offset * side,
    z: target.position.z + dx / distance * offset * side
  }, 1);
  if (!canOccupyPosition(room.geometry || room.mapId, goal, ENEMY_RADIUS)) return null;
  enemy.squadFlankGoal = goal;
  enemy.squadFlankUntil = now + 1800;
  enemy.squadFlankCooldown = now + 6000;
  return goal;
}

export function enemyCallout(room, enemy, kind, now) {
  if (!Object.hasOwn(ENEMY_CALLOUTS, kind) || !enemy.role ||
    now < (room.nextCalloutAt || 0) || now < (enemy.nextCalloutAt || 0) ||
    enemy.calloutKind === kind && now < (enemy.repeatCalloutAt || 0)) return;
  room.callouts ||= [];
  room.nextCalloutId ||= 1;
  room.callouts.push({ id: room.nextCalloutId++, enemyId: enemy.id, role: enemy.role,
    kind, position: { ...enemy.position }, at: now, expiresAt: now + 3200 });
  room.callouts = room.callouts.slice(-4);
  room.nextCalloutAt = now + 1200;
  enemy.nextCalloutAt = now + 4500;
  enemy.calloutKind = kind;
  enemy.repeatCalloutAt = now + 10000;
}

export function chooseEnemyCover(mapId, enemy, threat, allies = []) {
  let best = null, bestDistance = Infinity;
  for (const obstacle of getMapObstacles(mapId)) {
    if (Math.hypot(obstacle.x - enemy.position.x, obstacle.z - enemy.position.z) > 12) continue;
    const cos = Math.cos(obstacle.rotation), sin = Math.sin(obstacle.rotation);
    for (const [x, z] of [[obstacle.width / 2 + .85, 0], [-obstacle.width / 2 - .85, 0],
      [0, obstacle.depth / 2 + .85], [0, -obstacle.depth / 2 - .85]]) {
      const candidate = groundedPosition(mapId, {
        x: obstacle.x + x * cos + z * sin, y: enemy.position.y,
        z: obstacle.z - x * sin + z * cos
      }, 1);
      const distance = Math.hypot(candidate.x - enemy.position.x, candidate.z - enemy.position.z);
      if (distance >= bestDistance || !canOccupyPosition(mapId, candidate, ENEMY_RADIUS) ||
        allies.some((ally) => ally !== enemy && ally.coverGoal &&
          Math.hypot(ally.coverGoal.x - candidate.x, ally.coverGoal.z - candidate.z) < 1.6) ||
        hasLineOfSight(mapId, { ...candidate, y: candidate.y + .25 }, { ...threat, y: threat.y - .45 })) continue;
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

export function enemySearchGoal(mapId, enemy, now) {
  if (enemy.searchGoal && (now >= enemy.searchUntil ||
    Math.hypot(enemy.searchGoal.x - enemy.position.x, enemy.searchGoal.z - enemy.position.z) < 1.2)) {
    enemy.searchGoal = null;
    enemy.searchIndex = (enemy.searchIndex || 0) + 1;
  }
  if (!enemy.searchGoal) {
    const buildings = [...getMapBuildings(mapId)].sort((a, b) =>
      Math.hypot(a.x - enemy.position.x, a.z - enemy.position.z) -
      Math.hypot(b.x - enemy.position.x, b.z - enemy.position.z));
    const building = buildings[(enemy.searchIndex || 0) % (buildings.length + 1)];
    const angle = Number(enemy.id) * 2.399963 + (enemy.searchIndex || 0) * .7;
    enemy.searchGoal = groundedPosition(mapId, building || {
      x: Math.cos(angle) * 8, y: 1, z: 8 + Math.sin(angle) * 8
    }, 1);
    enemy.searchUntil = now + 14000;
  }
  return enemy.searchGoal;
}

export function coordinatedApproach(mapId, enemy, target, allies) {
  const support = allies.some((ally) => ally !== enemy && ally.type === "sentinel" &&
    ally.targetId === target.socketId && ally.attackWindup);
  if (!support || enemy.type === "sentinel" || enemy.type === "brute") return target.position;
  const dx = target.position.x - enemy.position.x, dz = target.position.z - enemy.position.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 4) return target.position;
  const side = Number(enemy.id) % 2 ? 1 : -1;
  const offset = Math.min(4, distance * .3);
  const approach = { ...target.position, x: target.position.x - dz / distance * offset * side,
    z: target.position.z + dx / distance * offset * side };
  return canOccupyPosition(mapId, approach, ENEMY_RADIUS) ? approach : target.position;
}

export function sentinelStep(mapId, enemy, target, distance, step) {
  if (distance <= 1e-6) return enemy.position;
  const nx = (target.x - enemy.position.x) / distance;
  const nz = (target.z - enemy.position.z) / distance;
  const retreat = distance < SENTINEL_ATTACK_RANGE * .35;
  const side = Number(enemy.id) % 2 ? 1 : -1;
  for (const direction of [side, -side]) {
    const candidate = {
      ...enemy.position,
      x: enemy.position.x + (retreat ? -nx : -nz * direction) * step,
      z: enemy.position.z + (retreat ? -nz : nx * direction) * step
    };
    if (canWalkTerrain(mapId, enemy.position, candidate, ENEMY_RADIUS)) return groundedPosition(mapId, candidate, 1);
  }
  return enemy.position;
}
