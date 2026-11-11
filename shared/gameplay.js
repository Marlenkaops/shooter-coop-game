import { WEAPONS } from "./weapons.js";
import { buildingWalls, getMapTerrain, getTerraceBuildings, getTerrainHeight, rayTerrainHit } from "./arena-layout.js";

export const PLAYER_MAX_HEALTH = 100;
export const MAX_MEDKITS = 3;
export const MEDKIT_HEAL = 50;
export const STARTING_MEDKITS = 1;
export const FLIGHT_SPEED = 6;
export const FLIGHT_CEILING = 9.5;
export const MAG_SIZE = WEAPONS.rifle.magSize;
export const RESPAWN_MS = 4000;
export const ARENA_LIMIT = 42;
export const PLAYER_RADIUS = 0.46;
export const PLAYER_HEIGHT = 1.7;
export const PLAYER_WALK_SPEED = 4.2;
export const PLAYER_SPRINT_SPEED = 6.4;
export const PLAYER_CROUCH_SPEED = 2.1;
export const PLAYER_MAX_MOVE_SPEED = 6.9;
const standingStance = Object.freeze({ height: 1.74, eyeHeight: 1.57, eyeOffset: .7 });
const crouchedStance = Object.freeze({ height: 1.18, eyeHeight: 1, eyeOffset: .41 });
export const playerStance = (crouching = false) => crouching ? crouchedStance : standingStance;
export const ENEMY_RADIUS = 0.56;
export const ENEMY_ACCELERATION = 12;
export const ENEMY_ATTACK_RANGE = 1.85;
export const ENEMY_WINDUP_MS = 420;
export const SKIRMISHER_WINDUP_MS = 340;
export const SENTINEL_ATTACK_RANGE = 11;
export const SENTINEL_WINDUP_MS = 900;
export const SPAWN_PROTECTION_MS = 1800;
export const RELOAD_MS = WEAPONS.rifle.reloadMs;
export const TACTICAL_RELOAD_MS = WEAPONS.rifle.tacticalReloadMs;
export const BODY_DAMAGE = WEAPONS.rifle.bodyDamage;
export const HEADSHOT_DAMAGE = WEAPONS.rifle.headDamage;

