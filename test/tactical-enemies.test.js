import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import fs from "node:fs";
import { createTacticalEnemy, updateTacticalEnemy, setTacticalBody, tacticalHeadCenter } from "../src/tactical-enemies.js";
import { decodeTacticalBody } from "../src/tactical-body.js";
import { enemyFacingYaw } from "../src/enemy.js";
import { MAPS } from "../shared/progression.js";
import { WEAPONS } from "../shared/weapons.js";
import { weaponLayout } from "../src/weapon-model.js";

test("downed teammates keep a finite low crawl pose with their weapon lowered instead of aiming", () => {
  const model = createTacticalEnemy({ id: "downed-peer", type: "drone" }, { mapId: "foundry", compact: true });
  for (let frame = 0; frame < 60; frame++) {
    updateTacticalEnemy(model, { delta: 1 / 60, speed: .15, crouchDrop: .57 / .85, downed: true, windingUp: true });
  }
  assert.ok(model.bones[model.template.chest].rotation.x > .5);
  assert.ok(model.weapon.rotation.x > .45);
  assert.ok(model.aimBlend < .001);
  model.mesh.updateMatrixWorld(true);
  for (const bone of model.bones) assert.ok(bone.matrixWorld.elements.every(Number.isFinite));
});
import { playerStance } from "../shared/gameplay.js";

const roles = ["drone", "skirmisher", "sentinel", "brute"];
const bytes = fs.readFileSync(new URL("../public/models/tactical-body.bin", import.meta.url));
const body = decodeTacticalBody(JSON.parse(fs.readFileSync(
  new URL("../public/models/tactical-body.json", import.meta.url))), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
body.skinTexture = new THREE.Texture();
assert.throws(() => setTacticalBody({
  ...body, definitions: body.definitions.filter((joint) => joint.name !== "middle_01_l")
}), /required joints/);
setTacticalBody(body);
const worldPosition = (bone) => bone.getWorldPosition(new THREE.Vector3());
const dispose = (model) => {
  model.skeleton?.dispose();
  model.mesh.traverse((object) => {
    if (object.userData.disposeGeometry) object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) if (material && !material.userData.shared) material.dispose();
  });
};

test("pitch, stance and death poses blend without snapping or allocating rigs and stay finite at frame spikes", () => {
  const model = createTacticalEnemy({ id: "blended", type: "drone" }, { mapId: "foundry", compact: true });
  const skeleton = model.skeleton, bones = [...model.bones], chest = model.bones[model.template.chest];
  updateTacticalEnemy(model, { delta: 1 / 120, aimPitch: 1, crouchDrop: .6, windingUp: true });
  assert.ok(model.pitchBlend > 0 && model.pitchBlend < .1);
  assert.ok(model.crouchBlend > 0 && model.crouchBlend < .06);
  for (let frame = 0; frame < 60; frame++) {
    updateTacticalEnemy(model, { delta: 1 / 60, death: frame / 59, reducedMotion: true, hit: frame < 5 });
  }
  assert.strictEqual(model.skeleton, skeleton);
  assert.deepEqual(model.bones, bones);
  assert.ok(chest.rotation.x > .3);
  assert.ok(model.aimBlend < .001);
  const breath = model.breathPhase;
  updateTacticalEnemy(model, { delta: .5, death: 1, reducedMotion: true });
  assert.equal(model.breathPhase, breath);
  model.mesh.updateMatrixWorld(true);
  assert.ok(model.bones.every((bone) => bone.matrixWorld.elements.every(Number.isFinite)));
  assert.throws(() => updateTacticalEnemy(model, { delta: NaN }), RangeError);
  dispose(model);
});

