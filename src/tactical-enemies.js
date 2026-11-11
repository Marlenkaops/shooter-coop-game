import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import {
  addWinterEquipment, fittedJacketZipper, tacticalClothDetail, tacticalClothTexture, uniformVertexStyle, winterTacticalPalette
} from "./tactical-outfit.js";
import { createWeaponModel, weaponLayout } from "./weapon-model.js";
import { handGripOrientation, poseLimb } from "./limb-ik.js";
import { skinFor } from "../shared/skins.js";

const templates = new Map();
const skinColors = [0x9b7059, 0x70513e, 0xb58b70];
const point = (x, y, z) => new THREE.Vector3(x, y, z);
const scratch = {
  target: new THREE.Vector3(), pole: new THREE.Vector3()
};
let sculptedBody = null;

export function setTacticalBody(body) {
  if (sculptedBody) return;
  const required = ["pelvis", "spine_03", "Head"];
  for (const side of ["l", "r"]) for (const joint of [
    "thigh", "calf", "foot", "upperarm", "lowerarm", "hand", "middle_01", "index_01", "pinky_01"
  ]) {
    required.push(`${joint}_${side}`);
  }
  if (!body.definitions?.length || !body.meshes?.length || !body.distantMeshes?.length ||
    required.some((name) => !body.definitions.some((joint) => joint.name === name)) ||
    [...body.meshes, ...body.distantMeshes].some((mesh) => mesh.name !== "Body")) {
    throw new Error("Missing realistic character geometry or required joints");
  }
  sculptedBody = body;
}

export function tacticalBodyReady() { return Boolean(sculptedBody); }

function addSculptedBody(buckets, palette, distant) {
  const sleeveAxes = new Map();
  sculptedBody.definitions.forEach((joint, index) => {
    if (!/^(upperarm|lowerarm|clavicle)/.test(joint.name)) return;
    const child = sculptedBody.definitions.find((other) => other.parent === index);
    if (child) sleeveAxes.set(joint.name, child.position.clone().sub(joint.position).normalize());
  });
  for (const source of distant ? sculptedBody.distantMeshes : sculptedBody.meshes) {
    const geometry = source.geometry, attributes = geometry.attributes;
    const triangles = [[], [], [], [], []];
    const styles = Array.from({ length: attributes.position.count }, (_, vertex) => uniformVertexStyle(
      new THREE.Vector3().fromBufferAttribute(attributes.position, vertex),
      new THREE.Vector3().fromBufferAttribute(attributes.normal, vertex),
      sculptedBody.definitions[attributes.skinIndex.getX(vertex)].name, palette,
      sleeveAxes.get(sculptedBody.definitions[attributes.skinIndex.getX(vertex)].name)
    ));
    buckets[2].push(fittedJacketZipper(geometry, styles, palette.trim));
    for (let index = 0; index < geometry.index.count; index += 3) {
      const vertices = [0, 1, 2].map((slot) => geometry.index.getX(index + slot));
      const height = vertices.reduce((sum, vertex) => sum + attributes.position.getY(vertex), 0) / 3;
      if (height < .23) continue;
      triangles[styles[vertices[0]].material].push(vertices);
    }
    for (let material = 0; material < triangles.length; material++) {
      if (!triangles[material].length) continue;
      const remap = new Map(), indices = [], data = { position: [], normal: [], uv: [], skinIndex: [], skinWeight: [], color: [] };
      for (const triangle of triangles[material]) for (const vertex of triangle) {
        if (!remap.has(vertex)) {
          remap.set(vertex, remap.size);
          data.position.push(...styles[vertex].position);
          for (const [name, size] of Object.entries({ normal: 3, uv: 2, skinIndex: 4, skinWeight: 4 })) {
            for (let slot = 0; slot < size; slot++) data[name].push(attributes[name].array[vertex * size + slot]);
          }
          const color = new THREE.Color(material === 4 && distant ? 0xc6a28c : styles[vertex].color);
          data.color.push(color.r, color.g, color.b);
        }
        indices.push(remap.get(vertex));
      }
      const part = new THREE.BufferGeometry();
      for (const [name, size] of Object.entries({ position: 3, normal: 3, uv: 2, skinIndex: 4, skinWeight: 4, color: 3 })) {
        const ArrayType = name === "skinIndex" ? Uint16Array : Float32Array;
        part.setAttribute(name, new THREE.BufferAttribute(new ArrayType(data[name]), size));
      }
      part.setIndex(indices);
      if (material !== 4) part.computeVertexNormals();
      buckets[material].push(part);
    }
  }
}

