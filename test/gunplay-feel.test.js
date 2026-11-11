import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { WEAPONS } from "../shared/weapons.js";
import { stepAds, weaponFeedback, createRecoilState, kickRecoil } from "../src/weapon-feedback.js";
import { weaponLayout } from "../src/weapon-model.js";
import { reloadPose } from "../src/reload.js";
import { createCameraFeel, kickCamera, stepCameraFeel } from "../src/camera-feel.js";
import { combatIntensity, createCombatAudio, createCombatMusic, createLobbyMusic, spatialMix } from "../src/combat-audio.js";
import { contactMaterial, createSurfaceImpacts, footstepSurface } from "../src/combat-detail.js";
import { createDamageNumbers, createHitMarker, damageFeedback } from "../src/hit-feedback.js";
import { disposeSceneResources } from "../src/scene-resources.js";

test("every gun has a unique recoil pattern, flash, reload presentation and explicit ADS speed", () => {
  const profiles = Object.keys(WEAPONS).map(weaponFeedback);
  for (const key of ["pattern", "muzzle"]) assert.equal(new Set(profiles.map((profile) => JSON.stringify(profile[key]))).size, profiles.length);
  const poses = [];
  for (const id of Object.keys(WEAPONS)) {
    const profile = weaponFeedback(id), layout = weaponLayout(id);
    assert.ok(Object.isFrozen(profile) && Object.isFrozen(profile.pattern));
    assert.ok(profile.weight >= .5 && profile.weight <= 2);
    assert.ok(profile.muzzle.duration >= 20 && profile.muzzle.duration <= 70);
    assert.ok(WEAPONS[id].aimSpeed >= 5 && WEAPONS[id].aimSpeed <= 18);
    const pose = reloadPose(.65, true, "empty", layout.mount, layout);
    poses.push(JSON.stringify([pose.tilt, pose.roll, pose.hand, pose.magazine]));
    assert.deepEqual(reloadPose(.7, false, "empty", layout.mount, layout), reloadPose(0, false, "empty", layout.mount, layout));
  }
  assert.equal(new Set(poses).size, profiles.length);
});

test("ADS has identical settling at 30, 60 and 120 fps, with a lighter pistol than support gun", () => {
  for (const id of Object.keys(WEAPONS)) {
    const values = [30, 60, 120].map((fps) => {
      let value = 0;
      for (let frame = 0; frame < fps; frame++) value = stepAds(value, true, id, 1 / fps);
      return value;
    });
    for (const value of values) assert.ok(Math.abs(value - values[0]) < 1e-12);
    assert.ok(stepAds(1, false, id, 1) < .001);
  }
  assert.ok(stepAds(0, true, "pistol", .1) > stepAds(0, true, "lmg", .1));
  assert.throws(() => stepAds(0, true, "rifle", NaN), RangeError);
});

test("weapon recoil patterns repeat deterministically and cannot accumulate unbounded impulses", () => {
  for (const id of Object.keys(WEAPONS)) {
    const profile = weaponFeedback(id);
    const first = createRecoilState(), repeat = createRecoilState();
    kickRecoil(first, id, 0); kickRecoil(repeat, id, profile.pattern.length);
    assert.deepEqual(first, repeat);
    for (let index = 0; index < 1000; index++) kickRecoil(first, id, index);
    assert.ok(first.pitchVelocity <= 5 && Math.abs(first.yawVelocity) <= 2);
  }
});

test("reduced camera motion removes cosmetic shake, bob, landing and sprint kick but never weapon recoil", () => {
  const state = createCameraFeel();
  kickCamera(state, "landing", 100); kickCamera(state, "damage", 100);
  assert.equal(state.landing, .09); assert.equal(state.shake, .012);
  assert.deepEqual(stepCameraFeel(state, 1 / 60, {
    reducedMotion: true, moving: true, sprinting: true, bobTime: 1
  }), { bob: 0, dip: -0, pitch: 0, roll: 0, sprintFov: 0 });
  const recoil = createRecoilState();
  kickRecoil(recoil, "rifle", 1);
  assert.ok(recoil.pitchVelocity > 0);
  const normal = stepCameraFeel(state, 1 / 60, { moving: true, sprinting: true, bobTime: 1 });
  assert.ok(normal.bob > 0 && normal.dip < 0 && normal.sprintFov === 6);
  stepCameraFeel(state, 4);
  assert.ok(state.landing < 1e-12 && state.shake < 1e-12);
  assert.throws(() => kickCamera(state, "unknown", 1), RangeError);
  assert.throws(() => stepCameraFeel(state, -1), RangeError);
});

