export function graphicsProfile({
  width, height, pixelRatio = 1, touch = false, quality, memory = 8, cores = 8, targetFps = 120
}) {
  const low = quality === "low";
  const constrained = memory <= 2 || cores <= 2;
  const ultra = quality === "ultra" && !touch && !constrained;
  const high = quality === "high" || ultra;
  const minimal = low || (!high && constrained);
  const compact = low || (!high && (touch || constrained));
  const pixelBudget = low ? 800_000 : touch ? (high ? 1_800_000 : 1_000_000)
    : high ? 5_000_000 : 2_500_000;
  const maximumRatio = low ? .75 : touch ? (high ? 1.5 : 1) : high ? 2 : 1.5;
  const ratio = Math.min(pixelRatio, maximumRatio, Math.sqrt(pixelBudget / Math.max(1, width * height)));
  return {
    pixelRatio: ratio, compact, hdr: !compact,
    surfaceMaps: minimal ? "procedural" : "pbr",
    textureSize: compact ? 512 : 1024,
    photographicSky: !minimal,
    shadows: !compact && !touch, shadowSize: high ? 2048 : 1024,
    postProcessing: high && !touch,
    antialias: !low && !(high && !touch),
    pointLights: compact ? 0 : high ? 2 : 1,
    ambientOcclusion: ultra, focusedShadows: !compact && !touch,
    // 0-3 scales scatter, decals, smoke and resting casings independently of pixel cost.
    detail: low ? 0 : compact ? 1 : high ? 3 : 2,
    targetFps: targetFps === 60 ? 60 : 120
  };
}

export const QUALITY_OPTIONS = Object.freeze(["auto", "low", "high", "ultra"]);

export function resolveQuality(requested, stored) {
  for (const value of [requested, stored]) {
    if (QUALITY_OPTIONS.includes(value)) return value === "auto" ? null : value;
  }
  return null;
}

export function createRefreshSampler() {
  const intervals = [];
  let hz = 60;
  return {
    sample(milliseconds) {
      if (!Number.isFinite(milliseconds) || milliseconds < 3 || milliseconds > 40) return hz;
      intervals.push(milliseconds);
      if (intervals.length > 120) intervals.shift();
      if (intervals.length >= 20) {
        const ordered = [...intervals].sort((a, b) => a - b);
        const observed = 1000 / ordered[Math.floor(ordered.length * .2)];
        const rate = [30, 60, 90, 120, 144, 165, 240].reduce((closest, rate) =>
          Math.abs(rate - observed) < Math.abs(closest - observed) ? rate : closest, 60);
        // Active workloads may miss refreshes, but must not downgrade the display estimate.
        hz = Math.max(hz, rate);
      }
      return hz;
    },
    get hz() { return hz; }
  };
}

export function frameBudgetState(scale = 1) {
  return { scale, pressure: 0, headroom: 0, cooldown: 0, averageMs: 0, longFrames: 0 };
}

export function updateFrameBudget(previous, { frameMs, workMs, targetFps, displayHz, elapsed }) {
  if (![frameMs, workMs, targetFps, displayHz, elapsed].every(Number.isFinite) ||
    frameMs <= 0 || workMs < 0 || targetFps <= 0 || displayHz <= 0 || elapsed < 0) {
    throw new RangeError("Invalid frame budget sample");
  }
  // Tab wake-ups, downloads and one-off shader compilation are not sustained render load.
  const longFrames = frameMs > 250 ? previous.longFrames + 1 : 0;
  if (longFrames === 1) return { ...previous, headroom: 0, longFrames };
  const budget = 1000 / Math.min(targetFps, displayHz);
  const seconds = Math.min(elapsed, .25);
  const averageMs = previous.averageMs ? previous.averageMs * .9 + frameMs * .1 : frameMs;
  const overloaded = averageMs > budget * 1.18 || workMs > budget * .95;
  const spare = averageMs <= budget * 1.08 && workMs < budget * .65;
  let pressure = overloaded ? previous.pressure + seconds : Math.max(0, previous.pressure - seconds * 2);
  let headroom = spare ? previous.headroom + seconds : 0;
  let cooldown = Math.max(0, previous.cooldown - seconds), scale = previous.scale;
  if (!cooldown && pressure >= 1.2 && scale > .65) {
    scale = Math.max(.65, Math.round((scale - .08) * 100) / 100);
    pressure = headroom = 0;
    cooldown = 2;
  } else if (!cooldown && headroom >= 6 && scale < 1) {
    scale = Math.min(1, Math.round((scale + .04) * 100) / 100);
    pressure = headroom = 0;
    cooldown = 3;
  }
  return { scale, pressure, headroom, cooldown, averageMs, longFrames };
}

export function textureDimensions(width, height, maximum) {
  if (![width, height, maximum].every((value) => Number.isFinite(value) && value > 0)) {
    throw new RangeError("Texture dimensions must be positive finite numbers");
  }

  const ratio = Math.min(1, maximum / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}
