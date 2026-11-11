import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ARENA_LIMIT, canOccupyPosition, getMapObstacles } from "../shared/gameplay.js";
import { desertRidgeGeometry } from "./scene-geometry.js";
import { getTerrainHeight } from "../shared/arena-layout.js";

export function instancedDetail(scene, geometry, material, count, place) {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const transform = new THREE.Object3D();
  for (let index = 0; index < count; index++) {
    transform.position.set(0, 0, 0);
    transform.rotation.set(0, 0, 0);
    transform.scale.set(1, 1, 1);
    place(transform, index, count);
    transform.updateMatrix();
    mesh.setMatrixAt(index, transform.matrix);
  }
  mesh.computeBoundingSphere();
  scene.add(mesh);
  return mesh;
}

export function contactShadowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(0,0,0,.9)");
  gradient.addColorStop(.4, "rgba(0,0,0,.7)");
  gradient.addColorStop(.72, "rgba(0,0,0,.25)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

function stencilMaterial(label, background = "#454b41") {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  context.fillStyle = background;
  context.fillRect(0, 0, 256, 96);
  context.fillStyle = "#e4dfca";
  context.font = "700 26px monospace";
  context.textAlign = "center";
  context.fillText(label, 128, 40);
  context.font = "15px monospace";
  context.fillText("DEADLIGHT OPS / FIELD TEAM", 128, 70);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map, roughness: .9 });
}

export function militaryCoverMaterials(mapId) {
  const harbor = mapId === "harbor";
  const spillway = mapId === "spillway", depot = mapId === "depot";
  return {
    container: (depot ? [0x8d5841, 0x7a6557, 0x565e4b, 0x765746] : [0x527c86, 0x9c6556, 0x818562, 0x6b7f92]).map((color) =>
      new THREE.MeshStandardMaterial({ color, metalness: .25, roughness: .72 })),
    crate: new THREE.MeshStandardMaterial({ color: harbor ? 0x756c54 : 0x777054, roughness: .92 }),
    sandbag: new THREE.MeshStandardMaterial({ color: 0xb4a27c, roughness: 1 }),
    generator: new THREE.MeshStandardMaterial({ color: spillway ? 0x3d6360 : 0x626955, roughness: spillway ? .5 : .7, metalness: .35 }),
    barrier: new THREE.MeshStandardMaterial({ color: spillway ? 0x7b8d89 : harbor ? 0x9c9e91 : 0xc0ae88, roughness: spillway ? .78 : .96 })
  };
}

