export const HALLOWEEN_EVENT = Object.freeze({
  id: "halloween-2026",
  name: "Wickfall: The Last Lantern",
  active: false,
  mapId: "wickfall",
  weaponIds: Object.freeze(["jackolantern", "graveglass"])
});

export const CHRISTMAS_EVENT = Object.freeze({
  id: "christmas-2026",
  name: "Winterwatch",
  active: true
});

export function eventContentAvailable(id, event = HALLOWEEN_EVENT) {
  return id !== event.mapId && !event.weaponIds.includes(id) || event.active;
}
