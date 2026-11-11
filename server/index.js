import express from "express";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { canAccessMap, MAPS } from "../shared/progression.js";
import { issueToken, verifyToken } from "./auth.js";
import { adminSetProgression, equipWeapon, existingProfile, getProfile,
  buySkin, equipSkin, equipProgression, grantWeapon, readLeaderboard, searchProfiles, selectClass, storageStatus, updateUsername } from "./store.js";
import { activateClassAbility, pingTeam, requestTeamInteraction } from "./teamwork.js";
import { collectLoot, restockChests, supportPlayer } from "./loot.js";
import { isAdmin } from "./admin.js";
import { ADMIN_SESSION_MS, createAdminLogin, hasAdminSession, loadAdminCredentials } from "./admin-login.js";
import { dataDir } from "./data.js";
import { createAuditLog } from "./audit.js";
import { createCommandGuard } from "./anti-cheat.js";
import { weaponFor } from "../shared/weapons.js";
import { canAccessMode, MAX_ROOM_PLAYERS } from "../shared/modes.js";
import { leaderSocketId, lobbyChat, removeRoomPlayer, transferLeader } from "./lobby.js";
import { createReportStore } from "./reports.js";
import { createAddressResolver, createBanStore } from "./bans.js";
import { createAppealLimiter, createAppealStore } from "./appeals.js";
import { parseBanDuration } from "../shared/bans.js";
import { flushNpcRewardsAsync } from "./npc-rewards.js";
import { applyReward, claimProgression, commitReward, recoverRewards, stageRewards } from "./rewards.js";
import { endgameAllowed } from "../shared/career.js";
import { applyCombatLoadout } from "./combat-loadout.js";
import { matchSquadFor, publicProfile, readRankings, setShowcase, socialAction, socialStatus } from "./records.js";
import { afterCommit, inTransaction, transaction } from "./persistence.js";
import { createStaffAccess } from "./staff-access.js";
import { executeAdminCommand } from "./admin-commands.js";
import { maintenanceEnabled, MAINTENANCE_MESSAGE } from "./maintenance.js";
import { eventContentAvailable } from "../shared/events.js";
import {
  addPlayer, advanceCampaignRoom, campaignSquadReady, createRoom, publicState, reload, roomCode, shoot, startMatch, tickRoom, updatePlayer,
  useAmmoSupply, useMedkit, practiceWeapon, raidInteract
} from "./game.js";

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true }, maxHttpBufferSize: 16 * 1024 });
const rooms = new Map();
const maintenance = maintenanceEnabled();
const audit = createAuditLog(dataDir);
const reports = createReportStore(dataDir);
const bans = createBanStore(dataDir);
const appeals = createAppealStore(dataDir);
const allowAppeal = createAppealLimiter();
const resolveAddress = createAddressResolver();
const adminLogin = createAdminLogin(loadAdminCredentials(dataDir));
// ADMIN_SIGN_IN: "password" (default) grants Owner for a configured login alone; "code" accepts only an
// unused staff code (its role moves to the signing-in identity); "password+code" requires both.
const signInMode = process.env.ADMIN_SIGN_IN || "password";
if (!["password", "code", "password+code"].includes(signInMode)) throw new Error("ADMIN_SIGN_IN must be password, code or password+code.");
const codeOnlySignIn = signInMode === "code", passwordOnlySignIn = signInMode === "password";
const staff = createStaffAccess(dataDir, { seed: process.env.STAFF_ACCESS_SEED || null });
await recoverRewards();
const pendingAudit = [];
let auditFlushing = false;
function writeAudit(input, options) {
  if (inTransaction()) return audit.record(input, options);
  if (pendingAudit.length >= 1000) {
    console.error("Audit queue capacity reached; event was not accepted.");
    return;
  }
  pendingAudit.push({ input, options });
}
function drainAudit() {
  const entries = pendingAudit.slice(0, 20);
  for (const { input, options } of entries) audit.record(input, options);
  afterCommit(() => pendingAudit.splice(0, entries.length));
}
async function flushAuditQueue() {
  if (auditFlushing || !pendingAudit.length) return;
  auditFlushing = true;
  try {
    await transaction(drainAudit);
  } catch (error) {
    console.error("Audit persistence unavailable:", error.code || error.name);
  } finally { auditFlushing = false; }
}
setInterval(flushAuditQueue, 250).unref();
const socketIsAdmin = (socket) => hasAdminSession(socket) && staff.role(socket.data.identity) !== null &&
  socket.data.staffRevision === staff.revision(socket.data.identity);
const socketIsOwner = (socket) => socketIsAdmin(socket) && staff.role(socket.data.identity) === "owner";
const adminStatus = (socket) => ({ admin: socketIsAdmin(socket), owner: socketIsOwner(socket), canLogout: hasAdminSession(socket) });
const port = Number(process.env.PORT) || 3000;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clientDist = path.resolve(projectRoot, process.env.CLIENT_DIST || "dist");
const clientEntry = process.env.CLIENT_ENTRY || "index.html";
if (path.basename(clientEntry) !== clientEntry || !clientEntry.endsWith(".html")) {
  throw new Error("CLIENT_ENTRY must be an HTML filename, not a path");
}

app.get("/api/health", async (_request, response) => {
  try { await transaction(() => {}); response.json({ ok: true, rooms: rooms.size }); }
  catch (error) {
    console.error("Persistence readiness failed:", error.code || error.name);
    response.status(503).json({ ok: false, error: "Progress storage unavailable." });
  }
});
app.get("/api/maintenance", (_request, response) => response.set("Cache-Control", "no-store").json({ enabled: maintenance }));
app.get("/maintenance.html", (_request, response) => {
  response.set("Cache-Control", "no-store").sendFile("maintenance.html", { root: path.join(projectRoot, "public") });
});
app.get("/maintenance-range.js", (_request, response) => {
  response.set("Cache-Control", "no-store").sendFile("maintenance-range.js", { root: path.join(projectRoot, "public") });
});
app.get("/ui-theme.css", (_request, response) => {
  response.set("Cache-Control", "no-cache").sendFile("ui-theme.css", { root: path.join(projectRoot, "public") });
});
app.use((request, response, next) => {
  const entry = ["/", "/index.html", "/standalone.html"].includes(request.path);
  if (!entry || !["GET", "HEAD"].includes(request.method)) return next();
  response.set("Cache-Control", "no-store");
  if (!maintenance) return next();
  response.set("Retry-After", "15").status(503).sendFile("maintenance.html", { root: path.join(projectRoot, "public") });
});
app.get("/api/maps", (_request, response) => response.json(MAPS.filter((map) => eventContentAvailable(map.id))));
app.post("/api/ban-appeals", (request, response, next) => {
  response.set("Cache-Control", "no-store");
  const addressHash = bans.hashAddress(resolveAddress(request));
  if (!allowAppeal(addressHash)) return response.status(429).json({ ok: false, error: "Too many appeal attempts. Wait one minute and try again." });
  next();
}, express.json({ limit: "8kb" }), async (request, response) => {
  const input = request.body;
  if (!input || typeof input !== "object" || Array.isArray(input) ||
    Object.keys(input).some((key) => !["token", "reason"].includes(key)) ||
    (input.token !== undefined && input.token !== null && (typeof input.token !== "string" || input.token.length > 1024))) {
    return response.status(400).json({ ok: false, error: "Invalid appeal request." });
  }
  const identity = verifyToken(input.token);
  const addressHash = bans.hashAddress(resolveAddress(request));
  try {
    const result = await transaction(() => {
      const ban = bans.active("player", identity) || bans.active("ip", addressHash);
      return ban ? appeals.submit(ban, input.reason) :
        { ok: false, noBan: true, error: "No active ban matches this connection. Reload the game to check your access." };
    });
    response.status(result.ok ? 200 : result.noBan ? 403 : 400).json(result);
  } catch (error) {
    console.error("Ban appeal save failed:", error.code || error.name);
    response.status(503).json({ ok: false, error: "Your appeal save could not be confirmed. Please try again later." });
  }
});
app.use("/api/ban-appeals", (error, _request, response, _next) => {
  if (error.type === "entity.too.large" || error.type === "entity.parse.failed") {
    return response.status(400).json({ ok: false, error: "Invalid appeal request. Use up to 1000 characters." });
  }
  console.error("Ban appeal request failed:", error.code || error.name);
  response.status(503).json({ ok: false, error: "Appeals are unavailable. Please try again later." });
});
if (process.env.NODE_ENV === "production") {
  app.use(express.static(clientDist, { index: clientEntry }));
  app.get("*splat", (_request, response) => {
    response.set("Cache-Control", "no-store");
    if (maintenance) return response.set("Retry-After", "15").status(503)
      .sendFile("maintenance.html", { root: path.join(projectRoot, "public") });
    response.sendFile(clientEntry, { root: clientDist });
  });
}

