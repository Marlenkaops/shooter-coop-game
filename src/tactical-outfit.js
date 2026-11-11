import * as THREE from "three";
import { sceneLook } from "./scene-look.js";

let camouflage, weave, clothDetail;

export function winterTacticalPalette(mapId, variant) {
  const look = sceneLook(mapId);
  const tint = (color, snow, amount) => new THREE.Color(color).lerp(new THREE.Color(snow), amount).getHex();
  return {
    uniform: tint(look.soldiers[variant], 0xd8dedb, .82),
    gear: tint(look.equipment[variant], 0x9caeaa, .75),
    yoke: 0x40565b, trim: 0x7c8987, mask: 0xd4dad4,
    dark: 0x293c40, rubber: 0x59615c, glove: 0xa0afaa, lens: 0x22647a
  };
}

function noise(x, y) {
  let hash = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967295;
}

function patchNoise(x, y, cells) {
  const u = x / 128 * cells, v = y / 128 * cells;
  const cellX = Math.floor(u), cellY = Math.floor(v);
  const ease = (value) => value * value * (3 - 2 * value);
  const a = ease(u - cellX), b = ease(v - cellY);
  const value = (dx, dy) => noise((cellX + dx) % cells, (cellY + dy) % cells);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(value(0, 0), value(1, 0), a),
    THREE.MathUtils.lerp(value(0, 1), value(1, 1), a), b);
}

export function tacticalClothTexture(patterned = true) {
  if (patterned ? camouflage : weave) return patterned ? camouflage : weave;
  const size = 128, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const patch = patchNoise(x, y, 8) * .55 + patchNoise(x, y, 24) * .3 + patchNoise(x, y, 48) * .15;
    const shade = patterned ? patch < .32 ? 130 : patch < .43 ? 185 : patch > .77 ? 219 : 246 : 242;
    const fiber = (x % 2 === y % 2 ? 2 : -2) + Math.floor(noise(x, y) * 5) - 2;
    const offset = (y * size + x) * 4;
    pixels.set([shade + fiber - 3, shade + fiber, shade + fiber, 255], offset);
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(patterned ? 3 : 8, patterned ? 3 : 8);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  if (patterned) camouflage = texture;
  else weave = texture;
  return texture;
}

export function tacticalClothDetail() {
  if (clothDetail) return clothDetail;
  const size = 128, normals = new Uint8Array(size * size * 4), roughness = new Uint8Array(normals.length);
  const height = (x, y) => {
    x = (x + size) % size;
    y = (y + size) % size;
    return Math.sin(x * Math.PI / 4) * Math.sin(y * Math.PI / 4) * .055 +
      ((x % 8 < 4) === (y % 8 < 4) ? .02 : -.02) + noise(x, y) * .025;
  };
  const normal = new THREE.Vector3();
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    normal.set((height(x - 1, y) - height(x + 1, y)) * 2.5,
      (height(x, y - 1) - height(x, y + 1)) * 2.5, 1).normalize();
    const offset = (y * size + x) * 4;
    normals.set([Math.round((normal.x + 1) * 127.5), Math.round((normal.y + 1) * 127.5),
      Math.round((normal.z + 1) * 127.5), 255], offset);
    const grain = Math.round(224 + noise(x, y) * 25);
    roughness.set([grain, grain, grain, 255], offset);
  }
  const texture = (pixels) => {
    const map = new THREE.DataTexture(pixels, size, size);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(8, 8);
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    map.needsUpdate = true;
    return map;
  };
  clothDetail = { normalMap: texture(normals), roughnessMap: texture(roughness) };
  return clothDetail;
}

