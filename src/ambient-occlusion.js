import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";

export function occlusionSize(width, height) {
  const ratio = Math.min(.5, Math.sqrt(800_000 / Math.max(1, width * height)));
  return { width: Math.max(1, Math.floor(width * ratio)), height: Math.max(1, Math.floor(height * ratio)) };
}

export class BudgetedGTAOPass extends GTAOPass {
  setSize(width, height) {
    const size = occlusionSize(width, height);
    super.setSize(size.width, size.height);
  }
}
