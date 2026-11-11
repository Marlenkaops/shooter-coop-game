import { canOccupyPosition, groundedPosition } from "./gameplay.js";

export const RAID_CAPTURE_MS = 12_000;
export const RAID_REACH = 3.2;
export const RAID_STAGES = Object.freeze([
  Object.freeze({ id: "raid-uplink", title: "Secure the uplink", action: "Hold the marked area for 12 seconds; clear nearby threats." }),
  Object.freeze({ id: "raid-cache", title: "Recover the encrypted cache", action: "Eliminate the guards, then collect the marked cache." }),
  Object.freeze({ id: "raid-commander", title: "Defeat the armored commander", action: "Defeat the commander and all remaining escorts." })
]);
const candidates = [
  [[-10, 10], [-14, 16], [-8, 24], [-34, 0], [-12, 12]],
  [[12, -18], [20, -8], [16, -13], [34, -34], [12, 12]],
  [[0, -28], [-24, -24], [24, -24], [-32, 0], [32, 0], [0, -35]]
];

export function raidObjective(mapId, stage) {
  if (!RAID_STAGES[stage]) throw new RangeError("Unknown raid stage");
  const point = candidates[stage].find(([x, z]) =>
    canOccupyPosition(mapId, groundedPosition(mapId, { x, z }), stage === 2 ? 1.7 : 1.2));
  if (!point) throw new Error(`No safe raid objective on ${mapId}`);
  return { ...RAID_STAGES[stage], stage,
    position: groundedPosition(mapId, { x: point[0], z: point[1] }, .55),
    progressMs: 0, requiredMs: stage === 0 ? RAID_CAPTURE_MS : 0,
    contested: false, bossId: null, bossDefeated: false };
}
