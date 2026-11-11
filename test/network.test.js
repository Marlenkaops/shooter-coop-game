import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { io } from "socket.io-client";
import { hashAdminPassword } from "../server/admin-login.js";
import { canOccupyPosition } from "../shared/gameplay.js";
import { createStaffAccess } from "../server/staff-access.js";
import { classLevelXp, newCareer, periodFor, seasonAt } from "../shared/career.js";

const portForTest = async () => {
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address();
  listener.close();
  await once(listener, "close");
  return port;
};

function signedToken(id, secret) {
  const payload = Buffer.from(JSON.stringify({ playerId: id, issuedAt: Date.now() })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function request(socket, event, ...args) {
  if (event === "adminSignIn" && args[0]?.username && args[0]?.password && args[0].code === undefined &&
    socket.verificationCodes?.length) args = [{ ...args[0], code: socket.verificationCodes[0] }];
  return new Promise((resolve, reject) => {
    socket.timeout(2000).emit(event, ...args, (error, reply) => {
      if (error) return reject(error);
      if (event === "adminSignIn" && reply.ok && args[0]?.code !== undefined && args[0].code === socket.verificationCodes?.[0]) socket.verificationCodes.shift();
      resolve(reply);
    });
  });
}

function stateMatching(socket, predicate) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("state", receive);
      reject(new Error("Expected room state did not arrive"));
    }, 2000);
    function receive(state) {
      if (!predicate(state)) return;
      clearTimeout(timer);
      socket.off("state", receive);
      resolve(state);
    }
    socket.on("state", receive);
  });
}

async function serverFixture(t, configuration = {}, savedPlayers = {}, directory = path.resolve("."), sourceSuffix = "") {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "last-light-network-"));
  if (Object.keys(savedPlayers).length) fs.writeFileSync(path.join(dataDir, "players.json"), JSON.stringify(savedPlayers));
  const port = await portForTest();
  const secret = crypto.randomBytes(32).toString("hex");
  const staff = createStaffAccess(dataDir), codeQueues = new Map();
  const allowlisted = (configuration.ADMIN_PLAYER_IDS || "").split(",").filter(Boolean);
  const passwordUsers = configuration.ADMIN_LOGIN_USER ? Array.from({ length: 6 }, () => crypto.randomUUID()) : [];
  for (const [id, role] of [...allowlisted.map((id) => [id, "admin"]), ...passwordUsers.map((id) => [id, "owner"])]) {
    assert.equal(staff.setRole(id, role).ok, true);
    codeQueues.set(id, staff.issue(id).codes);
  }
  let nextPasswordUser = 0;
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) if (/^(AZURE_|TABLES_|COSMOS_|STAFF_ACCESS_)/.test(key)) delete environment[key];
  delete environment.ADMIN_LOGIN_USER;
  delete environment.ADMIN_LOGIN_PASSWORD_HASH;
  delete environment.CLIENT_IP_SOURCE;
  delete environment.CONTAINER_APP_NAME;
  delete environment.CONTAINER_APP_ENV_DNS_SUFFIX;
  delete environment.MAINTENANCE_MODE;
  const command = sourceSuffix ? ["--input-type=module", "-e", `
    import { registerHooks } from "node:module";
    import { pathToFileURL } from "node:url";
    const entry = pathToFileURL(process.cwd() + "/server/index.js").href;
    registerHooks({ load(url, context, next) {
      const loaded = next(url, context);
      return url === entry ? { ...loaded, source: String(loaded.source) + ${JSON.stringify(sourceSuffix)} } : loaded;
    } });
    await import(entry);
  `] : ["server/index.js"];
  const start = () => spawn(process.execPath, command, {
    cwd: directory,
    env: { ...environment, HOST: "127.0.0.1", PERSISTENCE_BACKEND: "file", DATA_DIR: dataDir, IDENTITY_SECRET: secret,
      ADMIN_PLAYER_IDS: "", ADMIN_SIGN_IN: "password+code", PORT: String(port), NODE_ENV: "production", ...configuration },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let child = start();
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const sockets = [];
  t.after(async () => {
    sockets.forEach((socket) => socket.disconnect());
    if (child.exitCode === null) {
      child.kill();
      await once(child, "exit");
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  async function waitReady() {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (child.exitCode !== null) throw new Error(`Game server exited early: ${stderr}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`);
        ready = response.ok;
        if (ready) break;
      } catch {
        // Connection refused while the child process starts.
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.ok(ready, `Game server did not start: ${stderr}`);
  }
  await waitReady();

  const connect = async (token, extraHeaders = {}) => {
    if (!token && nextPasswordUser < passwordUsers.length) token = signedToken(passwordUsers[nextPasswordUser++], secret);
    const socket = io(`http://127.0.0.1:${port}`, {
      auth: { token, admin: true, owner: true }, autoConnect: false, transports: ["websocket"], reconnection: false, extraHeaders
    });
    sockets.push(socket);
    const identity = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error("Identity response timed out.")); }, 2000);
      const accepted = (value) => { cleanup(); resolve(value); };
      const denied = (error) => { cleanup(); reject(error); };
      function cleanup() {
        clearTimeout(timer);
        socket.off("identity", accepted);
        socket.off("connect_error", denied);
      }
      socket.once("identity", accepted);
      socket.once("connect_error", denied);
    });
    socket.connect();
    const accepted = await identity;
    socket.verificationCodes = codeQueues.get(accepted.profile.id);
    if (allowlisted.includes(accepted.profile.id)) {
      const result = await request(socket, "adminSignIn", { code: socket.verificationCodes[0] });
      assert.equal(result.ok, true, result.error);
      Object.assign(accepted, { admin: result.admin, owner: result.owner, canLogout: result.canLogout });
    }
    return { socket, identity: accepted };
  };
  async function restart() {
    sockets.forEach((socket) => socket.disconnect());
    child.kill();
    await once(child, "exit");
    child = start();
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    await waitReady();
  }
  return { connect, secret, dataDir, restart, origin: `http://127.0.0.1:${port}` };
}

test("guarded live shots destroy shared cover, reject client health and preserve its hole for late joins", { timeout: 15000 }, async (t) => {
  const lateId = crypto.randomUUID();
  const { connect, secret } = await serverFixture(t, { ADMIN_PLAYER_IDS: lateId }, {}, path.resolve("."), `
    const fixtureProps = await import("../shared/destructibles.js");
    setInterval(() => {
      for (const room of rooms.values()) if (room.phase === "playing" && !room.propsPrepared) {
        room.propsPrepared = true;
        const prop = fixtureProps.destructibleLayout(room.mapId)[0];
        const original = [...room.enemies.values()][0];
        room.enemies.clear();
        room.enemies.set("break-target", {...original,id:"break-target",position:{x:prop.x,y:prop.base+1,z:prop.z-3},
          health:10000,maxHealth:10000,speed:0,damage:0,staggerUntil:Date.now()+60000});
        for (const member of room.players.values()) {
          Object.assign(member,{position:{x:prop.x,y:prop.base+1.57,z:prop.z+3},yaw:0,pitch:0});
          io.to(member.socketId).emit("movementCorrection",{position:member.position,crouching:false});
        }
        io.to(room.code).emit("state",publicState(room));
      }
    },20).unref();
  `);
  const lead = await connect(), peer = await connect();
  const created = await request(lead.socket, "createRoom", { mapId: "foundry" });
  await request(peer.socket, "joinRoom", { code: created.code });
  const prepared = stateMatching(lead.socket, (s) => s.enemies.some((enemy) => enemy.id === "break-target"));
  await request(lead.socket, "startMatch");
  const initial = await prepared;
  assert.equal(initial.props[0].health, 80);
  const direction = { x: 0, y: 0, z: -1 };
  assert.equal((await request(lead.socket, "shoot", { direction, health: 0, propId: initial.props[0].id })).ok, false);
  const destroyed = stateMatching(peer.socket, (s) => s.props[0].health === 0);
  for (let count = 0; count < 4; count++) {
    const result = await request(lead.socket, "shoot", { direction });
    assert.equal(result.rays[0].propId, initial.props[0].id);
    assert.equal(result.hit, false);
    await new Promise((resolve) => setTimeout(resolve, 170));
  }
  const shared = await destroyed;
  assert.equal(shared.enemies[0].health, 10000);
  assert.equal((await request(lead.socket, "shoot", { direction })).hit, true);
  lead.socket.disconnect();
  const guest = await connect();
  assert.equal((await request(guest.socket, "joinRoom", { code: created.code })).ok, false, "active admission rules remain intact");
  const late = await connect(signedToken(lateId, secret)), arrived = stateMatching(late.socket, (s) => s.players.some((p) => p.socketId === late.socket.id));
  const joining = await request(late.socket, "joinRoom", { code: created.code });
  assert.equal(joining.ok, true, joining.error);
  const snapshot = await arrived;
  assert.equal(snapshot.props[0].health, 0);
  assert.deepEqual(Object.keys(snapshot.props[0]).sort(), ["health", "id"]);
  assert.equal("geometry" in snapshot, false);
});

test("quick match only joins opted-in eligible lobbies and leaves coded fireteams private", { timeout: 15000 }, async (t) => {
  const { connect } = await serverFixture(t);
  const privateLead = await connect(), first = await connect(), second = await connect();
  const privateRoom = await request(privateLead.socket, "createRoom", { mapId: "foundry", name: "Private Lead" });
  assert.equal(privateRoom.ok, true);
  const publicRoom = await request(first.socket, "quickMatch", { mapId: "foundry", name: "Public Lead" });
  assert.equal(publicRoom.ok, true, publicRoom.error);
  assert.notEqual(publicRoom.code, privateRoom.code);
  const joining = stateMatching(first.socket, (state) => state.players.length === 2);
  const joined = await request(second.socket, "quickMatch", { mapId: "foundry", name: "Public Peer" });
  assert.equal(joined.code, publicRoom.code);
  assert.equal((await joining).players.length, 2);
  assert.equal((await request(second.socket, "startMatch")).ok, false, "only the lead starts the squad");
  assert.equal((await request(first.socket, "startMatch")).ok, true);
  const late = await connect();
  const next = await request(late.socket, "quickMatch", { mapId: "foundry", name: "Late Peer" });
  assert.equal(next.ok, true);
  assert.notEqual(next.code, publicRoom.code, "active operations never admit random players");
  assert.notEqual(next.code, privateRoom.code);
  const duplicate = await request(late.socket, "quickMatch", { mapId: "foundry", name: "Late Peer" });
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.error, /already in a fireteam/);
});

test("quick match enforces mode, map clearance, payload validation and four-player capacity", { timeout: 15000 }, async (t) => {
  const { connect } = await serverFixture(t);
  const clients = [];
  for (let index = 0; index < 5; index++) clients.push(await connect());
  for (const payload of [
    { mapId: "range", mode: "practice" }, { mapId: "foundry", mode: "ffa" },
    { mapId: "void", mode: "campaign" }, { mapId: "foundry", matchmaking: true }
  ]) assert.equal((await request(clients[0].socket, "quickMatch", payload)).ok, false);
  const codes = [];
  for (const [index, client] of clients.entries()) {
    const reply = await request(client.socket, "quickMatch", { mapId: "foundry", name: `Squad Mate ${index}` });
    assert.equal(reply.ok, true, reply.error);
    codes.push(reply.code);
  }
  assert.equal(new Set(codes.slice(0, 4)).size, 1);
  assert.notEqual(codes[4], codes[0]);
});

test("tactical difficulty survives join and launch, and matchmaking separates tiers", { timeout: 15000 }, async (t) => {
  const { connect } = await serverFixture(t);
  const lead = await connect(), peer = await connect(), veteran = await connect(), standard = await connect();
  const first = await request(lead.socket, "quickMatch", { mapId: "foundry", difficulty: "recruit" });
  assert.equal(first.ok, true);
  const received = stateMatching(lead.socket, (state) => state.players.length === 2);
  assert.equal((await request(peer.socket, "joinRoom", { code: first.code })).ok, true);
  assert.equal((await received).difficulty, "recruit");
  const harder = await request(veteran.socket, "quickMatch", { mapId: "foundry", difficulty: "veteran" });
  const normal = await request(standard.socket, "quickMatch", { mapId: "foundry" });
  assert.notEqual(harder.code, first.code);
  assert.notEqual(normal.code, first.code);
  assert.notEqual(normal.code, harder.code);
  assert.equal((await request(peer.socket, "startMatch")).ok, false);
  const started = once(peer.socket, "matchStarted");
  assert.equal((await request(lead.socket, "startMatch")).ok, true);
  const [snapshot] = await started;
  assert.equal(snapshot.difficulty, "recruit");
  assert.deepEqual(snapshot.director, { phase: "buildup" });
  assert.ok(snapshot.enemies.every((enemy) => enemy.role && enemy.squadId));
  assert.equal("enemyContacts" in snapshot, false);
  assert.equal((await request(veteran.socket, "createRoom", { mapId: "foundry", difficulty: "veteran", health: 1 })).ok, false);
  assert.equal((await request(standard.socket, "createRoom", { mapId: "foundry", mode: "ffa", difficulty: "veteran" })).ok, false);
});

