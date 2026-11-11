import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ARENA_LIMIT, getMapBuildings, getMapObstacles, positionHitsObstacle } from "../shared/gameplay.js";
import { getMapTerrain, getTerrainHeight } from "../shared/arena-layout.js";
import { RANGE_LANES } from "../shared/practice.js";

// Small, non-colliding ground dressing. Everything stays below ankle height so it
// never disagrees with the authoritative server collision boxes.
const THEMES = Object.freeze({
  wickfall: { rocks: 0x747669, bricks: 0x6e6257, grass: 0x657747, litter: 0xd1ae70, casings: .6, stains: 0x303e35, cracks: 0x434d42, motes: { kind: "spores", color: 0xa2e9ba } },
  range: { rocks: 0x8b887d, grass: 0x6f7f46, litter: 0xd9d1b9, casings: 1.6, stains: 0x4a4a3d, cracks: 0x55554a, motes: { kind: "pollen", color: 0xf4efcf } },
  foundry: { rocks: 0x6e6a63, bricks: 0x7a5d4c, scrap: 0x5d5249, litter: 0x8d7f69, casings: 1, stains: 0x1c1b19, cracks: 0x2c2b28, scorch: 0x191714, motes: { kind: "embers", color: 0xffb37a } },
  tundra: { rocks: 0x6f7f84, grass: 0xb4b195, drifts: 0xeef6f7, casings: .6, stains: 0x9fb4b8, cracks: 0x86aebb, motes: { kind: "snow", color: 0xffffff } },
  void: { rocks: 0x3f3c48, crystals: 0x9d83c9, casings: .6, stains: 0x231f2b, cracks: 0x6f5a99, motes: { kind: "spores", color: 0xc6a8ff } },
  harbor: { rocks: 0x5f6766, coils: 0x9a8259, scrap: 0x6d5444, litter: 0xb9b4a2, casings: .8, stains: 0x2a3436, tracks: 0x25292a },
  outpost: { rocks: 0xa58e6c, grass: 0xa59a62, litter: 0xc8b48f, casings: 1, stains: 0x7d6446, tracks: 0x6b563d, motes: { kind: "dust", color: 0xe7cf9f } },
  airfield: { rocks: 0x7c8285, scrap: 0x5c6266, litter: 0xc9cdc9, casings: .8, stains: 0x2b2d2c, cracks: 0x3a3d3d, tracks: 0x222424, motes: { kind: "dust", color: 0xdfe3e2 } },
  citadel: { rocks: 0x8f877d, bricks: 0x9a7a62, grass: 0x7e7f52, litter: 0xbdae95, casings: 1, cracks: 0x4c463f, scorch: 0x211d19, motes: { kind: "dust", color: 0xe6cdb2 } },
  spillway: { rocks: 0x6b7470, grass: 0x5a7350, litter: 0xb5b9ae, casings: .8, stains: 0x33413c, cracks: 0x3c4843 },
  depot: { rocks: 0x7e6f60, grass: 0x7c7a4d, scrap: 0x6f4f3d, litter: 0xc2ae8f, casings: 1, stains: 0x2b241f, tracks: 0x3a3026, scorch: 0x221c17, motes: { kind: "dust", color: 0xe0c09a } }
});

const BASE_COUNTS = Object.freeze({
  rocks: 150, rubble: 130, grass: 420, litter: 70, casings: 150, scrap: 60, bricks: 110,
  drifts: 80, crystals: 90, coils: 14, stains: 38, cracks: 34, tracks: 14, scorch: 12, motes: 150
});
const DETAIL_SCALE = [.25, .55, 1, 1.5];

export function dressingTheme(mapId) {
  if (!Object.hasOwn(THEMES, mapId)) throw new RangeError(`Unknown arena dressing: ${mapId}`);
  return THEMES[mapId];
}

function seeded(text) {
  let seed = 2166136261;
  for (const character of text) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
  return () => {
    seed = Math.imul(seed ^ seed >>> 15, seed | 1);
    seed ^= seed + Math.imul(seed ^ seed >>> 7, seed | 61);
    return ((seed ^ seed >>> 14) >>> 0) / 4294967296;
  };
}