io.use(async (socket, next) => {
  if (maintenance) {
    const error = new Error(MAINTENANCE_MESSAGE);
    error.data = { code: "MAINTENANCE" };
    return next(error);
  }
  const supplied = socket.handshake.auth?.token;
  let identity = verifyToken(supplied);
  let token = supplied;
  if (!identity) {
    identity = crypto.randomUUID();
    token = issueToken(identity);
  }
  let addressHash, activeBan;
  try {
    await transaction(() => {
      addressHash = bans.hashAddress(resolveAddress(socket.request));
      activeBan = bans.active("player", identity) || bans.active("ip", addressHash);
      if (!activeBan) getProfile(identity);
    });
  } catch (failure) {
    console.error("Player admission storage failed:", failure.code || failure.name);
    const error = new Error("Player storage unavailable. Please reconnect later.");
    error.data = { code: "STORAGE_UNAVAILABLE" };
    return next(error);
  }
  if (activeBan) {
    const error = new Error("You are banned from this game. Contact the administrator to appeal.");
    error.data = { code: "BANNED", ban: bans.notice(activeBan) };
    return next(error);
  }
  socket.data.identity = identity;
  socket.data.token = token;
  socket.data.addressHash = addressHash;
  next();
});

io.on("connection", (socket) => {
  const guard = createCommandGuard();
  const record = (kind, action, details = {}, options = {}) => writeAudit({
    kind, action, actorId: socket.data.identity, roomCode: socket.data.roomCode, ...details
  }, options);
  socket.use((packet, next) => {
    const decision = guard.check(packet, socketIsAdmin(socket));
    if (decision.ok) return next();
    record("anti-cheat", decision.action, { reason: decision.reason, result: "rejected" }, { aggregate: true });
    const callback = packet.at(-1);
    if (typeof callback === "function") callback({ ok: false, error: decision.error, reason: decision.error });
    else socket.emit("commandRejected", { event: decision.action, error: decision.error });
  });
  const adminHandler = (event, handler) => socket.on(event, async (input, callback) => {
    if (typeof input === "function") { callback = input; input = undefined; }
    const reply = typeof callback === "function" ? callback : (result) => {
      if (!result.ok) socket.emit("commandRejected", { event, error: result.error });
    };
    try { reply(await transaction(() => {
      drainAudit();
      if (!socket.connected || !socketIsAdmin(socket)) return { ok: false, error: "Admin access denied." };
      return handler(input);
    })); } catch (error) {
      console.error(`Administrator ${event} failed:`, error.code || error.name);
      reply({ ok: false, error: "Administrator operation failed. Check server logs." });
    }
  });
  const playerHandler = (event, handler) => socket.on(event, async (input, callback) => {
    if (typeof input === "function") { callback = input; input = undefined; }
    const reply = typeof callback === "function" ? callback : (result) => {
      if (!result.ok) socket.emit("commandRejected", { event, error: result.error });
    };
    try { await transaction(() => {
      drainAudit();
      if (socket.connected) handler(input, (result) => afterCommit(() => reply(result)));
    }); } catch (error) {
      console.error(`Player ${event} save failed:`, error.code || error.name);
      reply({ ok: false, error: event === "leaderboard" ? "Leaderboard unavailable. Please try again later." :
        error.message.startsWith("Audit storage") ? "Audit storage unavailable. Your change could not be confirmed; try again." :
          "Progress storage unavailable. Your change could not be confirmed; try again." });
    }
  });
  let profile;
  try { profile = getProfile(socket.data.identity); } catch (error) {
    console.error("Player identity storage failed:", error.code || error.name);
    socket.emit("identityError", { error: "Player storage unavailable. Please reconnect later." });
    socket.disconnect(true);
    return;
  }
  socket.emit("identity", {
    token: socket.data.token, profile, ...adminStatus(socket),
    adminLoginAvailable: codeOnlySignIn || adminLogin.enabled || isAdmin(socket.data.identity),
    adminPasswordRequired: !codeOnlySignIn && adminLogin.enabled,
    adminCodeRequired: !passwordOnlySignIn
  });
  playerHandler("leaderboard", (input, reply) => reply(readLeaderboard(socket.data.identity, input)));
  let adminExpiry;
  let adminActionVersion = 0;
  socket.on("adminSignIn", async (input, callback = () => {}) => {
    if (typeof callback !== "function") {
      socket.emit("adminSignInError", { error: "Invalid sign-in request." });
      return;
    }
    const version = ++adminActionVersion;
    let result, passwordVerified = false, allowlistedStaff = false;
    try {
      const currentRole = await transaction(() => staff.role(socket.data.identity));
      allowlistedStaff = !passwordOnlySignIn && isAdmin(socket.data.identity) && currentRole !== "owner" &&
        input?.username === undefined && input?.password === undefined;
      result = allowlistedStaff || codeOnlySignIn ? { ok: true } : adminLogin.enabled || passwordOnlySignIn ? await adminLogin.authenticate(input, socket.handshake.address) :
        isAdmin(socket.data.identity) ? { ok: true } : { ok: false, error: "Admin password sign-in is not configured." };
      passwordVerified = !allowlistedStaff && !codeOnlySignIn && adminLogin.enabled && result.ok;
    } catch (error) {
      console.error("Administrator sign-in failed:", error.code || error.name);
      callback({ ok: false, error: "Unable to sign in. Try again shortly." });
      return;
    }
    if (!socket.connected) return;
    if (version !== adminActionVersion) return callback({ ok: false, error: "Sign-in cancelled." });
    if (!result.ok) {
      record("auth", "adminSignIn", { result: "denied" }, { aggregate: true });
      return callback(result);
    }
    try {
      result = await transaction(() => {
        if (!socket.connected || version !== adminActionVersion) return { ok: false, error: "Sign-in cancelled." };
        if (allowlistedStaff && staff.role(socket.data.identity) === "owner") {
          return { ok: false, error: "Owner password verification is required. Sign in again." };
        }
        let verified;
        if (passwordOnlySignIn) {
          record("auth", "adminSignIn", { result: "password_owner" }, { immediate: true });
          verified = staff.role(socket.data.identity) === "owner" ? { ok: true } : staff.setRole(socket.data.identity, "owner");
        } else {
          record("auth", "adminSignIn", { result: "verification_requested" }, { immediate: true });
          verified = staff.verify(socket.data.identity, input?.code, codeOnlySignIn ?
            { allowMove: true, limitKey: resolveAddress(socket.request) || "unknown" } : { allowMove: passwordVerified });
        }
        if (verified.movedFrom) record("auth", "staffCodeMoved", { targetId: verified.movedFrom, result: "moved" }, { immediate: true });
        return verified;
      });
    } catch (error) {
      console.error("Administrator sign-in audit failed:", error.code || error.name);
      return callback({ ok: false, error: "Audit storage unavailable. Sign-in was not granted." });
    }
    if (!socket.connected || version !== adminActionVersion) return callback({ ok: false, error: "Sign-in cancelled." });
    if (!result.ok) {
      record("auth", "adminVerify", { result: "denied" }, { aggregate: true });
      return callback(result);
    }
    if (result.movedFrom) {
      refreshStaff(result.movedFrom);
      refreshStaff(socket.data.identity);
    }
    clearTimeout(adminExpiry);
    socket.data.adminSessionUntil = Date.now() + ADMIN_SESSION_MS;
    socket.data.staffRevision = staff.revision(socket.data.identity);
    adminExpiry = setTimeout(() => {
      socket.data.adminSessionUntil = 0;
      record("auth", "adminSessionExpired", { result: "revoked" });
      socket.emit("adminStatus", adminStatus(socket));
    }, ADMIN_SESSION_MS).unref();
    socket.emit("adminStatus", adminStatus(socket));
    callback({ ok: true, ...adminStatus(socket) });
  });
  socket.on("adminSignOut", async (callback = () => {}) => {
    if (typeof callback !== "function") {
      socket.emit("adminSignInError", { error: "Invalid sign-out request." });
      return;
    }
    adminActionVersion++;
    clearTimeout(adminExpiry);
    socket.data.adminSessionUntil = 0;
    socket.emit("adminStatus", adminStatus(socket));
    try {
      await transaction(() => record("auth", "adminSignOut", { result: "revoked" }));
      callback({ ok: true, ...adminStatus(socket) });
    } catch (error) {
      console.error("Administrator sign-out audit failed:", error.code || error.name);
      callback({ ok: false, error: "Signed out, but audit storage is unavailable." });
    }
  });

  playerHandler("createRoom", ({ mapId, name, mode = "campaign", difficulty = "standard", mutators = [] } = {}, callback) => {
    const freshProfile = getProfile(socket.data.identity);
    if (!endgameAllowed(freshProfile, difficulty, mutators)) return callback({ ok: false, error: "Nightmare and mutators require level 10." });
    if (!canAccessMode(freshProfile.xp, mode)) return callback({ ok: false, error: "Free-for-All requires level 5." });
    if (mode !== "practice" && !canAccessMap(freshProfile.xp, mapId, freshProfile.adminUnlockedMaps)) return callback({ ok: false, error: "That map is locked." });
    const username = updateUsername(socket.data.identity, name);
    if (!username.ok) return callback(username);
    afterCommit(() => {
    if (!socket.connected) return;
    let code;
    do code = roomCode(); while (rooms.has(code));
    const room = createRoom(code, mapId, mode, difficulty, mutators);
    rooms.set(code, room);
    join(socket, room, username.profile, username.profile.username);
    socket.emit("profile", username.profile);
    callback({ ok: true, code });
    });
  });

  playerHandler("quickMatch", ({ mapId, name, mode = "campaign", difficulty = "standard", mutators = [] } = {}, callback) => {
    const freshProfile = getProfile(socket.data.identity);
    if (!endgameAllowed(freshProfile, difficulty, mutators)) return callback({ ok: false, error: "Nightmare and mutators require level 10." });
    if (mode === "practice") return callback({ ok: false, error: "The shooting range is solo. Use Play now." });
    if (!canAccessMode(freshProfile.xp, mode) ||
      !canAccessMap(freshProfile.xp, mapId, freshProfile.adminUnlockedMaps)) {
      return callback({ ok: false, error: "Your clearance does not unlock this mode or map." });
    }
    if ([...rooms.values()].some((room) => [...room.players.values()].some((player) =>
      player.identity === socket.data.identity))) {
      return callback({ ok: false, error: "This operator is already in a fireteam. Return to operations first." });
    }
    const username = updateUsername(socket.data.identity, name);
    if (!username.ok) return callback(username);
    afterCommit(() => {
    if (!socket.connected) return;
    let room = [...rooms.values()].find((candidate) =>
      candidate.matchmaking === true && candidate.phase === "lobby" &&
      candidate.mapId === mapId && candidate.mode === mode && candidate.difficulty === difficulty &&
      JSON.stringify(candidate.mutators) === JSON.stringify([...mutators].sort()) && candidate.players.size < MAX_ROOM_PLAYERS &&
      !candidate.kickedIdentities.has(socket.data.identity) && !candidate.advancingUntil);
    if (!room) {
      let code;
      do code = roomCode(); while (rooms.has(code));
      room = createRoom(code, mapId, mode, difficulty, mutators);
      room.matchmaking = true;
      rooms.set(code, room);
    }
    join(socket, room, username.profile, username.profile.username);
    socket.emit("profile", username.profile);
    callback({ ok: true, code: room.code });
    });
  });

  playerHandler("joinRoom", ({ code, name } = {}, callback) => {
    const room = rooms.get(String(code || "").toUpperCase());
    if (!room) return callback({ ok: false, error: "Room not found." });
    if (room.mode === "practice") return callback({ ok: false, error: "The shooting range is solo. Create your own practice session." });
    if (room.kickedIdentities.has(socket.data.identity)) {
      return callback({ ok: false, error: "The fireteam lead removed you from this room." });
    }
    if (room.players.size >= MAX_ROOM_PLAYERS && ![...room.players.values()].some((player) => player.identity === socket.data.identity)) {
      return callback({ ok: false, error: "This room is full (four operators)." });
    }
    if (!canAccessMode(getProfile(socket.data.identity).xp, room.mode)) {
      return callback({ ok: false, error: "Free-for-All requires level 5." });
    }
    const active = room.phase === "playing" || room.phase === "between";
    const adminAdmission = active && room.mode !== "ffa" && socketIsAdmin(socket);
    if (room.phase !== "lobby" && !adminAdmission) {
      return callback({ ok: false, error: active
        ? "Match already in progress. Only signed-in administrators can join an active mission."
        : "This mission has ended. Wait for a new deployment." });
    }
    const transitioning = room.advancingUntil > Date.now();
    if (transitioning && !room.advancingIdentities?.has(socket.data.identity)) {
      return callback({ ok: false, error: "This campaign lobby is reserved for its fireteam." });
    }
    const freshProfile = getProfile(socket.data.identity);
    if (!endgameAllowed(freshProfile, room.difficulty, room.mutators)) return callback({ ok: false, error: "This endgame fireteam requires level 10." });
    if (!adminAdmission && !canAccessMap(freshProfile.xp, room.mapId, freshProfile.adminUnlockedMaps)) {
      return callback({ ok: false, error: "Your clearance level does not unlock this map." });
    }
    const username = updateUsername(socket.data.identity, name);
    if (!username.ok) return callback(username);
    const previous = [...room.players.values()].find((player) =>
      player.identity === socket.data.identity && (active || player.socketId !== socket.id));
    if (previous) {
      if (!transitioning) {
        return callback({ ok: false, error: "This operator is already in the room. Use a separate browser profile." });
      }
    }
    if (adminAdmission) {
      record("admin", "joinActiveRoom", { roomCode: room.code, result: "admitted" }, { immediate: true });
    }
    afterCommit(() => {
    if (!socket.connected) return;
    if (rooms.get(room.code) !== room || room.kickedIdentities.has(socket.data.identity) ||
      room.players.size >= MAX_ROOM_PLAYERS && !previous ||
      room.phase !== "lobby" && !adminAdmission) return callback({ ok: false, error: "Room changed while saving. Please try again." });
    if (previous) {
      const oldSocket = io.sockets.sockets.get(previous.socketId);
      if (oldSocket) {
        oldSocket.leave(room.code);
        oldSocket.data.roomCode = null;
        oldSocket.disconnect(true);
      }
      removeRoomPlayer(room, previous.socketId);
    }
    join(socket, room, username.profile, username.profile.username);
    socket.emit("profile", username.profile);
    if (transitioning) room.campaignRejoined.add(socket.data.identity);
    callback({ ok: true, code: room.code });
    });
  });

  playerHandler("startMatch", (_input, callback) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || leaderSocketId(room) !== socket.id) {
      return callback({ ok: false, error: "Only the fireteam lead can deploy." });
    }
    if (!campaignSquadReady(room)) {
      return callback({ ok: false, error: "Waiting for the fireteam to reconnect to this operation." });
    }
    const profiles = new Map([...room.players.values()].map((player) => [player.identity, getProfile(player.identity)]));
    const rankedSquad = matchSquadFor([...profiles.keys()]);
    if ([...profiles.values()].some((profile) => !endgameAllowed(profile, room.difficulty, room.mutators))) {
      return callback({ ok: false, error: "Every operator needs level 10 for Nightmare or mutators." });
    }
    afterCommit(() => {
    if (!socket.connected || rooms.get(room.code) !== room) return;
    for (const player of room.players.values()) {
      if (!profiles.has(player.identity)) return callback({ ok: false, error: "Fireteam changed while saving. Try again." });
      player.profile = profiles.get(player.identity);
    }
    if (!startMatch(room)) return callback({ ok: false, error: room.mode === "ffa"
      ? "Free-for-All needs at least two operators, all at level 5 or above."
      : "The mission is already in progress." });
    room.rankedSquad = rankedSquad;
    io.to(room.code).emit("matchStarted", publicState(room));
    callback({ ok: true });
    });
  });
  playerHandler("advanceCampaign", (_input, callback) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || leaderSocketId(room) !== socket.id) {
      return callback({ ok: false, error: "Only the fireteam lead can continue the campaign." });
    }
    const profiles = [...room.players.values()].map((player) => getProfile(player.identity));
    afterCommit(() => {
    if (!socket.connected || rooms.get(room.code) !== room) return;
    const outcome = advanceCampaignRoom(room, profiles);
    if (outcome.ok) {
      io.to(room.code).emit("campaignAdvanced", outcome);
      io.to(room.code).emit("state", publicState(room));
    }
    callback(outcome);
    });
  });
  playerHandler("practiceWeapon", (weaponId, callback) => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.get(socket.id);
    const profile = player && getProfile(socket.data.identity);
    afterCommit(() => {
    if (player) player.profile = profile;
    const result = practiceWeapon(room, socket.id, weaponId);
    if (result.ok) io.to(room.code).emit("state", publicState(room));
    callback(result);
    });
  });
  socket.on("raidInteract", (objectiveId, callback = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    const result = raidInteract(room, socket.id, objectiveId);
    if (result.ok) io.to(room.code).emit("state", publicState(room));
    callback(result);
  });
  for (const [command, handler] of [["teamPing", pingTeam], ["teamInteract", requestTeamInteraction]]) {
    socket.on(command, (input, callback = () => {}) => {
      const room = rooms.get(socket.data.roomCode);
      const result = room ? handler(room, socket.id, input) : { ok: false, error: "Join an active squad first." };
      callback(result);
    });
  }
  socket.on("classAbility", (callback = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    callback(room ? activateClassAbility(room, socket.id) : { ok: false, error: "Join an active squad first." });
  });
  socket.on("lobbyChat", (text, callback = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return callback({ ok: false, error: "Join a lobby before chatting." });
    const result = lobbyChat(room, socket.id, text);
    if (result.ok) io.to(room.code).emit("state", publicState(room));
    callback(result);
  });
  socket.on("transferLeader", (targetId, callback = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return callback({ ok: false, error: "You are not in a room." });
    const result = transferLeader(room, socket.id, targetId);
    if (result.ok) io.to(room.code).emit("state", publicState(room));
    callback(result);
  });
  socket.on("leaderKick", (targetId, callback = () => {}) => {
    const room = rooms.get(socket.data.roomCode), target = room?.players.get(targetId);
    if (!room || room.phase !== "lobby" || leaderSocketId(room) !== socket.id || !target || targetId === socket.id) {
      return callback({ ok: false, error: "Only the fireteam lead can remove another lobby member." });
    }
    if (room.kickedIdentities.size >= 100) return callback({ ok: false, error: "This lobby has reached its removal limit. Create a new room." });
    room.kickedIdentities.add(target.identity);
    const peer = io.sockets.sockets.get(targetId);
    peer?.emit("roomClosed", "You were removed from the lobby by the fireteam lead.");
    peer?.leave(room.code);
    if (peer) peer.data.roomCode = null;
    removeRoomPlayer(room, targetId);
    io.to(room.code).emit("state", publicState(room));
    callback({ ok: true });
  });
  playerHandler("reportPlayer", ({ playerId, reason }, callback) => {
    try {
      callback(reports.submit(rooms.get(socket.data.roomCode), socket.id, playerId, reason,
        io.sockets.sockets.get(playerId)?.data.addressHash || null,
        Boolean(io.sockets.sockets.get(playerId) && socketIsAdmin(io.sockets.sockets.get(playerId)))));
    } catch (error) {
      console.error("Player report save failed:", error.code || error.name);
      callback({ ok: false, error: "Report storage unavailable. Your report was not saved; try again." });
    }
  });
  adminHandler("adminReports", (input) => {
    const result = reports.list(input);
    if (!result.ok) return result;
    return { ...result, reports: result.reports.map(({ targetAddressHash, ...report }) => ({
      ...report, canBanIp: Boolean(targetAddressHash),
      targetAdmin: Boolean(report.targetWasAdmin || isAdmin(report.targetId) || staff.role(report.targetId) ||
        [...io.sockets.sockets.values()].some((peer) => peer.data.identity === report.targetId && socketIsAdmin(peer))),
      playerBanned: bans.isBanned("player", report.targetId), ipBanned: bans.isBanned("ip", targetAddressHash)
    })) };
  });
  adminHandler("adminReviewReport", ({ id, status }) => {
    record("admin", "reviewReport", { reason: id, result: "requested" }, { immediate: true });
    return reports.review(id, status, socket.data.identity);
  });
  function banReport({ reportId, kind, duration = "perm", reason }) {
    const durationMs = parseBanDuration(duration);
    if (durationMs === undefined) return { ok: false, error: "Choose a valid ban length, such as 1h, 1d, 7d or perm." };
    const report = reports.get(reportId);
    if (!report) return { ok: false, error: "Report not found." };
    const peers = [...io.sockets.sockets.values()];
    if (report.targetId === socket.data.identity) return { ok: false, error: "You cannot ban yourself." };
    const targetAdmin = report.targetWasAdmin || isAdmin(report.targetId) || staff.role(report.targetId) ||
      peers.some((peer) => peer.data.identity === report.targetId && socketIsAdmin(peer));
    if (targetAdmin && !socketIsOwner(socket)) {
      return { ok: false, error: "Only the server owner can ban an administrator. Sign in with the owner login." };
    }
    if (kind === "ip") {
      if (!report.targetAddressHash) return { ok: false, error: "No verified address is available for this report." };
      if (socket.data.addressHash === report.targetAddressHash) {
        return { ok: false, error: "This address is shared with your own connection. Use Ban player instead." };
      }
      if (!socketIsOwner(socket) && peers.some((peer) => peer.data.addressHash === report.targetAddressHash && socketIsAdmin(peer))) {
        return { ok: false, error: "This address is shared with a connected administrator. Use Ban player instead." };
      }
    }
    record("admin", kind === "ip" ? "ipBan" : "banPlayer",
      { targetId: report.targetId, reason: reportId, result: "requested" }, { immediate: true });
    const note = typeof reason === "string" && reason.trim() ? reason : report.reason.replace(/^Administrator command: /, "");
    const result = bans.ban(report, kind, socket.data.identity, { durationMs, reason: note });
    if (!result.ok) return result;
    afterCommit(() => { for (const peer of peers) {
      if (kind === "player" ? peer.data.identity !== report.targetId : peer.data.addressHash !== report.targetAddressHash) continue;
      peer.emit("banned", result.ban);
      peer.disconnect(true);
    } });
    return { ok: true };
  }
  adminHandler("adminBanReport", banReport);
  adminHandler("adminCommand", (line) => executeAdminCommand(line, {
    owner: socketIsOwner(socket),
    resolve(query) {
      const normalized = query.replace(/^#/, "").toLowerCase();
      const exact = existingProfile(normalized);
      if (exact) return { ok: true, profile: exact };
      const matching = [];
      let offset = 0;
      do {
        const result = searchProfiles(normalized, offset);
        if (!result.ok) return result;
        matching.push(...result.profiles.filter((profile) => profile.username.toLowerCase() === normalized ||
          profile.id.slice(0, 8).toLowerCase() === normalized));
        offset = result.nextOffset;
      } while (offset !== null && matching.length < 2);
      return matching.length === 1 ? { ok: true, profile: existingProfile(matching[0].id) } :
        { ok: false, error: matching.length ? "Ambiguous username. Use the full Operator ID." : "Player not found. Use an exact username, #tag, or Operator ID." };
    },
    fly(target, setting) {
      const active = [...rooms.values()].flatMap((room) => ["playing", "between"].includes(room.phase) && room.mode !== "practice"
        ? [...room.players.values()].filter((player) => player.identity === target.id && !player.deadUntil).map((player) => ({ room, player })) : []);
      if (!active.length) return { ok: false, error: "Choose a living player in an active combat match." };
      record("admin", "flight", { targetId: target.id, result: "requested" }, { immediate: true });
      const enabled = setting === "toggle" ? !active.some(({ player }) => player.flying) : setting === "on";
      afterCommit(() => { for (const { room, player } of active) {
        room.rankedAssisted = true;
        player.flying = enabled;
        io.to(room.code).emit("state", publicState(room));
      } });
      return { ok: true, lines: [`Flight ${enabled ? "enabled" : "disabled"} for ${target.username}. Space/up to rise; C/down to descend. Walls and arena limits still apply.`] };
    },
    ban(target, reason, { kind = "player", duration = "perm" } = {}) {
      if (target.id === socket.data.identity) return { ok: false, error: "You cannot ban yourself." };
      const protectedTarget = Boolean(staff.role(target.id) || isAdmin(target.id));
      if (protectedTarget && !socketIsOwner(socket)) return { ok: false, error: "Only the verified owner can ban staff." };
      let addressHash = null;
      if (kind === "ip") {
        addressHash = [...io.sockets.sockets.values()].find((peer) => peer.data.identity === target.id && peer.data.addressHash)?.data.addressHash || null;
        if (!addressHash) return { ok: false, error: "IP bans need the player to be online. Use ?ban for an account ban." };
        if (bans.isBanned("ip", addressHash)) return { ok: false, error: "This address is already banned." };
      } else if (bans.isBanned("player", target.id)) return { ok: false, error: "This player is already banned." };
      record("admin", kind === "ip" ? "commandIpBan" : "commandBan", { targetId: target.id, result: "requested" }, { immediate: true });
      const saved = reports.moderation(getProfile(socket.data.identity), target, reason, protectedTarget, addressHash);
      if (!saved.ok) return saved;
      const result = banReport({ reportId: saved.report.id, kind, duration, reason });
      const length = duration === "perm" ? "permanently" : `for ${duration}`;
      return result.ok ? { ok: true, lines: [`${kind === "ip" ? "IP" : "Account"} banned ${length}: ${target.username}. Use Active bans to remove the ban.`] } : result;
    },
    announce(message) {
      const profile = getProfile(socket.data.identity);
      const role = staff.role(socket.data.identity);
      record("admin", "announcement", { result: "requested" }, { immediate: true });
      afterCommit(() => io.emit("serverAnnouncement", {
        text: message,
        authorName: profile.username,
        authorRole: role,
        at: Date.now()
      }));
      return { ok: true, lines: ["Announcement sent to everyone connected."] };
    },
    role(target, role) {
      record("admin", "staffRole", { targetId: target.id, reason: role, result: "requested" }, { immediate: true });
      const result = staff.setRole(target.id, role);
      if (result.ok) afterCommit(() => refreshStaff(target.id));
      return result.ok ? { ok: true, lines: [`${target.username}: ${role}. Existing staff sessions revoked.`] } : result;
    },
    codes(target) {
      record("admin", "issueStaffCodes", { targetId: target.id, result: "requested" }, { immediate: true });
      const result = staff.issue(target.id);
      if (result.ok) afterCommit(() => {
        if (target.id === socket.data.identity) socket.data.staffRevision = staff.revision(target.id);
        refreshStaff(target.id);
      });
      return result.ok ? { ok: true, codes: result.codes, lines: [`Three private one-use codes for ${target.username} (${target.id}). Old codes and other sessions are revoked. Store securely and deliver privately.`] } : result;
    }
  }));
  adminHandler("adminBans", (input) => bans.list(input));
  adminHandler("adminAppeals", (input) => appeals.list(input));
  adminHandler("adminReviewAppeal", ({ id, status }) => {
    const appeal = appeals.get(id);
    if (!appeal) return { ok: false, error: "Appeal not found." };
    if (appeal.status !== "open") return { ok: false, error: "This appeal has already been reviewed. Refresh the inbox." };
    record("admin", status === "approved" ? "approveAppeal" : "rejectAppeal",
      { targetId: appeal.targetId, reason: id, result: "requested" }, { immediate: true });
    // Removing first allows a failed review save to be retried without leaving an approved ban active.
    if (status === "approved" && bans.get(appeal.banId)) {
      const result = bans.remove(appeal.banId);
      if (!result.ok) return result;
    }
    return appeals.review(id, status, socket.data.identity);
  });
  adminHandler("adminUnban", (id) => {
    const ban = bans.get(id);
    if (!ban) return { ok: false, error: "Ban not found." };
    record("admin", "unban", { targetId: ban.targetId, reason: id, result: "requested" }, { immediate: true });
    return bans.remove(id);
  });
  socket.on("move", (data) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !["playing", "between"].includes(room.phase)) return;
    if (!updatePlayer(room, socket.id, data)) {
      const player = room.players.get(socket.id);
      const now = Date.now();
      if (player && !player.deadUntil) record("anti-cheat", "move",
        { reason: "movement_bounds_speed_or_cover", result: "corrected" }, { aggregate: true });
      if (player && !player.deadUntil && now - (socket.data.lastMovementCorrection || 0) >= 150) {
        socket.data.lastMovementCorrection = now;
        socket.emit("movementCorrection", { position: player.position, crouching: player.crouching });
      }
    }
  });
  socket.on("shoot", (data, callback = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const result = shoot(room, socket.id, data);
    flushKillTokens(room);
    if (result.reason === "Invalid aim" || result.reason === "Fire rate") {
      record("anti-cheat", "shoot", { reason: result.reason, result: "rejected" }, { aggregate: true });
    }
    callback(result);
    if (result.ok) socket.to(room.code).emit("shotEffect", {
      playerId: socket.id, origin: room.players.get(socket.id)?.position,
      direction: result.direction, hit: result.hit, hitZone: result.hitZone,
      enemyId: result.hit ? result.enemyId : undefined, distance: result.distance,
      rays: result.rays, hits: result.hits
    });
  });
  socket.on("reload", (callback = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    const started = room && reload(room, socket.id);
    const player = started && room.players.get(socket.id);
    callback(player
      ? { ok: true, type: player.reloadType, duration: player.reloadDuration }
      : { ok: false, reason: "Reload unavailable" });
  });
  socket.on("useMedkit", (callback = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    const result = useMedkit(room, socket.id);
    if (result.ok) io.to(room.code).emit("state", publicState(room));
    callback(result);
  });
  socket.on("useAmmoSupply", (supplyId, callback = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    callback(room ? useAmmoSupply(room, socket.id, supplyId)
      : { ok: false, error: "Not in a mission." });
  });
  playerHandler("collectLoot", (id, callback) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return callback({ ok: false, error: "Not in a mission." });
    try {
      const result = collectLoot(room, socket.id, id, grantWeapon, afterCommit);
      if (result.ok) {
        afterCommit(() => {
          if (result.profile) syncPlayerProfile(socket.data.identity, result.profile);
          io.to(room.code).emit("state", publicState(room));
        });
      }
      callback(result);
    } catch (error) {
      console.error("Loot save failed:", error.code || error.name);
      callback({ ok: false, error: "Save storage unavailable. Loot was not collected; try again." });
    }
  });
  adminHandler("adminOverview", () => {
    return { ok: true, rooms: [...rooms.values()].map((room) => ({
      code: room.code, mapId: room.mapId, mode: room.mode, phase: room.phase, wave: room.wave,
      players: room.players.size,
      members: [...room.players.values()].map((player) => ({
        socketId: player.socketId, playerId: player.identity,
        name: player.name, leader: player.socketId === leaderSocketId(room)
      }))
    })) };
  });
  adminHandler("adminSearchProfiles", ({ query, offset }) => {
    const result = searchProfiles(query, offset);
    if (result.ok) record("admin", "searchProfiles", { result: "accepted" });
    return result;
  });
  adminHandler("adminProfile", (id) => {
    const profile = existingProfile(id);
    if (!profile) return { ok: false, error: "Player profile not found." };
    record("admin", "viewProfile", { targetId: id, result: "accepted" });
    const connections = [...io.sockets.sockets.values()].filter((peer) => peer.data.identity === id);
    return { ok: true, profile, staffRole: staff.role(id), online: connections.length > 0,
      rooms: [...new Set(connections.map((peer) => peer.data.roomCode).filter(Boolean))] };
  });
  adminHandler("adminSetProgression", ({ playerId, operation, level }) => {
    if (!existingProfile(playerId)) return { ok: false, error: "Player profile not found." };
    record("admin", operation, { targetId: playerId, level, result: "requested" }, { immediate: true });
    const result = adminSetProgression(playerId, operation, level);
    if (result.ok) {
      afterCommit(() => { for (const peer of io.sockets.sockets.values()) {
        if (peer.data.identity !== playerId) continue;
        const player = rooms.get(peer.data.roomCode)?.players.get(peer.id);
        if (player) player.profile = result.profile;
        peer.emit("profile", result.profile);
      } });
    }
    record("admin", operation, { targetId: playerId, level, result: result.ok ? "applied" : "denied" }, { immediate: true });
    return result;
  });
  adminHandler("adminAuditLogs", (query) => ({ ok: true, ...audit.read(query) }));
  adminHandler("adminStorageStatus", () => ({ ok: true, storage: storageStatus() }));
  adminHandler("adminGrantWeapon", ({ playerId, weaponId }) => {
    record("admin", "grantWeapon", { targetId: playerId, reason: weaponId, result: "requested" }, { immediate: true });
    const result = grantWeapon(playerId, weaponId);
    if (result.ok) afterCommit(() => { for (const peer of io.sockets.sockets.values()) {
      if (peer.data.identity !== playerId) continue;
      const player = rooms.get(peer.data.roomCode)?.players.get(peer.id);
      if (player) player.profile = result.profile;
      peer.emit("profile", result.profile);
    } });
    record("admin", "grantWeapon", { targetId: playerId, reason: weaponId, result: result.ok ? "applied" : "denied" }, { immediate: true });
    return result;
  });
  adminHandler("adminPlayerSupport", ({ playerId, operation }) => {
    if (!["heal", "ammo"].includes(operation)) return { ok: false, error: "Unknown support action." };
    const targets = [...rooms.values()].flatMap((room) => ["playing", "between"].includes(room.phase)
      ? [...room.players.values()].filter((player) => player.identity === playerId && !player.deadUntil).map((player) => ({ room, player }))
      : []);
    if (!targets.length) return { ok: false, error: "Player is not alive in an active mission." };
    record("admin", operation, { targetId: playerId, result: "requested" }, { immediate: true });
    afterCommit(() => { for (const { room, player } of targets) {
      room.rankedAssisted = true;
      const result = supportPlayer(player, operation);
      if (result.ok) io.to(room.code).emit("state", publicState(room));
    } });
    record("admin", operation, { targetId: playerId, result: "applied" }, { immediate: true });
    return { ok: true };
  });
  adminHandler("adminRestockChests", (code) => {
    const room = rooms.get(code);
    if (!room || !["playing", "between"].includes(room.phase)) return { ok: false, error: "Choose an active mission." };
    if (room.mode === "practice") return { ok: false, error: "Practice has no loot or rewards." };
    record("admin", "restockChests", { roomCode: code, result: "requested" }, { immediate: true });
    afterCommit(() => {
      room.rankedAssisted = true;
      restockChests(room);
      io.to(code).emit("state", publicState(room));
    });
    record("admin", "restockChests", { roomCode: code, result: "applied" }, { immediate: true });
    return { ok: true };
  });
  playerHandler("adminKickPlayer", (request, callback) => {
    if (!socketIsAdmin(socket)) return callback({ ok: false, error: "Admin access denied." });
    const { code, playerId } = request && typeof request === "object" ? request : {};
    const room = typeof code === "string" && /^[A-F0-9]{6}$/.test(code) ? rooms.get(code) : null;
    const peer = typeof playerId === "string" && room?.players.has(playerId)
      ? io.sockets.sockets.get(playerId) : null;
    if (!room || !peer) return callback({ ok: false, error: "Player not found in room." });
    try { record("admin", "kickPlayer", { targetId: peer.data.identity, roomCode: code, result: "applied" }, { immediate: true }); } catch (error) {
      console.error("Administrator kick audit failed:", error.code || error.name);
      return callback({ ok: false, error: "Audit storage unavailable. Player was not removed." });
    }
    afterCommit(() => {
    peer.emit("roomClosed", "You were removed from the room by an administrator.");
    peer.leave(code);
    peer.data.roomCode = null;
    removeRoomPlayer(room, playerId);
    discardEmptyRoom(room);
    });
    callback({ ok: true });
  });
  playerHandler("adminCloseRoom", (code, callback) => {
    if (!socketIsAdmin(socket)) return callback({ ok: false, error: "Admin access denied." });
    const room = typeof code === "string" && /^[A-F0-9]{6}$/.test(code) ? rooms.get(code) : null;
    if (!room) return callback({ ok: false, error: "Room not found." });
    flushKillTokens(room);
    if (room.pendingNpcTokens.size || room.rewardQueue || room.pendingResult) return callback({ ok: false, error: "Wait for pending rewards to save before closing this room." });
    try { record("admin", "closeRoom", { roomCode: code, result: "applied" }, { immediate: true }); } catch (error) {
      console.error("Administrator room-close audit failed:", error.code || error.name);
      return callback({ ok: false, error: "Audit storage unavailable. Room was not closed." });
    }
    afterCommit(() => {
    io.to(code).emit("roomClosed", "This room was closed by an administrator.");
    for (const participant of room.players.keys()) {
      const peer = io.sockets.sockets.get(participant);
      if (peer) {
        peer.leave(code);
        peer.data.roomCode = null;
      }
    }
    rooms.delete(code);
    });
    callback({ ok: true });
  });

  socket.on("buyWeapon", (weaponId, callback = () => {}) => {
    callback({ ok: false, error: "Find guns in weapon chests and enemy drops. Previously owned guns are still yours." });
  });
  for (const [event, operation] of [["buySkin", buySkin], ["equipSkin", equipSkin]]) {
    playerHandler(event, (skinId, callback) => {
      if (event === "equipSkin" && [...rooms.values()].some((room) => room.phase !== "lobby" &&
        [...room.players.values()].some((player) => player.identity === socket.data.identity))) {
        return callback({ ok: false, error: "Outfit locked during deployment. Equip it before a mission." });
      }
      const result = operation(socket.data.identity, skinId);
      if (result.ok) afterCommit(() => {
        syncPlayerProfile(socket.data.identity, result.profile);
        if (event === "equipSkin") for (const room of rooms.values()) for (const player of room.players.values()) {
          if (player.identity === socket.data.identity) player.skinId = result.profile.equippedSkinId;
        }
      });
      callback(result);
    });
  }
  playerHandler("equipWeapon", (weaponId, callback) => {
    const room = rooms.get(socket.data.roomCode);
    if (room && room.phase !== "lobby") return callback({ ok: false, error: "Loadout locked during deployment." });
    const result = equipWeapon(socket.data.identity, weaponId);
    if (result.ok) afterCommit(() => {
      if (room) {
        const player = room.players.get(socket.id);
        if (player) {
          player.profile = result.profile;
          player.weaponId = result.profile.equippedWeaponId;
          const weapon = applyCombatLoadout(player, room);
          player.ammo = weapon.magSize;
          player.reserve = weapon.reserve;
        }
      }
      socket.emit("profile", result.profile);
    });
    callback(result);
  });
  playerHandler("selectClass", (classId, callback) => {
    const room = rooms.get(socket.data.roomCode);
    if (room && !["lobby", "ended"].includes(room.phase)) return callback({ ok: false, error: "Operator class locked during deployment." });
    const result = selectClass(socket.data.identity, classId);
    if (result.ok) afterCommit(() => {
      syncPlayerProfile(socket.data.identity, result.profile);
      if (room?.players.has(socket.id)) {
        const player = room.players.get(socket.id);
        player.classId = classId;
        const weapon = applyCombatLoadout(player, room);
        player.ammo = weapon.magSize;
        player.reserve = weapon.reserve;
        io.to(room.code).emit("state", publicState(room));
      }
    });
    callback(result);
  });
  playerHandler("careerStatus", (_input, callback) => callback({ ok: true, profile: getProfile(socket.data.identity), serverNow: Date.now() }));
  playerHandler("rankings", (input, callback) => callback(readRankings(socket.data.identity, input)));
  playerHandler("publicProfile", (input, callback) => callback(publicProfile(socket.data.identity, input.tag)));
  playerHandler("socialStatus", (_input, callback) => callback(socialStatus(socket.data.identity)));
  playerHandler("profileShowcase", (input, callback) => {
    const result = setShowcase(socket.data.identity, input.badges);
    if (result.ok) afterCommit(() => syncPlayerProfile(socket.data.identity, getProfile(socket.data.identity)));
    callback(result);
  });
  playerHandler("socialAction", (input, callback) => {
    if (input.action.startsWith("squad")) {
      const currentTag = getProfile(socket.data.identity).social?.squadTag;
      const locked = [...rooms.values()].some((room) => ["playing", "between"].includes(room.phase) &&
        [...room.players.values()].some((player) => player.identity === socket.data.identity ||
          player.playerTag === input.tag?.toUpperCase() || currentTag && player.profile.social?.squadTag === currentTag ||
          player.profile.social?.squadTag === input.tag?.toUpperCase() && input.tag !== undefined));
      if (locked) return callback({ ok: false, error: "Squad membership is locked while a member is deployed." });
    }
    const { affected, ...result } = socialAction(socket.data.identity, input);
    if (result.ok) afterCommit(() => {
      for (const identity of affected) {
        syncPlayerProfile(identity, getProfile(identity));
        for (const peer of io.sockets.sockets.values()) if (peer.data.identity === identity) peer.emit("socialChanged");
      }
    });
    callback(result);
  });
  playerHandler("equipProgression", (input, callback) => {
    if ([...rooms.values()].some((room) => ["playing", "between"].includes(room.phase) &&
      [...room.players.values()].some((player) => player.identity === socket.data.identity))) {
      return callback({ ok: false, error: "Progression loadout locked during deployment." });
    }
    const result = equipProgression(socket.data.identity, input);
    if (result.ok) afterCommit(() => {
      syncPlayerProfile(socket.data.identity, result.profile);
      for (const room of rooms.values()) for (const player of room.players.values()) if (player.identity === socket.data.identity) {
        const weapon = applyCombatLoadout(player, room);
        player.ammo = weapon.magSize; player.reserve = weapon.reserve;
        io.to(room.code).emit("state", publicState(room));
      }
    });
    callback(result);
  });
  socket.on("claimProgression", async (input, callback) => {
    const reply = typeof callback === "function" ? callback : (result) => {
      if (!result.ok) socket.emit("commandRejected", { event: "claimProgression", error: result.error });
    };
    try {
      const result = await claimProgression(socket.data.identity, input);
      if (result.ok) syncPlayerProfile(socket.data.identity, result.profile);
      reply(result);
    } catch (error) {
      console.error("Progression claim save failed:", error.code || error.name);
      reply({ ok: false, error: "Reward storage unavailable. Your claim could not be confirmed; retry safely." });
    }
  });
  socket.on("disconnect", () => {
    clearTimeout(adminExpiry);
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    removeRoomPlayer(room, socket.id);
    discardEmptyRoom(room);
  });
});