test("first mastery unlock comes from actual guarded shots and survives restart without client XP claims", { timeout: 15000 }, async (t) => {
  const { connect, restart } = await serverFixture(t, {}, {}, path.resolve("."), `
    setInterval(() => {
      for (const room of rooms.values()) if (room.phase === "playing" && !room.careerPrepared) {
        room.careerPrepared = true;
        const member = [...room.players.values()][0], original = [...room.enemies.values()][0];
        room.enemies.clear();
        for (const id of ["1001","1002"]) room.enemies.set(id, {...original,id,
          position:{x:member.position.x,y:1,z:5},health:20,maxHealth:20,speed:0,damage:0});
        io.to(room.code).emit("state",publicState(room));
      }
    },20).unref();
    io.on("connection",(socket)=>socket.on("shoot",()=>setImmediate(()=>{
      const room=rooms.get(socket.data.roomCode),member=room?.players.get(socket.id);
      if(member?.kills===2){member.health=0;member.deadUntil=Date.now()+4000;}
    })));
  `);
  const first = await connect(), began = Date.now();
  assert.equal((await request(first.socket, "equipProgression", { kind: "attachment", id: "grip", weaponId: "rifle" })).ok, false);
  assert.equal((await request(first.socket, "claimProgression", {
    type: "challenge", key: "daily-kills", period: periodFor("daily")
  })).ok, false);
  assert.equal((await request(first.socket, "createRoom", { mapId: "foundry" })).ok, true);
  const prepared = stateMatching(first.socket, (s) => s.enemies.some((e) => e.id === "1001"));
  await request(first.socket, "startMatch");
  await prepared;
  assert.equal((await request(first.socket, "shoot", { direction: { x: 0, y: -.1, z: -.995 }, xp: 10000 })).ok, false);
  assert.equal((await request(first.socket, "shoot", { direction: { x: 0, y: -.1, z: -.995 } })).killed, true);
  await new Promise((resolve) => setTimeout(resolve, 180));
  const ended = once(first.socket, "matchEnded");
  assert.equal((await request(first.socket, "shoot", { direction: { x: 0, y: -.1, z: -.995 } })).killed, true);
  await ended;
  const status = await request(first.socket, "careerStatus");
  assert.equal(status.profile.career.weaponXp.rifle, 40);
  assert.ok(status.profile.career.achievements.includes("firstBlood"));
  assert.ok(Date.now() - began < 600000);
  const equip = await request(first.socket, "equipProgression", { kind: "attachment", id: "grip", weaponId: "rifle" });
  assert.equal(equip.ok, true, equip.error);
  await restart();
  const restored = await connect(first.identity.token);
  assert.equal(restored.identity.profile.career.weaponXp.rifle, 40);
  assert.equal(restored.identity.profile.career.loadouts.rifle.attachmentId, "grip");
});

test("registered squads settle authoritative ranked shots once and expose only public records after restart", { timeout: 15000 }, async (t) => {
  const { connect, restart } = await serverFixture(t, {}, {}, path.resolve("."), `
    setInterval(() => {
      for (const room of rooms.values()) if (room.phase === "playing" && !room.recordsPrepared) {
        room.recordsPrepared = true; room.wave = 5; room.startedAt = Date.now() - 60000;
        const original = [...room.enemies.values()][0];
        room.enemies.clear();
        [...room.players.values()].forEach((p,index)=>{
          p.rankingJoinedAt = room.startedAt;
          room.enemies.set(String(1001+index),{...original,id:String(1001+index),
            position:{x:p.position.x,y:1,z:5},health:20,maxHealth:20,speed:0,damage:0});
        });
        io.to(room.code).emit("state",publicState(room));
      }
    },20).unref();
  `);
  let lead = await connect(), peer = await connect();
  const leadToken = lead.identity.token, peerToken = peer.identity.token;
  const a = lead.identity.profile.id.slice(0, 8).toUpperCase(), b = peer.identity.profile.id.slice(0, 8).toUpperCase();
  const act = async (client, input) => {
    const result = await request(client.socket, "socialAction", input); assert.equal(result.ok, true, result.error); return result;
  };
  await act(lead, { action: "friendRequest", tag: b });
  assert.equal((await request(peer.socket, "socialStatus")).incoming[0].playerTag, a);
  await act(peer, { action: "friendAccept", tag: a });
  await act(lead, { action: "squadCreate", name: "Socket squad" });
  await act(lead, { action: "squadInvite", tag: b });
  await act(peer, { action: "squadAccept", tag: a });
  const room = await request(lead.socket, "createRoom", { mapId: "foundry" });
  assert.equal((await request(peer.socket, "joinRoom", { code: room.code })).ok, true);
  const prepared = stateMatching(lead.socket, (s) => s.enemies.some((e) => e.id === "1001"));
  await request(lead.socket, "startMatch"); const state = await prepared;
  assert.equal(JSON.stringify(state).includes(lead.identity.profile.id), false);
  assert.equal(Object.hasOwn(state, "rankedSquad"), false);
  assert.equal((await request(lead.socket, "socialAction", { action: "squadLeave" })).ok, false);
  assert.equal((await request(peer.socket, "rankings", { period: "allTime", metric: "score", scope: "global", kills: 999 })).ok, false);
  assert.equal((await request(lead.socket, "shoot", { direction: { x: 0, y: -.1, z: -.995 } })).killed, true);
  const ended = once(peer.socket, "matchEnded");
  assert.equal((await request(peer.socket, "shoot", { direction: { x: 0, y: -.1, z: -.995 } })).killed, true);
  const [results] = await ended;
  assert.ok(results.rewards.every((r) => r.ranked && !Object.hasOwn(r, "ranking") && !Object.hasOwn(r, "identity")));
  const query = { period: "allTime", metric: "score", scope: "squads" };
  const board = await request(lead.socket, "rankings", query);
  assert.equal(board.self.matches, 1); assert.equal(board.self.value, 450);
  const profile = (await request(peer.socket, "publicProfile", { tag: a })).profile;
  assert.equal(profile.stats.kills, 1); assert.equal(profile.stats.highestDifficulty, 2);
  for (const field of ["friends", "social", "id", "tokens", "career"]) assert.equal(Object.hasOwn(profile, field), false);
  assert.equal((await request(peer.socket, "socialStatus", { tag: a })).ok, false);
  await restart(); lead = await connect(leadToken); peer = await connect(peerToken);
  assert.deepEqual(await request(lead.socket, "rankings", query), board);
  assert.equal((await request(peer.socket, "socialStatus")).friends[0].playerTag, a);
  assert.equal((await request(lead.socket, "profileShowcase", { badges: ["firstBlood"] })).ok, true);
  assert.equal((await request(lead.socket, "profileShowcase", { badges: ["nightmare"] })).ok, false);
});

test("career claims, real loadout effects and endgame gates work across two identities and durable retry", { timeout: 15000 }, async (t) => {
  const id = crypto.randomUUID(), peerId = crypto.randomUUID(), c = newCareer();
  c.weaponXp.rifle = 1000; c.classXp.assault = classLevelXp(3); c.prestigeXp = 20000;
  c.periods[periodFor("daily")] = { kills: 12, team: 0, wins: 1, claimed: [] };
  c.seasons[seasonAt().id] = { xp: 4500, claimed: [] };
  const { connect, secret, restart } = await serverFixture(t, {}, {
    [id]: { id, xp: 10000, tokens: 0, career: c },
    [peerId]: { id: peerId, xp: 10000, tokens: 0 }
  });
  const lead = await connect(signedToken(id, secret)), peer = await connect(signedToken(peerId, secret)), fresh = await connect();
  assert.equal((await request(fresh.socket, "createRoom", { mapId: "foundry", difficulty: "nightmare" })).ok, false);
  assert.equal((await request(lead.socket, "equipProgression", { kind: "finish", id: "aurora", weaponId: "rifle" })).ok, false);
  const challenge = { type: "challenge", key: "daily-kills", period: periodFor("daily") };
  const claimed = await request(lead.socket, "claimProgression", challenge);
  assert.equal(claimed.profile.xp, 10150);
  const twice = await request(lead.socket, "claimProgression", challenge);
  assert.equal(twice.profile.xp, 10150);
  assert.equal(twice.alreadyClaimed, true);
  assert.equal((await request(lead.socket, "claimProgression", { ...challenge, tokens: 999 })).ok, false);
  assert.equal((await request(lead.socket, "claimProgression", { type: "season", key: "4", period: seasonAt().id })).ok, true);
  assert.equal((await request(lead.socket, "equipProgression", { kind: "finish", id: "aurora", weaponId: "rifle" })).ok, true);
  assert.equal((await request(lead.socket, "equipProgression", { kind: "attachment", id: "quick", weaponId: "rifle" })).ok, true);
  assert.equal((await request(lead.socket, "equipProgression", { kind: "attachment", id: "quick", weaponId: "smg" })).ok, false);
  assert.equal((await request(lead.socket, "equipProgression", { kind: "perk", id: "loader" })).ok, true);
  const created = await request(lead.socket, "createRoom", { mapId: "foundry", difficulty: "nightmare", mutators: ["scarcity", "iron"] });
  assert.equal(created.ok, true, created.error);
  assert.equal((await request(fresh.socket, "joinRoom", { code: created.code })).ok, false);
  assert.equal((await request(peer.socket, "joinRoom", { code: created.code })).ok, true);
  const started = once(peer.socket, "matchStarted");
  await request(lead.socket, "startMatch");
  const [snapshot] = await started, operator = snapshot.players.find((p) => p.socketId === lead.socket.id);
  assert.equal(operator.reserve, 60);
  assert.equal(operator.attachmentId, "quick");
  assert.equal(operator.finishId, "aurora");
  assert.equal(operator.perkId, "loader");
  assert.equal(JSON.stringify(snapshot).includes("weaponXp"), false);
  assert.equal((await request(lead.socket, "equipProgression", { kind: "attachment", id: "grip", weaponId: "rifle" })).ok, false);
  await request(lead.socket, "shoot", { direction: { x: 0, y: 0, z: -1 } });
  const reloading = await request(lead.socket, "reload");
  assert.equal(reloading.duration, Math.round(1650 * .9 * .9));
  assert.match((await request(lead.socket, "useMedkit")).error, /mutator/);
  await restart();
  const restored = await connect(lead.identity.token);
  assert.equal(restored.identity.profile.tokens, 110);
  assert.equal(restored.identity.profile.career.loadouts.rifle.finishId, "aurora");
  assert.equal((await request(restored.socket, "claimProgression", challenge)).profile.tokens, 110);
});