function insideBuilding(building, x, z, margin) {
  const dx = x - building.x, dz = z - building.z, { rotation } = building;
  return Math.abs(Math.cos(rotation) * dx - Math.sin(rotation) * dz) < building.width / 2 + margin &&
    Math.abs(Math.sin(rotation) * dx + Math.cos(rotation) * dz) < building.depth / 2 + margin;
}

export function planArenaDressing(mapId, detail = 2) {
  const theme = dressingTheme(mapId);
  const level = Math.max(0, Math.min(3, Math.round(Number(detail) || 0)));
  const scale = DETAIL_SCALE[level];
  const random = seeded(`${mapId}:dressing`);
  const obstacles = getMapObstacles(mapId).filter((obstacle) => obstacle.kind !== "roof");
  const groundCover = obstacles.filter((obstacle) => obstacle.kind !== "furniture" && obstacle.height > .5 &&
    Math.abs((obstacle.base || 0) - getTerrainHeight(mapId, obstacle.x, obstacle.z)) < .05);
  const buildings = getMapBuildings(mapId);
  const ramps = getMapTerrain(mapId).filter((surface) => surface.slope !== 0);
  const limit = ARENA_LIMIT - 1.4;
  const rangeLane = (x, z) => mapId === "range" && z > -40 && z < 20 &&
    RANGE_LANES.some((lane) => Math.abs(x - lane) < 4);

  const free = (x, z, margin) => {
    if (Math.abs(x) > limit || Math.abs(z) > limit) return false;
    if (obstacles.some((obstacle) => positionHitsObstacle({ x, z }, obstacle, margin))) return false;
    if (buildings.some((building) => insideBuilding(building, x, z, margin + .2))) return false;
    if (ramps.some((surface) => Math.abs(x - surface.x) < surface.width / 2 + .4 &&
      Math.abs(z - surface.z) < surface.depth / 2 + .4)) return false;
    // Keep props off terrace edges where half of them would hang in the air.
    const height = getTerrainHeight(mapId, x, z);
    return [[.5, 0], [-.5, 0], [0, .5], [0, -.5]].every(([ox, oz]) =>
      Math.abs(getTerrainHeight(mapId, x + ox, z + oz) - height) < .02);
  };
  const item = (x, z, extra = {}) => ({
    x, z, y: getTerrainHeight(mapId, x, z), yaw: random() * Math.PI * 2,
    size: .6 + random() * .8, tint: random(), ...extra
  });
  const sameHeight = (x, z, height) => Math.abs(getTerrainHeight(mapId, x, z) - height) < .02;
  // Large decals must lie on one flat surface from end to end.
  const flatAcross = (candidate, length, width) => {
    const ax = Math.sin(candidate.yaw), az = Math.cos(candidate.yaw);
    return [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].every(([along, across]) => {
      const x = candidate.x + ax * along * length + az * across * width;
      const z = candidate.z + az * along * length - ax * across * width;
      return Math.abs(x) < limit && Math.abs(z) < limit && sameHeight(x, z, candidate.y);
    });
  };
  const field = (count, margin, { avoidLanes = false, length = 0, width = length } = {}) => {
    const items = [];
    for (let attempt = 0; items.length < count && attempt < count * 12; attempt++) {
      const x = (random() * 2 - 1) * limit, z = (random() * 2 - 1) * limit;
      if (avoidLanes && rangeLane(x, z)) continue;
      if (!free(x, z, margin)) continue;
      const candidate = item(x, z);
      if (length && !flatAcross(candidate, length, width)) continue;
      items.push(candidate);
    }
    return items;
  };
  // Debris collects along the base of walls, crates and containers.
  const alongCover = (count, reach, margin, extra = () => ({})) => {
    const items = [];
    if (!groundCover.length) return items;
    for (let attempt = 0; items.length < count && attempt < count * 12; attempt++) {
      const obstacle = groundCover[Math.floor(random() * groundCover.length)];
      const side = Math.floor(random() * 4), across = side < 2, sign = side % 2 ? 1 : -1;
      const along = (random() - .5) * (across ? obstacle.width : obstacle.depth);
      const out = (across ? obstacle.depth : obstacle.width) / 2 + margin + random() * reach;
      const lx = across ? along : sign * out, lz = across ? sign * out : along;
      const x = obstacle.x + Math.cos(obstacle.rotation) * lx + Math.sin(obstacle.rotation) * lz;
      const z = obstacle.z - Math.sin(obstacle.rotation) * lx + Math.cos(obstacle.rotation) * lz;
      if (rangeLane(x, z) || !free(x, z, margin * .8)) continue;
      const faceYaw = obstacle.rotation + (across ? 0 : Math.PI / 2);
      items.push(item(x, z, { faceYaw, ...extra(obstacle) }));
    }
    return items;
  };
  const casingClusters = (count) => {
    const items = [];
    if (mapId === "range") {
      for (let index = 0; index < count; index++) {
        const lane = RANGE_LANES[index % RANGE_LANES.length];
        items.push(item(lane + (random() - .5) * 2.6, 14.6 + random() * 1.6));
      }
      return items;
    }
    const anchors = alongCover(Math.max(1, Math.ceil(count / 9)), .9, .45);
    for (let index = 0; items.length < count && index < count * 6; index++) {
      const anchor = anchors[index % anchors.length];
      if (!anchor) break;
      const x = anchor.x + (random() - .5) * 1.1, z = anchor.z + (random() - .5) * 1.1;
      if (!rangeLane(x, z) && free(x, z, .05)) items.push(item(x, z));
    }
    return items;
  };
  const count = (key, multiplier = 1) => Math.round(BASE_COUNTS[key] * scale * multiplier);
  const plan = {
    mapId, detail: level, theme,
    rocks: [...field(count("rocks"), .25, { avoidLanes: true }), ...alongCover(count("rubble"), .7, .12)],
    grass: theme.grass ? [
      ...field(count("grass", .65), .3, { avoidLanes: true }),
      ...alongCover(count("grass", .35), .5, .1)
    ] : [],
    litter: theme.litter ? field(count("litter"), .3, { avoidLanes: true }) : [],
    casings: casingClusters(count("casings", theme.casings)),
    scrap: theme.scrap ? [...field(count("scrap", .5), .35), ...alongCover(count("scrap", .5), .6, .15)] : [],
    bricks: theme.bricks ? alongCover(count("bricks"), 1.1, .12) : [],
    drifts: theme.drifts ? alongCover(count("drifts"), .25, .02) : [],
    crystals: theme.crystals ? [...field(count("crystals", .4), .3), ...alongCover(count("crystals", .6), .5, .1)] : [],
    coils: theme.coils ? alongCover(count("coils"), .4, .3) : [],
    stains: theme.stains ? field(count("stains"), .6, { avoidLanes: true, length: 1.3 }) : [],
    cracks: theme.cracks ? field(count("cracks"), .5, { length: 1 }) : [],
    tracks: theme.tracks ? field(count("tracks"), 1.6, { length: 4.2, width: .9 }) : [],
    scorch: theme.scorch ? field(count("scorch"), .9, { length: 1 }) : [],
    motes: theme.motes && level > 0 ? count("motes") : 0
  };
  return plan;
}