export function addArenaInteriors(scene, mapId, { lowDetail, buildings, floorMaterial, config }) {
  const steel = new THREE.MeshStandardMaterial({ color: config.cover, roughness: .7, metalness: .3 });
  const light = new THREE.MeshStandardMaterial({
    color: 0xe4eddd, emissive: 0xe4eddd, emissiveIntensity: 1.2, roughness: .6
  });
  const paint = new THREE.MeshBasicMaterial({ color: config.accent, transparent: true, opacity: .72 });
  const beams = [], lamps = [], stripes = [], floors = [], placards = [];
  const sign = stencilMaterial({
    wickfall: "WICKFALL / LANTERN VAULT", foundry: "ASH / SERVICE BAY", tundra: "RELAY / SHELTER", void: "VOID / FIELD LAB",
    harbor: "BW / QUAY OFFICE", outpost: "DUSTLINE / BARRACKS", airfield: "CW / EQUIPMENT BAY",
    citadel: "IRON / GUARDHOUSE", spillway: "BW / MAINTENANCE", depot: "EMBER / SIGNAL ROOM"
  }[mapId]);
  for (const building of buildings) {
    const { x, z, width, depth, height, base = 0, rotation } = building;
    const pose = (lx, y, lz, scale) => ({
      position: [x + Math.cos(rotation) * lx + Math.sin(rotation) * lz, base + y,
        z - Math.sin(rotation) * lx + Math.cos(rotation) * lz],
      scale, rotation: [0, rotation, 0]
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(width - .3, depth - .3), floorMaterial);
    const uv = floor.geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * width / 2.8, uv.getY(i) * depth / 2.8);
    floor.position.set(x, base + .012, z);
    floor.rotation.set(-Math.PI / 2, 0, -rotation);
    floor.updateMatrix();
    floor.geometry.applyMatrix4(floor.matrix);
    floors.push(floor.geometry);
    for (const end of [-1, 1]) {
      const doorWidth = Math.min(3.2, width * .5);
      for (const side of [-1, 1]) beams.push(pose(side * (doorWidth / 2 + .01), 1.3,
        end * depth / 2, [.08, 2.6, .36]));
      beams.push(pose(0, 2.62, end * depth / 2, [doorWidth + .16, .08, .36]));
      const location = pose(0, Math.min(height - .25, 3.02), end * (depth / 2 + .012),
        [Math.min(2.7, width * .6), .4, 1]);
      location.rotation[1] += end === -1 ? Math.PI : 0;
      placards.push(location);
      stripes.push(pose(0, .02, end * (depth / 2 + .25), [doorWidth, .025, .18]));
    }
    for (const offset of [-.25, .25]) {
      beams.push(pose(offset * width, height - .11, 0, [.08, .14, depth - .32]));
      lamps.push(pose(offset * width, height - .22, 0, [1.1, .05, .12]));
    }
  }
  if (floors.length) {
    const floor = new THREE.Mesh(mergeGeometries(floors), floorMaterial);
    floors.forEach(geometry => geometry.dispose());
    floor.receiveShadow = true;
    scene.add(floor);
  }
  for (const [material, items] of [[steel, beams], [light, lamps], [paint, stripes], [sign, placards]]) {
    instancedDetail(scene, material === sign ? new THREE.PlaneGeometry(1, 1) : new THREE.BoxGeometry(1, 1, 1),
      material, items.length, (object, index) => {
      const item = items[index];
      object.position.set(...item.position); object.scale.set(...item.scale); object.rotation.set(...item.rotation);
    });
  }
  if (lowDetail) return null;
  const fill = new THREE.PointLight(config.fill, 0, 8, 2);
  scene.add(fill);
  return (position) => {
    const building = buildings.find(({ x, z, width, depth, base = 0, height, rotation }) => {
      const dx = position.x - x, dz = position.z - z;
      return Math.abs(Math.cos(rotation) * dx - Math.sin(rotation) * dz) < width / 2 &&
        Math.abs(Math.sin(rotation) * dx + Math.cos(rotation) * dz) < depth / 2 &&
        position.y > base && position.y < base + height;
    });
    fill.intensity = building ? 1.1 : 0;
    if (building) fill.position.set(building.x, (building.base || 0) + 2.4, building.z);
  };
}

export function addArenaSurfaceDetail(scene, mapId) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(0, 128, 0, 0);
  gradient.addColorStop(0, "rgba(255,255,255,.55)");
  gradient.addColorStop(.45, "rgba(255,255,255,.15)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  for (let index = 0; index < 160; index++) {
    context.clearRect((index * 73) % 128, (index * 37) % 128, 1 + index % 3, 2 + index % 9);
  }
  const map = new THREE.CanvasTexture(canvas);
  const grime = new THREE.MeshStandardMaterial({
    map, color: mapId === "tundra" ? 0x798b87 : mapId === "outpost" ? 0x766047 : 0x41433c,
    transparent: true, opacity: .6, roughness: 1, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
  });
  const strips = [];
  for (const obstacle of getMapObstacles(mapId)) {
    if (["roof", "furniture"].includes(obstacle.kind) || obstacle.height < .5) continue;
    const height = Math.min(.6, obstacle.height * .35), { x, z, rotation, base = 0 } = obstacle;
    for (let side = 0; side < 4; side++) {
      const across = side < 2;
      const sign = side % 2 ? 1 : -1;
      const lx = across ? 0 : sign * (obstacle.width / 2 + .002);
      const lz = across ? sign * (obstacle.depth / 2 + .002) : 0;
      strips.push({
        x: x + Math.cos(rotation) * lx + Math.sin(rotation) * lz,
        z: z - Math.sin(rotation) * lx + Math.cos(rotation) * lz,
        y: base + height / 2, height, width: across ? obstacle.width : obstacle.depth,
        rotation: rotation + (across ? sign < 0 ? Math.PI : 0 : sign < 0 ? -Math.PI / 2 : Math.PI / 2)
      });
    }
  }
  const mesh = instancedDetail(scene, new THREE.PlaneGeometry(1, 1), grime, strips.length, (object, index) => {
    const strip = strips[index];
    object.position.set(strip.x, strip.y, strip.z);
    object.scale.set(strip.width, strip.height, 1);
    object.rotation.y = strip.rotation;
  });
  mesh.renderOrder = 1;
  return mesh;
}