test("co-op class saves, held revives, combos, pings and teamwork result rewards use real guarded sockets", { timeout: 20000 }, async (t) => {
  const { connect, restart } = await serverFixture(t, {}, {}, path.resolve("."), `
    const teamFixture = await import("./teamwork.js");
    const teamRules = await import("../shared/gameplay.js");
    setInterval(() => {
      for (const room of rooms.values()) if (room.mode === "operation" && room.phase === "playing" && !room.testPrepared) {
        room.testPrepared = true; room.enemies.clear();
        const members = [...room.players.values()];
        for (const [index, member] of members.entries()) {
          member.position = teamRules.groundedPosition(room.mapId, {x:-3+index*1.5,z:20},1.57);
          member.protectedUntil = 0; member.lastMove = Date.now(); member.health = 100;
        }
        teamFixture.damageOperator(room, members[0], 200, Date.now());
        io.to(room.code).emit("state",publicState(room));
      }
    },20).unref();
    io.on("connection", (socket) => socket.on("teamPing", (input) => {
      const room = rooms.get(socket.data.roomCode);
      if (room?.testPrepared && input.kind === "route" && input.position?.z === 16 && !room.testExtraction) {
        room.testExtraction = true;
        room.teamObjective = teamFixture.createTeamObjective(room.mapId,3);
        room.wave = 4;
        for (const member of room.players.values()) member.position = teamRules.groundedPosition(room.mapId,room.teamObjective.position,1.57);
      }
    }));
  `);
  const lead = await connect(), peer = await connect();
  assert.equal((await request(lead.socket, "selectClass", "medic")).profile.classId, "medic");
  assert.equal((await request(peer.socket, "selectClass", "engineer")).ok, true);
  const room = await request(lead.socket, "createRoom", { mapId: "foundry", mode: "operation" });
  assert.equal(room.ok, true, room.error);
  assert.equal((await request(peer.socket, "joinRoom", { code: room.code })).ok, true);
  const downed = stateMatching(peer.socket, (state) => state.players.some((player) => player.downedUntil));
  assert.equal((await request(lead.socket, "startMatch")).ok, true);
  const initial = await downed;
  const victim = initial.players.find((player) => player.socketId === lead.socket.id);
  assert.equal(victim.classId, "medic");
  assert.equal((await request(peer.socket, "selectClass", "recon")).ok, false);
  assert.equal((await request(lead.socket, "classAbility")).ok, false);
  assert.equal((await request(peer.socket, "classAbility", { damage: 999 })).ok, false);
  assert.equal((await request(peer.socket, "teamInteract", { targetId: victim.socketId, progress: 999 })).ok, false);
  assert.equal((await request(peer.socket, "classAbility")).ok, true);
  assert.equal((await request(peer.socket, "classAbility")).ok, false);
  const revived = stateMatching(peer.socket, (state) => state.players.some((player) => player.socketId === victim.socketId &&
    !player.downedUntil && player.health > 0) && state.players.some((player) => player.revives === 1));
  for (let index = 0; index < 8; index++) {
    assert.equal((await request(peer.socket, "teamInteract", victim.socketId)).ok, true);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const completed = await revived;
  assert.equal(completed.players.find((player) => player.socketId === peer.socket.id).teamXp, 25);
  assert.equal(JSON.stringify(completed).includes("contributors"), false);
  assert.equal((await request(peer.socket, "teamPing", { kind: "enemy", targetId: "forged" })).ok, false);
  const ended = once(peer.socket, "matchEnded");
  assert.equal((await request(lead.socket, "teamPing", { kind: "route", position: { x: -3, y: 0, z: 16 } })).ok, true);
  const [result] = await ended;
  assert.equal(result.won, true);
  const reward = result.rewards.find((entry) => entry.socketId === peer.socket.id);
  assert.equal(reward.revives, 1);
  assert.equal(reward.objectiveScore, 100);
  assert.ok(reward.teamXp >= 60 && reward.teamXp <= 250);
  const peerToken = peer.identity.token;
  await restart();
  const restored = await connect(peerToken);
  assert.equal(restored.identity.profile.classId, "engineer");
  assert.equal(restored.identity.profile.totalRevives, 1);
  assert.equal(restored.identity.profile.totalObjectiveScore, 100);
  assert.equal(restored.identity.profile.teamworkXp, reward.teamXp);
});

test("disconnect cancels a held revive, then a final standing disconnect resolves the downed squad", { timeout: 10000 }, async (t) => {
  const { connect } = await serverFixture(t, {}, {}, path.resolve("."), `
    const teamFixture = await import("./teamwork.js");
    const teamRules = await import("../shared/gameplay.js");
    setInterval(() => {
      for (const room of rooms.values()) if (room.mode === "operation" && room.phase === "playing" && !room.testPrepared) {
        room.testPrepared = true; room.enemies.clear();
        const members = [...room.players.values()];
        for (const [index, member] of members.entries()) {
          member.position = teamRules.groundedPosition(room.mapId,{x:-3+index,z:20},1.57);
          member.protectedUntil = 0;
        }
        teamFixture.damageOperator(room,members[0],200,Date.now());
      }
    },20).unref();
  `);
  const lead = await connect(), helper = await connect(), remaining = await connect();
  const room = await request(lead.socket, "createRoom", { mapId: "foundry", mode: "operation" });
  await request(helper.socket, "joinRoom", { code: room.code });
  await request(remaining.socket, "joinRoom", { code: room.code });
  const downed = stateMatching(lead.socket, (state) => state.players.some((player) => player.downedUntil));
  await request(lead.socket, "startMatch");
  await downed;
  const progressing = stateMatching(lead.socket, (state) => state.players.some((player) => player.reviveProgressMs > 0));
  await request(helper.socket, "teamInteract", lead.socket.id);
  await progressing;
  const cancelled = stateMatching(lead.socket, (state) => state.players.length === 2 &&
    state.players.some((player) => player.downedUntil && player.reviveProgressMs === 0));
  helper.socket.disconnect();
  await cancelled;
  const ended = once(lead.socket, "matchEnded");
  remaining.socket.disconnect();
  const [result] = await ended;
  assert.equal(result.won, false);
  assert.equal(result.rewards[0].revives, 0);
});

test("regroup movement is replicated, validated and retained when the next wave begins", { timeout: 10000 }, async (t) => {
  const { connect } = await serverFixture(t, {}, {}, path.resolve("."), `
    io.on("connection", (socket) => socket.on("startMatch", () => queueMicrotask(() => {
      const room = rooms.get(socket.data.roomCode);
      room.enemies.clear();
      room.phase = "between";
      room.countdown = Date.now() + 1000;
      io.to(room.code).emit("state", publicState(room));
    })));
  `);
  const first = await connect(), second = await connect();
  const room = await request(first.socket, "createRoom", { mapId: "foundry" });
  assert.equal((await request(second.socket, "joinRoom", { code: room.code })).ok, true);
  const regrouping = stateMatching(first.socket, (state) => state.phase === "between");
  assert.equal((await request(first.socket, "startMatch")).ok, true);
  const initial = await regrouping;
  const player = initial.players.find((member) => member.socketId === first.socket.id);
  const position = { ...player.position, z: player.position.z - .5 };
  let corrections = 0;
  first.socket.on("movementCorrection", () => { corrections++; });
  const moved = stateMatching(second.socket, (state) => state.phase === "between" &&
    state.players.find((member) => member.socketId === first.socket.id)?.position.z === position.z);
  first.socket.emit("move", { position, yaw: 0, pitch: 0, crouching: false });
  assert.deepEqual((await moved).players.find((member) => member.socketId === first.socket.id).position, position);
  assert.equal(corrections, 0);
  const corrected = once(first.socket, "movementCorrection");
  first.socket.emit("move", { position: { ...position, x: 41 }, yaw: 0, pitch: 0, crouching: false });
  assert.deepEqual((await corrected)[0].position, position, "intermissions do not bypass movement validation");
  const next = await stateMatching(second.socket, (state) => state.phase === "playing" && state.wave === 2);
  assert.deepEqual(next.players.find((member) => member.socketId === first.socket.id).position, position);
  const resumedPosition = { ...position, z: position.z - .5 };
  const resumed = stateMatching(second.socket, (state) =>
    state.players.find((member) => member.socketId === first.socket.id)?.position.z === resumedPosition.z);
  first.socket.emit("move", { position: resumedPosition, yaw: 0, pitch: 0, crouching: false });
  assert.deepEqual((await resumed).players.find((member) => member.socketId === first.socket.id).position, resumedPosition);
  assert.equal(corrections, 1, "only the intentional teleport attempt is corrected");
});

test("two-player sockets replicate validated crouching and corrections include the authoritative stance", async (t) => {
  const { connect } = await serverFixture(t);
  const first = await connect(), second = await connect();
  const room = await request(first.socket, "createRoom", { mapId: "foundry" });
  assert.equal((await request(second.socket, "joinRoom", { code: room.code })).ok, true);
  const started = once(first.socket, "matchStarted");
  assert.equal((await request(first.socket, "startMatch")).ok, true);
  const [state] = await started;
  const me = state.players.find((player) => player.socketId === first.socket.id);
  const crouched = stateMatching(second.socket, (next) =>
    next.players.find((player) => player.socketId === first.socket.id)?.crouching === true);
  const position = { ...me.position, y: me.position.y - .57 };
  first.socket.emit("move", { position, yaw: 0, pitch: 0, crouching: true });
  const peer = (await crouched).players.find((player) => player.socketId === first.socket.id);
  assert.equal(peer.position.y, position.y);
  const corrected = once(first.socket, "movementCorrection");
  first.socket.emit("move", { position: { ...position, x: 41 }, yaw: 0, pitch: 0, crouching: false });
  const [correction] = await corrected;
  assert.equal(correction.crouching, true);
  assert.deepEqual(correction.position, position);
});

test("container runtime includes and serves maintenance assets without the source checkout", { timeout: 15000 }, async (t) => {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "last-light-runtime-"));
  t.after(() => fs.rmSync(runtime, { recursive: true, force: true }));
  const dockerfile = fs.readFileSync("Dockerfile", "utf8");
  const runtimeStage = dockerfile.split(/^FROM .+$/m).at(-1);
  assert.match(runtimeStage, /^COPY public\/maintenance\.html public\/maintenance-range\.js public\/ui-theme\.css \.\/public\/$/m);
  for (const directory of ["server", "shared"]) fs.cpSync(directory, path.join(runtime, directory), { recursive: true });
  fs.copyFileSync("package.json", path.join(runtime, "package.json"));
  fs.symlinkSync(path.resolve("node_modules"), path.join(runtime, "node_modules"), "dir");
  fs.mkdirSync(path.join(runtime, "dist"));
  for (const filename of ["index.html", "privacy.html"]) fs.copyFileSync(path.join("dist", filename), path.join(runtime, "dist", filename));
  fs.mkdirSync(path.join(runtime, "public"));
  for (const filename of ["maintenance.html", "maintenance-range.js", "ui-theme.css"]) {
    fs.copyFileSync(path.join("public", filename), path.join(runtime, "public", filename));
  }
  const configuration = { MAINTENANCE_MODE: "true" };
  const { connect, origin, restart } = await serverFixture(t, configuration, {}, runtime);
  const entry = await fetch(origin);
  assert.equal(entry.status, 503);
  assert.match(await entry.text(), /Stay frosty\./);
  for (const filename of ["maintenance.html", "maintenance-range.js", "ui-theme.css"]) {
    const response = await fetch(`${origin}/${filename}`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), fs.readFileSync(path.join(runtime, "public", filename), "utf8"));
  }
  assert.deepEqual(await (await fetch(`${origin}/api/maintenance`)).json(), { enabled: true });
  assert.equal((await fetch(`${origin}/privacy.html`)).status, 200);
  await assert.rejects(connect(), (error) => error.data?.code === "MAINTENANCE");
  configuration.MAINTENANCE_MODE = "false";
  await restart();
  assert.equal((await fetch(origin)).status, 200);
  assert.ok((await connect()).identity.token);
});

test("maintenance locks HTTP and cached WebSocket clients, preserves public support routes and reopens explicitly", { timeout: 15000 }, async (t) => {
  const configuration = { MAINTENANCE_MODE: "false" };
  const { connect, origin, restart, dataDir } = await serverFixture(t, configuration);
  const player = await connect();
  const token = player.identity.token;
  assert.equal((await request(player.socket, "createRoom", { mapId: "foundry", mode: "campaign", name: "Ranger Alpha" })).ok, true);
  configuration.MAINTENANCE_MODE = "true";
  await restart();
  for (const entry of ["/", "/?v=old", "/index.html", "/standalone.html", "/other-page"]) {
    const response = await fetch(`${origin}${entry}`);
    assert.equal(response.status, 503, entry);
    assert.equal(response.headers.get("retry-after"), "15");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(await response.text(), /Stay frosty\./);
  }
  assert.deepEqual(await (await fetch(`${origin}/api/maintenance`)).json(), { enabled: true });
  assert.equal((await fetch(`${origin}/api/health`)).status, 200);
  assert.equal((await fetch(`${origin}/privacy.html`)).status, 200);
  assert.equal((await fetch(`${origin}/maintenance.html`)).status, 200);
  const challenge = await fetch(`${origin}/maintenance-range.js`);
  assert.equal(challenge.status, 200);
  assert.match(challenge.headers.get("content-type"), /javascript/);
  assert.equal((await fetch(`${origin}/api/ban-appeals`, { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ token, reason: "Please review my ban." }) })).status, 403);
  await assert.rejects(connect(token), (error) => error.data?.code === "MAINTENANCE");
  await assert.rejects(connect(), (error) => error.data?.code === "MAINTENANCE");
  const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, "players.json")));
  assert.equal(Object.keys(persisted).length, 1, "denied visitors do not create or alter profiles");
  await restart();
  assert.deepEqual(await (await fetch(`${origin}/api/maintenance`)).json(), { enabled: true });
  configuration.MAINTENANCE_MODE = "false";
  await restart();
  assert.deepEqual(await (await fetch(`${origin}/api/maintenance`)).json(), { enabled: false });
  assert.equal((await fetch(`${origin}/`)).status, 200);
  const restored = await connect(token);
  assert.equal(restored.identity.profile.id, player.identity.profile.id);
  assert.equal((await request(restored.socket, "createRoom", { mapId: "foundry", mode: "campaign", name: "Ranger Alpha" })).ok, true);
});