const MAP_SEEDS = { foundry: 7319, tundra: 1847, void: 9923 };
const AUTHORED_LAYOUTS = {
  wickfall: [
    [-24, -25, 9, 8, 4.2, 0, "bunker"], [24, -25, 9, 8, 4.2, 0, "bunker"],
    [-24, 25, 9, 7, 3.6, 0, "bunker"], [24, 25, 9, 7, 3.6, 0, "bunker"],
    [-11, -23, 3, 5, 2.2, .22, "grave"], [11, -23, 3, 5, 2.2, -.22, "grave"],
    [-13, -7, 3, 7, 1.6, -.35, "grave"], [13, -7, 3, 7, 1.6, .35, "grave"],
    [-15, 11, 3, 7, 1.8, .35, "grave"], [15, 11, 3, 7, 1.8, -.35, "grave"],
    [-10, 26, 5, 2, 1.5, 0, "grave"], [10, 26, 5, 2, 1.5, 0, "grave"],
    [0, -23, 5, 4, 3.2, 0, "lantern"],
    [-25, 3, 3, 3, 1.3, 0, "crate"], [25, 3, 3, 3, 1.3, 0, "crate"],
    [0, 29, 6, 2, 1.3, 0, "barrier"]
  ],
  range: [
    [-19, -11, 1, 52, 3.5, 0, "barrier"], [19, -11, 1, 52, 3.5, 0, "barrier"],
    [0, -37, 39, 1, 4, 0, "barrier"],
    [-12, 21, 4, 1, 1, 0, "crate"], [-4, 21, 4, 1, 1, 0, "crate"],
    [4, 21, 4, 1, 1, 0, "crate"], [12, 21, 4, 1, 1, 0, "crate"]
  ],
  spillway: [
    [-25, -23, 8, 9, 4, 0, "generator"], [25, -23, 8, 9, 4, 0, "generator"],
    [-25, 23, 8, 9, 4, 0, "bunker"], [25, 23, 8, 9, 4, 0, "bunker"],
    [-12, -16, 10, 2, 2, -.55, "barrier"], [12, -12, 10, 2, 2, .55, "barrier"],
    [-12, 1, 9, 2, 1.7, .55, "barrier"], [12, 2, 9, 2, 1.7, -.55, "barrier"],
    [-16, 17, 6, 2, 1.5, -.45, "barrier"], [16, 17, 6, 2, 1.5, .45, "barrier"],
    [0, -28, 5, 4, 2.8, 0, "generator"], [0, -6, 4, 3, 1.4, 0, "crate"],
    [-29, 0, 3, 5, 1.5, 0, "crate"], [29, 0, 3, 5, 1.5, 0, "crate"],
    [0, 28, 5, 2, 1.4, 0, "sandbag"]
  ],
  depot: [
    [-24, -23, 3, 13, 3, 0, "container"], [-24, 1, 3, 13, 3, 0, "container"],
    [-24, 24, 3, 10, 3, 0, "container"], [24, -24, 3, 10, 3, 0, "container"],
    [24, -1, 3, 13, 3, 0, "container"], [24, 23, 3, 13, 3, 0, "container"],
    [-8, -22, 9, 3, 2.7, 0, "container"], [8, 23, 9, 3, 2.7, 0, "container"],
    [-10, -5, 4, 4, 1.5, 0, "crate"], [10, -5, 4, 4, 1.5, 0, "crate"],
    [-13, 17, 4, 3, 1.5, 0, "crate"], [13, 17, 4, 3, 1.5, 0, "crate"],
    [0, -10, 5, 3, 2.5, 0, "generator"],
    [-32, -13, 2, 5, 1.4, 0, "barrier"], [32, 13, 2, 5, 1.4, 0, "barrier"],
    [0, -32, 8, 2, 1.4, 0, "barrier"]
  ],
  harbor: [
    [-25, -23, 12, 2.8, 2.8, 0, "container"],
    [-7, -23, 12, 2.8, 2.8, 0, "container"],
    [14, -23, 12, 2.8, 2.8, 0, "container"],
    [26, -11, 2.8, 13, 2.8, 0, "container"],
    [-24, -5, 2.8, 13, 2.8, 0, "container"],
    [-9, -7, 11, 2.8, 2.8, 0, "container"],
    [9, -5, 10, 2.8, 2.8, 0, "container"],
    [-18, 21, 12, 2.8, 2.8, 0, "container"],
    [16, 23, 14, 2.8, 2.8, 0, "container"],
    [25, 9, 2.8, 8, 2.8, 0, "container"],
    [-21, 9, 10, 2.8, 2.8, 0, "container"],
    [10, 5, 4, 3, 1.4, 0, "crate"],
    [-9, 3, 4, 3, 1.4, 0, "crate"],
    [2, -14, 3.2, 4, 1.4, 0, "crate"],
    [-31, 25, 4, 4, 2, 0, "crate"],
    [30, 28, 4, 4, 2, 0, "crate"],
    [-27, -31, 6, 2, 1.5, 0, "barrier"],
    [14, -33, 7, 2, 1.5, 0, "barrier"]
  ],
  airfield: [
    [-25, -20, 10, 13, 4.2, 0, "bunker"], [25, -20, 10, 13, 4.2, 0, "bunker"],
    [-25, 22, 10, 9, 3.4, 0, "bunker"], [25, 22, 10, 9, 3.4, 0, "bunker"],
    [-11, -24, 2, 10, 2.1, 0, "barrier"], [11, -12, 2, 10, 2.1, 0, "barrier"],
    [-11, 0, 2, 9, 2.1, 0, "barrier"], [11, 16, 2, 9, 2.1, 0, "barrier"],
    [0, -28, 4, 3, 1.3, 0, "crate"], [0, -5, 3, 4, 1.7, 0, "generator"],
    [-26, 2, 4, 3, 1.5, 0, "crate"], [26, 3, 4, 3, 1.5, 0, "crate"],
    [-16, 30, 5, 2, 1.2, 0, "barrier"], [16, -32, 5, 2, 1.2, 0, "barrier"],
    [0, 28, 5, 2, 1.2, 0, "sandbag"]
  ],
  citadel: [
    [-25, -24, 10, 8, 4.5, 0, "bunker"], [25, -24, 10, 8, 4.5, 0, "bunker"],
    [-25, 24, 10, 8, 4.5, 0, "bunker"], [25, 24, 10, 8, 4.5, 0, "bunker"],
    [0, -14, 7, 7, 3.8, 0, "generator"],
    [-13, -6, 9, 2, 2.2, .5, "barrier"], [13, -6, 9, 2, 2.2, -.5, "barrier"],
    [-15, 15, 9, 2, 1.5, -.4, "sandbag"], [15, 15, 9, 2, 1.5, .4, "sandbag"],
    [-30, 0, 2, 9, 2.5, 0, "barrier"], [30, 0, 2, 9, 2.5, 0, "barrier"],
    [0, -31, 10, 2, 1.5, 0, "sandbag"], [0, 29, 8, 2, 1.5, 0, "sandbag"],
    [-12, -23, 3, 3, 1.4, 0, "crate"], [12, -23, 3, 3, 1.4, 0, "crate"],
    [-9, 1, 3, 3, 1.4, 0, "crate"], [9, 1, 3, 3, 1.4, 0, "crate"]
  ],
  outpost: [
    [0, -18, 8, 10, 4.4, 0, "bunker"],
    [-23, -12, 9, 14, 3.2, 0, "bunker"],
    [23, -12, 9, 14, 3.2, 0, "bunker"],
    [-23, 20, 10, 7, 3.2, 0, "bunker"],
    [23, 20, 10, 7, 3.2, 0, "bunker"],
    [-12, 2, 7, 1.6, 1.5, -0.2, "sandbag"],
    [12, 2, 7, 1.6, 1.5, 0.2, "sandbag"],
    [-10, -9, 5, 1.6, 1.5, 0.1, "sandbag"],
    [10, -9, 5, 1.6, 1.5, -0.1, "sandbag"],
    [0, -3, 2.8, 5, 2.5, 0, "generator"],
    [-28, -29, 8, 2, 1.5, 0, "sandbag"],
    [0, -32, 12, 1.6, 1.5, 0, "sandbag"],
    [28, -29, 8, 2, 1.5, 0, "sandbag"],
    [-31, 4, 2, 8, 1.5, 0, "barrier"],
    [31, 4, 2, 8, 1.5, 0, "barrier"],
    [-12, -23, 3, 3, 1.5, 0, "crate"],
    [12, -23, 3, 3, 1.5, 0, "crate"],
    [-12, 26, 4, 3, 1.5, 0, "crate"],
    [12, 26, 4, 3, 1.5, 0, "crate"],
    [0, 28, 6, 1.6, 1.5, 0, "sandbag"]
  ]
};
const obstacleCache = new Map();
const buildingCache = new Map();
const obstacleRotation = new WeakMap();

