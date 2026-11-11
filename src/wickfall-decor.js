import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ARENA_LIMIT, getMapBuildings, getMapObstacles } from "../shared/gameplay.js";
import { getTerrainHeight } from "../shared/arena-layout.js";

export function wickfallStoneTexture(relief = false) {
  const size = 128, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const row = Math.floor(y / 16), column = Math.floor((x + row % 2 * 16) / 32);
    const edge = y % 16 < 2 || (x + row % 2 * 16) % 32 < 2;
    const grain = (x * 73 + y * 37 + x * y * 3) % 19;
    const value = edge ? 88 + grain : 130 + (row * 17 + column * 23) % 35 + grain;
    data.set(relief ? [value, value, value, 255] : [value, value + 3, value + 5, 255],
      (y * size + x) * 4);
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = relief ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function localPose(cover, x, y, z, extra = {}) {
  const cos = Math.cos(cover.rotation), sin = Math.sin(cover.rotation);
  return { x: cover.x + cos * x + sin * z, y: (cover.base || 0) + y,
    z: cover.z - sin * x + cos * z, yaw: cover.rotation, ...extra };
}

export function planWickfallDecor(detail = 2) {
  const blocks = [], headstones = [], arches = [], lanterns = [], webs = [], trees = [], iron = [], ropes = [];
  for (const grave of getMapObstacles("wickfall").filter((cover) => ["grave", "lantern"].includes(cover.kind))) {
    for (const end of [-1, 1]) {
      const face = localPose(grave, 0, .08, end * (grave.depth / 2 + .016),
        { yaw: grave.rotation + (end === -1 ? Math.PI : 0), obstacleId: grave.id,
          width: Math.min(1.35, grave.width * .55), height: grave.height - .2 });
      headstones.push(face);
      webs.push({ ...face, y: (grave.base || 0) + grave.height - .06,
        size: Math.min(1.15, grave.height * .65) });
    }
    blocks.push(localPose(grave, 0, grave.height - .13, 0,
      { width: grave.width + .04, height: .16, depth: grave.depth + .04 }));
  }
  for (const building of getMapBuildings("wickfall")) {
    const doorWidth = Math.min(3.2, building.width * .5);
    for (const end of [-1, 1]) {
      const yaw = building.rotation + (end === -1 ? Math.PI : 0);
      arches.push(localPose(building, 0, 2.7, end * (building.depth / 2 + .02),
        { yaw, width: doorWidth + .4, height: .7, buildingId: building.id }));
      blocks.push(localPose(building, 0, building.height - .16, end * (building.depth / 2 + .015),
        { width: building.width, height: .19, depth: .12, buildingId: building.id }));
      for (const side of [-1, 1]) {
        blocks.push(localPose(building, side * (doorWidth / 2 + .14), 1.32,
          end * (building.depth / 2 + .015), { width: .22, height: 2.64, depth: .12, buildingId: building.id }));
        blocks.push(localPose(building, side * (building.width / 2 - .14), building.height / 2,
          end * (building.depth / 2 + .015), { width: .26, height: building.height, depth: .12, buildingId: building.id }));
        if (detail > 1 || side === 1) {
          lanterns.push(localPose(building, side * (doorWidth / 2 + .48), 2.22,
            end * (building.depth / 2 + .2), { yaw, base: building.base || 0, buildingId: building.id }));
        }
      }
      webs.push(localPose(building, end * (building.width / 2 - .04), building.height - .06,
        end * (building.depth / 2 + .085), { yaw, size: Math.min(1.35, (building.width - doorWidth) / 2 - .06),
          buildingId: building.id }));
    }
  }
  const stations = detail > 1 ? [-33, -17, 0, 17, 33] : [-28, 0, 28];
  for (const axis of ["x", "z"]) for (const sign of [-1, 1]) {
    for (const along of stations) {
      if (axis === "z" && along === 0) continue;
      trees.push({ x: axis === "x" ? sign * (ARENA_LIMIT + 7) : along, y: 0,
        z: axis === "z" ? sign * (ARENA_LIMIT + 7) : along,
        yaw: trees.length * 1.73, size: .9 + trees.length % 4 * .07 });
    }
    for (let along = -40; along <= 40; along += detail > 1 ? 2 : 4) {
      iron.push({ x: axis === "x" ? sign * (ARENA_LIMIT + .65) : along, y: 5.48,
        z: axis === "z" ? sign * (ARENA_LIMIT + .65) : along,
        yaw: axis === "x" ? Math.PI / 2 : 0, width: .065, height: .96, depth: .065 });
    }
    for (const y of [5.18, 5.55]) iron.push({
      x: axis === "x" ? sign * (ARENA_LIMIT + .65) : 0, y,
      z: axis === "z" ? sign * (ARENA_LIMIT + .65) : 0,
      yaw: axis === "x" ? Math.PI / 2 : 0, width: 82, height: .055, depth: .07
    });
  }
  for (const z of [-18, 0, 18]) {
    let previous;
    for (let x = -43; x <= 43; x++) {
      const position = { x, y: 6.15 + (x / 43) ** 2 * 3, z };
      if (previous) ropes.push(previous.x, previous.y, z, position.x, position.y, z);
      if (x % (detail > 1 ? 16 : 24) === 0) {
        lanterns.push({ ...position, y: position.y - 1, yaw: .15, size: 1.8, hanging: true });
      }
      previous = position;
    }
  }
  return { blocks, headstones, arches, lanterns, webs, trees, iron, ropes };
}

function treeGeometry() {
  const parts = [], up = new THREE.Vector3(0, 1, 0);
  const branch = (start, end, radius) => {
    const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end);
    const geometry = new THREE.CylinderGeometry(radius * .58, radius, a.distanceTo(b), 5, 1);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, b.clone().sub(a).normalize()));
    geometry.translate(...a.add(b).multiplyScalar(.5).toArray());
    parts.push(geometry);
  };
  branch([0, 0, 0], [.35, 4, .1], .64);
  branch([.35, 4, .1], [-.3, 7.4, -.1], .42);
  branch([-.3, 7.4, -.1], [.4, 10.2, .2], .25);
  branch([.4, 10.2, .2], [-.15, 13, 0], .13);
  for (const side of [-1, 1]) for (let tier = 0; tier < 3; tier++) {
    const y = 4.7 + tier * 2, z = (tier % 2 ? -1 : 1) * .5;
    const elbow = [side * (2.1 - tier * .25), y + .7, z];
    const tip = [side * (3.4 - tier * .3), y + 2.6, z * 2];
    branch([0, y, 0], elbow, .22 - tier * .04);
    branch(elbow, tip, .13 - tier * .025);
    branch(elbow, [side * 2.45, y + 3.2, z * 2.2], .075);
    branch(tip, [tip[0] - side * .25, tip[1] + 1.4, tip[2] + .45], .045);
  }
  const geometry = mergeGeometries(parts);
  parts.forEach((part) => part.dispose());
  return geometry;
}