test("cosmetic camera recovery is independent of 30, 60 and 120 fps", () => {
  const states = [30, 60, 120].map((fps) => {
    const state = createCameraFeel();
    kickCamera(state, "landing", .07); kickCamera(state, "shot", .008);
    for (let frame = 0; frame < fps; frame++) stepCameraFeel(state, 1 / fps);
    return state;
  });
  for (const state of states) for (const key of ["landing", "shake", "time"]) {
    assert.ok(Math.abs(state[key] - states[0][key]) < 1e-12);
  }
});

test("confirmed contacts choose dirt, wood, concrete and metal; footsteps use the supporting surface", () => {
  assert.equal(contactMaterial({ obstacle: { kind: "container" } }, "wickfall"), "metal");
  assert.equal(contactMaterial({ obstacle: { kind: "generator" } }, "foundry"), "metal");
  assert.equal(contactMaterial({ obstacle: { kind: "crate" } }, "foundry"), "wood");
  assert.equal(contactMaterial({ obstacle: { kind: "sandbag" } }, "harbor"), "dirt");
  assert.equal(contactMaterial({ obstacle: { kind: "wall" } }, "wickfall"), "concrete");
  assert.equal(contactMaterial({ surface: "wall-x+" }, "void"), "concrete");
  assert.equal(contactMaterial({ obstacle: null }, "void"), "metal");
  assert.equal(contactMaterial({ obstacle: null }, "wickfall"), "dirt");
  assert.equal(footstepSurface("range", { x: 0, y: 1.57, z: 20 }), "concrete");
  assert.equal(footstepSurface("tundra", { x: -39, y: 1.57, z: 20 }), "dirt");
});

test("surface particles use one bounded draw, recycle under sustained impacts and disappear at rest", () => {
  const scene = new THREE.Scene(), effects = createSurfaceImpacts(scene, { count: 24 });
  const contact = { position: { x: 0, y: 1, z: -2 }, normal: { x: 0, y: 0, z: 1 } };
  for (let index = 0; index < 1000; index++) effects.emit(contact, ["metal", "concrete", "dirt", "wood", "flesh"][index % 5], () => .5);
  effects.update(1 / 60);
  assert.equal(scene.children.length, 1);
  assert.equal(effects.points.geometry.attributes.position.count, 24);
  assert.equal(effects.particles.length, 24);
  assert.equal(effects.points.visible, true);
  effects.update(1);
  assert.equal(effects.points.visible, false);
  assert.ok(effects.particles.every((particle) => particle.life === 0));
  let disposed = false;
  effects.points.geometry.addEventListener("dispose", () => { disposed = true; });
  disposeSceneResources(scene);
  assert.equal(disposed, true);
  assert.throws(() => effects.emit(contact, "invalid"), RangeError);
  assert.throws(() => effects.update(NaN), RangeError);
});

test("surface particle trajectories agree at 30 and 120 fps", () => {
  const runs = [30, 120].map((fps) => {
    const effects = createSurfaceImpacts(new THREE.Scene(), { count: 8 });
    effects.emit({ position: { x: 1, y: 2, z: 3 }, normal: { x: 0, y: 1, z: 0 } }, "dirt", () => .5);
    for (let frame = 0; frame < fps / 5; frame++) effects.update(1 / fps);
    return effects.particles.filter((particle) => particle.duration > 0);
  });
  for (let index = 0; index < runs[0].length; index++) {
    assert.ok(runs[0][index].position.distanceTo(runs[1][index].position) < 1e-10);
  }
});

test("spatial combat audio pans relative to facing, attenuates distance and muffles blocked sound", () => {
  const listener = { position: { x: 0, y: 1, z: 0 }, yaw: 0 };
  assert.equal(spatialMix({ x: 10, y: 1, z: 0 }, listener).pan, 1);
  assert.equal(spatialMix({ x: -10, y: 1, z: 0 }, listener).pan, -1);
  listener.yaw = Math.PI / 2;
  assert.equal(spatialMix({ x: 0, y: 1, z: -10 }, listener).pan, 1);
  const nearby = spatialMix({ x: 0, y: 1, z: -6 }, listener);
  const blocked = spatialMix({ x: 0, y: 1, z: -6 }, listener, true);
  assert.ok(blocked.gain < nearby.gain / 2);
  assert.ok(spatialMix({ x: 0, y: 1, z: -50 }, listener).gain < nearby.gain);
  assert.equal(spatialMix({ x: 0, y: 1, z: -81 }, listener).gain, 0);
});