test("worldwide leaderboards include offline players and bind your rank to your signed identity", { timeout: 12000 }, async (t) => {
  const ids = Array.from({ length: 25 }, () => crypto.randomUUID());
  const players = Object.fromEntries(ids.map((id, index) => [id, {
    id, username: `Global ${index}`, xp: (25 - index) * 100, totalKills: index, matches: 1,
    tokens: 1000, ownedWeapons: ["rifle"], privateField: "never-publish"
  }]));
  const { connect, secret, restart } = await serverFixture(t, {}, players);
  const token = signedToken(ids[24], secret);
  let viewer = await connect(token);
  const xp = await request(viewer.socket, "leaderboard", { sort: "xp" });
  assert.equal(xp.ok, true);
  assert.equal(xp.entries.length, 20);
  assert.equal(xp.entries[0].username, "Global 0");
  assert.equal(xp.self.rank, 25);
  assert.equal(xp.nextOffset, 20);
  assert.equal(xp.total, 25);
  const kills = await request(viewer.socket, "leaderboard", { sort: "kills", offset: 20 });
  assert.equal(kills.self.rank, 1);
  assert.equal(kills.entries[0].totalKills, 4);
  assert.equal(kills.nextOffset, null);
  assert.equal(JSON.stringify(xp).includes(ids[0]), false);
  assert.equal(JSON.stringify(xp).includes("never-publish"), false);
  assert.equal(Object.hasOwn(xp.entries[0], "tokens"), false);
  for (const input of [{ sort: "xp", xp: 999999 }, { sort: "xp", playerId: ids[0] }]) {
    assert.match((await request(viewer.socket, "leaderboard", input)).error, /Invalid command/);
  }
  await restart();
  viewer = await connect(token);
  assert.deepEqual(await request(viewer.socket, "leaderboard", { sort: "xp" }), xp);
  const newcomer = await connect();
  assert.equal((await request(newcomer.socket, "leaderboard", {})).self, null);
});

test("leaderboards report invalid saved scores as an error without disconnecting players", { timeout: 8000 }, async (t) => {
  const { connect } = await serverFixture(t, {}, { broken: { id: "broken", xp: 100, totalKills: -3 } });
  const player = await connect();
  const result = await request(player.socket, "leaderboard", {});
  assert.equal(result.ok, false);
  assert.match(result.error, /Leaderboard unavailable/);
  assert.equal(player.socket.connected, true);
});

for (const kind of ["player", "ip"]) test(`${kind} ban appeals work while disconnected and only verified admins can review them`, { timeout: 18000 }, async (t) => {
  const staffId = crypto.randomUUID();
  const { connect, secret, origin, restart } = await serverFixture(t, { ADMIN_PLAYER_IDS: staffId, CLIENT_IP_SOURCE: "azure" });
  const headers = (ip) => ({ "x-forwarded-for": ip });
  const staffToken = signedToken(staffId, secret);
  let staff = await connect(staffToken, headers("192.0.2.10"));
  const guest = await connect(undefined, headers("192.0.2.20"));
  const outsider = await connect(undefined, headers("192.0.2.30"));
  const room = await request(staff.socket, "createRoom", { mapId: "foundry" });
  await request(guest.socket, "joinRoom", { code: room.code });
  const report = await request(staff.socket, "reportPlayer", { playerId: guest.socket.id, reason: "Disrupting the squad repeatedly" });
  assert.equal((await request(staff.socket, "adminBanReport", { reportId: report.id, kind, duration: "1d" })).ok, true);
  await assert.rejects(connect(guest.identity.token, headers("192.0.2.20")), /banned/);
  const submit = (body, ip = "192.0.2.20") => fetch(`${origin}/api/ban-appeals`, {
    method: "POST", headers: { ...headers(ip), "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  assert.equal((await submit({ reason: "I should not be allowed to appeal someone else's ban." }, "192.0.2.40")).status, 403);
  assert.equal((await submit({ token: `${guest.identity.token}forged`, reason: "A forged token must not work." }, "192.0.2.40")).status, 403);
  assert.equal((await submit({ token: guest.identity.token, reason: "Please review this ban.", banId: "forged" }, "192.0.2.50")).status, 400);
  const body = { token: kind === "player" ? guest.identity.token : null, reason: "I was disconnected and did not mean to disrupt the match." };
  const sent = await submit(body);
  assert.equal(sent.status, 200);
  assert.deepEqual(await sent.json(), { ok: true, status: "open", alreadySubmitted: false });
  assert.equal((await (await submit(body)).json()).alreadySubmitted, true);
  const pending = await request(staff.socket, "adminAppeals", {});
  assert.equal(pending.total, 1);
  const appeal = pending.appeals[0];
  assert.equal(appeal.reason, body.reason);
  assert.equal(appeal.kind, kind);
  assert.equal(appeal.banReason, "Disrupting the squad repeatedly");
  assert.equal(Object.hasOwn(appeal, "key"), false);
  assert.equal((await request(outsider.socket, "adminAppeals", {})).ok, false);
  assert.equal((await request(outsider.socket, "adminReviewAppeal", { id: appeal.id, status: "approved" })).ok, false);
  assert.equal((await request(staff.socket, "adminReviewAppeal", { id: appeal.id, status: "approved", owner: true })).ok, false);
  await restart();
  staff = await connect(staffToken, headers("192.0.2.10"));
  assert.equal((await request(staff.socket, "adminAppeals", {})).appeals[0].reason, body.reason);
  if (kind === "player") {
    assert.equal((await request(staff.socket, "adminBanReport", { reportId: report.id, kind: "ip" })).ok, true);
  }
  assert.equal((await request(staff.socket, "adminReviewAppeal", { id: appeal.id, status: "approved" })).ok, true);
  assert.equal((await request(staff.socket, "adminReviewAppeal", { id: appeal.id, status: "rejected" })).ok, false);
  assert.equal((await request(staff.socket, "adminAppeals", { status: "approved" })).total, 1);
  if (kind === "player") {
    await assert.rejects(connect(guest.identity.token, headers("192.0.2.20")), /banned/);
    const remaining = (await request(staff.socket, "adminBans", {})).bans;
    assert.equal(remaining.length, 1, "approval removes only the appealed ban");
    assert.equal(remaining[0].kind, "ip");
    assert.equal((await request(staff.socket, "adminUnban", remaining[0].id)).ok, true);
  }
  assert.equal((await connect(guest.identity.token, headers("192.0.2.20"))).identity.profile.id, guest.identity.profile.id);
  assert.equal((await request(staff.socket, "adminBanReport", { reportId: report.id, kind })).ok, true);
  assert.equal((await (await submit(body)).json()).alreadySubmitted, false, "a new ban can receive a new appeal");
  const second = (await request(staff.socket, "adminAppeals", {})).appeals[0];
  assert.equal((await request(staff.socket, "adminReviewAppeal", { id: second.id, status: "rejected" })).ok, true);
  await assert.rejects(connect(guest.identity.token, headers("192.0.2.20")), /banned/);
  assert.equal((await (await submit(body)).json()).status, "rejected");
});

test("appeal HTTP failures are explicit and unbanned connections cannot flood the inbox", { timeout: 12000 }, async (t) => {
  const { origin } = await serverFixture(t);
  const post = (body) => fetch(`${origin}/api/ban-appeals`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body
  });
  assert.equal((await post("{bad json")).status, 400);
  assert.equal((await post(JSON.stringify({ reason: "x".repeat(9000) }))).status, 400);
  for (let i = 0; i < 3; i++) assert.equal((await post(JSON.stringify({ reason: "Please remove a nonexistent ban." }))).status, 403);
  const limited = await post(JSON.stringify({ reason: "Please remove a nonexistent ban." }));
  assert.equal(limited.status, 429);
  assert.match((await limited.json()).error, /Wait one minute/);
});

test("appeal submission and approval surface storage failures and recover without removing unrelated bans", { timeout: 12000 }, async (t) => {
  const staffId = crypto.randomUUID();
  const { connect, secret, origin, dataDir } = await serverFixture(t, { ADMIN_PLAYER_IDS: staffId });
  const staff = await connect(signedToken(staffId, secret));
  const guest = await connect();
  assert.equal((await request(staff.socket, "adminCommand", `?ban ${guest.identity.profile.id} Unfair play`)).ok, true);
  const blockAppeals = path.join(dataDir, "ban-appeals.json.next");
  fs.mkdirSync(blockAppeals);
  const submit = () => fetch(`${origin}/api/ban-appeals`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: guest.identity.token, reason: "Please check the evidence for this ban." }) });
  const failed = await submit();
  assert.equal(failed.status, 503);
  assert.match((await failed.json()).error, /could not be confirmed/);
  assert.equal((await request(staff.socket, "adminAppeals", {})).total, 0);
  fs.rmdirSync(blockAppeals);
  assert.equal((await submit()).status, 200);
  const appeal = (await request(staff.socket, "adminAppeals", {})).appeals[0];
  const blockBans = path.join(dataDir, "bans.json.next");
  fs.mkdirSync(blockBans);
  assert.equal((await request(staff.socket, "adminReviewAppeal", { id: appeal.id, status: "approved" })).ok, false);
  assert.equal((await request(staff.socket, "adminAppeals", {})).total, 1);
  await assert.rejects(connect(guest.identity.token), /banned/);
  fs.rmdirSync(blockBans);
  fs.mkdirSync(blockAppeals);
  assert.equal((await request(staff.socket, "adminReviewAppeal", { id: appeal.id, status: "approved" })).ok, false);
  assert.equal((await request(staff.socket, "adminAppeals", {})).total, 1, "failed review remains retryable even if removal already saved");
  fs.rmdirSync(blockAppeals);
  assert.equal((await request(staff.socket, "adminReviewAppeal", { id: appeal.id, status: "approved" })).ok, true);
  assert.equal((await connect(guest.identity.token)).identity.profile.id, guest.identity.profile.id);
});

test("a solo practice session validates map pairing, guns, resets and never persists combat rewards", { timeout: 16000 }, async (t) => {
  const { connect } = await serverFixture(t);
  const first = await connect();
  const second = await connect();
  const before = first.identity.profile;
  for (const input of [{ mapId: "range", mode: "campaign" }, { mapId: "foundry", mode: "practice" }]) {
    assert.equal((await request(first.socket, "createRoom", input)).ok, false);
  }
  assert.equal((await request(first.socket, "practiceWeapon", "rifle")).ok, false);
  const created = await request(first.socket, "createRoom", { mapId: "range", mode: "practice" });
  assert.equal(created.ok, true);
  assert.match((await request(second.socket, "joinRoom", { code: created.code })).error, /solo/);
  const started = once(first.socket, "matchStarted");
  assert.equal((await request(first.socket, "startMatch")).ok, true);
  const [state] = await started;
  const me = state.players[0], target = state.enemies[0];
  assert.equal(state.enemies.length, 12);
  assert.equal(me.unlimitedAmmo, true);
  assert.equal((await request(first.socket, "practiceWeapon", "sniper")).ok, false);
  assert.equal((await request(first.socket, "practiceWeapon", "rifle")).ok, true);
  assert.equal((await request(first.socket, "practiceWeapon", { weaponId: "rifle" })).ok, false);
  const dx = target.position.x - me.position.x, dy = target.position.y + .9 - me.position.y;
  const dz = target.position.z - me.position.z, distance = Math.hypot(dx, dy, dz);
  const direction = { x: dx / distance, y: dy / distance, z: dz / distance };
  const yaw = Math.atan2(-dx, -dz), pitch = Math.asin(dy / distance);
  const aimed = stateMatching(first.socket, (value) => value.players[0].yaw === yaw);
  first.socket.emit("move", { position: me.position, yaw, pitch });
  await aimed;
  await new Promise((resolve) => setTimeout(resolve, 160));
  const shot = await request(first.socket, "shoot", { direction });
  assert.equal(shot.killed, true);
  const reset = await stateMatching(first.socket, (value) => value.enemies[0].health === 35);
  assert.equal(reset.phase, "playing");
  assert.deepEqual(reset.players[0].practiceStats, { shots: 1, hits: 1, headshots: 1, targets: 1 });
  assert.equal(reset.players[0].kills, 0);
  assert.equal(reset.loot.length + reset.supplies.length, 0);
  assert.equal((await request(first.socket, "reload")).ok, true);
  const reloaded = await stateMatching(first.socket, (value) => value.players[0].ammo === 24 && !value.players[0].reloading);
  assert.equal(reloaded.players[0].reserve, 120);
  assert.equal((await request(first.socket, "advanceCampaign")).ok, false);
  first.socket.disconnect();
  const returned = await connect(first.identity.token);
  assert.deepEqual(returned.identity.profile, before);
});

