import { dataDir } from "./data.js";
import { persistentFile } from "./persistence.js";
import { getProfile, playerRecordsRevision, profileFromRecord, readLeaderboard, savePlayerRecords, storedPlayers } from "./store.js";
import { levelForXp } from "../shared/progression.js";
import { careerFor } from "../shared/career.js";
import { applyRankedResult, emptyRankStats, metricValue, newRanking, publicTag, rankedEligibility,
  rankingPeriod, validRankingQuery, validRecordMetadata, validSquads, validTag } from "../shared/rankings.js";

const squadFile = persistentFile(dataDir, "squads.json", { initial: {}, optional: true, validate(value) {
  if (!validSquads(value)) throw new Error("Invalid saved squad records.");
} });
const cache = new Map();
let cachedPlayers, cachedSquads;
const socialFor = (profile) => structuredClone(profile.social || { friends: [], incoming: [], squadTag: null });
export function profileByTag(tag, records = storedPlayers()) {
  if (!validTag(tag)) return null;
  const ids = Object.keys(records).filter((id) => publicTag(id) === tag.toUpperCase());
  return ids.length === 1 ? profileFromRecord(records[ids[0]]) : null;
}
const summary = (profile) => ({ playerTag: publicTag(profile.id), username: profile.username, level: profile.level });
const summaries = (tags, records) => tags.map((tag) => {
  const profile = profileByTag(tag, records);
  return profile ? summary(profile) : { playerTag: tag, username: "Unavailable operator", level: null };
});
export function socialStatus(identity) {
  const profile = getProfile(identity), tag = publicTag(identity), social = socialFor(profile);
  const records = storedPlayers();
  const squad = squadFile.value[social.squadTag];
  return { ok: true, playerTag: tag, friends: summaries(social.friends, records), incoming: summaries(social.incoming, records),
    outgoing: summaries(Object.keys(records).filter((id) => records[id].social?.incoming.includes(tag)).map(publicTag), records),
    squad: squad?.active ? { tag: squad.tag, name: squad.name, leader: squad.tag === tag, members: summaries(squad.members, records),
      invites: squad.tag === tag ? summaries(squad.invites, records) : [] } : null,
    invitations: Object.values(squadFile.value).filter((value) => value.active && value.invites.includes(tag))
      .map((value) => ({ tag: value.tag, name: value.name, members: value.members.length })) };
}
export function socialAction(identity, input) {
  const profile = getProfile(identity), tag = publicTag(identity), social = socialFor(profile);
  if (!profileByTag(tag)) return { ok: false, error: "Public tag is ambiguous; social actions are unavailable for this account." };
  const affected = new Set([identity]), updates = {};
  const fail = (error) => ({ ok: false, error });
  if (input.action.startsWith("friend")) {
    const peer = profileByTag(input.tag);
    if (!peer || peer.id === identity) return fail("Choose another operator's public tag.");
    const otherTag = publicTag(peer.id), other = socialFor(peer);
    affected.add(peer.id);
    if (input.action === "friendRequest") {
      if (social.friends.includes(otherTag) || other.incoming.includes(tag)) return fail("Already friends or request already sent.");
      const outgoing = Object.values(storedPlayers()).filter((p) => p.social?.incoming.includes(tag)).length;
      if (other.incoming.length >= 30 || outgoing >= 30 || social.friends.length >= 100 || other.friends.length >= 100) return fail("Friend/request limit reached.");
      other.incoming.push(tag);
    } else if (input.action === "friendAccept") {
      if (!social.incoming.includes(otherTag)) return fail("That friend request is no longer available.");
      if (social.friends.length >= 100 || other.friends.length >= 100) return fail("Friend limit reached.");
      social.friends = [...new Set([...social.friends, otherTag])];
      other.friends = [...new Set([...other.friends, tag])];
      social.incoming = social.incoming.filter((value) => value !== otherTag);
      other.incoming = other.incoming.filter((value) => value !== tag);
    } else if (input.action === "friendDecline") social.incoming = social.incoming.filter((value) => value !== otherTag);
    else if (input.action === "friendCancel") other.incoming = other.incoming.filter((value) => value !== tag);
    else if (input.action === "friendRemove") {
      social.friends = social.friends.filter((value) => value !== otherTag);
      other.friends = other.friends.filter((value) => value !== tag);
    } else return fail("Unknown friend action.");
    updates[peer.id] = { ...storedPlayers()[peer.id], social: other };
  } else {
    const squads = structuredClone(squadFile.value);
    let squad = squads[social.squadTag];
    if (input.action === "squadCreate") {
      if (social.squadTag) return fail("Leave your current squad first.");
      if (typeof input.name !== "string" || !/^[\p{L}\p{N}][\p{L}\p{N} _-]{2,23}$/u.test(input.name)) return fail("Squad names need 3-24 letters, numbers, spaces, _ or -.");
      squad = squads[tag] = { tag, name: input.name, active: true, members: [tag], invites: [],
        ranking: squads[tag]?.ranking || newRanking(Date.now()) };
      social.squadTag = tag;
    } else if (input.action === "squadInvite") {
      const peer = profileByTag(input.tag);
      if (!squad || squad.tag !== tag || !peer || !social.friends.includes(publicTag(peer.id)) ||
        !socialFor(peer).friends.includes(tag)) return fail("Only the captain can invite a mutual friend.");
      const otherTag = publicTag(peer.id);
      if (socialFor(peer).squadTag || squad.members.includes(otherTag) || squad.invites.includes(otherTag)) return fail("Operator already belongs to a squad or is invited.");
      if (squad.members.length >= 4 || squad.invites.length >= 4 ||
        Object.values(squads).filter((s) => s.invites.includes(otherTag)).length >= 20) return fail("Squad/invitation limit reached.");
      squad.invites.push(otherTag); affected.add(peer.id);
    } else if (input.action === "squadAccept" || input.action === "squadDecline") {
      squad = squads[input.tag.toUpperCase()];
      if (!squad?.active || !squad.invites.includes(tag)) return fail("Squad invitation is no longer available.");
      if (input.action === "squadAccept") {
        if (social.squadTag || squad.members.length >= 4) return fail("Leave your squad first, or choose a squad with an open slot.");
        squad.members.push(tag); social.squadTag = squad.tag;
      }
      squad.invites = squad.invites.filter((value) => value !== tag);
      const captain = profileByTag(squad.tag);
      if (captain) affected.add(captain.id);
    } else if (input.action === "squadLeave" || input.action === "squadRemove") {
      if (!squad?.active) return fail("You are not in a squad.");
      const target = input.action === "squadLeave" ? tag : input.tag.toUpperCase();
      if (input.action === "squadRemove" && (squad.tag !== tag || target === tag || !squad.members.includes(target))) return fail("Only the captain can remove a squad member.");
      const removed = target === squad.tag ? [...squad.members] : [target];
      for (const memberTag of removed) {
        const member = profileByTag(memberTag);
        if (member && member.id !== identity) {
          updates[member.id] = { ...storedPlayers()[member.id], social: { ...socialFor(member), squadTag: null } };
          affected.add(member.id);
        }
      }
      if (target === squad.tag) { squad.active = false; squad.members = []; squad.invites = []; }
      else squad.members = squad.members.filter((value) => value !== target);
      if (removed.includes(tag)) social.squadTag = null;
    } else return fail("Unknown squad action.");
    squadFile.save(squads);
  }
  updates[identity] = { ...storedPlayers()[identity], social };
  savePlayerRecords(updates);
  return { ...socialStatus(identity), affected: [...affected] };
}
export function matchSquadFor(identities) {
  if (identities.length < 2 || new Set(identities).size !== identities.length) return null;
  const members = identities.map((id) => getProfile(id)), tag = members[0].social?.squadTag;
  const squad = squadFile.value[tag];
  return squad?.active && members.every((p) => p.social?.squadTag === tag && squad.members.includes(publicTag(p.id)))
    ? { tag, identities: [...identities] } : null;
}
export function recordRankedResult(reward) {
  const eligible = rankedEligibility(reward);
  if (!eligible.ok) return;
  const profile = getProfile(reward.identity);
  savePlayerRecords({ [profile.id]: { ...storedPlayers()[profile.id], ranking: applyRankedResult(profile.ranking, reward) } });
  const team = eligible.evidence.team;
  const squad = team && squadFile.value[team.tag];
  if (team && !squad) throw new Error("Ranked squad record is missing; reward remains pending.");
  if (squad) {
    squadFile.save({ ...squadFile.value, [team.tag]: { ...squad, ranking: applyRankedResult(squad.ranking, reward, { team: true }) } });
  }
}
export function readRankings(identity, query) {
  if (!validRankingQuery(query)) return { ok: false, error: "Invalid ranking filters." };
  const own = getProfile(identity), tag = publicTag(identity), social = socialFor(own);
  const records = storedPlayers(), squads = squadFile.value, period = rankingPeriod(query.period);
  const playersRevision = playerRecordsRevision(), squadsRevision = squadFile.revision;
  if (playersRevision !== cachedPlayers || squadsRevision !== cachedSquads) {
    cache.clear(); cachedPlayers = playersRevision; cachedSquads = squadsRevision;
  }
  const key = JSON.stringify([period, query.metric, query.scope, query.route, query.scope === "friends" ? identity : ""]);
  if (!cache.has(key)) {
    const entries = query.scope === "squads" ? Object.values(squads).map((s) =>
      ({ playerTag: s.tag, username: s.name, members: s.members.length, archived: !s.active, ranking: s.ranking })) :
      Object.keys(records).filter((id) => query.scope !== "friends" || id === identity ||
        social.friends.includes(publicTag(id)) && records[id].social?.friends.includes(tag))
        .map((id) => {
          if (!validRecordMetadata(records[id])) throw new Error("Invalid saved ranking/social metadata.");
          return { ...summary({ id, username: records[id].username || `Ranger-${id.slice(0, 8)}`,
            level: levelForXp(records[id].xp) }), ranking: records[id].ranking };
        });
    const rows = entries.map(({ ranking, ...entry }) => {
      const stats = query.period === "allTime" ? ranking?.lifetime : ranking?.periods[period];
      return { ...entry, value: metricValue(stats, query.metric, query.route),
        shots: stats?.shots || 0, hits: stats?.hits || 0, matches: stats?.matches || 0,
        clearDifficulty: query.metric === "fastest" ? stats?.bestTimes[query.route || "foundry:campaign"]?.[1] : undefined };
    }).filter((entry) => entry.value !== null);
    rows.sort((a, b) => (query.metric === "fastest" ? a.value - b.value : b.value - a.value) ||
      b.matches - a.matches || a.username.localeCompare(b.username) || a.playerTag.localeCompare(b.playerTag));
    if (cache.size >= 64) cache.delete(cache.keys().next().value);
    cache.set(key, rows);
  }
  const rows = cache.get(key), offset = Math.min(query.offset || 0, Math.max(0, Math.floor((rows.length - 1) / 20) * 20));
  const selfTag = query.scope === "squads" ? social.squadTag : tag;
  const entry = (row, index) => ({ ...row, rank: index + 1, self: row.playerTag === selfTag });
  const ownIndex = rows.findIndex((row) => row.playerTag === selfTag);
  return { ok: true, period: query.period, periodKey: period, metric: query.metric, scope: query.scope,
    offset, total: rows.length, entries: rows.slice(offset, offset + 20).map((row, i) => entry(row, offset + i)),
    self: ownIndex < 0 ? null : entry(rows[ownIndex], ownIndex), nextOffset: offset + 20 < rows.length ? offset + 20 : null };
}
export function publicProfile(identity, tag) {
  const profile = tag ? profileByTag(tag) : getProfile(identity);
  if (!profile) return { ok: false, error: "Public operator tag not found or ambiguous." };
  const career = careerFor(profile), favorites = Object.entries(career.weaponXp).filter(([, xp]) => xp > 0)
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b));
  return { ok: true, profile: { ...summary(profile), self: profile.id === identity,
    xp: profile.xp, lifetimeKills: profile.totalKills || 0, lifetimeAssists: profile.totalAssists || 0,
    lifetimeRevives: profile.totalRevives || 0, lifetimeObjectiveScore: profile.totalObjectiveScore || 0,
    rank: readLeaderboard(profile.id).self?.rank ?? null, prestige: career.prestige, badges: [...career.achievements],
    showcase: profile.showcase || career.achievements.slice(0, 3), favoriteWeaponId: favorites[0]?.[0] ?? null,
    trackedSince: profile.ranking?.since ?? null, stats: profile.ranking?.lifetime || null,
    squad: profile.social?.squadTag && squadFile.value[profile.social.squadTag]?.active
      ? { tag: profile.social.squadTag, name: squadFile.value[profile.social.squadTag].name } : null } };
}
export function setShowcase(identity, badges) {
  const profile = getProfile(identity);
  if (!Array.isArray(badges) || badges.length > 3 || new Set(badges).size !== badges.length ||
    badges.some((id) => !careerFor(profile).achievements.includes(id))) return { ok: false, error: "Choose up to three earned badges." };
  savePlayerRecords({ [identity]: { ...storedPlayers()[identity], showcase: badges } });
  return publicProfile(identity);
}
