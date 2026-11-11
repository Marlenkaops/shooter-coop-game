import { audioNoiseBuffer, playWeaponReport } from "./weapon-feedback.js";

const surfaces = Object.freeze({
  metal: { hz: 1680, cutoff: 3600, duration: .14 },
  concrete: { hz: 370, cutoff: 1900, duration: .09 },
  dirt: { hz: 105, cutoff: 520, duration: .12 },
  wood: { hz: 690, cutoff: 1100, duration: .1 },
  flesh: { hz: 135, cutoff: 430, duration: .075 }
});

export function spatialMix(source, listener, occluded = false) {
  if (!source) return { gain: 1, pan: 0 };
  const dx = source.x - listener.position.x, dz = source.z - listener.position.z;
  const distance = Math.hypot(dx, source.y - listener.position.y, dz);
  const right = dx * Math.cos(listener.yaw) - dz * Math.sin(listener.yaw);
  return { gain: (distance >= 80 ? 0 : 1 / (1 + (distance / 12) ** 2)) * (occluded ? .28 : 1),
    pan: Math.max(-1, Math.min(1, right / Math.max(1, Math.hypot(dx, dz)))) };
}

export function combatIntensity({ mode, phase, enemyDistance = Infinity, sinceShot = Infinity, health = 100 }) {
  if (mode === "practice" || phase !== "playing") return 0;
  return Math.max(.08, Math.min(1, Math.max(0, 1 - enemyDistance / 34) * .7 +
    (sinceShot < 2200 ? .3 : 0) + (health < 35 ? .15 : 0)));
}

export function createCombatAudio(context, destination, { maxVoices = 16 } = {}) {
  const voices = new Set();
  function voice(position, listener, occluded) {
    const mix = spatialMix(position, listener, occluded);
    if (mix.gain < .01 || voices.size >= maxVoices || context.state !== "running") return null;
    const gain = context.createGain(), pan = context.createStereoPanner();
    gain.gain.value = mix.gain;
    pan.pan.value = mix.pan;
    gain.connect(pan).connect(destination);
    const item = { gain, pan };
    voices.add(item);
    return { input: gain, end() { gain.disconnect(); pan.disconnect(); voices.delete(item); } };
  }
  return {
    get activeVoices() { return voices.size; },
    weapon(id, position = null, listener = null, occluded = false) {
      const output = voice(position, listener, occluded);
      if (!output) return false;
      playWeaponReport(context, output.input, id, { onEnded: output.end });
      return true;
    },
    surface(kind, surface, { position = null, listener = null, variation = 0, occluded = false } = {}) {
      if (!Object.hasOwn(surfaces, surface) || !["step", "impact"].includes(kind)) {
        throw new RangeError("Unknown combat sound.");
      }
      const output = voice(position, listener, occluded);
      if (!output) return false;
      const profile = surfaces[surface], at = context.currentTime;
      const noise = context.createBufferSource(), filter = context.createBiquadFilter();
      const body = context.createOscillator(), envelope = context.createGain();
      const duration = kind === "step" ? .075 : profile.duration;
      noise.buffer = audioNoiseBuffer(context);
      filter.type = "lowpass";
      filter.frequency.value = profile.cutoff * (kind === "step" ? .45 : 1);
      body.type = surface === "metal" ? "sine" : "triangle";
      body.frequency.setValueAtTime(profile.hz * (kind === "step" ? .12 : 1) * (1 + variation * .04), at);
      body.frequency.exponentialRampToValueAtTime(Math.max(28, profile.hz * .2), at + duration);
      envelope.gain.setValueAtTime(kind === "step" ? .09 : .16, at);
      envelope.gain.exponentialRampToValueAtTime(.001, at + duration);
      noise.connect(filter).connect(envelope);
      body.connect(envelope);
      envelope.connect(output.input);
      noise.onended = () => { noise.disconnect(); filter.disconnect(); };
      body.onended = () => { body.disconnect(); envelope.disconnect(); output.end(); };
      noise.start(at); body.start(at);
      noise.stop(at + duration); body.stop(at + duration + .01);
      return true;
    },
    clear() {
      for (const { gain, pan } of voices) { gain.disconnect(); pan.disconnect(); }
      voices.clear();
    }
  };
}