export function addMilitaryArena(scene, mapId, { lowDetail, rotors, materials }) {
  const harbor = mapId === "harbor";
  const box = new THREE.BoxGeometry(1, 1, 1);
  const plane = new THREE.PlaneGeometry(1, 1);
  const steel = new THREE.MeshStandardMaterial({ color: 0x444b47, roughness: .65, metalness: .65 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x232b28, roughness: .82 });
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d");
  context.strokeStyle = "#a0a8a2";
  context.lineWidth = 2;
  for (let offset = -64; offset <= 128; offset += 16) {
    context.beginPath();
    context.moveTo(offset, 0); context.lineTo(offset + 64, 64);
    context.moveTo(offset, 0); context.lineTo(offset - 64, 64);
    context.stroke();
  }
  const fenceTexture = new THREE.CanvasTexture(canvas);
  fenceTexture.wrapS = fenceTexture.wrapT = THREE.RepeatWrapping;
  fenceTexture.repeat.set(42, 2);
  const fenceMaterial = new THREE.MeshStandardMaterial({
    map: fenceTexture, alphaTest: .3, side: THREE.DoubleSide, roughness: .8, metalness: .4
  });
  const poses = [];
  const addBox = (material, position, scale, rotation = [0, 0, 0]) => {
    const mesh = new THREE.Mesh(box, material);
    mesh.position.set(...position);
    mesh.scale.set(...scale);
    mesh.rotation.set(...rotation);
    mesh.castShadow = !lowDetail;
    mesh.receiveShadow = !lowDetail;
    scene.add(mesh);
    return mesh;
  };
  const batch = (geometry, material, items) => {
    if (!items.length) return;
    const mesh = instancedDetail(scene, geometry, material, items.length, (object, index) => {
      const item = items[index];
      object.position.set(...item.position);
      object.scale.set(...(item.scale || [1, 1, 1]));
      object.rotation.set(...(item.rotation || [0, 0, 0]));
    });
    mesh.castShadow = !lowDetail;
    mesh.receiveShadow = !lowDetail;
    return mesh;
  };
  const facePose = (obstacle, x, y, z, scale) => ({
    position: [
      obstacle.x + Math.cos(obstacle.rotation) * x + Math.sin(obstacle.rotation) * z,
      (obstacle.base || 0) + y,
      obstacle.z - Math.sin(obstacle.rotation) * x + Math.cos(obstacle.rotation) * z
    ],
    scale, rotation: [0, obstacle.rotation, 0]
  });
  for (let side = 0; side < 4; side++) {
    const horizontal = side < 2;
    const edge = (side % 2 ? 1 : -1) * (ARENA_LIMIT + .4);
    const fence = new THREE.Mesh(new THREE.PlaneGeometry(84, 4.4), fenceMaterial);
    fence.position.set(horizontal ? 0 : edge, 2.8, horizontal ? edge : 0);
    fence.rotation.y = horizontal ? 0 : Math.PI / 2;
    scene.add(fence);
    addBox(materials.barrier, [horizontal ? 0 : edge, .3, horizontal ? edge : 0],
      horizontal ? [84, .6, .8] : [.8, .6, 84]);
    for (let index = -6; index <= 6; index++) {
      poses.push({
        position: [horizontal ? index * 7 : edge, 2.5, horizontal ? edge : index * 7],
        scale: [.12, 5, .12]
      });
    }
  }
  batch(box, steel, poses);

  const ribs = [], bags = [], markings = [];
  const corrugations = materials.container.map(() => []);
  const cargoSign = stencilMaterial(mapId === "depot" ? "EMBER / FREIGHT" : "BW / CARGO 04", "#334749");
  for (const [obstacleIndex, obstacle] of getMapObstacles(mapId).entries()) {
    if (obstacle.buildingId) continue;
    if (obstacle.kind === "container") {
      const vertical = obstacle.depth > obstacle.width;
      const span = vertical ? obstacle.depth : obstacle.width;
      for (const side of [-1, 1]) {
        for (let offset = -span / 2 + .3; offset < span / 2 - .2; offset += lowDetail ? .8 : .45) {
          corrugations[obstacleIndex % materials.container.length].push(facePose(obstacle,
            vertical ? side * (obstacle.width / 2 - .04) : offset,
            obstacle.height / 2,
            vertical ? offset : side * (obstacle.depth / 2 - .04),
            vertical ? [.08, obstacle.height - .16, .08] : [.08, obstacle.height - .16, .08]));
        }
      }
      for (const offset of [-.8, -.3, .3, .8]) {
        ribs.push(facePose(obstacle,
          vertical ? offset : obstacle.width / 2 - .01,
          obstacle.height / 2,
          vertical ? obstacle.depth / 2 - .01 : offset,
          vertical ? [.035, obstacle.height - .15, .04] : [.04, obstacle.height - .15, .035]));
      }
      for (const side of [-1, 1]) {
        for (const height of [.07, obstacle.height - .07]) {
          ribs.push(facePose(obstacle, 0, height, side * (obstacle.depth / 2 - .045),
            [obstacle.width, .1, .09]));
        }
        ribs.push(facePose(obstacle, side * (obstacle.width / 2 - .045), obstacle.height / 2, 0,
          [.09, obstacle.height - .1, obstacle.depth]));
      }
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(vertical ? 1.25 : 2.1, .58), cargoSign);
      const pose = facePose(obstacle, 0, 1.6, obstacle.depth / 2 + .006, [1, 1, 1]);
      sign.position.set(...pose.position);
      sign.rotation.y = obstacle.rotation;
      scene.add(sign);
    } else if (obstacle.kind === "sandbag") {
      const columns = Math.ceil(obstacle.width / .95);
      const rows = Math.ceil(obstacle.height / .3);
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          for (const side of [-1, 1]) {
            bags.push(facePose(obstacle,
              -obstacle.width / 2 + (column + .5) * obstacle.width / columns,
              (row + .5) * obstacle.height / rows,
              side * (obstacle.depth / 2 - .32),
              [obstacle.width / columns * .97, obstacle.height / rows * .98, .64]));
          }
        }
      }
    } else {
      for (let row = 0; row < 4; row++) {
        ribs.push(facePose(obstacle, 0, .15 + row * (obstacle.height - .3) / 3,
          obstacle.depth / 2 - .01, [obstacle.width - .08, .045, .025]));
      }
    }
  }
  batch(box, steel, ribs);
  corrugations.forEach((items, index) => batch(box, materials.container[index], items));
  batch(new RoundedBoxGeometry(1, 1, 1, 1, .1), materials.sandbag, bags);
  const paint = new THREE.MeshBasicMaterial({
    color: harbor ? 0xd5b957 : 0xddd0a5, transparent: true, opacity: .38, depthWrite: false
  });
  for (let index = 0; index < 18; index++) {
    const x = harbor ? -34 + index % 2 * 68 : -16 + index % 2 * 32;
    const z = -30 + Math.floor(index / 2) * 7;
    markings.push({ position: [x, getTerrainHeight(mapId, x, z) + .014, z], scale: [.14, 3.6, 1], rotation: [-Math.PI / 2, 0, 0] });
  }
  batch(plane, paint, markings);
  if (harbor) addHarbor();
  else if (mapId === "airfield") addAirfield();
  else if (mapId === "citadel") addCitadel();
  else if (mapId === "spillway") addSpillway();
  else if (mapId === "depot") addDepot();
  else addOutpost();
  return makeWeather();

  function addSpillway() {
    const water = new THREE.MeshStandardMaterial({ color: 0x397f7a, roughness: .32, metalness: .15 });
    addBox(water, [0, -.12, -52], [124, .12, 14]);
    for (const x of [-54, 54]) {
      addBox(materials.barrier, [x, 6, 0], [12, 12, 100]);
      for (const z of [-28, 0, 28]) {
        addBox(steel, [x, 10, z], [12.1, .18, 6]);
        addBox(materials.generator, [x, 12, z], [5, 4, 5]);
      }
    }
    const pipes = [];
    for (const side of [-1, 1]) for (let index = 0; index < 6; index++) {
      pipes.push({ position: [side * 49, 3, -35 + index * 14], scale: [3, 5, 3] });
    }
    batch(new THREE.CylinderGeometry(1, 1, 1, lowDetail ? 8 : 12), steel, pipes);
    const housings = [], hubs = [];
    for (const obstacle of getMapObstacles(mapId).filter((item) => item.kind === "generator")) {
      const radius = Math.min(.9, obstacle.height * .3);
      housings.push(facePose(obstacle, 0, obstacle.height * .55, obstacle.depth / 2 - .1, [radius, radius, .18]));
      hubs.push(facePose(obstacle, 0, obstacle.height * .55, obstacle.depth / 2 - .018, [radius * .38, radius * .38, .024]));
    }
    batch(new THREE.CylinderGeometry(1, 1, 1, lowDetail ? 10 : 16).rotateX(Math.PI / 2), steel, housings);
    batch(new THREE.CylinderGeometry(1, 1, 1, 10).rotateX(Math.PI / 2), dark, hubs);
  }

  function addDepot() {
    const track = [], sleepers = [];
    for (const lane of [-24, 24]) {
      for (const offset of [-1.2, 1.2]) track.push({ position: [lane + offset, .023, 0], scale: [.08, .06, 82] });
      for (let index = 0; index < 40; index++) sleepers.push({ position: [lane, .016, -39 + index * 2], scale: [3.7, .04, .22] });
    }
    batch(box, dark, sleepers);
    batch(box, steel, track);
    for (const z of [-44, 44]) {
      addBox(steel, [0, 9, z], [74, .35, .35]);
      for (const x of [-37, 37]) addBox(steel, [x, 4.5, z], [.35, 9, .35]);
      for (const x of [-24, 24]) {
        addBox(dark, [x, 8.6, z + .2], [.9, 1.2, .2]);
        const signal = new THREE.MeshBasicMaterial({ color: z < 0 ? 0xb24732 : 0x79c994 });
        addBox(signal, [x, 8.6, z + .32], [.22, .22, .02]);
      }
    }
    for (const x of [-53, 53]) {
      addBox(materials.container[1], [x, 2, 0], [3.4, 4, 32]);
      addBox(steel, [x, .45, 0], [4, .3, 35]);
    }
  }
  function addAirfield() {
    const runway = [];
    for (let index = 0; index < 20; index++) {
      runway.push({ position: [0, .019, -37 + index * 3.8], scale: [.3, 2.1, 1], rotation: [-Math.PI / 2, 0, 0] });
    }
    batch(plane, new THREE.MeshBasicMaterial({ color: 0xe9e6c8 }), runway);
    for (const x of [-55, 55]) {
      addBox(materials.barrier, [x, 6, -20], [18, 12, 30]);
      addBox(steel, [x, 12.1, -20], [19, .25, 31]);
      addBox(dark, [x + (x < 0 ? 9.01 : -9.01), 4, -20], [.02, 7, 12]);
    }
    const aircraft = new THREE.MeshStandardMaterial({ color: 0x687d80, metalness: .45, roughness: .62 });
    for (const x of [-54, 54]) {
      addBox(aircraft, [x, 2, 25], [2.4, 2, 18]);
      addBox(aircraft, [x, 2.3, 26], [16, .28, 5], [0, .12, 0]);
      addBox(steel, [x, 3.7, 32], [.2, 3.8, 3.6], [.25, 0, 0]);
      addBox(dark, [x, 2.9, 19], [1.4, .7, 3]);
    }
    const tower = new THREE.MeshStandardMaterial({ color: 0x97a5a4, roughness: .8 });
    addBox(tower, [10, 12, -55], [5, 24, 5]);
    addBox(steel, [10, 24, -55], [9, .8, 9]);
    addBox(dark, [10, 22.8, -55], [8.5, 2, 8.5]);
    const lights = Array.from({ length: lowDetail ? 16 : 32 }, (_, index) => ({
      position: [index % 2 ? 7 : -7, .08, -36 + Math.floor(index / 2) * (lowDetail ? 9 : 4.5)],
      scale: [.13, .12, .13]
    }));
    batch(box, new THREE.MeshBasicMaterial({ color: 0xa4d3e5 }), lights);
  }

  function addCitadel() {
    const concrete = new THREE.MeshStandardMaterial({ color: 0x99958b, roughness: .94 });
    for (const x of [-50, 50]) {
      for (const z of [-50, 50]) {
        addBox(concrete, [x, 8, z], [9, 16, 9]);
        addBox(steel, [x, 16.2, z], [10, .4, 10]);
        addBox(dark, [x, 13.5, z + (z < 0 ? 4.51 : -4.51)], [6, 1.3, .015]);
        addBox(materials.generator, [x, 18, z], [2, 3.2, 2]);
      }
      addBox(concrete, [x, 5, 0], [3, 10, 90]);
    }
    addBox(concrete, [0, 5, -50], [90, 10, 3]);
    addBox(concrete, [0, 4, 50], [90, 8, 3]);
    const beams = [];
    for (let index = 0; index < 8; index++) {
      beams.push({ position: [-35 + index * 10, 11, -50], scale: [1, 2, 2.8] });
    }
    batch(box, materials.barrier, beams);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(.12, .18, 12, 8), steel);
    mast.position.set(0, 17, -54);
    scene.add(mast);
    const signal = new THREE.Mesh(new THREE.SphereGeometry(.2, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xf09b68 }));
    signal.position.set(0, 23.1, -54);
    scene.add(signal);
  }

  function addHarbor() {
    const cranePaint = new THREE.MeshStandardMaterial({ color: 0xb89952, roughness: .65, metalness: .45 });
    const craneParts = [];
    for (const x of [-25, 22]) {
      for (const dx of [-8, 8]) {
        for (const z of [-51, -58]) craneParts.push({ position: [x + dx, 12, z], scale: [.85, 24, .85] });
        craneParts.push({ position: [x + dx, 12, -54.5], scale: [.25, 24, .25], rotation: [.26, 0, 0] });
      }
      craneParts.push({ position: [x, 24, -54.5], scale: [22, 1.3, 8] });
      craneParts.push({ position: [x + 7, 26, -42], scale: [.7, .7, 32] });
      craneParts.push({ position: [x + 7, 19, -39], scale: [.07, 13, .07] });
      craneParts.push({ position: [x + 7, 12.5, -39], scale: [5, .35, 2.6] });
      for (const height of [6, 12, 18]) {
        for (const dx of [-8, 8]) {
          craneParts.push({ position: [x + dx, height, -54.5], scale: [.24, .24, 7.6] });
          craneParts.push({ position: [x + dx, height + 3, -54.5], scale: [.16, 9.2, .16], rotation: [.85, 0, 0] });
        }
      }
      addBox(dark, [x - 5, 25.5, -53], [3, 2.2, 3.3]);
    }
    batch(box, cranePaint, craneParts);
    addBox(materials.container[1], [58, 2, -9], [16, 8, 49]);
    addBox(materials.container[0], [58, 6.2, -9], [15.5, .5, 48]);
    const cabin = new THREE.MeshStandardMaterial({ color: 0xb9bcb0, roughness: .7 });
    addBox(cabin, [58, 10, 6], [10, 8, 13]);
    addBox(dark, [58, 15, 9], [3, 5, 3]);
    addBox(steel, [58, 22, 0], [.2, 15, .2]);
    addBox(steel, [58, 25, 0], [7, .16, .16]);
    const windows = Array.from({ length: 6 }, (_, index) => ({
      position: [52.98, 12, 1.5 + index * 1.6], scale: [.025, 1.3, 1.1]
    }));
    batch(box, new THREE.MeshStandardMaterial({ color: 0x293e43, metalness: .35, roughness: .22 }), windows);
    addBox(materials.container[2], [-55, 6, 6], [18, 12, 29]);
    addBox(steel, [-55, 12.15, 6], [19, .3, 30]);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(230, 230),
      new THREE.MeshPhysicalMaterial({ color: 0x365863, roughness: .28, metalness: .35, clearcoat: .7 }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = -.32;
    scene.add(water);
    const puddles = [];
    for (let index = 0; index < (lowDetail ? 8 : 18); index++) {
      const x = Math.sin(index * 4.7) * 30;
      const z = Math.cos(index * 2.1) * 30;
      if (!canOccupyPosition(mapId, { x, y: 1, z }, 2)) continue;
      puddles.push({ position: [x, .009, z], scale: [2 + index % 3, .7 + index % 2, 1], rotation: [-Math.PI / 2, 0, index] });
    }
    const puddleCanvas = document.createElement("canvas");
    puddleCanvas.width = puddleCanvas.height = 128;
    const puddleContext = puddleCanvas.getContext("2d");
    const sheen = puddleContext.createRadialGradient(64, 64, 16, 64, 64, 64);
    sheen.addColorStop(0, "#ffffff");
    sheen.addColorStop(.65, "#ffffffe0");
    sheen.addColorStop(1, "#ffffff00");
    puddleContext.fillStyle = sheen;
    puddleContext.beginPath();
    for (let index = 0; index <= 40; index++) {
      const angle = index / 40 * Math.PI * 2;
      const radius = 49 + Math.sin(angle * 5) * 8 + Math.sin(angle * 9) * 4;
      const x = 64 + Math.cos(angle) * radius, y = 64 + Math.sin(angle) * radius;
      if (index === 0) puddleContext.moveTo(x, y);
      else puddleContext.lineTo(x, y);
    }
    puddleContext.closePath();
    puddleContext.fill();
    const puddleTexture = new THREE.CanvasTexture(puddleCanvas);
    puddleTexture.colorSpace = THREE.SRGBColorSpace;
    batch(plane, new THREE.MeshPhysicalMaterial({
      map: puddleTexture, transparent: true, depthWrite: false,
      color: 0x4a626a, roughness: .18, metalness: .12, clearcoat: 1
    }), puddles);
  }

  function addOutpost() {
    const tan = new THREE.MeshStandardMaterial({ color: 0xb6a17c, roughness: .94 });
    const ridges = new THREE.Mesh(desertRidgeGeometry(lowDetail),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    scene.add(ridges);
    const towerParts = [];
    for (const x of [-2.8, 2.8]) {
      for (const z of [-55.8, -50.2]) towerParts.push({ position: [x, 12, z], scale: [.35, 24, .35] });
    }
    for (let height = 4; height <= 24; height += 4) {
      towerParts.push({ position: [0, height, -53], scale: [6.2, .18, 6.2] });
      towerParts.push({ position: [0, height - 2, -50.2], scale: [7, .15, .15], rotation: [0, 0, .55] });
    }
    batch(box, steel, towerParts);
    const radar = new THREE.Group();
    radar.position.set(0, 27, -53);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(4.3, lowDetail ? 12 : 24, 10, 0, Math.PI * 2, 0, Math.PI * .42),
      new THREE.MeshStandardMaterial({ color: 0xd1cebf, roughness: .5, metalness: .35, side: THREE.DoubleSide }));
    dish.rotation.x = .9;
    const support = new THREE.Mesh(new THREE.CylinderGeometry(.14, .22, 5.8, 8), steel);
    support.rotation.x = .9;
    radar.add(dish, support);
    scene.add(radar);
    rotors.push({ object: radar, axis: "y", speed: .09 });
    addBox(tan, [51, 3, 19], [12, 6, 16]);
    addBox(materials.generator, [-50, 2, 24], [9, 4, 6]);
    addBox(steel, [-50, 12, 24], [.2, 24, .2]);
    addBox(steel, [-50, 21, 24], [5, .15, .15]);
    addBox(steel, [47, 9, -16], [.12, 18, .12]);
    const sock = new THREE.Mesh(new THREE.CylinderGeometry(.2, .45, 2.6, 8),
      new THREE.MeshStandardMaterial({ color: 0xbf744c, roughness: .92, side: THREE.DoubleSide }));
    sock.position.set(48.2, 17.4, -16);
    sock.rotation.z = Math.PI / 2 + .13;
    scene.add(sock);
  }

  function makeWeather() {
    const rainy = harbor || mapId === "spillway";
    const count = lowDetail ? 100 : rainy ? 260 : 180;
    const positions = new Float32Array(count * (rainy ? 6 : 3));
    for (let index = 0; index < count; index++) {
      const base = index * (rainy ? 6 : 3);
      positions[base] = Math.random() * 88 - 44;
      positions[base + 1] = Math.random() * (rainy ? 18 : 6);
      positions[base + 2] = Math.random() * 88 - 44;
      if (rainy) {
        positions[base + 3] = positions[base] + .09;
        positions[base + 4] = positions[base + 1] + .48;
        positions[base + 5] = positions[base + 2];
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const weather = rainy
      ? new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
        color: 0xd4e2e5, transparent: true, opacity: .2, depthWrite: false
      }))
      : new THREE.Points(geometry, new THREE.PointsMaterial({
        color: 0xddc6a0, size: .12, transparent: true, opacity: .18, depthWrite: false
      }));
    weather.frustumCulled = false;
    scene.add(weather);
    return {
      update(dt) {
        for (let index = 0; index < count; index++) {
          const base = index * (rainy ? 6 : 3);
          if (rainy) {
            positions[base + 1] -= dt * 12;
            if (positions[base + 1] < 0) positions[base + 1] += 18;
            positions[base + 3] = positions[base] + .09;
            positions[base + 4] = positions[base + 1] + .48;
          } else {
            positions[base] += dt * 2.2;
            if (positions[base] > 44) positions[base] -= 88;
          }
        }
        geometry.attributes.position.needsUpdate = true;
      }
    };
  }
}