function elbowPosition(shoulder, hand, pole, upper, lower) {
  const direction = hand.clone().sub(shoulder);
  const distance = THREE.MathUtils.clamp(direction.length(), .001, upper + lower - .001);
  direction.normalize();
  const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
  const bend = Math.sqrt(Math.max(0, upper * upper - along * along));
  const normal = pole.clone().addScaledVector(direction, -pole.dot(direction)).normalize();
  return shoulder.clone().addScaledVector(direction, along).addScaledVector(normal, bend);
}

function buildTemplate(type, mapId, compact, variant, distant, weaponId, skinId, attachmentId, finishId) {
  const palette = (skinId && skinFor(skinId).palette) || winterTacticalPalette(mapId, variant);
  const { uniform, gear, dark, rubber } = palette;
  const skin = skinColors[variant];
  const segments = compact ? 8 : 12;
  const definitions = sculptedBody ? sculptedBody.definitions.map((definition) => ({
    ...definition, position: definition.position.clone()
  })) : [];
  const bone = (name, parent, position) => {
    const suffix = name.endsWith("-1") ? "l" : "r";
    const alias = name === "Hips" ? "pelvis" : name === "Chest" ? "spine_03" :
      name.startsWith("Hip") ? `thigh_${suffix}` : name.startsWith("Knee") ? `calf_${suffix}` :
      name.startsWith("Foot") ? `foot_${suffix}` : name.startsWith("Shoulder") ? `upperarm_${suffix}` :
      name.startsWith("Elbow") ? `lowerarm_${suffix}` : name.startsWith("Hand") ? `hand_${suffix}` : name;
    const existing = definitions.findIndex((definition) => definition.name === alias);
    if (sculptedBody && existing >= 0) return existing;
    const index = definitions.length;
    definitions.push({ name, parent, position });
    return index;
  };
  const hips = bone("Hips", -1, point(0, .98, 0));
  const chest = bone("Chest", hips, point(0, 1.41, 0));
  const head = bone("Head", chest, point(0, 1.9, 0));
  const gunX = .02, gunY = 1.48, gunZ = .20;
  const gunId = weaponId ?? { drone: "rifle", skirmisher: "smg", sentinel: "marksman", brute: "lmg" }[type];
  const layout = weaponLayout(gunId);
  const rifle = bone("Rifle", chest, point(gunX, gunY, gunZ));
  const legs = [], arms = [];
  for (const side of [-1, 1]) {
    const hip = bone(`Hip${side}`, hips, point(side * .135, .94, 0));
    const knee = bone(`Knee${side}`, hip, point(side * .135, .51, 0));
    const foot = bone(`Foot${side}`, knee, point(side * .135, .08, .015));
    legs.push({ hip, knee, foot, side });
    const shoulderPosition = point(side * .27, 1.57, -.025);
    const grip = side > 0 ? layout.right : layout.support;
    const handPosition = point(gunX + grip.x, gunY + grip.y, gunZ - grip.z);
    const elbow = elbowPosition(shoulderPosition, handPosition, point(side, -.7, -.2), .35, .34);
    const shoulder = bone(`Shoulder${side}`, chest, shoulderPosition);
    const forearm = bone(`Elbow${side}`, shoulder, elbow);
    const hand = bone(`Hand${side}`, forearm, handPosition);
    const parentOffset = definitions[definitions[shoulder].parent].position.clone().sub(definitions[chest].position);
    const handOrientation = new THREE.Quaternion();
    const fingerAxis = new THREE.Vector3(), fingers = [];
    if (sculptedBody) {
      const suffix = side < 0 ? "l" : "r";
      const middle = definitions.find((definition) => definition.name === `middle_01_${suffix}`);
      fingerAxis.copy(definitions.find((definition) => definition.name === `index_01_${suffix}`).position)
        .sub(definitions.find((definition) => definition.name === `pinky_01_${suffix}`).position).normalize();
      const direction = side > 0 ? layout.rightDirection : layout.supportDirection;
      const curl = side > 0 ? layout.rightCurlAxis : layout.supportCurlAxis;
      handGripOrientation(middle.position.clone().sub(definitions[hand].position).normalize(), fingerAxis,
        point(direction.x, direction.y, -direction.z).normalize(),
        point(curl.x, curl.y, -curl.z).normalize(), handOrientation);
      definitions.forEach((definition, index) => {
        if (/^(index|middle|ring|pinky|thumb)_0[12]_/.test(definition.name) && definition.name.endsWith(`_${suffix}`)) {
          const curl = definition.name.startsWith("index") ? .35 : definition.name.startsWith("thumb") ? .25 : .8;
          fingers.push({ index, curl });
        }
      });
    }
    arms.push({ shoulder, forearm, hand, side, parentOffset, handOrientation, fingerAxis, fingers,
      grip: handPosition.clone().sub(definitions[rifle].position) });
  }
  const buckets = sculptedBody ? [[], [], [], [], []] : [[], [], [], []];
  if (sculptedBody) addSculptedBody(buckets, palette, distant);
  const part = (shape, material, color, position, scale, attachment, rotation = [0, 0, 0]) => {
    const geometry = shape.index ? shape.clone() : mergeVertices(shape);
    shape.dispose();
    geometry.applyMatrix4(new THREE.Matrix4().compose(
      point(...position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), point(...scale)
    ));
    const count = geometry.attributes.position.count, tint = new THREE.Color(color);
    const colors = new Float32Array(count * 3);
    const indices = new Uint16Array(count * 4), weights = new Float32Array(count * 4);
    for (let index = 0; index < count; index++) {
      colors.set([tint.r, tint.g, tint.b], index * 3);
      indices[index * 4] = attachment;
      weights[index * 4] = 1;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("skinIndex", new THREE.BufferAttribute(indices, 4));
    geometry.setAttribute("skinWeight", new THREE.BufferAttribute(weights, 4));
    buckets[material].push(geometry);
  };
  const box = (dimensions, material, color, position, attachment, rotation) =>
    part(Math.min(...dimensions) >= .05
      ? new RoundedBoxGeometry(...dimensions, 1, .008) : new THREE.BoxGeometry(...dimensions),
    material, color, position, [1, 1, 1], attachment, rotation);
  const sphere = (scale, material, color, position, attachment) =>
    part(new THREE.SphereGeometry(1, segments, compact ? 5 : 8), material,
      color, position, scale, attachment);
  const limb = (from, to, radiusTop, radiusBottom, color, attachment, material = 0) => {
    const direction = to.clone().sub(from);
    const rotation = new THREE.Euler().setFromQuaternion(
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize())
    );
    part(new THREE.CylinderGeometry(radiusBottom, radiusTop, direction.length(), segments, 2),
      material, color, from.clone().add(to).multiplyScalar(.5).toArray(), [1, 1, 1], attachment, rotation.toArray().slice(0, 3));
  };

  if (!sculptedBody) {
    part(new THREE.CylinderGeometry(.245, .205, .67, segments, 3),
      0, uniform, [0, 1.31, 0], [1, 1, .63], chest);
    sphere([.20, .135, .145], 0, uniform, [0, 1.015, 0], hips);
  }
  if (!sculptedBody) {
  part(new THREE.CylinderGeometry(.067, .075, .18, segments), 1, skin,
    [0, 1.73, 0], [1, 1, .95], chest);
  part(new THREE.CylinderGeometry(.081, .085, .05, segments, 1, true), 0, uniform,
    [0, 1.665, 0], [1, 1, .97], chest);
  const faceProfile = [
    [0, -.145], [.061, -.137], [.087, -.095], [.10, -.045],
    [.109, .03], [.10, .105], [.062, .145], [0, .154]
  ].map(([radius, height]) => new THREE.Vector2(radius, height));
  part(new THREE.LatheGeometry(faceProfile, segments), 1, skin, [0, 1.9, .006],
    [1, 1, 1.03], head);
  for (const side of [-1, 1]) {
    sphere([.018, .037, .016], 1, skin, [side * .108, 1.90, 0], head);
    box([.049, .016, .011], 2, 0x292f2c, [side * .04, 1.935, .111], head);
    if (!compact) box([.044, .008, .009], 0, 0x4e3e32, [side * .04, 1.953, .104], head);
  }
  box([.036, .006, .008], 2, dark, [0, 1.938, .115], head);
  part(new THREE.ConeGeometry(.018, .04, 6), 1, skin, [0, 1.90, .122],
    [1, 1, .7], head, [Math.PI / 2, 0, 0]);
  box([.041, .006, .009], 1, 0x765046, [0, 1.85, .108], head);
  }
  for (const leg of legs) {
    const hipPosition = definitions[leg.hip].position;
    const kneePosition = definitions[leg.knee].position;
    const footPosition = definitions[leg.foot].position;
    if (!sculptedBody) {
      limb(hipPosition, kneePosition, .11, .089, uniform, leg.hip);
      sphere([.086, .089, .083], 0, uniform, kneePosition.toArray(), leg.knee);
      limb(kneePosition, footPosition.clone().add(point(0, .05, 0)), .08, .063, uniform, leg.knee);
    }
  }
  addWinterEquipment({ part, box, palette, type, compact, distant, hips, chest, head, legs, definitions, sculpted: Boolean(sculptedBody) });
  for (const arm of arms) {
    if (sculptedBody) continue;
    const shoulder = definitions[arm.shoulder].position;
    const elbow = definitions[arm.forearm].position;
    const hand = definitions[arm.hand].position;
    sphere([.104, .112, .108], 0, uniform, shoulder.toArray(), arm.shoulder);
    limb(shoulder, elbow, .097, .075, uniform, arm.shoulder);
    sphere([.074, .07, .072], 0, uniform, elbow.toArray(), arm.forearm);
    if (type === "skirmisher") {
      const cuff = elbow.clone().lerp(hand, .55);
      limb(elbow, cuff, .074, .063, uniform, arm.forearm);
      limb(cuff, hand, .058, .051, skin, arm.forearm, 1);
    } else {
      limb(elbow, hand, .074, .051, uniform, arm.forearm);
    }
    sphere([.049, .046, .072], 0, rubber, hand.toArray(), arm.hand);
  }
  const gun = createWeaponModel(gunId, { compact, distant, attachmentId, finishId });
  gun.root.rotation.y = Math.PI;
  gun.root.scale.x = -1;
  gun.root.position.set(gunX, gunY, gunZ);
  gun.root.updateMatrixWorld(true);
  const gunMaterials = new Set();
  gun.root.traverse((object) => {
    if (!object.isMesh || object === gun.reticle || object.parent === gun.reticle) return;
    const transformed = object.geometry.clone().applyMatrix4(object.matrixWorld);
    const shape = mergeVertices(transformed);
    transformed.dispose();
    for (let index = 0; index < shape.index.count; index += 3) {
      const second = shape.index.getX(index + 1);
      shape.index.setX(index + 1, shape.index.getX(index + 2));
      shape.index.setX(index + 2, second);
    }
    part(shape, object.material.userData.weaponSurface === "optical" ? 3 : 2,
      object.material.color.getHex(), [0, 0, 0], [1, 1, 1], rifle);
    object.geometry.dispose();
    gunMaterials.add(object.material);
  });
  gunMaterials.forEach((material) => material.dispose());
  gun.reticle.traverse((object) => object.geometry?.dispose());
  gun.reticle.material.dispose();
  const groups = buckets.map((pieces) => {
    const geometry = mergeGeometries(pieces);
    pieces.forEach((piece) => piece.dispose());
    if (!geometry) throw new Error("Could not merge tactical character parts");
    return geometry;
  });
  const geometry = mergeGeometries(groups, true);
  groups.forEach((group) => group.dispose());
  if (!geometry) throw new Error("Could not build tactical character");
  geometry.computeBoundingSphere();
  return { geometry, definitions, hips, chest, head, rifle, legs, arms, weaponLayout: layout, sculpted: Boolean(sculptedBody),
    headOffset: sculptedBody ? sculptedBody.headCenter.clone().sub(definitions[head].position) : new THREE.Vector3() };
}

