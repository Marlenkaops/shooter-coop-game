import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export function createTeamVisual(kind) {
  const root = new THREE.Group();
  const color = kind === "station" ? 0x80b9df : kind === "escort" ? 0xe7bd74 : 0x93d8a1;
  const pieces = [new THREE.BoxGeometry(1, .4, .65)];
  if (kind === "escort") {
    for (const x of [-.65, .65]) for (const z of [-.45, .45]) {
      pieces.push(new THREE.CylinderGeometry(.28, .28, .08, 8).translate(x, .18, z));
    }
  } else pieces.push(new THREE.BoxGeometry(.8, .07, .5).translate(0, .35, 0));
  const geometry = mergeGeometries(pieces);
  for (const piece of pieces) piece.dispose();
  const housing = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x354a40, roughness: 1 }));
  const signal = new THREE.Mesh(new THREE.BoxGeometry(.55, .08, .1),
    new THREE.MeshBasicMaterial({ color }));
  signal.position.set(0, .23, .33);
  const radius = kind === "station" ? 4 : kind === "hack" ? 1.8 : 5;
  const ring = new THREE.Mesh(new THREE.RingGeometry(radius - .06, radius, 32),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: .5, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -.535;
  root.add(housing, signal, ring);
  root.traverse((node) => { if (node.isMesh) node.userData.disposeGeometry = true; });
  return root;
}
