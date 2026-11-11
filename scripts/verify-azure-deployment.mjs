import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { io } from "socket.io-client";
import { WEAPONS } from "../shared/weapons.js";
import { SKINS } from "../shared/skins.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
assert.ok(typeof process.argv[2] === "string" && URL.canParse(process.argv[2]),
  "Usage: node scripts/verify-azure-deployment.mjs <https-origin>");
const origin = new URL(process.argv[2]);
assert.equal(origin.protocol, "https:", "A public HTTPS origin is required");
assert.ok(!origin.username && !origin.password, "Credentials must not be supplied in the URL");
assert.ok(origin.pathname === "/" && !origin.search && !origin.hash, "Supply only the site origin");
const sockets = [];
const request = (resource, options = {}) => fetch(new URL(resource, origin), {
  redirect: "error", signal: AbortSignal.timeout(30000), ...options
});
const emit = (socket, event, ...args) => new Promise((resolve, reject) => {
  socket.timeout(10000).emit(event, ...args, (error, response) =>
    error ? reject(error) : resolve(response));
});

function event(socket, name) {
  return new Promise((resolve, reject) => {
    const finish = (error, value) => {
      clearTimeout(timer);
      socket.off(name, success);
      socket.off("connect_error", failure);
      error ? reject(error) : resolve(value);
    };
    const success = (value) => finish(null, value);
    const failure = (error) => finish(error);
    const timer = setTimeout(() => finish(new Error(`Timed out waiting for ${name}`)), 15000);
    socket.once(name, success);
    socket.once("connect_error", failure);
  });
}

async function connect(token) {
  const socket = io(origin.origin, {
    transports: ["websocket"], autoConnect: false, reconnection: false, auth: { token }
  });
  sockets.push(socket);
  const identity = event(socket, "identity");
  socket.connect();
  return { socket, identity: await identity };
}

async function verifyBuildAsset(resource, contentType) {
  assert.match(resource, /^\/(?:index\.html|privacy\.html|assets\/[A-Za-z0-9_.-]+|(?:weapon|skin)-previews\/[A-Za-z]+\.png)$/);
  const local = fs.readFileSync(path.join(projectRoot, "dist", resource.slice(1)));
  const response = await request(resource === "/index.html" ? "/" : resource);
  assert.equal(response.status, 200, resource);
  assert.match(response.headers.get("content-type"), contentType);
  const remote = Buffer.from(await response.arrayBuffer());
  assert.equal(crypto.createHash("sha256").update(remote).digest("hex"),
    crypto.createHash("sha256").update(local).digest("hex"),
    `Live ${resource} differs from this checkout's production build`);
  return remote.toString();
}

