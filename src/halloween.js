import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ARENA_LIMIT, getMapObstacles } from "../shared/gameplay.js";
import { addWickfallDecor, planWickfallDecor } from "./wickfall-decor.js";

export function planHalloween(mapId, detail = 2) {
  const obstacles = getMapObstacles(mapId);
  const stations = detail > 1 ? [-30, -10, 10, 30] : [-24, 24];
  const pumpkins = [];
  for (const axis of ["x", "z"]) for (const sign of [-1, 1]) for (const along of stations) {
    const position = { x: axis === "x" ? sign * (ARENA_LIMIT + .75) : along,
      y: 5, z: axis === "z" ? sign * (ARENA_LIMIT + .75) : along };
    pumpkins.push({ ...position, yaw: Math.atan2(-position.x, -position.z), size: 1 + pumpkins.length % 3 * .13 });
  }
  const emblems = obstacles.filter((obstacle) => !obstacle.kind?.includes("wall") &&
    !["roof", "furniture"].includes(obstacle.kind) && obstacle.height >= 1.5 && obstacle.width >= .8 && obstacle.depth >= .8)
    .sort((a, b) => Math.hypot(a.x, a.z - 10) - Math.hypot(b.x, b.z - 10))
    .slice(0, detail > 1 ? 10 : 6).map((obstacle) => {
      const cos = Math.cos(obstacle.rotation), sin = Math.sin(obstacle.rotation);
      const faces = [[0, 1, obstacle.depth], [0, -1, obstacle.depth],
        [1, 0, obstacle.width], [-1, 0, obstacle.width]].map(([nx, nz, depth]) => {
        const x = obstacle.x + (nx * cos + nz * sin) * (depth / 2 + .012);
        const z = obstacle.z + (-nx * sin + nz * cos) * (depth / 2 + .012);
        const normalX = nx * cos + nz * sin, normalZ = -nx * sin + nz * cos;
        return { x, z, normalX, normalZ };
      }).filter((face) => -face.x * face.normalX + (10 - face.z) * face.normalZ > 0)
        .sort((a, b) => Math.hypot(a.x, a.z - 10) - Math.hypot(b.x, b.z - 10));
      const face = faces[0];
      return face ? { x: face.x, z: face.z, y: (obstacle.base || 0) + Math.min(1.6, obstacle.height / 2),
        yaw: Math.atan2(face.normalX, face.normalZ), size: .7, obstacleId: obstacle.id } : null;
    }).filter(Boolean);
  const clusters = [], candles = [];
  const covers = obstacles.filter((cover) => !cover.buildingId && cover.width >= 1.8 &&
    cover.depth >= 1.6 && cover.height >= 1.2 && cover.height <= 3.5)
    .sort((a, b) => Math.hypot(a.x, a.z - 10) - Math.hypot(b.x, b.z - 10))
    .slice(0, 12);
  for (const cover of covers) {
    const cos = Math.cos(cover.rotation), sin = Math.sin(cover.rotation);
    const end = -sin * cover.x + cos * (10 - cover.z) >= 0 ? 1 : -1;
    const place = (x, z) => ({ x: cover.x + cos * x + sin * z,
      y: (cover.base || 0) + cover.height + .01, z: cover.z - sin * x + cos * z,
      yaw: Math.atan2(-cover.x, 10 - cover.z), obstacleId: cover.id });
    for (let index = 0; index < (detail > 1 ? 3 : 2); index++) {
      clusters.push({ ...place(-cover.width / 2 + .5 + index * .46, end * (cover.depth / 2 - .45)),
        size: .53 + index % 3 * .08 });
    }
    for (let index = 0; index < (detail > 1 ? 5 : 3); index++) {
      candles.push({ ...place(cover.width / 2 - .28 - index % 2 * .16,
        end * (cover.depth / 2 - .28 - Math.floor(index / 2) * .16)), height: .16 + index % 3 * .07 });
    }
  }
  return { pumpkins, emblems, clusters, candles,
    cemetery: mapId === "wickfall" ? planWickfallDecor(detail) : null };
}

