import * as THREE from "three";
import { staffLabel } from "../shared/staff.js";

export function createPlayerTag(name, role) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  context.fillStyle = "#0a1510dd";
  context.fillRect(0, 0, 512, 128);
  context.textAlign = "center";
  context.font = "600 38px sans-serif";
  context.fillStyle = "#edf2e7";
  context.fillText(String(name).slice(0, 18), 256, staffLabel(role) ? 52 : 78, 488);
  if (staffLabel(role)) {
    context.font = "600 30px sans-serif";
    context.fillStyle = role === "owner" || role === "co-owner" ? "#e9ca83" :
      role === "developer" || role === "co-dev" ? "#8fc6e3" : "#acd2a2";
    context.fillText(staffLabel(role), 256, 102);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: true, depthWrite: false }));
  sprite.position.y = 2.3;
  sprite.scale.set(2.7, .675, 1);
  return sprite;
}

export function disposePlayerTag(sprite) {
  sprite.material.map.dispose();
  sprite.material.dispose();
}