export function uniformVertexStyle(position, normal, jointName, palette, sleeveAxis) {
  const hand = /^(hand|index|middle|ring|pinky|thumb)/.test(jointName);
  const head = jointName === "Head" || jointName.startsWith("neck");
  const sleeve = /^(upperarm|lowerarm|clavicle)/.test(jointName);
  const jacket = position.y > 1.07 || sleeve;
  const material = head ? 4 : hand || jacket ? 1 : 0;
  const cuff = jointName.startsWith("lowerarm") && Math.abs(position.x) > .68;
  const yoke = jacket && !hand && !head && !sleeve && position.y > 1.49;
  const hem = !sleeve && position.y > 1.035 && position.y < 1.10;
  const color = hand ? palette.glove : head ? 0xffffff : cuff || hem ? palette.trim :
    yoke ? palette.yoke : palette.uniform;
  let padding = 0;
  if (!hand && !head) {
    const folds = Math.sin((sleeve ? Math.abs(position.x) : position.y) * 88 + position.z * 12) * .004;
    padding = (sleeve ? .038 : jacket ? .042 : .03) + folds;
    if (!jacket) padding *= THREE.MathUtils.smoothstep(position.y, .22, .36);
  }
  const radial = sleeve && sleeveAxis ? normal.clone().addScaledVector(sleeveAxis, -normal.dot(sleeveAxis)) : normal;
  return { material, color, position: [
    position.x + (sleeve && !sleeveAxis ? 0 : radial.x * padding),
    position.y + (sleeve ? radial.y * padding : 0),
    position.z + radial.z * padding
  ] };
}

function goggleShape() {
  const shape = new THREE.Shape();
  shape.moveTo(-.109, .024);
  shape.quadraticCurveTo(-.122, .022, -.114, -.020);
  shape.quadraticCurveTo(-.11, -.035, -.078, -.034);
  shape.lineTo(-.037, -.032);
  shape.quadraticCurveTo(-.023, -.030, 0, -.010);
  shape.quadraticCurveTo(.023, -.030, .037, -.032);
  shape.lineTo(.078, -.034);
  shape.quadraticCurveTo(.11, -.035, .114, -.020);
  shape.quadraticCurveTo(.122, .022, .109, .024);
  shape.quadraticCurveTo(0, .035, -.109, .024);
  return shape;
}