function discardEmptyRoom(room) {
  if (!room.players.size && room.advancingUntil <= Date.now() && !room.pendingResult && !room.rewardQueue && !room.pendingNpcTokens.size) {
    rooms.delete(room.code);
  }
}

function syncPlayerProfile(identity, profile) {
  for (const room of rooms.values()) for (const player of room.players.values()) {
    if (player.identity === identity) player.profile = profile;
  }
  for (const peer of io.sockets.sockets.values()) if (peer.data.identity === identity) peer.emit("profile", profile);
}

function flushKillTokens(room, now = Date.now()) {
  flushNpcRewardsAsync(room, {
    credit: commitReward,
    saved(identity, profile, tokens) {
      syncPlayerProfile(identity, profile);
      for (const peer of io.sockets.sockets.values()) if (peer.data.identity === identity) {
        peer.emit("tokensEarned", { tokens, balance: profile.tokens });
      }
    },
    failed(identity, error) {
      console.error("NPC token save failed:", error.code || error.name);
      for (const peer of io.sockets.sockets.values()) if (peer.data.identity === identity) {
        peer.emit("progressSaveError", { error: "NPC token rewards are pending. The server will retry the save." });
      }
    }
  }, now);
}

function flushMatchRewards(room, now) {
  const queue = room.rewardQueue;
  if (!queue || queue.saving || room.pendingNpcTokens.size || now < queue.retryAt) return;
  queue.saving = true;
  queue.intents ||= queue.result.rewards.map((reward) => ({
    id: crypto.randomUUID(), kind: "match", identity: reward.identity,
    xp: reward.xp, kills: reward.kills, wave: queue.result.wave, won: queue.result.won,
    mapId: room.mode === "campaign" ? room.mapId : null, tokens: reward.tokens,
    assists: reward.assists ?? 0, revives: reward.revives ?? 0,
    objectiveScore: reward.objectiveScore ?? 0, teamXp: reward.teamXp ?? 0,
    ...(reward.progression === undefined ? {} : { progression: reward.progression }),
    ...(reward.ranking === undefined ? {} : { ranking: reward.ranking })
  }));
  (async () => {
    await stageRewards(queue.intents);
    for (let index = queue.results.length; index < queue.intents.length; index++) {
      const updatedProfile = await applyReward(queue.intents[index]);
      syncPlayerProfile(queue.intents[index].identity, updatedProfile);
      const { identity: _identity, progression: _progression, ranking: _ranking, ...publicReward } = queue.result.rewards[index];
      queue.results.push({ ...publicReward, level: updatedProfile.level });
    }
    io.to(room.code).emit("matchEnded", { ...queue.result, rewards: queue.results });
    room.rewardQueue = null;
  })().catch((error) => {
    console.error("Match reward save failed:", error.code || error.name);
    queue.retryAt = Date.now() + 5000;
    io.to(room.code).emit("progressSaveError", { error: "Progress storage unavailable. Match rewards are pending; the server will retry." });
  }).finally(() => { queue.saving = false; });
}

