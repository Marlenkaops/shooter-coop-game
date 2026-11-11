import test from "node:test";
import assert from "node:assert/strict";
import {
  createRefreshSampler, frameBudgetState, graphicsProfile, resolveQuality, textureDimensions, updateFrameBudget
} from "../src/graphics.js";
import { createGpuTimer } from "../src/gpu-timer.js";
import { sceneLook } from "../src/scene-look.js";
import { roundedCoverGeometry, desertRidgeGeometry } from "../src/scene-geometry.js";
import { MAPS } from "../shared/progression.js";
import { ARENA_LIMIT, getMapObstacles } from "../shared/gameplay.js";
import { occlusionSize } from "../src/ambient-occlusion.js";
import * as THREE from "three";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { createAtmosphere, gradeAtmosphereOutput, lightingProfile } from "../src/atmosphere.js";
import { getTerrainHeight } from "../shared/arena-layout.js";
import { disposeSceneResources } from "../src/scene-resources.js";

test("atmosphere grading reuses the output shader and fog stays grounded and frozen under reduced motion", () => {
  const pass = new OutputPass(), material = pass.material;
  assert.strictEqual(gradeAtmosphereOutput(pass), pass);
  assert.strictEqual(pass.material, material);
  assert.match(pass.material.fragmentShader, /splitTone/);
  pass.dispose();
  for (const { id } of MAPS) {
    const lighting = lightingProfile(id);
    assert.ok(lighting.exposure >= 1 && lighting.exposure <= 1.15);
    const scene = new THREE.Scene(), fog = createAtmosphere(scene, id, { compact: true, reducedMotion: true });
    const initial = fog.mist.instanceMatrix.array.slice();
    fog.update(1);
    assert.deepEqual(fog.mist.instanceMatrix.array, initial);
    for (let index = 0; index < fog.mist.count; index++) {
      const matrix = new THREE.Matrix4(); fog.mist.getMatrixAt(index, matrix);
      const position = new THREE.Vector3().setFromMatrixPosition(matrix);
      assert.ok(position.y >= getTerrainHeight(id, position.x, position.z) + .3);
    }
    fog.update(1, { x: 0, z: 10 }, false);
    assert.notDeepEqual(fog.mist.instanceMatrix.array, initial);
    assert.ok(fog.mist.count <= 8);
    disposeSceneResources(scene);
  }
});

test("Ultra adds bounded contact shading only on unconstrained desktops, never on phones", () => {
  const desktop = graphicsProfile({ width: 1920, height: 1080, quality: "ultra" });
  assert.equal(desktop.ambientOcclusion, true);
  assert.equal(desktop.focusedShadows, true);
  assert.equal(desktop.shadowSize, 2048);
  const phone = graphicsProfile({ width: 1440, height: 3200, pixelRatio: 3, touch: true, quality: "ultra" });
  assert.equal(phone.ambientOcclusion, false);
  assert.equal(phone.compact, true);
  assert.equal(phone.shadows, false);
  assert.ok(1440 * 3200 * phone.pixelRatio ** 2 <= 1_000_000 + 1e-6);
  for (const [width, height] of [[1920, 1080], [3840, 2160], [1, 1]]) {
    const size = occlusionSize(width, height);
    assert.ok(size.width * size.height <= 800_000);
  }
});

test("phone rendering respects a one-megapixel budget without high-cost shadow or bloom passes", () => {
  for (const [width, height] of [[390, 844], [844, 390], [1440, 3200]]) {
    const profile = graphicsProfile({ width, height, pixelRatio: 3, touch: true });
    assert.ok(width * height * profile.pixelRatio ** 2 <= 1_000_000 + 1e-6);
    assert.equal(profile.compact, true);
    assert.equal(profile.shadows, false);
    assert.equal(profile.postProcessing, false);
    assert.equal(profile.pointLights, 0);
    assert.equal(profile.surfaceMaps, "pbr");
    assert.equal(profile.textureSize, 512);
    assert.equal(profile.photographicSky, true);
    assert.equal(profile.hdr, false);
  }
});

test("refresh sampling recognizes real 120/144 Hz cadence without mistaking missed frames for a 60 Hz screen", () => {
  for (const hz of [60, 90, 120, 144, 165, 240]) {
    const sampler = createRefreshSampler();
    for (let frame = 0; frame < 120; frame++) sampler.sample(frame % 9 === 0 ? 80 : 1000 / hz);
    assert.equal(sampler.hz, hz);
    for (let frame = 0; frame < 120; frame++) sampler.sample(1000 / 30);
    assert.equal(sampler.hz, hz);
    assert.equal(sampler.sample(NaN), hz);
  }
});

