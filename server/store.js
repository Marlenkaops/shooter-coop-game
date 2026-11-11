import { addXp, campaignProgress, completeOperation, levelForXp, MAPS, MAX_ADMIN_LEVEL,
  SNIPER_REWARD_MAP, unlockedMaps, XP_PER_LEVEL } from "../shared/progression.js";
import { DEFAULT_WEAPON_ID, tokensForMatch, WEAPONS } from "../shared/weapons.js";
import { dataDir } from "./data.js";
import { DEFAULT_SKIN_ID, SKINS } from "../shared/skins.js";
import { eventContentAvailable } from "../shared/events.js";
import { durableState, persistentFile } from "./persistence.js";
import { DEFAULT_CLASS, SQUAD_CLASSES, TEAM_STATS, validTeamMetadata } from "../shared/teamwork.js";
import { applyClaim, applyMatchProgress, ATTACHMENTS, careerFor, claimOffer, masteryLevel,
  PERKS, perkUnlocked, seasonAt, validCareer, WEAPON_FINISHES } from "../shared/career.js";
import { validRecordMetadata } from "../shared/rankings.js";

const profileFile = persistentFile(dataDir, "players.json", { initial: {}, backup: true,
  stringify: (value) => JSON.stringify(value, null, 2) });
const leaderboardCache = new Map();
let cachedRecords;

function defaultUsername(id) {
  return `Ranger-${id.slice(0, 8)}`;
}

function replaceRecord(id, next) {
  profileFile.save({ ...profileFile.value, [id]: next });
  leaderboardCache.clear();
}
export function storedPlayers() { return profileFile.value; }
export function playerRecordsRevision() { return profileFile.revision; }
export function savePlayerRecords(updates) {
  for (const record of Object.values(updates)) if (!validRecordMetadata(record)) throw new Error("Invalid saved ranking/social metadata.");
  profileFile.save({ ...profileFile.value, ...updates });
  leaderboardCache.clear();
}

export function getProfile(id) {
  let records = profileFile.value;
  if (!records[id]) {
    replaceRecord(id, { id, xp: 0, matches: 0, totalKills: 0, tokens: 0,
      username: defaultUsername(id),
      ownedSkins: [DEFAULT_SKIN_ID], equippedSkinId: DEFAULT_SKIN_ID,
      ownedWeapons: [DEFAULT_WEAPON_ID], equippedWeaponId: DEFAULT_WEAPON_ID });
    records = profileFile.value;
  }
  return profileFromRecord(records[id]);
}

export function profileFromRecord(record) {
  const id = record.id;
  if (!validTeamMetadata(record) || !validCareer(record) || !validRecordMetadata(record)) throw new Error("Invalid saved operator metadata.");
  const campaignCompleted = campaignProgress(record.campaignCompleted);
  const ownedWeapons = Array.isArray(record.ownedWeapons)
    ? [DEFAULT_WEAPON_ID, ...record.ownedWeapons.filter((weaponId) =>
      weaponId !== DEFAULT_WEAPON_ID && weaponId !== "sniper" && Object.hasOwn(WEAPONS, weaponId))]
    : [DEFAULT_WEAPON_ID];
  if (campaignCompleted.includes(SNIPER_REWARD_MAP) || record.lootedWeapons?.includes("sniper")) ownedWeapons.push("sniper");
  if (record.adminUnlockedWeapons === true) ownedWeapons.splice(0, ownedWeapons.length, ...Object.keys(WEAPONS));
  ownedWeapons.splice(0, ownedWeapons.length, ...ownedWeapons.filter((id) => eventContentAvailable(id)));
  if (record.ownedSkins !== undefined && !Array.isArray(record.ownedSkins)) throw new Error("Invalid saved outfits.");
  const ownedSkins = [...new Set([DEFAULT_SKIN_ID, ...(record.ownedSkins || [])])];
  if (ownedSkins.some((skinId) => !Object.hasOwn(SKINS, skinId)) ||
    !Number.isSafeInteger(record.tokens ?? 0) || (record.tokens ?? 0) < 0) throw new Error("Invalid saved outfit or token balance.");
  if (record.equippedSkinId !== undefined && !ownedSkins.includes(record.equippedSkinId)) throw new Error("Invalid equipped outfit.");
  return { ...record, username: record.username || defaultUsername(id),
    career: careerFor(record),
    classId: record.classId || DEFAULT_CLASS,
    ...Object.fromEntries(TEAM_STATS.map((key) => [key, record[key] ?? 0])),
    tokens: record.tokens ?? 0, ownedWeapons, ownedSkins,
    equippedSkinId: ownedSkins.includes(record.equippedSkinId) ? record.equippedSkinId : DEFAULT_SKIN_ID,
    campaignCompleted,
    equippedWeaponId: ownedWeapons.includes(record.equippedWeaponId)
      ? record.equippedWeaponId : DEFAULT_WEAPON_ID,
    level: levelForXp(record.xp),
    unlockedMaps: record.adminUnlockedMaps === true ? MAPS.filter((map) => eventContentAvailable(map.id)).map((map) => map.id) : unlockedMaps(record.xp) };
}