function randomForMap(mapId) {
  let seed = MAP_SEEDS[mapId] || MAP_SEEDS.foundry;
  return () => {
    seed = Math.imul(seed ^ seed >>> 15, seed | 1);
    seed ^= seed + Math.imul(seed ^ seed >>> 7, seed | 61);
    return ((seed ^ seed >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic cover descriptors consumed by both Cannon/Three and the server.
 * Keeping these as primitive boxes makes collision cheap and identical everywhere.
 */
export function getMapObstacles(mapId = "foundry") {
  if (typeof mapId === "object") return mapId.obstacles;
  if (obstacleCache.has(mapId)) return obstacleCache.get(mapId);
  const random = randomForMap(mapId);
  const authored = AUTHORED_LAYOUTS[mapId];
  const obstacles = authored ? authored.map(([x, z, width, depth, height, rotation, kind], index) => ({
    id: `${mapId}-${kind}-${index}`, x, z, width, depth, height, rotation, kind
  })) : [];
  const count = authored ? 0 : mapId === "void" ? 22 : 26;
  for (let i = 0; i < count; i++) {
    const ring = i % 2 ? 29 : 18;
    const angle = (i / count) * Math.PI * 2 + (random() - 0.5) * 0.18;
    const width = 2.2 + random() * (mapId === "foundry" ? 3.2 : 2.2);
    const depth = 1.8 + random() * 2.2;
    obstacles.push({
      id: `${mapId}-${i}`,
      x: Math.cos(angle) * ring,
      z: Math.sin(angle) * ring,
      width,
      depth,
      height: 1.8 + random() * (mapId === "void" ? 5.2 : 2.8),
      rotation: angle + (random() - 0.5) * 1.2
    });
  }
  // Deliberately arranged central cover gives every spawn a protected route.
  if (!authored) obstacles.push(
    { id: `${mapId}-center-a`, x: -6, z: 0, width: 7, depth: 2.2, height: 2.4, rotation: 0.22 },
    { id: `${mapId}-center-b`, x: 6, z: 0, width: 7, depth: 2.2, height: 2.4, rotation: -0.22 },
    { id: `${mapId}-center-c`, x: 0, z: -9, width: 2.4, depth: 6, height: 3.1, rotation: 0 }
  );
  const buildings = [
    ...obstacles.filter((obstacle) => obstacle.kind === "bunker").map((obstacle) => ({ ...obstacle, base: 0, kind: "building" })),
    ...getTerraceBuildings(mapId)
  ];
  const cover = obstacles.filter((obstacle) => obstacle.kind !== "bunker" &&
    !getTerraceBuildings(mapId).some((building) =>
      Math.abs(obstacle.x - building.x) < (obstacle.width + 10) / 2 + 1 &&
      Math.abs(obstacle.z) < (obstacle.depth + 36) / 2));
  const result = [...cover.map((obstacle) => ({ ...obstacle,
    base: getTerrainHeight(mapId, obstacle.x, obstacle.z) })), ...buildings.flatMap(buildingWalls)];
  buildingCache.set(mapId, Object.freeze(buildings.map(Object.freeze)));
  for (const obstacle of result) {
    obstacleRotation.set(obstacle, {
      cos: Math.cos(obstacle.rotation), sin: Math.sin(obstacle.rotation)
    });
    Object.freeze(obstacle);
  }
  const cached = Object.freeze(result);
  obstacleCache.set(mapId, cached);
  return cached;
}

export function getMapBuildings(mapId = "foundry") {
  if (typeof mapId === "object") mapId = mapId.mapId;
  getMapObstacles(mapId);
  return buildingCache.get(mapId);
}

export function positionHitsObstacle(position, obstacle, radius = PLAYER_RADIUS) {
  const { cos, sin } = obstacleRotation.get(obstacle) || {
    cos: Math.cos(obstacle.rotation), sin: Math.sin(obstacle.rotation)
  };
  const dx = position.x - obstacle.x;
  const dz = position.z - obstacle.z;
  const localX = dx * cos - dz * sin;
  const localZ = dx * sin + dz * cos;
  const closestX = Math.max(-obstacle.width / 2, Math.min(obstacle.width / 2, localX));
  const closestZ = Math.max(-obstacle.depth / 2, Math.min(obstacle.depth / 2, localZ));
  return (localX - closestX) ** 2 + (localZ - closestZ) ** 2 < radius ** 2;
}

export function canOccupyPosition(mapId, position, radius = PLAYER_RADIUS, crouching = false) {
  if (!validPosition(position, radius)) return false;
  const stance = playerStance(crouching);
  return !getMapObstacles(mapId).some((obstacle) =>
    position.y + stance.height - stance.eyeHeight + .08 > (obstacle.base || 0) + .05 &&
    position.y - stance.eyeHeight < (obstacle.base || 0) + obstacle.height - .08 &&
    positionHitsObstacle(position, obstacle, radius));
}

export function canTraverse(mapId, from, to, radius = PLAYER_RADIUS, crouching = false) {
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  const steps = Math.max(1, Math.ceil(Math.max(distance, Math.abs(to.y - from.y)) / Math.max(0.2, radius * 0.5)));
  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    const position = {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
      z: from.z + (to.z - from.z) * t
    };
    const floor = getTerrainHeight(mapId, position.x, position.z);
    if (floor > 0 && position.y < floor + (radius === ENEMY_RADIUS ? .75 : playerStance(crouching).eyeHeight - .17)) return false;
    if (!canOccupyPosition(mapId, position, radius, crouching)) return false;
  }
  return true;
}

export function hasLineOfSight(mapId, from, to) {
  const delta = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  const distance = Math.hypot(delta.x, delta.y, delta.z);
  if (distance < 1e-6) return true;
  const direction = { x: delta.x / distance, y: delta.y / distance, z: delta.z / distance };
  const hit = mapRayHit(mapId, from, direction, distance);
  return hit === null || hit >= distance - .05;
}

export function mapRayHit(mapId, origin, direction, maxDistance = 100) {
  let closest = null;
  for (const obstacle of getMapObstacles(mapId)) {
    const hit = rayObstacleHit(origin, direction, obstacle, maxDistance);
    if (hit !== null && (closest === null || hit < closest)) closest = hit;
  }
  for (const surface of getMapTerrain(mapId)) {
    const hit = rayTerrainHit(origin, direction, surface, maxDistance);
    if (hit !== null && (closest === null || hit < closest)) closest = hit;
  }
  if (direction.y < -1e-8) {
    const floor = -origin.y / direction.y;
    if (floor >= 0 && floor <= maxDistance && (closest === null || floor < closest)) closest = floor;
  }
  return closest;
}

export function groundedPosition(mapId, position, offset = PLAYER_HEIGHT) {
  return { ...position, y: getTerrainHeight(mapId, position.x, position.z) + offset };
}

export function getSupportHeight(mapId, position) {
  let height = getTerrainHeight(mapId, position.x, position.z);
  for (const obstacle of getMapObstacles(mapId)) {
    const top = (obstacle.base || 0) + obstacle.height;
    if (top > height && top <= position.y + .08 && positionHitsObstacle(position, obstacle, 1e-6)) height = top;
  }
  return height;
}

export function chooseEnemyStep(mapId, from, target, maxStep, radius = ENEMY_RADIUS) {
  const waypoint = canWalkTerrain(mapId, from, target, radius) ? target : navigationWaypoint(mapId, from, target);
  if (!waypoint) return { ...from };
  target = waypoint;
  const dx = target.x - from.x;
  const dz = target.z - from.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 1e-6 || maxStep <= 0) return { ...from };
  const step = Math.min(maxStep, distance);
  const nx = dx / distance;
  const nz = dz / distance;
  const origin = groundedPosition(mapId, from);
  const direct = groundedPosition(mapId, { x: from.x + nx * step, z: from.z + nz * step });
  if (canWalkTerrain(mapId, origin, direct, radius)) return { ...direct, y: direct.y - .7 };
  const directions = [
    [nx, 0],
    [0, nz],
    [nx * Math.SQRT1_2 - nz * Math.SQRT1_2, nx * Math.SQRT1_2 + nz * Math.SQRT1_2],
    [nx * Math.SQRT1_2 + nz * Math.SQRT1_2, -nx * Math.SQRT1_2 + nz * Math.SQRT1_2],
    [-nz, nx],
    [nz, -nx]
  ];
  let best = null;
  for (const [candidateX, candidateZ] of directions) {
    const length = Math.hypot(candidateX, candidateZ);
    if (length < 1e-6) continue;
    const directionX = candidateX / length;
    const directionZ = candidateZ / length;
    const progress = directionX * nx + directionZ * nz;
    if (progress <= 0.01) continue;
    const candidate = groundedPosition(mapId, {
      x: from.x + directionX * step,
      z: from.z + directionZ * step
    });
    if (!canWalkTerrain(mapId, origin, candidate, radius)) continue;
    const remaining = Math.hypot(target.x - candidate.x, target.z - candidate.z);
    const score = distance - remaining;
    if (!best || score > best.score + 1e-8) best = { position: { ...candidate, y: candidate.y - .7 }, score };
  }
  return best?.position || { ...from };
}

const navigationCache = new WeakMap();
const routeCache = new WeakMap();

function navigationGraph(mapId) {
  const geometry = getMapObstacles(mapId);
  if (navigationCache.has(geometry)) return navigationCache.get(geometry);
  if (typeof mapId === "object") {
    const base = navigationGraph(mapId.mapId), nodes = new Map();
    const props = geometry.filter((obstacle) => obstacle.destructible);
    const overlay = { mapId: mapId.mapId, obstacles: props };
    const bounds = props.map((prop) => {
      const cos = Math.abs(Math.cos(prop.rotation)), sin = Math.abs(Math.sin(prop.rotation));
      const x = (cos * prop.width + sin * prop.depth) / 2 + ENEMY_RADIUS;
      const z = (sin * prop.width + cos * prop.depth) / 2 + ENEMY_RADIUS;
      return { minX: prop.x - x, maxX: prop.x + x, minZ: prop.z - z, maxZ: prop.z + z };
    });
    for (const [key, node] of base) if (canOccupyPosition(overlay, node.position, ENEMY_RADIUS)) {
      nodes.set(key, { position: node.position, links: [] });
    }
    for (const [key, node] of base) {
      const current = nodes.get(key);
      if (!current) continue;
      for (const neighbor of node.links) {
        const next = nodes.get(`${neighbor.position.x},${neighbor.position.z}`);
        if (!next) continue;
        const a = current.position, b = next.position;
        const affected = bounds.some((box) => Math.max(a.x, b.x) >= box.minX && Math.min(a.x, b.x) <= box.maxX &&
          Math.max(a.z, b.z) >= box.minZ && Math.min(a.z, b.z) <= box.maxZ);
        if (!affected || canWalkTerrain(overlay, a, b, ENEMY_RADIUS)) current.links.push(next);
      }
    }
    navigationCache.set(geometry, nodes);
    return nodes;
  }
  const nodes = new Map();
  for (let x = -40; x <= 40; x += 2) for (let z = -40; z <= 40; z += 2) {
    const position = groundedPosition(mapId, { x, z });
    if (canOccupyPosition(mapId, position, ENEMY_RADIUS)) nodes.set(`${x},${z}`, { position, links: [] });
  }
  for (const node of nodes.values()) for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
    const neighbor = nodes.get(`${node.position.x + dx},${node.position.z + dz}`);
    if (neighbor && canWalkTerrain(mapId, node.position, neighbor.position, ENEMY_RADIUS)) node.links.push(neighbor);
  }
  navigationCache.set(geometry, nodes);
  return nodes;
}

function nearbyNodes(mapId, position, nodes) {
  const x = Math.round(position.x / 2) * 2, z = Math.round(position.z / 2) * 2;
  const candidates = [];
  for (let dx = -2; dx <= 2; dx += 2) for (let dz = -2; dz <= 2; dz += 2) {
    const node = nodes.get(`${x + dx},${z + dz}`);
    if (node && canWalkTerrain(mapId, position, node.position, ENEMY_RADIUS)) candidates.push(node);
  }
  return candidates.sort((a, b) =>
    Math.hypot(a.position.x - position.x, a.position.z - position.z) -
    Math.hypot(b.position.x - position.x, b.position.z - position.z));
}

function navigationWaypoint(mapId, from, target) {
  const nodes = navigationGraph(mapId), goal = nearbyNodes(mapId, target, nodes)[0];
  if (!goal) return null;
  const key = `${goal.position.x},${goal.position.z}`;
  if (!routeCache.has(nodes)) routeCache.set(nodes, new Map());
  const routes = routeCache.get(nodes);
  let distances = routes.get(key);
  if (!distances) {
    distances = new Map([[goal, 0]]);
    const queue = [goal];
    for (let index = 0; index < queue.length; index++) for (const neighbor of queue[index].links) {
      if (!distances.has(neighbor)) { distances.set(neighbor, distances.get(queue[index]) + 2); queue.push(neighbor); }
    }
    if (routes.size >= 32) routes.delete(routes.keys().next().value);
    routes.set(key, distances);
  }
  let best = null, score = Infinity;
  for (const node of nearbyNodes(mapId, from, nodes)) {
    const remaining = distances.get(node);
    if (remaining === undefined) continue;
    const distance = Math.hypot(node.position.x - from.x, node.position.z - from.z);
    if (distance < .2) continue;
    if (remaining + distance < score) { best = node.position; score = remaining + distance; }
  }
  return best;
}

export function canWalkTerrain(mapId, from, to, radius = PLAYER_RADIUS) {
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  const steps = Math.max(1, Math.ceil(distance / .2));
  let previous = getTerrainHeight(mapId, from.x, from.z);
  for (let step = 1; step <= steps; step++) {
    const t = step / steps, position = groundedPosition(mapId, {
      x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t
    });
    if (Math.abs(position.y - PLAYER_HEIGHT - previous) > .2 ||
      !canOccupyPosition(mapId, position, radius)) return false;
    previous = position.y - PLAYER_HEIGHT;
  }
  return true;
}

export function rayObstacleHit(origin, direction, obstacle, maxDistance = 100) {
  const { cos, sin } = obstacleRotation.get(obstacle) || {
    cos: Math.cos(obstacle.rotation), sin: Math.sin(obstacle.rotation)
  };
  const dx = origin.x - obstacle.x;
  const dz = origin.z - obstacle.z;
  const localOrigin = {
    x: dx * cos - dz * sin,
    y: origin.y - (obstacle.base || 0) - obstacle.height / 2,
    z: dx * sin + dz * cos
  };
  const localDirection = {
    x: direction.x * cos - direction.z * sin,
    y: direction.y,
    z: direction.x * sin + direction.z * cos
  };
  const half = { x: obstacle.width / 2, y: obstacle.height / 2, z: obstacle.depth / 2 };
  let near = 0;
  let far = maxDistance;
  for (const axis of ["x", "y", "z"]) {
    if (Math.abs(localDirection[axis]) < 1e-8) {
      if (Math.abs(localOrigin[axis]) > half[axis]) return null;
      continue;
    }
    let t1 = (-half[axis] - localOrigin[axis]) / localDirection[axis];
    let t2 = (half[axis] - localOrigin[axis]) / localDirection[axis];
    if (t1 > t2) [t1, t2] = [t2, t1];
    near = Math.max(near, t1);
    far = Math.min(far, t2);
    if (near > far) return null;
  }
  return near <= maxDistance ? near : null;
}

export function waveEnemyCount(wave, playerCount) {
  return 3 + Math.max(1, playerCount) * 2 + Math.max(0, wave - 1) * 2;
}

export function enemyStats(wave) {
  return {
    health: 45 + wave * 12,
    speed: Math.min(5.2, 2 + wave * 0.16),
    damage: Math.min(28, 8 + wave * 1.2)
  };
}

export function raySphereHit(origin, direction, center, radius = 1) {
  const ox = center.x - origin.x;
  const oy = center.y - origin.y;
  const oz = center.z - origin.z;
  const projection = ox * direction.x + oy * direction.y + oz * direction.z;
  if (projection < 0 || projection > 100) return null;
  const distanceSq = ox * ox + oy * oy + oz * oz - projection * projection;
  if (distanceSq > radius * radius) return null;
  return projection - Math.sqrt(Math.max(0, radius * radius - distanceSq));
}

export function validPosition(position, radius = 0) {
  if (!position || !["x", "y", "z"].every((key) => Number.isFinite(position[key]))) return false;
  return Math.abs(position.x) <= ARENA_LIMIT - radius && Math.abs(position.z) <= ARENA_LIMIT - radius &&
    position.y >= 0 && position.y <= 10;
}

export function xpForMatch(wave, kills, won) {
  return Math.max(0, wave * 45 + kills * 12 + (won ? 100 : 0));
}