test("sculpted tactical models align visible heads and ground boots in every arena and quality", () => {
  for (const map of MAPS) for (const type of roles) for (const compact of [false, true]) {
    const model = createTacticalEnemy({ id: 1, type }, { mapId: map.id, compact });
    model.mesh.updateMatrixWorld(true);
    const head = tacticalHeadCenter(model);
    assert.ok(Math.abs(head.y - (type === "brute" ? 2.1 : 1.9)) < .001);
    const geometry = model.skinned.geometry;
    assert.equal(model.sculpted, true);
    assert.ok(geometry.attributes.position.count < (compact ? 11_000 : 20_000));
    assert.equal(geometry.groups.length, 5);
    assert.equal(model.skinned.material[4].map, body.skinTexture);
    assert.equal(model.skinned.material[4].normalMap, null);
    assert.ok([...geometry.attributes.position.array].every(Number.isFinite));
    for (let index = 0; index < geometry.attributes.skinWeight.count; index++) {
      const weights = geometry.attributes.skinWeight.array.subarray(index * 4, index * 4 + 4);
      assert.ok(Math.abs(weights.reduce((sum, value) => sum + value, 0) - 1) < .001);
    }
    const bounds = new THREE.Box3().setFromObject(model.mesh);
    assert.ok(bounds.min.y >= -.005 && bounds.min.y < .01);
    assert.ok(bounds.max.y < 2.4 && bounds.max.x - bounds.min.x < 1.2);
    const bodyBounds = new THREE.Box3(), vertex = new THREE.Vector3();
    for (let index = 0; index < geometry.attributes.position.count; index++) {
      if (geometry.attributes.skinIndex.getX(index) === model.template.rifle) continue;
      vertex.fromBufferAttribute(geometry.attributes.position, index);
      model.skinned.applyBoneTransform(index, vertex).applyMatrix4(model.skinned.matrixWorld);
      bodyBounds.expandByPoint(vertex);
    }
    assert.ok(bodyBounds.max.x - bodyBounds.min.x < .95);
    assert.equal(model.reactiveMaterials.every((material) => material.emissiveIntensity === 0), true);
    dispose(model);
  }
});

test("hands follow their rifle grip through idle, running, windup and firing poses", () => {
  for (const type of roles) {
    const model = createTacticalEnemy({ id: 2, type }, { mapId: "outpost" });
    for (const pose of [{}, { speed: 1 }, { speed: .55 }, { windingUp: true }, { attacking: true }]) {
      for (let frame = 0; frame < 60; frame++) updateTacticalEnemy(model, { delta: 1 / 60, ...pose });
      model.mesh.updateMatrixWorld(true);
      for (const arm of model.template.arms) {
        const grip = arm.grip.clone();
        const target = model.weapon.localToWorld(grip);
        assert.ok(worldPosition(model.bones[arm.hand]).distanceTo(target) < .003);
        assert.equal(arm.fingers.length, 10);
        for (const finger of arm.fingers) {
          const expected = new THREE.Quaternion().setFromAxisAngle(arm.fingerAxis, -arm.side * finger.curl);
          assert.ok(model.bones[finger.index].quaternion.angleTo(expected) < 1e-7);
        }
      }
      assert.ok(Math.abs(tacticalHeadCenter(model).y -
        (type === "brute" ? 2.1 : 1.9)) < .08);
    }
    dispose(model);
  }
});

test("human peers use every actual equipped firearm and keep both wrists attached while pitching aim", () => {
  const templates = new Set();
  for (const weaponId of Object.keys(WEAPONS)) {
    const model = createTacticalEnemy({ id: "peer", type: "drone" }, { mapId: "depot", compact: true, weaponId });
    templates.add(model.template);
    assert.equal(model.template.weaponLayout.muzzle, weaponLayout(weaponId).muzzle);
    for (const aimPitch of [-.8, 0, .8]) {
      for (let frame = 0; frame < 30; frame++) updateTacticalEnemy(model, { delta: 1 / 60, windingUp: true, aimPitch });
      model.mesh.updateMatrixWorld(true);
      for (const arm of model.template.arms) {
        assert.ok(worldPosition(model.bones[arm.hand]).distanceTo(model.weapon.localToWorld(arm.grip.clone())) < .003);
      }
    }
    dispose(model);
  }
  assert.equal(templates.size, Object.keys(WEAPONS).length, "different loadouts cannot alias one cached rifle");
});

