import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { ARENA_LIMIT } from "../shared/gameplay.js";

export function tiledBox(width, height, depth, tileSize) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const uv = geometry.attributes.uv;
  const dimensions = [
    [depth, height], [depth, height],
    [width, depth], [width, depth],
    [width, height], [width, height]
  ];
  dimensions.forEach(([uSize, vSize], face) => {
    for (let vertex = face * 4; vertex < face * 4 + 4; vertex++) {
      uv.setXY(vertex, uv.getX(vertex) * uSize / tileSize, uv.getY(vertex) * vSize / tileSize);
    }
  });
  return geometry;
}

export function mergedTiledBoxes(boxes, tileSize) {
  const pieces = boxes.map(([x, y, z, width, height, depth]) =>
    tiledBox(width, height, depth, tileSize).translate(x, y, z));
  const merged = mergeGeometries(pieces);
  for (const piece of pieces) piece.dispose();
  return merged;
}

export function roundedCoverGeometry(width, height, depth, compact) {
  const radius = Math.min(.065, width * .04, height * .04, depth * .04);
  const geometry = new RoundedBoxGeometry(width, height, depth, compact ? 1 : 2, radius);
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const uv = geometry.attributes.uv;
  for (let index = 0; index < position.count; index++) {
    const nx = Math.abs(normal.getX(index)), ny = Math.abs(normal.getY(index)), nz = Math.abs(normal.getZ(index));
    const x = position.getX(index), y = position.getY(index), z = position.getZ(index);
    uv.setXY(index, (nx > ny && nx > nz ? z : x) / 2.8,
      (ny > nx && ny > nz ? z : y) / 2.8);
  }
  return geometry;
}

export function desertRidgeGeometry(compact) {
  const segments = compact ? 64 : 128;
  const radii = [ARENA_LIMIT * Math.SQRT2 + 5, 79, 100, 132, 172];
  const positions = [], colors = [], indices = [];
  const color = new THREE.Color();
  for (let ring = 0; ring < radii.length; ring++) {
    for (let index = 0; index <= segments; index++) {
      const angle = index / segments * Math.PI * 2;
      const profile = 12 + Math.sin(angle * 3 + .7) * 5 + Math.sin(angle * 7 - .2) * 3 +
        Math.sin(angle * 17 + 1.6) * 1.5;
      const height = ring === 0 ? -.04 : profile * [0, .38, 1, .8, .25][ring];
      positions.push(Math.cos(angle) * radii[ring], height, Math.sin(angle) * radii[ring]);
      color.setHex(0xb5a38a).multiplyScalar(.85 + height / 110 + Math.sin(angle * 11) * .035);
      colors.push(color.r, color.g, color.b);
      if (ring < radii.length - 1 && index < segments) {
        const a = ring * (segments + 1) + index, b = a + segments + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