function faceGeometry() {
  const pieces = [];
  for (const side of [-1, 1]) {
    const eye = new THREE.Shape();
    eye.moveTo(side * .14 - .075, .04);
    eye.lineTo(side * .14, .18);
    eye.lineTo(side * .14 + .075, .04);
    eye.closePath();
    pieces.push(new THREE.ShapeGeometry(eye));
  }
  const mouth = new THREE.Shape();
  mouth.moveTo(-.25, -.07);
  mouth.lineTo(-.12, -.11);
  mouth.lineTo(-.08, -.055);
  mouth.lineTo(-.025, -.14);
  mouth.lineTo(.055, -.08);
  mouth.lineTo(.1, -.13);
  mouth.lineTo(.25, -.07);
  mouth.lineTo(.18, -.23);
  mouth.lineTo(-.18, -.23);
  mouth.closePath();
  pieces.push(new THREE.ShapeGeometry(mouth));
  const geometry = mergeGeometries(pieces);
  pieces.forEach((piece) => piece.dispose());
  return geometry;
}

function batGeometry() {
  const shape = new THREE.Shape();
  for (const [index, [x, y]] of [
    [-.7, .23], [-.36, .12], [-.13, .02], [-.08, .14], [0, .07], [.08, .14], [.13, .02],
    [.36, .12], [.7, .23], [.51, -.13], [.28, -.02], [.13, -.15], [0, -.26], [-.13, -.15], [-.28, -.02], [-.51, -.13]
  ].entries()) {
    if (index === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

export function addHalloween(scene, mapId, { detail = 2, pointLights = 0, reducedMotion = false, enabled = true } = {}) {
  const plan = planHalloween(mapId, detail), root = new THREE.Group();
  root.name = "halloween";
  root.visible = enabled;
  scene.add(root);
  const dummy = new THREE.Object3D();
  const meshes = [];
  const instance = (geometry, material, placements, place) => {
    const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
    placements.forEach((item, index) => {
      dummy.position.set(0, 0, 0); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(1);
      place(dummy, item, index);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.computeBoundingSphere();
    root.add(mesh);
    meshes.push(mesh);
    return mesh;
  };
  const skin = new THREE.MeshStandardMaterial({ color: 0xd96d21, roughness: 1, metalness: 0,
    emissive: 0xa53b06, emissiveIntensity: .2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x292119, roughness: 1, metalness: 0 });
  const glow = new THREE.MeshStandardMaterial({ color: 0xffc56a, emissive: 0xff8a26, emissiveIntensity: 2,
    roughness: 1, metalness: 0, side: THREE.DoubleSide });
  const violet = glow.clone();
  violet.color.setHex(0xd0a6ff); violet.emissive.setHex(0x9b59e5);
  const shell = new THREE.SphereGeometry(.48, detail > 1 ? 16 : 12, 8);
  const positions = shell.attributes.position;
  for (let index = 0; index < positions.count; index++) {
    const angle = Math.atan2(positions.getZ(index), positions.getX(index));
    const rib = .94 + Math.cos(angle * 10) * .06;
    positions.setXYZ(index, positions.getX(index) * rib, positions.getY(index) * .8, positions.getZ(index) * rib);
  }
  shell.computeVertexNormals();
  const allPumpkins = [...plan.pumpkins, ...plan.clusters];
  instance(shell, skin, allPumpkins, (object, item) => {
    object.position.set(item.x, item.y + .39 * item.size, item.z);
    object.rotation.y = item.yaw;
    object.scale.setScalar(item.size);
  });
  instance(new THREE.CylinderGeometry(.035, .07, .19, 5), dark, allPumpkins, (object, item) => {
    object.position.set(item.x, item.y + .83 * item.size, item.z);
    object.rotation.z = .2;
    object.scale.setScalar(item.size);
  });
  const face = faceGeometry();
  instance(new THREE.CylinderGeometry(.19, .25, 5, 6), dark, plan.pumpkins, (object, item) => {
    object.position.set(item.x, 2.5, item.z);
  });
  instance(face, glow, allPumpkins, (object, item) => {
    object.position.set(item.x + Math.sin(item.yaw) * .44 * item.size,
      item.y + .4 * item.size, item.z + Math.cos(item.yaw) * .44 * item.size);
    object.rotation.y = item.yaw;
    object.scale.setScalar(item.size);
  });
  instance(new THREE.CircleGeometry(.46, 20), dark, plan.emblems, (object, item) => {
    object.position.set(item.x, item.y, item.z);
    object.rotation.y = item.yaw;
    object.scale.setScalar(item.size);
  });
  instance(face, glow, plan.emblems, (object, item) => {
    object.position.set(item.x + Math.sin(item.yaw) * .004, item.y, item.z + Math.cos(item.yaw) * .004);
    object.rotation.y = item.yaw;
    object.scale.setScalar(item.size);
  });
  if (plan.candles.length) {
    instance(new THREE.CylinderGeometry(.055, .065, 1, 6), new THREE.MeshStandardMaterial({
      color: 0xe7d2a2, roughness: 1, metalness: 0
    }), plan.candles, (object, item) => {
      object.position.set(item.x, item.y + item.height / 2, item.z); object.scale.y = item.height;
    });
    instance(new THREE.SphereGeometry(.055, 5, 4), glow, plan.candles, (object, item) => {
      object.position.set(item.x, item.y + item.height + .055, item.z); object.scale.set(.65, 1.6, .65);
    });
  }
  if (plan.cemetery) {
    const cemetery = addWickfallDecor(root, plan.cemetery, { glow, dark });
    meshes.push(...cemetery.meshes);
  }
  const bulbs = [], bats = [], wire = [];
  for (const axis of ["x", "z"]) for (const sign of [-1, 1]) {
    let previous;
    for (let index = 0; index <= 40; index++) {
      const along = -40 + index * 2;
      const item = { x: axis === "x" ? sign * (ARENA_LIMIT + .6) : along,
        y: 6.2 + Math.abs(Math.cos(index * Math.PI / 10)) * .7,
        z: axis === "z" ? sign * (ARENA_LIMIT + .6) : along,
        yaw: axis === "x" ? -sign * Math.PI / 2 : sign > 0 ? Math.PI : 0 };
      if (previous) wire.push(previous.x, previous.y, previous.z, item.x, item.y, item.z);
      if (index % (detail > 1 ? 1 : 2) === 0) bulbs.push(item);
      if (index % 10 === 5) bats.push({ ...item, y: item.y - .65 });
      previous = item;
    }
  }
  const bulbGeometry = new THREE.OctahedronGeometry(.1);
  for (const [parity, material] of [[0, glow], [1, violet]]) instance(bulbGeometry, material,
    bulbs.filter((_, index) => index % 2 === parity), (object, item) => object.position.set(item.x, item.y - .1, item.z));
  instance(batGeometry(), new THREE.MeshBasicMaterial({ color: 0x1b1020, side: THREE.DoubleSide }),
    bats, (object, item) => { object.position.set(item.x, item.y, item.z); object.rotation.y = item.yaw; });
  root.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute("position",
    new THREE.Float32BufferAttribute(wire, 3)), new THREE.LineBasicMaterial({ color: 0x352738 })));
  const lights = Array.from({ length: Math.min(2, Math.max(0, pointLights)) }, () => {
    const light = new THREE.PointLight(0xff983d, 0, 7, 2);
    root.add(light);
    return light;
  });
  let time = 0, lightUpdate = Infinity;
  const anchors = [...plan.emblems, ...(plan.cemetery?.lanterns || [])];
  const visible = (value) => { root.visible = value; lightUpdate = Infinity; };
  return {
    root, plan, meshes, lights, setEnabled: visible,
    update(dt, camera) {
      if (!root.visible) return;
      time += dt;
      const pulse = reducedMotion ? 1 : 1 + Math.sin(time * 1.7) * .035 + Math.sin(time * 2.3) * .02;
      glow.emissiveIntensity = 2 * pulse;
      violet.emissiveIntensity = 1.6 * pulse;
      lightUpdate += dt;
      if (lightUpdate >= .25) {
        const closest = [...anchors].sort((a, b) =>
          Math.hypot(a.x - camera.x, a.z - camera.z) - Math.hypot(b.x - camera.x, b.z - camera.z));
        lights.forEach((light, index) => {
          const anchor = closest[index];
          light.visible = Boolean(anchor);
          if (anchor) light.position.set(anchor.x + Math.sin(anchor.yaw) * .65, anchor.y,
            anchor.z + Math.cos(anchor.yaw) * .65);
        });
        lightUpdate = 0;
      }
      lights.forEach((light) => { light.intensity = 2.2 * pulse; });
    }
  };
}