test("120 FPS uses the 8.33 ms budget, not the old 55 ms stall threshold", () => {
  let state = frameBudgetState();
  for (let frame = 0; frame < 150; frame++) state = updateFrameBudget(state, {
    frameMs: 1000 / 90, workMs: 10, targetFps: 120, displayHz: 120, elapsed: 1 / 90
  });
  assert.ok(state.scale < 1, "90 FPS cannot satisfy a 120 FPS target");
  assert.ok(state.scale >= .65);
  const idle = updateFrameBudget(frameBudgetState(), {
    frameMs: 1200, workMs: 900, targetFps: 120, displayHz: 120, elapsed: 1.2
  });
  assert.equal(idle.scale, 1, "loading/wake-up spike is ignored");
  let stalled = frameBudgetState();
  for (let frame = 0; frame < 40; frame++) stalled = updateFrameBudget(stalled, {
    frameMs: 400, workMs: 20, targetFps: 120, displayHz: 60, elapsed: .4
  });
  assert.ok(stalled.scale < .8, "repeated multi-hundred-ms frames are sustained load, not isolated spikes");
  assert.throws(() => updateFrameBudget(state, {
    frameMs: NaN, workMs: 0, targetFps: 120, displayHz: 120, elapsed: .008
  }), RangeError);
});

test("a 60 Hz browser is not blurred to chase unavailable 120 Hz and stable headroom restores detail", () => {
  let state = frameBudgetState();
  for (let frame = 0; frame < 600; frame++) state = updateFrameBudget(state, {
    frameMs: 1000 / 60, workMs: 8, targetFps: 120, displayHz: 60, elapsed: 1 / 60
  });
  assert.equal(state.scale, 1);
  state = frameBudgetState(.65);
  for (let frame = 0; frame < 8000; frame++) state = updateFrameBudget(state, {
    frameMs: 1000 / 120, workMs: 3, targetFps: 120, displayHz: 120, elapsed: 1 / 120
  });
  assert.equal(state.scale, 1, "recovery is gradual, bounded and reversible");
  state = frameBudgetState();
  for (let frame = 0; frame < 3000; frame++) state = updateFrameBudget(state, {
    frameMs: 33, workMs: 28, targetFps: 120, displayHz: 120, elapsed: .033
  });
  assert.equal(state.scale, .65, "resolution has a readability floor");
});

test("GPU timing is nonblocking, bounded to one query and discards invalid disjoint samples", () => {
  let created = 0, deleted = 0, ended = 0, available = false, disjoint = false;
  const gl = {
    getExtension: () => ({ TIME_ELAPSED_EXT: 1, GPU_DISJOINT_EXT: 2 }),
    isContextLost: () => false, createQuery: () => ({ id: ++created }),
    beginQuery: () => {}, endQuery: () => { ended++; }, deleteQuery: () => { deleted++; },
    getParameter: () => disjoint, QUERY_RESULT_AVAILABLE: 3, QUERY_RESULT: 4,
    getQueryParameter: (query, field) => field === 3 ? available : 8_000_000
  };
  const timer = createGpuTimer(gl);
  timer.begin(); timer.begin();
  assert.equal(created, 1);
  assert.equal(timer.read(), null);
  timer.end(); timer.end();
  assert.equal(ended, 1);
  assert.equal(timer.read(), null);
  available = true;
  assert.equal(timer.read(), 8, "nanoseconds converted to milliseconds");
  assert.equal(deleted, 1);
  timer.begin(); timer.end(); disjoint = true;
  assert.equal(timer.read(), null);
  assert.equal(deleted, 2);
  const unsupported = createGpuTimer({ getExtension: () => null });
  unsupported.begin(); unsupported.end();
  assert.equal(unsupported.read(), null);
  assert.equal(unsupported.supported, false);
});

test("desktop adaptive rendering improves edges and shadows within a fixed pixel budget", () => {
  const profile = graphicsProfile({ width: 3840, height: 2160, pixelRatio: 2 });
  assert.ok(3840 * 2160 * profile.pixelRatio ** 2 <= 2_500_000 + 1e-6);
  assert.equal(profile.antialias, true);
  assert.equal(profile.shadows, true);
  assert.equal(profile.shadowSize, 1024);
  assert.equal(profile.postProcessing, false);
  const high = graphicsProfile({ width: 1920, height: 1080, pixelRatio: 2, quality: "high" });
  assert.equal(high.postProcessing, true);
  assert.equal(high.shadowSize, 2048);
  assert.equal(profile.surfaceMaps, "pbr");
  assert.equal(profile.textureSize, 1024);
  assert.equal(profile.hdr, true);
});