function audioFixture() {
  const nodes = [], sources = [], buffers = [];
  const parameter = () => ({
    value: 0, events: [],
    setValueAtTime(value) { this.value = value; this.events.push(value); },
    setTargetAtTime(value) { this.value = value; this.events.push(value); },
    exponentialRampToValueAtTime(value) { this.value = value; this.events.push(value); }
  });
  const node = (kind) => {
    const value = { kind, disconnected: false, connect() { return this; },
      disconnect() { this.disconnected = true; }, gain: parameter(), pan: parameter(), frequency: parameter() };
    nodes.push(value); return value;
  };
  const source = () => {
    const value = node("source");
    value.start = () => { value.started = true; };
    value.stop = (at = 1) => { value.stopped = at; };
    sources.push(value); return value;
  };
  const context = {
    sampleRate: 48000, currentTime: 1, state: "running",
    createBuffer(_channels, length) {
      const samples = new Float32Array(length), buffer = { getChannelData: () => samples };
      buffers.push(buffer);
      return buffer;
    },
    createBufferSource: source, createOscillator: source, createBiquadFilter: () => node("filter"),
    createGain: () => node("gain"), createStereoPanner: () => node("pan")
  };
  return { context, nodes, sources, buffers, finish() {
    for (const source of sources) { const ended = source.onended; source.onended = null; ended?.(); }
  } };
}

test("combat voices have a hard cap, release finished graphs, and never play outside audible range", () => {
  const fixture = audioFixture(), audio = createCombatAudio(fixture.context, {}, { maxVoices: 2 });
  assert.equal(audio.weapon("rifle"), true);
  assert.equal(audio.surface("impact", "concrete"), true);
  assert.equal(audio.weapon("pdw"), false);
  assert.equal(audio.activeVoices, 2);
  fixture.finish();
  assert.equal(audio.activeVoices, 0);
  assert.ok(fixture.nodes.every((node) => node.disconnected));
  assert.equal(audio.weapon("rifle", { x: 100, y: 0, z: 0 }, { position: { x: 0, y: 0, z: 0 }, yaw: 0 }), false);
  fixture.context.state = "suspended";
  assert.equal(audio.weapon("rifle"), false);
  fixture.context.state = "running";
  assert.equal(audio.surface("step", "wood"), true);
  audio.clear(); fixture.finish();
  assert.equal(audio.activeVoices, 0);
  assert.ok(fixture.nodes.every((node) => node.disconnected));
  assert.throws(() => audio.surface("impact", "unknown"), RangeError);
});

test("all five impact sounds are distinct and reuse their short-lived audio graph", () => {
  const snapshots = [];
  for (const surface of ["metal", "concrete", "dirt", "wood", "flesh"]) {
    const fixture = audioFixture(), audio = createCombatAudio(fixture.context, {});
    assert.equal(audio.surface("impact", surface), true);
    snapshots.push(JSON.stringify(fixture.nodes.map((node) => [node.kind, node.frequency.value, node.stopped])));
    fixture.finish();
    assert.ok(fixture.nodes.every((node) => node.disconnected));
  }
  assert.equal(new Set(snapshots).size, 5);
});

test("combat intensity responds to nearby enemies and firing, not practice or an ended match", () => {
  const calm = combatIntensity({ mode: "campaign", phase: "playing", enemyDistance: 60 });
  const danger = combatIntensity({ mode: "campaign", phase: "playing", enemyDistance: 5, sinceShot: 0, health: 20 });
  assert.ok(danger > calm && danger <= 1);
  assert.equal(combatIntensity({ mode: "practice", phase: "playing", enemyDistance: 0, sinceShot: 0 }), 0);
  assert.equal(combatIntensity({ mode: "campaign", phase: "between", enemyDistance: 0, sinceShot: 0 }), 0);
});

test("the adaptive score uses only three persistent voices and releases everything exactly once", () => {
  const fixture = audioFixture(), music = createCombatMusic(fixture.context, {});
  for (let index = 0; index < 10000; index++) {
    fixture.context.currentTime += .05;
    music.update(index % 100 / 100, .35);
  }
  assert.equal(fixture.sources.length, 3);
  assert.equal(fixture.nodes.length, 5);
  music.update(1, 0);
  assert.equal(fixture.nodes.find((node) => node.kind === "gain").gain.value, 0);
  music.dispose(); music.dispose(); music.update(1, 1);
  assert.ok(fixture.nodes.every((node) => node.disconnected));
  assert.ok(fixture.sources.every((source) => source.stopped));
});

