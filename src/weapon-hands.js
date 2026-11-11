import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { handGripOrientation, poseLimb } from "./limb-ik.js";
import { tacticalClothDetail, tacticalClothTexture } from "./tactical-outfit.js";
import { sceneLook } from "./scene-look.js";
import { skinFor } from "../shared/skins.js";

// The source fingers are already bent in bind pose; the trigger finger first uncurls.
const triggerGrip = { index: [-.65, 1.35], middle: [.8, 1.45], ring: [.8, 1.35], pinky: [1, 1.05], thumb: [.7, 0] };
const supportGrip = { index: [1.3, .6], middle: [1.3, .7], ring: [1.3, .6], pinky: [1.3, .6], thumb: [.6, .2] };
const magazineGrip = { index: [.8, 1.35], middle: [.8, 1.45], ring: [.8, 1.35], pinky: [1, 1.05], thumb: [.6, .1] };

export function createWeaponHands(body, mapId, skinId = "standard", { compact = false } = {}) {
  const definitions = body.definitions.map((definition) => ({ ...definition, position: definition.position.clone() }));
  for (const definition of definitions) {
    if (!/^(index|middle|ring|pinky|thumb)/.test(definition.name)) continue;
    const wrist = definitions.find((joint) => joint.name === `hand_${definition.name.at(-1)}`).position;
    definition.position.sub(wrist).multiplyScalar(.92).add(wrist);
  }
  const bones = definitions.map((definition) => {
    const bone = new THREE.Bone();
    bone.name = definition.name;
    bone.position.copy(definition.position);
    if (definition.parent >= 0) bone.position.sub(definitions[definition.parent].position);
    return bone;
  });
  const root = new THREE.Group();
  root.position.set(0, -1.9, -.11);
  root.rotation.y = Math.PI;
  root.scale.x = -1;
  definitions.forEach((definition, index) => {
    if (definition.parent < 0) root.add(bones[index]);
    else bones[definition.parent].add(bones[index]);
  });
  const arms = ["r", "l"].map((suffix) => {
    const joint = (name) => definitions.findIndex((definition) => definition.name === `${name}_${suffix}`);
    const shoulder = joint("upperarm"), forearm = joint("lowerarm"), hand = joint("hand");
    const middle = joint("middle_01"), index = joint("index_01"), pinky = joint("pinky_01");
    if ([shoulder, forearm, hand, middle, index, pinky].some((value) => value < 0)) throw new Error("Missing hand rig joints");
    const axis = definitions[middle].position.clone().sub(definitions[hand].position).normalize();
    const curlAxis = definitions[index].position.clone().sub(definitions[pinky].position).normalize();
    return {
      suffix, shoulder, forearm, hand, axis, curlAxis,
      palmNormal: new THREE.Vector3().crossVectors(axis, curlAxis).normalize().multiplyScalar(suffix === "r" ? 1 : -1),
      fingers: definitions.map((definition, index) => ({ name: definition.name, index }))
        .filter(({ name }) => /^(index|middle|ring|pinky|thumb)_0[12]_/.test(name) && name.endsWith(`_${suffix}`))
        .map((finger) => ({ ...finger, digit: finger.name.split("_")[0], segment: finger.name.includes("_02_") ? 1 : 0 }))
    };
  });
  const outfit = skinFor(skinId).palette;
  const palette = outfit ? {
    uniform: new THREE.Color(outfit.uniform).multiplyScalar(.75).getHex(),
    glove: outfit.glove, grip: outfit.dark, trim: outfit.trim, stitch: outfit.gear
  } : {
    uniform: new THREE.Color(sceneLook(mapId).soldiers[0]).lerp(new THREE.Color(0x344137), .45)
      .multiplyScalar(.75).getHex(),
    glove: 0x75644e, grip: 0x252e26, trim: 0x27332b, stitch: 0x95856c
  };
  const buckets = [[], []];
  for (const source of body.meshes) {
    const attributes = source.geometry.attributes, styles = [];
    for (let vertex = 0; vertex < attributes.position.count; vertex++) {
      const joint = definitions[attributes.skinIndex.getX(vertex)], arm = arms.find(({ suffix }) => joint.name.endsWith(`_${suffix}`));
      const position = new THREE.Vector3().fromBufferAttribute(attributes.position, vertex);
      const normal = new THREE.Vector3().fromBufferAttribute(attributes.normal, vertex);
      const glove = /^(hand|index|middle|ring|pinky|thumb)/.test(joint.name);
      let color = palette.uniform;
      if (glove) {
        position.sub(definitions[arm.hand].position).multiplyScalar(.92).add(definitions[arm.hand].position);
        position.addScaledVector(normal, .0025);
        const palm = normal.dot(arm.palmNormal) > .25;
        color = palm || /_02_/.test(joint.name) ? palette.grip : palette.glove;
      } else if (/^(upperarm|lowerarm)/.test(joint.name)) {
        const end = joint.name.startsWith("lowerarm") ? arm.hand : arm.forearm;
        const axis = definitions[end].position.clone().sub(joint.position);
        const along = THREE.MathUtils.clamp(position.clone().sub(joint.position).dot(axis) / axis.lengthSq(), 0, 1);
        axis.normalize();
        const radial = normal.clone().addScaledVector(axis, -normal.dot(axis));
        const padding = joint.name.startsWith("lowerarm") ? .014 - along * .008 : .016;
        const fold = Math.sin(along * 44) * .0025 * Math.sin(along * Math.PI);
        position.addScaledVector(radial, padding + fold);
        if (joint.name.startsWith("lowerarm") && along > .88) color = palette.trim;
      }
      styles.push({ position: position.toArray(), color });
    }
    const triangles = [[], []];
    for (let index = 0; index < source.geometry.index.count; index += 3) {
      const vertices = [0, 1, 2].map((slot) => source.geometry.index.getX(index + slot));
      const names = vertices.map((vertex) => definitions[attributes.skinIndex.getX(vertex)].name);
      if (!names.every((name) => /^(upperarm|lowerarm|hand|index|middle|ring|pinky|thumb)/.test(name))) continue;
      triangles[names.some((name) => /^(hand|index|middle|ring|pinky|thumb)/.test(name)) ? 1 : 0].push(...vertices);
    }
    triangles.forEach((vertices, material) => {
      const data = { position: [], normal: [], uv: [], skinIndex: [], skinWeight: [], color: [] };
      for (const vertex of vertices) {
        data.position.push(...styles[vertex].position);
        for (const [field, size] of Object.entries({ normal: 3, uv: 2, skinIndex: 4, skinWeight: 4 })) {
          for (let slot = 0; slot < size; slot++) data[field].push(attributes[field].array[vertex * size + slot]);
        }
        const color = new THREE.Color(styles[vertex].color);
        data.color.push(color.r, color.g, color.b);
      }
      if (!vertices.length) return;
      const geometry = new THREE.BufferGeometry();
      for (const [field, size] of Object.entries({ position: 3, normal: 3, uv: 2, skinIndex: 4, skinWeight: 4, color: 3 })) {
        geometry.setAttribute(field, new THREE.BufferAttribute(
          field === "skinIndex" ? new Uint16Array(data[field]) : new Float32Array(data[field]), size));
      }
      buckets[material].push(geometry);
    });
  }
  const addGlovePart = (geometry, color, joint, wrist = null) => {
    const unindexed = geometry.index ? geometry.toNonIndexed() : geometry;
    if (unindexed !== geometry) geometry.dispose();
    const count = unindexed.attributes.position.count;
    const indices = new Uint16Array(count * 4), weights = new Float32Array(count * 4), colors = new Float32Array(count * 3);
    const tint = new THREE.Color(color);
    for (let vertex = 0; vertex < count; vertex++) {
      indices[vertex * 4] = joint;
      weights[vertex * 4] = 1;
      if (wrist) {
        const along = new THREE.Vector3().fromBufferAttribute(unindexed.attributes.position, vertex)
          .sub(definitions[wrist.hand].position).dot(wrist.axis);
        const blend = THREE.MathUtils.smoothstep(along, -.046, -.006);
        indices[vertex * 4 + 1] = wrist.forearm;
        weights[vertex * 4] = blend;
        weights[vertex * 4 + 1] = 1 - blend;
      }
      colors.set([tint.r, tint.g, tint.b], vertex * 3);
    }
    unindexed.setAttribute("skinIndex", new THREE.BufferAttribute(indices, 4));
    unindexed.setAttribute("skinWeight", new THREE.BufferAttribute(weights, 4));
    unindexed.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    buckets[1].push(unindexed);
  };
  for (const arm of arms) {
    const across = arm.curlAxis.clone().projectOnPlane(arm.axis).normalize();
    const frame = new THREE.Matrix4().makeBasis(across, arm.axis,
      new THREE.Vector3().crossVectors(across, arm.axis).normalize());
    const ring = (profile, color, flexible = true) => {
      const geometry = new THREE.LatheGeometry(profile.map(([radius, along]) => new THREE.Vector2(radius, along)), compact ? 8 : 10);
      geometry.scale(1.1, 1, .84).applyMatrix4(frame).translate(...definitions[arm.hand].position.toArray());
      addGlovePart(geometry, color, arm.hand, flexible ? arm : null);
    };
    // Both joints influence the gusset so it bridges the sleeve when the wrist bends.
    ring([[.030, -.054], [.032, -.041], [.030, -.030], [.026, -.017], [.023, -.004], [.025, .009]], palette.trim);
    ring([[.032, -.040], [.033, -.037], [.031, -.031]], palette.uniform);
    ring([[.027, -.018], [.028, -.015], [.025, -.001]], palette.grip, false);
    for (const [radius, along] of [[.0285, -.015], [.026, -.002]]) {
      ring([[radius, along], [radius, along + .0013]], palette.stitch, false);
    }
    for (const side of [-1, 1]) {
      const pad = new THREE.SphereGeometry(1, compact ? 6 : 8, 4);
      const center = definitions[arm.hand].position.clone().addScaledVector(arm.axis, .055)
        .addScaledVector(across, side * .017).addScaledVector(arm.palmNormal, -.019);
      pad.scale(.014, .029, .005).applyMatrix4(frame).translate(...center.toArray());
      addGlovePart(pad, palette.glove, arm.hand);
    }
    for (const finger of arm.fingers.filter(({ name }) => !name.startsWith("thumb") && name.includes("_01_"))) {
      const center = definitions[finger.index].position.clone().addScaledVector(arm.axis, .008).addScaledVector(arm.palmNormal, -.011);
      const pad = new THREE.SphereGeometry(1, compact ? 6 : 8, 4);
      pad.scale(.009, .014, .005).applyMatrix4(frame).translate(...center.toArray());
      addGlovePart(pad, palette.grip, finger.index);
    }
  }
  const parts = buckets.map((pieces) => {
    const geometry = mergeGeometries(pieces);
    pieces.forEach((piece) => piece.dispose());
    if (!geometry) throw new Error("Missing licensed arm anatomy");
    return geometry;
  });
  const geometry = mergeGeometries(parts, true);
  parts.forEach((part) => part.dispose());
  const detail = tacticalClothDetail();
  const materials = [.96, .88].map((roughness, index) => {
    const map = tacticalClothTexture(!index).clone(), normalMap = detail.normalMap.clone(), roughnessMap = detail.roughnessMap.clone();
    map.repeat.set(index ? 6 : 3, index ? 6 : 3);
    for (const texture of [normalMap, roughnessMap]) texture.repeat.set(index ? 6 : 8, index ? 6 : 8);
    return new THREE.MeshStandardMaterial({
      vertexColors: true, roughness, map, normalMap, roughnessMap,
      normalScale: new THREE.Vector2(index ? .24 : .35, index ? .24 : .35)
    });
  });
  const skin = new THREE.SkinnedMesh(geometry, materials);
  root.add(skin);
  skin.frustumCulled = false;
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  skin.bind(skeleton);
  return { root, skin, skeleton, bones, definitions, arms };
}

