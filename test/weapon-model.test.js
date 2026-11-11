import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "three";
import { WEAPONS } from "../shared/weapons.js";
import { createWeaponModel, weaponLayout } from "../src/weapon-model.js";
import { createWeaponHands, updateWeaponHands } from "../src/weapon-hands.js";
import { acquireDroppedMagazine } from "../src/magazine.js";
import { reloadPose } from "../src/reload.js";
import { decodeTacticalBody } from "../src/tactical-body.js";
import { disposeSceneResources } from "../src/scene-resources.js";
import { weaponViewPose } from "../src/weapon-pose.js";
import { tacticalClothDetail, tacticalClothTexture } from "../src/tactical-outfit.js";
import { handGripOrientation } from "../src/limb-ik.js";
import { weaponFinishMaps } from "../src/surface-finish.js";

const bytes = fs.readFileSync(new URL("../public/models/tactical-body.bin", import.meta.url));
const body = decodeTacticalBody(JSON.parse(fs.readFileSync(
  new URL("../public/models/tactical-body.json", import.meta.url))),
bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

function fingertipVertex(hands, name) {
  const joint = hands.bones.findIndex((bone) => bone.name === name);
  const direction = hands.definitions[joint].position.clone().sub(
    hands.definitions[hands.definitions[joint].parent].position).normalize();
  const { position, skinIndex } = hands.skin.geometry.attributes;
  let selected = -1, furthest = -Infinity;
  for (let vertex = 0; vertex < position.count; vertex++) {
    if (skinIndex.getX(vertex) !== joint) continue;
    const along = new THREE.Vector3().fromBufferAttribute(position, vertex)
      .sub(hands.definitions[joint].position).dot(direction);
    if (along > furthest) { selected = vertex; furthest = along; }
  }
  assert.ok(selected >= 0, name);
  return selected;
}

test("first-person gloves preserve the body asset, fit human-scale palms and own their surface maps", () => {
  const before = body.definitions.map(({ position }) => position.toArray());
  const hands = createWeaponHands(body, "tundra"), detail = tacticalClothDetail();
  const wrist = hands.definitions.find(({ name }) => name === "hand_r");
  const knuckle = hands.definitions.find(({ name }) => name === "middle_01_r");
  assert.ok(knuckle.position.distanceTo(wrist.position) > .1 && knuckle.position.distanceTo(wrist.position) < .11);
  assert.deepEqual(body.definitions.map(({ position }) => position.toArray()), before);
  assert.ok(hands.skin.geometry.attributes.position.count / 3 < 3_000);
  const maps = hands.skin.material.flatMap((material) => [material.map, material.normalMap, material.roughnessMap]);
  assert.equal(new Set(maps).size, 6);
  let sharedDisposed = false, disposed = 0;
  for (const map of [detail.normalMap, detail.roughnessMap]) {
    map.addEventListener("dispose", () => { sharedDisposed = true; });
    assert.ok(!maps.includes(map));
  }
  for (const map of maps) map.addEventListener("dispose", () => { disposed++; });
  hands.skeleton.dispose();
  disposeSceneResources(hands.root);
  assert.equal(disposed, 6);
  assert.equal(sharedDisposed, false);
});

test("first-person sleeves use dark arena-adapted camouflage and gloves retain a distinct matte finish", () => {
  for (const mapId of ["foundry", "tundra", "void", "harbor", "outpost", "airfield", "citadel", "spillway", "depot"]) {
    const hands = createWeaponHands(body, mapId);
    const [sleeve, glove] = hands.skin.material;
    assert.deepEqual(sleeve.map.image.data, tacticalClothTexture(true).image.data);
    assert.notDeepEqual(sleeve.map.image.data, glove.map.image.data);
    assert.ok(sleeve.roughness >= .9 && glove.roughness >= .85);
    assert.equal(hands.skin.geometry.groups.length, 2, "cuffs and stitches add no draw calls");
    assert.ok(hands.skin.geometry.attributes.position.count / 3 < 3000);
    const colors = hands.skin.geometry.attributes.color;
    for (let vertex = 0; vertex < colors.count; vertex++) {
      assert.ok(Math.max(colors.getX(vertex), colors.getY(vertex), colors.getZ(vertex)) < .4,
        "sleeves and gloves are not over-bright white");
    }
    hands.skeleton.dispose();
    disposeSceneResources(hands.root);
  }
});

test("fitted wrist gussets blend the correct forearm and hand through every reload without extra draw groups", () => {
  const full = createWeaponHands(body, "foundry");
  const low = createWeaponHands(body, "foundry", "standard", { compact: true });
  assert.ok(low.skin.geometry.attributes.position.count < full.skin.geometry.attributes.position.count);
  for (const hands of [full, low]) {
    const { skinIndex, skinWeight, position } = hands.skin.geometry.attributes;
    assert.equal(hands.skin.geometry.groups.length, 2);
    for (const arm of hands.arms) {
      const vertices = [];
      for (let vertex = 0; vertex < position.count; vertex++) {
        if (skinIndex.getX(vertex) !== arm.hand || skinIndex.getY(vertex) !== arm.forearm || skinWeight.getY(vertex) === 0) continue;
        const sum = skinWeight.getX(vertex) + skinWeight.getY(vertex) + skinWeight.getZ(vertex) + skinWeight.getW(vertex);
        assert.ok(Math.abs(sum - 1) < 1e-6);
        assert.ok(skinWeight.getX(vertex) >= 0 && skinWeight.getY(vertex) <= 1);
        vertices.push(vertex);
      }
      assert.ok(vertices.length > 100, `${arm.suffix}: a continuous articulated cuff, not a rigid bracelet`);
      const gun = createWeaponModel("rifle");
      for (const progress of [0, .24, .43, .65, .78, .91, 1]) {
        updateWeaponHands(hands, gun.root, gun.layout, reloadPose(progress, progress > 0, "empty", gun.layout.mount, gun.layout));
        hands.root.updateMatrixWorld(true);
        const wrist = hands.bones[arm.hand].getWorldPosition(new THREE.Vector3());
        for (const vertex of vertices) {
          const point = new THREE.Vector3().fromBufferAttribute(position, vertex);
          hands.skin.applyBoneTransform(vertex, point).applyMatrix4(hands.skin.matrixWorld);
          assert.ok(point.toArray().every(Number.isFinite));
          assert.ok(point.distanceTo(wrist) < .080, `${arm.suffix}: cuff separates from wrist at ${progress}`);
        }
      }
      disposeSceneResources(gun.root);
    }
    hands.skeleton.dispose();
    disposeSceneResources(hands.root);
  }
});

test("actual skinned fingertips contact the trigger and wrap the grip on every equipped firearm", () => {
  const hands = createWeaponHands(body, "tundra");
  const contacts = [
    ["index_02_r", [.003, -.069, -.020], .006],
    ["middle_02_r", [-.024, -.095, .073], .008],
    ["ring_02_r", [-.024, -.124, .079], .008],
    ["pinky_02_r", [-.024, -.143, .085], .008],
    ["thumb_02_r", [-.023, -.043, .050], .008]
  ].map(([name, point, tolerance]) => ({ name, vertex: fingertipVertex(hands, name), point: new THREE.Vector3(...point), tolerance }));
  for (const id of Object.keys(WEAPONS)) {
    const gun = createWeaponModel(id);
    gun.root.position.set(.1, -.2, -.4);
    gun.root.rotation.set(.12, .15, -.07);
    updateWeaponHands(hands, gun.root, gun.layout, reloadPose(0, false, "empty", gun.layout.mount, gun.layout));
    hands.root.updateMatrixWorld(true);
    for (const { name, vertex, point, tolerance } of contacts) {
      const fingertip = new THREE.Vector3().fromBufferAttribute(hands.skin.geometry.attributes.position, vertex);
      hands.skin.applyBoneTransform(vertex, fingertip).applyMatrix4(hands.skin.matrixWorld);
      gun.root.worldToLocal(fingertip);
      assert.ok(fingertip.distanceTo(point) < tolerance, `${id}: ${name} at ${fingertip.toArray()}`);
    }
    disposeSceneResources(gun.root);
  }
  hands.skeleton.dispose();
  disposeSceneResources(hands.root);
});

test("posing hands updates their world transform without traversing the old skeleton pose", () => {
  const hands = createWeaponHands(body, "tundra"), gun = createWeaponModel("rifle");
  const parent = new THREE.Group();
  parent.position.set(1, 2, 3);
  parent.rotation.y = .4;
  parent.add(hands.root, gun.root);
  let visits = 0;
  for (const bone of hands.bones) {
    const update = bone.updateWorldMatrix;
    bone.updateWorldMatrix = function (...args) { visits++; return update.apply(this, args); };
  }
  updateWeaponHands(hands, gun.root, gun.layout, reloadPose(0, false, "empty", gun.layout.mount, gun.layout));
  assert.equal(visits, 0, "the renderer will traverse the final bone pose once");
  assert.ok(hands.root.matrixWorld.elements.every(Number.isFinite));
  parent.updateMatrixWorld(true);
  for (const arm of hands.arms) {
    const socket = arm.suffix === "r" ? gun.layout.right : gun.layout.support;
    const target = gun.root.localToWorld(new THREE.Vector3(socket.x, socket.y, socket.z));
    assert.ok(hands.bones[arm.hand].getWorldPosition(new THREE.Vector3()).distanceTo(target) < .003);
  }
  hands.skeleton.dispose();
  disposeSceneResources(parent);
});

test("magazine grips rotate smoothly, with overhand top loaders and side-held boxes and drums", () => {
  const hands = createWeaponHands(body, "tundra"), arm = hands.arms[1];
  for (const id of Object.keys(WEAPONS)) {
    const gun = createWeaponModel(id), pose = reloadPose(.24, true, "empty", gun.layout.mount, gun.layout);
    let previous;
    for (let step = 0; step <= 100; step++) {
      updateWeaponHands(hands, gun.root, gun.layout, { ...pose, grip: step / 100, handRoll: 0 });
      hands.root.updateMatrixWorld(true);
      const orientation = hands.bones[arm.hand].getWorldQuaternion(new THREE.Quaternion());
      assert.ok(orientation.toArray().every(Number.isFinite));
      if (previous) assert.ok(orientation.angleTo(previous) < .04, `${id}: grip turn at ${step}`);
      previous = orientation;
    }
    const palm = arm.palmNormal.clone().transformDirection(hands.bones[arm.hand].matrixWorld);
    if (gun.layout.mount === "top") assert.ok(palm.y < -.9, "top-loader palm faces down onto the magazine");
    if (gun.layout.wideMagazine) assert.ok(palm.x > .99, `${id}: palm presses the left magazine face`);
    disposeSceneResources(gun.root);
  }
  hands.skeleton.dispose();
  disposeSceneResources(hands.root);
});

test("hand orientation aligns the palm and finger row rather than leaving grip roll arbitrary", () => {
  const forward = new THREE.Vector3(1, -.2, .1).normalize();
  const side = new THREE.Vector3(.1, .2, 1).normalize();
  for (const [direction, axis] of [
    [[-.35, .25, -.9], [0, 1, 0]],
    [[.95, .15, -.25], [0, 0, -1]],
    [[.95, .15, -.25], [0, 1, 0]]
  ]) {
    const targetForward = new THREE.Vector3(...direction).normalize();
    const targetSide = new THREE.Vector3(...axis);
    const orientation = handGripOrientation(forward, side, targetForward, targetSide, new THREE.Quaternion());
    assert.ok(forward.clone().applyQuaternion(orientation).distanceTo(targetForward) < 1e-9);
    const row = side.clone().applyQuaternion(orientation).projectOnPlane(targetForward).normalize();
    assert.ok(row.distanceTo(targetSide.projectOnPlane(targetForward).normalize()) < 1e-9);
    assert.ok(Math.abs(orientation.length() - 1) < 1e-9);
  }
});

test("all firearms use finite, human-scale geometry with bounded draw calls", () => {
  for (const id of Object.keys(WEAPONS)) for (const compact of [false, true]) {
    const gun = createWeaponModel(id, { compact });
    const bounds = new THREE.Box3().setFromObject(gun.root), size = bounds.getSize(new THREE.Vector3());
    assert.ok(size.z > (gun.layout.sidearm ? .25 : .5) && size.z < (gun.layout.sidearm ? .45 : 1.1), `${id}: length ${size.z}`);
    assert.ok(size.x < .17 && size.y < .37, `${id}: width/height`);
    assert.ok(Math.abs(bounds.min.z + gun.layout.muzzle) < .01, id);
    assert.deepEqual(gun.magazine.position.toArray(), ["x", "y", "z"].map((axis) => gun.layout.magazine[axis]));
    let calls = 0, triangles = 0;
    gun.root.traverse((object) => {
      if (!object.isMesh) return;
      calls++;
      triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
      assert.ok([...object.geometry.attributes.position.array].every(Number.isFinite));
      assert.equal(object.material.depthTest, true);
      if (object.material.userData.weaponSurface === "hardware") {
        assert.ok(object.material.map?.isDataTexture && object.material.normalMap?.isDataTexture &&
          object.material.roughnessMap?.isDataTexture, `${id}: detailed finish in both quality profiles`);
      }
    });
    assert.ok(calls <= 14, `${id}: ${calls} calls`);
    assert.ok(triangles < (compact ? 1_400 : 3_000), `${id}: ${triangles} triangles`);
    disposeSceneResources(gun.root);
  }
  assert.throws(() => weaponLayout("unknown"), RangeError);
});

test("firearm finishes are deterministic, mipmapped and distinguish matte polymer from worn metal", () => {
  const metal = weaponFinishMaps(), repeated = weaponFinishMaps(), polymer = weaponFinishMaps(true);
  assert.deepEqual(metal.map.image.data, repeated.map.image.data);
  assert.notDeepEqual(metal.roughnessMap.image.data, polymer.roughnessMap.image.data);
  for (const finish of [metal, repeated, polymer]) for (const map of Object.values(finish)) {
    assert.equal(map.image.width, 128);
    assert.equal(map.generateMipmaps, true);
    assert.equal(map.wrapS, THREE.RepeatWrapping);
    map.dispose();
  }
});

test("socket-driven reloads follow under, top, rear, box and drum magazines without discontinuities", () => {
  for (const id of Object.keys(WEAPONS)) for (const type of ["empty", "tactical"]) {
    const layout = weaponLayout(id), pose = (p, active = true) => reloadPose(p, active, type, layout.mount, layout);
    const idle = pose(0, false), removed = pose(.43), seated = pose(.78), complete = pose(1);
    assert.deepEqual(idle.hand, layout.support);
    assert.deepEqual(complete.hand, idle.hand);
    for (const axis of ["x", "y", "z"]) {
      assert.equal(idle.magazine[axis], layout.magazine[axis]);
      assert.ok(Math.abs(removed.magazine[axis] - idle.magazine[axis] - layout.removal[axis]) < 1e-9);
      assert.ok(Math.abs(seated.magazine[axis] - idle.magazine[axis]) < 1e-9);
    }
    assert.equal(pose(.47).magazine.visible, false);
    assert.equal(pose(.55).magazine.visible, true);
    assert.equal(pose(.91).boltZ, type === "empty" ? layout.boltTravel : 0);
    assert.equal(idle.grip, 0);
    assert.equal(pose(.43).grip, 1);
    assert.equal(complete.grip, 0);
    assert.equal(idle.fingerGrip, 1);
    assert.equal(pose(.49).fingerGrip, 0);
    assert.equal(pose(.60).fingerGrip, 1);
    assert.equal(complete.fingerGrip, 1);
    assert.deepEqual(pose(.6, false), idle);
    for (const boundary of [.04, .24, .43, .44, .51, .52, .76, .8, .81, .84, .85, .87, .88, .91, .92, .96, 1]) {
      const before = pose(boundary - .00001), after = pose(boundary);
      for (const axis of ["x", "y", "z"]) assert.ok(Math.abs(before.hand[axis] - after.hand[axis]) < .0002, `${id}: ${boundary}`);
      assert.ok(Math.abs(before.fingerGrip - after.fingerGrip) < .001, `${id}: finger exchange at ${boundary}`);
    }
  }
});

test("licensed human wrists reach every weapon grip throughout reload and ADS", () => {
  const camera = new THREE.PerspectiveCamera(76, 16 / 9, .05, 180);
  const hands = createWeaponHands(body, "tundra");
  camera.add(hands.root);
  assert.equal(hands.skin.geometry.groups.length, 2);
  assert.ok(hands.skin.geometry.attributes.position.count < 12_000);
  assert.notEqual(hands.skin.material[0].map, tacticalClothTexture(false));
  let sharedClothDisposed = false;
  tacticalClothTexture(false).addEventListener("dispose", () => { sharedClothDisposed = true; });
  for (const id of Object.keys(WEAPONS)) {
    const gun = createWeaponModel(id, { compact: true });
    camera.add(gun.root);
    for (const aspect of [16 / 9, 390 / 844]) for (const p of [0, .15, .24, .35, .43, .52, .65, .78, .9, .97, 1]) {
      const pose = reloadPose(p, true, "empty", gun.layout.mount, gun.layout);
      const view = weaponViewPose(gun.layout, pose, { aspect, reloading: true, progress: p });
      gun.root.position.copy(view.position);
      gun.root.rotation.set(view.rotation.x, view.rotation.y, view.rotation.z);
      updateWeaponHands(hands, gun.root, gun.layout, pose);
      camera.updateMatrixWorld(true);
      for (const arm of hands.arms) {
        const socket = arm.suffix === "r" ? gun.layout.right : pose.hand;
        const target = gun.root.localToWorld(new THREE.Vector3(socket.x, socket.y, socket.z));
        const error = hands.bones[arm.hand].getWorldPosition(new THREE.Vector3()).distanceTo(target);
        assert.ok(error < .003, `${id}: ${arm.suffix} wrist at ${p}, error ${error}`);
        const joint = (name) => hands.bones.find((bone) => bone.name === `${name}_${arm.suffix}`);
        const wrist = hands.bones[arm.hand].getWorldPosition(new THREE.Vector3());
        const forward = joint("middle_01").getWorldPosition(new THREE.Vector3()).sub(wrist).normalize();
        const expectedForward = new THREE.Vector3().copy(
          arm.suffix === "r" ? gun.layout.rightDirection : pose.grip === 1 ? gun.layout.magazineDirection : gun.layout.supportDirection)
          .transformDirection(gun.root.matrixWorld);
        if (arm.suffix === "r" || pose.grip === 0 || pose.grip === 1) {
          assert.ok(forward.distanceTo(expectedForward) < 1e-8, `${id}: ${arm.suffix} palm at ${p}`);
        }
        const row = joint("index_01").getWorldPosition(new THREE.Vector3())
          .sub(joint("pinky_01").getWorldPosition(new THREE.Vector3())).projectOnPlane(forward).normalize();
        const expectedRow = new THREE.Vector3().copy(
          arm.suffix === "r" ? gun.layout.rightCurlAxis : pose.grip === 1 ? gun.layout.magazineCurlAxis : gun.layout.supportCurlAxis);
        expectedRow.transformDirection(gun.root.matrixWorld).projectOnPlane(forward).normalize();
        if (arm.suffix === "r" || pose.grip === 0 || pose.grip === 1) {
          assert.ok(row.dot(expectedRow) > .93, `${id}: ${arm.suffix} finger row at ${p}`);
        }
        assert.ok(Math.abs(row.dot(forward)) < 1e-8);
      }
    }
    const view = weaponViewPose(gun.layout, reloadPose(0, false, "empty", gun.layout.mount, gun.layout), { ads: 1 });
    gun.root.position.copy(view.position);
    gun.root.rotation.set(view.rotation.x, view.rotation.y, view.rotation.z);
    updateWeaponHands(hands, gun.root, gun.layout, reloadPose(0, false, "empty", gun.layout.mount, gun.layout));
    const optic = gun.root.localToWorld(new THREE.Vector3(0, gun.layout.optic.y, gun.layout.optic.z)).project(camera);
    assert.ok(Math.abs(optic.x) < 1e-8 && Math.abs(optic.y) < 1e-8);
    gun.root.removeFromParent();
    disposeSceneResources(gun.root);
  }
  hands.skeleton.dispose();
  disposeSceneResources(hands.root);
  assert.equal(sharedClothDisposed, false);
});

test("portrait carry keeps the receiver in view and ADS aligns the actual optic", () => {
  const layout = weaponLayout("rifle"), pose = reloadPose(0, false, "empty", layout.mount, layout);
  for (const aspect of [16 / 9, 390 / 844, 844 / 390]) {
    const camera = new THREE.PerspectiveCamera(76, aspect, .05, 180);
    const view = weaponViewPose(layout, pose, { aspect });
    const root = new THREE.Object3D();
    root.position.copy(view.position);
    root.rotation.set(view.rotation.x, view.rotation.y, view.rotation.z);
    camera.add(root);
    camera.updateMatrixWorld(true);
    const receiver = root.localToWorld(new THREE.Vector3(0, .02, -.05)).project(camera);
    assert.ok(Math.abs(receiver.x) < .85 && Math.abs(receiver.y) < 1);
  }
});

test("dropped magazines own their resources and cannot recycle a different weapon shape", () => {
  const rifle = createWeaponModel("rifle"), drum = createWeaponModel("autoshotgun"), pool = [];
  const dropped = acquireDroppedMagazine(pool, rifle.magazine, "rifle", 2);
  let dropDisposed = false;
  dropped.children[0].geometry.addEventListener("dispose", () => { dropDisposed = true; });
  assert.notEqual(dropped.children[0].geometry, rifle.magazine.children[0].geometry);
  assert.notEqual(dropped.children[0].material, rifle.magazine.children[0].material);
  const originalMap = rifle.magazine.children[0].material.map;
  const dropMap = dropped.children[0].material.map;
  assert.notEqual(dropMap, originalMap);
  let dropMapDisposed = false;
  dropMap.addEventListener("dispose", () => { dropMapDisposed = true; });
  disposeSceneResources(rifle.root);
  assert.equal(dropMapDisposed, false, "changing the equipped gun cannot dispose dropped surface maps");
  assert.equal(dropDisposed, false);
  dropped.visible = false;
  assert.equal(acquireDroppedMagazine(pool, dropped, "rifle", 2), dropped);
  dropped.userData.spawnedAt = 1;
  const replacement = acquireDroppedMagazine(pool, drum.magazine, "autoshotgun", 2);
  assert.notEqual(replacement, dropped);
  assert.equal(dropDisposed, true);
  assert.equal(pool.length, 1);
  replacement.visible = true;
  replacement.userData.spawnedAt = 2;
  const another = acquireDroppedMagazine(pool, drum.magazine, "autoshotgun", 2);
  another.visible = true;
  another.userData.spawnedAt = 3;
  acquireDroppedMagazine(pool, drum.magazine, "autoshotgun", 2);
  assert.equal(pool.length, 2);
  pool.forEach((item) => disposeSceneResources(item));
  disposeSceneResources(drum.root);
});
