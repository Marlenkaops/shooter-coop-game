import { ARENA_LIMIT, getMapObstacles, rayObstacleHit } from "../shared/gameplay.js";
import { getMapTerrain, rayTerrainHit } from "../shared/arena-layout.js";

export const BLOOD_GRAVITY = 9.81;
export const BLOOD_STEP = 1 / 120;
const floorY = .006;
const point = (x = 0, y = 0, z = 0) => ({ x, y, z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export function bloodSegmentHit(from, to, obstacles = [], terrain = []) {
  const length = distance(from, to);
  if (length < 1e-9) return null;
  const direction = point((to.x - from.x) / length, (to.y - from.y) / length, (to.z - from.z) / length);
  let closest = null;
  const plane = (value, axis, normal, surface) => {
    if (Math.abs(direction[axis]) < 1e-9) return;
    const travel = (value - from[axis]) / direction[axis];
    if (travel < -1e-6 || travel > length || (closest && travel >= closest.distance)) return;
    const position = point(from.x + direction.x * travel, from.y + direction.y * travel, from.z + direction.z * travel);
    if (surface !== "floor" && (position.y < 0 || position.y > 5)) return;
    closest = { position, normal, distance: Math.max(0, travel), surface, obstacle: null };
  };
  if (to.y <= floorY && direction.y < 0) plane(floorY, "y", point(0, 1, 0), "floor");
  if (to.x >= ARENA_LIMIT) plane(ARENA_LIMIT, "x", point(-1, 0, 0), "wall-x+");
  if (to.x <= -ARENA_LIMIT) plane(-ARENA_LIMIT, "x", point(1, 0, 0), "wall-x-");
  if (to.z >= ARENA_LIMIT) plane(ARENA_LIMIT, "z", point(0, 0, -1), "wall-z+");
  if (to.z <= -ARENA_LIMIT) plane(-ARENA_LIMIT, "z", point(0, 0, 1), "wall-z-");
  for (const obstacle of obstacles) {
    const travel = rayObstacleHit(from, direction, obstacle, length);
    if (travel === null || (closest && travel >= closest.distance)) continue;
    const position = point(from.x + direction.x * travel, from.y + direction.y * travel, from.z + direction.z * travel);
    const cos = Math.cos(obstacle.rotation), sin = Math.sin(obstacle.rotation);
    // Same frame as Three.js rotation.y and the shared collision helpers.
    const x = (position.x - obstacle.x) * cos - (position.z - obstacle.z) * sin;
    const z = (position.x - obstacle.x) * sin + (position.z - obstacle.z) * cos;
    const faces = [
      { gap: Math.abs(Math.abs(x) - obstacle.width / 2), normal: point(Math.sign(x) || 1, 0, 0) },
      { gap: Math.abs(Math.abs(z) - obstacle.depth / 2), normal: point(0, 0, Math.sign(z) || 1) },
      { gap: Math.abs(position.y - (obstacle.base || 0) - obstacle.height), normal: point(0, 1, 0) },
      { gap: Math.abs(position.y - (obstacle.base || 0)), normal: point(0, -1, 0) }
    ];
    const local = faces.reduce((best, face) => face.gap < best.gap ? face : best).normal;
    const normal = point(local.x * cos + local.z * sin, local.y, -local.x * sin + local.z * cos);
    closest = { position, normal, distance: travel, surface: `${obstacle.id}:${local.x}:${local.y}:${local.z}`, obstacle };
  }
  for (const surface of terrain) {
    const travel = rayTerrainHit(from, direction, surface, length);
    if (travel === null || (closest && travel >= closest.distance)) continue;
    const position = point(from.x + direction.x * travel, from.y + direction.y * travel, from.z + direction.z * travel);
    const faces = [
      { gap: Math.abs(position.y - surface.height - (position.z - surface.z) * surface.slope),
        normal: point(0, 1 / Math.hypot(1, surface.slope), -surface.slope / Math.hypot(1, surface.slope)) },
      { gap: Math.abs(Math.abs(position.x - surface.x) - surface.width / 2), normal: point(Math.sign(position.x - surface.x), 0, 0) },
      { gap: Math.abs(Math.abs(position.z - surface.z) - surface.depth / 2), normal: point(0, 0, Math.sign(position.z - surface.z)) }
    ];
    const normal = faces.reduce((best, face) => face.gap < best.gap ? face : best).normal;
    closest = { position, normal, distance: travel, surface: surface.id, obstacle: null };
  }
  return closest;
}

export function createBloodSimulation({ mapId = "foundry", compact = false, random = Math.random, obstacles, geometry } = {}) {
  let cover = obstacles ?? getMapObstacles(geometry?.() || mapId);
  const terrain = obstacles ? [] : getMapTerrain(mapId);
  const droplets = Array.from({ length: compact ? 72 : 240 }, () => ({
    active: false, position: point(), velocity: point(), radius: 0, life: 0
  }));
  const stains = Array.from({ length: compact ? 48 : 128 }, () => ({
    active: false, position: point(), normal: point(), radius: 0, age: 0, opacity: 0, surface: "", obstacle: null
  }));
  let nextDrop = 0, nextStain = 0, accumulator = 0;
  function drop(position, velocity, radius) {
    const particle = droplets[nextDrop++ % droplets.length];
    Object.assign(particle.position, position);
    Object.assign(particle.velocity, velocity);
    particle.radius = radius;
    particle.life = 1.8;
    particle.active = true;
  }
  function impact(particle, hit) {
    let stain = stains.find((candidate) => candidate.active && candidate.age < 12 &&
      candidate.surface === hit.surface && dot(candidate.normal, hit.normal) > .995 &&
      distance(candidate.position, hit.position) < .05);
    const velocity = particle.velocity;
    const radius = Math.min(.085, particle.radius * 3.5 + Math.hypot(velocity.x, velocity.y, velocity.z) * .002);
    if (stain) {
      stain.radius = Math.min(.14, Math.sqrt(stain.radius ** 2 + radius ** 2 * .45));
      stain.age = Math.max(0, stain.age - .4);
    } else {
      stain = stains[nextStain++ % stains.length];
      Object.assign(stain.position, hit.position);
      Object.assign(stain.normal, hit.normal);
      Object.assign(stain, { active: true, radius, age: 0, opacity: 1, surface: hit.surface, obstacle: hit.obstacle });
    }
  }
  function emit(position, normal, { headshot = false, killed = false } = {}) {
    if (![position.x, position.y, position.z, normal.x, normal.y, normal.z].every(Number.isFinite)) {
      throw new RangeError("Blood emission requires finite position and direction");
    }
    const length = Math.hypot(normal.x, normal.y, normal.z);
    if (length < 1e-9) throw new RangeError("Blood emission requires a surface normal");
    const unit = point(normal.x / length, normal.y / length, normal.z / length);
    const count = compact ? (killed ? 15 : 9) : killed ? 32 : headshot ? 24 : 18;
    for (let index = 0; index < count; index++) {
      const speed = .6 + random() * 2.1;
      drop(point(position.x + unit.x * .012, Math.max(.02, position.y + unit.y * .012), position.z + unit.z * .012),
        point(unit.x * speed + (random() - .5) * 1.8,
          unit.y * speed + .4 + random() * 1.4, unit.z * speed + (random() - .5) * 1.8),
        .003 + random() * .005);
    }
  }
  function update(delta) {
    if (!Number.isFinite(delta) || delta < 0) throw new RangeError("Blood timestep must be non-negative and finite");
    const currentCover = obstacles ?? getMapObstacles(geometry?.() || mapId);
    if (cover !== currentCover) {
      cover = currentCover;
      for (const stain of stains) if (stain.obstacle && !cover.includes(stain.obstacle)) stain.active = false;
    }
    accumulator += Math.min(.1, delta);
    while (accumulator + 1e-9 >= BLOOD_STEP) {
      accumulator -= BLOOD_STEP;
      for (const particle of droplets) {
        if (!particle.active) continue;
        const from = particle.position, velocity = particle.velocity;
        const drag = Math.exp(-BLOOD_STEP * 1.1);
        const next = point(from.x + velocity.x * BLOOD_STEP,
          from.y + velocity.y * BLOOD_STEP - .5 * BLOOD_GRAVITY * BLOOD_STEP ** 2,
          from.z + velocity.z * BLOOD_STEP);
        const hit = bloodSegmentHit(from, next, cover, terrain);
        particle.life -= BLOOD_STEP;
        if (hit) {
          impact(particle, hit);
          particle.active = false;
        } else {
          Object.assign(from, next);
          velocity.x *= drag; velocity.y = (velocity.y - BLOOD_GRAVITY * BLOOD_STEP) * drag; velocity.z *= drag;
          if (particle.life <= 0 || from.y < -.05 || Math.abs(from.x) > ARENA_LIMIT + 1 ||
            Math.abs(from.z) > ARENA_LIMIT + 1) particle.active = false;
        }
      }
      for (const stain of stains) {
        if (!stain.active) continue;
        stain.age += BLOOD_STEP;
        if (Math.abs(stain.normal.y) < .25 && stain.age < 4) {
          const bottom = stain.radius + .01;
          stain.position.y = Math.max(bottom, stain.position.y - .045 * BLOOD_STEP * Math.exp(-stain.age * .4));
        }
        stain.opacity = Math.min(1, Math.max(0, (45 - stain.age) / 6));
        if (stain.age >= 45) stain.active = false;
      }
    }
  }
  function clear() {
    droplets.forEach((particle) => { particle.active = false; });
    stains.forEach((stain) => { stain.active = false; });
    accumulator = nextDrop = nextStain = 0;
  }
  return { droplets, stains, emit, update, clear };
}