export function existingProfile(id) {
  return typeof id === "string" && Object.hasOwn(profileFile.value, id) ? getProfile(id) : null;
}

export function searchProfiles(query = "", offset = 0) {
  const records = profileFile.value;
  if (typeof query !== "string" || query.length > 64 || !Number.isSafeInteger(offset) || offset < 0) {
    return { ok: false, error: "Invalid profile search." };
  }
  const normalized = query.trim().toLocaleLowerCase();
  const ids = Object.keys(records).filter((id) => id.toLocaleLowerCase().includes(normalized) ||
    (records[id].username || defaultUsername(id)).toLocaleLowerCase().includes(normalized))
    .sort((a, b) => (records[a].username || defaultUsername(a)).localeCompare(records[b].username || defaultUsername(b)) || a.localeCompare(b));
  const profiles = ids.slice(offset, offset + 20).map((id) => {
    const profile = getProfile(id);
    return { id, username: profile.username, level: profile.level, xp: profile.xp };
  });
  return { ok: true, profiles, total: ids.length, nextOffset: offset + 20 < ids.length ? offset + 20 : null };
}

export function readLeaderboard(identity, { sort = "xp", offset = 0 } = {}) {
  const records = profileFile.value;
  const revision = profileFile.revision;
  if (cachedRecords !== revision) {
    leaderboardCache.clear();
    cachedRecords = revision;
  }
  if (!["xp", "kills", "season"].includes(sort) || !Number.isSafeInteger(offset) || offset < 0) {
    return { ok: false, error: "Invalid leaderboard request." };
  }
  const season = seasonAt().id, cacheKey = sort === "season" ? `${sort}:${season}` : sort;
  if (!leaderboardCache.has(cacheKey)) {
    const players = Object.keys(records).map((id) => {
      const profile = profileFromRecord(records[id]);
      const xp = profile.xp ?? 0, totalKills = profile.totalKills ?? 0, matches = profile.matches ?? 0;
      if (![xp, totalKills, matches].every((value) => Number.isSafeInteger(value) && value >= 0)) {
        throw new Error("Invalid saved leaderboard statistics.");
      }
      return { id, username: profile.username, xp, totalKills, matches, level: levelForXp(xp),
        seasonXp: profile.career.seasons[season]?.xp || 0 };
    }).filter((player) => sort === "season" ? player.seasonXp > 0 : player.matches > 0 || player.xp > 0 || player.totalKills > 0);
    players.sort((a, b) => (sort === "season" ? b.seasonXp - a.seasonXp : sort === "xp" ? b.xp - a.xp || b.totalKills - a.totalKills :
      b.totalKills - a.totalKills || b.xp - a.xp) || a.username.localeCompare(b.username) || a.id.localeCompare(b.id));
    leaderboardCache.set(cacheKey, players);
  }
  const players = leaderboardCache.get(cacheKey);
  const publicEntry = (player, index) => ({
    rank: index + 1, username: player.username, playerTag: player.id.slice(0, 8),
    level: player.level, xp: player.xp, totalKills: player.totalKills, matches: player.matches,
    self: player.id === identity, ...(sort === "season" ? { seasonXp: player.seasonXp } : {})
  });
  const start = Math.min(offset, Math.max(0, Math.floor((players.length - 1) / 20) * 20));
  const ownIndex = players.findIndex((player) => player.id === identity);
  return {
    ok: true, sort, ...(sort === "season" ? { season } : {}), offset: start, total: players.length,
    entries: players.slice(start, start + 20).map((player, index) => publicEntry(player, start + index)),
    self: ownIndex < 0 ? null : publicEntry(players[ownIndex], ownIndex),
    nextOffset: start + 20 < players.length ? start + 20 : null
  };
}

export function adminSetProgression(id, operation, level) {
  if (!existingProfile(id)) return { ok: false, error: "Player profile not found." };
  if (!["setLevel", "unlockWeapons", "unlockMaps", "unlockAll"].includes(operation) ||
    (operation === "setLevel" && (!Number.isSafeInteger(level) || level < 1 || level > MAX_ADMIN_LEVEL))) {
    return { ok: false, error: "Invalid progression change." };
  }
  const previous = profileFile.value[id];
  const next = { ...previous };
  if (operation === "setLevel") next.xp = (level - 1) * XP_PER_LEVEL;
  if (operation === "unlockWeapons" || operation === "unlockAll") next.adminUnlockedWeapons = true;
  if (operation === "unlockMaps" || operation === "unlockAll") next.adminUnlockedMaps = true;
  replaceRecord(id, next);
  return { ok: true, profile: getProfile(id) };
}

