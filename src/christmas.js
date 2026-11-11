import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ARENA_LIMIT, getMapObstacles } from "../shared/gameplay.js";
import { CHRISTMAS_EVENT } from "../shared/events.js";

export function planChristmas(mapId, detail = 2) {
  const trees = [], bulbs = [], wire = [];
  for (const axis of ["x", "z"]) for (const sign of [-1, 1]) {
    for (const along of detail > 1 ? [-30, 0, 30] : [-24, 24]) {
      trees.push({ x: axis === "x" ? sign * (ARENA_LIMIT + 3.5) : along,
        y: 0, z: axis === "z" ? sign * (ARENA_LIMIT + 3.5) : along });
    }
    let previous;
    for (let index = 0; index <= 40; index++) {
      const item = { x: axis === "x" ? sign * (ARENA_LIMIT + .65) : -40 + index * 2,
        y: 6.3 - Math.sin(index % 10 / 10 * Math.PI) * .55,
        z: axis === "z" ? sign * (ARENA_LIMIT + .65) : -40 + index * 2 };
      if (previous) wire.push(previous.x, previous.y, previous.z, item.x, item.y, item.z);
      if (index % (detail > 1 ? 1 : 2) === 0) bulbs.push(item);
      previous = item;
    }
  }
  const gifts = getMapObstacles(mapId).filter((cover) => !cover.buildingId &&
    !cover.kind?.includes("wall") && !["roof", "furniture"].includes(cover.kind) &&
    cover.width >= 1.8 && cover.depth >= .8 && cover.height >= 1 && cover.height <= 3.5)
    .sort((a, b) => Math.hypot(a.x, a.z - 10) - Math.hypot(b.x, b.z - 10))
    .slice(0, detail > 1 ? 8 : 5).flatMap((cover) => {
      const cos = Math.cos(cover.rotation), sin = Math.sin(cover.rotation);
      return [-1, 1].map((sign) => {
        const x = sign * .27, z = cover.depth / 2 - .35;
        return { x: cover.x + cos * x + sin * z, y: (cover.base || 0) + cover.height + .01,
          z: cover.z - sin * x + cos * z, yaw: cover.rotation, obstacleId: cover.id };
      });
    });
  return { trees, gifts, bulbs, wire };
}

function mergedBoxes(boxes) {
  const pieces = boxes.map(([x, y, z, width, height, depth]) =>
    new THREE.BoxGeometry(width, height, depth).translate(x, y, z));
  const geometry = mergeGeometries(pieces);
  pieces.forEach((piece) => piece.dispose());
  return geometry;
}

function snowfall(detail) {
  const count = [40, 64, 110, 150][Math.max(0, Math.min(3, Math.round(detail)))];
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index++) {
    positions.set([((index * .618033989) % 1 * 2 - 1) * 12,
      (index * .414213562 % 1) * 11, ((index * .754877666) % 1 * 2 - 1) * 12], index * 3);
  }
  const pixels = new Uint8Array(16 * 16 * 4);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const radius = Math.hypot((x + .5 - 8) / 8, (y + .5 - 8) / 8);
    pixels.set([255, 255, 255, Math.round(255 * (1 - THREE.MathUtils.smoothstep(radius, .2, .95)))], (y * 16 + x) * 4);
  }
  const map = new THREE.DataTexture(pixels, 16, 16);
  map.magFilter = map.minFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  const geometry = new THREE.BufferGeometry().setAttribute("position",
    new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  const snow = new THREE.Points(geometry, new THREE.PointsMaterial({
    map, color: 0xf0f8ff, size: .095, opacity: .8, transparent: true, depthWrite: false
  }));
  snow.name = "christmas-snow";
  snow.frustumCulled = false;
  snow.visible = false;
  return snow;
}

