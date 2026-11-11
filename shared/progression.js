import { eventContentAvailable } from "./events.js";

export const MAPS = [
  {
    id: "wickfall", name: "Wickfall Necropolis", level: 1, accent: "#f6a550", operation: "The Last Lantern",
    campaign: false, event: "halloween-2026", terrain: "Lantern-lit crypt gardens",
    weather: "Moonlit ground fog", difficulty: "Severe", time: "00:13",
    description: "An original Halloween arena beneath a crooked lantern belfry. Offset tomb gardens split the crypt courtyard into close-range flanks, with elevated mortuary shelters and a clear processional lane. Find Jack-o'-Six and Graveglass in the raised shelters. Event ends only when announced; event guns are usable only while it is active."
  },
  {
    id: "foundry", name: "Ash Foundry", level: 1, accent: "#ff8a3d", operation: "Containment breach",
    terrain: "Industrial complex", weather: "Thermal haze", difficulty: "Moderate", time: "19:40",
    description: "A decommissioned smelting district at the southern containment line. Tight service lanes lead up broad ramps to raised service bays with sheltered loot and elevated firing positions."
  },
  {
    id: "tundra", name: "Frozen Relay", level: 3, accent: "#63d8ff", operation: "Silent signal",
    terrain: "Alpine relay", weather: "Snow / low visibility", difficulty: "Severe", time: "05:20",
    description: "An isolated communications station above the tree line. Snow-covered ramp approaches connect raised relay shelters, while fractured ice and dense equipment create uncertain sightlines."
  },
  {
    id: "void", name: "Void Garden", level: 5, accent: "#c07cff", operation: "Last light",
    terrain: "Anomalous ruins", weather: "Electromagnetic storm", difficulty: "Critical", time: "Unknown",
    description: "A former research garden transformed by the event. Rocky inclines climb to high field laboratories, while exposed lower approaches converge around containment formations."
  },
  {
    id: "harbor", name: "Breakwater Docks", level: 1, accent: "#79a9bb", operation: "Cargo interdiction",
    campaign: false, terrain: "Container port", weather: "Driving rain", difficulty: "Moderate", time: "06:10",
    description: "A rain-soaked cargo terminal beneath dockside cranes. Staggered containers divide the lower quay; wide ramps lead to raised quay offices with open through-routes and sheltered supplies."
  },
  {
    id: "outpost", name: "Dustline Outpost", level: 2, accent: "#d9b178", operation: "Radar defense",
    campaign: false, terrain: "Desert radar station", weather: "Windblown dust", difficulty: "Severe", time: "17:45",
    description: "A remote radar installation between dry ridgelines. Enterable barracks guard the courtyard, and sandy inclines climb to elevated field stations overlooking low sandbag nests."
  },
  {
    id: "airfield", name: "Crosswind Airbase", level: 3, accent: "#9cb9c8", operation: "Runway lockdown",
    campaign: false, terrain: "Military flight apron", weather: "Cold crosswind", difficulty: "Severe", time: "07:15",
    description: "An abandoned flight apron with accessible armored hangars. Offset deflectors split the lower runway into optic-friendly lanes; ramped equipment bays create elevated close-quarter flanks."
  },
  {
    id: "citadel", name: "Iron Bastion", level: 4, accent: "#cf9977", operation: "Fortress breach",
    campaign: false, terrain: "Concrete fortress", weather: "Sunset ash", difficulty: "Critical", time: "18:55",
    description: "A hardened command fortress surrounded by watchtowers. Enterable guardhouses, high ramped bastions and lower diagonal checkpoints create interlocking approaches around the power block."
  },
  {
    id: "spillway", name: "Blackwater Spillway", level: 2, accent: "#73bab0", operation: "Turbine shutdown",
    campaign: false, terrain: "Hydroelectric works", weather: "Rain and river mist", difficulty: "Severe", time: "06:35",
    description: "A dam service yard between turbine blocks. Wet inclines climb to sheltered maintenance stations, with enterable pump houses and staggered flood barriers across the lower yard."
  },
  {
    id: "depot", name: "Ember Rail Depot", level: 5, accent: "#e4a26c", operation: "Freight evacuation",
    campaign: false, terrain: "Rail interchange", weather: "Evening haze", difficulty: "Critical", time: "20:10",
    description: "Offset freight cars divide the lower switching yard. Gravel ramps climb to enterable signal rooms; short crate alleys lead into long track sightlines beneath gantries."
  }
];

export const CAMPAIGN_MAPS = MAPS.filter((map) => map.campaign !== false);
export const XP_PER_LEVEL = 500;
export const MAX_ADMIN_LEVEL = Math.floor(Number.MAX_SAFE_INTEGER / XP_PER_LEVEL) + 1;
export const SNIPER_REWARD_MAP = "tundra";

export function campaignOperationNumber(mapId) {
  const index = CAMPAIGN_MAPS.findIndex((map) => map.id === mapId);
  if (index < 0) throw new RangeError("Not a campaign operation.");
  return index + 1;
}

export function campaignProgress(completed = []) {
  const valid = [];
  for (const map of CAMPAIGN_MAPS) {
    if (!Array.isArray(completed) || !completed.includes(map.id)) break;
    valid.push(map.id);
  }
  return valid;
}

export function completeOperation(completed, mapId, won) {
  const progress = campaignProgress(completed);
  if (won && CAMPAIGN_MAPS[progress.length]?.id === mapId) return [...progress, mapId];
  return progress;
}

export function levelForXp(xp) {
  const value = Number(xp);
  const safe = Number.isFinite(value) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, value)) : 0;
  return Math.floor(safe / XP_PER_LEVEL) + 1;
}

export function unlockedMaps(xp) {
  const level = levelForXp(xp);
  return MAPS.filter((map) => eventContentAvailable(map.id) && level >= map.level).map((map) => map.id);
}

export function xpProgress(xp) {
  const numericXp = Number(xp);
  const safeXp = Number.isFinite(numericXp) ? Math.max(0, Math.floor(numericXp)) : 0;
  const current = safeXp % XP_PER_LEVEL;
  return {
    current,
    required: XP_PER_LEVEL,
    remaining: XP_PER_LEVEL - current,
    percent: current / XP_PER_LEVEL * 100
  };
}

export function newlyUnlockedMaps(previousXp, nextXp) {
  const previous = new Set(unlockedMaps(previousXp));
  return unlockedMaps(nextXp).filter((mapId) => !previous.has(mapId));
}

export function canAccessMap(xp, mapId, administratorGrant = false) {
  return eventContentAvailable(mapId) && MAPS.some((map) => map.id === mapId) &&
    (administratorGrant === true || unlockedMaps(xp).includes(mapId));
}

export function addXp(profile, amount) {
  const xp = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, (profile.xp || 0) + Math.max(0, Math.floor(amount || 0))));
  return { ...profile, xp, level: levelForXp(xp),
    unlockedMaps: profile.adminUnlockedMaps === true ? MAPS.filter((map) => eventContentAvailable(map.id)).map((map) => map.id) : unlockedMaps(xp) };
}
