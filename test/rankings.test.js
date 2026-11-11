import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { applyRankedResult, emptyRankStats, metricValue, newRanking, publicTag, rankedEligibility,
  rankingPeriod, validRanking, validRankingQuery, validRecordMetadata, validSquads } from "../shared/rankings.js";
import { seasonAt } from "../shared/career.js";
import { validReward } from "../server/reward-records.js";
import { createCommandGuard } from "../server/anti-cheat.js";
import { operatorMarkup, socialMarkup } from "../src/operator-record.js";

const now = Date.UTC(2026, 10, 8, 12);
function reward(changes = {}, evidence = {}, matchChanges = {}) {
  return { id: "11111111-1111-4111-8111-111111111111", identity: "operator", kind: "match",
    xp: 100, tokens: 10, kills: 2, assists: 1, revives: 1, objectiveScore: 100, teamXp: 50, won: true, wave: 5, mapId: "foundry",
    progression: JSON.stringify({ classId: "assault", weaponXp: { rifle: 40 }, shots: 20, hits: 2, damage: 40,
      at: now, difficulty: "standard", mutators: [], mode: "campaign", activeMs: 60000, ...matchChanges }),
    ranking: JSON.stringify({ version: 1, mapId: "foundry", personalMs: 60000, full: true, eligible: true, team: null, ...evidence }),
    ...changes };
}
test("ranking windows use UTC day, Monday week, calendar month and existing season boundaries", () => {
  const edge = Date.UTC(2026, 10, 30) - 1;
  assert.notEqual(rankingPeriod("daily", edge), rankingPeriod("daily", edge + 1));
  assert.notEqual(rankingPeriod("weekly", edge), rankingPeriod("weekly", edge + 1));
  assert.notEqual(rankingPeriod("monthly", Date.UTC(2026, 11, 1) - 1), rankingPeriod("monthly", Date.UTC(2026, 11, 1)));
  assert.equal(rankingPeriod("season", now), seasonAt(now).id);
  assert.notEqual(rankingPeriod("season", seasonAt(now).endsAt - 1), rankingPeriod("season", seasonAt(now).endsAt));
  assert.equal(rankingPeriod("allTime", now), rankingPeriod("allTime", now + 86400000));
});
test("verified stats, accuracy, mission times and highest clear are derived from settled evidence", () => {
  const r = reward(), ranked = applyRankedResult(undefined, r), stats = ranked.lifetime;
  assert.equal(validReward(r), true); assert.equal(validRanking(ranked), true);
  assert.equal(stats.score, 750); assert.equal(stats.kills, 2); assert.equal(stats.revives, 1);
  assert.equal(stats.assists, 1); assert.equal(stats.objectiveScore, 100); assert.equal(stats.damage, 40);
  assert.equal(metricValue(stats, "accuracy"), 1000);
  assert.equal(metricValue(stats, "fastest", "foundry:campaign"), 60000);
  assert.equal(stats.highestDifficulty, 2);
  assert.equal(ranked.periods[rankingPeriod("daily", now)].score, stats.score);
});
test("legacy data is not backfilled and rollover preserves lifetime while retiring only expired ranking windows", () => {
  assert.equal(applyRankedResult(undefined, { ...reward(), ranking: undefined }), undefined);
  const first = applyRankedResult(undefined, reward());
  const later = applyRankedResult(first, reward({}, {}, { at: now + 90 * 86400000 }));
  assert.equal(later.lifetime.kills, 4); assert.equal(later.lifetime.matches, 2);
  assert.equal(Object.keys(later.periods).length, 4);
  assert.equal(later.periods[rankingPeriod("daily", now)], undefined);
  const recovered = applyRankedResult(later, reward());
  assert.equal(recovered.lifetime.kills, 6);
  assert.equal(recovered.periods[rankingPeriod("daily", now + 90 * 86400000)].kills, 2);
  assert.equal(validRanking(recovered), true);
});
test("short, idle, assisted and implausible results do not enter verified boards", () => {
  for (const r of [reward({}, { personalMs: 29999 }), reward({}, { eligible: false }),
    reward({ kills: 0, assists: 0, revives: 0, objectiveScore: 0 }, {}, { hits: 0 }),
    reward({}, {}, { shots: 10000 }), reward({}, {}, { damage: 401 }),
    reward({ kills: 19 }), reward({ revives: 31 }), reward({ xp: 100001 })]) {
    assert.equal(rankedEligibility(r).ok, false);
    assert.equal(applyRankedResult(undefined, r), undefined);
  }
  assert.equal(validReward(reward({ ranking: "{}" })), false);
  assert.equal(validReward(reward({}, { personalMs: 60001 })), false);
  assert.equal(rankedEligibility(reward({}, {}, { damage: 400 })).ok, true, "rallied sniper headshots are legitimate");
});
test("late joiners cannot set clear times/difficulty and mutators never mix into unmodified time records", () => {
  const late = applyRankedResult(undefined, reward({}, { full: false }));
  assert.equal(late.lifetime.wins, 0); assert.equal(late.lifetime.highestDifficulty, 0);
  assert.equal(metricValue(late.lifetime, "fastest"), null);
  const mutated = applyRankedResult(undefined, reward({}, {}, { mutators: ["iron"], difficulty: "nightmare" }));
  assert.equal(mutated.lifetime.highestDifficulty, 4); assert.equal(metricValue(mutated.lifetime, "fastest"), null);
  assert.equal(metricValue({ ...emptyRankStats(), shots: 19, hits: 19 }, "accuracy"), null);
});
test("squad member contributions aggregate but matches, wins and times count once", () => {
  const anchor = reward({}, { team: { tag: "CAPTAIN", anchor: true, size: 2 } });
  const member = reward({}, { team: { tag: "CAPTAIN", anchor: false, size: 2 } });
  const ranked = applyRankedResult(applyRankedResult(undefined, anchor, { team: true }), member, { team: true });
  assert.equal(ranked.lifetime.matches, 1); assert.equal(ranked.lifetime.wins, 1);
  assert.equal(ranked.lifetime.kills, 4); assert.equal(ranked.lifetime.score, 1250);
  assert.equal(validRanking(ranked), true);
});
test("saved records reject corrupt scores, windows, social references and unearned showcases", () => {
  assert.equal(validRecordMetadata({}), true);
  assert.equal(validRecordMetadata({ ranking: newRanking(now) }), true);
  for (const change of [{ ranking: { ...newRanking(now), lifetime: { ...emptyRankStats(), hits: 1 } } },
    { social: { friends: ["SECRET-FULL-IDENTITY"], incoming: [], squadTag: null } }, { showcase: ["nightmare"] }]) {
    assert.equal(validRecordMetadata(change), false);
  }
  assert.equal(validSquads({}), true);
  assert.equal(validSquads({ ABC: { tag: "ABC", name: "Team ABC", active: true, members: ["ABC"], invites: [], ranking: newRanking(now) } }), true);
  assert.equal(validSquads({ ABC: { tag: "ABC", name: "Bad", active: true, members: [], invites: [], ranking: newRanking(now) } }), false);
});
test("ranking filters and social commands reject score submission, private identity selectors and spam", () => {
  const input = { period: "monthly", metric: "score", scope: "friends" };
  assert.equal(validRankingQuery(input), true);
  for (const request of [{ ...input, identity: "private" }, { ...input, period: "yesterday" }, { ...input, offset: -1 }, { ...input, route: "fake:campaign" }]) assert.equal(validRankingQuery(request), false);
  let at = 0; const guard = createCommandGuard({ now: () => at });
  for (const packet of [["publicProfile", { identity: "private" }], ["socialStatus", { tag: "OTHER" }],
    ["socialAction", { action: "friendAccept", tag: "OTHER", owner: "private" }],
    ["rankings", { ...input, score: 10000 }], ["profileShowcase", { badges: ["not-earned"] }]]) assert.equal(guard.check(packet, false).ok, false);
  const limiter = createCommandGuard({ now: () => at });
  for (let i = 0; i < 8; i++) assert.equal(limiter.check(["rankings", input], false).ok, true);
  assert.equal(limiter.check(["rankings", input], false).ok, false);
  at = 500; assert.equal(limiter.check(["rankings", input], false).ok, true);
});
test("profile/social markup exposes real controls and treats unknown historical statistics explicitly", () => {
  const profile = { playerTag: "ABC", username: "<invalid>", level: 1, rank: null, prestige: 0, xp: 0,
    lifetimeKills: 0, lifetimeAssists: 0, lifetimeRevives: 0, lifetimeObjectiveScore: 0, favoriteWeaponId: null,
    squad: null, stats: null, badges: [], showcase: [], self: true };
  assert.match(operatorMarkup(profile), /Historical detailed statistics are unavailable/);
  assert.match(operatorMarkup(profile), /&lt;invalid&gt;/);
  assert.match(operatorMarkup(profile), /showcaseForm/);
  const social = socialMarkup({ playerTag: "ABC", friends: [], incoming: [{ playerTag: "DEF", username: "Peer" }],
    outgoing: [], squad: null, invitations: [] });
  for (const text of ["friendForm", "friendAccept", "friendDecline", "squadForm"]) assert.ok(social.includes(text));
});
test("friends, squads, public profiles, rankings and duplicate receipts persist without leaking identities", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deadlight-records-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const code = `
    import assert from "node:assert/strict";
    import {getProfile,updateUsername} from "./server/store.js";
    import {socialAction,socialStatus,publicProfile,readRankings,matchSquadFor,setShowcase} from "./server/records.js";
    import {commitReward} from "./server/rewards.js";
    const a=${JSON.stringify(a)},b=${JSON.stringify(b)};
    let at=${now}; Date.now=()=>at;
    getProfile(a);getProfile(b);updateUsername(a,"Alpha");updateUsername(b,"Bravo");
    const action=(id,input)=>{const r=socialAction(id,input);assert.equal(r.ok,true,r.error);return r;};
    action(a,{action:"friendRequest",tag:"BBBBBBBB"});
    assert.equal(socialStatus(b).incoming[0].playerTag,"AAAAAAAA");
    assert.equal(readRankings(a,{period:"allTime",metric:"score",scope:"friends"}).total,0);
    action(b,{action:"friendAccept",tag:"AAAAAAAA"});
    action(a,{action:"squadCreate",name:"Verified squad"});
    action(a,{action:"squadInvite",tag:"BBBBBBBB"});action(b,{action:"squadAccept",tag:"AAAAAAAA"});
    assert.equal(matchSquadFor([a,b]).tag,"AAAAAAAA");
    assert.equal(matchSquadFor([a,a]),null);
    const r=${JSON.stringify(reward())};
    r.identity=a;r.ranking=JSON.stringify({...JSON.parse(r.ranking),team:{tag:"AAAAAAAA",anchor:true,size:2}});
    await commitReward(r);await commitReward(r);
    const peer={...r,id:"22222222-2222-4222-8222-222222222222",identity:b,
      ranking:JSON.stringify({...JSON.parse(r.ranking),team:{tag:"AAAAAAAA",anchor:false,size:2}})};
    await commitReward(peer);
    const board=readRankings(a,{period:"allTime",metric:"score",scope:"squads"});
    assert.equal(board.entries[0].matches,1);assert.equal(board.self.value,1250);
    assert.equal(readRankings(a,{period:"allTime",metric:"accuracy",scope:"friends"}).total,2);
    assert.equal(setShowcase(a,["nightmare"]).ok,false);
    assert.equal(setShowcase(a,["firstBlood"]).ok,true);
    const p=publicProfile(b,"AAAAAAAA").profile;
    assert.equal(p.favoriteWeaponId,"rifle");assert.equal(p.self,false);
    for(const key of ["id","social","incoming","friends","tokens","ownedWeapons","career"])assert.equal(Object.hasOwn(p,key),false);
    assert.equal(JSON.stringify(p).includes(a),false);
    const before=getProfile(a).ranking.lifetime;
    at+=90*86400000;
    assert.equal(readRankings(a,{period:"daily",metric:"kills",scope:"global"}).total,0);
    assert.deepEqual(getProfile(a).ranking.lifetime,before);
    action(a,{action:"squadLeave"});
    assert.equal(socialStatus(b).squad,null);
    assert.equal(readRankings(a,{period:"allTime",metric:"score",scope:"squads"}).entries[0].archived,true);
    console.log(JSON.stringify({profile:getProfile(a),social:socialStatus(b)}));
  `;
  const run = (script) => spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: path.resolve("."), env: { ...process.env, DATA_DIR: directory, IDENTITY_SECRET: "", PERSISTENCE_BACKEND: "file" }, encoding: "utf8" });
  const first = run(code);
  assert.equal(first.status, 0, first.stderr);
  const restarted = run(`import {getProfile} from "./server/store.js";import {socialStatus} from "./server/records.js";console.log(JSON.stringify({profile:getProfile(${JSON.stringify(a)}),social:socialStatus(${JSON.stringify(b)})}));`);
  assert.equal(restarted.status, 0, restarted.stderr);
  assert.deepEqual(JSON.parse(restarted.stdout), JSON.parse(first.stdout));
});

