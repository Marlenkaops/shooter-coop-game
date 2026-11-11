import * as THREE from "three";
import { getMapObstacles } from "../shared/gameplay.js";
import { getMapTerrain } from "../shared/arena-layout.js";
import { bloodSegmentHit } from "./blood-physics.js";

// How much incidental combat debris each detail level keeps alive.
export function combatDetailBudget(detail = 2, compact = false) {
  const level = Math.max(0, Math.min(3, Math.round(Number(detail) || 0)));
  return {
    decals: [0, 16, 40, 64][level] - (compact && level > 1 ? 16 : 0),
    smoke: [0, 4, 8, 12][level],
    smokeInterval: [Infinity, .12, .07, .05][level],
    casings: [8, 10, 24, 36][level] - (compact && level > 1 ? 10 : 0),
    casingRest: [0, 2.5, 6, 10][level]
  };
}

// Reconstruct the exact surface behind a server-confirmed cover impact. The server
// only returns a distance, so reject reconstructions that disagree with it.
export function impactSurface(mapId, origin, direction, distance, tolerance = .75) {
  if (!Number.isFinite(distance) || distance <= 0) return null;
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (!(length > 1e-9)) return null;
  const unit = { x: direction.x / length, y: direction.y / length, z: direction.z / length };
  const reach = distance + tolerance;
  const to = { x: origin.x + unit.x * reach, y: origin.y + unit.y * reach, z: origin.z + unit.z * reach };
  const obstacles = getMapObstacles(mapId);
  const hit = bloodSegmentHit(origin, to, obstacles, getMapTerrain(mapId));
  if (!hit || Math.abs(hit.distance - distance) > tolerance) return null;
  return { position: hit.position, normal: hit.normal, distance: hit.distance, obstacle: hit.obstacle, surface: hit.surface };
}

const metalKinds = new Set(["generator", "container", "tank", "pipe", "pylon", "vent", "terminal"]);
const impactProfiles = Object.freeze({
  metal: { color: 0xffc66b, speed: 3.2, life: .24 },
  concrete: { color: 0xb7b0a4, speed: 1.5, life: .42 },
  dirt: { color: 0x9e8868, speed: .85, life: .6 },
  wood: { color: 0xc49963, speed: 1.6, life: .4 },
  debris: { color: 0xb48b58, speed: 3.8, life: 1.1 },
  blast: { color: 0xffb450, speed: 3.2, life: .4 },
  flesh: { color: 0x9d4240, speed: .7, life: .22 }
});

export function contactMaterial(hit, mapId) {
  if (typeof mapId === "object") mapId = mapId.mapId;
  const kind = hit?.obstacle?.kind;
  if (metalKinds.has(kind)) return "metal";
  if (kind === "crate") return "wood";
  if (kind === "sandbag") return "dirt";
  if (kind) return "concrete";
  if (hit?.surface?.startsWith("wall-")) return "concrete";
  if (mapId === "void") return "metal";
  return ["tundra", "outpost", "airfield", "wickfall"].includes(mapId) ? "dirt" : "concrete";
}

export function footstepSurface(mapId, position) {
  const hit = bloodSegmentHit(position, { ...position, y: position.y - 3 },
    getMapObstacles(mapId), getMapTerrain(mapId));
  return contactMaterial(hit, mapId);
}