test("low-memory devices and explicit low quality use compact geometry", () => {
  assert.equal(graphicsProfile({ width: 800, height: 600, memory: 2 }).compact, true);
  const low = graphicsProfile({ width: 1920, height: 1080, quality: "low", pixelRatio: 2 });
  assert.equal(low.compact, true);
  assert.equal(low.hdr, false);
  assert.equal(low.antialias, false);
  assert.equal(low.surfaceMaps, "procedural");
  assert.equal(low.photographicSky, false);
  assert.ok(low.pixelRatio <= .75);
  const constrained = graphicsProfile({ width: 390, height: 844, touch: true, memory: 2 });
  assert.equal(constrained.surfaceMaps, "procedural");
  assert.equal(constrained.photographicSky, false);
  const high = graphicsProfile({ width: 390, height: 844, touch: true, quality: "high", memory: 2, pixelRatio: 3 });
  assert.equal(high.compact, false);
  assert.equal(high.surfaceMaps, "pbr");
  assert.equal(high.shadows, false);
  assert.equal(high.postProcessing, false);
  assert.ok(390 * 844 * high.pixelRatio ** 2 <= 1_800_000);
});

test("texture resizing preserves aspect ratio and never enlarges small images", () => {
  assert.deepEqual(textureDimensions(2048, 1024, 512), { width: 512, height: 256 });
  assert.deepEqual(textureDimensions(256, 128, 512), { width: 256, height: 128 });
  assert.throws(() => textureDimensions(0, 1024, 512), RangeError);
});

test("every authorized arena has complete, immutable soldier and lighting palettes", () => {
  for (const map of MAPS) {
    const look = sceneLook(map.id);
    assert.equal(look.soldiers.length, 3);
    assert.equal(look.equipment.length, 3);
    assert.ok(look.sunStrength > 0);
    assert.ok(look.sunPosition.every(Number.isFinite));
    assert.ok(Object.isFrozen(look));
    assert.ok(Object.isFrozen(look.soldiers));
  }
  assert.throws(() => sceneLook("missing"), RangeError);
  assert.throws(() => sceneLook("__proto__"), RangeError);
});

test("rounded cover remains inside authoritative cover dimensions with finite world-scaled UVs", () => {
  for (const map of MAPS) {
    for (const obstacle of getMapObstacles(map.id)) {
      const geometry = roundedCoverGeometry(obstacle.width, obstacle.height, obstacle.depth, true);
      geometry.computeBoundingBox();
      const size = geometry.boundingBox.getSize(geometry.boundingBox.min.clone());
      assert.ok(Math.abs(size.x - obstacle.width) < 1e-5);
      assert.ok(Math.abs(size.y - obstacle.height) < 1e-5);
      assert.ok(Math.abs(size.z - obstacle.depth) < 1e-5);
      assert.ok([...geometry.attributes.uv.array].every(Number.isFinite));
      geometry.dispose();
    }
  }
});

test("desert ridges are bounded, deterministic and entirely outside the playable square", () => {
  for (const compact of [true, false]) {
    const geometry = desertRidgeGeometry(compact);
    const repeated = desertRidgeGeometry(compact);
    const positions = geometry.attributes.position;
    assert.ok(positions.count <= 645);
    assert.deepEqual(positions.array, repeated.attributes.position.array);
    for (let index = 0; index < positions.count; index++) {
      assert.ok(Math.max(Math.abs(positions.getX(index)), Math.abs(positions.getZ(index))) > ARENA_LIMIT);
      assert.ok(positions.getY(index) >= -.05 && positions.getY(index) <= 22);
    }
    geometry.dispose();
    repeated.dispose();
  }
});

test("scene detail scales from battery saver to Ultra and phones can opt into full detail without shadows", () => {
  const phone = { width: 1170, height: 2532, pixelRatio: 3, touch: true };
  assert.equal(graphicsProfile({ ...phone, quality: "low" }).detail, 0);
  assert.equal(graphicsProfile(phone).detail, 1);
  const phoneHigh = graphicsProfile({ ...phone, quality: "high" });
  assert.equal(phoneHigh.detail, 3);
  assert.equal(phoneHigh.shadows, false);
  assert.equal(phoneHigh.postProcessing, false);
  assert.equal(graphicsProfile({ width: 1920, height: 1080 }).detail, 2);
  assert.equal(graphicsProfile({ width: 1920, height: 1080, quality: "ultra" }).detail, 3);
  assert.equal(graphicsProfile({ width: 1920, height: 1080, memory: 2 }).detail, 1);
});

test("a link's quality overrides the saved choice and unknown values fall back to adaptive", () => {
  assert.equal(resolveQuality("ultra", "low"), "ultra");
  assert.equal(resolveQuality(null, "high"), "high");
  assert.equal(resolveQuality("auto", "high"), null);
  assert.equal(resolveQuality("bogus", "<script>"), null);
  assert.equal(resolveQuality(null, null), null);
});