function variantFor(enemy) {
  const id = String(enemy.id ?? "0");
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return (hash + (enemy.wave ?? 1)) % 3;
}

export function createTacticalEnemy(enemy, { mapId, compact = false, distant = false, shadows = false, weaponId, skinId, attachmentId, finishId }) {
  const variant = variantFor(enemy), type = enemy.type;
  const key = `${mapId}:${type}:${compact || distant}:${variant}:${Boolean(sculptedBody)}:${distant}:${weaponId ?? ""}:${skinId ?? ""}:${attachmentId ?? ""}:${finishId ?? ""}`;
  if (!templates.has(key)) templates.set(key, buildTemplate(type, mapId, compact || distant, variant, distant, weaponId, skinId, attachmentId, finishId));
  const template = templates.get(key);
  const heightScale = type === "brute" ? 2.1 / 1.9 : 1;
  const widthScale = type === "brute" ? 1.05 : 1;
  if (distant) {
    if (!template.distantGeometry) {
      const posed = createTacticalEnemy(enemy, { mapId, compact: true, weaponId, skinId, attachmentId, finishId });
      posed.mesh.updateMatrixWorld(true);
      template.distantGeometry = template.geometry.clone();
      template.distantGeometry.clearGroups();
      const baked = new THREE.SkinnedMesh(template.geometry);
      baked.bind(posed.skeleton, posed.skinned.bindMatrix);
      const positions = template.distantGeometry.attributes.position, vertex = new THREE.Vector3();
      for (let index = 0; index < positions.count; index++) {
        vertex.fromBufferAttribute(positions, index);
        baked.applyBoneTransform(index, vertex).applyMatrix4(posed.skinned.matrixWorld);
        positions.setXYZ(index, vertex.x, vertex.y, vertex.z);
      }
      template.distantGeometry.deleteAttribute("skinIndex");
      template.distantGeometry.deleteAttribute("skinWeight");
      template.distantGeometry.computeVertexNormals();
      template.distantGeometry.computeBoundingSphere();
      template.distantMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
      template.distantMaterial.userData.shared = true;
      posed.skeleton.dispose();
      posed.skinned.material.forEach((material) => material.dispose());
      posed.enemyFlash.geometry.dispose();
      posed.enemyFlash.material.dispose();
    }
    return {
      mesh: new THREE.Mesh(template.distantGeometry, template.distantMaterial),
      modelKind: "distant", modelOffsetY: 0, reactiveMaterials: [],
      skeleton: null, bones: null, skinned: null, template: null, weapon: null, enemyFlash: null,
      sculpted: template.sculpted
    };
  }
  const mesh = new THREE.Group(), visual = new THREE.Group();
  visual.scale.set(widthScale, heightScale, widthScale);
  mesh.add(visual);
  const bones = template.definitions.map((definition) => {
    const bone = new THREE.Bone();
    bone.name = definition.name;
    bone.position.copy(definition.position);
    if (definition.parent >= 0) bone.position.sub(template.definitions[definition.parent].position);
    return bone;
  });
  template.definitions.forEach((definition, index) => {
    if (definition.parent < 0) visual.add(bones[index]);
    else bones[definition.parent].add(bones[index]);
  });
  const materials = [
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .96, metalness: 0, map: tacticalClothTexture() }),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .91, metalness: 0, map: tacticalClothTexture(false) }),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .67, metalness: .15 }),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .22, metalness: .45 })
  ];
  if (sculptedBody) materials.push(new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: .82, metalness: 0, map: sculptedBody.skinTexture ?? null
  }));
  if (!compact) {
    const detail = tacticalClothDetail();
    for (const material of materials.slice(0, 2)) {
      material.normalMap = detail.normalMap;
      material.normalScale.set(.3, .3);
      material.roughnessMap = detail.roughnessMap;
    }
  }
  const skinned = new THREE.SkinnedMesh(template.geometry, materials);
  skinned.castShadow = skinned.receiveShadow = shadows;
  visual.add(skinned);
  mesh.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  skinned.bind(skeleton);
  const weapon = bones[template.rifle];
  const enemyFlash = new THREE.Mesh(new THREE.ConeGeometry(.04, .17, 6),
    new THREE.MeshBasicMaterial({
      color: 0xffc179, transparent: true, opacity: .8,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
  enemyFlash.position.set(0, .009, template.weaponLayout.muzzle);
  enemyFlash.rotation.x = Math.PI / 2;
  enemyFlash.visible = false;
  enemyFlash.userData.disposeGeometry = true;
  weapon.add(enemyFlash);
  const model = {
    mesh, skinned, skeleton, bones, template, weapon, enemyFlash,
    reactiveMaterials: materials.slice(0, 2), modelKind: "tactical", modelOffsetY: 0,
    stridePhase: 0, movementBlend: 0, aimBlend: 0, hitBlend: 0, breathPhase: 0,
    crouchBlend: 0, downedBlend: 0, pitchBlend: 0, sculpted: template.sculpted
  };
  updateTacticalEnemy(model, { delta: 0 });
  return model;
}

function poseChain(model, upper, lower, end, target, pole) {
  poseLimb(model.bones, model.template.definitions, upper, lower, end, target, pole);
}

export function updateTacticalEnemy(model, {
  delta = 0, speed = 0, phase = 0, attacking = false, windingUp = false, hit = false,
  aimPitch = 0, crouchDrop = 0, downed = false, death = 0, reducedMotion = false
} = {}) {
  if (![delta, speed, phase, aimPitch, crouchDrop, death].every(Number.isFinite) || delta < 0) {
    throw new RangeError("Invalid tactical animation step.");
  }
  const { bones, template } = model;
  death = Math.max(0, Math.min(1, death));
  const blend = 1 - Math.exp(-Math.max(0, delta) * 10);
  model.movementBlend += (Math.max(0, Math.min(1, speed)) * (1 - death) - model.movementBlend) * blend;
  model.aimBlend += ((!downed && !death && (attacking || windingUp) ? 1 : 0) - model.aimBlend) * blend;
  model.hitBlend += ((hit ? 1 : 0) - model.hitBlend) * (1 - Math.exp(-Math.max(0, delta) * 24));
  model.crouchBlend += (crouchDrop - model.crouchBlend) * blend;
  model.downedBlend += (Number(downed) - model.downedBlend) * blend;
  model.pitchBlend += (Math.max(-1.45, Math.min(1.45, aimPitch)) - model.pitchBlend) * blend;
  if (!reducedMotion) model.breathPhase += Math.max(0, delta) * 2.1;
  const movement = model.movementBlend;
  model.stridePhase += Math.max(0, delta) * movement * 10;
  const stride = model.stridePhase + phase;
  const hips = bones[template.hips], chest = bones[template.chest];
  const hipsParent = template.definitions[template.hips].parent;
  const parentY = hipsParent >= 0 ? template.definitions[hipsParent].position.y : 0;
  hips.position.y = template.definitions[template.hips].position.y - parentY -
    model.crouchBlend - death * .35 - movement * .035 + Math.sin(stride * 2) * .006 * movement;
  hips.position.x = Math.sin(stride) * .006 * movement;
  chest.rotation.set(.012 + model.downedBlend * .538 + model.aimBlend * .023 + movement * .045 +
    model.hitBlend * (reducedMotion ? .008 : .055) - model.pitchBlend * .08 * (1 - death) + death * .32,
    .35 * (1 - death) + Math.sin(stride) * .018 * movement, Math.sin(stride) * .008 * movement + death * .12);
  bones[template.head].rotation.y = -chest.rotation.y;
  bones[template.head].rotation.x = -model.pitchBlend * .2 * (1 - death) + death * .22;
  model.weapon.rotation.y = -chest.rotation.y + (1 - model.aimBlend) * 1.1;
  model.weapon.rotation.x += ((downed ? .5 : attacking ? -.055 : windingUp ? -.015 : .005) -
    (downed ? 0 : model.pitchBlend) * (1 - death) + death * .6 -
    model.weapon.rotation.x) * blend;
  const gunHeight = template.definitions[template.rifle].position.y - template.definitions[template.chest].position.y;
  model.weapon.position.y += (gunHeight + model.aimBlend * .34 +
    Math.sin(model.breathPhase) * .003 * (1 - movement) - model.weapon.position.y) * blend;
  for (const leg of template.legs) {
    const cycle = stride + (leg.side > 0 ? Math.PI : 0);
    const rest = template.definitions[leg.foot].position;
    const target = scratch.target.set(rest.x - hips.position.x,
      rest.y + Math.max(0, Math.sin(cycle)) * .085 * movement - hips.position.y - parentY,
      Math.cos(cycle) * .15 * movement + rest.z - template.definitions[template.hips].position.z + death * .22);
    poseChain(model, leg.hip, leg.knee, leg.foot, target, scratch.pole.set(0, 0, 1));
  }
  for (const arm of template.arms) {
    const target = scratch.target.copy(arm.grip).applyQuaternion(model.weapon.quaternion)
      .add(model.weapon.position).sub(arm.parentOffset);
    poseChain(model, arm.shoulder, arm.forearm, arm.hand, target, scratch.pole.set(arm.side, -.7, -.2));
    if (template.sculpted) {
      bones[arm.hand].quaternion.multiply(model.weapon.quaternion).multiply(arm.handOrientation);
      for (const finger of arm.fingers) {
        bones[finger.index].quaternion.setFromAxisAngle(arm.fingerAxis, -arm.side * finger.curl);
      }
    }
  }
  for (const material of model.reactiveMaterials) {
    material.emissive.setHex(hit ? 0x773e28 : windingUp ? 0x352718 : 0);
    material.emissiveIntensity = hit ? .20 : windingUp ? .1 : 0;
  }

}

export function tacticalHeadCenter(model, target = new THREE.Vector3()) {
  model.mesh.updateMatrixWorld(true);
  return model.bones[model.template.head].localToWorld(target.copy(model.template.headOffset));
}
