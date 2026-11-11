import * as THREE from "three";

const matteMaterials = new WeakSet();

export function matteMaterial(material) {
  if (matteMaterials.has(material)) return material;
  if ("envMap" in material) material.envMap = null;
  if ("envMapIntensity" in material) material.envMapIntensity = 0;
  if ("reflectivity" in material) material.reflectivity = 0;
  if ("metalness" in material) material.metalness = 0;
  if ("roughness" in material) material.roughness = 1;
  if ("specular" in material) material.specular.setHex(0);
  for (const property of ["clearcoat", "sheen", "iridescence", "transmission", "specularIntensity"]) {
    if (property in material) material[property] = 0;
  }
  if (material.isMeshStandardMaterial) {
    const compile = material.onBeforeCompile;
    const programKey = material.customProgramCacheKey();
    material.onBeforeCompile = function (shader, renderer) {
      compile.call(this, shader, renderer);
      const anchor = "#include <lights_fragment_end>";
      if (!shader.fragmentShader.includes(anchor)) throw new Error("Matte lighting shader is incompatible with this Three.js version.");
      // Standard materials have no specular-intensity control; remove both reflected-light terms.
      shader.fragmentShader = shader.fragmentShader.replace(anchor,
        `${anchor}\nreflectedLight.directSpecular = vec3(0.0);\nreflectedLight.indirectSpecular = vec3(0.0);`);
    };
    material.customProgramCacheKey = () => `${programKey}:last-light-matte`;
  }
  matteMaterials.add(material);
  material.needsUpdate = true;
  return material;
}

export function matteSurfaces(root) {
  root.traverse((object) => {
    for (const material of object.material ?
      Array.isArray(object.material) ? object.material : [object.material] : []) matteMaterial(material);
  });
}

export function weaponFinishMaps(polymer = false) {
  const size = 128;
  const color = new Uint8Array(size * size * 4);
  const normal = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const index = (y * size + x) * 4;
    const noise = ((x * 73 + y * 151 + x * y * 19) % 127) / 127;
    const grain = polymer ? noise : .5 + Math.sin(y * 2.4) * .25 + noise * .25;
    const scuff = !polymer && y % 37 === 0 && x > 12 && x < 96;
    const luminance = Math.round((polymer ? 225 : 232) + grain * 18 + (scuff ? 5 : 0));
    color.set([luminance, luminance, luminance, 255], index);
    normal.set([128 + Math.round((grain - .5) * 12),
      128 + Math.round((noise - .5) * 10), 255, 255], index);
    const value = Math.round((polymer ? 225 : 190) + noise * 24 - (scuff ? 45 : 0));
    rough.set([value, value, value, 255], index);
  }
  const texture = (bytes) => {
    const map = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    map.repeat.set(polymer ? 5 : 3, polymer ? 5 : 3);
    map.needsUpdate = true;
    return map;
  };
  const map = texture(color);
  map.colorSpace = THREE.SRGBColorSpace;
  return { map, normalMap: texture(normal), roughnessMap: texture(rough) };
}
