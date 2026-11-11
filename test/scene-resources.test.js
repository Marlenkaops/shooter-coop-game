import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { disposeSceneResources } from "../src/scene-resources.js";

test("room switches dispose owned geometry, materials and textures once while retaining render targets", () => {
  const scene = new THREE.Scene(), geometry = new THREE.BoxGeometry();
  const texture = new THREE.Texture(), retained = new THREE.Texture();
  const material = new THREE.MeshBasicMaterial({ map: texture });
  const second = new THREE.MeshBasicMaterial({ map: retained });
  const counts = new Map();
  for (const resource of [geometry, texture, retained, material, second]) {
    resource.addEventListener("dispose", () => counts.set(resource, (counts.get(resource) || 0) + 1));
  }
  scene.add(new THREE.Mesh(geometry, [material, second]), new THREE.Mesh(geometry, material));
  scene.background = scene.environment = texture;
  disposeSceneResources(scene, new Set([retained]));
  for (const resource of [geometry, texture, material, second]) assert.equal(counts.get(resource), 1);
  assert.equal(counts.has(retained), false);
  retained.dispose();
});

test("room switches release light shadow render targets", () => {
  const scene = new THREE.Scene(), light = new THREE.DirectionalLight();
  const target = new THREE.WebGLRenderTarget(4, 4);
  let disposals = 0;
  target.addEventListener("dispose", () => { disposals++; });
  light.shadow.map = target;
  scene.add(light);
  disposeSceneResources(scene);
  assert.equal(disposals, 1);
});

test("instanced seasonal decorations release their per-instance GPU buffers", () => {
  const scene = new THREE.Scene();
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 3);
  let disposals = 0;
  mesh.addEventListener("dispose", () => { disposals++; });
  scene.add(mesh);
  disposeSceneResources(scene);
  assert.equal(disposals, 1);
});
