import test from "node:test";
import assert from "node:assert/strict";
import { WEAPONS } from "../shared/weapons.js";
import { createRecoilState, kickRecoil, playWeaponReport, stepRecoil, weaponFeedback } from "../src/weapon-feedback.js";

test("all weapons have distinct recoil and report tuning with quiet suppressed variants", () => {
  const profiles = Object.keys(WEAPONS).map(weaponFeedback);
  assert.equal(new Set(profiles.map(JSON.stringify)).size, 14);
  for (const profile of profiles) {
    assert.ok(profile.recovery > 0 && profile.recoil > 0 && profile.duration > 0 && profile.duration <= .25);
    assert.ok(profile.crackHz > profile.bodyHz && profile.cutoff > 280);
  }
  assert.equal(weaponFeedback("carbine").suppressed, true);
  assert.equal(weaponFeedback("heavyPistol").suppressed, true);
  assert.equal(weaponFeedback("rifle").suppressed, false);
});

test("recoil smoothly recovers with identical results at different frame rates and reduced kick in ADS", () => {
  for (const id of Object.keys(WEAPONS)) {
    const slow = createRecoilState(), fast = createRecoilState(), ads = createRecoilState();
    kickRecoil(slow, id, 0); kickRecoil(fast, id, 0); kickRecoil(ads, id, 0, 1);
    assert.ok(ads.pitchVelocity < slow.pitchVelocity);
    for (let frame = 0; frame < 6; frame++) stepRecoil(slow, id, 1 / 30);
    for (let frame = 0; frame < 24; frame++) stepRecoil(fast, id, 1 / 120);
    for (const key of Object.keys(slow)) assert.ok(Math.abs(slow[key] - fast[key]) < 1e-10);
    assert.ok(slow.pitch > 0);
    stepRecoil(slow, id, 4);
    assert.ok(Math.abs(slow.pitch) < 1e-8 && Math.abs(slow.yaw) < 1e-8);
  }
  assert.throws(() => stepRecoil(createRecoilState(), "rifle", NaN), RangeError);
});

test("sustained fire stays bounded and does not drift after firing stops", () => {
  for (const weapon of Object.values(WEAPONS)) {
    const state = createRecoilState();
    for (let shot = 0; shot < 150; shot++) {
      kickRecoil(state, weapon.id, shot);
      stepRecoil(state, weapon.id, weapon.fireInterval / 1000);
      assert.ok(Math.abs(state.pitch) < .3 && Math.abs(state.yaw) < .15, weapon.id);
    }
    stepRecoil(state, weapon.id, 5);
    assert.ok(Object.values(state).every((value) => Math.abs(value) < 1e-8));
  }
});

test("layered weapon audio caches noise and releases each finished audio graph", () => {
  const sources = [], nodes = [];
  let buffers = 0;
  const parameter = () => ({ setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => {
    const value = { disconnected: false, connect() { return this; }, disconnect() { this.disconnected = true; },
      gain: parameter(), frequency: parameter() };
    nodes.push(value);
    return value;
  };
  const source = () => {
    const value = node();
    value.start = () => {};
    value.stop = (at) => { value.stopAt = at; };
    sources.push(value);
    return value;
  };
  const context = {
    sampleRate: 48000, currentTime: 1,
    createBuffer(_channels, length) { buffers++; return { getChannelData: () => new Float32Array(length) }; },
    createBufferSource: source, createOscillator: source, createBiquadFilter: node, createGain: node
  };
  playWeaponReport(context, {}, "sniper");
  playWeaponReport(context, {}, "pdw");
  assert.equal(buffers, 1);
  assert.equal(sources.length, 4);
  assert.ok(sources.every((value) => value.stopAt > 1 && value.stopAt <= 1.26));
  sources.forEach((value) => value.onended());
  assert.ok(nodes.filter((value) => !value.stop).every((value) => value.disconnected));
  assert.ok(sources.every((value) => value.disconnected));
});
