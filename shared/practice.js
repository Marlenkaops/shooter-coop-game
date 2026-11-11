export const PRACTICE_MAP = Object.freeze({
  id: "range", name: "Daybreak Range", level: 1, accent: "#b5c88c", campaign: false,
  operation: "Weapons practice", terrain: "Outdoor firing lanes", weather: "Clear daylight",
  difficulty: "Practice", time: "09:00",
  description: "Four marked firing lanes with resettable steel targets at 10, 25 and 45 metres. Practise aim, recoil and reloads with your collected guns and unlimited reserve ammunition."
});

export const TARGET_RESET_MS = 1200;
export const RANGE_LANES = Object.freeze([-12, -4, 4, 12]);
export const RANGE_TARGETS = Object.freeze(RANGE_LANES.flatMap((x, lane) =>
  [10, 25, 45].map((distance, index) => Object.freeze({
    id: `range-${lane}-${index}`, lane: lane + 1, distance,
    position: Object.freeze({ x: x + (index - 1) * 2, y: 1, z: 14 - distance })
  }))));

export function rangeSpawnPoint(index = 0) {
  return { x: RANGE_LANES[index % RANGE_LANES.length], y: 1.7, z: 14 };
}