test("Raid launches with a squad, rejects forged objectives and medkit state, and broadcasts actual inventory", { timeout: 12000 }, async (t) => {
  const { connect } = await serverFixture(t);
  const first = await connect(), second = await connect();
  assert.equal((await request(first.socket, "useMedkit")).ok, false);
  assert.equal((await request(first.socket, "raidInteract", "raid-cache")).ok, false);
  const created = await request(first.socket, "createRoom", { mapId: "foundry", mode: "raid" });
  assert.equal(created.ok, true);
  assert.equal((await request(second.socket, "joinRoom", { code: created.code })).ok, true);
  assert.equal((await request(first.socket, "useMedkit")).ok, false);
  const started = once(first.socket, "matchStarted"), joined = once(second.socket, "matchStarted");
  assert.equal((await request(first.socket, "startMatch")).ok, true);
  const [[state], [peer]] = await Promise.all([started, joined]);
  assert.equal(state.mode, "raid");
  assert.equal(state.raid.stage, 0);
  assert.equal(state.raid.requiredMs, 12000);
  assert.equal(state.players.length, 2);
  assert.ok(state.players.every((player) => player.medkits === 1));
  assert.deepEqual(peer.raid, state.raid);
  assert.equal((await request(first.socket, "useMedkit", { health: 100, medkits: 99 })).ok, false);
  assert.equal((await request(first.socket, "useMedkit")).ok, false, "full health must not consume a medkit");
  assert.equal((await request(first.socket, "raidInteract", { stage: 2 })).ok, false);
  assert.equal((await request(first.socket, "raidInteract", "raid-cache")).ok, false);
  assert.equal((await request(first.socket, "advanceCampaign")).ok, false);
  const unchanged = await stateMatching(second.socket, (value) => value.mode === "raid");
  assert.equal(unchanged.raid.stage, 0);
  assert.ok(unchanged.players.every((player) => player.medkits === 1 && player.health === 100));
});

test("commands enforce verified ownership, private one-use codes, flight, staff tags, announcements and bans", { timeout: 20000 }, async (t) => {
  const username = "command-owner", password = "command-owner-fixture-password", adminId = crypto.randomUUID();
  const { connect, secret } = await serverFixture(t, {
    ADMIN_PLAYER_IDS: adminId, ADMIN_LOGIN_USER: username, ADMIN_LOGIN_PASSWORD_HASH: await hashAdminPassword(password)
  });
  const owner = await connect(), staff = await connect(signedToken(adminId, secret));
  const guest = await connect(signedToken(crypto.randomUUID(), secret));
  const outsider = await connect(signedToken(crypto.randomUUID(), secret));
  assert.equal((await request(owner.socket, "adminCommand", "?help")).ok, false);
  assert.equal((await request(owner.socket, "adminSignIn", {})).ok, false);
  const consumed = owner.socket.verificationCodes[0];
  assert.equal((await request(owner.socket, "adminSignIn", { username, password })).owner, true);
  await request(owner.socket, "adminSignOut");
  assert.equal((await request(owner.socket, "adminSignIn", { username, password, code: consumed })).ok, false);
  assert.equal((await request(owner.socket, "adminSignIn", { username, password })).owner, true);
  assert.equal((await request(owner.socket, "adminCommand", "?help")).lines.filter((line) => line.startsWith("?")).length, 7);
  assert.equal((await request(staff.socket, "adminCommand", `?role ${guest.identity.profile.id} owner`)).ok, false);
  assert.equal((await request(staff.socket, "adminCommand", `?codes ${guest.identity.profile.id}`)).ok, false);
  assert.equal((await request(owner.socket, "adminCommand", `?role ${guest.identity.profile.id} co-owner`)).ok, true);
  const codes = await request(owner.socket, "adminCommand", `?codes ${guest.identity.profile.id}`);
  assert.equal(codes.codes.length, 3);
  guest.socket.verificationCodes = [...codes.codes];
  assert.equal((await request(outsider.socket, "adminSignIn", { username, password: "wrong-password", code: codes.codes[0] })).ok, false);
  assert.equal((await request(guest.socket, "adminSignIn", { username, password })).owner, false);
  assert.equal((await request(guest.socket, "adminCommand", `?codes ${adminId}`)).ok, false);
  const room = await request(owner.socket, "createRoom", { mapId: "foundry" });
  await request(guest.socket, "joinRoom", { code: room.code });
  const started = once(guest.socket, "matchStarted");
  await request(owner.socket, "startMatch");
  const [state] = await started;
  assert.equal(state.players.find((player) => player.socketId === guest.socket.id).staffRole, "co-owner");
  const flying = stateMatching(guest.socket, (value) => value.players.find((player) => player.socketId === guest.socket.id)?.flying);
  assert.equal((await request(owner.socket, "adminCommand", `?fly ${guest.identity.profile.id} on`)).ok, true);
  const flight = await flying, me = flight.players.find((player) => player.socketId === guest.socket.id);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const climbed = stateMatching(guest.socket, (value) => value.players.find((player) => player.socketId === guest.socket.id)?.position.y === 7);
  guest.socket.emit("move", { position: { ...me.position, y: 7 }, yaw: 0, pitch: 0 });
  await climbed;
  assert.equal((await request(owner.socket, "adminCommand", `?fly ${guest.identity.profile.id} off`)).ok, true);
  const corrected = once(guest.socket, "movementCorrection");
  guest.socket.emit("move", { position: { ...me.position, y: 7.1 }, yaw: 0, pitch: 0 });
  assert.equal((await corrected)[0].position.y, 7);
  const announcement = once(guest.socket, "serverAnnouncement");
  assert.equal((await request(owner.socket, "adminCommand", "?announcement Welcome <b>operators</b>")).ok, true);
  const payload = await announcement;
  assert.equal(payload[0].text, "Welcome <b>operators</b>");
  assert.equal(payload[0].authorName, owner.identity.profile.username);
  assert.equal(payload[0].authorRole, "owner");
  assert.equal((await request(staff.socket, "adminCommand", `?ban ${guest.identity.profile.id}`)).ok, false);
  assert.equal((await request(owner.socket, "adminCommand", `?ban ${owner.identity.profile.id}`)).ok, false);
  const removed = once(outsider.socket, "disconnect");
  assert.equal((await request(owner.socket, "adminCommand", `?ban ${outsider.identity.profile.id} Command fixture moderation`)).ok, true);
  await removed;
  await assert.rejects(connect(outsider.identity.token), /banned/);
  const revoked = once(guest.socket, "adminStatus");
  const rotated = await request(owner.socket, "adminCommand", `?codes ${guest.identity.profile.id}`);
  assert.equal(rotated.codes.length, 3);
  assert.equal((await revoked)[0].admin, false);
  assert.equal((await request(guest.socket, "adminCommand", "?help")).ok, false);
  const newDevice = await connect(signedToken(crypto.randomUUID(), secret));
  const moved = await request(newDevice.socket, "adminSignIn", { username, password, code: rotated.codes[0] });
  assert.equal(moved.ok, true);
  assert.equal(moved.owner, false);
  assert.equal((await request(newDevice.socket, "adminCommand", "?help")).ok, true);
  assert.equal((await request(guest.socket, "adminSignIn", { username, password, code: rotated.codes[1] })).ok, true);
  assert.equal((await request(newDevice.socket, "adminCommand", "?help")).ok, false);
  const privateState = await stateMatching(owner.socket, (value) => value.phase === "playing");
  assert.ok(privateState.players.every((player) => !Object.hasOwn(player, "codes") && !Object.hasOwn(player, "staffRevision")));
});

test("code-only sign-in grants a staff code's role to any Operator ID and limits guesses per address", { timeout: 16000 }, async (t) => {
  const { connect, secret } = await serverFixture(t, {
    ADMIN_LOGIN_USER: "code-only-owner", ADMIN_LOGIN_PASSWORD_HASH: await hashAdminPassword("code-only-fixture-password"),
    ADMIN_SIGN_IN: "code", CLIENT_IP_SOURCE: "azure"
  });
  const original = await connect(undefined, { "x-forwarded-for": "192.0.2.40" });
  const codes = [...original.socket.verificationCodes];
  assert.equal(original.identity.adminPasswordRequired, false);
  assert.equal(original.identity.adminLoginAvailable, true);
  const fresh = await connect(signedToken(crypto.randomUUID(), secret), { "x-forwarded-for": "192.0.2.41" });
  assert.equal((await request(fresh.socket, "adminSignIn", { code: "12345" })).ok, false);
  const signedIn = await request(fresh.socket, "adminSignIn", { code: codes[0] });
  assert.equal(signedIn.ok, true, signedIn.error);
  assert.equal(signedIn.owner, true);
  assert.equal((await request(fresh.socket, "adminSignIn", { code: codes[0] })).ok, false);
  const guesser = await connect(signedToken(crypto.randomUUID(), secret), { "x-forwarded-for": "192.0.2.42" });
  for (let index = 0; index < 5; index++) await request(guesser.socket, "adminSignIn", { code: "000000" });
  const other = await connect(signedToken(crypto.randomUUID(), secret), { "x-forwarded-for": "192.0.2.42" });
  assert.match((await request(other.socket, "adminSignIn", { code: codes[1] })).error, /Too many/);
  assert.equal((await request(original.socket, "adminSignIn", { code: codes[1] })).owner, true);
});

test("password-only sign-in grants Owner to any identity with the configured login and no code", { timeout: 12000 }, async (t) => {
  const username = "password-only-owner", password = "password-only-fixture-password";
  const { connect, secret } = await serverFixture(t, {
    ADMIN_LOGIN_USER: username, ADMIN_LOGIN_PASSWORD_HASH: await hashAdminPassword(password), ADMIN_SIGN_IN: "password"
  });
  const player = await connect(signedToken(crypto.randomUUID(), secret));
  assert.equal(player.identity.adminPasswordRequired, true);
  assert.equal(player.identity.adminCodeRequired, false);
  assert.equal((await request(player.socket, "adminSignIn", { username, password: "wrong-password" })).ok, false);
  assert.equal((await request(player.socket, "adminCommand", "?help")).ok, false);
  const signedIn = await request(player.socket, "adminSignIn", { username, password });
  assert.equal(signedIn.ok, true, signedIn.error);
  assert.equal(signedIn.owner, true);
  assert.equal((await request(player.socket, "adminCommand", "?help")).ok, true);
  await request(player.socket, "adminSignOut");
  assert.equal((await request(player.socket, "adminCommand", "?help")).ok, false);
  assert.equal((await request(player.socket, "adminSignIn", { username, password })).owner, true);
});