test("the acoustic lobby score plays distinct decaying strings, respects volume and bounds and releases its voices", () => {
  const fixture = audioFixture(), music = createLobbyMusic(fixture.context, {});
  music.update(0);
  assert.equal(fixture.sources.length, 0);
  fixture.context.state = "suspended"; music.update(.5);
  assert.equal(fixture.sources.length, 0);
  fixture.context.state = "running"; music.update(.5);
  assert.ok(music.activeVoices > 0);
  for (let index = 0; index < 100; index++) {
    fixture.context.currentTime += .1;
    music.update(.5);
    assert.ok(music.activeVoices <= 8);
  }
  assert.equal(fixture.sources.length, 8, "a stalled or backgrounded scheduler cannot accumulate unbounded sources");
  fixture.finish(); assert.equal(music.activeVoices, 0);
  for (let index = 0; index < 128; index++) {
    fixture.context.currentTime += .35; music.update(.5); fixture.finish();
  }
  const notes = new Set(fixture.sources.map((source) => source.buffer));
  assert.ok(notes.size >= 8 && notes.size <= 24, "notes are varied but cached across loops");
  assert.equal(fixture.buffers.length, notes.size);
  for (const buffer of notes) {
    const samples = buffer.getChannelData(0);
    assert.ok(samples.every(Number.isFinite));
    const energy = (start, end) => samples.slice(start, end).reduce((sum, value) => sum + value * value, 0);
    assert.ok(energy(0, 4800) > energy(samples.length - 4800, samples.length) * 10);
  }
  music.update(0);
  assert.equal(fixture.nodes[0].gain.value, 0);
  fixture.context.currentTime += 1; music.update(.5);
  music.dispose(); music.dispose(); music.update(.5); fixture.finish();
  assert.equal(music.activeVoices, 0);
  assert.ok(fixture.sources.every((source) => source.stopped && source.disconnected));
  assert.ok(fixture.nodes.every((node) => node.disconnected));
});

test("damage feedback uses finite confirmed damage and labels headshots and kills independently", () => {
  const position = { x: 1, y: 2, z: -3 };
  assert.deepEqual(damageFeedback([
    { damage: 20, position }, { damage: 40, position, hitZone: "head", killed: true },
    { damage: NaN, position }, { damage: 0, position }, { damage: 30 }, { damage: 12, position: { ...position, z: Infinity } }
  ]), [
    { damage: 20, position, kind: "hit", headshot: false },
    { damage: 40, position, kind: "kill", headshot: true }
  ]);
});

function damageLayer() {
  const nodes = [];
  return { nodes, append(node) { nodes.push(node); }, ownerDocument: { createElement() {
    const node = { className: "", style: {}, textContent: "" };
    node.classList = {
      contains: (name) => node.className.split(" ").includes(name),
      add(name) { this.toggle(name, true); },
      remove(name) { this.toggle(name, false); },
      toggle(name, force) {
        const values = new Set(node.className.split(" ").filter(Boolean));
        if (force) values.add(name); else values.delete(name);
        node.className = [...values].join(" ");
      }
    };
    return node;
  } } };
}

test("floating damage is capped, projected at the confirmed contact, expires and clears immediately", () => {
  const parent = damageLayer(), numbers = createDamageNumbers(parent, { count: 3 });
  const camera = new THREE.PerspectiveCamera(76, 16 / 9, .1, 100);
  for (let index = 0; index < 100; index++) numbers.add([{ damage: 20, position: { x: 0, y: 0, z: -5 } }], 100);
  numbers.update(camera, 200);
  assert.equal(parent.nodes.length, 3);
  assert.ok(parent.nodes.every((node) => node.textContent === "20" && node.style.left === "50%" && !node.classList.contains("hidden")));
  const moving = parent.nodes[0].style.transform;
  numbers.update(camera, 200, true);
  assert.notEqual(parent.nodes[0].style.transform, moving);
  numbers.update(camera, 901);
  assert.ok(parent.nodes.every((node) => node.classList.contains("hidden")));
  numbers.add([{ damage: 40, position: { x: 0, y: 0, z: 5 }, hitZone: "head" }], 1000);
  numbers.update(camera, 1100);
  assert.ok(parent.nodes.every((node) => node.classList.contains("hidden")), "behind-camera contacts stay hidden");
  numbers.add([{ damage: 40, position: { x: 0, y: 0, z: -5 } }], 1200);
  numbers.clear(); numbers.update(camera, 1200);
  assert.ok(parent.nodes.every((node) => node.classList.contains("hidden")));
});

test("rapid hits replace the old marker timeout instead of clearing a newer confirmation", () => {
  const node = damageLayer().ownerDocument.createElement("span"), callbacks = new Map();
  let next = 0;
  const marker = createHitMarker(node, {
    setTimeout(callback) { callbacks.set(++next, callback); return next; },
    clearTimeout(id) { callbacks.delete(id); }
  });
  marker.show("hit", 120);
  marker.show("headshot", 120);
  assert.equal(callbacks.size, 1);
  assert.ok(node.classList.contains("headshot") && !node.classList.contains("hit"));
  marker.show("kill", 210);
  assert.equal(callbacks.size, 1);
  assert.ok(node.classList.contains("kill") && !node.classList.contains("headshot"));
  callbacks.values().next().value();
  assert.equal(callbacks.size, 0);
  assert.equal(node.className, "");
  marker.show("dry", 150); marker.clear();
  assert.equal(node.className, "");
  assert.throws(() => marker.show("unknown", 120), RangeError);
});