export function createSurfaceImpacts(scene, { count = 72 } = {}) {
  if (!Number.isInteger(count) || count < 1 || count > 128) throw new RangeError("Invalid impact pool size.");
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3), colors = new Float32Array(count * 3), sizes = new Float32Array(count);
  const styles = new Float32Array(count * 2);
  const particles = Array.from({ length: count }, () => ({
    life: 0, duration: 0, chip: false, size: 1, position: new THREE.Vector3(), velocity: new THREE.Vector3(), color: new THREE.Color()
  }));
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("impactSize", new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("impactStyle", new THREE.BufferAttribute(styles, 2).setUsage(THREE.DynamicDrawUsage));
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({
    size: .045, vertexColors: true, transparent: true, opacity: .8, depthWrite: false
  }));
  points.material.onBeforeCompile = (shader) => {
    shader.vertexShader = "attribute float impactSize; attribute vec2 impactStyle; varying vec2 vImpactStyle;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("gl_PointSize = size;", "gl_PointSize = size * impactSize; vImpactStyle = impactStyle;");
    shader.fragmentShader = "varying vec2 vImpactStyle;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_particle_fragment>", `
      vec2 uv = gl_PointCoord - .5;
      float c = cos(vImpactStyle.y), s = sin(vImpactStyle.y);
      uv = mat2(c, -s, s, c) * uv;
      float coverage = vImpactStyle.x > .5 ?
        (1.0 - smoothstep(.34, .4, abs(uv.x))) * (1.0 - smoothstep(.12, .18, abs(uv.y))) :
        1.0 - smoothstep(.1, .5, length(uv));
      diffuseColor.a *= coverage;
      if (diffuseColor.a < .01) discard;`);
  };
  points.frustumCulled = false;
  points.visible = false;
  scene.add(points);
  let next = 0;
  return {
    points, particles,
    emit(hit, material, random = Math.random) {
      if (!Object.hasOwn(impactProfiles, material)) throw new RangeError("Unknown impact material.");
      const profile = impactProfiles[material];
      for (let index = 0; index < (material === "debris" ? 14 : material === "blast" ? 12 : material === "metal" ? 7 : 5); index++) {
        const particle = particles[next++ % count];
        particle.position.copy(hit.position);
        particle.velocity.set(hit.normal.x, hit.normal.y, hit.normal.z)
          .multiplyScalar(profile.speed * (.5 + random() * .5));
        particle.velocity.x += (random() - .5) * profile.speed;
        particle.velocity.y += random() * profile.speed * .6;
        particle.velocity.z += (random() - .5) * profile.speed;
        particle.life = particle.duration = profile.life * (.8 + random() * .4);
        particle.color.setHex(profile.color);
        particle.chip = material === "wood" || material === "debris";
        particle.size = material === "debris" ? .08 + random() * .08 : material === "wood" ? .025 :
          material === "blast" ? 9 + random() * 5 : 1;
      }
    },
    update(dt) {
      if (!Number.isFinite(dt) || dt < 0) throw new RangeError("Invalid impact step.");
      const decay = Math.exp(-4 * dt), travel = (1 - decay) / 4;
      let active = false;
      for (let index = 0; index < count; index++) {
        const particle = particles[index];
        particle.life = Math.max(0, particle.life - dt);
        if (particle.life <= 0) {
          positions[index * 3 + 1] = -1000;
          continue;
        }
        active = true;
        particle.position.x += particle.velocity.x * travel;
        particle.position.z += particle.velocity.z * travel;
        particle.position.y += (particle.velocity.y + 2.45) * travel - 2.45 * dt;
        particle.velocity.multiplyScalar(decay);
        particle.velocity.y -= 2.45 * (1 - decay);
        particle.position.toArray(positions, index * 3);
        const fade = particle.life / particle.duration;
        sizes[index] = particle.chip ? particle.size / .045 * Math.min(1, fade * 4) :
          particle.size * (1 + (1 - fade) * 2);
        styles[index * 2] = Number(particle.chip);
        styles[index * 2 + 1] = index + fade * 9;
        colors[index * 3] = particle.color.r * fade;
        colors[index * 3 + 1] = particle.color.g * fade;
        colors[index * 3 + 2] = particle.color.b * fade;
      }
      points.visible = active;
      if (active) {
        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.color.needsUpdate = true;
        geometry.attributes.impactSize.needsUpdate = true;
        geometry.attributes.impactStyle.needsUpdate = true;
      }
    }
  };
}

