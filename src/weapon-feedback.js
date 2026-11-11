import { weaponFor } from "../shared/weapons.js";

const tuning = {
  rifle: [18, .34, 112, 46, .12, 2600],
  smg: [23, -.23, 158, 72, .085, 3200],
  marksman: [17, .2, 86, 35, .17, 2300],
  sniper: [14, -.12, 64, 26, .23, 2000],
  shotgun: [15, .28, 78, 30, .2, 3000],
  lmg: [16, -.42, 96, 40, .14, 2800],
  carbine: [24, .12, 144, 68, .09, 1100],
  pdw: [27, .2, 174, 84, .075, 3500],
  battle: [15, -.2, 72, 29, .19, 2400],
  pistol: [25, .38, 152, 62, .11, 3100],
  heavyPistol: [18, -.3, 104, 44, .14, 950],
  autoshotgun: [17, -.34, 90, 34, .18, 3300],
  jackolantern: [14, .44, 71, 24, .24, 1800],
  graveglass: [21, -.16, 105, 41, .15, 850]
};

const handling = {
  rifle: [1, .23, .17, 0xffd18a, .038, .11, 42, [.2, .4, .55, .28, -.2, -.4, .18, .35]],
  smg: [.72, .19, -.19, 0xffc56b, .03, .085, 32, [-.1, -.3, -.46, .1, .32, .4, -.12, -.3]],
  marksman: [1.22, .21, .22, 0xffd8a6, .042, .14, 48, [.12, .28, -.16, .35, -.25, .16]],
  sniper: [1.65, .16, .24, 0xffe6bc, .05, .2, 60, [-.12, .1, -.24, .18, -.08, .3]],
  shotgun: [1.28, .3, -.24, 0xffb65d, .075, .15, 58, [.26, -.15, .38, -.3, .18, -.12]],
  lmg: [1.8, .14, -.28, 0xffbf75, .047, .16, 46, [-.3, -.45, -.52, -.24, .16, .35, .48, .2]],
  carbine: [.82, .2, .15, 0xd8b38b, .018, .05, 24, [.08, .18, -.1, .24, -.16, .06]],
  pdw: [.68, .18, .28, 0xffdf8b, .026, .07, 27, [.12, .25, .4, .18, -.32, -.18, .22, .1]],
  battle: [1.4, .27, -.2, 0xffcc98, .048, .17, 53, [-.2, -.35, .18, -.42, .24, -.1]],
  pistol: [.58, .34, -.32, 0xffd97a, .034, .09, 36, [.3, .44, -.12, .28, -.2, .15]],
  heavyPistol: [.92, .32, -.26, 0xcaa88b, .022, .065, 28, [-.28, .18, -.42, .24, -.14, .3]],
  autoshotgun: [1.5, .25, .29, 0xffaa52, .065, .13, 50, [-.3, -.48, .12, -.24, .36, -.1]],
  jackolantern: [1.35, .29, .31, 0xff8e32, .08, .19, 65, [.4, .18, -.32, .5, -.15, .3]],
  graveglass: [1.12, .22, -.18, 0x92d8cf, .019, .06, 30, [-.1, -.22, .14, -.3, .08, -.18]]
};

const profiles = Object.fromEntries(Object.keys(tuning).map((id) => {
  const [recovery, bias, crackHz, bodyHz, duration, cutoff] = tuning[id];
  const [weight, reloadTilt, reloadRoll, color, radius, length, flashMs, pattern] = handling[id];
  return [id, Object.freeze({ recovery, bias, crackHz, bodyHz, duration, cutoff, weight, reloadTilt, reloadRoll,
    recoil: weaponFor(id).recoil, pattern: Object.freeze(pattern),
    muzzle: Object.freeze({ color, radius, length, duration: flashMs }),
    suppressed: ["carbine", "heavyPistol", "graveglass"].includes(id) })];
}));

export function weaponFeedback(id) {
  return profiles[weaponFor(id).id];
}

export function stepAds(amount, aiming, weaponId, dt) {
  if (!Number.isFinite(dt) || dt < 0 || !Number.isFinite(amount)) throw new RangeError("Invalid ADS step.");
  const target = aiming ? 1 : 0;
  return target + (amount - target) * Math.exp(-(aiming ? weaponFor(weaponId).aimSpeed : 12) * dt);
}

export function createRecoilState() {
  return { pitch: 0, yaw: 0, pitchVelocity: 0, yawVelocity: 0 };
}

export function kickRecoil(state, weaponId, sequence, ads = 0, multiplier = 1) {
  if (!Number.isFinite(multiplier) || multiplier <= 0) throw new RangeError("Invalid recoil multiplier.");
  const profile = weaponFeedback(weaponId);
  const index = Math.max(0, Math.floor(sequence)) % profile.pattern.length;
  const strength = profile.recoil * multiplier * 2.6 * (1 + Math.min(index, 4) * .045) *
    (1 - Math.max(0, Math.min(1, ads)) * .42);
  state.pitchVelocity = Math.min(5, state.pitchVelocity + strength);
  state.yawVelocity = Math.max(-2, Math.min(2, state.yawVelocity +
    strength * profile.pattern[index]));
}

export function stepRecoil(state, weaponId, dt) {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError("Invalid recoil step.");
  const recovery = weaponFeedback(weaponId).recovery;
  const decay = Math.exp(-recovery * dt);
  for (const [axis, velocity] of [["pitch", "pitchVelocity"], ["yaw", "yawVelocity"]]) {
    const impulse = state[velocity] + recovery * state[axis];
    state[axis] = (state[axis] + impulse * dt) * decay;
    state[velocity] = (state[velocity] - recovery * impulse * dt) * decay;
  }
}

const noiseBuffers = new WeakMap();

export function audioNoiseBuffer(context) {
  if (!noiseBuffers.has(context)) {
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * .25), context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index++) samples[index] = Math.random() * 2 - 1;
    noiseBuffers.set(context, buffer);
  }
  return noiseBuffers.get(context);
}

export function playWeaponReport(context, destination, weaponId, { onEnded = () => {} } = {}) {
  const profile = weaponFeedback(weaponId), at = context.currentTime;
  const noise = context.createBufferSource(), filter = context.createBiquadFilter();
  const crack = context.createGain(), body = context.createOscillator(), bodyGain = context.createGain();
  noise.buffer = audioNoiseBuffer(context);
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(profile.cutoff, at);
  filter.frequency.exponentialRampToValueAtTime(280, at + profile.duration);
  const volume = profile.suppressed ? .17 : .36;
  crack.gain.setValueAtTime(volume, at);
  crack.gain.exponentialRampToValueAtTime(.001, at + profile.duration * .7);
  body.type = "triangle";
  body.frequency.setValueAtTime(profile.crackHz, at);
  body.frequency.exponentialRampToValueAtTime(profile.bodyHz, at + profile.duration);
  bodyGain.gain.setValueAtTime(volume * 1.2, at);
  bodyGain.gain.exponentialRampToValueAtTime(.001, at + profile.duration);
  noise.connect(filter).connect(crack).connect(destination);
  body.connect(bodyGain).connect(destination);
  noise.onended = () => { noise.disconnect(); filter.disconnect(); crack.disconnect(); };
  body.onended = () => { body.disconnect(); bodyGain.disconnect(); onEnded(); };
  noise.start(at);
  noise.stop(at + profile.duration);
  body.start(at);
  body.stop(at + profile.duration + .01);
}
