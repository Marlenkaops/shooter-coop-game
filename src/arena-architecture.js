import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ARENA_LIMIT, getMapObstacles } from "../shared/gameplay.js";

const THEMES = Object.freeze({
  foundry: { wall: 0x7d8178, steel: 0x36434a, paint: 0xb77b50, panel: 0xd1ba8b, ground: 0x655b50 },
  tundra: { wall: 0x8cabb1, steel: 0x385562, paint: 0x577a8d, panel: 0xe4eeed, ground: 0x778b91 },
  void: { wall: 0x5e596e, steel: 0x292c3c, paint: 0x9c81be, panel: 0xa2c8ce, ground: 0x474351 },
  harbor: { wall: 0x6d8283, steel: 0x344c55, paint: 0xc19a58, panel: 0xcbd6cf, ground: 0x50676b },
  outpost: { wall: 0xb7a17b, steel: 0x635b48, paint: 0x9b6949, panel: 0xe0cba6, ground: 0x9d7958 },
  airfield: { wall: 0x8c9b9e, steel: 0x3e515d, paint: 0x678e9d, panel: 0xd8ded5, ground: 0x687a80 },
  citadel: { wall: 0xa39989, steel: 0x454c48, paint: 0x987250, panel: 0xd9c8a4, ground: 0x7e7669 },
  spillway: { wall: 0x829c96, steel: 0x354f50, paint: 0x5a9390, panel: 0xc1dad0, ground: 0x5e7772 },
  depot: { wall: 0x977d66, steel: 0x454c48, paint: 0xa96242, panel: 0xdac6a0, ground: 0x78604c },
  range: { wall: 0x92a083, steel: 0x46584e, paint: 0x72875f, panel: 0xdce1c4, ground: 0x6c7d61 }
});
for (const theme of Object.values(THEMES)) Object.freeze(theme);

function gableGeometry() {
  const vertices = [[-.5, 0, -.5], [.5, 0, -.5], [.5, 0, .5], [-.5, 0, .5], [0, 1, -.5], [0, 1, .5]];
  const triangles = [[0, 4, 1], [3, 2, 5], [0, 3, 5], [0, 5, 4], [1, 4, 5], [1, 5, 2], [0, 1, 2], [0, 2, 3]];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(triangles.flatMap((face) => face.flatMap((index) => vertices[index])), 3));
  geometry.computeVertexNormals();
  return geometry;
}

