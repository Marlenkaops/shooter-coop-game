import * as THREE from "three";
import * as CANNON from "cannon-es";
import { createDestructibles, destructibleLayout, geometryForProps, PROP_HEALTH } from "../shared/destructibles.js";
import { disposeSceneResources } from "./scene-resources.js";

function crateTexture() {
  const size = 64, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const grain = Math.sin(x * 1.7 + Math.sin(y * .14)) * 7 + Math.cos(x * .43 + y * .025) * 5;
    const shade = y % 16 < 2 ? 110 : 225 + grain;
    pixels.set([shade, shade, shade, 255], (y * size + x) * 4);
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function createDestructibleCover(scene, world, mapId, {
  material, shadows = false, contactTexture, onBreak = () => {}
} = {}) {
  const layout = destructibleLayout(mapId), group = new THREE.Group(), bodies = new Map();
  group.name = "destructible-cover";
  const timber = new THREE.MeshStandardMaterial({ color: 0xffffff, map: crateTexture(), roughness: 1, metalness: 0 });
  const box = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.InstancedMesh(box, timber, layout.length);
  const trim = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0x383c31, roughness: 1 }), layout.length * 4);
  for (const object of [mesh, trim]) {
    object.frustumCulled = false;
    object.castShadow = shadows;
    object.receiveShadow = shadows;
    object.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(object);
  }
  let contacts;
  if (contactTexture) {
    contacts = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: contactTexture, color: 0x111610, transparent: true, opacity: .38, depthWrite: false
    }), layout.length);
    contacts.frustumCulled = false;
    contacts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(contacts);
  }
  scene.add(group);
  const pose = new THREE.Object3D(), hidden = new THREE.Matrix4().makeScale(0, 0, 0), color = new THREE.Color();
  let previous = [], geometry;
  function sync(states, effects = true) {
    if (states?.length === previous.length && states.every((state, index) =>
      state.id === previous[index].id && state.health === previous[index].health)) return geometry;
    const nextGeometry = geometryForProps(mapId, states);
    for (const [index, prop] of layout.entries()) {
      const alive = states[index].health > 0;
      if (alive && !bodies.has(prop.id)) {
        const body = new CANNON.Body({ mass: 0, material, collisionFilterGroup: 1,
          shape: new CANNON.Box(new CANNON.Vec3(prop.width / 2, prop.height / 2, prop.depth / 2)),
          position: new CANNON.Vec3(prop.x, prop.base + prop.height / 2, prop.z) });
        body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), prop.rotation);
        world.addBody(body); bodies.set(prop.id, body);
      } else if (!alive && bodies.has(prop.id)) {
        world.removeBody(bodies.get(prop.id)); bodies.delete(prop.id);
        for (const body of world.bodies) if (body.mass > 0) body.wakeUp();
      }
      pose.position.set(prop.x, prop.base + prop.height / 2, prop.z);
      pose.rotation.set(0, prop.rotation, 0);
      pose.scale.set(prop.width, prop.height, prop.depth); pose.updateMatrix();
      mesh.setMatrixAt(index, alive ? pose.matrix : hidden);
      color.setHex(prop.kind === "generator" ? 0x8e977e : 0xb48b58)
        .multiplyScalar(.65 + .35 * states[index].health / PROP_HEALTH);
      mesh.setColorAt(index, color);
      for (let band = 0; band < 4; band++) {
        const localX = band < 2 ? (band ? 1 : -1) * prop.width * .32 : 0;
        const localY = band < 2 ? 0 : (band === 2 ? -1 : 1) * prop.height * .32;
        pose.position.set(prop.x + localX * Math.cos(prop.rotation) + (prop.depth / 2 - .02) * Math.sin(prop.rotation),
          prop.base + prop.height / 2 + localY,
          prop.z - localX * Math.sin(prop.rotation) + (prop.depth / 2 - .02) * Math.cos(prop.rotation));
        pose.scale.set(band < 2 ? .11 : prop.width, band < 2 ? prop.height : .1, .035);
        pose.updateMatrix(); trim.setMatrixAt(index * 4 + band, alive ? pose.matrix : hidden);
      }
      if (contacts) {
        pose.position.set(prop.x, prop.base + .008, prop.z);
        pose.rotation.set(-Math.PI / 2, 0, -prop.rotation);
        pose.scale.set(prop.width * 1.65, prop.depth * 1.8, 1); pose.updateMatrix();
        contacts.setMatrixAt(index, alive ? pose.matrix : hidden);
      }
      if (effects && previous[index]?.health > 0 && !alive) onBreak(prop);
    }
    for (const object of [mesh, trim, contacts].filter(Boolean)) object.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    previous = states.map((state) => ({ ...state }));
    geometry = nextGeometry;
    return geometry;
  }
  sync(createDestructibles(mapId), false);
  return { group, mesh, bodies, sync, get geometry() { return geometry; },
    dispose() {
      for (const body of bodies.values()) world.removeBody(body);
      bodies.clear(); scene.remove(group);
      disposeSceneResources(group, new Set([contactTexture]));
    } };
}