test("crouched peers bend their knees without shrinking the body or sinking their boots", () => {
  const model = createTacticalEnemy({ id: "crouched-peer", type: "drone" }, { mapId: "foundry", compact: true });
  model.mesh.scale.setScalar(.85);
  const drop = (playerStance(false).eyeHeight - playerStance(true).eyeHeight) / .85;
  updateTacticalEnemy(model, { delta: 1 / 60 });
  const standingHead = tacticalHeadCenter(model).y;
  for (let frame = 0; frame < 60; frame++) {
    updateTacticalEnemy(model, { delta: 1 / 60, crouchDrop: drop, speed: .4, windingUp: true });
    model.mesh.updateMatrixWorld(true);
    for (const leg of model.template.legs) {
      const rest = model.template.definitions[leg.foot].position.y * .85;
      assert.ok(worldPosition(model.bones[leg.foot]).y >= rest - .003);
    }
  }
  assert.ok(Math.abs(standingHead - tacticalHeadCenter(model).y - .57) < .04);
  assert.equal(model.mesh.scale.y, .85);
  dispose(model);
});

test("walking and running support feet do not skate below the floor", () => {
  for (const type of roles) for (const speed of [.55, 1]) {
    const model = createTacticalEnemy({ id: 3, type }, { mapId: "foundry", compact: true });
    for (let frame = 0; frame < 180; frame++) {
      updateTacticalEnemy(model, { delta: 1 / 60, speed });
      model.mesh.updateMatrixWorld(true);
      const feet = model.template.legs.map((leg) => worldPosition(model.bones[leg.foot]).y);
      const restHeight = model.template.definitions[model.template.legs[0].foot].position.y *
        (type === "brute" ? 2.1 / 1.9 : 1);
      assert.ok(feet.every((height) => height >= restHeight - .003));
      assert.ok(Math.abs(Math.min(...feet) - restHeight) < .003);
    }
    dispose(model);
  }
});

test("aim transitions blend gradually and the gait stops advancing while stationary", () => {
  const model = createTacticalEnemy({ id: 8, type: "drone" }, { mapId: "foundry", compact: true });
  const carried = model.weapon.rotation.y;
  updateTacticalEnemy(model, { delta: 1 / 120, windingUp: true });
  assert.ok(model.weapon.rotation.y < carried);
  assert.ok(model.weapon.rotation.y > -model.bones[model.template.chest].rotation.y + .8,
    "raising the rifle cannot snap straight into aim");
  for (let frame = 0; frame < 120; frame++) updateTacticalEnemy(model, { delta: 1 / 120, windingUp: true });
  assert.ok(Math.abs(model.weapon.rotation.y + model.bones[model.template.chest].rotation.y) < .001);
  assert.equal(model.stridePhase, 0);
  updateTacticalEnemy(model, { delta: .1, speed: 1 });
  assert.ok(model.stridePhase > 0);
  for (let frame = 0; frame < 120; frame++) updateTacticalEnemy(model, { delta: 1 / 60 });
  const phase = model.stridePhase;
  for (let frame = 0; frame < 60; frame++) updateTacticalEnemy(model, { delta: 1 / 60 });
  assert.ok(Math.abs(model.stridePhase - phase) < 1e-7);
  dispose(model);
});