export function updateUsername(id, requested) {
  const current = getProfile(id);
  const records = profileFile.value;
  const username = requested === undefined ? current.username :
    typeof requested === "string" ? requested.trim().replace(/\s+/g, " ") : "";
  if (!/^[\p{L}\p{N}][\p{L}\p{N} _-]{2,17}$/u.test(username)) {
    return { ok: false, error: "Username must be 3–18 letters, numbers, spaces, _ or -." };
  }
  if (Object.entries(records).some(([otherId, record]) =>
    otherId !== id && (record.username || defaultUsername(otherId)).toLocaleLowerCase() === username.toLocaleLowerCase())) {
    return { ok: false, error: "That username is already in use." };
  }
  if (current.username !== username) {
    replaceRecord(id, { ...records[id], username });
  }
  return { ok: true, profile: getProfile(id) };
}

export function rewardPlayer(id, xp, kills, wave = 1, won = false, mapId = null, tokenReward = tokensForMatch(wave, kills, won), teamwork = {}) {
  if (!Number.isSafeInteger(tokenReward) || tokenReward < 0) throw new RangeError("Invalid token reward");
  const profile = addXp(getProfile(id), xp);
  const records = profileFile.value;
  if (!Number.isSafeInteger(profile.tokens + tokenReward)) throw new RangeError("Token balance limit reached.");
  const campaignCompleted = completeOperation(profile.campaignCompleted, mapId, won);
  const increments = { totalAssists: teamwork.assists ?? 0, totalRevives: teamwork.revives ?? 0,
    totalObjectiveScore: teamwork.objectiveScore ?? 0, teamworkXp: teamwork.teamXp ?? 0 };
  const totals = Object.fromEntries(TEAM_STATS.map((key) => {
    if (!Number.isSafeInteger(increments[key]) || increments[key] < 0 ||
      !Number.isSafeInteger(profile[key] + increments[key])) throw new RangeError("Invalid teamwork reward.");
    return [key, profile[key] + increments[key]];
  }));
  replaceRecord(id, {
    ...records[id], id,
    career: applyMatchProgress(getProfile(id), { ...teamwork, xp, kills, won }),
    ...totals,
    xp: profile.xp,
    campaignCompleted,
    tokens: profile.tokens + tokenReward,
    matches: (records[id]?.matches || 0) + 1,
    totalKills: (records[id]?.totalKills || 0) + Math.max(0, kills || 0)
  });
  return getProfile(id);
}

export function selectClass(id, classId) {
  if (typeof classId !== "string" || !Object.hasOwn(SQUAD_CLASSES, classId)) return { ok: false, error: "Unknown operator class." };
  getProfile(id);
  replaceRecord(id, { ...profileFile.value[id], classId });
  return { ok: true, profile: getProfile(id) };
}

export function equipProgression(id, input) {
  const profile = getProfile(id), career = structuredClone(profile.career);
  if (input.kind === "perk") {
    if (!Object.hasOwn(PERKS, input.id) || !perkUnlocked(profile, input.id)) return { ok: false, error: "Perk not unlocked for this class." };
    career.perkId = input.id;
  } else {
    const weaponId = input.weaponId;
    if (!profile.ownedWeapons.includes(weaponId) || !eventContentAvailable(weaponId)) return { ok: false, error: "Weapon not owned or unavailable." };
    const level = masteryLevel(career.weaponXp[weaponId] || 0);
    const kit = career.loadouts[weaponId] ||= { attachmentId: "none", finishId: "standard" };
    if (input.kind === "attachment") {
      if (!Object.hasOwn(ATTACHMENTS, input.id) || level < ATTACHMENTS[input.id].level) return { ok: false, error: "Attachment not unlocked." };
      kit.attachmentId = input.id;
    } else if (input.kind === "finish") {
      const finish = WEAPON_FINISHES[input.id];
      if (!finish || (input.id === "aurora" ? !Object.values(career.seasons).some((season) => season.claimed.includes(4)) :
        level < finish.level)) return { ok: false, error: "Weapon finish not unlocked." };
      kit.finishId = input.id;
    } else return { ok: false, error: "Unknown progression equipment." };
  }
  replaceRecord(id, { ...profileFile.value[id], career });
  return { ok: true, profile: getProfile(id) };
}

export function progressionClaimOffer(id, request, now) {
  return claimOffer(getProfile(id), request, now);
}

