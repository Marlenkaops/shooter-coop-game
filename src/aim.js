export function scopedFov(baseFov, zoom) {
  return 2 * Math.atan(Math.tan(baseFov * Math.PI / 360) / zoom) * 180 / Math.PI;
}

export function scopeLensFov(baseFov, zoom, lensHeight, viewportHeight) {
  return scopedFov(baseFov, zoom * viewportHeight / lensHeight);
}

export function scopeSensitivity(adsAmount, zoom) {
  return 1 - adsAmount * (1 - 1 / zoom);
}
