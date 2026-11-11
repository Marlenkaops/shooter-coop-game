import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { RANGE_LANES } from "../shared/practice.js";

function label(text, width = 2.4, height = .6) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  context.fillStyle = "#173f42";
  context.fillRect(0, 0, 512, 128);
  context.fillStyle = "#e8ead7";
  context.font = `bold ${text.length > 14 ? 42 : 54}px sans-serif`;
  context.textAlign = "center";
  context.fillText(text, 256, 84);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
}

export function addRangeDetails(scene) {
  const paint = new THREE.MeshStandardMaterial({ color: 0xc5d39c, roughness: .95 });
  for (const [index, x] of RANGE_LANES.entries()) {
    for (const edge of [-3.5, 3.5]) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(.06, 49), paint);
      line.rotation.x = -Math.PI / 2;
      line.position.set(x + edge, .012, -10.5);
      scene.add(line);
    }
    const lane = label(`LANE ${index + 1}`);
    lane.rotation.x = -Math.PI / 2;
    lane.position.set(x, .015, 16);
    scene.add(lane);
  }
  const firingLine = new THREE.Mesh(new THREE.PlaneGeometry(35, .14), paint);
  firingLine.rotation.x = -Math.PI / 2;
  firingLine.position.set(0, .014, 14);
  scene.add(firingLine);
  const sign = label("WINTERWATCH RANGE", 10, 2.5);
  sign.position.set(0, 2.5, -36.45);
  scene.add(sign);
}

function paintedGeometry(geometry, color) {
  const tint = new THREE.Color(color), values = [];
  for (let index = 0; index < geometry.attributes.position.count; index++) values.push(tint.r, tint.g, tint.b);
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(values, 3));
  return geometry;
}

export function createPracticeTarget(target, { christmas = true } = {}) {
  const mesh = new THREE.Group();
  const plates = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, roughness: .9, metalness: .15, emissive: 0xffdf9b, emissiveIntensity: 0
  });
  const frame = new THREE.MeshStandardMaterial({ color: 0x35443a, roughness: .76, metalness: .5 });
  const post = new THREE.Mesh(new THREE.BoxGeometry(.09, 1.25, .09), frame);
  post.position.y = -.375;
  const foot = new THREE.Mesh(new THREE.BoxGeometry(1.15, .1, .7), frame);
  foot.position.y = -.95;
  mesh.add(post, foot, plates);
  const pieces = [], festive = [];
  for (const [radius, y] of [[.6, .2], [.24, .9]]) {
    pieces.push(paintedGeometry(new THREE.CylinderGeometry(radius, radius, .12, 24)
      .rotateX(Math.PI / 2).translate(0, y, 0), 0xb86d46));
    for (const [scale, color] of [[.72, 0xe3e7cf], [.42, 0x34463b], [.16, 0xe3e7cf]]) {
      pieces.push(paintedGeometry(new THREE.CircleGeometry(radius * scale, 24)
        .translate(0, y, .065 + (1 - scale) * .003), color));
    }
    for (const [scale, color] of [[1, 0xb64c4b], [.82, 0xf0ead8], [.68, 0x286b5a], [.4, 0xb64c4b], [.16, 0xf2cf89]]) {
      festive.push(paintedGeometry(new THREE.CircleGeometry(radius * scale, 24)
        .translate(0, y, .075 + (1 - scale) * .005), color));
    }
  }
  const ribbon = new THREE.Shape();
  ribbon.moveTo(-.08, -.22); ribbon.lineTo(.08, -.22); ribbon.lineTo(.08, .62);
  ribbon.lineTo(-.08, .62); ribbon.closePath();
  festive.push(paintedGeometry(new THREE.ShapeGeometry(ribbon).translate(0, 0, .084), 0xf2cf89));
  const horizontal = new THREE.PlaneGeometry(.84, .12).translate(0, .2, .085);
  festive.push(paintedGeometry(horizontal, 0xf2cf89));
  const combine = (items) => {
    const geometry = mergeGeometries(items);
    items.forEach((piece) => piece.dispose());
    return new THREE.Mesh(geometry, steel);
  };
  const decoration = combine(festive);
  decoration.name = "christmas-target";
  decoration.visible = christmas;
  plates.add(combine(pieces), decoration);
  const distance = label(`${target.distance} m`, 1.25, .32);
  distance.position.set(0, -.66, .08);
  mesh.add(distance);
  mesh.traverse((object) => {
    if (object.isMesh) object.userData.disposeGeometry = true;
  });
  return { mesh, plates, steel, setChristmasEnabled(value) { decoration.visible = value; } };
}