function maskGeometry(compact) {
  const rows = [
    [1.755, .080, .062, .157], [1.790, .097, .062, .180], [1.818, .112, .072, .194],
    [1.864, .119, .085, .205], [1.908, .122, .080, .210],
    [1.933, .115, .082, .202]
  ];
  const positions = [], uvs = [], indices = [], segments = compact ? 8 : 16;
  for (let row = 0; row < rows.length; row++) {
    const [y, width, edge, center] = rows[row];
    for (let index = 0; index <= segments; index++) {
      const across = index / segments * 2 - 1;
      positions.push(across * width, y, center - (center - edge) * across ** 2);
      uvs.push(index / segments, row / (rows.length - 1));
    }
  }
  for (let row = 0; row < rows.length - 1; row++) for (let index = 0; index < segments; index++) {
    const a = row * (segments + 1) + index, b = a + segments + 1;
    indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function bootGeometry() {
  const rings = [
    [.023, .078, -.155, .172], [.053, .080, -.154, .178],
    [.100, .073, -.150, .164], [.147, .065, -.151, .085],
    [.215, .064, -.150, -.020], [.263, .063, -.150, -.025]
  ];
  const positions = [], uvs = [], indices = [], segments = 12;
  for (const [y, width, back, front] of rings) for (let index = 0; index < segments; index++) {
    const angle = index * Math.PI * 2 / segments;
    positions.push(Math.sin(angle) * width, y, (front + back) / 2 + Math.cos(angle) * (front - back) / 2);
    uvs.push(index / segments, y * 3);
  }
  for (let ring = 0; ring < rings.length - 1; ring++) for (let index = 0; index < segments; index++) {
    const a = ring * segments + index, b = ring * segments + (index + 1) % segments;
    indices.push(a, b, a + segments, b, b + segments, a + segments);
  }
  for (let index = 1; index < segments - 1; index++) {
    indices.push(0, index + 1, index);
    const last = (rings.length - 1) * segments;
    indices.push(last, last + index, last + index + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function fittedJacketZipper(source, styles, color) {
  const positions = [], joints = [], weights = [], uvs = [], indices = [];
  const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const hit = new THREE.Vector3(), barycentric = new THREE.Vector3();
  const attributes = source.attributes;
  const rows = 12;
  for (let row = 0; row < rows; row++) for (const side of [-1, 1]) {
    const x = side * .0045, y = THREE.MathUtils.lerp(1.105, 1.625, row / (rows - 1));
    ray.origin.set(x, y, 1);
    let closest = null;
    for (let triangle = 0; triangle < source.index.count; triangle += 3) {
      const first = source.index.getX(triangle), second = source.index.getX(triangle + 1), third = source.index.getX(triangle + 2);
      const pa = styles[first].position, pb = styles[second].position, pc = styles[third].position;
      if (x < Math.min(pa[0], pb[0], pc[0]) || x > Math.max(pa[0], pb[0], pc[0]) ||
        y < Math.min(pa[1], pb[1], pc[1]) || y > Math.max(pa[1], pb[1], pc[1])) continue;
      a.fromArray(pa); b.fromArray(pb); c.fromArray(pc);
      if (!ray.intersectTriangle(a, b, c, false, hit) || (closest && hit.z <= closest.z)) continue;
      THREE.Triangle.getBarycoord(hit, a, b, c, barycentric);
      closest = { z: hit.z, vertices: [first, second, third], barycentric: barycentric.toArray() };
    }
    if (!closest) throw new Error("Could not fit the jacket zipper to the human surface");
    positions.push(x, y, closest.z + .004);
    uvs.push(side < 0 ? 0 : 1, row / (rows - 1));
    const influence = new Map();
    closest.vertices.forEach((vertex, corner) => {
      for (let slot = 0; slot < 4; slot++) {
        const joint = attributes.skinIndex.array[vertex * 4 + slot];
        const weight = attributes.skinWeight.array[vertex * 4 + slot] * closest.barycentric[corner];
        influence.set(joint, (influence.get(joint) ?? 0) + weight);
      }
    });
    const selected = [...influence].filter(([, weight]) => weight > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = selected.reduce((sum, [, weight]) => sum + weight, 0);
    if (!(total > 0)) throw new Error("Missing jacket zipper deformation weights");
    joints.push(...selected.map(([joint]) => joint), ...Array(4 - selected.length).fill(0));
    weights.push(...selected.map(([, weight]) => weight / total), ...Array(4 - selected.length).fill(0));
  }
  for (let row = 0; row < rows - 1; row++) {
    const base = row * 2;
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const geometry = new THREE.BufferGeometry(), tint = new THREE.Color(color), colors = [];
  for (let vertex = 0; vertex < positions.length / 3; vertex++) colors.push(tint.r, tint.g, tint.b);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(joints, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function addWinterEquipment({ part, box, palette, type, compact, distant = false, hips, chest, head, legs, definitions, sculpted }) {
  const { uniform, gear, yoke, trim, mask, dark, rubber, lens } = palette;
  const segments = compact ? 12 : 20;
  const helmetProfile = [
    [0, .127], [.057, .12], [.105, .083], [.132, .025],
    [.137, -.008], [.137, -.035], [.126, -.043]
  ].reverse().map(([radius, height]) => new THREE.Vector2(radius, height));
  part(new THREE.LatheGeometry(helmetProfile, segments), 0, uniform,
    [0, 1.945, -.012], [1, 1, 1.1], head);
  for (const side of [-1, 1]) {
    box([.029, .022, .15], 2, trim, [side * .129, 1.965, -.011], head, [0, side * -.16, 0]);
    box([.021, .084, .052], 1, dark, [side * .127, 1.881, -.014], head);
    box([.025, .115, .014], 1, trim, [side * .1, 1.865, .057], head, [0, 0, side * .27]);
  }
  box([.047, .038, .018], 2, trim, [0, 2.015, .124], head);
  box([.02, .022, .01], 2, dark, [0, 2.015, .137], head);
  const goggles = (scale, material, color, z) => part(new THREE.ExtrudeGeometry(goggleShape(), {
    depth: .012, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: .004,
    bevelThickness: .003, curveSegments: compact ? 2 : 4
  }), material, color, [0, 1.947, z], scale, head);
  goggles([1.05, 1.12, 1], 1, dark, .164);
  goggles([.94, .87, 1], 3, lens, .181);
  part(maskGeometry(compact), 1, mask, [0, 0, 0], [1, 1, 1], head);
  const collar = [[.126, -.072], [.145, -.05], [.143, .032], [.13, .056]]
    .map(([radius, height]) => new THREE.Vector2(radius, height));
  part(new THREE.LatheGeometry(collar, segments), 1, uniform, [0, 1.707, -.018], [1, 1, .93], chest);
  box([.009, .12, .01], 2, trim, [0, 1.704, .128], chest);
  if (!sculpted) box([.008, .53, .012], 2, trim, [0, 1.363, .183], chest);
  box([.008, .038, .022], 2, dark, [0, 1.584, .191], chest);
  for (const side of [-1, 1]) {
    box([.05, .17, .018], 1, gear, [side * .205, 1.54, .122], chest, [0, 0, -side * .15]);
    box([.036, .34, .022], 1, gear, [side * .192, 1.285, .148], chest, [0, 0, side * .075]);
    box([.031, .037, .031], 2, dark, [side * .2, 1.36, .165], chest);
    box([.14, .092, .017], 1, uniform, [side * .111, 1.186, .164], chest, [0, 0, side * -.12]);
    box([.105, .006, .006], 2, trim, [side * .11, 1.226, .177], chest, [0, 0, side * -.12]);
  }
  box([.30, .30, .115], 1, gear, [0, 1.405, -.235], chest);
  box([.27, .065, .05], 1, trim, [0, 1.31, -.297], chest);
  box([.038, .035, .023], 2, dark, [0, 1.31, -.329], chest);
  box([.385, .045, .033], 1, trim, [0, 1.065, .12], hips);
  box([.035, .035, .02], 2, dark, [0, 1.065, .146], hips);
  const pocketSide = type === "skirmisher" ? -1 : 1;
  box([.072, .168, .117], 0, uniform, [pocketSide * .237, .866, -.005], hips, [0, 0, -.05 * pocketSide]);
  box([.065, .036, .124], 1, gear, [pocketSide * .244, .92, -.005], hips);
  box([.064, .022, .03], 2, dark, [pocketSide * .24, .782, .055], hips);
  for (const leg of legs) {
    const x = definitions[leg.foot].position.x;
    const z = definitions[leg.foot].position.z + .0875;
    part(bootGeometry(), 1, rubber, [x, 0, z], [1, 1, 1], leg.foot);
    part(new THREE.CylinderGeometry(1, 1, .026, segments), 2, dark,
      [x, .014, z + .011], [.081, 1, .168], leg.foot);
    box([.055, .106, .024], 1, trim, [x, .182, z - .019], leg.foot, [-.13, 0, 0]);
    for (const y of [.15, .174, .198, .222]) {
      box([.044, .004, .006], 2, dark, [x, y, z - .002 - (y - .15) * .38], leg.foot, [0, 0, leg.side * .07]);
    }
    if (distant) continue;
    const knee = definitions[leg.knee].position;
    box([.092, .112, .03], 1, gear, [knee.x, knee.y - .012, knee.z + .078], leg.knee, [-.08, 0, 0]);
    box([.098, .016, .022], 2, dark, [knee.x, knee.y + .012, knee.z + .082], leg.knee, [-.08, 0, 0]);
  }
  if (type !== "brute" && !distant) {
    // Front magazine pouches with flaps.
    for (const offset of compact ? [-.06, .06] : [-.08, 0, .08]) {
      box([.066, .092, .036], 1, gear, [offset, 1.268, .19], chest);
      box([.07, .022, .04], 2, trim, [offset, 1.318, .192], chest);
    }
  }
  if (type !== "skirmisher" && !distant) {
    box([.07, .11, .045], 1, dark, [.105, 1.47, -.31], chest);
    part(new THREE.CylinderGeometry(.0022, .003, compact ? .16 : .24, 6), 2, dark,
      [.125, compact ? 1.6 : 1.64, -.31], [1, 1, 1], chest);
  }
  if (type === "brute") {
    box([.29, .285, .08], 1, yoke, [0, 1.40, .20], chest);
    for (const side of [-1, 1]) {
      box([.095, .15, .063], 1, gear, [side * .095, 1.27, .235], chest);
      box([.088, .035, .064], 1, trim, [side * .095, 1.325, .245], chest);
    }
  } else if (type === "skirmisher") {
    box([.055, .1, .04], 1, dark, [-.2, 1.51, .15], chest);
    part(new THREE.CylinderGeometry(.0025, .003, .12, 6), 2, dark,
      [-.2, 1.62, .15], [1, 1, 1], chest);
  } else if (type === "sentinel") {
    box([.085, .075, .043], 1, gear, [.165, 1.5, .174], chest);
  }
}