function holeTexture() {
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = x / (size - 1) - .5, dy = y / (size - 1) - .5;
    const radius = Math.hypot(dx, dy) * 2, angle = Math.atan2(dy, dx);
    const chip = .82 + Math.sin(angle * 7) * .07 + Math.sin(angle * 13 + 1.7) * .05;
    const core = radius < .2 ? 1 : 0;
    const ring = radius < chip ? Math.max(0, 1 - radius / chip) : 0;
    const shade = core ? 18 : Math.round(80 + radius * 120);
    const alpha = core ? 255 : Math.round(Math.min(1, ring * 1.6) * 170);
    data.set([shade, shade, shade, alpha], (y * size + x) * 4);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export function createImpactDecals(scene, { count = 40 } = {}) {
  if (count <= 0) return { add: () => false, mesh: null, dispose() {} };
  const material = new THREE.MeshStandardMaterial({
    map: holeTexture(), color: 0x6d655d, transparent: true, depthWrite: false, roughness: 1, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4
  });
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, count);
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let index = 0; index < count; index++) mesh.setMatrixAt(index, hidden);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.userData.combatDecals = true;
  scene.add(mesh);
  const transform = new THREE.Object3D(), normal = new THREE.Vector3(), forward = new THREE.Vector3(0, 0, 1);
  const spin = new THREE.Quaternion(), axis = new THREE.Vector3(0, 0, 1);
  let next = 0;
  return {
    mesh,
    add(hit, { size = .085, random = Math.random } = {}) {
      if (!hit?.position || !hit.normal) return false;
      normal.set(hit.normal.x, hit.normal.y, hit.normal.z).normalize();
      transform.position.set(hit.position.x, hit.position.y, hit.position.z).addScaledVector(normal, .004);
      transform.quaternion.setFromUnitVectors(forward, normal);
      transform.quaternion.multiply(spin.setFromAxisAngle(axis, random() * Math.PI * 2));
      transform.scale.setScalar(size * (.8 + random() * .45));
      transform.updateMatrix();
      mesh.setMatrixAt(next, transform.matrix);
      mesh.instanceMatrix.needsUpdate = true;
      next = (next + 1) % count;
      return true;
    },
    clear() {
      for (let index = 0; index < count; index++) mesh.setMatrixAt(index, hidden);
      mesh.instanceMatrix.needsUpdate = true;
      next = 0;
    }
  };
}

function smokeTexture() {
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = x / (size - 1) - .5, dy = y / (size - 1) - .5;
    const radius = Math.hypot(dx, dy) * 2;
    const wisp = .75 + Math.sin(x * .41 + Math.cos(y * .23) * 3) * .12 + Math.sin(y * .37) * .1;
    const alpha = Math.max(0, 1 - radius / wisp);
    data.set([235, 235, 235, Math.round(alpha * alpha * 210)], (y * size + x) * 4);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function createMuzzleSmoke(scene, { count = 8, interval = .07 } = {}) {
  if (count <= 0) return { emit: () => false, update() {}, puffs: [] };
  const texture = smokeTexture();
  const puffs = Array.from({ length: count }, () => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture, color: 0xc9c6bf, transparent: true, depthWrite: false, opacity: 0
    }));
    sprite.visible = false;
    sprite.renderOrder = 3;
    sprite.userData = { life: 0, duration: 1, velocity: new THREE.Vector3(), size: .1 };
    scene.add(sprite);
    return sprite;
  });
  let next = 0, cooldown = 0;
  return {
    puffs,
    emit(position, direction, { heavy = false, burst = false, random = Math.random } = {}) {
      if (cooldown > 0) return false;
      cooldown = interval;
      const puff = puffs[next];
      next = (next + 1) % puffs.length;
      puff.position.copy(position).addScaledVector(direction, .05);
      puff.userData.velocity.copy(direction).multiplyScalar(heavy ? .9 : .55)
        .add(new THREE.Vector3((random() - .5) * .12, .22 + random() * .12, (random() - .5) * .12));
      puff.userData.duration = puff.userData.life = (heavy ? 1.25 : .9) + random() * .25;
      puff.userData.size = burst ? .5 : heavy ? .16 : .1;
      puff.material.rotation = random() * Math.PI * 2;
      puff.visible = true;
      return true;
    },
    update(dt) {
      cooldown = Math.max(0, cooldown - dt);
      for (const puff of puffs) {
        if (!puff.visible) continue;
        const data = puff.userData;
        data.life -= dt;
        if (data.life <= 0) { puff.visible = false; continue; }
        const age = 1 - data.life / data.duration;
        puff.position.addScaledVector(data.velocity, dt);
        data.velocity.multiplyScalar(Math.exp(-2.4 * dt));
        data.velocity.y += .08 * dt;
        puff.scale.setScalar(data.size * (1 + age * 4.5));
        puff.material.opacity = .34 * Math.sin(Math.min(1, age * 1.15) * Math.PI) * (1 - age * .35);
        puff.material.rotation += dt * .35;
      }
    }
  };
}