export function rewardProgression(id, reward) {
  const profile = getProfile(id);
  const career = applyClaim(profile, reward);
  if (!Number.isSafeInteger(profile.xp + reward.xp) || !Number.isSafeInteger(profile.tokens + reward.tokens)) {
    throw new RangeError("Progression balance limit reached.");
  }
  replaceRecord(id, { ...profileFile.value[id], career, xp: profile.xp + reward.xp, tokens: profile.tokens + reward.tokens });
  return getProfile(id);
}

export function creditNpcTokens(id, tokens) {
  const profile = getProfile(id);
  if (!Number.isSafeInteger(tokens) || tokens <= 0 || !Number.isSafeInteger(profile.tokens + tokens)) {
    throw new RangeError("Invalid NPC token credit.");
  }
  replaceRecord(id, { ...profileFile.value[id], tokens: profile.tokens + tokens });
  return getProfile(id);
}

export function buySkin(id, skinId) {
  if (typeof skinId !== "string" || !Object.hasOwn(SKINS, skinId)) return { ok: false, error: "Unknown outfit." };
  const profile = getProfile(id), skin = SKINS[skinId];
  if (profile.ownedSkins.includes(skinId)) return { ok: false, error: "Outfit already owned." };
  if (profile.tokens < skin.cost) return { ok: false, error: "Not enough tokens." };
  replaceRecord(id, { ...profileFile.value[id], tokens: profile.tokens - skin.cost,
    ownedSkins: [...profile.ownedSkins, skinId] });
  return { ok: true, profile: getProfile(id) };
}

export function equipSkin(id, skinId) {
  const profile = getProfile(id);
  if (typeof skinId !== "string" || !Object.hasOwn(SKINS, skinId) || !profile.ownedSkins.includes(skinId)) {
    return { ok: false, error: "Outfit not owned." };
  }
  replaceRecord(id, { ...profileFile.value[id], equippedSkinId: skinId });
  return { ok: true, profile: getProfile(id) };
}

export function buyWeapon(id, weaponId) {
  if (typeof weaponId !== "string" || !Object.hasOwn(WEAPONS, weaponId) ||
    !WEAPONS[weaponId].cost) {
    return { ok: false, error: "Unknown weapon." };
  }
  const weapon = WEAPONS[weaponId];
  const profile = getProfile(id);
  if (profile.ownedWeapons.includes(weaponId)) return { ok: false, error: "Weapon already owned." };
  if (profile.tokens < weapon.cost) return { ok: false, error: "Not enough tokens." };
  replaceRecord(id, {
    ...profileFile.value[id], tokens: profile.tokens - weapon.cost,
    ownedWeapons: [...profile.ownedWeapons, weaponId]
  });
  return { ok: true, profile: getProfile(id) };
}

export function equipWeapon(id, weaponId) {
  if (typeof weaponId !== "string" || !Object.hasOwn(WEAPONS, weaponId) ||
    !getProfile(id).ownedWeapons.includes(weaponId)) {
    return { ok: false, error: "Weapon not owned." };
  }
  replaceRecord(id, { ...profileFile.value[id], equippedWeaponId: weaponId });
  return { ok: true, profile: getProfile(id) };
}

export function grantWeapon(id, weaponId, equip = false) {
  const profile = existingProfile(id);
  if (!profile || typeof weaponId !== "string" || !Object.hasOwn(WEAPONS, weaponId) || !eventContentAvailable(weaponId)) {
    return { ok: false, error: "Player or weapon not found." };
  }
  if (profile.ownedWeapons.includes(weaponId) && !equip) return { ok: true, profile, alreadyOwned: true };
  const previous = profileFile.value[id];
  const lootedWeapons = Array.isArray(previous.lootedWeapons) ? previous.lootedWeapons : [];
  replaceRecord(id, { ...previous, ownedWeapons: [...new Set([...profile.ownedWeapons, weaponId])],
    lootedWeapons: [...new Set([...lootedWeapons, weaponId])],
    ...(equip ? { equippedWeaponId: weaponId } : {}) });
  return { ok: true, profile: getProfile(id) };
}

export function storageStatus() {
  if (durableState) return { backend: "Azure Table Storage (managed identity)",
    durability: durableState.available ? "Verified durable dataset" : "Unavailable; writes fail closed",
    profiles: Object.keys(profileFile.value).length, lastSavedAt: durableState.root?.updatedAt || null,
    backupAvailable: durableState.files.has("players.backup.json"),
    notice: "Atomic durable commits precede success. Keep private verified exports; database replication is not a backup." };
  return { backend: "Local JSON directory", durability: "Host persistence must be verified",
    profiles: Object.keys(profileFile.value).length,
    lastSavedAt: profileFile.savedAt,
    backupAvailable: profileFile.backupExists,
    notice: "Updates preserve saved records when DATA_DIR and the identity signing secret are retained. Temporary cloud volumes do not survive replacement." };
}
