import * as THREE from "three";
import { matteSurfaces } from "./surface-finish.js";

export function createRaidMarker(objective) {
  const mesh = new THREE.Group();
  const color = objective.stage === 2 ? 0xd29565 : 0xa6c694;
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.95, 3.12, 32),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: .65, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -.535;
  mesh.add(ring);
  const housing = new THREE.MeshStandardMaterial({ color: 0x3e5046, roughness: 1 });
  const accent = new THREE.MeshStandardMaterial({ color, roughness: 1 });
  const console = new THREE.Mesh(new THREE.BoxGeometry(.8, .6, .45), housing);
  console.position.y = -.25;
  const lid = new THREE.Mesh(new THREE.BoxGeometry(.84, .08, .5), accent);
  lid.position.y = .09;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, 2.8, 8), housing);
  mast.position.set(-.35, .85, 0);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(.8, .45),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
  flag.position.set(.05, 2, 0);
  mesh.add(console, lid, mast, flag);
  mesh.traverse((object) => { if (object.isMesh) object.userData.disposeGeometry = true; });
  matteSurfaces(mesh);
  return mesh;
}