test("only password-verified owners can ban administrators, including disconnected password administrators", { timeout: 16000 }, async (t) => {
  const staffId = crypto.randomUUID(), targetId = crypto.randomUUID();
  const username = "owner-fixture", password = "owner-fixture-password";
  const { connect, secret } = await serverFixture(t, { ADMIN_PLAYER_IDS: `${staffId},${targetId}`,
    ADMIN_LOGIN_USER: username, ADMIN_LOGIN_PASSWORD_HASH: await hashAdminPassword(password), CLIENT_IP_SOURCE: "azure" });
  const headers = (ip) => ({ "x-forwarded-for": ip });
  const staff = await connect(signedToken(staffId, secret), headers("192.0.2.10"));
  const target = await connect(signedToken(targetId, secret), headers("192.0.2.20"));
  const owner = await connect(undefined, headers("192.0.2.30"));
  assert.equal(staff.identity.admin, true); assert.equal(staff.identity.owner, false);
  assert.equal(owner.identity.owner, false);
  assert.equal((await request(owner.socket, "adminSignIn", { username, password })).owner, true);
  const room = await request(staff.socket, "createRoom", { mapId: "foundry" });
  await request(target.socket, "joinRoom", { code: room.code });
  await request(owner.socket, "joinRoom", { code: room.code });
  const report = await request(staff.socket, "reportPlayer", { playerId: target.socket.id, reason: "Report against staff member" });
  const input = { reportId: report.id, kind: "player" };
  assert.equal((await request(staff.socket, "adminReports", {})).reports[0].targetAdmin, true);
  for (const kind of ["player", "ip"]) {
    assert.match((await request(staff.socket, "adminBanReport", { ...input, kind })).error, /Only the server owner/);
  }
  assert.equal((await request(owner.socket, "adminBanReport", { ...input, owner: true })).ok, false);
  const removal = once(target.socket, "disconnect");
  assert.equal((await request(owner.socket, "adminBanReport", input)).ok, true);
  await removal;
  await assert.rejects(connect(target.identity.token, headers("192.0.2.20")), /banned/);
  const active = await request(owner.socket, "adminBans", {});
  await request(owner.socket, "adminUnban", active.bans[0].id);
  const returned = await connect(target.identity.token, headers("192.0.2.20"));
  assert.equal(returned.identity.admin, true); assert.equal(returned.identity.owner, false);
  const passwordAdmin = await connect(undefined, headers("192.0.2.40"));
  await request(passwordAdmin.socket, "adminSignIn", { username, password });
  await request(passwordAdmin.socket, "joinRoom", { code: room.code });
  const offlineReport = await request(owner.socket, "reportPlayer", {
    playerId: passwordAdmin.socket.id, reason: "Report against password administrator" });
  passwordAdmin.socket.disconnect();
  assert.match((await request(staff.socket, "adminBanReport", { reportId: offlineReport.id, kind: "player" })).error, /Only the server owner/);
  await request(owner.socket, "adminSignOut");
  assert.equal((await request(owner.socket, "adminBanReport", { reportId: offlineReport.id, kind: "player" })).ok, false);
  await request(owner.socket, "adminSignIn", { username, password });
  assert.equal((await request(owner.socket, "adminBanReport", { reportId: offlineReport.id, kind: "ip" })).ok, true);
  await assert.rejects(connect(passwordAdmin.identity.token, headers("192.0.2.40")), /banned/);
  const shared = await connect(undefined, headers("192.0.2.30"));
  await request(shared.socket, "joinRoom", { code: room.code });
  const selfReport = await request(shared.socket, "reportPlayer", { playerId: owner.socket.id, reason: "Claim against owner" });
  assert.equal(selfReport.ok, true);
  for (const kind of ["player", "ip"]) assert.match(
    (await request(owner.socket, "adminBanReport", { reportId: selfReport.id, kind })).error, /yourself/);
  const reporter = await connect(undefined, headers("192.0.2.50"));
  await request(reporter.socket, "joinRoom", { code: room.code });
  const sharedReport = await request(reporter.socket, "reportPlayer", { playerId: shared.socket.id, reason: "Shared network claim" });
  assert.equal(sharedReport.ok, true);
  assert.match((await request(owner.socket, "adminBanReport", { reportId: sharedReport.id, kind: "ip" })).error, /own connection/);
});

test("outfit purchases use server prices, sync identity sessions and lock equips during combat", { timeout: 12000 }, async (t) => {
  const { connect, dataDir, restart } = await serverFixture(t);
  let buyer = await connect();
  const id = buyer.identity.profile.id, token = buyer.identity.token;
  assert.equal((await request(buyer.socket, "buySkin", "nightwatch")).ok, false);
  const records = JSON.parse(fs.readFileSync(path.join(dataDir, "players.json")));
  records[id].tokens = 1000;
  fs.writeFileSync(path.join(dataDir, "players.json"), JSON.stringify(records));
  await restart();
  buyer = await connect(token);
  const duplicate = await connect(token);
  assert.equal((await request(buyer.socket, "buySkin", { skinId: "nightwatch", cost: 0 })).ok, false);
  assert.equal((await request(buyer.socket, "equipSkin", "nightwatch")).ok, false);
  const changed = once(duplicate.socket, "profile");
  const bought = await request(buyer.socket, "buySkin", "nightwatch");
  assert.equal(bought.profile.tokens, 880);
  assert.equal((await changed)[0].tokens, 880);
  assert.equal((await request(duplicate.socket, "buySkin", "nightwatch")).ok, false);
  const created = await request(buyer.socket, "createRoom", { mapId: "foundry" });
  const guest = await connect();
  await request(guest.socket, "joinRoom", { code: created.code });
  const next = stateMatching(guest.socket, (state) => state.players.some((player) =>
    player.socketId === buyer.socket.id && player.skinId === "nightwatch"));
  assert.equal((await request(buyer.socket, "equipSkin", "nightwatch")).ok, true);
  assert.ok((await next).players.every((player) => !Object.hasOwn(player, "ownedSkins") && !Object.hasOwn(player, "identity")));
  const started = once(guest.socket, "matchStarted");
  await request(buyer.socket, "startMatch");
  assert.equal((await started)[0].players.find((player) => player.socketId === buyer.socket.id).skinId, "nightwatch");
  assert.match((await request(duplicate.socket, "equipSkin", "standard")).error, /locked/);
  assert.equal((await request(buyer.socket, "buySkin", "glacier")).profile.tokens, 520);
  const block = path.join(dataDir, "players.json.next");
  fs.mkdirSync(block);
  assert.match((await request(buyer.socket, "buySkin", "copperline")).error, /storage unavailable/);
  fs.rmdirSync(block);
  await restart();
  const saved = (await connect(token)).identity.profile;
  assert.equal(saved.tokens, 520);
  assert.equal(saved.equippedSkinId, "nightwatch");
  assert.deepEqual(saved.ownedSkins, ["standard", "nightwatch", "glacier"]);
});

test("report player bans remove all sessions, block reconnects across restarts and permit explicit unban", { timeout: 12000 }, async (t) => {
  const staffId = crypto.randomUUID();
  const { connect, secret, dataDir, restart } = await serverFixture(t, { ADMIN_PLAYER_IDS: staffId });
  let staff = await connect(signedToken(staffId, secret));
  const guest = await connect(), duplicate = await connect(guest.identity.token), outsider = await connect();
  const created = await request(staff.socket, "createRoom", { mapId: "foundry" });
  await request(guest.socket, "joinRoom", { code: created.code });
  const reported = await request(staff.socket, "reportPlayer", { playerId: guest.socket.id, reason: "Deliberate abusive behaviour" });
  assert.equal(reported.ok, true);
  const input = { reportId: reported.id, kind: "player" };
  for (const [event, value] of [["adminBanReport", input], ["adminBans", {}], ["adminUnban", reported.id]]) {
    assert.equal((await request(outsider.socket, event, value)).ok, false);
  }
  assert.equal((await request(staff.socket, "adminBanReport", { ...input, playerId: outsider.identity.profile.id })).ok, false);
  assert.equal((await request(staff.socket, "adminBanReport", { ...input, reportId: crypto.randomUUID() })).ok, false);
  const removed = [once(guest.socket, "banned"), once(duplicate.socket, "banned")];
  const disconnected = [once(guest.socket, "disconnect"), once(duplicate.socket, "disconnect")];
  assert.equal((await request(staff.socket, "adminBanReport", input)).ok, true);
  for (const [notice] of await Promise.all(removed)) {
    assert.deepEqual({ ...notice, at: 0 }, { kind: "player", reason: "Deliberate abusive behaviour", at: 0, until: null });
  }
  await Promise.all(disconnected);
  assert.equal(guest.socket.connected, false);
  assert.equal((await request(staff.socket, "adminOverview")).rooms[0].players, 1);
  await assert.rejects(connect(guest.identity.token), (error) => error.data?.code === "BANNED" &&
    error.data.ban.reason === "Deliberate abusive behaviour" && error.data.ban.until === null &&
    Object.keys(error.data.ban).sort().join() === "at,kind,reason,until");
  assert.equal((await request(staff.socket, "adminBanReport", input)).ok, false);
  const listed = await request(staff.socket, "adminReports", {});
  assert.equal(listed.reports[0].playerBanned, true);
  assert.equal(Object.hasOwn(listed.reports[0], "targetAddressHash"), false);
  assert.equal((await connect()).identity.admin, false, "another identity on the same IP is not player-banned");
  await restart();
  await assert.rejects(connect(guest.identity.token), /banned/);
  staff = await connect(signedToken(staffId, secret));
  const active = await request(staff.socket, "adminBans", {});
  assert.equal(active.total, 1);
  assert.equal(active.bans[0].targetId, guest.identity.profile.id);
  assert.equal(Object.hasOwn(active.bans[0], "key"), false);
  assert.equal((await request(staff.socket, "adminUnban", active.bans[0].id)).ok, true);
  assert.equal((await connect(guest.identity.token)).identity.profile.id, guest.identity.profile.id);
  assert.equal((await request(staff.socket, "adminBanReport", { ...input, duration: "99y" })).ok, false);
  const temporary = await request(staff.socket, "adminCommand", `?ban ${guest.identity.profile.id} 1h Spamming the chat`);
  assert.equal(temporary.ok, true, temporary.error);
  await assert.rejects(connect(guest.identity.token), (error) => error.data?.ban?.kind === "player" &&
    error.data.ban.until - error.data.ban.at === 3_600_000 && error.data.ban.reason === "Spamming the chat");
  assert.equal((await request(staff.socket, "adminBans", {})).bans[0].until > Date.now(), true);
  assert.ok(JSON.parse(fs.readFileSync(path.join(dataDir, "audit.json"))).entries.some((entry) => entry.action === "banPlayer"));
});

test("offline report IP bans block shared-address identities, ignore spoofed prefixes and survive restarts", { timeout: 12000 }, async (t) => {
  const staffId = crypto.randomUUID();
  const fixture = await serverFixture(t, { ADMIN_PLAYER_IDS: staffId, CLIENT_IP_SOURCE: "azure" });
  const { connect, secret, dataDir, restart } = fixture;
  const headers = (ip) => ({ "x-forwarded-for": `198.51.100.99, ${ip}` });
  let staff = await connect(signedToken(staffId, secret), headers("192.0.2.10"));
  const guest = await connect(undefined, headers("192.0.2.20"));
  const shared = await connect(undefined, headers("192.0.2.20"));
  const unrelated = await connect(undefined, headers("192.0.2.30"));
  const created = await request(staff.socket, "createRoom", { mapId: "foundry" });
  await request(guest.socket, "joinRoom", { code: created.code });
  const reported = await request(staff.socket, "reportPlayer", { playerId: guest.socket.id, reason: "Severe targeted harassment" });
  guest.socket.disconnect();
  const removed = once(shared.socket, "banned");
  assert.equal((await request(staff.socket, "adminBanReport", { reportId: reported.id, kind: "ip", duration: "1d", reason: "Harassing other players" })).ok, true);
  const [notice] = await removed;
  assert.equal(notice.kind, "ip");
  assert.equal(notice.reason, "Harassing other players");
  assert.equal(notice.until - notice.at, 86_400_000);
  assert.equal(unrelated.socket.connected, true);
  for (const token of [undefined, guest.identity.token]) {
    await assert.rejects(connect(token, { "x-forwarded-for": "203.0.113.250, 192.0.2.20" }), /banned/);
  }
  assert.equal((await connect(guest.identity.token, headers("192.0.2.40"))).identity.profile.id, guest.identity.profile.id);
  const listing = await request(staff.socket, "adminReports", {});
  assert.equal(listing.reports[0].ipBanned, true);
  assert.equal(listing.reports[0].canBanIp, true);
  assert.ok(!JSON.stringify(listing).includes("192.0.2.20"));
  for (const file of ["reports.json", "bans.json", "audit.json"]) {
    assert.ok(!fs.readFileSync(path.join(dataDir, file), "utf8").includes("192.0.2.20"));
  }
  await restart();
  await assert.rejects(connect(undefined, headers("192.0.2.20")), /banned/);
  staff = await connect(signedToken(staffId, secret), headers("192.0.2.10"));
  const active = await request(staff.socket, "adminBans", {});
  assert.equal((await request(staff.socket, "adminUnban", active.bans[0].id)).ok, true);
  assert.equal((await connect(undefined, headers("192.0.2.20"))).identity.admin, false);
});

