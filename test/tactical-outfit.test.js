import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { winterTacticalPalette, uniformVertexStyle, tacticalClothTexture, tacticalClothDetail, fittedJacketZipper } from "../src/tactical-outfit.js";
import { MAPS } from "../shared/progression.js";

test("winter outfits retain pale uniforms, dark yokes and blue lenses in all arenas", () => {
  for (const map of MAPS) for (const variant of [0, 1, 2]) {
    const palette = winterTacticalPalette(map.id, variant);
    assert.ok(Object.values(palette).every((value) => Number.isInteger(value)));
    const uniform = new THREE.Color(palette.uniform), yoke = new THREE.Color(palette.yoke);
    assert.ok(uniform.r > .5 && uniform.g > .5 && uniform.b > .5);
    assert.ok(yoke.r < .1 && yoke.b < .15);
    const lens = new THREE.Color(palette.lens);
    assert.ok(lens.b > lens.r && lens.g > lens.r);
  }
  assert.throws(() => winterTacticalPalette("missing", 0), RangeError);
});

test("padded sleeves and trousers retain joint lengths, while hands and heads keep their anatomy", () => {
  const palette = winterTacticalPalette("tundra", 0), normal = new THREE.Vector3(.7, .5, .5);
  const sleeve = new THREE.Vector3(.55, 1.6, -.07);
  const dressedSleeve = uniformVertexStyle(sleeve, normal, "lowerarm_r", palette);
  assert.equal(dressedSleeve.position[0], sleeve.x);
  assert.ok(dressedSleeve.position[1] > sleeve.y && dressedSleeve.position[2] > sleeve.z);
  assert.equal(dressedSleeve.color, palette.uniform);
  const axis = new THREE.Vector3(1, -.45, .1).normalize();
  const angled = uniformVertexStyle(sleeve, normal, "lowerarm_r", palette, axis);
  const offset = new THREE.Vector3(...angled.position).sub(sleeve);
  assert.ok(offset.length() > .02);
  assert.ok(Math.abs(offset.dot(axis)) < 1e-9);
  const trouser = new THREE.Vector3(.15, .6, .04);
  const dressedTrouser = uniformVertexStyle(trouser, normal, "calf_r", palette);
  assert.equal(dressedTrouser.position[1], trouser.y);
  assert.ok(dressedTrouser.position[0] > trouser.x);
  assert.equal(dressedTrouser.material, 0);
  const ankle = new THREE.Vector3(.15, .22, -.05);
  assert.deepEqual(uniformVertexStyle(ankle, normal, "calf_r", palette).position, ankle.toArray());
  for (const joint of ["Head", "hand_r", "index_01_l", "thumb_03_r"]) {
    const position = new THREE.Vector3(.1, 1.9, .1);
    const dressed = uniformVertexStyle(position, normal, joint, palette);
    assert.deepEqual(dressed.position, position.toArray());
    assert.equal(dressed.material, joint === "Head" ? 4 : 1);
    if (joint === "Head") assert.equal(dressed.color, 0xffffff);
  }
});

test("fabric and microdetail maps are small, repeatable shared assets with correct color spaces", () => {
  const camo = tacticalClothTexture(), weave = tacticalClothTexture(false), detail = tacticalClothDetail();
  assert.equal(camo, tacticalClothTexture());
  assert.equal(weave, tacticalClothTexture(false));
  assert.equal(detail, tacticalClothDetail());
  assert.notEqual(camo, weave);
  for (const texture of [camo, weave, detail.normalMap, detail.roughnessMap]) {
    assert.equal(texture.image.width, 128);
    assert.equal(texture.image.height, 128);
    assert.equal(texture.image.data.length, 128 * 128 * 4);
    assert.equal(texture.wrapS, THREE.RepeatWrapping);
    assert.equal(texture.wrapT, THREE.RepeatWrapping);
    assert.equal(texture.generateMipmaps, true);
  }
  assert.equal(camo.colorSpace, THREE.SRGBColorSpace);
  assert.equal(weave.colorSpace, THREE.SRGBColorSpace);
  assert.equal(detail.normalMap.colorSpace, THREE.NoColorSpace);
  assert.equal(detail.roughnessMap.colorSpace, THREE.NoColorSpace);
  const shades = camo.image.data.filter((_, index) => index % 4 === 0);
  assert.ok(new Set(shades).size > 20);
  assert.ok(shades.filter((value) => value > 230).length > shades.length * .5);
  assert.ok(shades.some((value) => value < 160));
});

test("jacket zippers follow the clothing surface and inherit its deformation weights", () => {
  const source = new THREE.PlaneGeometry(.5, 1, 1, 1);
  source.translate(0, 1.4, .2);
  const count = source.attributes.position.count;
  source.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(Array(count).fill([2, 3, 0, 0]).flat(), 4));
  source.setAttribute("skinWeight", new THREE.Float32BufferAttribute(Array(count).fill([.25, .75, 0, 0]).flat(), 4));
  const styles = Array.from({ length: count }, (_, index) => ({
    position: new THREE.Vector3().fromBufferAttribute(source.attributes.position, index).toArray()
  }));
  const zipper = fittedJacketZipper(source, styles, 0x7c8987);
  assert.equal(zipper.attributes.position.count, 24);
  assert.equal(zipper.index.count, 66);
  for (let vertex = 0; vertex < zipper.attributes.position.count; vertex++) {
    assert.ok(Math.abs(zipper.attributes.position.getZ(vertex) - .204) < 1e-6);
    const indices = zipper.attributes.skinIndex.array.subarray(vertex * 4, vertex * 4 + 4);
    const weights = zipper.attributes.skinWeight.array.subarray(vertex * 4, vertex * 4 + 4);
    const weightOf = (joint) => [...indices].reduce((sum, index, slot) => sum + (index === joint ? weights[slot] : 0), 0);
    assert.ok(Math.abs(weightOf(2) - .25) < 1e-6);
    assert.ok(Math.abs(weightOf(3) - .75) < 1e-6);
  }
  assert.throws(() => fittedJacketZipper(source, styles.map(({ position }) => ({
    position: [position[0] + 2, position[1], position[2]]
  })), 0xffffff), /Could not fit/);
  source.dispose(); zipper.dispose();
});
