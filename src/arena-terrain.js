import * as THREE from "three";
import * as CANNON from "cannon-es";
import { getMapTerrain } from "../shared/arena-layout.js";

export function terrainPrism(surface) {
  const w = surface.width / 2, d = surface.depth / 2;
  const vertices = [[-w, -.2, -d], [w, -.2, -d], [w, -.2, d], [-w, -.2, d],
    [-w, surface.height - d * surface.slope, -d], [w, surface.height - d * surface.slope, -d],
    [w, surface.height + d * surface.slope, d], [-w, surface.height + d * surface.slope, d]];
  const faces = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [3, 2, 6, 7], [0, 3, 7, 4], [1, 5, 6, 2]];
  return { vertices, faces };
}

export function terrainBody(surface, material) {
  const { vertices, faces } = terrainPrism(surface);
  return new CANNON.Body({
    mass: 0, position: new CANNON.Vec3(surface.x, 0, surface.z),
    collisionFilterGroup: 1, collisionFilterMask: 2, material,
    shape: new CANNON.ConvexPolyhedron({ vertices: vertices.map((v) => new CANNON.Vec3(...v)), faces })
  });
}

export function terrainGeometry(surface, floorSize) {
  const { vertices, faces } = terrainPrism(surface), positions = [], uv = [];
  for (const [faceIndex, face] of faces.entries()) {
    for (const index of [face[0], face[1], face[2], face[0], face[2], face[3]]) {
      const [x, y, z] = vertices[index];
      positions.push(x, y, z);
      uv.push((faceIndex >= 4 ? z + surface.z + floorSize / 2 : x + surface.x + floorSize / 2) / floorSize,
        (faceIndex < 2 ? -z - surface.z + floorSize / 2 : y) / floorSize);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  return geometry;
}

export function addArenaTerrain(scene, world, mapId, floorMaterial, worldMaterial, floorSize) {
  for (const surface of getMapTerrain(mapId)) {
    const mesh = new THREE.Mesh(terrainGeometry(surface, floorSize), floorMaterial);
    mesh.position.set(surface.x, 0, surface.z);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    scene.add(mesh);
    world.addBody(terrainBody(surface, worldMaterial));
  }
}
