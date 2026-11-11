import test from "node:test";
import assert from "node:assert/strict";
import { scopedFov, scopeLensFov, scopeSensitivity } from "../src/aim.js";

test("all magnified optics produce their specified angular magnification at every base FOV", () => {
  for (const base of [65, 76, 92]) {
    for (const zoom of [1.5, 2, 3, 4, 6]) {
      const scoped = scopedFov(base, zoom);
      const measured = Math.tan(base * Math.PI / 360) /
        Math.tan(scoped * Math.PI / 360);
      assert.ok(Math.abs(measured - zoom) < 1e-12);
      assert.ok(scoped > 0 && scoped < base);
      assert.ok(Math.abs(scopeSensitivity(1, zoom) - 1 / zoom) < 1e-12);
      assert.equal(scopeSensitivity(0, zoom), 1);
    }
  }
});

test("all circular optics preserve specified apparent magnification and normal peripheral vision", () => {
  for (const height of [390, 720, 844, 1080]) {
    for (const lens of [280, 300, 480]) {
      for (const zoom of [1.5, 2, 3, 4, 6]) {
        const base = 76;
        const optic = scopeLensFov(base, zoom, lens, height);
        const pixelMagnification = lens / height *
          Math.tan(base * Math.PI / 360) / Math.tan(optic * Math.PI / 360);
        assert.ok(Math.abs(pixelMagnification - zoom) < 1e-12);
      }
    }
  }
});