function join(socket, room, profile, name) {
  if (socket.data.roomCode) {
    const previous = rooms.get(socket.data.roomCode);
    socket.leave(socket.data.roomCode);
    if (previous) removeRoomPlayer(previous, socket.id);
    if (previous && previous !== room) discardEmptyRoom(previous);
  }
  socket.data.roomCode = room.code;
  socket.join(room.code);
  const player = addPlayer(room, socket, socket.data.identity, profile, name);
  player.staffRole = staff.role(socket.data.identity);
  socket.emit("joined", { code: room.code, mapId: room.mapId, mode: room.mode, socketId: socket.id });
  io.to(room.code).emit("state", publicState(room));
  if (room.phase === "playing" || room.phase === "between") {
    socket.emit("matchStarted", publicState(room));
  }
}

function refreshStaff(identity) {
  for (const peer of io.sockets.sockets.values()) {
    if (peer.data.identity !== identity) continue;
    peer.emit("adminStatus", adminStatus(peer));
    const room = rooms.get(peer.data.roomCode), player = room?.players.get(peer.id);
    if (player) {
      player.staffRole = staff.role(identity);
      io.to(room.code).emit("state", publicState(room));
    }
  }
}

let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;
  if (maintenance) return;
  for (const room of rooms.values()) {
    flushKillTokens(room, now);
    if (!room.players.size && room.advancingUntil <= now && !room.pendingResult && !room.rewardQueue && !room.pendingNpcTokens.size) {
      rooms.delete(room.code);
      continue;
    }
    const result = tickRoom(room, dt, now);
    if (result) room.rewardQueue = { result, results: [], retryAt: 0 };
    flushMatchRewards(room, now);
    const broadcastInterval = room.phase === "lobby" || room.phase === "ended" ? 500 : 100;
    if (result || now - (room.lastBroadcast || 0) >= broadcastInterval) {
      room.lastBroadcast = now;
      io.to(room.code).emit("state", publicState(room, now));
    }
  }
}, 50).unref();

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => {
  try { await flushAuditQueue(); await transaction(() => audit.flush()); } catch (error) {
    console.error("Audit shutdown persistence failed:", error.code || error.name);
    process.exitCode = 1;
  }
  io.close(() => process.exit(process.exitCode || 0));
});

const host = process.env.HOST || "0.0.0.0";
server.listen(port, host, () => console.log(`Deadlight Ops server listening on http://${host}:${port}`));
