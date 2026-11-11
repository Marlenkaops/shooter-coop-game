import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as THREE from "three";
import { decodeTacticalBody, fetchTacticalBody } from "../src/tactical-body.js";

const manifest = JSON.parse(fs.readFileSync(new URL("../public/models/tactical-body.json", import.meta.url)));
const bytes = fs.readFileSync(new URL("../public/models/tactical-body.bin", import.meta.url));
const buffer = () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

test("licensed sculpted body has facial anatomy on the same +Z side as rifles, plus a genuinely reduced LOD", () => {
  const decoded = decodeTacticalBody(manifest, buffer());
  assert.equal(manifest.assetId, "drummyfish-3d-male");
  assert.match(manifest.source, /Drummyfish.*CC0/);
  const { position, skinIndex, skinWeight } = decoded.meshes[0].geometry.attributes;
  const head = decoded.definitions.findIndex((joint) => joint.name === "Head");
  const nose = Array.from({ length: position.count }, (_, vertex) => vertex).filter((vertex) =>
    [0, 1, 2, 3].some((slot) => skinIndex.array[vertex * 4 + slot] === head &&
      skinWeight.array[vertex * 4 + slot] > .9)
  );
  assert.ok(nose.length > 100);
  assert.ok(Math.max(...nose.map((vertex) => position.getZ(vertex))) > decoded.headCenter.z + .07);
  assert.ok(Math.abs(decoded.headCenter.y - 1.9) < .001);
  assert.ok(Math.abs(decoded.headCenter.z) < .05);
  const vertices = (meshes) => meshes.reduce((sum, mesh) => sum + mesh.geometry.attributes.position.count, 0);
  assert.ok(vertices(decoded.distantMeshes) < vertices(decoded.meshes) * .35);
  assert.equal(decoded.definitions.length, 39);
});
test("model decoding explicitly rejects malformed metadata, attribute ranges, indices, and weights", () => {
  assert.throws(() => decodeTacticalBody(null, buffer()), /Invalid tactical/);
  for (const change of [
    (m) => { m.bones[1].parent = 1; },
    (m) => { m.headCenter[0] = Infinity; },
    (m) => { m.meshes[0].fields.position.offset = 1; },
    (m) => { m.meshes[0].fields.position.length = 2; },
    (m) => { m.meshes[0].fields.position.length = 1e9; },
    (m) => { m.meshes[0].fields.uv.type = "Uint16Array"; }
  ]) {
    const copy = structuredClone(manifest);
    change(copy);
    assert.throws(() => decodeTacticalBody(copy, buffer()));
  }
  for (const [field, Type, value] of [["index", Uint16Array, 65535], ["skinIndex", Uint16Array, 65535],
    ["skinWeight", Float32Array, -1], ["position", Float32Array, NaN]]) {
    const damaged = buffer();
    new Type(damaged, manifest.meshes[0].fields[field].offset, 1)[0] = value;
    assert.throws(() => decodeTacticalBody(manifest, damaged));
  }
});

test("realistic soldier loading preserves the creator's self-hosted skin texture and UV orientation", async (t) => {
  const requested = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    requested.push(url);
    return { ok: true, json: async () => manifest, arrayBuffer: async () => buffer() };
  });
  const texture = new THREE.Texture();
  t.mock.method(THREE.TextureLoader.prototype, "loadAsync", async (url) => {
    requested.push(url);
    return texture;
  });
  const body = await fetchTacticalBody();
  assert.equal(body.definitions.length, manifest.bones.length);
  assert.deepEqual(requested.sort(), ["/models/tactical-body.bin", "/models/tactical-body.json", "/models/tactical-skin.jpg"]);
  assert.equal(body.skinTexture, texture);
  assert.equal(texture.colorSpace, THREE.SRGBColorSpace);
  assert.equal(texture.flipY, true);
  for (const mesh of [...body.meshes, ...body.distantMeshes]) mesh.geometry.dispose();
});

test("failed skin downloads release decoded geometry and report the asset error", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({
    ok: true, json: async () => manifest, arrayBuffer: async () => buffer()
  }));
  t.mock.method(THREE.TextureLoader.prototype, "loadAsync", async () => { throw new Error("offline"); });
  let released = 0;
  t.mock.method(THREE.BufferGeometry.prototype, "dispose", () => { released++; });
  await assert.rejects(fetchTacticalBody(), /Tactical skin texture download failed/);
  assert.equal(released, manifest.meshes.length + manifest.distantMeshes.length);
});