test("LOD shares a human silhouette and forward direction rather than reversing the character", () => {
  for (const type of roles) {
    const near = createTacticalEnemy({ id: "same", type }, { mapId: "citadel", compact: true });
    const far = createTacticalEnemy({ id: "same", type }, { mapId: "citadel", distant: true });
    near.mesh.updateMatrixWorld(true);
    const nearBounds = new THREE.Box3().setFromObject(near.mesh);
    const farBounds = new THREE.Box3().setFromObject(far.mesh);
    assert.ok(Math.abs(nearBounds.max.y - farBounds.max.y) < .002);
    assert.ok(Math.abs(nearBounds.min.y - farBounds.min.y) < .002);
    assert.equal(far.mesh.geometry.groups.length, 0);
    assert.ok(far.mesh.geometry.attributes.position.count < near.skinned.geometry.attributes.position.count * .65);
    assert.ok(far.mesh.geometry.attributes.position.count < 6_500);
    assert.equal(far.mesh.material.userData.shared, true);
    assert.equal(far.skeleton, null);
    for (const model of [near, far]) {
      model.mesh.rotation.y = enemyFacingYaw(1, -1, false);
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(model.mesh.quaternion);
      assert.ok(forward.distanceTo(new THREE.Vector3(1, 0, -1).normalize()) < 1e-6);
    }
    dispose(near);
  }
});

test("shared geometry survives model disposal while skeletons and hit responses are independent", () => {
  const first = createTacticalEnemy({ id: 1, type: "drone" }, { mapId: "harbor" });
  const second = createTacticalEnemy({ id: 1, type: "drone" }, { mapId: "harbor" });
  assert.equal(first.skinned.geometry, second.skinned.geometry);
  assert.notEqual(first.skeleton, second.skeleton);
  assert.notEqual(first.reactiveMaterials[0], second.reactiveMaterials[0]);
  assert.equal(first.reactiveMaterials[0].map, second.reactiveMaterials[0].map);
  updateTacticalEnemy(first, { delta: .1, attacking: true, hit: true });
  assert.ok(first.reactiveMaterials[0].emissiveIntensity > 0);
  assert.equal(second.reactiveMaterials[0].emissiveIntensity, 0);
  assert.notEqual(first.weapon.rotation.x, second.weapon.rotation.x);
  first.skeleton.computeBoneTexture();
  second.skeleton.computeBoneTexture();
  const secondTexture = second.skeleton.boneTexture;
  let geometryDisposed = false;
  first.skinned.geometry.addEventListener("dispose", () => { geometryDisposed = true; });
  dispose(first);
  assert.equal(first.skeleton.boneTexture, null);
  assert.equal(second.skeleton.boneTexture, secondTexture);
  assert.equal(geometryDisposed, false);
  updateTacticalEnemy(second, { delta: .1, speed: 1 });
  assert.ok(second.bones.every((bone) => bone.quaternion.toArray().every(Number.isFinite)));
  dispose(second);
});

test("winter rifle carry poses turn toward the target for windup and firing, on desktop and phone", () => {
  for (const type of roles) for (const compact of [false, true]) {
    const model = createTacticalEnemy({ id: 9, type }, { mapId: "tundra", compact });
    const forward = () => {
      model.mesh.updateMatrixWorld(true);
      return new THREE.Vector3(0, 0, 1).applyQuaternion(model.weapon.getWorldQuaternion(new THREE.Quaternion()));
    };
    const carried = forward();
    const carriedHeight = model.weapon.getWorldPosition(new THREE.Vector3()).y;
    assert.ok(carried.x > .85);
    for (const pose of [{ windingUp: true }, { attacking: true }]) {
      for (let frame = 0; frame < 60; frame++) updateTacticalEnemy(model, { delta: 1 / 60, ...pose });
      const aimed = forward();
      assert.ok(Math.abs(aimed.x) < .003 && aimed.z > .99);
      assert.ok(model.weapon.getWorldPosition(new THREE.Vector3()).y > carriedHeight + .30);
      for (const arm of model.template.arms) {
        const target = model.weapon.localToWorld(arm.grip.clone());
        assert.ok(worldPosition(model.bones[arm.hand]).distanceTo(target) < .003);
      }
    }
    assert.equal(Boolean(model.skinned.material[0].normalMap), !compact);
    assert.equal(Boolean(model.skinned.material[1].normalMap), !compact);
    assert.ok(model.skinned.material[3].roughness < .3);
    dispose(model);
  }
});
