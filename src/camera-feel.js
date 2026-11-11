export function createCameraFeel() {
  return { landing: 0, shake: 0, time: 0 };
}

export function kickCamera(state, kind, strength) {
  if (!Number.isFinite(strength) || strength < 0) throw new RangeError("Invalid camera impulse.");
  if (kind === "landing") state.landing = Math.min(.09, state.landing + strength);
  else if (kind === "damage" || kind === "shot") state.shake = Math.min(.012, state.shake + strength);
  else throw new RangeError("Unknown camera impulse.");
}

export function stepCameraFeel(state, dt, { reducedMotion = false, moving = false, sprinting = false, bobTime = 0 } = {}) {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError("Invalid camera step.");
  state.time += dt;
  state.landing *= Math.exp(-14 * dt);
  state.shake *= Math.exp(-18 * dt);
  const scale = reducedMotion ? 0 : 1;
  return {
    bob: Math.sin(bobTime) * (moving ? sprinting ? .032 : .018 : 0) * scale,
    dip: -state.landing * scale,
    pitch: Math.sin(state.time * 71) * state.shake * scale,
    roll: (Math.sin(state.time * 59) * state.shake * .4 +
      (moving ? Math.sin(bobTime * .5) * .004 : 0)) * scale,
    sprintFov: sprinting && moving ? 6 * scale : 0
  };
}