function mountainGeometry(compact) {
  const steps = compact ? 4 : 7, points = [], positions = [];
  let peak = 0;
  for (let row = 0; row <= steps; row++) for (let column = 0; column <= steps; column++) {
    const x = column / steps * 2 - 1, z = row / steps * 2 - 1;
    const edge = Math.max(0, 1 - Math.max(Math.abs(x), Math.abs(z)) ** 1.4);
    const ridge = Math.exp(-((x + .25) ** 2 * 7 + (z - .1) ** 2 * 3)) +
      .65 * Math.exp(-((x - .4) ** 2 * 12 + (z + .2) ** 2 * 9));
    const y = edge * ridge * (.88 + Math.sin(x * 11 + z * 13) * .12);
    peak = Math.max(peak, y);
    points.push([x, y, z]);
  }
  for (const point of points) point[1] /= peak;
  for (let row = 0; row < steps; row++) for (let column = 0; column < steps; column++) {
    const a = row * (steps + 1) + column, b = a + 1, c = a + steps + 1, d = c + 1;
    for (const index of [a, c, b, b, c, d]) positions.push(...points[index]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function batch(primitives, outside = false) {
  const geometries = [], spans = [], pose = new THREE.Object3D();
  let vertices = 0;
  return {
    spans,
    add(kind, color, position, scale, rotation = [0, 0, 0], owner = null, summit = null) {
      const source = primitives[kind], geometry = source.index ? source.toNonIndexed() : source.clone();
      pose.position.set(...position); pose.scale.set(...scale); pose.rotation.set(...rotation); pose.updateMatrix();
      geometry.applyMatrix4(pose.matrix);
      geometry.computeBoundingBox();
      const bounds = geometry.boundingBox;
      if (outside && !(bounds.max.x < -ARENA_LIMIT - 2 || bounds.min.x > ARENA_LIMIT + 2 ||
        bounds.max.z < -ARENA_LIMIT - 2 || bounds.min.z > ARENA_LIMIT + 2)) {
        geometry.dispose();
        throw new RangeError("Arena background enters the playable area.");
      }
      const count = geometry.attributes.position.count, tint = new THREE.Color(color);
      const snow = summit === null ? null : new THREE.Color(summit);
      const colors = new Float32Array(count * 3);
      for (let index = 0; index < count; index++) {
        const shade = geometry.attributes.normal.getY(index) > .5 ? 1.06 : .96;
        const tone = snow && (geometry.attributes.position.getY(index) - position[1]) / scale[1] > .67 ? snow : tint;
        colors.set([tone.r * shade, tone.g * shade, tone.b * shade], index * 3);
      }
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geometry.deleteAttribute("uv");
      spans.push({ owner, start: vertices, end: vertices + count, bounds: bounds.clone() });
      vertices += count;
      geometries.push(geometry);
    },
    finish(name, material, shadows) {
      const geometry = mergeGeometries(geometries);
      geometries.forEach((item) => item.dispose());
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      mesh.receiveShadow = shadows;
      return mesh;
    }
  };
}

export function addArenaArchitecture(scene, mapId, { detail = 2, shadows = false } = {}) {
  if (!Object.hasOwn(THEMES, mapId)) throw new RangeError(`Unknown arena architecture: ${mapId}`);
  if (!Number.isInteger(detail) || detail < 0 || detail > 3) throw new RangeError("Invalid architecture detail.");
  const theme = THEMES[mapId], compact = detail < 2;
  const primitives = {
    box: new THREE.BoxGeometry(1, 1, 1),
    plane: new THREE.PlaneGeometry(1, 1),
    cylinder: new THREE.CylinderGeometry(1, 1, 1, compact ? 8 : 12),
    cone: new THREE.ConeGeometry(1, 1, compact ? 6 : 8),
    dome: new THREE.IcosahedronGeometry(1, compact ? 0 : 1),
    ring: new THREE.TorusGeometry(1, .055, 4, compact ? 20 : 32, Math.PI * 1.62),
    roof: gableGeometry(),
    mountain: mountainGeometry(compact)
  };
  const skyline = batch(primitives, true), cover = batch(primitives);
  const box = (color, x, y, z, width, height, depth, rotation = [0, 0, 0]) =>
    skyline.add("box", color, [x, y, z], [width, height, depth], rotation);
  const cylinder = (color, x, y, z, radius, height, rotation = [0, 0, 0]) =>
    skyline.add("cylinder", color, [x, y, z], [radius, height, radius], rotation);
  const roof = (color, x, y, z, width, height, depth) =>
    skyline.add("roof", color, [x, y, z], [width, height, depth]);
  function windows(x, y, z, count, spacing, width = 1.4) {
    for (let index = 0; index < count; index++) box(theme.panel, x + (index - (count - 1) / 2) * spacing, y, z, width, .75, .035);
  }
  function mountain(x, z, width, height, depth, snow = false) {
    skyline.add("mountain", theme.ground, [x, -3, z], [width, height, depth], [0, 0, 0], null, snow ? theme.panel : null);
  }
  function warehouse(x, z, width, height, depth) {
    box(theme.wall, x, height / 2, z, width, height, depth);
    roof(theme.steel, x, height, z, width + .5, height * .3, depth + .5);
    box(theme.steel, x, height * .35, z + depth / 2 + .02, width * .7, height * .64, .04);
    windows(x, height * .82, z + depth / 2 + .04, compact ? 3 : 5, width / 6);
  }

  if (!["harbor", "outpost"].includes(mapId)) {
    const ground = mapId === "tundra" ? theme.panel : theme.ground;
    for (const side of [-1, 1]) {
      box(ground, side * 77, -.16, 0, 65.98, .2, 220);
      box(mapId === "spillway" && side === -1 ? theme.paint : ground, 0, -.16, side * 77, 88.02, .2, 65.98);
    }
  }
  if (mapId === "foundry") {
    warehouse(0, -74, 56, 13, 18);
    for (const x of [-21, 19]) {
      cylinder(theme.steel, x, 20, -77, 2.3, 40);
      for (const y of [10, 23, 35]) cylinder(theme.paint, x, y, -77, 2.38, .65);
      cylinder(theme.steel, x, 40.3, -77, 2.7, .7);
    }
    cylinder(theme.paint, 0, 18, -62, .8, 44, [0, 0, Math.PI / 2]);
    for (const x of [-62, 62]) {
      warehouse(x, 6, 16, 8, 26);
      for (const z of [-17, 26]) cylinder(theme.wall, x, 7, z, 4.5, 14);
    }
  } else if (mapId === "tundra") {
    mountain(-30, -85, 30, 48, 25, true);
    mountain(26, -88, 34, 57, 28, true);
    mountain(-79, 10, 24, 36, 36, true);
    mountain(80, 14, 25, 43, 36, true);
    for (const x of [-25, -19]) for (const z of [-64, -58]) box(theme.steel, x, 9, z, .45, 18, .45);
    for (const y of [5, 10, 15]) box(theme.paint, -22, y, -61, 7, .22, 7);
    box(theme.steel, -22, 18, -61, 9, .7, 9);
    skyline.add("dome", theme.panel, [-22, 23, -61], [4.3, 4.3, 4.3]);
    warehouse(61, 0, 15, 7, 20);
  } else if (mapId === "void") {
    skyline.add("ring", theme.paint, [0, 18, -67], [17, 17, 17], [0, 0, .35]);
    skyline.add("ring", theme.panel, [0, 18, -67], [15.7, 15.7, 15.7], [0, 0, .35]);
    for (const side of [-1, 1]) {
      box(theme.steel, side * 23, 12, -70, 7, 24, 10, [0, side * .2, side * -.06]);
      for (const y of [7, 14, 21]) box(theme.paint, side * 23, y, -64, 4.8, .25, .08);
      mountain(side * 76, 8, 20, 32, 32);
    }
    warehouse(0, -86, 54, 7, 16);
  } else if (mapId === "harbor") {
    box(theme.steel, 0, 4, -84, 76, 8, 15);
    box(theme.paint, 0, 8.15, -84, 77, .35, 15.5);
    for (let index = 0; index < (compact ? 5 : 10); index++) {
      box(index % 2 ? theme.wall : theme.paint, -26 + index % 5 * 10, 10.5 + Math.floor(index / 5) * 4.5,
        -84, 9.5, 4.3, 10);
    }
    box(theme.wall, 28, 16, -84, 12, 16, 12);
    windows(28, 21, -77.96, 4, 2, 1.6);
    cylinder(theme.steel, 28, 29, -84, .15, 12);
    box(theme.panel, 28, 32, -84, 9, .16, .16);
    warehouse(-67, 12, 18, 12, 34);
    box(theme.ground, -67, -.5, 12, 23, 1, 39);
  } else if (mapId === "outpost") {
    mountain(-28, -86, 31, 32, 26);
    mountain(31, -88, 34, 40, 28);
    box(theme.ground, -77, 10, 0, 24, 20, 94);
    box(theme.wall, -77, 20.5, 0, 25, 1, 94);
    mountain(82, 20, 28, 31, 39);
    warehouse(63, -32, 17, 6, 20);
    for (const x of [57, 63, 69]) cylinder(theme.panel, x, 8, -32, 1.1, 3);
  } else if (mapId === "airfield") {
    for (const x of [-27, 27]) {
      warehouse(x, -78, 28, 12, 24);
      box(theme.panel, x, 8.9, -65.96, 23, .2, .06);
    }
    box(theme.steel, 0, 5, -91, 28, 10, 17);
    for (const x of [-69, 69]) {
      box(theme.wall, x, 8, 10, 18, 16, 28);
      box(theme.steel, x, 16.3, 10, 19, .6, 29);
      for (const z of [1, 8, 15, 22]) box(theme.panel, x + (x < 0 ? 9.03 : -9.03), 12, z, .04, 1.4, 3.4);
    }
  } else if (mapId === "citadel") {
    box(theme.wall, 0, 9, -78, 80, 18, 16);
    box(theme.steel, 0, 6, -69.96, 15, 12, .06);
    for (const x of [-31, 31]) {
      box(theme.wall, x, 17, -76, 12, 34, 16);
      box(theme.steel, x, 33, -76, 13, .6, 17);
      windows(x, 28, -67.96, 3, 2.4, .8);
    }
    for (let index = 0; index < (compact ? 7 : 13); index++) {
      box(theme.paint, -36 + index * (compact ? 12 : 6), 19, -72, 2, 2.2, 3);
    }
    mountain(-81, 8, 26, 34, 42);
    mountain(81, 8, 26, 40, 42);
  } else if (mapId === "spillway") {
    box(theme.wall, 0, 18, -81, 94, 36, 11);
    for (const x of [-42, -21, 0, 21, 42]) {
      box(theme.steel, x, 19, -74, 5, 38, 6);
      box(theme.paint, x, 39, -74, 7, 2, 8);
    }
    for (const x of [-31.5, -10.5, 10.5, 31.5]) {
      box(theme.paint, x, 13, -75.4, 10, 25, .15);
      for (let index = 0; index < (compact ? 2 : 4); index++) {
        box(theme.panel, x - 3 + index * (compact ? 6 : 2), 13, -75.29, .16, 24, .04);
      }
    }
    box(theme.steel, 0, 40, -74, 94, .4, .4);
    mountain(-81, 15, 28, 32, 44);
    mountain(82, 10, 28, 37, 40);
  } else if (mapId === "depot") {
    warehouse(0, -79, 66, 12, 22);
    box(theme.wall, 0, 22, -73, 7, 24, 7);
    roof(theme.steel, 0, 34, -73, 8, 5, 8);
    cylinder(theme.panel, 0, 29, -69.45, 2, .08, [Math.PI / 2, 0, 0]);
    box(theme.steel, .55, 29.35, -69.37, 1.5, .13, .04, [0, 0, .58]);
    box(theme.steel, -.34, 28.5, -69.34, .15, 1.2, .04, [0, 0, -.58]);
    for (const x of [-63, 63]) {
      box(theme.paint, x, 3, 8, 5, 6, 56);
      for (let index = 0; index < (compact ? 4 : 8); index++) box(theme.steel, x, 1.1, -16 + index * (compact ? 14 : 7), 5.2, .5, 1);
    }
  } else {
    warehouse(0, -66, 38, 7, 16);
    for (let index = 0; index < (compact ? 8 : 16); index++) {
      const side = index % 2 ? -1 : 1, z = -32 + Math.floor(index / 2) * 10;
      const x = side * (58 + index % 3 * 3);
      cylinder(theme.steel, x, 3.5, z, .35, 7);
      for (let tier = 0; tier < 3; tier++) skyline.add("cone", theme.paint, [x, 6.5 + tier * 2, z],
        [3.7 - tier * .7, 6, 3.7 - tier * .7]);
    }
  }

  const digits = ["abcdef", "bc", "abdeg", "abcdg", "bcfg", "acdfg", "acdefg", "abc", "abcdefg", "abcdfg"];
  const segments = {
    a: [0, .13, .15, .025], b: [.075, .065, .025, .13], c: [.075, -.065, .025, .13],
    d: [0, -.13, .15, .025], e: [-.075, -.065, .025, .13], f: [-.075, .065, .025, .13], g: [0, 0, .15, .025]
  };
  for (const [index, obstacle] of getMapObstacles(mapId).entries()) {
    if (["roof", "furniture", "sandbag"].includes(obstacle.kind) || obstacle.height < .85 ||
      Math.min(obstacle.width, obstacle.depth) < .35) continue;
    const height = obstacle.height, base = obstacle.base || 0, yaw = obstacle.rotation;
    const local = (color, x, y, z, width, h, depth) => {
      cover.add("box", color, [obstacle.x + Math.cos(yaw) * x + Math.sin(yaw) * z, base + y,
        obstacle.z - Math.sin(yaw) * x + Math.cos(yaw) * z], [width, h, depth], [0, yaw, 0], obstacle.id);
    };
    const label = (color, x, y, side, width, h, offset) => {
      const z = side * (obstacle.depth / 2 + offset);
      cover.add("plane", color, [obstacle.x + Math.cos(yaw) * x + Math.sin(yaw) * z, base + y,
        obstacle.z - Math.sin(yaw) * x + Math.cos(yaw) * z], [width, h, 1],
      [0, yaw + (side < 0 ? Math.PI : 0), 0], obstacle.id);
    };
    for (const side of [-1, 1]) {
      const width = Math.min(2.4, obstacle.width * .74), y = Math.min(height * .53, 1.3);
      label(theme.paint, 0, y, side, width, Math.min(.82, height * .46), .003);
      const scale = Math.min(1, width / 1.1);
      for (const [place, digit] of String(index + 1).padStart(2, "0").slice(-2).split("").entries()) {
        for (const segment of digits[Number(digit)]) {
          const [x, dy, w, h] = segments[segment];
          label(theme.panel, side * ((place - .5) * .24 + x) * scale, y + dy * scale, side, w * scale, h * scale, .006);
        }
      }
      if (!compact) for (const end of [-1, 1]) {
        label(theme.steel, end * width * .43, y, side, .035, Math.min(.42, height * .3), .006);
      }
      local(theme.steel, 0, .12, side * (obstacle.depth / 2 - .025), obstacle.width - .08, .11, .05);
      if (!compact) for (const x of [-1, 1]) {
        local(theme.steel, x * (obstacle.width / 2 - .045), height / 2,
          side * (obstacle.depth / 2 - .045), .07, height - .08, .07);
      }
    }
  }
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  const meshes = [skyline.finish("arena-landmarks", material, shadows), cover.finish("arena-cover-panels", material, shadows)];
  const root = new THREE.Group();
  root.name = `architecture-${mapId}`;
  root.add(...meshes);
  scene.add(root);
  for (const geometry of Object.values(primitives)) geometry.dispose();
  return { root, meshes, skylineParts: skyline.spans, coverParts: cover.spans };
}
