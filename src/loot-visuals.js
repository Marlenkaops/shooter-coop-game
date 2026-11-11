import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { weaponFor } from "../shared/weapons.js";
import { matteMaterial } from "./surface-finish.js";

const templates = new Map();
const finishes = { rifle: 0x50695e, smg: 0x8d5d44, carbine: 0x62705a, pdw: 0x465c64,
  shotgun: 0x5e6456, autoshotgun: 0x79715e, marksman: 0x4e646c, battle: 0x867d63,
  lmg: 0x7b7852, sniper: 0x626b64, pistol: 0x637986, heavyPistol: 0x9c7861,
  jackolantern: 0xc48142, graveglass: 0x597d76 };

export function createLootVisual(loot) {
  const key = loot.source === "chest" ? "chest" : loot.kind === "weapon" ? loot.weaponId : loot.kind;
  if (!templates.has(key)) {
    const buckets = [[], []];
    const part = (geometry, index, position, rotation = [0, 0, 0]) => {
      geometry.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...position),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(1, 1, 1)));
      buckets[index].push(geometry);
    };
    const box = (size, index, position, rotation) => part(new THREE.BoxGeometry(...size), index, position, rotation);
    const cylinder = (radius, length, index, position) =>
      part(new THREE.CylinderGeometry(radius, radius, length, 8), index, position, [Math.PI / 2, 0, 0]);
    if (key === "chest") {
      box([1.15, .5, .68], 0, [0, -.1, 0]);
      box([1.2, .09, .73], 0, [0, .19, 0]);
      for (const side of [-1, 1]) {
        box([.07, .12, .035], 1, [side * .37, .12, .37]);
        box([.075, .52, .69], 1, [side * .43, -.1, 0]);
      }
      box([.25, .04, .04], 1, [0, .015, .37]);
    } else if (key === "medkit") {
      box([.48, .28, .32], 0, [0, 0, 0]);
      box([.2, .05, .08], 1, [0, .165, 0]);
      box([.18, .025, .06], 1, [0, .153, .08]);
      box([.06, .025, .18], 1, [0, .153, .08]);
      box([.18, .06, .025], 1, [0, 0, .17]);
      box([.06, .18, .025], 1, [0, 0, .17]);
    } else if (key === "ammo") {
      box([.3, .18, .22], 0, [0, 0, 0]);
      for (let index = 0; index < 3; index++) {
        box([.03, .03, .19], 1, [-.09 + index * .09, .105, 0]);
      }
    } else {
      const weapon = weaponFor(loot.weaponId), compact = ["smg", "pdw"].includes(weapon.model);
      const sidearm = ["pistol", "heavyPistol"].includes(weapon.id);
      const precision = ["sniper", "marksman", "carbine", "battle"].includes(weapon.model);
      const length = sidearm ? weapon.id === "pistol" ? .08 : .14 : compact ? .26 : precision ? .48 : .36;
      box([.065, .085, .27], 0, [0, 0, 0]);
      box([.05, .07, length], 0, [0, 0, .16 + length / 2]);
      cylinder(weapon.pellets ? .022 : .013, .13, 1, [0, 0, .225 + length]);
      if (!sidearm) box([.055, .085, compact ? .12 : .22], 0, [0, -.015, -.2]);
      box([.035, .1, .055], 0, [0, -.085, -.06], [.2, 0, 0]);
      if (weapon.model === "lmg") box([.13, .125, .16], 0, [0, -.10, .035]);
      else if (weapon.model === "autoshotgun") cylinder(.09, .1, 0, [0, -.12, .04]);
      else if (weapon.model === "pdw") box([.075, .03, .25], 0, [0, .058, .09]);
      else box([.04, sidearm ? .08 : .13, .06], 0, [0, -.1, sidearm ? -.06 : weapon.model === "battle" ? -.18 : .025], [.15, 0, 0]);
      if (weapon.optic.zoom > 1) {
        cylinder(weapon.id === "sniper" ? .035 : .024, .17, 1, [0, .09, -.01]);
        box([.03, .04, .08], 0, [0, .06, -.01]);
      } else box([.035, .045, .045], 1, [0, .07, -.01]);
      if (weapon.model === "carbine") cylinder(.027, .15, 0, [0, 0, .27 + length]);
      if (weapon.id === "heavyPistol") cylinder(.027, .09, 0, [0, 0, .25 + length]);
      if (weapon.id === "jackolantern") for (const side of [-1, 1]) {
        part(new THREE.CylinderGeometry(.017, .017, .26, 8), 0, [side * .026, -.028, .38], [Math.PI / 2, 0, 0]);
      }
      if (weapon.id === "graveglass") cylinder(.028, .18, 0, [0, 0, .28 + length]);
    }
    const parts = buckets.map((bucket) => {
      const merged = mergeGeometries(bucket);
      bucket.forEach((geometry) => geometry.dispose());
      return merged;
    });
    const geometry = mergeGeometries(parts, true);
    parts.forEach((part) => part.dispose());
    const materials = [
      new THREE.MeshStandardMaterial({ color: finishes[key] ?? (key === "medkit" ? 0xd1d4bb : key === "chest" ? 0x52614e : 0x776c4d), roughness: .74, metalness: .18 }),
      new THREE.MeshStandardMaterial({ color: key === "medkit" ? 0x49734b : key === "chest" || key === "ammo" ? 0xa49566 : 0x353b3b, roughness: .46, metalness: .66 })
    ];
    materials.forEach((material) => { matteMaterial(material); material.userData.shared = true; });
    templates.set(key, { geometry, materials });
  }
  const { geometry, materials } = templates.get(key), mesh = new THREE.Mesh(geometry, materials);
  if (loot.source !== "chest" && loot.kind === "weapon") mesh.rotation.z = Math.PI / 2;
  return mesh;
}
