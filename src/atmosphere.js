import * as THREE from "three";
import { sceneLook } from "./scene-look.js";
import { getTerrainHeight } from "../shared/arena-layout.js";

export function lightingProfile(mapId) {
  return { exposure: mapId === "tundra" ? 1.02 : mapId === "wickfall" ? 1.14 : 1.1,
    hemisphere: mapId === "tundra" ? 1.08 : ["wickfall", "range"].includes(mapId) ? 1.05 : .86,
    ambient: mapId === "wickfall" ? .16 : .14, rim: .46 };
}

// Grade inside the existing output pass rather than adding another full-screen pass.
export function gradeAtmosphereOutput(pass) {
  const sample = "gl_FragColor = texture2D( tDiffuse, vUv );";
  if (!pass.material.fragmentShader.includes(sample)) throw new Error("Unsupported atmosphere output shader.");
  pass.material.fragmentShader = pass.material.fragmentShader.replace(sample, `${sample}
    float luminance = dot(gl_FragColor.rgb, vec3(.2126, .7152, .0722));
    vec3 splitTone = mix(vec3(.975, 1.0, 1.025), vec3(1.025, 1.005, .98), smoothstep(.08, .9, luminance));
    gl_FragColor.rgb *= splitTone;
    vec2 edge = (vUv - .5) * 1.4;
    gl_FragColor.rgb *= 1.0 - .055 * dot(edge, edge);`);
  pass.material.needsUpdate = true;
  return pass;
}

export function atmosphereProfile(mapId, compact = false) {
  return {
    density: mapId === "wickfall" ? .019 : mapId === "range" ? .006 : mapId === "tundra" ? .0085 : .007,
    wisps: compact ? 8 : 18,
    opacity: mapId === "wickfall" ? .17 : mapId === "range" ? .05 : .13
  };
}

function mistTexture() {
  const size = 32, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const radius = Math.hypot((x / 31 - .5) * 2, (y / 31 - .5) * 2);
    data.set([255, 255, 255, Math.round(120 * Math.max(0, 1 - radius) ** 2)], (y * size + x) * 4);
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.needsUpdate = true;
  return texture;
}

function addWickfallBelfry(scene) {
  const stone = new THREE.MeshStandardMaterial({ color: 0x606c65, roughness: .95 });
  const copper = new THREE.MeshStandardMaterial({ color: 0x9a704a, roughness: .8, metalness: .2 });
  const glow = new THREE.MeshStandardMaterial({
    color: 0xa2f4c9, emissive: 0x78dbaa, emissiveIntensity: 1.8, roughness: .7
  });
  const pieces = [[0, 11, -49, 7, 18, 6], [-4.6, 6, -49, 2, 9, 7], [4.6, 6, -49, 2, 9, 7]];
  const supports = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), stone, pieces.length);
  const pose = new THREE.Object3D();
  for (const [index, [x, y, z, width, height, depth]] of pieces.entries()) {
    pose.position.set(x, y, z); pose.scale.set(width, height, depth); pose.updateMatrix();
    supports.setMatrixAt(index, pose.matrix);
  }
  const roof = new THREE.Mesh(new THREE.ConeGeometry(5.8, 7, 4), copper);
  roof.position.set(.5, 23, -49); roof.rotation.set(.08, Math.PI / 4, -.1);
  const windows = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), glow, 3);
  for (let index = 0; index < 3; index++) {
    pose.position.set((index - 1) * 1.7, 16, -45.96); pose.scale.set(.7, 3.2, .08); pose.updateMatrix();
    windows.setMatrixAt(index, pose.matrix);
  }
  for (const mesh of [supports, roof, windows]) {
    mesh.userData.eventLandmark = true;
    scene.add(mesh);
  }
}

export function createAtmosphere(scene, mapId, { compact = false, reducedMotion = false } = {}) {
  const profile = atmosphereProfile(mapId, compact), color = sceneLook(mapId).fog;
  scene.fog = new THREE.FogExp2(color, profile.density);
  const material = new THREE.MeshBasicMaterial({
    map: mistTexture(), color, transparent: true, opacity: profile.opacity,
    depthWrite: false, side: THREE.DoubleSide
  });
  const mist = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, profile.wisps);
  mist.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mist.frustumCulled = false;
  mist.userData.atmosphericFog = true;
  scene.add(mist);
  if (mapId === "wickfall") addWickfallBelfry(scene);
  const pose = new THREE.Object3D();
  let time = 0;
  function update(dt, camera = { x: 0, z: 10 }, motionReduced = reducedMotion) {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError("Invalid atmosphere step.");
    if (!motionReduced) time += dt;
    for (let index = 0; index < profile.wisps; index++) {
      const angle = index * 2.399963, radius = 17 + index % 4 * 5;
      const x = Math.sin(angle) * radius + Math.sin(time * .08 + index) * 1.8;
      const z = Math.cos(angle) * radius + Math.cos(time * .06 + index) * .8;
      pose.position.set(x, getTerrainHeight(mapId, x, z) + .35 + index % 3 * .16, z);
      pose.rotation.set(0, Math.atan2(camera.x - pose.position.x, camera.z - pose.position.z), 0);
      pose.scale.set(10 + index % 3 * 3, .8 + index % 3 * .38, 1);
      pose.updateMatrix();
      mist.setMatrixAt(index, pose.matrix);
    }
    mist.instanceMatrix.needsUpdate = true;
  }
  update(0);
  return { mist, profile, update };
}