test("ranking sort ties, pagination, clock/cache invalidation and a large synthetic request stay deterministic", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deadlight-ranking-load-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const script = `
    import assert from "node:assert/strict";
    import {initializePersistence,transaction} from "./server/persistence.js";
    await initializePersistence();
    const {getProfile,savePlayerRecords,updateUsername}=await import("./server/store.js");
    const {readRankings,publicProfile}=await import("./server/records.js");
    let at=${now};Date.now=()=>at;
    const ranking=${JSON.stringify(applyRankedResult(undefined, reward()))};
    const records=Object.fromEntries(Array.from({length:1000},(_,i)=>{
      const id=i.toString(16).padStart(8,"0")+"-1111-4111-8111-111111111111";
      return [id,{id,username:"Operator "+String(i).padStart(4,"0"),xp:100,matches:1,totalKills:2,ranking}];
    }));
    savePlayerRecords(records);
    const id=Object.keys(records)[999],query={period:"daily",metric:"score",scope:"global"};
    const begin=performance.now();
    const first=await transaction(()=>readRankings(id,query));
    const cold=performance.now()-begin, warmStart=performance.now();
    const repeat=await transaction(()=>readRankings(id,query));
    const warm=performance.now()-warmStart;
    assert.deepEqual(repeat,first);assert.equal(first.self.rank,1000);assert.equal(first.entries.length,20);
    assert.equal(first.nextOffset,20);assert.equal(first.entries[0].username,"Operator 0000");
    const last=await transaction(()=>readRankings(id,{...query,offset:999999}));
    assert.equal(last.offset,980);assert.equal(last.nextOffset,null);
    await transaction(()=>updateUsername(id,"AAA leader"));
    assert.equal((await transaction(()=>readRankings(id,query))).self.rank,1);
    at+=86400000;
    assert.equal((await transaction(()=>readRankings(id,query))).total,0);
    assert.equal((await transaction(()=>readRankings(id,{...query,period:"allTime"}))).total,1000);
    await assert.rejects(transaction(()=>{
      savePlayerRecords({[id]:{...getProfile(id),ranking:{version:1,since:0,lifetime:{},periods:{}}}});
    }),/Invalid/);
    assert.equal((await transaction(()=>readRankings(id,{...query,period:"allTime"}))).total,1000);
    const profileStart=performance.now();await transaction(()=>publicProfile(id));
    console.log(JSON.stringify({profiles:1000,coldMs:cold,warmMs:warm,profileMs:performance.now()-profileStart}));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: path.resolve("."), env: { ...process.env, DATA_DIR: directory, IDENTITY_SECRET: "", PERSISTENCE_BACKEND: "file" }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  console.log("Synthetic ranked request:", result.stdout.trim());
});
