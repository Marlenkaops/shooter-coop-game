export const BAN_REASON_MAX = 300;
export const MAX_BAN_MS = 365 * 24 * 60 * 60 * 1000;
export const BAN_DURATION_PRESETS = [
  ["perm", "Permanent"], ["1h", "1 hour"], ["1d", "1 day"], ["3d", "3 days"], ["7d", "7 days"], ["30d", "30 days"]
];
const UNITS = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
const NAMES = { m: "Minute", h: "Hour", d: "Day", w: "Week" };

// Returns milliseconds, null for a permanent ban, or undefined when the text is not a duration.
export function parseBanDuration(value) {
  if (typeof value !== "string") return undefined;
  const text = value.trim().toLowerCase();
  if (["perm", "permanent", "forever"].includes(text)) return null;
  const match = /^([1-9][0-9]{0,3})([mhdw])$/.exec(text);
  if (!match) return undefined;
  const ms = Number(match[1]) * UNITS[match[2]];
  return ms <= MAX_BAN_MS ? ms : undefined;
}

export function describeBanLength(ms) {
  if (ms === null || ms === undefined) return "Permanently";
  for (const unit of ["w", "d", "h", "m"]) {
    const count = ms / UNITS[unit];
    if (Number.isInteger(count) && count >= 1) return `for ${count} ${NAMES[unit]}${count === 1 ? "" : "s"}`;
  }
  return `for ${Math.max(1, Math.round(ms / UNITS.m))} Minutes`;
}

export function cleanBanReason(value) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, BAN_REASON_MAX);
}