function dataTexture(size, height, paint) {
  const data = new Uint8Array(size * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < size; x++) {
    const [r, g, b, a] = paint(x / (size - 1), y / (height - 1), x, y);
    data.set([r, g, b, a], (y * size + x) * 4);
  }
  const texture = new THREE.DataTexture(data, size, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

const hash = (x, y) => {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
};
const smoothNoise = (x, y) => {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const top = hash(ix, iy) * (1 - sx) + hash(ix + 1, iy) * sx;
  const bottom = hash(ix, iy + 1) * (1 - sx) + hash(ix + 1, iy + 1) * sx;
  return top * (1 - sy) + bottom * sy;
};
const fbm = (x, y) => smoothNoise(x, y) * .55 + smoothNoise(x * 2.3, y * 2.3) * .3 + smoothNoise(x * 5.1, y * 5.1) * .15;

export function dressingTextures() {
  const grass = dataTexture(64, 64, (u, v, px) => {
    let alpha = 0;
    for (let blade = 0; blade < 9; blade++) {
      const root = .08 + blade * .105, lean = (hash(blade, 3) - .5) * .5;
      const top = .45 + hash(blade, 7) * .55;
      const height = 1 - v;
      if (height > top) continue;
      const center = root + lean * height * height;
      const width = .045 * (1 - height / top) + .006;
      if (Math.abs(u - center) < width) alpha = 255;
    }
    const shade = 150 + (1 - v) * 105 + (hash(px, 1) - .5) * 14;
    return [shade, shade, shade, alpha];
  });
  const stain = dataTexture(128, 128, (u, v) => {
    const distance = Math.hypot(u - .5, v - .5) * 2;
    const edge = .62 + fbm(u * 5, v * 5) * .45;
    const alpha = Math.max(0, Math.min(1, (edge - distance) * 3.2)) * (.45 + fbm(u * 11, v * 11) * .55);
    return [255, 255, 255, Math.round(alpha * 210)];
  });
  const crackPaths = [];
  const crackRandom = seeded("cracks");
  for (let branch = 0; branch < 7; branch++) {
    let x = .5 + (crackRandom() - .5) * .2, y = .5 + (crackRandom() - .5) * .2;
    let angle = crackRandom() * Math.PI * 2;
    for (let step = 0; step < 34; step++) {
      angle += (crackRandom() - .5) * .9;
      const next = [x + Math.cos(angle) * .016, y + Math.sin(angle) * .016];
      crackPaths.push([x, y, ...next, 1 - step / 40]);
      [x, y] = next;
    }
  }
  const crack = dataTexture(128, 128, (u, v) => {
    let alpha = 0;
    for (const [x1, y1, x2, y2, weight] of crackPaths) {
      const dx = x2 - x1, dy = y2 - y1;
      const t = Math.max(0, Math.min(1, ((u - x1) * dx + (v - y1) * dy) / (dx * dx + dy * dy)));
      const distance = Math.hypot(u - x1 - dx * t, v - y1 - dy * t);
      alpha = Math.max(alpha, Math.max(0, 1 - distance / (.0045 + weight * .004)) * weight);
    }
    return [255, 255, 255, Math.round(alpha * 235)];
  });
  const track = dataTexture(32, 128, (u, v) => {
    const lane = Math.abs(u - .25) < .17 || Math.abs(u - .75) < .17;
    const lug = (v * 24 + Math.abs(u - .5) * 3) % 1 < .55;
    const fade = Math.min(1, v * 6, (1 - v) * 6) * (.55 + fbm(u * 3, v * 20) * .45);
    return [255, 255, 255, lane ? Math.round((lug ? 190 : 90) * fade) : 0];
  });
  const scorch = dataTexture(128, 128, (u, v) => {
    const dx = u - .5, dy = v - .5, distance = Math.hypot(dx, dy) * 2;
    const rays = .78 + Math.sin(Math.atan2(dy, dx) * 11) * .08 + fbm(u * 6, v * 6) * .3;
    const alpha = Math.max(0, Math.min(1, (rays - distance) * 2.4));
    const core = distance < .28 ? 1 : .75;
    return [255, 255, 255, Math.round(alpha * core * 225)];
  });
  const mote = dataTexture(32, 32, (u, v) => {
    const alpha = Math.max(0, 1 - Math.hypot(u - .5, v - .5) * 2);
    return [255, 255, 255, Math.round(alpha * alpha * 255)];
  });
  return { grass, stain, crack, track, scorch, mote };
}

function rockGeometry() {
  const geometry = new THREE.IcosahedronGeometry(1, 0);
  const position = geometry.attributes.position;
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index), y = position.getY(index), z = position.getZ(index);
    const jitter = .72 + hash(Math.round(x * 9), Math.round(y * 7 + z * 5)) * .5;
    position.setXYZ(index, x * jitter, Math.max(-.25, y * jitter), z * jitter);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function grassGeometry() {
  const blades = [0, Math.PI / 3, Math.PI * 2 / 3].map((angle) => {
    const plane = new THREE.PlaneGeometry(.55, .38, 1, 2);
    plane.translate(0, .19, 0);
    plane.rotateY(angle);
    return plane;
  });
  const geometry = mergeGeometries(blades);
  blades.forEach((plane) => plane.dispose());
  return geometry;
}

const flatPlane = () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

export function addArenaDressing(scene, mapId, { detail = 2, shadows = false, particles = true } = {}) {
  const plan = planArenaDressing(mapId, detail);
  const { theme } = plan;
  const textures = dressingTextures();
  const used = new Set();
  const meshes = [];
  const color = new THREE.Color();
  const time = { value: 0 };
  const transform = new THREE.Object3D();
  const instanced = (geometry, material, items, place, tint = .18) => {
    if (!items.length) { geometry.dispose(); material.dispose(); return null; }
    const mesh = new THREE.InstancedMesh(geometry, material, items.length);
    for (const [index, item] of items.entries()) {
      transform.position.set(item.x, item.y, item.z);
      transform.rotation.set(0, item.yaw, 0);
      transform.scale.setScalar(1);
      place(transform, item, index);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
      color.setScalar(1 - tint + item.tint * tint * 1.6);
      mesh.setColorAt(index, color);
    }
    mesh.computeBoundingSphere();
    mesh.receiveShadow = shadows;
    mesh.userData.dressing = true;
    scene.add(mesh);
    meshes.push(mesh);
    return mesh;
  };
  const solid = (hex, extra = {}) => new THREE.MeshStandardMaterial({ color: hex, roughness: 1, metalness: 0, ...extra });
  const decal = (texture, hex, opacity) => {
    used.add(texture);
    return new THREE.MeshStandardMaterial({
      map: texture, color: hex, transparent: true, opacity, depthWrite: false, roughness: 1, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
    });
  };

  instanced(rockGeometry(), solid(theme.rocks, { flatShading: true }), plan.rocks, (object, item) => {
    const size = item.faceYaw === undefined ? .05 + item.size * .07 : .06 + item.size * .1;
    object.scale.set(size * (1 + item.tint * .6), size * .62, size);
    object.position.y += size * .25;
    object.rotation.set(item.tint * .5, item.yaw, item.size * .3);
  }, .3);

  if (plan.grass.length) {
    used.add(textures.grass);
    const material = solid(theme.grass, { map: textures.grass, alphaTest: .45, side: THREE.DoubleSide });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.dressingTime = time;
      shader.vertexShader = `uniform float dressingTime;\n${shader.vertexShader}`.replace("#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float dressingPhase = instanceMatrix[3].x * .37 + instanceMatrix[3].z * .23;
        #else
          float dressingPhase = 0.0;
        #endif
        float dressingSway = sin(dressingTime * 1.6 + dressingPhase) * .5 + sin(dressingTime * 2.7 + dressingPhase * 1.7) * .25;
        transformed.x += dressingSway * .07 * position.y / .38;
        transformed.z += dressingSway * .035 * position.y / .38;`);
    };
    instanced(grassGeometry(), material, plan.grass, (object, item) => {
      const size = .55 + item.size * .55;
      object.scale.set(size, size * (.8 + item.tint * .5), size);
    }, .35);
  }

  instanced(new THREE.PlaneGeometry(.21, .29).rotateX(-Math.PI / 2), solid(theme.litter ?? 0xffffff, { side: THREE.DoubleSide }),
    plan.litter, (object, item) => {
      object.position.y += .006 + item.tint * .004;
      object.rotation.set((item.tint - .5) * .12, item.yaw, (item.size - 1) * .1);
      object.scale.setScalar(.7 + item.size * .55);
    }, .25);

  instanced(new THREE.CylinderGeometry(.0055, .0055, .03, 6).rotateZ(Math.PI / 2),
    solid(0xb48d4c), plan.casings, (object) => { object.position.y += .006; }, .3);

  instanced(new THREE.BoxGeometry(1, .012, 1), solid(theme.scrap ?? 0xffffff), plan.scrap, (object, item) => {
    object.scale.set(.16 + item.size * .3, 1, .1 + item.tint * .28);
    object.position.y += .008;
    object.rotation.set((item.tint - .5) * .14, item.yaw, (item.size - 1) * .08);
  }, .3);

  instanced(new THREE.BoxGeometry(.21, .065, .1), solid(theme.bricks ?? 0xffffff), plan.bricks, (object, item) => {
    object.position.y += .03;
    object.rotation.set((item.tint - .5) * .5, item.yaw, (item.size - 1) * .4);
    object.scale.setScalar(.7 + item.size * .4);
  }, .35);

  instanced(new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), solid(theme.drifts ?? 0xffffff),
    plan.drifts, (object, item) => {
      object.rotation.set(0, item.faceYaw ?? item.yaw, 0);
      object.scale.set(.6 + item.size * .8, .1 + item.tint * .16, .28 + item.tint * .22);
    }, .06);

  instanced(new THREE.OctahedronGeometry(1, 0), solid(theme.crystals ?? 0xffffff, {
    emissive: theme.crystals ?? 0, emissiveIntensity: .35, flatShading: true
  }), plan.crystals, (object, item) => {
    const size = .04 + item.size * .07;
    object.scale.set(size * .55, size * 1.8, size * .55);
    object.position.y += size * .9;
    object.rotation.set((item.tint - .5) * .8, item.yaw, (item.size - 1) * .6);
  }, .25);

  instanced(new THREE.TorusGeometry(.17, .028, 5, 16).rotateX(Math.PI / 2), solid(theme.coils ?? 0xffffff),
    plan.coils, (object, item) => {
      object.position.y += .028;
      object.scale.set(1, 1 + item.tint * 1.2, 1);
    }, .2);

  const flat = (items, texture, hex, opacity, size, aspect = 1) => instanced(flatPlane(),
    decal(texture, hex ?? 0xffffff, opacity), items, (object, item) => {
      const scale = size[0] + item.size * size[1];
      object.position.y += .014 + item.tint * .004;
      object.scale.set(scale, 1, scale * aspect);
    }, .2);
  flat(plan.stains, textures.stain, theme.stains, .55, [.9, 1.6]);
  flat(plan.cracks, textures.crack, theme.cracks, .7, [.8, 1.1]);
  flat(plan.tracks, textures.track, theme.tracks, .5, [.9, .25], 7);
  flat(plan.scorch, textures.scorch, theme.scorch, .75, [.9, .9]);
  for (const mesh of meshes) mesh.renderOrder = mesh.material.transparent ? 1 : 0;

  let motes = null;
  const moteCount = particles ? plan.motes : 0;
  if (moteCount) {
    used.add(textures.mote);
    const radius = 11, positions = new Float32Array(moteCount * 3), phases = new Float32Array(moteCount);
    const random = seeded(`${mapId}:motes`);
    for (let index = 0; index < moteCount; index++) {
      positions.set([(random() * 2 - 1) * radius, random() * 7 + .2, (random() * 2 - 1) * radius], index * 3);
      phases[index] = random() * Math.PI * 2;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const kind = theme.motes.kind;
    motes = new THREE.Points(geometry, new THREE.PointsMaterial({
      map: textures.mote, color: theme.motes.color, transparent: true, depthWrite: false,
      size: kind === "snow" ? .07 : kind === "embers" ? .05 : .035,
      opacity: kind === "embers" ? .8 : kind === "snow" ? .75 : .45,
      blending: kind === "embers" ? THREE.AdditiveBlending : THREE.NormalBlending
    }));
    motes.frustumCulled = false;
    motes.userData = { radius, positions, phases, kind, centered: false };
    scene.add(motes);
  }
  for (const texture of Object.values(textures)) if (!used.has(texture)) texture.dispose();

  return {
    plan, meshes, motes,
    update(dt, cameraPosition) {
      time.value += dt;
      if (!motes || !cameraPosition) return;
      const { radius, positions, phases, kind } = motes.userData;
      const fall = kind === "snow" ? -.55 : kind === "embers" ? .42 : kind === "spores" ? .06 : .03;
      const drift = kind === "dust" ? .45 : kind === "snow" ? .25 : .12;
      for (let index = 0; index < phases.length; index++) {
        const base = index * 3, phase = phases[index] + time.value * .7;
        if (!motes.userData.centered) {
          positions[base] += cameraPosition.x;
          positions[base + 2] += cameraPosition.z;
        }
        positions[base] += (drift + Math.sin(phase) * .12) * dt;
        positions[base + 1] += (fall + Math.cos(phase * 1.3) * .05) * dt;
        positions[base + 2] += Math.cos(phase * .8) * .1 * dt;
        for (const axis of [0, 2]) {
          const offset = positions[base + axis] - (axis ? cameraPosition.z : cameraPosition.x);
          if (offset > radius) positions[base + axis] -= radius * 2;
          else if (offset < -radius) positions[base + axis] += radius * 2;
        }
        const ground = cameraPosition.y - 2.2;
        if (positions[base + 1] < ground) positions[base + 1] += 8;
        else if (positions[base + 1] > ground + 8.4) positions[base + 1] -= 8;
      }
      motes.userData.centered = true;
      motes.geometry.attributes.position.needsUpdate = true;
    }
  };
}
