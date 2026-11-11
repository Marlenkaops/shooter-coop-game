import { canOccupyPosition, getMapObstacles, rayObstacleHit } from "./gameplay.js";
import { getTerrainHeight } from "./arena-layout.js";
import { damageForHit } from "./weapons.js";

const catalog = new Map();
export const PROP_HEALTH = 80;
export const MAX_DESTRUCTIBLES = 6;
export function destructibleLayout(mapId) {
  if (catalog.has(mapId)) return catalog.get(mapId);
  const props = [];
  if (mapId !== "range") for (const [x, z] of [[-8, 16], [8, 16], [-18, 10], [18, 10], [-9, -17], [9, -17], [-20, -14], [20, -14], [-8, 28], [8, 28]]) {
    if (props.length >= MAX_DESTRUCTIBLES) break;
    const base = getTerrainHeight(mapId, x, z);
    if ([-1, 1].some((dx) => [-1, 1].some((dz) =>
      Math.abs(getTerrainHeight(mapId, x + dx, z + dz) - base) > .05))) continue;
    if (!canOccupyPosition(mapId, { x, y: base + 1.57, z }, 1.8)) continue;
    props.push(Object.freeze({ id: `prop-${props.length}`, x, z, base, width: 1.6, depth: 1.2, height: 1.9,
      rotation: props.length % 2 ? .18 : -.18, kind: props.length === 1 ? "generator" : "crate", destructible: true }));
  }
  const result = Object.freeze(props);
  catalog.set(mapId, result);
  return result;
}
export const createDestructibles = (mapId) => destructibleLayout(mapId).map(({ id }) => ({ id, health: PROP_HEALTH }));
export function geometryForProps(mapId, states) {
  const layout = destructibleLayout(mapId);
  if (!Array.isArray(states) || states.length !== layout.length || states.some((state, index) =>
    state.id !== layout[index].id || !Number.isInteger(state.health) || state.health < 0 || state.health > PROP_HEALTH)) {
    throw new Error("Invalid authoritative prop snapshot.");
  }
  return Object.freeze({ mapId, obstacles: Object.freeze([...getMapObstacles(mapId),
    ...layout.filter((_, index) => states[index].health > 0)]) });
}
export function propAtRay(room, origin, direction, distance) {
  return destructibleLayout(room.mapId).find((prop, index) => room.props[index].health > 0 &&
    Math.abs((rayObstacleHit(origin, direction, prop) ?? Infinity) - distance) < 1e-6)?.id;
}
export function damageProps(room, rays, weaponId) {
  const damage = new Map();
  for (const ray of rays) if (ray.propId) damage.set(ray.propId,
    (damage.get(ray.propId) || 0) + damageForHit(weaponId, "body", ray.distance));
  let changed = false;
  for (const [id, amount] of damage) {
    const prop = room.props.find((state) => state.id === id);
    if (!prop?.health) continue;
    prop.health = Math.max(0, prop.health - Math.round(amount));
    changed ||= prop.health === 0;
  }
  if (changed) {
    room.geometry = geometryForProps(room.mapId, room.props);
    for (const enemy of room.enemies.values()) { enemy.coverGoal = null; enemy.coverUntil = 0; }
  }
}