function stoneShape(arch = false) {
  const shape = new THREE.Shape();
  if (arch) {
    shape.moveTo(-.5, 0);
    shape.bezierCurveTo(-.5, 1.2, .5, 1.2, .5, 0);
    shape.lineTo(.41, 0);
    shape.bezierCurveTo(.41, .87, -.41, .87, -.41, 0);
  } else {
    shape.moveTo(-.5, 0); shape.lineTo(-.5, .65);
    shape.bezierCurveTo(-.5, 1.1, .5, 1.1, .5, .65);
    shape.lineTo(.5, 0);
  }
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, { depth: .035, bevelEnabled: false, curveSegments: 8 });
}

function glowPoolTexture() {
  const size = 32, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const radius = Math.hypot((x / 31 - .5) * 2, (y / 31 - .5) * 2);
    data.set([255, 255, 255, Math.round(100 * Math.max(0, 1 - radius) ** 2)], (y * size + x) * 4);
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function addWickfallDecor(parent, plan, { glow, dark }) {
  const root = new THREE.Group(), meshes = [], pose = new THREE.Object3D();
  root.name = "wickfall-cemetery";
  parent.add(root);
  const instance = (name, geometry, material, items, place) => {
    const mesh = new THREE.InstancedMesh(geometry, material, items.length);
    mesh.name = name;
    items.forEach((item, index) => {
      pose.position.set(item.x, item.y, item.z); pose.rotation.set(0, item.yaw, 0); pose.scale.setScalar(1);
      place(pose, item, index);
      pose.updateMatrix(); mesh.setMatrixAt(index, pose.matrix);
    });
    mesh.computeBoundingSphere(); root.add(mesh); meshes.push(mesh);
    return mesh;
  };
  const stone = new THREE.MeshStandardMaterial({ color: 0xa2aba8, map: wickfallStoneTexture(), roughness: 1, metalness: 0 });
  const relief = new THREE.MeshStandardMaterial({ color: 0x9ca5a3, roughness: 1, metalness: 0 });
  const blocks = instance("crypt-masonry", new THREE.BoxGeometry(1, 1, 1), stone, plan.blocks,
    (object, item) => object.scale.set(item.width, item.height, item.depth));
  blocks.receiveShadow = true;
  instance("carved-headstones", stoneShape(), relief, plan.headstones,
    (object, item) => object.scale.set(item.width, item.height, 1));
  instance("crypt-door-crowns", stoneShape(true), relief, plan.arches,
    (object, item) => object.scale.set(item.width, item.height, 1));
  instance("crooked-trees", treeGeometry(), new THREE.MeshStandardMaterial({
    color: 0x3c3937, roughness: 1, metalness: 0
  }), plan.trees, (object, item) => object.scale.setScalar(item.size));
  const iron = [...plan.iron];
  for (const lamp of plan.lanterns) {
    const size = lamp.size || 1;
    const anchor = { x: lamp.x, z: lamp.z, base: lamp.y, rotation: lamp.yaw };
    for (const side of [-1, 1]) for (const end of [-1, 1]) {
      iron.push(localPose(anchor, side * .145 * size, end * .21 * size, 0,
        { width: .045 * size, height: .045 * size, depth: .3 * size }));
    }
    for (const side of [-1, 1]) iron.push(localPose(anchor, side * .145 * size, 0, .13 * size,
      { width: .035 * size, height: .45 * size, depth: .035 * size }));
    iron.push({ ...lamp, y: lamp.y + (lamp.hanging ? .85 : .43), width: .035,
      height: lamp.hanging ? .3 : .45, depth: .035 });
  }
  instance("cemetery-ironwork", new THREE.BoxGeometry(1, 1, 1), dark, iron,
    (object, item) => object.scale.set(item.width, item.height, item.depth));
  instance("vault-lantern-glass", new THREE.BoxGeometry(.25, .38, .23), glow, plan.lanterns,
    (object, item) => object.scale.setScalar(item.size || 1));
  instance("vault-lantern-caps", new THREE.ConeGeometry(.25, .18, 4), dark, plan.lanterns, (object, item) => {
    object.position.y += .3 * (item.size || 1); object.rotation.y += Math.PI / 4;
    object.scale.setScalar(item.size || 1);
  });
  instance("lantern-ground-glow", new THREE.PlaneGeometry(1.4, 1.4), new THREE.MeshBasicMaterial({
    map: glowPoolTexture(), color: 0xffae5c, transparent: true, opacity: .48, depthWrite: false
  }), plan.lanterns, (object, item) => {
    const x = item.x + Math.sin(item.yaw) * .4, z = item.z + Math.cos(item.yaw) * .4;
    object.position.set(x, getTerrainHeight("wickfall", x, z) + .018, z);
    object.rotation.set(-Math.PI / 2, 0, 0);
  });
  const webs = [], engravings = [];
  const line = (output, anchor, ax, ay, bx, by) => {
    const cos = Math.cos(anchor.yaw), sin = Math.sin(anchor.yaw);
    for (const [x, y] of [[ax, ay], [bx, by]]) output.push(anchor.x + cos * x, anchor.y + y, anchor.z - sin * x);
  };
  for (const web of plan.webs) {
    for (let spoke = 0; spoke <= 6; spoke++) {
      const angle = spoke / 6 * Math.PI / 2;
      line(webs, web, 0, 0, -Math.cos(angle) * web.size, -Math.sin(angle) * web.size);
    }
    for (let ring = 1; ring <= 4; ring++) for (let segment = 0; segment < 12; segment++) {
      const a = segment / 12 * Math.PI / 2, b = (segment + 1) / 12 * Math.PI / 2, r = ring / 4 * web.size;
      line(webs, web, -Math.cos(a) * r, -Math.sin(a) * r, -Math.cos(b) * r, -Math.sin(b) * r);
    }
  }
  for (const item of plan.headstones) {
    const anchor = { ...item, x: item.x + Math.sin(item.yaw) * .038, z: item.z + Math.cos(item.yaw) * .038 };
    line(engravings, anchor, 0, item.height * .4, 0, item.height * .76);
    line(engravings, anchor, -.17, item.height * .64, .17, item.height * .64);
    for (let row = 0; row < 3; row++) line(engravings, anchor, -.25 + row * .04, .18 + row * .09,
      .25 - row * .04, .18 + row * .09);
  }
  for (const [name, positions, color, opacity] of [
    ["crypt-cobwebs", webs, 0xd7e3df, .58], ["stone-inscriptions", engravings, 0x343d3d, 1],
    ["lantern-canopy-cords", plan.ropes, 0x342d28, 1]
  ]) {
    const lines = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute("position",
      new THREE.Float32BufferAttribute(positions, 3)),
    new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity === 1 }));
    lines.name = name; root.add(lines);
  }
  const paving = [];
  for (const [x, width, depth] of [[0, 4, 70], [-18.5, 33, 3], [18.5, 33, 3]]) {
    const geometry = new THREE.PlaneGeometry(width, depth), uv = geometry.attributes.uv;
    for (let index = 0; index < uv.count; index++) uv.setXY(index, uv.getX(index) * width / 2, uv.getY(index) * depth / 2);
    geometry.rotateX(-Math.PI / 2); geometry.translate(x, .012, 0); paving.push(geometry);
  }
  const path = new THREE.Mesh(mergeGeometries(paving), stone);
  paving.forEach((geometry) => geometry.dispose());
  path.name = "cemetery-stone-paths"; path.receiveShadow = true; root.add(path);
  return { root, meshes };
}