test("moderation protects administrators and shared admin IPs, handles legacy reports and refuses storage failures", { timeout: 12000 }, async (t) => {
  const staffId = crypto.randomUUID();
  const { connect, secret, dataDir, restart } = await serverFixture(t, { ADMIN_PLAYER_IDS: staffId });
  let staff = await connect(signedToken(staffId, secret)), guest = await connect();
  const created = await request(staff.socket, "createRoom", { mapId: "foundry" });
  await request(guest.socket, "joinRoom", { code: created.code });
  const againstStaff = await request(guest.socket, "reportPlayer", { playerId: staff.socket.id, reason: "Claim against an administrator" });
  for (const kind of ["player", "ip"]) {
    assert.equal((await request(staff.socket, "adminBanReport", { reportId: againstStaff.id, kind })).ok, false);
  }
  const againstGuest = await request(staff.socket, "reportPlayer", { playerId: guest.socket.id, reason: "Repeated abusive messages" });
  assert.match((await request(staff.socket, "adminBanReport", { reportId: againstGuest.id, kind: "ip" })).error, /shared/);
  const block = path.join(dataDir, "bans.json.next");
  fs.mkdirSync(block);
  assert.equal((await request(staff.socket, "adminBanReport", { reportId: againstGuest.id, kind: "player" })).ok, false);
  assert.equal(guest.socket.connected, true);
  assert.equal((await request(staff.socket, "adminBans", {})).total, 0);
  fs.rmdirSync(block);
  const savedReports = JSON.parse(fs.readFileSync(path.join(dataDir, "reports.json")));
  for (const report of savedReports) delete report.targetAddressHash;
  fs.writeFileSync(path.join(dataDir, "reports.json"), JSON.stringify(savedReports));
  await restart();
  staff = await connect(signedToken(staffId, secret));
  guest = await connect(guest.identity.token);
  const reports = await request(staff.socket, "adminReports", {});
  assert.equal(reports.reports.find((report) => report.id === againstGuest.id).canBanIp, false);
  assert.equal((await request(staff.socket, "adminBanReport", { reportId: againstGuest.id, kind: "ip" })).ok, false);
  const auditBlock = path.join(dataDir, "audit.json.next");
  fs.mkdirSync(auditBlock);
  assert.equal((await request(staff.socket, "adminBanReport", { reportId: againstGuest.id, kind: "player" })).ok, false);
  assert.equal(guest.socket.connected, true);
  fs.rmdirSync(auditBlock);
  const removed = once(guest.socket, "banned");
  assert.equal((await request(staff.socket, "adminBanReport", { reportId: againstGuest.id, kind: "player" })).ok, true);
  await removed;
  const active = await request(staff.socket, "adminBans", {});
  fs.mkdirSync(block);
  assert.equal((await request(staff.socket, "adminUnban", active.bans[0].id)).ok, false);
  await assert.rejects(connect(guest.identity.token), /banned/);
});

test("two-player rooms, ammo and admin room closure enforce server roles over the socket", { timeout: 12000 }, async (t) => {
  const adminId = crypto.randomUUID();
  const { connect, secret } = await serverFixture(t, { ADMIN_PLAYER_IDS: adminId });
  const leader = await connect(signedToken(adminId, secret));
  const guest = await connect(undefined);
  assert.notEqual(leader.identity.profile.id, guest.identity.profile.id);
  assert.notEqual(leader.identity.profile.username, guest.identity.profile.username);
  assert.equal(leader.identity.admin, true);
  assert.equal(guest.identity.admin, false);
  assert.equal(guest.identity.adminLoginAvailable, false);
  assert.equal((await request(guest.socket, "adminSignIn", { username: "unused", password: "unused" })).ok, false);
  assert.equal((await request(guest.socket, "adminOverview")).ok, false);
  assert.equal((await request(guest.socket, "adminKickPlayer", { code: "ABC123", playerId: leader.socket.id })).ok, false);
  assert.equal((await request(guest.socket, "advanceCampaign")).ok, false);
  assert.equal((await request(guest.socket, "buyWeapon", "sniper")).ok, false);
  const created = await request(leader.socket, "createRoom", { mapId: "foundry", name: "Lead" });
  assert.equal(created.ok, true);
  assert.equal((await request(leader.socket, "advanceCampaign")).ok, false);
  const duplicate = await connect(signedToken(adminId, secret));
  assert.equal((await request(duplicate.socket, "joinRoom", { code: created.code })).ok, false);
  const taken = await request(guest.socket, "joinRoom", { code: created.code, name: "lead" });
  assert.match(taken.error, /already in use/);
  assert.equal((await request(guest.socket, "joinRoom", { code: created.code, name: "<script>" })).ok, false);
  assert.equal((await request(guest.socket, "joinRoom", { code: created.code, name: "Wing" })).ok, true);
  assert.equal((await request(guest.socket, "adminCloseRoom", created.code)).ok, false);
  const started = once(guest.socket, "matchStarted");
  leader.socket.emit("startMatch");
  const [state] = await started;
  assert.equal(state.players.length, 2);
  assert.equal(state.players[0].playerTag, adminId.slice(0, 8).toUpperCase());
  assert.equal(state.players[1].playerTag, guest.identity.profile.id.slice(0, 8).toUpperCase());
  assert.ok(state.players.every((player) => !Object.hasOwn(player, "identity")));
  assert.equal(state.supplies.length, 2);
  assert.equal((await request(guest.socket, "useAmmoSupply", state.supplies[0].id)).ok, false);
  const overview = await request(leader.socket, "adminOverview");
  assert.equal(overview.ok, true);
  assert.equal(overview.rooms[0].players, 2);
  assert.deepEqual(overview.rooms[0].members.map((member) => member.name), ["Lead", "Wing"]);
  assert.deepEqual(overview.rooms[0].members.map((member) => member.playerId),
    [adminId, guest.identity.profile.id]);
  assert.equal(overview.rooms[0].members[0].leader, true);
  assert.equal((await request(leader.socket, "adminKickPlayer", null)).ok, false);
  assert.equal((await request(leader.socket, "adminKickPlayer",
    { code: created.code, playerId: "unknown" })).ok, false);
  const removedGuest = once(guest.socket, "roomClosed");
  assert.equal((await request(leader.socket, "adminKickPlayer",
    { code: created.code, playerId: guest.socket.id })).ok, true);
  assert.match((await removedGuest)[0], /removed/);
  assert.equal((await request(guest.socket, "useAmmoSupply", state.supplies[0].id)).ok, false);
  assert.equal((await request(leader.socket, "adminOverview")).rooms[0].players, 1);
  const closedLeader = once(leader.socket, "roomClosed");
  assert.equal((await request(leader.socket, "adminCloseRoom", created.code)).ok, true);
  assert.match((await closedLeader)[0], /administrator/);
  assert.deepEqual((await request(leader.socket, "adminOverview")).rooms, []);
});

test("lobby chat, leadership and removal are room-authorized; reports stay private and admin-reviewed", { timeout: 12000 }, async (t) => {
  const staffId = crypto.randomUUID(), { connect, secret, dataDir } = await serverFixture(t, { ADMIN_PLAYER_IDS: staffId });
  const staff = await connect(signedToken(staffId, secret)), guest = await connect(), outsider = await connect();
  const created = await request(staff.socket, "createRoom", { mapId: "foundry" });
  assert.equal((await request(guest.socket, "joinRoom", { code: created.code })).ok, true);
  assert.equal((await request(outsider.socket, "lobbyChat", "Outsider message")).ok, false);
  assert.equal((await request(outsider.socket, "reportPlayer", { playerId: staff.socket.id, reason: "Not in same room" })).ok, false);
  assert.equal((await request(guest.socket, "leaderKick", staff.socket.id)).ok, false);
  const broadcast = stateMatching(guest.socket, (state) => state.chat.some((message) => message.text === "<b>Hello squad</b>"));
  assert.equal((await request(staff.socket, "lobbyChat", "<b>Hello squad</b>")).ok, true);
  const state = await broadcast;
  assert.equal(state.chat[0].text, "<b>Hello squad</b>");
  assert.ok(!JSON.stringify(state).includes(staffId));
  assert.equal((await request(staff.socket, "lobbyChat", "Immediate repeat")).ok, false);
  const report = await request(guest.socket, "reportPlayer", { playerId: staff.socket.id, reason: "Claimed repeated wall shots" });
  assert.equal(report.ok, true);
  assert.deepEqual(Object.keys(report).sort(), ["id", "ok"]);
  assert.equal((await request(guest.socket, "adminReports", { status: "open" })).ok, false);
  const listing = await request(staff.socket, "adminReports", { status: "open" });
  assert.equal(listing.total, 1);
  assert.equal(listing.reports[0].reporterId, guest.identity.profile.id);
  assert.equal((await request(staff.socket, "adminReviewReport", { id: report.id, status: "dismissed" })).ok, true);
  assert.equal((await request(staff.socket, "adminReports", { status: "open" })).total, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, "reports.json")))[0].status, "dismissed");
  assert.equal((await request(staff.socket, "transferLeader", guest.socket.id)).ok, true);
  assert.equal((await request(staff.socket, "startMatch")).ok, false);
  const removed = once(staff.socket, "roomClosed");
  assert.equal((await request(guest.socket, "leaderKick", staff.socket.id)).ok, true);
  await removed;
  assert.equal((await request(staff.socket, "joinRoom", { code: created.code })).ok, false);
  const reconnect = await connect(signedToken(staffId, secret));
  assert.equal((await request(reconnect.socket, "joinRoom", { code: created.code })).ok, false);
  assert.equal((await request(staff.socket, "createRoom", { mapId: "foundry" })).ok, true, "a lobby kick is not an account ban");
});

test("FFA rejects low-XP creation, joining, replay and active admin admission without map-grant bypasses", { timeout: 12000 }, async (t) => {
  const staffId = crypto.randomUUID(), visitorId = crypto.randomUUID();
  const { connect, secret } = await serverFixture(t, { ADMIN_PLAYER_IDS: `${staffId},${visitorId}` });
  const staff = await connect(signedToken(staffId, secret)), guest = await connect(), visitor = await connect(signedToken(visitorId, secret));
  assert.equal((await request(staff.socket, "createRoom", { mapId: "foundry", mode: "ffa" })).ok, false);
  await request(staff.socket, "adminSetProgression", { playerId: staffId, operation: "unlockAll" });
  assert.equal((await request(staff.socket, "createRoom", { mapId: "foundry", mode: "ffa" })).ok, false);
  await request(staff.socket, "adminSetProgression", { playerId: staffId, operation: "setLevel", level: 5 });
  const created = await request(staff.socket, "createRoom", { mapId: "foundry", mode: "ffa" });
  assert.equal(created.ok, true);
  assert.equal((await request(staff.socket, "startMatch")).ok, false);
  assert.equal((await request(guest.socket, "joinRoom", { code: created.code })).ok, false);
  await request(staff.socket, "adminSetProgression", { playerId: guest.identity.profile.id, operation: "setLevel", level: 5 });
  assert.equal((await request(guest.socket, "joinRoom", { code: created.code })).ok, true);
  await request(staff.socket, "adminSetProgression", { playerId: guest.identity.profile.id, operation: "setLevel", level: 4 });
  assert.equal((await request(staff.socket, "startMatch")).ok, false, "launch rechecks changed profiles");
  await request(staff.socket, "adminSetProgression", { playerId: guest.identity.profile.id, operation: "setLevel", level: 5 });
  const started = once(guest.socket, "matchStarted");
  assert.equal((await request(staff.socket, "startMatch")).ok, true);
  assert.equal((await started)[0].enemies.length, 0);
  assert.equal((await request(staff.socket, "transferLeader", guest.socket.id)).ok, false);
  await request(staff.socket, "adminSetProgression", { playerId: visitor.identity.profile.id, operation: "setLevel", level: 5 });
  assert.equal(visitor.identity.admin, true);
  assert.equal((await request(visitor.socket, "joinRoom", { code: created.code })).ok, false, "admins cannot join a running competitive match");
  const ended = once(staff.socket, "matchEnded");
  guest.socket.disconnect();
  const [result] = await ended;
  assert.equal(result.abandoned, true);
  assert.equal(result.rewards[0].xp, 0);
  assert.ok(!JSON.stringify(result).includes(staffId), "private player IDs are not in result broadcasts");
  assert.equal((await request(staff.socket, "startMatch")).ok, false);
});

test("failed match saves remain pending and retry exactly once without losing or duplicating rewards", { timeout: 12000 }, async (t) => {
  const staffId = crypto.randomUUID(), { connect, secret, dataDir } = await serverFixture(t, { ADMIN_PLAYER_IDS: staffId });
  const staff = await connect(signedToken(staffId, secret)), guest = await connect();
  for (const playerId of [staffId, guest.identity.profile.id]) {
    assert.equal((await request(staff.socket, "adminSetProgression", { playerId, operation: "setLevel", level: 5 })).ok, true);
  }
  const created = await request(staff.socket, "createRoom", { mapId: "foundry", mode: "ffa" });
  await request(guest.socket, "joinRoom", { code: created.code });
  await request(staff.socket, "startMatch");
  const blockedPath = path.join(dataDir, "players.json.next");
  fs.mkdirSync(blockedPath);
  const failed = once(staff.socket, "progressSaveError");
  guest.socket.disconnect();
  assert.match((await failed)[0].error, /pending/);
  const before = JSON.parse(fs.readFileSync(path.join(dataDir, "players.json")))[staffId];
  assert.equal(before.matches, 0);
  assert.equal((await request(staff.socket, "adminProfile", staffId)).profile.matches, 0);
  assert.match((await request(staff.socket, "advanceCampaign")).error, /saving/);
  const ended = once(staff.socket, "matchEnded");
  fs.rmdirSync(blockedPath);
  const [result] = await ended;
  assert.equal(result.abandoned, true);
  assert.equal((await request(staff.socket, "adminProfile", staffId)).profile.matches, 1);
  const after = JSON.parse(fs.readFileSync(path.join(dataDir, "players.json")))[staffId];
  assert.equal(after.matches, 1);
  assert.equal(after.xp, 2000);
});

