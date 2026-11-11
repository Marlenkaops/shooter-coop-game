import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { matteMaterial, matteSurfaces } from "../src/surface-finish.js";
import { createWeaponModel } from "../src/weapon-model.js";
import { createLootVisual } from "../src/loot-visuals.js";
import { WEAPONS } from "../shared/weapons.js";

test("matte finishes remove environmental and direct specular reflections without losing color, textures or transparency", () => {
  for (const Material of [THREE.MeshStandardMaterial, THREE.MeshPhysicalMaterial]) {
    const map = new THREE.Texture(), normalMap = new THREE.Texture(), roughnessMap = new THREE.Texture();
    const material = new Material({ color: 0x789abc, map, normalMap, roughnessMap,
      metalness: .8, roughness: .1, envMap: new THREE.Texture(), transparent: true, opacity: .14, depthWrite: false });
    if (material.isMeshPhysicalMaterial) {
      material.clearcoat = material.sheen = material.iridescence = material.transmission = 1;
    }
    assert.equal(matteMaterial(material), material);
    assert.equal(material.envMap, null);
    assert.equal(material.envMapIntensity, 0);
    assert.equal(material.metalness, 0);
    assert.equal(material.roughness, 1);
    assert.equal(material.map, map);
    assert.equal(material.normalMap, normalMap);
    assert.equal(material.roughnessMap, roughnessMap);
    assert.equal(material.color.getHex(), 0x789abc);
    assert.equal(material.opacity, .14);
    assert.equal(material.depthWrite, false);
    if (material.isMeshPhysicalMaterial) {
      for (const property of ["clearcoat", "sheen", "iridescence", "transmission", "specularIntensity"]) assert.equal(material[property], 0);
    }
    const shader = { fragmentShader: THREE.ShaderLib.physical.fragmentShader };
    material.onBeforeCompile(shader);
    for (const term of ["directSpecular", "indirectSpecular"]) assert.match(shader.fragmentShader, new RegExp(`reflectedLight\\.${term} = vec3\\(0\\.0\\)`));
    assert.ok(shader.fragmentShader.includes("#include <lights_fragment_end>"));
    assert.ok(shader.fragmentShader.includes("reflectedLight.directDiffuse"));
  }
});

test("matte shading composes existing hooks once, has a distinct cache key and rejects incompatible shaders", () => {
  const material = new THREE.MeshStandardMaterial();
  let calls = 0;
  material.onBeforeCompile = function (shader) { calls++; shader.fragmentShader = "// custom alpha\n" + shader.fragmentShader; };
  const originalKey = material.customProgramCacheKey();
  matteMaterial(material);
  const hook = material.onBeforeCompile;
  matteMaterial(material);
  assert.equal(material.onBeforeCompile, hook);
  assert.equal(material.customProgramCacheKey(), `${originalKey}:last-light-matte`);
  const shader = { fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader);
  assert.equal(calls, 1);
  assert.match(shader.fragmentShader, /^\/\/ custom alpha/);
  assert.equal(shader.fragmentShader.split("reflectedLight.directSpecular = vec3(0.0)").length, 2);
  assert.throws(() => material.onBeforeCompile({ fragmentShader: "incompatible" }), /incompatible/);
});

test("all gun finishes, transparent scope glass, cached loot and newly cloned materials are matte", () => {
  for (const id of Object.keys(WEAPONS)) {
    const gun = createWeaponModel(id);
    gun.root.traverse((object) => {
      for (const material of object.material ? [object.material] : []) {
        if (!material.isMeshStandardMaterial) continue;
        assert.equal(material.metalness, 0, id);
        assert.equal(material.envMapIntensity, 0, id);
        assert.match(material.customProgramCacheKey(), /last-light-matte/);
        if (material.userData.weaponSurface === "optical") assert.equal(material.opacity, .14);
      }
    });
    const loot = createLootVisual({ source: "drop", kind: "weapon", weaponId: id });
    for (const material of loot.material) assert.equal(material.metalness, 0);
  }
  const material = matteMaterial(new THREE.MeshPhysicalMaterial());
  const clone = material.clone();
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), [clone, material]));
  matteSurfaces(root);
  assert.match(clone.customProgramCacheKey(), /last-light-matte/);
});