try {
  const health = await request("/api/health");
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);
  const html = await verifyBuildAsset("/index.html", /text\/html/);
  assert.match(html, /Deadlight Ops/);
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]);
  assert.ok(assets.some((asset) => asset.endsWith(".js")), "Missing game JavaScript");
  assert.ok(assets.some((asset) => asset.endsWith(".css")), "Missing game CSS");
  for (const asset of assets) {
    await verifyBuildAsset(asset, asset.endsWith(".js") ? /javascript/ : /text\/css/);
  }
  await verifyBuildAsset("/privacy.html", /text\/html/);
  await Promise.all([
    ...Object.keys(WEAPONS).map((id) => verifyBuildAsset(`/weapon-previews/${id}.png`, /image\/png/)),
    ...Object.keys(SKINS).map((id) => verifyBuildAsset(`/skin-previews/${id}.png`, /image\/png/))
  ]);
  const image = await request("/textures/factory_wall_diff.jpg");
  assert.equal(image.status, 200);
  assert.match(image.headers.get("content-type"), /image\/jpeg/);
  assert.deepEqual([...new Uint8Array(await image.arrayBuffer()).slice(0, 2)], [255, 216]);
  const panorama = "/skies/industrial_sunset_02_puresky.hdr";
  const head = await request(panorama, { method: "HEAD" });
  assert.equal(head.status, 200);
  const size = Number(head.headers.get("content-length"));
  assert.ok(size > 1000);
  const range = await request(panorama, { headers: { Range: "bytes=0-99" } });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get("content-range"), `bytes 0-99/${size}`);
  assert.equal((await range.arrayBuffer()).byteLength, 100);
  const invalidRange = await request(panorama, { headers: { Range: `bytes=${size}-` } });
  assert.equal(invalidRange.status, 416);
  await invalidRange.arrayBuffer();
  console.log("PASS: public HTTPS, exact production HTML/JS/CSS/privacy and all 16 weapon/outfit previews, JPEG and media HEAD/206/416.");

  const leader = await connect();
  const guest = await connect();
  assert.notEqual(leader.identity.profile.id, guest.identity.profile.id);
  assert.equal(leader.identity.admin, false);
  assert.equal(guest.identity.admin, false);
  assert.equal(leader.identity.owner, false);
  assert.equal(guest.identity.owner, false);
  assert.deepEqual(guest.identity.profile.ownedSkins, ["standard"]);
  assert.equal(guest.identity.profile.equippedSkinId, "standard");
  assert.equal(guest.identity.profile.tokens, 0);
  assert.equal((await emit(guest.socket, "adminOverview")).ok, false);
  for (const [command, value] of [["adminBanReport", { reportId: "smoke-denied", kind: "player" }],
    ["adminBans", {}], ["adminUnban", "smoke-denied"]]) {
    assert.equal((await emit(guest.socket, command, value)).error, "Admin access denied.");
  }
  assert.equal((await emit(guest.socket, "buySkin", "nightwatch")).ok, false);
  assert.equal((await emit(guest.socket, "buySkin", { skinId: "nightwatch", cost: 0 })).ok, false);
  assert.equal((await emit(guest.socket, "equipSkin", "nightwatch")).ok, false);
  const suffix = crypto.randomBytes(4).toString("hex");
  const room = await emit(leader.socket, "createRoom", { mapId: "foundry", name: `SmokeLead-${suffix}` });
  assert.equal(room.ok, true, JSON.stringify(room));
  const joined = await emit(guest.socket, "joinRoom", { code: room.code, name: `SmokeWing-${suffix}` });
  assert.equal(joined.ok, true, JSON.stringify(joined));
  assert.equal((await emit(guest.socket, "startMatch")).ok, false);
  const started = event(guest.socket, "matchStarted");
  const [launched, state] = await Promise.all([emit(leader.socket, "startMatch"), started]);
  assert.equal(launched.ok, true);
  assert.equal(state.players.length, 2);
  assert.equal(state.supplies.length, 2);
  assert.ok(state.players.every((player) => player.medkits === 1));
  assert.equal((await emit(guest.socket, "useMedkit")).ok, false, "Full health cannot consume a medkit");
  assert.equal((await emit(guest.socket, "useMedkit", { health: 100, medkits: 99 })).ok, false);
  assert.ok(state.players.every((player) => player.skinId === "standard" &&
    !Object.hasOwn(player, "ownedSkins") && !Object.hasOwn(player, "tokens")));
  let updates = 0;
  guest.socket.on("state", () => { updates++; });
  await new Promise((resolve) => setTimeout(resolve, 5000));
  assert.ok(updates >= 20, `Only ${updates} live simulation snapshots arrived`);
  const token = leader.identity.token;
  const playerId = leader.identity.profile.id;
  leader.socket.disconnect();
  const returning = await connect(token);
  assert.equal(returning.identity.profile.id, playerId);
  assert.equal(returning.identity.profile.username, `SmokeLead-${suffix}`);
  console.log(`PASS: two-player WebSockets, match launch, ${updates} snapshots, identity reconnect and denied admin access.`);
  assert.equal((await emit(returning.socket, "createRoom", { mapId: "foundry", mode: "practice" })).ok, false);
  const practiceStarted = event(returning.socket, "matchStarted");
  const practice = await emit(returning.socket, "createRoom", { mapId: "range", mode: "practice" });
  assert.equal(practice.ok, true);
  assert.equal((await emit(guest.socket, "joinRoom", { code: practice.code })).ok, false);
  assert.equal((await emit(returning.socket, "startMatch")).ok, true);
  const rangeState = await practiceStarted;
  assert.equal(rangeState.enemies.length, 12);
  assert.equal(rangeState.players.length, 1);
  assert.equal(rangeState.players[0].unlimitedAmmo, true);
  assert.equal(rangeState.players[0].medkits, 0);
  assert.equal((await emit(returning.socket, "useMedkit")).ok, false);
  assert.equal(rangeState.loot.length + rangeState.supplies.length, 0);
  assert.equal((await emit(returning.socket, "practiceWeapon", "sniper")).ok, false);
  assert.equal((await emit(returning.socket, "practiceWeapon", "rifle")).ok, true);
  const me = rangeState.players[0], target = rangeState.enemies[0];
  const dx = target.position.x - me.position.x, dy = target.position.y + .9 - me.position.y;
  const dz = target.position.z - me.position.z, length = Math.hypot(dx, dy, dz);
  const direction = { x: dx / length, y: dy / length, z: dz / length };
  returning.socket.emit("move", { position: me.position, yaw: Math.atan2(-dx, -dz), pitch: Math.asin(dy / length) });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const targetHit = await emit(returning.socket, "shoot", { direction });
  assert.equal(targetHit.killed, true);
  await new Promise((resolve) => setTimeout(resolve, 1400));
  const resetState = await event(returning.socket, "state");
  assert.equal(resetState.enemies[0].health, 35);
  assert.equal(resetState.players[0].practiceStats.targets, 1);
  assert.equal(resetState.players[0].kills, 0);
  returning.socket.disconnect();
  const afterPractice = await connect(token);
  for (const field of ["tokens", "xp", "matches", "totalKills", "equippedWeaponId"]) {
    assert.equal(afterPractice.identity.profile[field], returning.identity.profile[field], `Practice changed ${field}`);
  }
  console.log("PASS: solo range, target hit/reset, unlimited reserve, owned-only guns and unchanged saved rewards.");
  const raid = await emit(afterPractice.socket, "createRoom", { mapId: "foundry", mode: "raid" });
  assert.equal(raid.ok, true);
  assert.equal((await emit(guest.socket, "joinRoom", { code: raid.code })).ok, true);
  const raidStarted = event(guest.socket, "matchStarted");
  assert.equal((await emit(afterPractice.socket, "startMatch")).ok, true);
  const raidState = await raidStarted;
  assert.equal(raidState.mode, "raid");
  assert.equal(raidState.players.length, 2);
  assert.equal(raidState.raid.stage, 0);
  assert.equal(raidState.raid.requiredMs, 12000);
  assert.ok(raidState.players.every((player) => player.medkits === 1));
  assert.equal((await emit(afterPractice.socket, "raidInteract", "raid-cache")).ok, false);
  assert.equal((await emit(afterPractice.socket, "raidInteract", { stage: 2 })).ok, false);
  assert.equal((await emit(afterPractice.socket, "useMedkit")).ok, false);
  console.log("PASS: two-player Raid launch, server-controlled uplink, denied stage skipping and authoritative medkit inventory.");
} finally {
  for (const socket of sockets) socket.disconnect();
}