test("admin tools search offline profiles, mutate progression safely, and expose private anti-cheat logs only to admins", { timeout: 12000 }, async (t) => {
  const adminId = crypto.randomUUID();
  const { connect, secret, dataDir } = await serverFixture(t, { ADMIN_PLAYER_IDS: adminId });
  const staff = await connect(signedToken(adminId, secret));
  const guest = await connect();
  const id = guest.identity.profile.id;
  assert.equal((await request(guest.socket, "adminSearchProfiles", { query: "" })).ok, false);
  assert.equal((await request(guest.socket, "adminProfile", id)).ok, false);
  assert.equal((await request(guest.socket, "adminSetProgression", { playerId: id, operation: "unlockAll" })).ok, false);
  assert.equal((await request(guest.socket, "adminAuditLogs", {})).ok, false);
  assert.equal((await request(staff.socket, "adminProfile", "missing")).ok, false);
  assert.equal((await request(staff.socket, "adminSearchProfiles", { query: id })).profiles[0].id, id);
  const profileChanged = once(guest.socket, "profile");
  assert.equal((await request(staff.socket, "adminSetProgression", { playerId: id, operation: "unlockAll" })).ok, true);
  const updated = (await profileChanged)[0];
  assert.equal(updated.ownedWeapons.length, 12);
  assert.equal(updated.unlockedMaps.length, 9);
  assert.deepEqual(updated.campaignCompleted, []);
  assert.equal((await request(staff.socket, "adminSetProgression", { playerId: id, operation: "setLevel", level: 77 })).profile.level, 77);
  assert.equal((await request(staff.socket, "adminSetProgression", { playerId: id, operation: "setLevel", level: 1 })).profile.level, 1);
  assert.equal((await request(guest.socket, "createRoom", { mapId: "citadel", name: "GrantRanger" })).ok, true);
  assert.equal((await request(guest.socket, "equipWeapon", "autoshotgun")).ok, true);
  assert.equal((await request(guest.socket, "startMatch")).ok, true);
  assert.equal((await request(guest.socket, "equipWeapon", "sniper")).ok, false);
  assert.equal((await request(guest.socket, "shoot", { direction: { x: 0, y: 0, z: -1 }, damage: 999 })).ok, false);
  assert.equal((await request(guest.socket, "joinRoom", null)).ok, false);
  const rejection = once(guest.socket, "commandRejected");
  guest.socket.emit("move", { position: { x: 0, y: 1.7, z: 0 }, yaw: 0, pitch: 0, xp: 999 });
  assert.match((await rejection)[0].error, /Invalid/);
  assert.equal((await request(guest.socket, "shoot", { direction: { x: 0, y: 0, z: -1 } })).ok, true);
  const view = await request(staff.socket, "adminProfile", id);
  assert.equal(view.online, true);
  assert.equal(view.profile.level, 1);
  assert.equal(view.profile.username, "GrantRanger");
  guest.socket.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const offline = await request(staff.socket, "adminProfile", id);
  let disconnected = offline;
  for (let attempt = 0; disconnected.online && attempt < 30; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    disconnected = await request(staff.socket, "adminProfile", id);
  }
  assert.equal(disconnected.online, false);
  assert.equal((await request(staff.socket, "adminSearchProfiles", { query: "grantranger" })).profiles[0].id, id);
  const logs = await request(staff.socket, "adminAuditLogs", { kind: "anti-cheat" });
  assert.ok(logs.entries.some((entry) => entry.reason === "invalid_payload" && entry.actorId === id));
  assert.ok((await request(staff.socket, "adminAuditLogs", { kind: "admin" })).entries.some((entry) =>
    entry.action === "unlockAll" && entry.targetId === id && entry.result === "applied"));
  assert.ok(fs.existsSync(path.join(dataDir, "audit.json")));
  const unknown = await connect();
  assert.equal(unknown.identity.profile.level, 1);
  assert.equal(unknown.identity.profile.ownedWeapons.length, 1);
  assert.equal((await request(unknown.socket, "adminProfile", id)).ok, false);
});

test("admin passwords and individual codes grant socket-scoped sessions; logout also revokes verified allowlists", { timeout: 12000 }, async (t) => {
  const adminId = crypto.randomUUID();
  const username = "fixture-admin", password = "network-fixture-password";
  const { connect, secret } = await serverFixture(t, {
    ADMIN_PLAYER_IDS: adminId, ADMIN_LOGIN_USER: username,
    ADMIN_LOGIN_PASSWORD_HASH: await hashAdminPassword(password)
  });

  const guest = await connect();
  assert.equal(guest.identity.admin, false);
  assert.equal(guest.identity.adminLoginAvailable, true);
  assert.equal((await request(guest.socket, "adminOverview")).ok, false);
  assert.equal((await request(guest.socket, "adminSignIn", { username, password: "wrong-password", admin: true })).ok, false);
  const signedIn = once(guest.socket, "adminStatus");
  assert.deepEqual(await request(guest.socket, "adminSignIn", { username, password }),
    { ok: true, admin: true, owner: true, canLogout: true });
  assert.deepEqual((await signedIn)[0], { admin: true, owner: true, canLogout: true });
  const room = await request(guest.socket, "createRoom", { mapId: "foundry", name: "PasswordAdmin" });
  assert.equal(room.ok, true);
  assert.equal((await request(guest.socket, "adminOverview")).rooms[0].code, room.code);
  const duplicate = await connect(guest.identity.token);
  assert.equal(duplicate.identity.profile.id, guest.identity.profile.id);
  assert.equal(duplicate.identity.admin, false);
  assert.equal((await request(duplicate.socket, "adminOverview")).ok, false);
  assert.equal((await request(guest.socket, "adminCloseRoom", room.code)).ok, true);
  const loggedOut = once(guest.socket, "adminStatus");
  assert.deepEqual(await request(guest.socket, "adminSignOut"), { ok: true, admin: false, owner: false, canLogout: false });
  assert.deepEqual((await loggedOut)[0], { admin: false, owner: false, canLogout: false });
  assert.equal((await request(guest.socket, "adminOverview")).ok, false);
  assert.equal((await request(guest.socket, "adminKickPlayer", { code: room.code, playerId: adminId })).ok, false);
  assert.equal((await request(guest.socket, "adminCloseRoom", room.code)).ok, false);

  const pendingLogin = request(guest.socket, "adminSignIn", { username, password });
  assert.equal((await request(guest.socket, "adminSignOut")).admin, false);
  assert.match((await pendingLogin).error, /cancelled/);
  assert.equal((await request(guest.socket, "adminOverview")).ok, false);

  assert.equal((await request(guest.socket, "adminSignIn", { username, password })).admin, true);
  guest.socket.disconnect();
  const reconnected = await connect(guest.identity.token);
  assert.equal(reconnected.identity.admin, false);
  assert.equal((await request(reconnected.socket, "adminOverview")).ok, false);
  const leader = await connect(signedToken(adminId, secret));
  assert.equal(leader.identity.admin, true);
  assert.equal((await request(leader.socket, "adminSignIn", { username, password })).canLogout, true);
  assert.deepEqual(await request(leader.socket, "adminSignOut"), { ok: true, admin: false, owner: false, canLogout: false });
  assert.equal((await request(leader.socket, "adminOverview")).ok, false);
});

test("only authenticated admins can join a running locked-map mission without resetting it", { timeout: 12000 }, async (t) => {
  const hostId = crypto.randomUUID(), allowlistedId = crypto.randomUUID();
  const username = "join-admin", password = "active-room-fixture-password";
  const { connect, secret } = await serverFixture(t, {
    ADMIN_PLAYER_IDS: `${hostId},${allowlistedId}`, ADMIN_LOGIN_USER: username,
    ADMIN_LOGIN_PASSWORD_HASH: await hashAdminPassword(password)
  });
  const host = await connect(signedToken(hostId, secret));
  const staff = await connect(), guest = await connect();
  assert.equal((await request(host.socket, "adminSetProgression",
    { playerId: hostId, operation: "unlockMaps" })).ok, true);
  const room = await request(host.socket, "createRoom", { mapId: "citadel", name: "JoinHost" });
  const initialEvent = once(host.socket, "matchStarted");
  assert.equal((await request(host.socket, "startMatch")).ok, true);
  const [initial] = await initialEvent;
  assert.equal((await request(guest.socket, "joinRoom", { code: room.code })).ok, false);
  assert.equal((await request(staff.socket, "joinRoom", { code: room.code })).ok, false);
  assert.equal((await request(staff.socket, "adminSignIn", { username, password })).admin, true);
  assert.ok(!staff.identity.profile.unlockedMaps.includes("citadel"));
  let restarts = 0;
  host.socket.on("matchStarted", () => { restarts++; });
  const joined = once(staff.socket, "joined"), resumed = once(staff.socket, "matchStarted");
  assert.equal((await request(staff.socket, "joinRoom", { code: room.code, name: "LateAdmin" })).ok, true);
  assert.equal((await joined)[0].code, room.code);
  const [state] = await resumed;
  assert.equal(state.phase, "playing");
  assert.equal(state.mapId, "citadel");
  assert.equal(state.wave, initial.wave);
  assert.deepEqual(state.enemies.map((enemy) => enemy.id), initial.enemies.map((enemy) => enemy.id));
  const player = state.players.find((player) => player.socketId === staff.socket.id);
  assert.equal(player.ammo, 24);
  assert.equal(player.health, 100);
  assert.ok(player.protectedUntil > state.serverNow);
  assert.ok(canOccupyPosition("citadel", player.position));
  assert.equal((await request(staff.socket, "shoot", { direction: { x: 0, y: 0, z: -1 } })).ammo, 23);
  assert.equal((await request(staff.socket, "joinRoom", { code: room.code })).ok, false);
  const nextState = once(staff.socket, "state");
  assert.equal((await nextState)[0].players.find((player) => player.socketId === staff.socket.id).ammo, 23);
  const profile = (await request(staff.socket, "adminProfile", staff.identity.profile.id)).profile;
  assert.equal(profile.level, 1);
  assert.ok(!profile.unlockedMaps.includes("citadel"));
  assert.equal((await request(staff.socket, "adminAuditLogs", { kind: "admin" })).entries.some((entry) =>
    entry.action === "joinActiveRoom" && entry.actorId === profile.id && entry.roomCode === room.code), true);
  assert.equal(restarts, 0);
  assert.equal((await request(staff.socket, "adminSignOut")).admin, false);
  assert.equal((await request(staff.socket, "joinRoom", { code: room.code })).ok, false);
  const duplicate = await connect(staff.identity.token);
  assert.equal(duplicate.identity.admin, false);
  assert.equal((await request(duplicate.socket, "joinRoom", { code: room.code })).ok, false);
  const allowlisted = await connect(signedToken(allowlistedId, secret));
  assert.equal(allowlisted.identity.admin, true);
  const allowedState = once(allowlisted.socket, "matchStarted");
  assert.equal((await request(allowlisted.socket, "joinRoom", { code: room.code })).ok, true);
  const [joinedState] = await allowedState;
  assert.equal(joinedState.players.length, 3);
  assert.equal(joinedState.wave, initial.wave);
  assert.ok(joinedState.players.some((player) => player.socketId === staff.socket.id));
  assert.equal(restarts, 0);
});

test("active administrator admission is denied when its required audit cannot be saved", { timeout: 12000 }, async (t) => {
  const hostId = crypto.randomUUID(), staffId = crypto.randomUUID();
  const { connect, secret, dataDir } = await serverFixture(t, { ADMIN_PLAYER_IDS: `${hostId},${staffId}` });
  const host = await connect(signedToken(hostId, secret)), staff = await connect(signedToken(staffId, secret));
  const room = await request(host.socket, "createRoom", { mapId: "foundry", name: "AuditHost" });
  assert.equal((await request(host.socket, "startMatch")).ok, true);
  const auditPath = path.join(dataDir, "audit.json");
  if (fs.existsSync(auditPath)) fs.unlinkSync(auditPath);
  fs.mkdirSync(auditPath);
  const reply = await request(staff.socket, "joinRoom", { code: room.code });
  assert.equal(reply.ok, false);
  assert.match(reply.error, /Audit storage unavailable/);
  const [state] = await once(host.socket, "state");
  assert.equal(state.phase, "playing");
  assert.equal(state.players.length, 1);
});