export function addChristmas(scene, mapId, { detail = 2, reducedMotion = false, enabled = true } = {}) {
  const plan = planChristmas(mapId, detail), root = new THREE.Group(), meshes = [];
  root.name = "christmas";
  root.visible = enabled && CHRISTMAS_EVENT.active;
  scene.add(root);
  const dummy = new THREE.Object3D(), color = new THREE.Color();
  const palette = [0xe3aa74, 0xd5736d, 0x8dcfb3, 0xf3ddad];
  const matte = (color) => new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0 });
  function instance(geometry, material, placements, place, colored = false) {
    if (!placements.length) { geometry.dispose(); material.dispose(); return; }
    const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
    placements.forEach((item, index) => {
      dummy.position.set(item.x, item.y, item.z);
      dummy.rotation.set(0, item.yaw || 0, 0);
      dummy.scale.setScalar(1);
      place(dummy, item, index);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      if (colored) mesh.setColorAt(index, color.setHex(palette[index % palette.length]));
    });
    mesh.computeBoundingSphere();
    root.add(mesh); meshes.push(mesh);
    return mesh;
  }
  const tiers = [[3.5, 1.8, 3.8], [5.1, 1.4, 3.4], [6.6, .95, 3.1]];
  const branches = tiers.map(([y, radius, height]) => new THREE.ConeGeometry(radius, height, 7).translate(0, y, 0));
  const canopy = mergeGeometries(branches);
  branches.forEach((piece) => piece.dispose());
  instance(canopy, matte(0x285e50), plan.trees, () => {});
  const caps = tiers.map(([y, radius, height]) => new THREE.ConeGeometry(radius * .63, height * .63, 7)
    .translate(0, y + height * .185, 0));
  const snowCaps = mergeGeometries(caps);
  caps.forEach((piece) => piece.dispose());
  instance(snowCaps, matte(0xe4eeeb), plan.trees, () => {});
  instance(new THREE.CylinderGeometry(.13, .23, 3.5, 6), matte(0x544439), plan.trees,
    (object) => { object.position.y += 1.75; });
  const ornaments = plan.trees.flatMap((tree) => Array.from({ length: 9 }, (_, index) => {
    const angle = index * Math.PI * .76, radius = .75 + index % 3 * .26;
    return { x: tree.x + Math.cos(angle) * radius, y: 3.1 + index % 3 * 1.4, z: tree.z + Math.sin(angle) * radius };
  }));
  const glow = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffc991,
    emissiveIntensity: .75, roughness: 1, metalness: 0 });
  instance(new THREE.SphereGeometry(.11, 6, 4), glow, [...plan.bulbs, ...ornaments], () => {}, true);
  instance(new THREE.OctahedronGeometry(.25), matte(0xf1c778), plan.trees,
    (object) => { object.position.y = 8.3; object.scale.set(.65, 1, .65); });
  instance(new THREE.BoxGeometry(.4, .36, .4), matte(0xffffff), plan.gifts,
    (object) => { object.position.y += .18; }, true);
  instance(mergedBoxes([[0, .185, 0, .075, .38, .415], [0, .185, 0, .415, .38, .075]]),
    matte(0xf0d49a), plan.gifts, () => {});
  root.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute("position",
    new THREE.Float32BufferAttribute(plan.wire, 3)), new THREE.LineBasicMaterial({ color: 0x506961 })));
  const snow = snowfall(detail);
  root.add(snow);
  let time = 0, centered = false;
  return {
    root, plan, meshes, snow,
    setEnabled(value) { root.visible = value && CHRISTMAS_EVENT.active; },
    update(dt, reduceMotion = reducedMotion, cameraPosition = null) {
      if (!Number.isFinite(dt) || dt < 0) throw new RangeError("Invalid Christmas animation delta.");
      if (!root.visible) return;
      time += dt;
      glow.emissiveIntensity = reduceMotion ? .75 : .75 + Math.sin(time * .65) * .025;
      snow.visible = Boolean(cameraPosition) && !reduceMotion;
      if (!snow.visible) return;
      const positions = snow.geometry.attributes.position.array, delta = Math.min(dt, .1);
      const ground = cameraPosition.y - 1.6;
      for (let index = 0; index < positions.length / 3; index++) {
        const offset = index * 3, phase = index * 2.4 + time * .3;
        if (!centered) {
          positions[offset] += cameraPosition.x;
          positions[offset + 1] += ground;
          positions[offset + 2] += cameraPosition.z;
        }
        positions[offset] += (.12 + Math.sin(phase) * .08) * delta;
        positions[offset + 1] -= (.65 + index % 5 * .065) * delta;
        positions[offset + 2] += Math.cos(phase) * .09 * delta;
        positions[offset] = cameraPosition.x - 12 + ((positions[offset] - cameraPosition.x + 12) % 24 + 24) % 24;
        positions[offset + 1] = ground + ((positions[offset + 1] - ground) % 11 + 11) % 11;
        positions[offset + 2] = cameraPosition.z - 12 + ((positions[offset + 2] - cameraPosition.z + 12) % 24 + 24) % 24;
      }
      centered = true;
      snow.geometry.attributes.position.needsUpdate = true;
    }
  };
}