export function createCombatMusic(context, destination) {
  const gain = context.createGain(), filter = context.createBiquadFilter();
  const bass = context.createOscillator(), pulse = context.createOscillator(), pad = context.createOscillator();
  gain.gain.value = 0;
  filter.type = "lowpass"; filter.frequency.value = 400;
  bass.type = pad.type = "sine"; pulse.type = "triangle";
  bass.frequency.value = 55; pad.frequency.value = 110; pulse.frequency.value = 220;
  for (const oscillator of [bass, pad, pulse]) { oscillator.connect(filter); oscillator.start(); }
  filter.connect(gain).connect(destination);
  let nextBeat = 0, beat = 0, disposed = false;
  return {
    update(intensity, volume) {
      if (disposed) return;
      const at = context.currentTime, level = Math.max(0, Math.min(1, intensity));
      gain.gain.setTargetAtTime(Math.max(0, Math.min(1, volume)) * (.012 + level * .045), at, .25);
      filter.frequency.setTargetAtTime(280 + level * 1000, at, .2);
      if (at < nextBeat) return;
      nextBeat = at + .46 - level * .13;
      const semitone = [0, 7, 10, 7, 0, 3, 10, 12][beat++ % 8];
      pulse.frequency.setTargetAtTime(110 * 2 ** (semitone / 12), at, .025);
      bass.frequency.setTargetAtTime(beat % 8 < 4 ? 55 : 65.406, at, .05);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const oscillator of [bass, pad, pulse]) { oscillator.stop(); oscillator.disconnect(); }
      gain.disconnect(); filter.disconnect();
    }
  };
}

const lobbyPlucks = new WeakMap();
const winterChords = [[48, 55, 60, 64], [45, 57, 60, 64], [53, 57, 60, 65], [43, 55, 59, 62],
  [48, 55, 60, 64], [53, 57, 60, 65], [50, 57, 62, 65], [43, 55, 59, 62]];

function acousticPluck(context, note) {
  if (!lobbyPlucks.has(context)) lobbyPlucks.set(context, new Map());
  const cache = lobbyPlucks.get(context);
  if (cache.has(note)) return cache.get(note);
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * 1.6), context.sampleRate);
  const samples = buffer.getChannelData(0), frequency = 440 * 2 ** ((note - 69) / 12);
  const delay = Math.round(context.sampleRate / frequency - .5);
  let seed = note + 1;
  for (let index = 0; index < delay; index++) {
    seed = Math.imul(seed, 1664525) + 1013904223 | 0;
    samples[index] = (seed >>> 0) / 2147483648 - 1;
  }
  // A damped delay line models a plucked string rather than a sustained synth pad.
  for (let index = delay; index < samples.length; index++) {
    samples[index] = (samples[index - delay] + samples[index - delay + 1]) * .497;
  }
  cache.set(note, buffer);
  return buffer;
}

export function createLobbyMusic(context, destination) {
  const output = context.createGain(), voices = new Set();
  output.gain.value = 0;
  output.connect(destination);
  let nextNote = context.currentTime, step = 0, previousVolume = -1, disposed = false;
  function pluck(note, at, level) {
    if (voices.size >= 8) return;
    const source = context.createBufferSource(), envelope = context.createGain();
    source.buffer = acousticPluck(context, note);
    envelope.gain.setValueAtTime(.0001, at);
    envelope.gain.exponentialRampToValueAtTime(level, at + .008);
    envelope.gain.exponentialRampToValueAtTime(.0001, at + 1.5);
    source.connect(envelope).connect(output);
    const voice = { source, envelope };
    voices.add(voice);
    source.onended = () => { source.disconnect(); envelope.disconnect(); voices.delete(voice); };
    source.start(at);
    source.stop(at + 1.6);
  }
  return {
    get activeVoices() { return voices.size; },
    update(volume) {
      if (disposed) return;
      const level = Math.max(0, Math.min(1, volume)), at = context.currentTime;
      if (level !== previousVolume) {
        output.gain.setTargetAtTime(level * .9, at, .08);
        previousVolume = level;
      }
      if (!level || context.state !== "running") return;
      if (at - nextNote > .5) nextNote = at;
      while (nextNote <= at + .1) {
        const chord = winterChords[Math.floor(step / 8) % winterChords.length];
        pluck(chord[[0, 2, 1, 3, 2, 1, 3, 2][step % 8]], nextNote, step % 8 ? .7 : .9);
        if (step % 4 === 2) pluck(chord[3] + 12, nextNote + .025, .32);
        nextNote += 60 / 88 / 2;
        step++;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const { source, envelope } of voices) {
        source.stop(); source.disconnect(); envelope.disconnect();
      }
      voices.clear();
      output.disconnect();
    }
  };
}
