import * as THREE from "three";
import { tacticalHeadCenter } from "./tactical-enemies.js";

export function confirmedBloodContact(enemy, hit, origin, direction) {
  const incoming = new THREE.Vector3(direction.x, direction.y, direction.z).normalize();
  const shotOrigin = hit.position && Number.isFinite(hit.distance)
    ? new THREE.Vector3(hit.position.x, hit.position.y, hit.position.z).addScaledVector(incoming, -hit.distance)
    : new THREE.Vector3(origin.x, origin.y, origin.z);
  const raycaster = new THREE.Raycaster(shotOrigin, incoming, 0, 100);
  enemy.mesh.updateMatrixWorld(true);
  const headshot = (hit.contactZone || hit.hitZone) === "head";
  const intersections = enemy.skinned ? raycaster.intersectObject(enemy.skinned) : [];
  const visible = intersections.find((intersection) => {
    const group = enemy.skinned.geometry.groups.find((candidate) =>
      intersection.faceIndex * 3 >= candidate.start && intersection.faceIndex * 3 < candidate.start + candidate.count);
    return group?.materialIndex !== 2 && (headshot
      ? intersection.point.y > enemy.mesh.position.y + (enemy.type === "brute" ? 1.85 : 1.65)
      : intersection.point.y < enemy.mesh.position.y + (enemy.type === "brute" ? 1.85 : 1.65));
  });
  if (visible) {
    const normal = visible.face.normal.clone().applyNormalMatrix(
      new THREE.Matrix3().getNormalMatrix(enemy.skinned.matrixWorld)).normalize();
    if (normal.dot(incoming) > 0) normal.negate();
    return { position: visible.point, normal };
  }
  // Authoritative forgiving spheres can confirm a graze outside the visible mesh.
  const center = headshot && enemy.template ? tacticalHeadCenter(enemy) :
    enemy.mesh.localToWorld(new THREE.Vector3(0, headshot ? (enemy.type === "brute" ? 2.1 : 1.9) : 1.38, 0));
  const normal = incoming.clone().negate();
  const radius = headshot ? .10 : enemy.type === "brute" ? .23 : .19;
  return { position: center.addScaledVector(normal, radius), normal };
}
