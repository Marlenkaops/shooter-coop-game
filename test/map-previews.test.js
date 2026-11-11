import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { MAPS } from "../shared/progression.js";
import { PRACTICE_MAP } from "../shared/practice.js";
import { eventContentAvailable } from "../shared/events.js";

test("every available arena and the practice range have distinct, bounded full-size WebP previews", () => {
  const hashes = new Set();
  for (const map of [...MAPS.filter((map) => eventContentAvailable(map.id)), PRACTICE_MAP]) {
    const image = fs.readFileSync(new URL(`../public/map-previews/${map.id}.webp`, import.meta.url));
    assert.equal(image.toString("ascii", 0, 4), "RIFF", map.id);
    assert.equal(image.toString("ascii", 8, 12), "WEBP", map.id);
    assert.equal(image.readUInt32LE(4) + 8, image.length, map.id);
    assert.equal(image.toString("ascii", 12, 16), "VP8X", map.id);
    assert.equal(image.readUIntLE(24, 3) + 1, 1200, map.id);
    assert.equal(image.readUIntLE(27, 3) + 1, 720, map.id);
    assert.ok(image.length < 128 * 1024, `${map.id} exceeds the preview image budget`);
    const hash = createHash("sha256").update(image).digest("hex");
    assert.equal(hashes.has(hash), false, `${map.id} reuses another arena's image`);
    hashes.add(hash);
  }
});