const target = new THREE.Vector3(), pole = new THREE.Vector3(), direction = new THREE.Vector3(), curlDirection = new THREE.Vector3();
const orientation = new THREE.Quaternion(), magazineOrientation = new THREE.Quaternion(), twist = new THREE.Quaternion(), inverse = new THREE.Matrix4();
export function updateWeaponHands(model, weapon, layout, pose) {
  model.root.updateWorldMatrix(true, false);
  weapon.updateWorldMatrix(true, false);
  inverse.copy(model.root.matrixWorld).invert();
  for (const arm of model.arms) {
    const right = arm.suffix === "r", socket = right ? layout.right : pose.hand;
    target.set(socket.x, socket.y, socket.z).applyMatrix4(weapon.matrixWorld).applyMatrix4(inverse);
    target.sub(model.definitions[model.definitions[arm.shoulder].parent].position);
    poseLimb(model.bones, model.definitions, arm.shoulder, arm.forearm, arm.hand, target, pole.set(right ? 1 : -1, -.7, -.2));
    direction.copy(right ? layout.rightDirection : layout.supportDirection)
      .transformDirection(weapon.matrixWorld).transformDirection(inverse).normalize();
    curlDirection.copy(right ? layout.rightCurlAxis : layout.supportCurlAxis);
    curlDirection.transformDirection(weapon.matrixWorld).transformDirection(inverse).normalize();
    handGripOrientation(arm.axis, arm.curlAxis, direction, curlDirection, orientation);
    if (!right) {
      direction.copy(layout.magazineDirection).transformDirection(weapon.matrixWorld).transformDirection(inverse).normalize();
      curlDirection.copy(layout.magazineCurlAxis).transformDirection(weapon.matrixWorld).transformDirection(inverse).normalize();
      handGripOrientation(arm.axis, arm.curlAxis, direction, curlDirection, magazineOrientation);
      orientation.slerp(magazineOrientation, pose.grip);
    }
    model.bones[arm.hand].quaternion.multiply(orientation)
      .multiply(twist.setFromAxisAngle(arm.axis, right ? 0 : pose.handRoll));
    const closure = right ? 1 : .35 + .65 * (pose.fingerGrip ?? 1);
    const resting = layout.sidearm ? magazineGrip : supportGrip;
    const gripping = layout.mount === "top" || layout.wideMagazine ? supportGrip : magazineGrip;
    for (const { index, digit, segment } of arm.fingers) {
      const curl = (right ? triggerGrip[digit][segment] :
        THREE.MathUtils.lerp(resting[digit][segment], gripping[digit][segment], pose.grip)) * closure;
      const bone = model.bones[index];
      bone.quaternion.setFromAxisAngle(arm.curlAxis, (right ? -1 : 1) * curl);
      if (digit === "thumb" && !segment) bone.quaternion.premultiply(twist.setFromAxisAngle(arm.axis, (right ? .1 : -.15) * closure));
    }
  }
}
