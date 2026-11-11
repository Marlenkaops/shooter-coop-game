import * as THREE from "three";
import { showBanScreen } from "./ban-screen.js";
import * as CANNON from "cannon-es";
import { io } from "socket.io-client";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  CAMPAIGN_MAPS, campaignOperationNumber, MAPS, newlyUnlockedMaps, SNIPER_REWARD_MAP, xpProgress
} from "../shared/progression.js";
import {
  ARENA_LIMIT, FLIGHT_SPEED, FLIGHT_CEILING, MAX_MEDKITS, MEDKIT_HEAL, PLAYER_MAX_HEALTH, PLAYER_HEIGHT,
  canOccupyPosition, canTraverse, getMapBuildings, getMapObstacles, getSupportHeight, hasLineOfSight, playerStance
} from "../shared/gameplay.js";
import { getTerrainHeight } from "../shared/arena-layout.js";
import { addArenaTerrain } from "./arena-terrain.js";
import { DEFAULT_WEAPON_ID, TOKENS_PER_KILL, shotDirections, WEAPONS, weaponFor } from "../shared/weapons.js";
import { canAccessMode, MODES } from "../shared/modes.js";
import { PRACTICE_MAP } from "../shared/practice.js";
import { addRangeDetails, createPracticeTarget } from "./practice-range.js";
import { RAID_REACH } from "../shared/raid.js";
import { AI_DIFFICULTIES, DEFAULT_DIFFICULTY, DIRECTOR_LABELS, ENEMY_ROLES } from "../shared/enemy-ai.js";
import { audibleEnemyCallout } from "./enemy-comms.js";
import { createRaidMarker } from "./raid-visuals.js";
import { DEFAULT_CLASS, SQUAD_CLASSES, cooperativeMode } from "../shared/teamwork.js";
import { markerPlacement, teamInteractionTarget, teamPingPayload } from "./team-ui.js";
import { createTeamVisual } from "./team-visuals.js";
import { mountRoomSocial } from "./room-social.js";
import { applyKeyboardLook, isGameplayTypingTarget } from "./input.js";
import { createTouchControls, triggerCanFire } from "./touch-controls.js";
import {
  createRefreshSampler, frameBudgetState, graphicsProfile, resolveQuality, textureDimensions, updateFrameBudget
} from "./graphics.js";
import { createGpuTimer } from "./gpu-timer.js";
import { sceneLook } from "./scene-look.js";
import { createAtmosphere, gradeAtmosphereOutput, lightingProfile } from "./atmosphere.js";
import { createDestructibleCover } from "./destructible-cover.js";
import { createPlayerBody, PLAYER_PHYSICS_STEP, setPlayerCrouching, stepPlayerPhysics } from "./player-physics.js";
import { CHRISTMAS_EVENT, eventContentAvailable } from "../shared/events.js";
import { mergedTiledBoxes, roundedCoverGeometry, tiledBox } from "./scene-geometry.js";
import {
  addArenaInteriors, addArenaSurfaceDetail, addMilitaryArena, contactShadowTexture, instancedDetail, militaryCoverMaterials
} from "./arena-visuals.js";
import { reloadPose, reloadProgress as calculateReloadProgress } from "./reload.js";
import { enemyFacingYaw } from "./enemy.js";
import { needsDetailedEnemy } from "./enemy-lod.js";
import {
  createTacticalEnemy, updateTacticalEnemy, setTacticalBody, tacticalBodyReady, tacticalHeadCenter
} from "./tactical-enemies.js";
import { fetchTacticalBody } from "./tactical-body.js";
import { createWeaponModel } from "./weapon-model.js";
import { createWeaponHands, updateWeaponHands } from "./weapon-hands.js";
import { acquireDroppedMagazine } from "./magazine.js";
import { weaponViewPose } from "./weapon-pose.js";
import { createBloodEffects } from "./blood-effects.js";
import { confirmedBloodContact } from "./blood-contact.js";
import { createLootVisual } from "./loot-visuals.js";
import { BudgetedGTAOPass } from "./ambient-occlusion.js";
import { scopeLensFov, scopeSensitivity } from "./aim.js";
import { mountAdminConsole } from "./admin-console.js";
import { mountLeaderboard } from "./leaderboard.js";
import { mountOperatorRecord } from "./operator-record.js";
import { mountCareer } from "./career-ui.js";
import { ACHIEVEMENTS, effectiveWeapon, ENDGAME_LEVEL, masteryLevel, MUTATORS } from "../shared/career.js";
import { mountUpdates } from "./updates.js";
import { loadoutMarkup } from "./loadout.js";
import { skinShopMarkup } from "./skin-shop.js";
import { skinFor } from "../shared/skins.js";
import { opticReticle } from "./optics.js";
import { disposeSceneResources } from "./scene-resources.js";
import { matteSurfaces } from "./surface-finish.js";
import { addArenaDressing } from "./arena-dressing.js";
import { addArenaArchitecture } from "./arena-architecture.js";
import { addChristmas } from "./christmas.js";
import { wickfallStoneTexture } from "./wickfall-decor.js";
import { combatDetailBudget, contactMaterial, createImpactDecals, createMuzzleSmoke, createSurfaceImpacts,
  footstepSurface, impactSurface } from "./combat-detail.js";
import { staffLabel } from "../shared/staff.js";
import { createPlayerTag, disposePlayerTag } from "./player-tag.js";
import { movementSpeed } from "../shared/movement.js";
import { createMovementPackets } from "./movement-packets.js";
import { ammoHeaderMarkup, escapeHtml, setHudMarkup } from "./hud.js";
import { ACTION_LABELS, DEFAULT_BINDINGS, actionHeld, keyLabel, normalizeBindings, rebindAction,
  shouldOfferTutorial, tutorialProgress, tutorialStep } from "./ui-preferences.js";
import { mountMenuNavigation } from "./ui-navigation.js";
import { createRecoilState, kickRecoil, stepAds, stepRecoil, weaponFeedback } from "./weapon-feedback.js";
import { createCameraFeel, kickCamera, stepCameraFeel } from "./camera-feel.js";
import { combatIntensity, createCombatAudio, createCombatMusic, createLobbyMusic } from "./combat-audio.js";
import { createDamageNumbers, createHitMarker } from "./hit-feedback.js";
import "./style.css";
import "./command-ui.css";

const root = document.querySelector("#game");
const socketUrl = import.meta.env.DEV ? `${location.protocol}//${location.hostname}:3000` : location.origin;
const socket = io(socketUrl, { auth: { token: localStorage.getItem("lastLightToken") } });
const nameKey = "lastLightName";
let profile = null;
let admin = false;
let owner = false;
let adminLoginAvailable = false;
let adminPasswordRequired = true, adminCodeRequired = true;
let adminCanLogout = false;
let adminSigningIn = false;
let selectedMap = "foundry";
let selectedMode = "campaign";
let selectedDifficulty = DEFAULT_DIFFICULTY;
let selectedMutators = [];
let roomCode = "";
let myId = "";
let state = null;
let stateReceivedAt = 0;
let previousHealth = 100;
let wasDead = false;
let playing = false;
let locked = false;
let paused = false;
let mouseFiring = false;
let mouseAiming = false;
let triggerWasHeld = false;
let lastLocalShot = -Infinity;
let lastDryFire = 0;
let medkitPending = false;
let flightVertical = 0;
let renderer, composer, bloomPass, occlusionPass, fieldSun, scene, camera, scopeCamera, scopeTarget, scopeScene, scopeHudCamera, scopeImage, weapon, weaponMagazine;
let currentWeapon = WEAPONS[DEFAULT_WEAPON_ID];
let renderedWeaponStyle = "";
let heldGun, heldHands, loadedTacticalBody, chargingHandle, reloadEndSeen = 0, reloadEjected = false;
let muzzleLight, muzzleFlash, weaponFill;
let world, worldMaterial, playerBody;
let audioContext, masterGain, mapParticles, ambientAudio, combatAudio, combatMusic, lobbyMusic, surfaceImpacts;
let arenaWeather, arenaDressing, christmas, atmosphere, combatDecals, muzzleSmoke, softContactTexture, interiorLighting, gpuTimer;
let destructibleCover;
const fieldGeometry = () => destructibleCover?.geometry || selectedMap;
let christmasEnabled = localStorage.getItem("deadlightChristmas") !== "false";
let maintenanceActive = false;
let arenaLamps = [];
let bloodEffects;
let bloodEnabled = localStorage.getItem("lastLightBlood") !== "false";
let renderedRoomCode = null, renderedWeaponId = null;
let accumulator = 0;
let recoil = 0;
const recoilState = createRecoilState();
let recoilSequence = 0;
let lastRecoilShot = -Infinity;
const cameraFeel = createCameraFeel();
const cameraMotionPreference = matchMedia("(prefers-reduced-motion: reduce)");
let reduceCameraMotion = localStorage.getItem("deadlightReduceCameraMotion") === "true";
let damageNumbersEnabled = localStorage.getItem("deadlightDamageNumbers") !== "false";
let musicVolume = readSetting("deadlightMusicVolume", .35, 0, 1);
let muzzleUntil = 0;
let crosshairSpread = 0;
let adsAmount = 0;
let bobTime = 0;
let weaponSwayX = 0;
let weaponSwayY = 0;
let lastWave = 0;
let lastLowAmmo = false;
let muted = localStorage.getItem("lastLightMuted") === "true";
let grounded = false;
let crouching = false;
let wasGroundedFrame = false;
let previousVerticalVelocity = 0;
let footstepDistance = 0;
let footstepIndex = 0;
const movementPackets = createMovementPackets();
let movementBlockedFor = 0;
let matchStartProfile = null;
let resultCanContinue = false;
let lobbyRosterKey = "";
const entities = new Map();
const keys = {};
const effectPool = [];
const shellPool = [];
const magazinePool = [];
const tracerPool = [];
const combatBurstPool = [];
const transientLightPool = [];
const ambientRotors = [];
const seenAttackIds = new Set();
let enemyGeometry;
let tacticalBodyLoadStarted = false;
const player = { position: new THREE.Vector3(0, PLAYER_HEIGHT, 10), yaw: 0, pitch: 0 };
const moveVector = new THREE.Vector3();
const previousPhysicsPosition = new CANNON.Vec3();
const interpolatedPhysicsPosition = new CANNON.Vec3();
const magazineBounds = new THREE.Box3();
const rayFrom = new CANNON.Vec3();
const rayTo = new CANNON.Vec3();
const rayResult = new CANNON.RaycastResult();
const qualitySetting = resolveQuality(new URLSearchParams(location.search).get("quality"),
  localStorage.getItem("lastLightQuality"));
const touchDevice = matchMedia("(pointer: coarse)").matches ||
  (navigator.maxTouchPoints > 0 && !matchMedia("(any-pointer: fine)").matches);
const touchPreference = localStorage.getItem("lastLightTouchControls");
const initialTouchControls = touchPreference === null ? touchDevice : touchPreference === "true";
const initialFrameTarget = Number(new URLSearchParams(location.search).get("fps") ||
  localStorage.getItem("lastLightFrameTarget")) === 60 ? 60 : 120;
const graphics = getGraphicsProfile();
const qualityLow = graphics.compact;
const combatBudget = combatDetailBudget(graphics.detail, graphics.compact);
const renderPixelRatio = getRenderPixelRatio();
let activeRenderPixelRatio = renderPixelRatio;
let renderStartedAt = 0;
const refreshSampler = createRefreshSampler();
let frameBudget = frameBudgetState();
let previousFrameAt = 0, lastPerformanceHud = 0, lastAwarenessUpdate = 0, lastShadowUpdate = 0;
let gpuMilliseconds = null;
const renderStats = { fps: 0, displayHz: 60, cpuMs: 0, gpuMs: null, targetFps: initialFrameTarget };
let performanceMode = false;
const qualityLabel = qualitySetting === "low" ? "Low" : qualitySetting === "high" ? "High" :
  qualitySetting === "ultra" ? touchDevice ? "Ultra / phone adaptive" : "Ultra adaptive" :
  touchDevice ? "Mobile adaptive" : "Adaptive";
const settings = {
  sensitivity: readSetting("lastLightSensitivity", 1, .45, 1.8),
  fov: readSetting("lastLightFov", 76, 65, 92),
  targetFps: initialFrameTarget
};
let bindings = { ...DEFAULT_BINDINGS };
const savedBindings = localStorage.getItem("deadlightBindings");
if (savedBindings) {
  try { bindings = normalizeBindings(JSON.parse(savedBindings)); }
  catch (error) { console.warn("Saved controls could not be loaded:", error.message); }
}
let bindingCapture = null;
let masterVolume = readSetting("deadlightVolume", 1, 0, 1);
let training = null, trainingOrigin = null;
let roomRequestPending = false;
let roomSessionLost = false;
let wasDowned = false, lastTeamInteractionAt = 0, activeTeamInteraction = null, teamErrorAt = 0;
const teamMarkerNodes = new Map(), markerVector = new THREE.Vector3();

function readSetting(key, fallback, minimum, maximum) {
  const stored = localStorage.getItem(key);
  if (stored === null) return fallback;
  const value = Number(stored);
  return Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback;
}

function renderArmory() {
  if (!profile) return;
  const ordered = Object.values(WEAPONS).filter((weapon) => eventContentAvailable(weapon.id)).sort((a, b) =>
    Number(b.id === profile.equippedWeaponId) - Number(a.id === profile.equippedWeaponId) ||
    Number(profile.ownedWeapons.includes(b.id)) - Number(profile.ownedWeapons.includes(a.id)));
  const cards = ordered.map((weapon) => {
    const owned = profile.ownedWeapons.includes(weapon.id);
    const equipped = profile.equippedWeaponId === weapon.id;
    const action = equipped ? "Equipped" : owned ? "Equip" : weapon.event ? "Find in Wickfall" : weapon.id === "sniper" ? "Rare loot / campaign" : "Find in chests";
    return `<div class="armory-weapon ${equipped ? "equipped" : ""}">
      <div><strong>${weapon.name}</strong><small>${weapon.category} · ${weapon.magSize} rounds · ${weapon.optic.label}</small>
        <small class="weapon-spec">${Math.round(60000 / weapon.fireInterval)} RPM · ${weapon.pellets ? `${weapon.pellets} × ${weapon.bodyDamage}` : weapon.bodyDamage} damage${weapon.pellets ? " up close" : ""}</small></div>
      <button class="secondary" data-weapon="${weapon.id}" ${equipped || !owned ? "disabled" : ""}>${action}</button>
    </div>`;
  }).join("");
  for (const container of [$("#armory"), $("#lobbyArmory")]) {
    container.innerHTML = `<div class="armory-title"><span class="eyebrow">Saved armory & loot</span><strong>${profile.ownedWeapons.length}/${ordered.length} guns</strong></div>
      <p>Collected guns equip immediately. Halloween has ended; its collected guns stay saved but cannot be used.</p>${cards}
      <div class="armory-error" role="status" aria-live="polite"></div>`;
  }
  document.querySelectorAll("[data-loadout-name]").forEach((node) => {
    node.textContent = weaponFor(profile.equippedWeaponId).name;
  });
  renderSavedLoadouts();
  renderSkinShops();
  if (paused) renderFieldLoadout();
}

function paintLoadout(id, markup) {
  const node = document.querySelector(`#${id}`);
  const expanded = node.querySelector("details")?.open || false;
  if (!setHudMarkup(node, markup)) return;
  if (expanded) node.querySelector("details").open = true;
}

function renderSavedLoadouts() {
  const markup = loadoutMarkup(profile, null, socket.connected);
  for (const id of ["menuLoadout", "lobbyLoadout"]) paintLoadout(id, markup);
}

function renderSkinShops() {
  const markup = skinShopMarkup(profile);
  for (const id of ["menuSkinShop", "lobbySkinShop"]) document.querySelector(`#${id}`).innerHTML = markup;
}

function renderFieldLoadout() {
  const me = state?.players.find((item) => item.socketId === myId);
  paintLoadout("fieldLoadout", loadoutMarkup(profile, me, socket.connected));
  const practice = state?.mode === "practice";
  $("#practiceControls").classList.toggle("hidden", !practice);
  $("#fieldTitle").textContent = practice ? "Shooting range" : "Operation in progress";
  $("#fieldReport").classList.toggle("hidden", practice);
  $("#fieldWarning").textContent = practice ? "Practice only. No XP, tokens, loot or saved statistics." :
    "The shared mission remains live while this menu is open.";
  if (practice && me) {
    const selector = $("#practiceWeapon");
    const ids = profile.ownedWeapons.join(",");
    if (selector.dataset.owned !== ids) {
      selector.innerHTML = profile.ownedWeapons.map((id) => `<option value="${id}">${WEAPONS[id].name}</option>`).join("");
      selector.dataset.owned = ids;
    }
    selector.value = me.weaponId;
    const stats = me.practiceStats;
    $("#practiceStats").textContent = `${stats.targets} targets down · ${stats.hits}/${stats.shots} shots hit · ${stats.shots ? Math.round(stats.hits / stats.shots * 100) : 0}% accuracy · ${stats.headshots} headshots`;
  }
}

function showArmoryError(message) {
  document.querySelectorAll(".armory-error").forEach((node) => { node.textContent = message; });
}

function getGraphicsProfile() {
  return graphicsProfile({
    width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio || 1,
    touch: touchDevice, quality: qualitySetting,
    memory: navigator.deviceMemory || 8, cores: navigator.hardwareConcurrency || 8,
    targetFps: initialFrameTarget
  });
}

function getRenderPixelRatio() {
  return getGraphicsProfile().pixelRatio;
}

root.innerHTML = `
  <div id="menu" class="screen menu-screen">
    <div class="menu-snow" aria-hidden="true"></div>
    <header class="site-nav"><a class="wordmark" href="#" aria-label="Deadlight Ops home"><i></i>Deadlight Ops</a>
      <nav class="command-nav" aria-label="Main navigation"><button class="secondary" data-menu-jump="deploymentOptions">Squad</button><button class="secondary" data-menu-jump="menuLoadout">Loadout</button><button class="secondary" data-menu-jump="profile">Operator</button><button class="secondary leaderboard-open">Rankings</button><button class="secondary settings-open">Settings</button></nav>
      <span class="online-dot" data-connection>Connecting to command…</span>
    </header>
    <section class="command-hero" aria-labelledby="commandTitle">
      <div class="hero-copy"><span class="season-tag"><i aria-hidden="true">✦</i> Christmas / Winterwatch</span>
        <h1 id="commandTitle">HOLD THE<span>WINTER LINE<span class="hero-period">.</span></span></h1>
        <p>Cold nights. Warm lights. No one left behind.<br>Your next operation starts with your squad.</p>
        <p id="deploymentSelection" class="deployment-selection"></p>
        <div class="hero-actions"><button id="playNow">Play now <span aria-hidden="true">↗</span></button><button id="quickMatch" class="secondary">Find a squad</button><button id="trainingStart" class="secondary">60-second drill</button></div>
        <p class="hero-note">Play now starts solo. Find a squad uses public, opt-in lobbies only.</p>
      </div>
      <div class="hero-art"><img id="selectedMapPreview" src="/map-previews/foundry.webp" alt="Overview of Ash Foundry" width="1200" height="720" fetchpriority="high" decoding="async" /><span><strong id="selectedMapName">Ash Foundry</strong><b id="selectedMapDetails">Industrial complex / 19:40</b></span></div>
    </section>
    <div class="season-strip"><span><i aria-hidden="true">✦</i> A little light in the cold</span><p>Christmas decorations across the arenas, festive range targets & a holiday standby challenge.</p><span class="season-strip-note">Same operations. Fresh atmosphere.</span></div>
    <main class="deployment-shell">
      <aside class="mission-rail">
        <div class="rail-heading"><span class="eyebrow">Campaign operations</span><strong>01 / Deployment zones</strong></div>
        <div id="maps" class="maps" role="listbox" aria-label="Mission map"></div>
        <p id="campaignStatus" class="campaign-status"></p>
        <div class="identity-field"><label for="name">Username <small>3–18 characters · unique</small></label>
          <input id="name" aria-label="Username" maxlength="18" autocomplete="nickname" /></div>
      </aside>
      <div class="mission-command">
        <div id="deploymentOptions" class="deploy-card">
          <span class="eyebrow">02 / Fireteam deployment</span>
          <h2>Your next operation</h2>
          <p>Create a new operation or join an existing fireteam with its access code.</p>
          <div class="deployment-fields"><div><label for="mode">Game mode</label><select id="mode" aria-describedby="modeDescription"></select>
          <p id="modeDescription" class="mode-description"></p></div>
          <div><label for="operatorClass">Operator class</label><select id="operatorClass" aria-describedby="classDescription"></select>
          <p id="classDescription" class="mode-description"></p></div></div>
          <details id="tacticalOptions" class="tactical-drawer"><summary>Tactics & endgame modifiers</summary><label for="tacticalDifficulty">Enemy tactics</label>
            <select id="tacticalDifficulty" aria-describedby="tacticalDescription">${Object.entries(AI_DIFFICULTIES)
              .map(([id, difficulty]) => `<option value="${id}"${id === DEFAULT_DIFFICULTY ? " selected" : ""}>${difficulty.name}</option>`).join("")}</select>
            <p id="tacticalDescription" class="mode-description">${AI_DIFFICULTIES[DEFAULT_DIFFICULTY].description} Health and damage stay the same.</p>
            <fieldset id="mutatorOptions"><legend>Endgame mutators · Level 10</legend>${Object.entries(MUTATORS).map(([id, item]) =>
              `<label><input type="checkbox" data-mutator="${id}" />${item.name}<small>${item.description}</small></label>`).join("")}</fieldset></details>
          <button id="create" aria-label="Create fireteam">Create fireteam <span>↗</span></button>
          <div class="or-rule"><span>or join by code</span></div>
          <form id="joinForm" class="join"><input id="code" aria-label="Six-digit room code" maxlength="6" autocomplete="off" placeholder="Access code" />
            <button id="join" class="secondary" type="submit">Join</button></form>
          <div id="error" class="error" role="status" aria-live="polite"></div>
        </div>
        <section id="missionBrief" class="mission-brief" aria-live="polite"></section>
      </div>
      <aside class="command-sidebar">
        <div class="sidebar-title"><span class="eyebrow">03 / Your operator</span><span class="secure-label">Secure</span></div>
        <div id="profile" class="profile">Connecting to command…</div>
        <div class="token-wallet" aria-live="polite"><span>Tokens</span><strong data-token-balance>—</strong><small>Earn ${TOKENS_PER_KILL} per NPC kill</small></div>
        <div class="operator-shortcuts">
          <button class="secondary career-open" type="button">Career & rewards</button>
          <button class="secondary records-open" type="button">Friends & squad</button>
          <button class="secondary leaderboard-open" type="button">Rankings</button>
          <button class="secondary updates-open" type="button">What's new</button>
        </div>
        <section id="menuLoadout" class="loadout-panel" aria-label="Your loadout"><p class="loadout-waiting">Your loadout will appear when connected.</p></section>
        <details class="armory-drawer"><summary><span>Change weapon</span><strong data-loadout-name>Choose your weapon</strong></summary><div id="armory" class="armory"></div></details>
        <details class="skin-shop-drawer"><summary>Outfit shop <span data-outfit-name>Field Standard</span></summary><div id="menuSkinShop" class="skin-shop"></div></details>
        <details class="controls-help"><summary>Controls · desktop & phone</summary><p>WASD move · Arrows aim · F/Ctrl fire · Right-click/Q focus · Shift sprint · Hold C crouch · Space jump · R reload · E resupply · M sound · Esc field menu</p><p>Phone: left stick moves; swipe the right side to aim. Hold Fire and drag to track targets. Focus, Sprint and Crouch toggle; tap Reload, Jump or Ammo. Landscape gives more room.</p></details>
        <details class="account-drawer"><summary>Account & admin</summary><div id="operatorId" class="operator-id"></div>
          <div class="admin-account-actions"><button class="secondary admin-open" type="button">Admin login</button>
          <button id="adminAccountLogOut" class="secondary admin-logout hidden" type="button">Log out</button></div>
          <div id="adminAccountError" class="error admin-account-error" role="status" aria-live="polite"></div></details>
        <a class="privacy-link" href="/privacy.html" target="_blank" rel="noopener">Privacy policy ↗</a>
      </aside>
    </main>
  </div>
  <div id="lobby" class="screen lobby-screen hidden">
    <div class="menu-snow" aria-hidden="true"></div>
    <header class="site-nav"><span class="wordmark"><i></i>Deadlight Ops</span><nav class="command-nav" aria-label="Lobby controls"><button class="secondary settings-open lobby-audio-open" type="button">Sound settings</button></nav><span class="online-dot" data-connection>Squad channel encrypted</span></header>
    <main class="staging-shell">
      <section class="staging-brief"><div class="eyebrow">Selected operation</div>
        <div class="staging-copy"><span id="lobbyMode">Mission briefing</span><h1 id="lobbyMap"></h1><p id="lobbyDescription"></p></div></section>
      <aside class="fireteam-panel"><div class="lobby-heading"><div><span class="eyebrow">Fireteam access</span><h2 id="lobbyCode"></h2></div><span class="status-pill">Staging</span></div>
        <div class="copy-note">Share this code with your squad. The fireteam lead controls deployment.</div>
        <div id="roster" class="roster"></div>
        <div class="token-wallet"><span>Tokens</span><strong data-token-balance>—</strong><small>Cosmetic outfit shop</small></div>
        <section id="lobbyLoadout" class="loadout-panel" aria-label="Your loadout"></section>
        <label for="lobbyClass">Operator class</label><select id="lobbyClass" aria-describedby="lobbyClassDescription"></select>
        <p id="lobbyClassDescription" class="mode-description"></p>
        <button id="start" aria-label="Launch mission">Begin deployment</button>
        <div id="lobbyError" class="error" role="status" aria-live="polite"></div>
        <p id="socialNotice" class="social-notice" role="status"></p>
        <section class="lobby-chat" aria-label="Lobby chat"><h3>Squad channel</h3>
          <div id="chatMessages" class="chat-messages" role="log" aria-live="polite"></div>
          <form id="chatForm"><label class="visually-hidden" for="chatInput">Message to the lobby</label>
            <input id="chatInput" maxlength="240" placeholder="Message your squad" autocomplete="off" required />
            <button type="submit" class="secondary">Send</button></form>
          <div id="chatError" class="error" role="status"></div></section>
        <details class="armory-drawer"><summary><span>Change weapon</span><strong data-loadout-name>Choose your weapon</strong></summary><div id="lobbyArmory" class="armory"></div></details>
        <details class="skin-shop-drawer"><summary>Outfit shop <span data-outfit-name>Field Standard</span></summary><div id="lobbySkinShop" class="skin-shop"></div></details>
        <button class="secondary admin-open" type="button">Admin login</button>
        <button class="secondary leaderboard-open" type="button">Worldwide leaderboard</button>
        <button class="secondary career-open" type="button">Career, mastery & rewards</button>
        <button class="secondary records-open" type="button">Profile, friends & squad</button>
        <button class="secondary updates-open" type="button">What's new</button>
        <a class="privacy-link" href="/privacy.html" target="_blank" rel="noopener">Privacy policy ↗</a>
      </aside>
    </main>
  </div>
  <div id="hud" class="hidden">
    <div class="damage"></div><div class="damage-direction"></div><div class="incoming-direction"></div><div class="incoming-label hidden">HOSTILE AIMING</div><div class="vignette"></div><div class="low-health"></div>
    <div class="topbar"><div class="wave"></div><i></i><div class="objective"></div><div class="hostiles"></div></div>
    <div id="raidStatus" class="raid-status hidden" aria-live="polite"><strong></strong><span></span><div><i></i></div></div>
    <div class="roomcode"></div><div class="squad"></div><div id="compass" class="compass" aria-label="Compass heading"></div><div id="killFeed" class="kill-feed" role="log" aria-label="Confirmed eliminations"></div>
    <aside id="trainingHint" class="training-hint hidden" aria-live="polite"><small>Field training</small><strong></strong><p></p><button id="trainingSkip" class="secondary" type="button">Skip drill</button></aside>
    <div class="hud-token-wallet" aria-label="Token balance"><span>Tokens</span><strong data-token-balance>—</strong></div>
    <div class="awareness hidden" aria-live="polite"><i>↑</i><span></span></div>
    <div id="enemyComms" class="enemy-comms hidden" role="status" aria-live="polite"><strong></strong><span></span></div>
    <div id="encounterPace" class="encounter-pace hidden"></div>
    <div id="teamMarkers" aria-hidden="true"></div>
    <div id="teamNotice" class="visually-hidden" role="status" aria-live="polite"></div>
    <div id="classStatus" class="class-status hidden"></div>
    <div id="downedStatus" class="downed-status hidden" role="status"><strong>DOWNED · CRAWL TO COVER</strong><span></span></div>
    <div class="scope-overlay" aria-label="Optical scope">
      <div class="scope-lens"><svg class="scope-reticle" viewBox="0 0 400 400" aria-hidden="true">
        <g fill="none" stroke="#18241c" stroke-width="1.4">
          <circle cx="200" cy="200" r="184" stroke="#e4e4cd" stroke-opacity=".26" />
          <path d="M45 200h133m44 0h133M200 45v133m0 44v133" />
          <path d="M200 237v55m-9-43h18m-14 15h10m-14 15h18m-14 15h10M200 309v13" />
          <path d="M108 193v14m25-10v6m25-10v14m84-14v14m25-10v6m25-10v14" />
          <path d="M193 108h14m-10 25h6m-4 25h2M193 242h14" />
        </g>
        <g fill="#1b291f" font-size="10" font-family="monospace" text-anchor="middle">
          <text x="136" y="219">2</text><text x="264" y="219">2</text>
          <text x="200" y="310">4</text>
        </g>
        <circle cx="200" cy="200" r="2.8" fill="#1c281f" stroke="#ebead7" stroke-width="1.2" />
      </svg></div>
      <span class="scope-label"></span>
    </div>
    <div class="crosshair"><i></i></div><span class="combat-confirm"></span>
    <div id="damageNumbersLayer" aria-hidden="true"></div>
    <div class="supply-prompt hidden" role="status"></div>
    <div class="protection hidden">Spawn shield <b></b></div>
    <div class="statusline"><button id="mute" aria-label="Toggle sound">Sound on · M</button><button id="fieldMenuButton" aria-label="Open field settings">${initialTouchControls ? "Menu" : "Settings · Esc"}</button><span id="renderStatus">${qualityLabel} · ${initialFrameTarget} FPS target</span><span id="connectionStatus">Connecting…</span><span id="assetStatus">Loading tactical characters</span></div>
    <details class="combat-legend"><summary>Controls</summary><p>WASD move · Shift sprint · C crouch · Space jump<br>Mouse / arrows aim · Right-click / Q focus<br>F / Ctrl fire · R reload · E interact<br>H medkit · M sound</p></details>
    <div class="mission-banner"><small>Deployment order</small><strong></strong><span>Containment window · Five waves</span></div>
    <div class="wave-alert"><small>Threat escalation</small><strong></strong></div>
    <div class="stats"><span class="hud-label">Health</span><div class="health">100</div><div class="healthbar"><i style="width:100%"></i></div><div class="medkit-count" aria-label="Carried medkits"></div></div>
    <div class="ammo">${ammoHeaderMarkup("AR–17 / 5.56", 0)}<b>12</b> <small>/ 72</small><div class="reload"></div></div>
    <div class="prompt">WASD to move · Click to aim</div>
    <div id="touchControls" class="touch-controls hidden" aria-label="Touch gameplay controls">
      <div class="touch-look-zone" data-touch="look" aria-hidden="true"></div>
      <div class="touch-stick" data-touch="move" role="group" aria-label="Movement joystick"><i></i><span>MOVE</span></div>
      <button class="touch-button touch-sprint" data-touch="sprint" aria-label="Toggle sprint" aria-pressed="false">Sprint</button>
      <button class="touch-button touch-crouch" data-touch="crouch" aria-label="Toggle crouch" aria-pressed="false">Crouch</button>
      <button class="touch-button touch-aim" data-touch="aim" aria-label="Toggle focus" aria-pressed="false">Focus</button>
      <button class="touch-button touch-reload" data-touch="reload" aria-label="Reload weapon">Reload</button>
      <button class="touch-button touch-jump" data-touch="jump" aria-label="Jump">Jump</button>
      <button class="touch-button touch-fire" data-touch="fire" aria-label="Fire weapon; drag to aim" aria-pressed="false">FIRE</button>
      <button class="touch-button touch-supply" data-touch="supply" aria-label="Resupply ammunition" disabled>Ammo</button>
      <button class="touch-button touch-heal" data-touch="heal" aria-label="Use medkit" disabled><span>Heal</span><b>0/3</b></button>
      <button class="touch-button touch-descend hidden" data-touch="descend" aria-label="Descend while flying">Down</button>
      <div class="touch-team-actions">
        <button class="touch-button" data-touch="interact" aria-label="Hold to revive or hack" aria-pressed="false" disabled>Hold E</button>
        <button class="touch-button" data-touch="ability" aria-label="Use class ability">Ability</button>
        <button class="touch-button" data-touch="pingEnemy" aria-label="Mark aimed enemy">Enemy</button>
        <button class="touch-button" data-touch="pingAmmo" aria-label="Mark nearby ammunition">Ammo ping</button>
        <button class="touch-button" data-touch="pingRoute" aria-label="Mark route ahead">Route</button>
      </div>
    </div>
    <div id="pause" class="pause hidden"><div class="overlay-card field-card"><div class="eyebrow">Field menu</div><strong id="fieldTitle">Operation in progress</strong>
      <div class="token-wallet"><span>Tokens</span><strong data-token-balance>—</strong><small>Earn ${TOKENS_PER_KILL} per NPC kill</small></div>
      <section id="fieldLoadout" class="loadout-panel" aria-label="Your loadout"></section>
      <section id="practiceControls" class="field-settings hidden" aria-label="Practice controls">
        <label for="practiceWeapon">Practice gun</label><select id="practiceWeapon"></select>
        <p>Your collected guns only. Switching here does not change your saved loadout.</p>
        <p id="practiceStats" aria-live="polite"></p>
        <button id="leaveRange" class="secondary" type="button">Leave range</button>
      </section>
      <button class="secondary settings-open" type="button">Settings &amp; controls</button>
      <div id="settingsContents" class="field-settings">
        <section id="settings-controls" data-settings-panel="controls" role="tabpanel" aria-labelledby="tab-controls">
        <label for="sensitivity">${initialTouchControls ? "Look" : "Mouse"} sensitivity <output id="sensitivityValue">${settings.sensitivity.toFixed(2)}×</output></label>
        <input id="sensitivity" type="range" min=".45" max="1.8" step=".05" value="${settings.sensitivity}" />
        <h3>Keyboard bindings</h3><p>Select an action, then press a key. Conflicts swap. Escape cancels. Mouse and touch controls are unchanged.</p>
        <div id="keyBindings" class="key-bindings"></div><p id="bindingStatus" role="status" aria-live="polite"></p>
        <button id="resetBindings" class="secondary" type="button">Reset keyboard controls</button>
        <p>Controller menus: D-pad / left stick to navigate, A to select, B to close. In-game controller aiming is not yet supported.</p>
        </section>
        <section id="settings-graphics" data-settings-panel="graphics" role="tabpanel" aria-labelledby="tab-graphics" class="hidden">
        <label for="fov">Field of view <output id="fovValue">${Math.round(settings.fov)}°</output></label>
        <input id="fov" type="range" min="65" max="92" step="1" value="${settings.fov}" />
        <label for="qualitySelect"><span>Graphics quality</span></label>
        <select id="qualitySelect" aria-describedby="qualityNote">
          <option value="auto" ${!qualitySetting ? "selected" : ""}>Auto${touchDevice ? " · phone balanced" : " · adaptive"}</option>
          <option value="low" ${qualitySetting === "low" ? "selected" : ""}>Low · battery saver</option>
          <option value="high" ${qualitySetting === "high" ? "selected" : ""}>High · full scenery detail</option>
          <option value="ultra" ${qualitySetting === "ultra" ? "selected" : ""} ${touchDevice && qualitySetting !== "ultra" ? "disabled" : ""}>Ultra${touchDevice ? " · desktop only" : " · maximum detail"}</option></select>
        <p id="qualityNote" class="refresh-note">Current: ${qualityLabel}. Detail adds scenery, bullet marks, smoke and resting casings; it applies the next time the game loads.</p>
        <button id="applyQuality" class="secondary hidden" type="button">Reload with new graphics</button>
        <label for="frameTarget"><span>Frame-rate target</span></label>
        <select id="frameTarget"><option value="120" ${initialFrameTarget === 120 ? "selected" : ""}>120 FPS / high refresh</option>
          <option value="60" ${initialFrameTarget === 60 ? "selected" : ""}>60 FPS / balanced</option></select>
        <p class="refresh-note">120 FPS needs a 120 Hz screen and sufficient GPU performance. Enable high refresh in your device settings; the browser may limit it in battery-saving mode.</p>
        <output id="performanceReadout" class="performance-readout">Measuring display cadence...</output>
        <label class="toggle-setting" for="christmasEnabled"><span>Christmas decorations, lights &amp; snow</span><input id="christmasEnabled" type="checkbox" ${christmasEnabled ? "checked" : ""} /></label>
        <button id="fullscreen" class="secondary ${document.fullscreenEnabled ? "" : "hidden"}" type="button">Toggle fullscreen</button>
        </section>
        <section id="settings-audio" data-settings-panel="audio" role="tabpanel" aria-labelledby="tab-audio" class="hidden">
        <label for="masterVolume">Master volume <output id="volumeValue">${Math.round(masterVolume * 100)}%</output></label>
        <input id="masterVolume" type="range" min="0" max="1" step=".05" value="${masterVolume}" />
        <label for="musicVolume">Lobby &amp; combat music <output id="musicVolumeValue">${Math.round(musicVolume * 100)}%</output></label>
        <input id="musicVolume" type="range" min="0" max="1" step=".05" value="${musicVolume}" />
        <p>Original acoustic-style Winterwatch music plays in menus and the fireteam lobby after a click, tap or keypress. It stops on deployment. The combat score builds as enemies close in. Enemy and squad gunfire is directional; headphones recommended.</p>
        <button id="fieldMute" class="secondary" aria-label="Toggle sound from field menu"></button>
        </section>
        <section id="settings-gameplay" data-settings-panel="gameplay" role="tabpanel" aria-labelledby="tab-gameplay" class="hidden">
        <label class="toggle-setting" for="touchEnabled"><span>On-screen touch controls</span><input id="touchEnabled" type="checkbox" ${initialTouchControls ? "checked" : ""} /></label>
        <label class="toggle-setting" for="bloodEnabled"><span>Blood effects</span><input id="bloodEnabled" type="checkbox" ${bloodEnabled ? "checked" : ""} /></label>
        <label class="toggle-setting" for="damageNumbers"><span>Confirmed damage numbers</span><input id="damageNumbers" type="checkbox" ${damageNumbersEnabled ? "checked" : ""} /></label>
        <details><summary>Controls</summary><p>WASD move · Mouse or arrows aim · Right-click or Q focus · F/Ctrl fire · Shift sprint · Hold C crouch (descend during flight) · Space jump · R reload · E ammo container · M mute · Esc menu</p><p>Touch: left stick moves · right-side swipe aims · hold Fire and drag to aim · Focus / Sprint / Crouch toggle · tap Jump / Reload / Ammo. Semi-auto guns fire once per tap.</p></details>
        <p>Use the 60-second drill from the main menu to learn movement, shooting and reloading. Reviving and squad pings arrive in the teamwork phase; the current game uses timed respawns.</p>
        </section>
        <section id="settings-accessibility" data-settings-panel="accessibility" role="tabpanel" aria-labelledby="tab-accessibility" class="hidden">
          <label for="hudScale">HUD scale <output id="hudScaleValue"></output></label><input id="hudScale" type="range" min=".8" max="1.15" step=".05" value="${readSetting("deadlightHudScale", 1, .8, 1.15)}" />
          <label class="toggle-setting" for="reduceMotion"><span>Reduce interface motion</span><input id="reduceMotion" type="checkbox" /></label>
          <label class="toggle-setting" for="reduceCameraMotion"><span>Reduce camera motion</span><input id="reduceCameraMotion" type="checkbox" ${reduceCameraMotion ? "checked" : ""} /></label>
          <p>Disables extra shake, walking bob, landing dip and sprint FOV kick. Aiming zoom and weapon recoil stay unchanged. System reduced motion also disables these camera effects.</p>
          <label class="toggle-setting" for="colorblind"><span>High-contrast blue / amber indicators</span><input id="colorblind" type="checkbox" /></label>
          <p>System reduced-motion preferences are also respected. Status labels and hit-marker shapes distinguish events without relying only on color. HUD scale changes information panels, not aiming or touch hit areas.</p>
        </section>
      </div>
      <div class="field-settings">
        <button class="secondary admin-open" type="button">Admin login</button>
        <button id="fieldReport" class="secondary" type="button">Report a player</button>
        <a class="privacy-link" href="/privacy.html" target="_blank" rel="noopener">Privacy policy ↗</a>
      </div>
      <button id="resume" aria-label="Resume operation">Resume operation <span>Enter</span></button>
      <small id="fieldWarning" class="warning">The shared mission remains live while this menu is open.</small></div></div>
    <div id="death" class="death hidden"><div class="overlay-card"><div class="eyebrow">Operator down</div><strong>Redeployment inbound</strong><span></span><small>Hold position. Fireteam coverage advised.</small></div></div>
  </div>
  <div id="results" class="screen results-screen hidden"><main class="results"><div class="eyebrow">After action report</div>
    <h2 id="resultTitle"></h2><p id="resultText"></p><div id="resultSummary" class="result-summary"></div>
    <div id="unlockReport" class="unlock-report hidden"></div>
    <p id="campaignReport" class="campaign-result"></p><div id="resultError" class="error" role="status"></div>
    <table><thead><tr><th>Operator</th><th>Eliminations</th><th>Experience</th><th>Clearance</th></tr></thead><tbody></tbody></table>
    <div class="result-actions"><button id="continue" class="hidden">Continue campaign <span>↗</span></button><button id="replay">Replay operation <span>↻</span></button><button id="return" class="secondary">Return to operations</button></div>
  </main></div>
  <div id="reportPanel" class="admin-panel hidden" role="dialog" aria-modal="true" aria-labelledby="reportTitle">
    <div class="overlay-card report-card"><h2 id="reportTitle">Report a player</h2>
      <p>Describe what happened. Reports are private and reviewed by administrators, not automatic bans. Do not include personal information.</p>
      <form id="reportForm"><label for="reportTarget">Room player</label><select id="reportTarget" required></select>
        <label for="reportReason">Why are you reporting them?</label>
        <textarea id="reportReason" minlength="8" maxlength="500" rows="4" required></textarea>
        <div id="reportError" class="error" role="status" aria-live="polite"></div>
        <button id="reportSubmit" type="submit">Send private report</button></form>
      <button id="reportClose" type="button" class="secondary">Close</button></div>
  </div>
  <aside id="serverAnnouncement" class="server-announcement hidden" aria-label="Server announcement"><p role="status" aria-live="polite"></p><button id="dismissAnnouncement" class="secondary" type="button" aria-label="Dismiss announcement">Close</button></aside>
  <div id="adminPanel" class="admin-panel hidden" role="dialog" aria-modal="true" aria-labelledby="adminTitle">
    <div class="overlay-card admin-card">
      <header class="admin-header">
        <div class="admin-brand"><span class="admin-emblem" aria-hidden="true">A</span><div>
          <span class="eyebrow">Deadlight Ops / Admin</span><strong id="adminTitle">Admin sign-in</strong>
          <p id="adminIntro">Enter the administrator credentials configured for this server.</p>
        </div></div>
        <button id="adminClose" class="secondary admin-close" type="button" aria-label="Close admin panel">×</button>
      </header>
      <div class="admin-body">
      <form id="adminSignIn" class="admin-sign-in">
        <label for="adminUsername">Username</label>
        <input id="adminUsername" name="username" autocomplete="username" maxlength="64" required aria-describedby="adminLoginError" />
        <label for="adminPassword">Password</label>
        <input id="adminPassword" name="password" type="password" autocomplete="current-password" maxlength="128" required aria-describedby="adminLoginError" />
        <label for="adminVerification">One-use verification code</label>
        <input id="adminVerification" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" autocapitalize="off" spellcheck="false" maxlength="16" required aria-describedby="adminLoginError adminCodeHint" />
        <small id="adminCodeHint">Enter one of your private six-digit staff codes. Each code works once.</small>
        <div id="adminLoginError" class="error" role="status" aria-live="polite"></div>
        <button id="adminSubmit" type="submit">Sign in</button>
      </form>
      <div id="adminSupport" class="admin-support hidden">
        <label for="adminGun">Grant a permanent gun</label>
        <div class="admin-inline"><select id="adminGun"></select><button id="adminGrantGun" class="secondary" type="button">Grant gun</button></div>
        <div class="admin-unlock-options"><button id="adminHeal" class="secondary" type="button">Heal live player</button>
          <button id="adminAmmo" class="secondary" type="button">Refill live ammo</button></div>
      </div>
      <div id="adminTools" class="hidden">
        <section class="admin-command-panel" aria-label="Administrator commands">
          <div class="admin-workspace-heading"><div><h3>Commands</h3><p>Prefix: ? · Use ?help for every command.</p></div><button id="adminCommandHelp" class="secondary" type="button">?help</button></div>
          <form id="adminCommandForm"><label class="visually-hidden" for="adminCommandInput">Administrator command</label><input id="adminCommandInput" maxlength="500" placeholder='?fly "Player Name"' autocomplete="off" spellcheck="false" required /><button id="adminCommandSubmit" type="submit">Run</button></form>
          <div id="adminCommandError" class="error" role="status"></div>
          <div id="adminCommandOutput" class="admin-command-output" role="log" aria-live="polite"></div>
          <div id="adminPrivateCodes" class="admin-private-codes hidden"></div>
          <button id="adminClearCodes" class="secondary" type="button">Clear private codes</button>
          <p id="adminOwnerNote" class="admin-owner-note">Only the verified owner can use ?role and ?codes. Developer and co-owner tags do not grant owner permissions.</p>
        </section>
        <section class="admin-workspace" aria-label="Player controls">
          <div class="admin-workspace-heading"><div><h3>Player controls</h3>
            <p>Select a player. All their controls are right here.</p></div>
            <button id="adminProfileSelf" type="button" class="secondary">My profile</button></div>
          <form id="adminProfileSearch" class="admin-search">
            <label for="adminProfileQuery">Find a player</label>
            <input id="adminProfileQuery" maxlength="64" placeholder="Username or player ID" autocomplete="off" />
            <button type="submit" class="secondary">Search</button>
          </form>
          <div id="adminProfileResults" class="admin-profile-results"></div>
          <div class="admin-row"><button id="adminProfilePrevious" class="secondary hidden" type="button">Previous profiles</button>
            <button id="adminProfileNext" class="secondary hidden" type="button">Next profiles</button></div>
          <div id="adminSelectedProfile" class="admin-profile-detail"></div>
          <form id="adminProgression" class="admin-progression hidden">
            <div class="admin-level-control">
              <label for="adminLevel">Player level</label>
              <div class="admin-inline"><input id="adminLevel" type="number" inputmode="numeric" min="1" step="1" required />
                <button type="submit" data-operation="setLevel" class="secondary">Apply level</button></div>
              <small>Choose a whole number, starting at 1.</small>
            </div>
            <div class="admin-unlock-control"><span class="admin-control-label">Guns & maps</span>
              <button type="submit" data-operation="unlockAll" formnovalidate>Unlock all guns & maps</button>
              <div class="admin-unlock-options">
                <button type="submit" data-operation="unlockWeapons" class="secondary" formnovalidate>Guns only</button>
                <button type="submit" data-operation="unlockMaps" class="secondary" formnovalidate>Maps only</button>
              </div>
            </div>
          </form>
          <div id="adminProfileError" class="error" role="status"></div>
          <p id="adminProfileNotice" role="status"></p>
        </section>
        <details id="adminRoomSection" class="admin-fold">
          <summary><span>Rooms<small>Join a match or manage the squad</small></span><span id="adminRoomCount" class="admin-fold-count"></span></summary>
          <div class="admin-fold-body"><div id="adminRooms" role="status"></div>
            <div id="adminError" class="error" role="status"></div>
            <button id="adminRefresh" class="secondary" type="button">Refresh rooms</button></div>
        </details>
        <details id="adminStorageSection" class="admin-fold">
          <summary><span>Saved progress<small>Storage and backup status</small></span></summary>
          <div class="admin-fold-body"><p id="adminStorageStatus" role="status"></p>
            <button id="adminStorageRefresh" class="secondary" type="button">Check storage</button>
            <div id="adminStorageError" class="error" role="status"></div></div>
        </details>
        <details id="adminLogSection" class="admin-fold">
          <summary><span>Activity & anti-cheat<small>Review server events when you need to</small></span></summary>
          <div class="admin-fold-body">
          <p>Flags are evidence for review, not proof of cheating. No automatic bans for lag.</p>
          <label for="adminLogKind">Log category</label>
          <select id="adminLogKind"><option value="">All categories</option><option value="admin">Admin actions</option>
            <option value="auth">Sign-in / session events</option><option value="anti-cheat">Anti-cheat rejections</option></select>
          <button id="adminLogRefresh" class="secondary" type="button">Refresh logs</button>
          <div id="adminLogEntries"></div>
          <button id="adminLogOlder" class="secondary hidden" type="button">Older entries</button>
          <div id="adminLogError" class="error" role="status"></div>
          </div>
        </details>
        <details id="adminReportSection" class="admin-fold">
          <summary><span>Player reports<small>Private review, no automatic punishment</small></span></summary>
          <div class="admin-fold-body"><p>Review the evidence before banning. Bans last until removed. IP bans can block everyone on a shared network.</p>
            <label for="adminReportStatus">Report status</label>
            <select id="adminReportStatus"><option value="open">Open</option><option value="reviewed">Reviewed</option><option value="dismissed">Dismissed</option></select>
            <button id="adminReportRefresh" type="button" class="secondary">Refresh reports</button>
            <div id="adminReportEntries"></div><button id="adminReportNext" type="button" class="secondary hidden">Next reports</button>
            <div id="adminReportError" class="error" role="status"></div></div>
        </details>
        <details id="adminBanSection" class="admin-fold">
          <summary><span>Active bans<small>Review and remove player or IP bans</small></span></summary>
          <div class="admin-fold-body"><p>Removing one ban does not remove other player or IP bans.</p>
            <button id="adminBanRefresh" type="button" class="secondary">Refresh bans</button>
            <div id="adminBanEntries"></div><button id="adminBanNext" type="button" class="secondary hidden">Next bans</button>
            <div id="adminBanError" class="error" role="status"></div></div>
        </details>
        <details id="adminAppealSection" class="admin-fold">
          <summary><span>Ban appeals<small>Read requests to be unbanned</small></span></summary>
          <div class="admin-fold-body"><p>Approve to remove the appealed ban, or reject to keep it. Other player or IP bans remain active.</p>
            <label for="adminAppealStatus">Appeal status</label>
            <select id="adminAppealStatus"><option value="open">Open</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select>
            <button id="adminAppealRefresh" type="button" class="secondary">Refresh appeals</button>
            <div id="adminAppealEntries"></div><button id="adminAppealNext" type="button" class="secondary hidden">Next appeals</button>
            <div id="adminAppealError" class="error" role="status"></div></div>
        </details>
      </div>
      </div>
      <footer class="admin-footer"><small id="adminSessionHint">Private, server-verified access.</small>
        <button id="adminSignOut" class="secondary admin-logout hidden" type="button">Log out of admin</button></footer>
    </div>
  </div>
  <dialog id="leaderboardPanel" class="leaderboard-panel" aria-labelledby="leaderboardTitle" aria-describedby="leaderboardDescription">
    <header class="leaderboard-heading"><div><span class="eyebrow">Global service records</span><h2 id="leaderboardTitle">Worldwide leaderboard</h2></div>
      <button id="leaderboardClose" class="secondary" type="button" autofocus>Close</button></header>
    <p id="leaderboardDescription">All players on this game server, including offline operators. Rankings use saved match stats and progression.</p>
    <div class="leaderboard-tabs" role="group" aria-label="Rank players by">
      <button class="secondary" type="button" data-ranking="xp" aria-pressed="true">Level &amp; XP</button>
      <button class="secondary" type="button" data-ranking="kills" aria-pressed="false">Eliminations</button>
      <button class="secondary" type="button" data-ranking="season" aria-pressed="false">Current season</button>
      <button class="secondary" type="button" data-ranking="records" aria-pressed="false">Verified records</button></div>
    <p id="leaderboardOwn" class="leaderboard-own"></p>
    <div class="leaderboard-table"><table><caption class="visually-hidden">Worldwide saved-player rankings</caption>
      <thead><tr><th scope="col">Rank</th><th scope="col">Operator</th><th id="leaderboardScore" scope="col">Level / XP</th></tr></thead>
      <tbody id="leaderboardEntries"></tbody></table></div>
    <p id="leaderboardCount" role="status" aria-live="polite"></p>
    <p id="leaderboardError" class="error" role="alert"></p>
    <footer class="leaderboard-controls"><button id="leaderboardPrevious" class="secondary" type="button">Previous</button>
      <button id="leaderboardRefresh" class="secondary" type="button">Refresh</button>
      <button id="leaderboardNext" class="secondary" type="button">Next</button></footer>
    <p class="leaderboard-note">Practice does not count. Scores update after match rewards are saved. Temporary hosting can reset rankings.</p>
  </dialog>
  <dialog id="updatesPanel" class="leaderboard-panel updates-panel" aria-labelledby="updatesTitle">
    <header class="leaderboard-heading"><div><span class="eyebrow" id="updateDate"></span><h2 id="updatesTitle">What's new</h2></div>
      <button id="updatesClose" class="secondary" type="button" autofocus>Got it</button></header>
    <p id="updateRelease" class="update-release"></p>
    <ul id="updateChanges"></ul>
    <p class="leaderboard-note">This first-stage combat update does not add physical ragdolls, destructible maps or seasonal rankings.</p>
  </dialog>
  <dialog id="tutorialPanel" class="leaderboard-panel tutorial-panel" aria-labelledby="tutorialTitle" aria-describedby="tutorialDescription">
    <span class="eyebrow">Welcome, operator</span><h2 id="tutorialTitle">First time playing?</h2>
    <p id="tutorialDescription">Want a quick tutorial? Learn to move, aim, shoot and reload in the solo range, then take down your first target.</p>
    <p>You can skip it and play right away, or replay it anytime using the 60-second drill in the menu.</p>
    <div class="tutorial-actions"><button id="tutorialAccept" type="button" autofocus>Start tutorial</button><button id="tutorialDismiss" class="secondary" type="button">Skip for now</button></div>
  </dialog>
  <dialog id="settingsPanel" class="settings-panel" aria-labelledby="settingsTitle"><header class="panel-heading"><div><span class="eyebrow">Make it yours</span><h2 id="settingsTitle">Settings</h2></div><button id="settingsClose" class="secondary" autofocus>Done</button></header>
    <div class="settings-tabs" role="tablist" aria-label="Settings categories">${["controls", "gameplay", "graphics", "audio", "accessibility"].map((tab, index) => `<button id="tab-${tab}" class="secondary" role="tab" aria-controls="settings-${tab}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}" data-settings-tab="${tab}">${tab[0].toUpperCase() + tab.slice(1)}</button>`).join("")}</div></dialog>
  <div id="deploymentLoading" class="deployment-loading hidden" role="status" aria-live="polite"><span class="eyebrow">Deployment link</span><strong>Preparing your operation…</strong><p>Tip: stay near cover, reload between encounters, and watch your squad.</p></div>
  <dialog id="connectionPanel" class="connection-panel hidden" role="alertdialog" aria-modal="true" aria-labelledby="connectionTitle"><div class="overlay-card"><span class="eyebrow">Connection interrupted</span><h2 id="connectionTitle">Your squad link is offline.</h2><p>No need to clear your browser data. Your operator identity stays saved on this device. Check your connection, then retry. If your room closed, join again using its code.</p><p id="connectionDetail"></p><button id="connectionRetry">Retry connection</button><button id="connectionReturn" class="secondary">Return to operations</button><button id="connectionDismiss" class="secondary">Dismiss</button></div></dialog>`;

const $ = (selector) => document.querySelector(selector);
root.classList.toggle("christmas-active", christmasEnabled && CHRISTMAS_EVENT.active);
root.classList.toggle("reduce-camera-motion", reduceCameraMotion);
$("#settingsPanel").append($("#settingsContents"));
mountMenuNavigation(root);
document.querySelectorAll("[data-menu-jump]").forEach((button) => {
  button.onclick = () => {
    const target = document.getElementById(button.dataset.menuJump);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches || $("#reduceMotion").checked;
    target.scrollIntoView({ block: "center", behavior: reduced ? "instant" : "smooth" });
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
  };
});
document.querySelectorAll(".settings-open").forEach((button) => {
  button.onclick = () => {
    if (playing) setPaused(true);
    resetGameplayInput();
    if (button.classList.contains("lobby-audio-open")) selectSettingsTab("audio");
    $("#settingsPanel").showModal();
  };
});
$("#settingsClose").onclick = () => $("#settingsPanel").close();
$("#settingsPanel").addEventListener("close", () => { bindingCapture = null; renderBindings(); resetGameplayInput(); });
function selectSettingsTab(tab) {
  document.querySelectorAll("[data-settings-tab]").forEach((button) => {
    const selected = button.dataset.settingsTab === tab;
    button.setAttribute("aria-selected", String(selected)); button.tabIndex = selected ? 0 : -1;
  });
  document.querySelectorAll("[data-settings-panel]").forEach((panel) => panel.classList.toggle("hidden", panel.dataset.settingsPanel !== tab));
}
document.querySelectorAll("[data-settings-tab]").forEach((button, index, buttons) => {
  button.onclick = () => selectSettingsTab(button.dataset.settingsTab);
  button.onkeydown = (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.code)) return;
    event.preventDefault(); event.stopPropagation();
    const next = event.code === "Home" ? 0 : event.code === "End" ? buttons.length - 1 :
      (index + (event.code === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].click(); buttons[next].focus();
  };
});
function renderBindings() {
  $("#keyBindings").innerHTML = Object.entries(bindings).map(([action, code]) =>
    `<button class="secondary" type="button" data-bind="${action}" aria-label="Rebind ${ACTION_LABELS[action]}"><span>${ACTION_LABELS[action]}</span><kbd>${bindingCapture === action ? "Press key..." : keyLabel(code)}</kbd></button>`).join("");
  const label = (action) => keyLabel(bindings[action]);
  const help = `${label("forward")}/${label("left")}/${label("backward")}/${label("right")} move · Mouse / arrows aim · Click / ${label("fire")} fire · Right-click / ${label("aim")} focus · ${label("sprint")} sprint · ${label("crouch")} crouch · ${label("jump")} jump · ${label("reload")} reload · ${label("interact")} interact (hold to revive/hack; stay still, damage interrupts) · ${label("heal")} medkit · ${label("ability")} class ability · ${label("pingEnemy")}/${label("pingAmmo")}/${label("pingRoute")} enemy/ammo/route pings · ${label("mute")} sound · Esc field menu`;
  for (const selector of [".controls-help p", ".combat-legend p", "#settings-gameplay details p"]) $(selector).textContent = help;
  updateMuteButton();
}
renderBindings();
$("#keyBindings").onclick = (event) => {
  const button = event.target.closest("[data-bind]");
  if (!button) return;
  bindingCapture = button.dataset.bind; renderBindings();
  $(`[data-bind="${bindingCapture}"]`).focus();
  $("#bindingStatus").textContent = "Press a letter, number, Space or modifier. Escape cancels.";
};
document.addEventListener("keydown", (event) => {
  if (!bindingCapture) return;
  event.preventDefault(); event.stopImmediatePropagation();
  const action = bindingCapture;
  if (event.code === "Escape") { bindingCapture = null; $("#bindingStatus").textContent = "Binding cancelled."; }
  else {
    try {
      bindings = rebindAction(bindings, action, event.code);
      localStorage.setItem("deadlightBindings", JSON.stringify(bindings));
      $("#bindingStatus").textContent = `${ACTION_LABELS[action]}: ${keyLabel(bindings[action])}.`;
      bindingCapture = null;
    } catch (error) { $("#bindingStatus").textContent = error.message; }
  }
  resetGameplayInput(); renderBindings(); $(`[data-bind="${action}"]`).focus();
}, true);
$("#resetBindings").onclick = () => {
  bindings = { ...DEFAULT_BINDINGS }; bindingCapture = null;
  localStorage.removeItem("deadlightBindings"); renderBindings();
  $("#bindingStatus").textContent = "Default keyboard controls restored.";
};
function applyAccessibility() {
  const scale = Number($("#hudScale").value);
  root.style.setProperty("--hud-scale", scale);
  $("#hudScaleValue").textContent = `${Math.round(scale * 100)}%`;
  document.documentElement.classList.toggle("reduce-motion", $("#reduceMotion").checked);
  document.documentElement.classList.toggle("colorblind", $("#colorblind").checked);
}
for (const [id, key] of [["reduceMotion", "deadlightReduceMotion"], ["colorblind", "deadlightColorblind"]]) {
  $(`#${id}`).checked = localStorage.getItem(key) === "true";
  $(`#${id}`).onchange = () => { localStorage.setItem(key, String($(`#${id}`).checked)); applyAccessibility(); };
}
$("#hudScale").oninput = () => { localStorage.setItem("deadlightHudScale", $("#hudScale").value); applyAccessibility(); };
applyAccessibility();
$("#masterVolume").oninput = () => {
  masterVolume = Number($("#masterVolume").value);
  localStorage.setItem("deadlightVolume", String(masterVolume));
  $("#volumeValue").textContent = `${Math.round(masterVolume * 100)}%`;
  if (masterGain) masterGain.gain.setTargetAtTime(muted ? 0 : .22 * masterVolume, audioContext.currentTime, .015);
  updateLobbyMusic();
};
const damageNumbers = createDamageNumbers($("#damageNumbersLayer"));
const hitMarker = createHitMarker($(".crosshair"));
$("#damageNumbers").onchange = () => {
  damageNumbersEnabled = $("#damageNumbers").checked;
  localStorage.setItem("deadlightDamageNumbers", String(damageNumbersEnabled));
  damageNumbers.clear();
};
$("#reduceCameraMotion").onchange = () => {
  reduceCameraMotion = $("#reduceCameraMotion").checked;
  localStorage.setItem("deadlightReduceCameraMotion", String(reduceCameraMotion));
  root.classList.toggle("reduce-camera-motion", reduceCameraMotion);
};
$("#musicVolume").oninput = () => {
  musicVolume = Number($("#musicVolume").value);
  localStorage.setItem("deadlightMusicVolume", String(musicVolume));
  $("#musicVolumeValue").textContent = `${Math.round(musicVolume * 100)}%`;
  updateCombatAudio();
  updateLobbyMusic();
};
$("#connectionRetry").onclick = () => {
  $("#connectionDetail").textContent = "Reconnecting to command…";
  socket.connect();
};
$("#connectionDismiss").onclick = () => $("#connectionPanel").close();
$("#connectionReturn").onclick = () => location.reload();
$("#connectionPanel").addEventListener("close", () => $("#connectionPanel").classList.add("hidden"));
const adminConsole = mountAdminConsole(socket, { isAdmin: () => admin, isOwner: () => owner, currentProfile: () => profile });
const operatorUI = mountOperatorRecord(socket);
mountLeaderboard(socket, { openProfile: operatorUI.open });
const careerUI = mountCareer(socket, { getProfile: () => profile,
  updateProfile: (next) => { profile = next; renderProfile(); renderArmory(); renderMaps(); } });
function offerTutorial(next) {
  if (!shouldOfferTutorial(next, localStorage.getItem("deadlightTutorialChoice"),
    localStorage.getItem("deadlightTrainingComplete")) || playing || roomCode || maintenanceActive ||
    !socket.connected || $("#menu").classList.contains("hidden") ||
    sessionStorage.getItem("lastLightCampaignRoom") ||
    document.querySelector("dialog[open], #adminPanel:not(.hidden), #reportPanel:not(.hidden), .ban-screen")) return;
  $("#tutorialPanel").showModal();
}
socket.on("identity", ({ profile: next }) => offerTutorial(next));
for (const dialog of [$("#updatesPanel"), $("#settingsPanel")]) {
  dialog.addEventListener("close", () => offerTutorial(profile));
}
function dismissTutorial() {
  localStorage.setItem("deadlightTutorialChoice", "skipped");
  $("#tutorialPanel").close();
  $("#playNow").focus();
}
$("#tutorialDismiss").onclick = dismissTutorial;
$("#tutorialPanel").addEventListener("cancel", (event) => {
  event.preventDefault();
  dismissTutorial();
});
$("#tutorialAccept").onclick = () => $("#trainingStart").click();
mountUpdates(socket, { canAutoShow: () => !playing && !maintenanceActive });
const roomSocial = mountRoomSocial(socket, { beforeReport: () => {
  if (playing) setPaused(true);
  document.exitPointerLock?.();
} });
const touchControls = createTouchControls($("#touchControls"), {
  enabled: initialTouchControls,
  onLook: (dx, dy) => {
    if (!playing || paused || wasDead) return;
    const zoom = currentWeapon.optic.zoom;
    const sensitivity = .003 * settings.sensitivity *
      (zoom > 1 ? scopeSensitivity(adsAmount, zoom) : 1 - adsAmount * .32);
    player.yaw -= dx * sensitivity;
    player.pitch = THREE.MathUtils.clamp(player.pitch - dy * sensitivity, -1.45, 1.45);
    weaponSwayX = THREE.MathUtils.clamp(weaponSwayX + dx * .00045, -.045, .045);
    weaponSwayY = THREE.MathUtils.clamp(weaponSwayY + dy * .00035, -.035, .035);
  },
  onAction: (action) => {
    if (!playing || paused || wasDead) return;
    if (action === "reload") requestReload();
    if (action === "supply") useNearbySupply();
    if (action === "heal") requestMedkit();
    if (action === "jump") jump();
    if (action === "ability") requestClassAbility();
    if (action.startsWith("ping")) requestTeamPing(action.slice(4).toLowerCase());
  },
  onInteract: unlockAudio
});
touchControls.setEnabled(initialTouchControls);

function resetGameplayInput() {
  mouseFiring = mouseAiming = triggerWasHeld = false;
  for (const code of Object.keys(keys)) keys[code] = false;
  touchControls.reset();
  if (activeTeamInteraction && socket.connected) socket.emit("teamInteract", null);
  activeTeamInteraction = null;
}

for (const id of ["operatorClass", "lobbyClass"]) $(`#${id}`).onchange = (event) => {
  const selector = event.target;
  selector.disabled = true;
  socket.timeout(6000).emit("selectClass", selector.value, (error, result) => {
    selector.disabled = false;
    if (error || !result?.ok) {
      toast(error ? "CLASS SAVE TIMED OUT" : result?.error || "CLASS UNAVAILABLE", "warning");
      renderProfile();
    } else { profile = result.profile; renderProfile(); }
  });
};

function syncTouchControls() {
  touchControls.setActive(playing && !paused && !wasDead && socket.connected && !document.hidden);
}

addEventListener("blur", resetGameplayInput);
document.addEventListener("visibilitychange", () => {
  resetGameplayInput();
  syncTouchControls();
  updateLobbyMusic();
});

socket.on("connect", () => setConnectionStatus("connected"));
socket.on("disconnect", () => {
  $("#tutorialPanel").close();
  roomSessionLost ||= Boolean(roomCode);
  if (playing) setPaused(true);
  setAdminAccess({ admin: false, canLogout: false });
  $("#adminPassword").value = "";
  resetGameplayInput();
  syncTouchControls();
  setConnectionStatus("offline");
  if (!maintenanceActive && !document.querySelector(".ban-screen")) showConnectionProblem("The server connection was lost. Automatic reconnection is running.");
  if (playing) toast("COMMAND LINK LOST", "warning");
});
socket.io.on("reconnect_attempt", () => setConnectionStatus("reconnecting"));
socket.on("connect_error", (error) => {
  if (error?.data?.code === "MAINTENANCE") {
    maintenanceActive = true;
    resetGameplayInput();
    if (playing) setPaused(true);
    document.exitPointerLock?.();
    for (const dialog of document.querySelectorAll("dialog[open]")) dialog.close();
    if (!document.querySelector("#maintenanceScreen")) {
      const screen = document.createElement("iframe");
      screen.id = "maintenanceScreen";
      screen.title = "Deadlight Ops is updating";
      screen.src = new URL("/maintenance.html", socketUrl).href;
      document.body.append(screen);
    }
    return;
  }
  setConnectionStatus("error");
  if (error?.data?.code === "BANNED") {
    for (const dialog of document.querySelectorAll("dialog[open]")) dialog.close();
    socket.io.reconnection(false);
    showError(error.message);
    showBanScreen(error.data.ban || { kind: "player", reason: null, at: null, until: null });
  } else {
    showError(`Cannot reach server${error?.message ? `: ${error.message}` : ". Is npm run dev running?"}`);
    showConnectionProblem(error.message || "The server could not be reached. Check your internet connection.");
  }
});
socket.on("identity", ({ token, profile: next, admin: allowed, owner: ownerAllowed, canLogout, adminLoginAvailable: available, adminPasswordRequired: passwordRequired, adminCodeRequired: codeRequired }) => {
  setConnectionStatus("connected");
  localStorage.setItem("lastLightToken", token);
  profile = next;
  adminLoginAvailable = available === true;
  adminPasswordRequired = passwordRequired === true;
  adminCodeRequired = codeRequired !== false;
  setAdminAccess({ admin: allowed, owner: ownerAllowed, canLogout });
  $("#name").value = profile.username;
  const requestedMap = sessionStorage.getItem("lastLightSelectedMap");
  sessionStorage.removeItem("lastLightSelectedMap");
  if (profile.unlockedMaps.includes(requestedMap)) selectedMap = requestedMap;
  $("#operatorId").textContent = `Operator ID: ${profile.id}`;
  renderProfile();
  renderMaps();
  renderArmory();
  const pendingRoom = sessionStorage.getItem("lastLightCampaignRoom");
  if (pendingRoom) {
    sessionStorage.removeItem("lastLightCampaignRoom");
    socket.timeout(6000).emit("joinRoom", {
      code: pendingRoom, name: profile.username
    }, (error, reply) => {
      if (error || !reply?.ok) showError(error
        ? "Campaign reconnection timed out. Enter your fireteam code to retry."
        : reply.error);
    });
  }
});
socket.on("adminStatus", setAdminAccess);
let announcementTimer;
$("#dismissAnnouncement").onclick = () => {
  clearTimeout(announcementTimer);
  $("#serverAnnouncement").classList.add("hidden");
  $("#serverAnnouncement p").textContent = "";
};
socket.on("serverAnnouncement", ({ text, authorName, authorRole }) => {
  if (typeof text !== "string" || !text.length || text.length > 240) return;
  const prefix = authorName ? `${staffLabel(authorRole) ? `${staffLabel(authorRole)} · ` : ""}${authorName}` : "Server";
  clearTimeout(announcementTimer);
  $("#serverAnnouncement p").textContent = `${prefix}: ${text}`;
  $("#serverAnnouncement").classList.remove("hidden");
  announcementTimer = setTimeout(() => $("#dismissAnnouncement").click(), 15_000);
});
socket.on("adminSignInError", ({ error }) => { $("#adminLoginError").textContent = error; });
socket.on("commandRejected", ({ event, error }) => {
  if (event.startsWith("admin")) $("#adminError").textContent = error;
  else if (playing) toast(error, "warning");
  else showError(error);
});
socket.on("profile", (next) => { profile = next; renderProfile(); renderMaps(); renderArmory(); });
socket.on("tokensEarned", ({ tokens }) => toast(`+${tokens} TOKENS · NPC ELIMINATION`, "info"));
socket.on("joined", ({ code, mapId, mode, socketId }) => {
  $("#tutorialPanel").close();
  roomSessionLost = false;
  if (!$("#adminPanel").classList.contains("hidden")) $("#adminClose").click();
  playing = false;
  stopAmbientAudio();
  setPaused(false);
  $("#hud").classList.add("hidden");
  $("#results").classList.add("hidden");
  roomCode = code; selectedMap = mapId; selectedMode = mode; myId = socketId;
  renderMaps();
  $("#menu").classList.add("hidden"); $("#lobby").classList.remove("hidden");
  $("#lobbyCode").textContent = code;
  const map = mapId === PRACTICE_MAP.id ? PRACTICE_MAP : MAPS.find((item) => item.id === mapId);
  $("#lobbyMap").textContent = map?.name;
  $("#lobbyMode").textContent = MODES[mode].name;
  $("#lobbyDescription").textContent = MODES[mode].description;
  $("#socialNotice").textContent = "";
});
socket.on("state", (next) => {
  state = next;
  stateReceivedAt = performance.now();
  if (training && next.mode === "practice") {
    const me = next.players.find((item) => item.socketId === myId);
    if (me && trainingOrigin && Math.hypot(me.position.x - trainingOrigin.x, me.position.z - trainingOrigin.z) >= 1.5) recordTraining("move");
    if (me?.reloading) recordTraining("reload");
  }
  if (paused) renderFieldLoadout();
  roomSocial.render(next);
  if (next.phase === "lobby") updateLobby(next);
  if (next.phase === "ended") {
    const lead = next.leaderSocketId === myId;
    $("#replay").disabled = !lead;
    $("#replay").textContent = lead ? "Replay operation" : "Awaiting fireteam lead";
    $("#continue").disabled = !lead || !resultCanContinue;
  }
  if (playing) updateHud(next);
  syncEntities(next);
});
socket.on("matchStarted", (startedState) => {
  if (startedState) {
    state = startedState;
    stateReceivedAt = performance.now();
  }
  $("#settingsPanel").close();
  $("#deploymentLoading").classList.remove("hidden");
  requestAnimationFrame(() => setTimeout(() => {
    beginGame();
    $("#deploymentLoading").classList.add("hidden");
  }, 0));
});
socket.on("movementCorrection", ({ position, crouching: correctedCrouching = false }) => {
  if (!playing || !playerBody || !position) return;
  crouching = correctedCrouching;
  setPlayerCrouching(playerBody, crouching);
  playerBody.position.set(position.x, position.y - playerStance(crouching).eyeOffset, position.z);
  playerBody.velocity.setZero();
  playerBody.wakeUp();
  previousPhysicsPosition.copy(playerBody.position);
  interpolatedPhysicsPosition.copy(playerBody.position);
  player.position.set(position.x, position.y, position.z);
  movementBlockedFor = 0;
  accumulator = 0;
});
socket.on("shotEffect", ({ playerId, origin, direction, hit, hitZone, enemyId, distance, rays, hits }) => {
  addKillFeed(playerId, hits);
  const shooter = entities.get(`p${playerId}`);
  if (shooter) shooter.attackUntil = performance.now() + 140;
  const shooterWeapon = state?.players.find((item) => item.socketId === playerId)?.weaponId;
  if (playing && !muted && shooterWeapon) playPositionalReport(shooterWeapon, origin);
  if (shooter && shooterWeapon) {
    const feedback = weaponFeedback(shooterWeapon);
    shooter.flashUntil = performance.now() + feedback.muzzle.duration;
    shooter.enemyFlash.material.color.setHex(feedback.muzzle.color);
    shooter.enemyFlash.scale.setScalar(feedback.suppressed ? .45 : 1);
  }
  if (playing && rays?.length) markCoverImpacts({ rays }, origin, direction, shooterWeapon);
  for (const ray of rays || [{ direction, distance }]) {
    tracer(origin, ray.direction, hit ? 0xc8a88b : 0xd8c39c, Math.min(16, ray.distance || 16));
  }
  for (const contact of hits || (hit ? [{ enemyId, hitZone }] : [])) {
    reactEnemyHit(contact.enemyId, contact.hitZone, contact.playerId);
    emitEnemyBlood(contact, origin, contact.direction || direction);
  }
});
socket.on("matchEnded", showResults);
socket.on("identityError", ({ error }) => showError(error));
socket.on("progressSaveError", ({ error }) => {
  $("#resultError").textContent = error;
  reportRuntimeError(error);
});
socket.on("campaignAdvanced", ({ code, mapId }) => {
  if (typeof code !== "string" || !MAPS.some((map) => map.id === mapId)) {
    reportRuntimeError("Invalid campaign transition");
    return;
  }
  sessionStorage.setItem("lastLightCampaignRoom", code);
  sessionStorage.setItem("lastLightSelectedMap", mapId);
  location.reload();
});
socket.on("banned", (ban) => {
  for (const dialog of document.querySelectorAll("dialog[open]")) dialog.close();
  socket.io.reconnection(false);
  resetGameplayInput();
  if (document.pointerLockElement) document.exitPointerLock();
  showBanScreen(ban);
});
socket.on("roomClosed", (message) => {
  sessionStorage.setItem("lastLightRoomClosed", message);
  location.reload();
});
const closedMessage = sessionStorage.getItem("lastLightRoomClosed");
if (closedMessage) {
  sessionStorage.removeItem("lastLightRoomClosed");
  showError(closedMessage);
}

function setAdminAccess(status) {
  const previous = admin, previousOwner = owner;
  admin = status.admin === true;
  owner = admin && status.owner === true;
  adminCanLogout = status.canLogout === true;
  document.querySelectorAll(".admin-open").forEach((button) => {
    button.textContent = admin ? "Admin panel" : "Admin login";
  });
  $("#adminSignIn").classList.toggle("hidden", admin);
  for (const id of ["adminUsername", "adminPassword"]) {
    $(`#${id}`).required = adminPasswordRequired;
    $(`#${id}`).disabled = !adminPasswordRequired;
    $(`#${id}`).classList.toggle("hidden", !adminPasswordRequired);
    $(`label[for='${id}']`).classList.toggle("hidden", !adminPasswordRequired);
  }
  for (const element of [$("#adminVerification"), $("label[for='adminVerification']"), $("#adminCodeHint")]) {
    element.classList.toggle("hidden", !adminCodeRequired);
  }
  $("#adminVerification").required = adminCodeRequired;
  $("#adminVerification").disabled = !adminCodeRequired;
  $("#adminClearCodes").classList.toggle("hidden", !adminCodeRequired);
  $("#adminOwnerNote").textContent = `Only the verified owner can use ?role${adminCodeRequired ? " and ?codes" : ""}. Developer and co-owner tags do not grant owner permissions.`;
  $("#adminTools").classList.toggle("hidden", !admin);
  document.querySelectorAll(".admin-logout").forEach((button) => {
    button.classList.toggle("hidden", !adminCanLogout);
  });
  $("#menu .secure-label").textContent = owner ? "Owner signed in" : admin ? "Admin signed in" : "Secure";
  $("#adminSubmit").disabled = adminSigningIn || !adminLoginAvailable || !socket.connected;
  $("#adminTitle").textContent = owner ? "Owner admin panel" : admin ? "Admin panel" : "Admin sign-in";
  $("#adminSessionHint").textContent = adminCanLogout
    ? owner ? `15-minute verified owner session. Staff bans${adminCodeRequired ? ", role assignment and private code issuance are" : " and role assignment are"} available.`
      : "15-minute verified staff session. Owner-only commands remain locked."
    : admin ? "Verified admin access. Missions stay live." : "Private, server-verified access.";
  $("#adminIntro").textContent = admin
    ? owner ? `Owner tools, including staff roles${adminCodeRequired ? ", verification codes" : ""} and administrator bans.`
      : "Your tools, all in one place. Staff roles do not bypass owner-only permissions."
    : adminLoginAvailable
      ? !adminCodeRequired ? "Sign in with your admin username and password."
        : adminPasswordRequired ? "Use your configured credentials and one unused six-digit staff code."
          : "Enter one unused six-digit staff code."
      : "Admin sign-in is not configured on this server.";
  if (!admin) {
    $("#adminRooms").replaceChildren();
    $("#adminRoomCount").textContent = "";
    adminConsole.reset();
  }
  if (owner !== previousOwner && admin && $("#adminReportSection").open) $("#adminReportRefresh").click();
  if (!$("#adminPanel").classList.contains("hidden") && admin !== previous) {
    if (admin) {
      $("#adminLoginError").textContent = "";
      refreshAdmin();
      adminConsole.open();
      $("#adminProfileQuery").focus();
    } else {
      (adminPasswordRequired ? $("#adminUsername") : $("#adminVerification")).focus();
    }
  }
}

function refreshAdmin() {
  if (!admin) return;
  $("#adminError").textContent = "";
  $("#adminRooms").textContent = "Loading rooms…";
  $("#adminRoomCount").textContent = "Loading…";
  socket.timeout(6000).emit("adminOverview", (error, reply) => {
    if (!admin) return;
    if (error || !reply?.ok) {
      $("#adminRooms").textContent = error ? "Command link timed out." : reply?.error || "Request failed.";
      $("#adminRoomCount").textContent = "Unavailable";
      return;
    }
    $("#adminRoomCount").textContent = `${reply.rooms.length} ${reply.rooms.length === 1 ? "room" : "rooms"}`;
    $("#adminRooms").innerHTML = reply.rooms.length ? reply.rooms.map((room) =>
      `<div class="admin-room"><span>${escapeHtml(room.code)} · ${escapeHtml(MAPS.find((map) => map.id === room.mapId)?.name || "Unknown")} · ${escapeHtml(MODES[room.mode]?.name || "")} · ${escapeHtml(room.phase)}${room.wave ? ` · Wave ${room.wave}` : ""} · ${room.players} player(s)</span>
        <div class="admin-room-actions">${room.phase === "playing" || room.phase === "between"
            ? `<button class="secondary" data-join-room="${escapeHtml(room.code)}" ${room.members.some((member) => member.socketId === socket.id) ? "disabled" : ""}>${room.members.some((member) => member.socketId === socket.id) ? "In this room" : "Join active"}</button>
              <button class="secondary" data-restock-room="${escapeHtml(room.code)}">Restock chests</button>` : ""}
          <button class="secondary" data-close-room="${escapeHtml(room.code)}">Close room</button></div></div>
      <div class="admin-members">${room.members.map((member) =>
        `<div><span>${escapeHtml(member.name)} · ID ${escapeHtml(member.playerId)}${member.leader ? " · Lead" : ""}</span>
          <button class="secondary" data-kick-player="${escapeHtml(member.socketId)}" data-room="${escapeHtml(room.code)}">Remove</button></div>`).join("")}</div>`).join("") :
      "<p>No active rooms.</p>";
  });
}
let adminPreviousFocus = null;
document.querySelectorAll(".admin-open").forEach((button) => button.onclick = () => {
  adminPreviousFocus = button;
  $("#adminPanel").classList.remove("hidden");
  $("#adminLoginError").textContent = "";
  $("#adminPassword").value = "";
  $("#adminVerification").value = "";
  setAdminAccess({ admin, owner, canLogout: adminCanLogout });
  if (playing) setPaused(true);
  (admin ? $("#adminProfileQuery") : adminPasswordRequired ? $("#adminUsername") : $("#adminVerification")).focus();
  if (admin) {
    refreshAdmin();
    adminConsole.open();
  }
});
$("#adminClose").onclick = () => {
  $("#adminPanel").classList.add("hidden");
  $("#adminPassword").value = "";
  $("#adminVerification").value = "";
  $("#adminClearCodes").click();
  $("#adminRoomSection").open = $("#adminLogSection").open = $("#adminStorageSection").open =
    $("#adminReportSection").open = $("#adminBanSection").open = false;
  $(".admin-body").scrollTop = 0;
  adminPreviousFocus?.focus();
};
$("#adminSignIn").onsubmit = (event) => {
  event.preventDefault();
  if (adminSigningIn || !socket.connected || !adminLoginAvailable) {
    $("#adminLoginError").textContent = !socket.connected
      ? "Command link offline. Reconnect before signing in."
      : !adminLoginAvailable ? "Admin sign-in is not configured on this server." : "Sign-in is already in progress.";
    return;
  }
  // Accept pasted codes with spaces or dashes; only the six digits are sent.
  const code = $("#adminVerification").value.replace(/\D/g, "");
  if (adminCodeRequired && code.length !== 6) {
    $("#adminLoginError").textContent = "Enter the six digits of your code.";
    return;
  }
  const credentials = { ...(adminPasswordRequired ? {
    username: $("#adminUsername").value.trim(), password: $("#adminPassword").value
  } : {}), ...(adminCodeRequired ? { code } : {}) };
  $("#adminPassword").value = "";
  $("#adminVerification").value = "";
  $("#adminLoginError").textContent = "";
  adminSigningIn = true;
  $("#adminSubmit").disabled = true;
  socket.timeout(6000).emit("adminSignIn", credentials, (error, reply) => {
    adminSigningIn = false;
    setAdminAccess({ admin, owner, canLogout: adminCanLogout });
    if (error || !reply?.ok) {
      $("#adminLoginError").textContent = error
        ? "Sign-in timed out. Try again."
        : reply?.error || "Unable to sign in.";
    }
  });
};
document.querySelectorAll(".admin-logout").forEach((button) => button.onclick = () => {
  document.querySelectorAll(".admin-logout").forEach((control) => { control.disabled = true; });
  $("#adminError").textContent = "";
  $("#adminAccountError").textContent = "";
  socket.timeout(6000).emit("adminSignOut", (error, reply) => {
    document.querySelectorAll(".admin-logout").forEach((control) => { control.disabled = false; });
    if (error || !reply?.ok) {
      const message = error ? "Log out timed out. Try again." : reply?.error || "Unable to log out.";
      $("#adminError").textContent = message;
      $("#adminAccountError").textContent = message;
    }
  });
});
$("#adminRefresh").onclick = refreshAdmin;
$("#adminRoomSection").ontoggle = () => { if ($("#adminRoomSection").open && admin) refreshAdmin(); };
$("#adminRooms").onclick = (event) => {
  const button = event.target.closest("[data-close-room], [data-kick-player], [data-join-room], [data-restock-room]");
  if (!button || !admin) return;
  if (button.dataset.restockRoom) {
    if (!window.confirm(`Restock the four weapon chests in ${button.dataset.restockRoom}?`)) return;
    button.disabled = true;
    $("#adminError").textContent = "";
    socket.timeout(6000).emit("adminRestockChests", button.dataset.restockRoom, (error, reply) => {
      if (!admin) return;
      button.disabled = false;
      $("#adminError").textContent = error ? "Restock timed out. Refresh the room before retrying." :
        !reply?.ok ? reply?.error || "Unable to restock chests." : "";
    });
    return;
  }
  if (button.dataset.joinRoom) {
    const code = button.dataset.joinRoom;
    if (playing && !window.confirm(`Leave this mission and join active room ${code}? Unfinished rewards will not be saved.`)) return;
    button.disabled = true;
    $("#adminError").textContent = "";
    socket.timeout(6000).emit("joinRoom", { code, name: profile.username }, (error, reply) => {
      if (!admin) return;
      if (error || !reply?.ok) {
        $("#adminError").textContent = error ? "Joining timed out. Refresh rooms before retrying." :
          reply?.error || "Unable to join this active room.";
        button.disabled = false;
      }
    });
    return;
  }
  const code = button.dataset.closeRoom || button.dataset.room;
  const kick = Boolean(button.dataset.kickPlayer);
  if (!window.confirm(kick
    ? "Remove this player from the room?"
    : `Close room ${code} without awarding match rewards?`)) return;
  button.disabled = true;
  $("#adminError").textContent = "";
  socket.timeout(6000).emit(kick ? "adminKickPlayer" : "adminCloseRoom",
    kick ? { code, playerId: button.dataset.kickPlayer } : code, (error, reply) => {
    if (error || !reply?.ok) {
      $("#adminError").textContent = error ? "Command link timed out." :
        reply?.error || (kick ? "Unable to remove player." : "Unable to close room.");
      button.disabled = false;
      return;
    }
    refreshAdmin();
  });
};

const deploymentChoice = () => ({ mapId: selectedMap, mode: selectedMode,
  difficulty: ["practice", "ffa"].includes(selectedMode) ? DEFAULT_DIFFICULTY : selectedDifficulty,
  mutators: ["practice", "ffa"].includes(selectedMode) ? [] : selectedMutators });
$("#create").onclick = () => roomAction("createRoom", deploymentChoice());
$("#playNow").onclick = () => roomAction("createRoom", deploymentChoice(), () => {
  if (selectedMode !== "ffa") $("#start").click();
});
$("#quickMatch").onclick = () => roomAction("quickMatch", deploymentChoice());
$("#tacticalDifficulty").onchange = () => {
  selectedDifficulty = $("#tacticalDifficulty").value;
  $("#tacticalDescription").textContent = `${AI_DIFFICULTIES[selectedDifficulty].description} Health and damage stay the same.`;
};
for (const input of document.querySelectorAll("[data-mutator]")) input.onchange = () => {
  selectedMutators = [...document.querySelectorAll("[data-mutator]:checked")].map((node) => node.dataset.mutator);
};
$("#trainingStart").onclick = () => {
  localStorage.setItem("deadlightTutorialChoice", "started");
  $("#tutorialPanel").close();
  training = {};
  roomAction("createRoom", { mapId: PRACTICE_MAP.id, mode: "practice" }, () => $("#start").click());
};
$("#trainingSkip").onclick = () => { training = null; $("#trainingHint").classList.add("hidden"); };
$("#mode").onchange = () => {
  selectedMode = $("#mode").value;
  selectedMap = selectedMode === "practice" ? PRACTICE_MAP.id : selectedMap === PRACTICE_MAP.id ? CAMPAIGN_MAPS[0].id : selectedMap;
  $("#modeDescription").textContent = MODES[selectedMode].description;
  $("#quickMatch").disabled = selectedMode === "practice";
  $("#tacticalOptions").classList.toggle("hidden", ["practice", "ffa"].includes(selectedMode));
  renderMaps();
};
$("#practiceWeapon").onchange = () => {
  const selector = $("#practiceWeapon");
  selector.disabled = true;
  socket.timeout(6000).emit("practiceWeapon", selector.value, (error, result) => {
    selector.disabled = false;
    if (error || !result?.ok) toast(error ? "PRACTICE LINK TIMED OUT" : result?.error || "Unable to change practice gun.", "warning");
    renderFieldLoadout();
  });
};
$("#leaveRange").onclick = () => location.reload();
$("#joinForm").onsubmit = (event) => {
  event.preventDefault();
  roomAction("joinRoom", { code: $("#code").value.trim().toUpperCase() });
};
$("#start").onclick = () => {
  unlockAudio();
  $("#lobbyError").textContent = "";
  socket.timeout(6000).emit("startMatch", (error, reply) => {
    if (error || !reply?.ok) {
      $("#lobbyError").textContent = error ? "Deployment timed out. Try again." :
        reply?.error || "Unable to start this operation.";
    }
  });
};
$("#replay").onclick = () => {
  unlockAudio();
  $("#resultError").textContent = "";
  socket.timeout(6000).emit("startMatch", (error, reply) => {
    if (error || !reply?.ok) {
      $("#resultError").textContent = error ? "Deployment timed out. Try again." :
        reply?.error || "Unable to replay this operation.";
    }
  });
};
$("#continue").onclick = () => {
  $("#continue").disabled = true;
  $("#resultError").textContent = "";
  socket.timeout(6000).emit("advanceCampaign", (error, reply) => {
    if (error || !reply?.ok) {
      $("#resultError").textContent = error
        ? "Campaign link timed out. Try again."
        : reply?.error || "Unable to advance the campaign.";
      $("#continue").disabled = false;
    }
  });
};
$("#return").onclick = () => {
  const next = CAMPAIGN_MAPS[profile?.campaignCompleted?.length || 0];
  sessionStorage.setItem("lastLightSelectedMap",
    next && profile.unlockedMaps.includes(next.id) ? next.id : selectedMap);
  location.reload();
};
for (const container of [$("#armory"), $("#lobbyArmory")]) {
  container.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-weapon]");
    if (!button || button.disabled || !profile) return;
    const weaponId = button.dataset.weapon;
    const owned = profile.ownedWeapons.includes(weaponId);
    button.disabled = true;
    if (!owned) return;
    socket.timeout(6000).emit("equipWeapon", weaponId, (error, reply) => {
      if (error || !reply?.ok) {
        renderArmory();
        showArmoryError(error ? "Command link timed out. Try again." :
          reply?.error || "Unable to update loadout.");
        return;
      }
      profile = reply.profile;
      renderProfile();
      renderArmory();
    });
  });
}
for (const container of [$("#menuSkinShop"), $("#lobbySkinShop")]) {
  container.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-skin]");
    if (!button || button.disabled || !profile) return;
    if (!socket.connected) {
      container.querySelector(".skin-shop-error").textContent = "Command link offline. Reconnect before changing outfits.";
      return;
    }
    const action = button.dataset.skinAction, skin = skinFor(button.dataset.skin);
    if (action === "buySkin" && !window.confirm(`Buy ${skin.name} for ${skin.cost} tokens? This is a cosmetic outfit; it gives no combat advantage.`)) return;
    container.querySelectorAll("button").forEach((control) => { control.disabled = true; });
    socket.timeout(6000).emit(action, skin.id, (error, reply) => {
      if (!error && reply?.ok) {
        profile = reply.profile;
        renderProfile(); renderArmory();
      } else {
        renderSkinShops();
        const message = error ? "Outfit change timed out. Refresh before retrying." : reply?.error || "Outfit change failed.";
        document.querySelectorAll(".skin-shop-error").forEach((node) => { node.textContent = message; });
      }
    });
  });
}
$("#name").addEventListener("keydown", (event) => {
  if (event.code === "Enter") {
    event.preventDefault();
    event.currentTarget.blur();
    $("#create").click();
  }
});

document.addEventListener("keydown", handleKeyDown);
for (const event of ["pointerdown", "keydown"]) document.addEventListener(event, (interaction) => {
  if (interaction.isTrusted && !playing && CHRISTMAS_EVENT.active) unlockAudio();
}, { passive: true });
document.addEventListener("keyup", (event) => {
  keys[event.code] = false;
});
$("#mute").onclick = () => toggleMute();
$("#fieldMute").onclick = () => toggleMute();
$("#fieldMenuButton").onclick = () => setPaused(true);
$("#resume").onclick = () => setPaused(false);
$("#bloodEnabled").onchange = (event) => {
  bloodEnabled = event.currentTarget.checked;
  localStorage.setItem("lastLightBlood", String(bloodEnabled));
  if (!bloodEnabled) bloodEffects?.clear();
};
$("#christmasEnabled").onchange = (event) => {
  christmasEnabled = event.currentTarget.checked;
  localStorage.setItem("deadlightChristmas", String(christmasEnabled));
  root.classList.toggle("christmas-active", christmasEnabled && CHRISTMAS_EVENT.active);
  christmas?.setEnabled(christmasEnabled);
  for (const item of entities.values()) item.setChristmasEnabled?.(christmasEnabled);
};
$("#touchEnabled").onchange = (event) => {
  const enabled = event.currentTarget.checked;
  localStorage.setItem("lastLightTouchControls", String(enabled));
  resetGameplayInput();
  touchControls.setEnabled(enabled);
  syncTouchControls();
  $("label[for='sensitivity']").firstChild.textContent = `${enabled ? "Look" : "Mouse"} sensitivity `;
  $("#fieldMenuButton").textContent = enabled ? "Menu" : "Settings · Esc";
  $(".prompt").classList.toggle("hidden", enabled || locked || paused);
};
$("#fullscreen").onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await root.requestFullscreen();
  } catch (error) {
    toast(`FULLSCREEN UNAVAILABLE · ${error.message}`, "warning");
  }
};
document.addEventListener("fullscreenchange", () => {
  resetGameplayInput();
  if (renderer) resize();
});
$("#sensitivity").oninput = (event) => {
  settings.sensitivity = Number(event.currentTarget.value);
  localStorage.setItem("lastLightSensitivity", String(settings.sensitivity));
  $("#sensitivityValue").textContent = `${settings.sensitivity.toFixed(2)}×`;
};
$("#fov").oninput = (event) => {
  settings.fov = Number(event.currentTarget.value);
  localStorage.setItem("lastLightFov", String(settings.fov));
  $("#fovValue").textContent = `${Math.round(settings.fov)}°`;
};
$("#qualitySelect").onchange = (event) => {
  const value = event.currentTarget.value;
  localStorage.setItem("lastLightQuality", value);
  const url = new URL(location.href);
  url.searchParams.delete("quality");
  history.replaceState(null, "", url);
  const changed = (value === "auto" ? null : value) !== qualitySetting;
  $("#applyQuality").classList.toggle("hidden", !changed);
  $("#qualityNote").textContent = changed
    ? playing ? "Saved. Reloading leaves this operation; you can rejoin with its code." : "Saved. Reload to apply."
    : `Current: ${qualityLabel}.`;
};
$("#applyQuality").onclick = () => location.reload();
$("#frameTarget").onchange = (event) => {
  settings.targetFps = Number(event.currentTarget.value) === 60 ? 60 : 120;
  renderStats.targetFps = settings.targetFps;
  localStorage.setItem("lastLightFrameTarget", String(settings.targetFps));
  const url = new URL(location.href);
  url.searchParams.set("fps", String(settings.targetFps));
  history.replaceState(null, "", url);
  frameBudget = frameBudgetState(frameBudget.scale);
  renderStartedAt = performance.now();
};
addEventListener("error", (event) => reportRuntimeError(event.error?.message || event.message));
addEventListener("unhandledrejection", (event) => {
  reportRuntimeError(event.reason?.message || String(event.reason || "Unhandled client error"));
});

function isTypingTarget(target) {
  return isGameplayTypingTarget(target);
}

function handleKeyDown(event) {
  if ($("#settingsPanel").open || $("#tutorialPanel").open) return;
  if ($("#leaderboardPanel").open || $("#updatesPanel").open || $("#operatorPanel").open) return;
  if (!$("#reportPanel").classList.contains("hidden")) return;
  if (!$("#adminPanel").classList.contains("hidden")) {
    if (event.code === "Escape") {
      event.preventDefault();
      $("#adminClose").click();
    }
    if (event.code === "Tab") {
      const controls = [...$("#adminPanel").querySelectorAll("input:not(:disabled), select:not(:disabled), button:not(:disabled), summary")]
        .filter((node) => node.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    return;
  }
  if (isTypingTarget(event.target)) {
    if (event.code === "Escape") {
      event.target.blur();
      if (playing && paused) setPaused(false);
    }
    return;
  }
  if (event.target.closest?.("button, summary, a") && ["Enter", "Space"].includes(event.code)) return;
  if (event.code === "Enter") {
    if (playing && paused) setPaused(false);
    else if (!$("#lobby").classList.contains("hidden") && $("#start").style.display !== "none") $("#start").click();
    else if (!$("#menu").classList.contains("hidden")) $("#create").click();
    return;
  }
  if (!playing) return;
  if ([...Object.values(bindings), "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
    "ShiftRight", "ControlLeft", "ControlRight"].includes(event.code)) event.preventDefault();
  if (event.code === "Escape") {
    event.preventDefault();
    setPaused(!paused);
    if (locked) document.exitPointerLock?.();
    return;
  }
  keys[event.code] = true;
  if (paused || event.repeat) return;
  if (event.code === bindings.mute) toggleMute();
  if (event.code === bindings.reload) {
    requestReload();
  }
  if (event.code === bindings.interact) useNearbySupply();
  if (event.code === bindings.heal) requestMedkit();
  if (event.code === bindings.jump) jump();
  if (event.code === bindings.ability) requestClassAbility();
  for (const kind of ["Enemy", "Ammo", "Route"]) if (event.code === bindings[`ping${kind}`]) requestTeamPing(kind.toLowerCase());
}

function jump() {
  if (!playing || paused || wasDead || wasDowned || !grounded || !playerBody) return;
  playerBody.wakeUp();
  playerBody.velocity.y = 7.7;
  grounded = false;
}

function setPaused(next) {
  if (!next && roomSessionLost) {
    showConnectionProblem("Your room session was disconnected. Return to operations to join a new lobby; active missions cannot be rejoined by ordinary operators.");
    return;
  }
  paused = next;
  if (paused) renderFieldLoadout();
  resetGameplayInput();
  syncTouchControls();
  $("#pause").classList.toggle("hidden", !paused || !playing || wasDead);
  $(".prompt").classList.toggle("hidden", paused || locked || touchControls.enabled);
  if (paused && locked) document.exitPointerLock?.();
  if (!paused) renderer?.domElement.focus();
}

function roomAction(event, details, onJoined) {
  if (!profile) return showError("Still connecting…");
  if (roomRequestPending) return;
  roomRequestPending = true;
  $("#deploymentLoading").classList.remove("hidden");
  unlockAudio();
  const name = $("#name").value.trim() || profile.username;
  socket.timeout(8000).emit(event, { ...details, name }, (error, reply) => {
    roomRequestPending = false;
    $("#deploymentLoading").classList.add("hidden");
    if (error || !reply?.ok) {
      showError(error ? "The deployment request timed out. Check your connection and try again." : reply?.error || "Unable to join.");
      if (training) { training = null; $("#trainingHint").classList.add("hidden"); }
    } else { localStorage.setItem(nameKey, name); onJoined?.(); }
  });
}

function showConnectionProblem(detail) {
  $("#deploymentLoading").classList.add("hidden");
  $("#connectionDetail").textContent = detail;
  $("#connectionPanel").classList.remove("hidden");
  if (!$("#connectionPanel").open) $("#connectionPanel").showModal();
  document.exitPointerLock?.();
  $("#connectionRetry").focus();
}

function recordTraining(action) {
  if (!training || state?.mode !== "practice" || training[action]) return;
  training = tutorialProgress(training, action);
  renderTraining();
}

function renderTraining() {
  const step = tutorialStep(training);
  const touch = touchControls.enabled;
  const copy = {
    move: ["01 / Get moving", touch ? "Push the left stick and move a few steps. Swipe the right side to look." : `Move a few steps with ${keyLabel(bindings.forward)} / ${keyLabel(bindings.left)} / ${keyLabel(bindings.backward)} / ${keyLabel(bindings.right)}. Mouse or arrows look around.`],
    fire: ["02 / Take your shot", touch ? "Aim at a range target. Hold FIRE; drag that button to track your aim." : `Aim at a range target. Click or hold ${keyLabel(bindings.fire)} to fire. Right-click focuses.`],
    reload: ["03 / Reload behind cover", touch ? "Tap Reload after firing. You have unlimited reserve ammunition in this range." : `Press ${keyLabel(bindings.reload)} after firing. Reserve ammunition is unlimited in this range.`],
    kill: ["04 / Target down", "Keep your aim on a target until the server confirms TARGET DOWN. Headshots finish targets faster."],
    complete: ["Drill complete. Ready to deploy.", `In co-op, hold ${keyLabel(bindings.interact)} beside a downed teammate to revive; stop moving and avoid damage. ${keyLabel(bindings.pingEnemy)}/${keyLabel(bindings.pingAmmo)}/${keyLabel(bindings.pingRoute)} mark enemies/ammo/routes, ${keyLabel(bindings.ability)} uses your class ability. Phone has matching buttons. Open the field menu to leave the range.`]
  }[step];
  $("#trainingHint").classList.remove("hidden");
  $("#trainingHint strong").textContent = copy[0];
  $("#trainingHint p").textContent = copy[1];
  $("#trainingSkip").textContent = step === "complete" ? "Finish drill" : "Skip drill";
  if (step === "complete") localStorage.setItem("deadlightTrainingComplete", "true");
}

function addKillFeed(shooterId, hits) {
  if (!playing || !Array.isArray(hits)) return;
  const shooter = state?.players.find((item) => item.socketId === shooterId)?.name || "Operator";
  for (const hit of hits.filter((item) => item.killed)) {
    const victim = state?.players.find((item) => item.socketId === hit.playerId)?.name ||
      (state?.mode === "practice" ? "Range target" : "Hostile");
    const entry = document.createElement("p");
    entry.textContent = `${shooter} / ${victim}${hit.hitZone === "head" ? " / HEADSHOT" : ""}`;
    $("#killFeed").prepend(entry);
    while ($("#killFeed").children.length > 4) $("#killFeed").lastElementChild.remove();
    setTimeout(() => entry.remove(), 6000);
  }
}

function setConnectionStatus(status) {
  if (status === "connected") {
    if (roomSessionLost) showConnectionProblem("Command link restored. Your previous room session was disconnected; return to operations before deploying again.");
    else { $("#connectionPanel").close(); $("#connectionPanel").classList.add("hidden"); }
  }
  if (profile) {
    renderSavedLoadouts();
    if (paused) renderFieldLoadout();
  }
  const labels = {
    connected: "Command link stable",
    reconnecting: "Reconnecting…",
    offline: "Command link offline",
    error: "Command link error"
  };
  document.querySelectorAll("[data-connection]").forEach((node) => {
    node.textContent = labels[status] || labels.reconnecting;
    node.classList.toggle("connection-error", status === "offline" || status === "error");
  });
  const hudStatus = $("#connectionStatus");
  if (hudStatus) {
    hudStatus.textContent = status === "connected" ? "Network stable" : labels[status] || "Connecting…";
    hudStatus.classList.toggle("asset-error", status !== "connected");
  }
  syncTouchControls();
}

function reportRuntimeError(message) {
  const safeMessage = String(message || "Unknown runtime error").slice(0, 120);
  const status = $("#assetStatus");
  if (status) {
    status.textContent = `Runtime warning · ${safeMessage}`;
    status.classList.add("asset-error");
  }
  if (!playing) showError(`Runtime warning: ${safeMessage}`);
}

function renderProfile() {
  if (profile.level < ENDGAME_LEVEL) {
    if (selectedDifficulty === "nightmare") selectedDifficulty = DEFAULT_DIFFICULTY;
    selectedMutators = [];
  }
  $("#tacticalDifficulty option[value='nightmare']").disabled = profile.level < ENDGAME_LEVEL;
  $("#tacticalDifficulty").value = selectedDifficulty;
  for (const input of document.querySelectorAll("[data-mutator]")) {
    input.disabled = profile.level < ENDGAME_LEVEL;
    input.checked = selectedMutators.includes(input.dataset.mutator);
  }
  for (const [id, descriptionId] of [["operatorClass", "classDescription"], ["lobbyClass", "lobbyClassDescription"]]) {
    const selector = $(`#${id}`);
    selector.innerHTML = Object.entries(SQUAD_CLASSES).map(([key, item]) => `<option value="${key}">${item.name} · ${item.ability}</option>`).join("");
    selector.value = profile.classId || DEFAULT_CLASS;
    $(`#${descriptionId}`).textContent = `${SQUAD_CLASSES[selector.value].description} Co-op only.`;
  }
  document.querySelectorAll("[data-token-balance]").forEach((node) => { node.textContent = profile.tokens.toLocaleString(); });
  document.querySelectorAll("[data-outfit-name]").forEach((node) => { node.textContent = skinFor(profile.equippedSkinId || "standard").name; });
  if (!roomCode && !canAccessMode(profile.xp, selectedMode)) selectedMode = "campaign";
  $("#mode").innerHTML = Object.values(MODES).map((mode) =>
    `<option value="${mode.id}" ${canAccessMode(profile.xp, mode.id) ? "" : "disabled"}>${mode.name}${canAccessMode(profile.xp, mode.id) ? "" : ` · Level ${mode.level}`}</option>`).join("");
  $("#mode").value = selectedMode;
  $("#modeDescription").textContent = MODES[selectedMode].description;
  $("#quickMatch").disabled = selectedMode === "practice";
  $("#tacticalOptions").classList.toggle("hidden", ["practice", "ffa"].includes(selectedMode));
  const progress = xpProgress(profile.xp);
  const showcase = profile.showcase || profile.career?.achievements.slice(0, 3) || [];
  $("#profile").innerHTML = `<div class="level-disc"><span>${profile.level}</span><small>Level</small></div>
    <div class="profile-progress"><strong>${profile.xp.toLocaleString()} XP · Prestige ${profile.career?.prestige || 0}</strong><span>${profile.totalKills || 0} eliminations · ${profile.career?.achievements.length || 0} badges</span>
    <div class="xpbar"><i style="width:${progress.percent}%"></i></div><small>${progress.remaining} XP to next clearance</small>
    ${showcase.length ? `<small class="profile-badges">${showcase.map((id) => ACHIEVEMENTS[id].name).join(" · ")}</small>` : ""}</div>`;
  careerUI.render();
}

function nearbySupply() {
  if (!state || state.phase !== "playing" || wasDead || wasDowned) return null;
  return (state.supplies || []).find((supply) =>
    !supply.usedBy.includes(myId) &&
    Math.hypot(player.position.x - supply.position.x, player.position.z - supply.position.z) <= 2.8);
}

function nearbyLoot() {
  if (!state || !["playing", "between"].includes(state.phase) || wasDead || wasDowned) return null;
  return (state.loot || []).filter((loot) => Math.hypot(player.position.x - loot.position.x,
    player.position.y - loot.position.y, player.position.z - loot.position.z) <= 3.2)
    .sort((a, b) => player.position.distanceToSquared(a.position) - player.position.distanceToSquared(b.position))[0] || null;
}

function nearbyRaidObjective() {
  const objective = state?.raid;
  if (!objective || objective.stage !== 1 || state.phase !== "playing" || wasDead || wasDowned) return null;
  return player.position.distanceTo(new THREE.Vector3(objective.position.x, objective.position.y, objective.position.z)) <= RAID_REACH
    ? objective : null;
}

function requestMedkit() {
  if (!playing || paused || !socket.connected || wasDead || wasDowned || medkitPending) return;
  medkitPending = true;
  socket.timeout(6000).emit("useMedkit", (error, result) => {
    medkitPending = false;
    if (error || !result?.ok) {
      toast(error ? "MEDKIT LINK TIMED OUT" : result?.error || "MEDKIT UNAVAILABLE", "warning");
      return;
    }
    toast(`MEDKIT · +${result.healed} HP`);
  });
}

function useNearbySupply() {
  if (!playing || paused || !socket.connected || wasDead || wasDowned) return;
  if (teamInteractionTarget(state, myId, player.position)) return;
  const objective = nearbyRaidObjective();
  if (objective) {
    socket.timeout(6000).emit("raidInteract", objective.id, (error, result) => {
      if (error || !result?.ok) toast(error ? "RAID LINK TIMED OUT" : result?.error || "RAID OBJECTIVE UNAVAILABLE", "warning");
      else toast("CACHE RECOVERED · COMMANDER INBOUND");
    });
    return;
  }
  const loot = nearbyLoot();
  if (loot) {
    socket.timeout(6000).emit("collectLoot", loot.id, (error, result) => {
      if (error || !result?.ok) {
        toast(error ? "LOOT LINK TIMED OUT" : result?.error || "LOOT UNAVAILABLE", "warning");
        return;
      }
      toast(result.kind === "weapon" ? `SAVED & EQUIPPED · ${weaponFor(result.weaponId).name}` :
        result.kind === "medkit" ? `MEDKIT COLLECTED · ${result.medkits} / ${MAX_MEDKITS}` : `LOOTED · +${result.granted} ROUNDS`);
    });
    return;
  }
  const supply = nearbySupply();
  if (!supply) return;
  socket.timeout(6000).emit("useAmmoSupply", supply.id, (error, result) => {
    if (error || !result?.ok) {
      toast(error ? "SUPPLY LINK TIMED OUT" : result?.error || "SUPPLY UNAVAILABLE", "warning");
      return;
    }
    toast(`RESUPPLIED · +${result.granted} ROUNDS`);
  });
}

function requestClassAbility() {
  if (!playing || paused || !socket.connected || wasDead || wasDowned) return;
  socket.timeout(6000).emit("classAbility", (error, result) => {
    if (error || !result?.ok) toast(error ? "ABILITY LINK TIMED OUT" : result?.error || "ABILITY UNAVAILABLE", "warning");
    else toast(`${SQUAD_CLASSES[state.players.find((item) => item.socketId === myId).classId].ability.toUpperCase()} ACTIVE`);
  });
}

function requestTeamPing(kind) {
  if (!playing || paused || !socket.connected || wasDead || !state) return;
  const payload = teamPingPayload(kind, state, player.position, player.yaw, player.pitch);
  if (!payload) { toast(kind === "enemy" ? "AIM AT A VISIBLE ENEMY WITHIN 26 M" : "NO VISIBLE AMMUNITION WITHIN 26 M", "warning"); return; }
  socket.timeout(6000).emit("teamPing", payload, (error, result) => {
    if (error || !result?.ok) toast(error ? "PING LINK TIMED OUT" : result?.error || "PING UNAVAILABLE", "warning");
  });
}

function updateTeamInteraction(inputEnabled, now) {
  const held = inputEnabled && (actionHeld(keys, bindings, "interact") || touchControls.state.interacting);
  const target = held ? teamInteractionTarget(state, myId, player.position) : null;
  if (!target && activeTeamInteraction) {
    socket.emit("teamInteract", null);
    activeTeamInteraction = null;
  } else if (target && (activeTeamInteraction !== target.id || now - lastTeamInteractionAt >= 180)) {
    activeTeamInteraction = target.id;
    lastTeamInteractionAt = now;
    socket.emit("teamInteract", target.id, (result) => {
      if (!result?.ok && performance.now() - teamErrorAt > 2500) {
        teamErrorAt = performance.now();
        toast(result?.error || "TEAM INTERACTION UNAVAILABLE", "warning");
      }
    });
  }
}

function updateTeamMarkers() {
  if (!camera || !state) return;
  for (const { node, point } of teamMarkerNodes.values()) {
    markerVector.set(point.position.x, point.position.y + .8, point.position.z).project(camera);
    const screen = markerPlacement(markerVector, innerWidth, innerHeight);
    node.classList.toggle("hidden", !screen || paused);
    if (!screen) continue;
    node.style.transform = `translate(${screen.x}px, ${screen.y}px) translate(-50%, -50%)`;
    node.textContent = `${screen.behind ? "Behind · " : ""}${point.label} · ${Math.round(player.position.distanceTo(point.position))} m`;
  }
}

function renderMaps() {
  const practice = selectedMode === "practice";
  const raid = selectedMode === "raid";
  const operation = selectedMode === "operation";
  $(".rail-heading .eyebrow").textContent = operation ? "Team operations" : practice ? "Weapons practice" : raid ? "Raid operations" : "Campaign operations";
  $(".rail-heading strong").textContent = practice ? "01 / Shooting range" : "01 / Deployment zones";
  const maps = practice ? [PRACTICE_MAP] : MAPS.filter((map) => eventContentAvailable(map.id));
  $("#maps").innerHTML = maps.map((map) => {
    const unlocked = practice ? Boolean(profile) : profile?.unlockedMaps.includes(map.id);
    const cleared = profile?.campaignCompleted.includes(map.id);
    const nextOperation = CAMPAIGN_MAPS[profile?.campaignCompleted.length || 0]?.id === map.id;
    return `<button role="option" aria-selected="${selectedMap === map.id}" class="map ${selectedMap === map.id ? "selected" : ""} ${unlocked ? "" : "locked"}"
      style="--map:${map.accent}" data-map="${map.id}" ${unlocked ? "" : "disabled"}><span class="map-index">${practice ? "P" : map.event ? "H" : String(MAPS.filter((item) => !item.event).indexOf(map) + 1).padStart(2, "0")}</span>
      <span class="map-copy"><b>${map.name}</b><small>${map.operation} · ${map.terrain}</small></span>
      <span class="map-state">${practice ? "Solo practice" : !unlocked ? `Level ${map.level}` : map.event ? "Halloween event" : raid ? "Raid available" : cleared ? "Cleared" : map.campaign === false ? "Side op" : nextOperation ? "Campaign next" : "Replay / XP"}</span></button>`;
  }).join("");
  const next = CAMPAIGN_MAPS[profile?.campaignCompleted.length || 0];
  $("#campaignStatus").textContent = practice ? "Practice is open at level 1. No progress or rewards are earned here." :
    raid ? "Raid is open at level 1 on your unlocked arenas. Solo or 1–4 operators; campaign order stays unchanged." : next
    ? `Campaign ${profile.campaignCompleted.length}/3 cleared · Next: ${next.name}${profile.unlockedMaps.includes(next.id) ? "" : ` (level ${next.level} required)`}. Win operations in order; clearing 02 awards the Sentinel SR.`
    : "Campaign 3/3 cleared · Sentinel SR earned. Replay any unlocked operation.";
  const active = maps.find((map) => map.id === selectedMap) || maps[0];
  $("#deploymentSelection").textContent = `${MODES[selectedMode].name} / ${active.name} / ${weaponFor(profile.equippedWeaponId).name}`;
  const preview = $("#selectedMapPreview");
  const previewSource = `/map-previews/${active.id}.webp`;
  if (preview.getAttribute("src") !== previewSource) preview.src = previewSource;
  preview.alt = `Overview of ${active.name}`;
  $("#selectedMapName").textContent = active.name;
  $("#selectedMapDetails").textContent = `${active.terrain} / ${active.time}`;
  const activeMeta = active;
  $("#missionBrief").innerHTML = `<div class="briefing-copy"><span class="eyebrow">${practice ? "Weapons practice" : raid ? "Co-op Raid" : active.campaign === false ? "Side operation" : `Operation 0${CAMPAIGN_MAPS.indexOf(active) + 1}`}</span><div class="briefing-title"><h1>${active.name}</h1><span class="difficulty">${activeMeta.difficulty}</span></div>
      <p>${activeMeta.description}</p><p class="campaign-brief">${practice ? "Solo session · targets reset after 1.2 seconds · no XP, tokens, loot or campaign credit." : raid ? "Secure the uplink, clear the cache guards and recover the encrypted cache, then defeat the armored commander and escorts. Earn XP, tokens and loot; no campaign credit." : active.campaign === false ? "Side operation · five waves · earn XP and tokens without changing campaign order." : profile?.campaignCompleted.includes(active.id) ? "Campaign cleared · replay for XP and tokens" :
        CAMPAIGN_MAPS[profile?.campaignCompleted.length || 0]?.id === active.id ? `Campaign objective: win all five waves${active.id === SNIPER_REWARD_MAP ? " to earn the Sentinel SR sniper" : ""}.` :
          "You can deploy for XP, but campaign credit requires clearing earlier operations first."}</p>
      <dl><div><dt>Terrain</dt><dd>${activeMeta.terrain}</dd></div><div><dt>Conditions</dt><dd>${activeMeta.weather}</dd></div><div><dt>Local time</dt><dd>${activeMeta.time}</dd></div></dl>
      <p class="route-brief">${practice ? "Real magazines and reload timing, unlimited reserve ammunition. Change your practice gun or leave from the field menu." : "Explore open-door buildings, search the raised field stations for loot, and use both ramp approaches to change elevation."}</p></div>`;
  if (operation) {
    $("#campaignStatus").textContent = "Team operations are open at level 1 on unlocked arenas. No campaign credit.";
    $("#missionBrief .eyebrow").textContent = "Co-op team operation";
    $("#missionBrief .campaign-brief").textContent = MODES.operation.description;
    $("#missionBrief .route-brief").textContent = "Bring complementary classes. Clear the drone's route, split between terminals, revive downed allies and extract together.";
  }
  document.querySelectorAll(".map:not(.locked)").forEach((button) => button.onclick = () => {
    selectedMap = button.dataset.map; renderMaps();
  });
}

function updateLobby(next) {
  $("#lobbyDescription").textContent = `${MODES[next.mode].description}${["ffa", "practice"].includes(next.mode)
    ? "" : ` ${AI_DIFFICULTIES[next.difficulty].name} tactics. ${AI_DIFFICULTIES[next.difficulty].description}`}${next.mutators?.length
      ? ` Mutators: ${next.mutators.map((id) => MUTATORS[id].name).join(", ")}.` : ""}`;
  const key = `${next.code}:${next.leaderSocketId}:${next.players.map((p) => `${p.socketId}:${p.name}:${p.level}:${p.staffRole}:${p.classId}`).join("|")}`;
  if (key === lobbyRosterKey) return;
  lobbyRosterKey = key;
  const slots = Array.from({ length: next.mode === "practice" ? 1 : 4 }, (_, index) => {
    const p = next.players[index];
    const lead = next.leaderSocketId === myId;
    const actions = p && p.socketId !== myId ? `<div class="peer-actions">
      ${lead ? `<button type="button" class="secondary" data-action="transferLeader" data-peer="${escapeHtml(p.socketId)}">Make lead</button>
        <button type="button" class="secondary" data-action="leaderKick" data-peer="${escapeHtml(p.socketId)}">Kick</button>` : ""}
      <button type="button" class="secondary" data-action="report" data-peer="${escapeHtml(p.socketId)}">Report</button></div>` : "";
    return p
      ? `<div class="operator"><span>${escapeHtml(p.name).slice(0, 1)}</span><div><b>${escapeHtml(p.name)}${staffLabel(p.staffRole) ? ` <em class="staff-badge">${staffLabel(p.staffRole)}</em>` : ""}</b><small>ID ${escapeHtml(p.playerTag)} · Level ${p.level} · ${SQUAD_CLASSES[p.classId || DEFAULT_CLASS].name} · ${next.leaderSocketId === p.socketId ? "Fireteam lead" : "Ready"}</small>${actions}</div></div>`
      : `<div class="operator empty"><span>＋</span><div><b>Open position</b><small>Awaiting operator</small></div></div>`;
  });
  $("#roster").innerHTML = slots.join("");
  $("#start").textContent = next.mode === "ffa"
    ? next.players.length < 2 ? "Free-for-All needs two players" : `Start Free-for-All · ${next.players.length} players`
    : next.mode === "practice"
      ? "Start practice range"
      : next.mode === "raid"
        ? `Start Raid · ${next.players.length === 1 ? "solo" : `${next.players.length} operators`}`
      : next.players.length < 2 ? "Begin solo deployment" : `Deploy ${next.players.length} operators`;
  $("#start").disabled = next.mode === "ffa" && next.players.length < 2;
  $("#start").style.display = next.leaderSocketId === socket.id ? "" : "none";
}

function beginGame() {
  if (!$("#reportPanel").classList.contains("hidden")) $("#reportClose").click();
  $("#lobby").classList.add("hidden");
  $("#results").classList.add("hidden");
  $("#hud").classList.remove("hidden");
  playing = true;
  paused = false;
  lastWave = 0;
  previousHealth = 100;
  wasDead = false;
  wasDowned = false;
  activeTeamInteraction = null;
  teamMarkerNodes.clear();
  $("#teamMarkers").replaceChildren();
  delete $("#teamNotice").dataset.pingId;
  delete $("#enemyComms").dataset.calloutId;
  $("#enemyComms").classList.add("hidden");
  lastLowAmmo = false;
  adsAmount = 0;
  matchStartProfile = profile ? { ...profile, unlockedMaps: [...profile.unlockedMaps] } : null;
  const activeOperator = state?.players.find((item) => item.socketId === myId);
  currentWeapon = effectiveWeapon(activeOperator?.weaponId, activeOperator);
  $(".scope-overlay").classList.remove("active");
  $(".scope-label").textContent = `${currentWeapon.name} · ${currentWeapon.optic.label}`;
  $(".scope-reticle").innerHTML = opticReticle(currentWeapon.optic.reticle);
  lastLocalShot = -Infinity;
  if (isTypingTarget(document.activeElement)) document.activeElement.blur();
  const spawn = state?.players.find((item) => item.socketId === myId)?.position;
  const me = state?.players.find((item) => item.socketId === myId);
  trainingOrigin = training && me ? { ...me.position } : null;
  if (training) renderTraining();
  $("#killFeed").replaceChildren();
  player.yaw = me?.yaw || 0;
  player.pitch = me?.pitch || 0;
  recoil = weaponSwayX = weaponSwayY = 0;
  Object.assign(recoilState, createRecoilState());
  Object.assign(cameraFeel, createCameraFeel());
  damageNumbers.clear();
  hitMarker.clear();
  recoilSequence = 0;
  lastRecoilShot = -Infinity;
  movementPackets.reset();
  if (spawn) {
    crouching = Boolean(me?.crouching);
    player.position.set(spawn.x, spawn.y, spawn.z);
    if (playerBody) {
      setPlayerCrouching(playerBody, crouching);
      playerBody.position.set(spawn.x, spawn.y - playerStance(crouching).eyeOffset, spawn.z);
      playerBody.velocity.setZero();
      playerBody.wakeUp();
      previousPhysicsPosition.copy(playerBody.position);
    }
    accumulator = 0;
  }
  if (!renderer) setupThree();
  else {
    if (renderedRoomCode !== roomCode || renderedWeaponId !== currentWeapon.id ||
      renderedWeaponStyle !== JSON.stringify([me?.attachmentId, me?.finishId])) resetFieldScene();
    syncEntities(state);
  }
  renderedRoomCode = roomCode;
  renderedWeaponId = currentWeapon.id;
  bloodEffects?.clear();
  setPaused(false);
  renderer.domElement.focus({ preventScroll: true });
  unlockAudio();
  const map = selectedMap === PRACTICE_MAP.id ? PRACTICE_MAP : MAPS.find((item) => item.id === selectedMap);
  $(".mission-banner strong").textContent = map?.name || "UNKNOWN SECTOR";
  $(".mission-banner span").textContent = MODES[selectedMode].name;
  $(".mission-banner").classList.add("active");
  setTimeout(() => $(".mission-banner")?.classList.remove("active"), 3600);
  updateMuteButton();
  playSound("wave");
  requestGamePointerLock();
}

function requestGamePointerLock() {
  if (touchControls.enabled || !renderer?.domElement.requestPointerLock) return;
  try {
    const request = renderer.domElement.requestPointerLock();
    request?.catch?.(() => {});
  } catch {
    // Keyboard-only aiming remains available when pointer lock is unavailable.
  }
}

function unlockAudio() {
  if (audioContext) {
    if (audioContext.state === "suspended") audioContext.resume().catch((error) => console.warn("Unable to resume audio.", error));
    if (playing) startAmbientAudio();
    return;
  }

  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return;
  audioContext = new AudioCtor();
  masterGain = audioContext.createGain();
  masterGain.gain.value = muted ? 0 : 0.22 * masterVolume;
  masterGain.connect(audioContext.destination);
  combatAudio = createCombatAudio(audioContext, masterGain);
  audioContext.addEventListener("statechange", updateLobbyMusic);
  if (playing) startAmbientAudio();
}

function updateLobbyMusic() {
  const enabled = CHRISTMAS_EVENT.active && !playing && !document.hidden && !maintenanceActive &&
    !muted && masterVolume > 0 && musicVolume > 0 && audioContext?.state === "running" &&
    (!$("#menu").classList.contains("hidden") || !$("#lobby").classList.contains("hidden")) &&
    !document.querySelector(".ban-screen");
  if (!enabled) {
    lobbyMusic?.dispose();
    lobbyMusic = null;
    return;
  }
  lobbyMusic ??= createLobbyMusic(audioContext, masterGain);
  lobbyMusic.update(musicVolume);
}

function toggleMute() {
  muted = !muted;
  localStorage.setItem("lastLightMuted", String(muted));
  unlockAudio();
  if (masterGain) masterGain.gain.setTargetAtTime(muted ? 0 : 0.22 * masterVolume, audioContext.currentTime, 0.015);
  updateMuteButton();
  updateLobbyMusic();
}

function updateMuteButton() {
  const button = $("#mute");
  if (button) {
    button.textContent = `${muted ? "Sound off" : "Sound on"} · ${keyLabel(bindings.mute)}`;
    button.setAttribute("aria-pressed", String(muted));
  }
  const fieldButton = $("#fieldMute");
  if (fieldButton) {
    fieldButton.textContent = muted ? "Enable field audio" : "Mute field audio";
    fieldButton.setAttribute("aria-pressed", String(muted));
  }
}

function startAmbientAudio() {
  if (!audioContext || ambientAudio) return;
  lobbyMusic?.dispose();
  lobbyMusic = null;
  const config = {
    foundry: { low: 42, high: 93, cutoff: 310 },
    tundra: { low: 58, high: 176, cutoff: 480 },
    void: { low: 35, high: 121, cutoff: 390 },
    harbor: { low: 48, high: 137, cutoff: 420 },
    outpost: { low: 52, high: 154, cutoff: 360 },
    wickfall: { low: 36, high: 83, cutoff: 210 },
    range: { low: 31, high: 72, cutoff: 180 },
    airfield: { low: 49, high: 146, cutoff: 320 },
    citadel: { low: 46, high: 115, cutoff: 260 },
    spillway: { low: 54, high: 162, cutoff: 430 },
    depot: { low: 43, high: 107, cutoff: 340 }
  }[selectedMap] || { low: 42, high: 93, cutoff: 310 };
  const gain = audioContext.createGain();
  const filter = audioContext.createBiquadFilter();
  const low = audioContext.createOscillator();
  const high = audioContext.createOscillator();
  const lfo = audioContext.createOscillator();
  const lfoGain = audioContext.createGain();
  gain.gain.value = 0.016;
  filter.type = "lowpass";
  filter.frequency.value = config.cutoff;
  low.type = "sine";
  high.type = selectedMap === "void" ? "triangle" : "sine";
  low.frequency.value = config.low;
  high.frequency.value = config.high;
  lfo.frequency.value = selectedMap === "tundra" ? .11 : .17;
  lfoGain.gain.value = .007;
  lfo.connect(lfoGain).connect(gain.gain);
  low.connect(gain);
  high.connect(gain);
  gain.connect(filter).connect(masterGain);
  low.start();
  high.start();
  lfo.start();
  ambientAudio = { low, high, lfo, lfoGain, gain, filter };
  combatMusic = createCombatMusic(audioContext, masterGain);
  updateCombatAudio();
}

function stopAmbientAudio() {
  if (ambientAudio) {
    for (const oscillator of [ambientAudio.low, ambientAudio.high, ambientAudio.lfo]) oscillator.stop();
    for (const node of Object.values(ambientAudio)) node.disconnect();
    ambientAudio = null;
  }
  combatMusic?.dispose();
  combatMusic = null;
  combatAudio?.clear();
}

function updateCombatAudio() {
  if (!combatMusic || !state) return;
  let enemyDistance = Infinity;
  for (const enemy of state.enemies) {
    if (enemy.type === "target" || enemy.health <= 0) continue;
    enemyDistance = Math.min(enemyDistance, Math.hypot(enemy.position.x - player.position.x,
      enemy.position.z - player.position.z));
  }
  const me = state.players.find((item) => item.socketId === myId);
  const intensity = combatIntensity({ mode: state.mode, phase: state.phase, enemyDistance,
    sinceShot: performance.now() - lastRecoilShot, health: me?.health });
  combatMusic.update(intensity, musicVolume);
}

function playPositionalReport(id, origin) {
  combatAudio?.weapon(id, origin, player, !hasLineOfSight(fieldGeometry(), player.position, origin));
}

function playSound(type, variation = 0) {
  unlockAudio();
  if (!audioContext || muted || audioContext.state === "suspended") {
    audioContext?.resume();
    return;
  }
  if (type === "shot") return combatAudio.weapon(currentWeapon.id);
  if (type === "footstep") return combatAudio.surface("step", footstepSurface(fieldGeometry(), player.position), { variation });
  const now = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const filter = audioContext.createBiquadFilter();
  const settings = {
    hit: [650, 180, 0.055, "square", 2600],
    headshot: [980, 420, 0.11, "sine", 3800],
    kill: [410, 155, 0.18, "triangle", 2200],
    damage: [90, 46, 0.18, "sawtooth", 620],
    dry: [155, 112, 0.045, "square", 1100],
    lowAmmo: [235, 175, 0.09, "triangle", 1300],
    reloadOut: [270, 145, 0.09, "triangle", 1500],
    reloadIn: [190, 330, 0.11, "triangle", 1900],
    reloadBolt: [440, 120, 0.075, "square", 2300],
    landing: [88, 36, 0.13, "triangle", 540],
    shell: [880 + variation * 80, 310, 0.06, "sine", 3100],
    wave: [155, 420, 0.48, "sine", 3200]
  }[type] || [200, 100, 0.1, "sine", 1200];
  oscillator.type = settings[3];
  oscillator.frequency.setValueAtTime(settings[0], now);
  oscillator.frequency.exponentialRampToValueAtTime(settings[1], now + settings[2]);
  if (type.startsWith("reload")) oscillator.detune.value = Math.log2(weaponFeedback(currentWeapon.id).weight) * 400;
  filter.type = "lowpass";
  filter.frequency.value = settings[4];
  const peak = type === "shell" ? 0.09 :
        type === "dry" ? 0.16 :
          type === "lowAmmo" ? .12 : 0.3;
  gain.gain.setValueAtTime(peak, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + settings[2]);
  oscillator.connect(filter).connect(gain).connect(masterGain);
  oscillator.onended = () => { oscillator.disconnect(); filter.disconnect(); gain.disconnect(); };
  oscillator.start(now);
  oscillator.stop(now + settings[2] + 0.01);
}

function requestReload() {
  if (!playing || paused || wasDead || wasDowned || !socket.connected) return;
  const me = state?.players.find((item) => item.socketId === myId);
  if (!me || state.phase !== "playing" || me.reloading ||
    me.ammo >= weaponFor(me.weaponId).magSize || me.reserve <= 0) return;
  socket.emit("reload", (result) => {
    if (!result?.ok) {
      toast(result?.reason || "RELOAD UNAVAILABLE", "warning");
      return;
    }
    if (!Number.isFinite(result.duration) || result.duration <= 0 ||
      !["empty", "tactical"].includes(result.type)) {
      reportRuntimeError("Invalid reload response");
      return;
    }
    const token = ++requestReload.token;
    const audible = () => playing && token === requestReload.token &&
      state?.players.find((item) => item.socketId === myId)?.reloading;
    setTimeout(() => {
      if (audible()) playSound("reloadOut");
    }, result.duration * .43);
    setTimeout(() => {
      if (audible()) playSound("reloadIn");
    }, result.duration * .78);
    if (result.type === "empty") {
      setTimeout(() => {
        if (audible()) playSound("reloadBolt");
      }, result.duration * .94);
    }
    toast(result.type === "empty" ? "EMPTY RELOAD" : "TACTICAL RELOAD", "info");
  });
}
requestReload.token = 0;

function reloadProgress(me) {
  return calculateReloadProgress(me?.reloading, me?.reloadEndsAt, me?.reloadDuration,
    state?.serverNow, performance.now() - stateReceivedAt);
}

function setupThree() {
  renderStartedAt = performance.now();
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.05, 180);
  scopeCamera = new THREE.PerspectiveCamera(settings.fov, 1, camera.near, camera.far);
  scopeScene = new THREE.Scene();
  scopeHudCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
  scopeHudCamera.position.z = 1;
  renderer = new THREE.WebGLRenderer({
    antialias: graphics.antialias, powerPreference: "high-performance"
  });
  renderer.setPixelRatio(renderPixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = graphics.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  gpuTimer = createGpuTimer(renderer.getContext());
  softContactTexture = contactShadowTexture();
  root.prepend(renderer.domElement);
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute("aria-label", "Deadlight Ops game view");
  if (graphics.postProcessing) {
    composer = new EffectComposer(renderer);
    composer.setPixelRatio(renderPixelRatio);
    composer.setSize(innerWidth, innerHeight);
    composer.addPass(new RenderPass(scene, camera));
    if (graphics.ambientOcclusion) {
      occlusionPass = new BudgetedGTAOPass(scene, camera, 512, 512, undefined,
        { samples: 8, radius: .4, thickness: .5, distanceFallOff: 1 });
      occlusionPass.blendIntensity = .65;
      composer.addPass(occlusionPass);
    }
    bloomPass = new UnrealBloomPass(new THREE.Vector2(
      innerWidth * renderPixelRatio, innerHeight * renderPixelRatio
    ), 0.09, 0.22, 0.94);
    composer.addPass(bloomPass);
    composer.addPass(new SMAAPass());
    composer.addPass(gradeAtmosphereOutput(new OutputPass()));
  }
  world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  world.defaultContactMaterial.friction = 0.08;
  world.defaultContactMaterial.restitution = 0;
  world.defaultContactMaterial.contactEquationStiffness = 1e8;
  world.defaultContactMaterial.contactEquationRelaxation = 4;
  world.defaultContactMaterial.frictionEquationStiffness = 1e7;
  world.defaultContactMaterial.frictionEquationRelaxation = 4;
  worldMaterial = new CANNON.Material("world");
  playerBody = createPlayerBody(world, player.position, worldMaterial);
  world.addEventListener("preStep", () => {
    const me = state?.players.find((member) => member.socketId === myId);
    if (!me?.flying || me.deadUntil) return;
    playerBody.force.y -= world.gravity.y * playerBody.mass;
    playerBody.velocity.y = flightVertical * FLIGHT_SPEED;
    if (playerBody.position.y >= FLIGHT_CEILING - .7 && playerBody.velocity.y > 0) playerBody.velocity.y = 0;
  });
  previousPhysicsPosition.copy(playerBody.position);
  buildMap(selectedMap);
  buildWeapon();
  addEventListener("resize", resize);
  document.addEventListener("pointerlockchange", () => {
    locked = document.pointerLockElement === renderer.domElement;
    $(".prompt").classList.toggle("hidden", locked || paused || touchControls.enabled);
  });
  document.addEventListener("mousemove", (event) => {
    if (!locked || !playing || paused || wasDead) return;
    const zoom = currentWeapon.optic.zoom;
    const sensitivity = .0022 * settings.sensitivity *
      (zoom > 1 ? scopeSensitivity(adsAmount, zoom) : 1 - adsAmount * .32);
    player.yaw -= event.movementX * sensitivity;
    player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - event.movementY * sensitivity));
    weaponSwayX = THREE.MathUtils.clamp(weaponSwayX + event.movementX * 0.00045, -0.045, 0.045);
    weaponSwayY = THREE.MathUtils.clamp(weaponSwayY + event.movementY * 0.00035, -0.035, 0.035);
  });
  renderer.domElement.addEventListener("mousedown", (event) => {
    if (touchControls.enabled || !playing || wasDead) return;
    if (event.button !== 0 && event.button !== 2) return;
    event.preventDefault();
    setPaused(false);
    renderer.domElement.focus({ preventScroll: true });
    if (event.button === 0) mouseFiring = true;
    if (event.button === 2) mouseAiming = true;
    unlockAudio();
    if (!locked) requestGamePointerLock();
  });
  renderer.domElement.addEventListener("contextmenu", (event) => event.preventDefault());
  document.addEventListener("mouseup", (event) => {
    if (event.button === 0) mouseFiring = false;
    if (event.button === 2) mouseAiming = false;
  });
}

function resetFieldScene() {
  resetGameplayInput();
  requestReload.token++;
  destructibleCover?.dispose();
  destructibleCover = null;
  bloodEffects?.dispose();
  bloodEffects = null;
  for (const item of entities.values()) {
    scene.remove(item.mesh);
    disposeEntityModel(item);
  }
  entities.clear();
  heldHands?.skeleton.dispose();
  disposeSceneResources(scene);
  heldHands = null;
  camera.clear();
  scene = new THREE.Scene();
  scene.add(camera);
  for (const pass of composer?.passes || []) if (pass instanceof RenderPass) pass.scene = scene;
  if (occlusionPass) occlusionPass.scene = scene;
  for (const body of [...world.bodies]) if (body !== playerBody) world.removeBody(body);
  world.accumulator = 0;
  playerBody.force.setZero();
  playerBody.velocity.setZero();
  for (const pool of [effectPool, shellPool, magazinePool, tracerPool, combatBurstPool,
    transientLightPool, ambientRotors]) pool.length = 0;
  seenAttackIds.clear();
  mapParticles = arenaWeather = arenaDressing = christmas = atmosphere = combatDecals = muzzleSmoke = surfaceImpacts = interiorLighting = null;
  arenaLamps = [];
  renderStartedAt = performance.now();
  frameBudget = frameBudgetState(frameBudget.scale);
  lastShadowUpdate = 0;
  stopAmbientAudio();
  damageNumbers.clear();
  softContactTexture = contactShadowTexture();
  grounded = false;
  movementBlockedFor = previousVerticalVelocity = 0;
  buildMap(selectedMap);
  buildWeapon();
}

function replaceHeldWeapon(weaponId, kit = {}) {
  requestReload.token++;
  const old = weapon;
  camera.remove(old, weaponFill);
  disposeSceneResources(old);
  currentWeapon = effectiveWeapon(weaponId, kit);
  adsAmount = recoil = weaponSwayX = weaponSwayY = 0;
  Object.assign(recoilState, createRecoilState());
  recoilSequence = 0;
  lastRecoilShot = -Infinity;
  lastLocalShot = performance.now();
  reloadEndSeen = 0;
  reloadEjected = false;
  buildWeapon();
  renderedWeaponId = weaponId;
  $(".scope-overlay").classList.remove("active");
  $(".scope-label").textContent = `${currentWeapon.name} · ${currentWeapon.optic.label}`;
  $(".scope-reticle").innerHTML = opticReticle(currentWeapon.optic.reticle);
}

function buildWeapon() {
  const operator = state?.players.find((item) => item.socketId === myId);
  renderedWeaponStyle = JSON.stringify([operator?.attachmentId, operator?.finishId]);
  heldGun = createWeaponModel(currentWeapon.id, { compact: qualityLow,
    attachmentId: operator?.attachmentId, finishId: operator?.finishId });
  weapon = heldGun.root;
  weaponMagazine = heldGun.magazine;
  chargingHandle = heldGun.bolt;
  const flash = weaponFeedback(currentWeapon.id).muzzle;
  muzzleFlash = new THREE.Mesh(new THREE.ConeGeometry(flash.radius, flash.length, qualityLow ? 6 : 12), new THREE.MeshBasicMaterial({
    color: flash.color, transparent: true, opacity: .92, blending: THREE.AdditiveBlending, depthWrite: false
  }));
  muzzleFlash.position.set(0, .009, -heldGun.layout.muzzle - .045);
  muzzleFlash.rotation.x = -Math.PI / 2;
  muzzleFlash.visible = false;
  weapon.add(muzzleFlash);
  weapon.position.copy(weaponViewPose(heldGun.layout,
    reloadPose(0, false, "empty", heldGun.layout.mount, heldGun.layout), { aspect: camera.aspect }).position);
  weapon.rotation.y = .15;
  camera.add(weapon);
  scene.add(camera);
  muzzleLight = new THREE.PointLight(flash.color, 0, 5.5, 2);
  muzzleUntil = 0;
  muzzleLight.position.set(0, .009, -heldGun.layout.muzzle);
  weapon.add(muzzleLight);
  weaponFill = new THREE.PointLight(0xdce5e7, qualityLow ? .4 : .6, 2);
  // Raised reload hands must not pass through an inverse-square lighting hotspot.
  weaponFill.position.set(.35, .4, .65);
  camera.add(weaponFill);
  rebuildWeaponHands();
  ensureTacticalBody();
}

function rebuildWeaponHands() {
  if (heldHands) {
    heldHands.root.removeFromParent();
    heldHands.skeleton.dispose();
    disposeSceneResources(heldHands.root);
    heldHands = null;
  }
  if (!loadedTacticalBody || !camera) return;
  heldHands = createWeaponHands(loadedTacticalBody, selectedMap,
    state?.players.find((item) => item.socketId === myId)?.skinId || profile.equippedSkinId || "standard",
    { compact: qualityLow });
  matteSurfaces(heldHands.root);
  camera.add(heldHands.root);
  updateWeaponHands(heldHands, weapon, heldGun.layout, reloadPose(0, false, "empty", heldGun.layout.mount, heldGun.layout));
}

function proceduralTexture(mapId, kind = "floor", heightMap = false) {
  const size = qualityLow ? 256 : 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const palettes = {
    wickfall: ["#606f60", "#354b40", "#8d9b7e", "#d79b5e"],
    range: ["#89957b", "#596750", "#b0b79e", "#c5d39c"],
    foundry: ["#8b9498", "#616d73", "#a2a9aa", "#b8764e"],
    tundra: ["#bed5d9", "#8eb8c3", "#e4f2ef", "#73aabc"],
    void: ["#55535e", "#363640", "#706a78", "#a98abb"],
    harbor: ["#657779", "#424f52", "#8d9a96", "#a59667"],
    outpost: ["#bba67e", "#8e805f", "#d8c7a0", "#a58d66"],
    airfield: ["#969fa1", "#5a666c", "#bcc9c8", "#d0c998"],
    citadel: ["#a49c8c", "#6d7069", "#ccc6b6", "#bc825a"],
    spillway: ["#84938d", "#515f5c", "#b2c7bf", "#69988c"],
    depot: ["#746f67", "#434643", "#9a968a", "#a88767"]
  };
  const colors = heightMap ? ["#777777", "#383838", "#b4b4b4", "#d5d5d5"] :
    mapId === "harbor" && kind === "cover" ? ["#d6dbd5", "#c2c9c4", "#eff1dc", "#ab9e80"] :
      palettes[mapId] || palettes.foundry;
  ctx.fillStyle = heightMap && kind === "cover" ? colors[1] : colors[0];
  ctx.fillRect(0, 0, size, size);
  let seed = { foundry: 91, tundra: 173, void: 251, harbor: 353, outpost: 457, airfield: 563, citadel: 677, spillway: 787, depot: 883 }[mapId] || 91;
  const random = () => ((seed = Math.imul(seed ^ seed >>> 15, seed | 1)) >>> 0) / 4294967296;
  for (let i = 0; i < 900; i++) {
    const alpha = 0.025 + random() * (heightMap ? 0.1 : 0.04);
    ctx.fillStyle = `${random() > 0.5 ? colors[1] : colors[2]}${Math.floor(alpha * 255).toString(16).padStart(2, "0")}`;
    const r = .5 + random() * (mapId === "tundra" ? 5 : 2);
    ctx.fillRect(random() * size, random() * size, r * 2, r);
  }
  for (let i = 0; i < 45; i++) {
    const x = random() * size;
    const y = random() * size;
    const radius = 5 + random() * 30;
    const stain = ctx.createRadialGradient(x, y, 0, x, y, radius);
    stain.addColorStop(0, heightMap ? "#24242455" : "#161a1714");
    stain.addColorStop(1, "#00000000");
    ctx.fillStyle = stain;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  ctx.lineWidth = kind === "cover" ? 2 : 1;
  ctx.strokeStyle = `${colors[2]}24`;
  const step = kind === "cover" ? 128 : 64;
  if (mapId !== "outpost" || kind === "cover") {
    for (let p = 0; p <= size; p += step) {
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
    }
  }
  if (mapId === "tundra") {
    ctx.strokeStyle = "#efffff66";
    for (let i = 0; i < 35; i++) {
      const x = random() * size, y = random() * size;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + random() * 55 - 27, y + random() * 55 - 27); ctx.stroke();
    }
  } else if (mapId === "void") {
    ctx.strokeStyle = "#b797c899"; ctx.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      ctx.beginPath(); ctx.arc(size / 2, size / 2, 20 + i * (size / 19), i * .4, Math.PI + i * .35); ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(kind === "cover" ? 1.5 : 12, kind === "cover" ? 1.5 : 12);
  if (!heightMap) texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return texture;
}

function resizeSurfaceTexture(texture, colorTreatment = "original") {
  const dimensions = textureDimensions(texture.image.width, texture.image.height, graphics.textureSize);
  const neutral = colorTreatment !== "original";
  if (!neutral && texture.image.width === dimensions.width && texture.image.height === dimensions.height) return texture;
  const canvas = document.createElement("canvas");
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext("2d", { willReadFrequently: neutral });
  context.drawImage(texture.image, 0, 0, canvas.width, canvas.height);
  if (neutral) {
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < image.data.length; index += 4) {
      const luminance = image.data[index] * .2126 + image.data[index + 1] * .7152 + image.data[index + 2] * .0722;
      const gray = colorTreatment === "sand" ? 42 + luminance * 1.1 :
        colorTreatment === "gravel" ? 38 + luminance * .7 : 180 + luminance * .22;
      image.data[index] = image.data[index + 1] = image.data[index + 2] = gray;
    }
    context.putImageData(image, 0, 0);
  }
  const resized = new THREE.CanvasTexture(canvas);
  resized.flipY = texture.flipY;
  resized.colorSpace = texture.colorSpace;
  resized.channel = texture.channel;
  resized.wrapS = texture.wrapS;
  resized.wrapT = texture.wrapT;
  resized.repeat.copy(texture.repeat);
  resized.offset.copy(texture.offset);
  resized.center.copy(texture.center);
  resized.rotation = texture.rotation;
  texture.dispose();
  return resized;
}

function applyPhotographicSurface(material, assetId, repeat, fallbackColor, fallbackRelief, colorTreatment = "original") {
  if (graphics.surfaceMaps === "procedural") return;
  const targetScene = scene;
  const materials = Array.isArray(material) ? material : [material];
  const loader = new THREE.TextureLoader();
  let normalReady = false;
  let roughReady = false;
  const load = (suffix, onLoad) => {
    loader.load(`/textures/${assetId}_${suffix}.jpg`, (source) => {
      if (scene !== targetScene) { source.dispose(); return; }
      const texture = resizeSurfaceTexture(source, suffix === "diff" ? colorTreatment : "original");
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(repeat, repeat);
      texture.anisotropy = Math.min(qualityLow ? 4 : 8, renderer.capabilities.getMaxAnisotropy());
      if (suffix === "diff") texture.colorSpace = THREE.SRGBColorSpace;
      onLoad(texture);
      for (const target of materials) target.needsUpdate = true;
    }, undefined, (error) => {
      if (scene !== targetScene) return;
      console.error(`Could not load ${assetId} ${suffix} surface; retaining procedural detail.`, error);
      reportRuntimeError(`Surface texture unavailable: ${assetId} ${suffix}`);
    });
  };
  load("diff", (texture) => {
    for (const target of materials) {
      target.map = texture;
      if (graphics.surfaceMaps === "albedo") {
        target.bumpMap = null;
        target.roughnessMap = null;
      }
    }
    fallbackColor.dispose();
    if (graphics.surfaceMaps === "albedo") fallbackRelief.dispose();
  });
  if (graphics.surfaceMaps !== "pbr") return;
  load("nor_gl", (texture) => {
    for (const target of materials) {
      target.normalMap = texture;
      target.normalScale = new THREE.Vector2(.45, .45);
      target.bumpMap = null;
    }
    normalReady = true;
    if (roughReady) fallbackRelief.dispose();
  });
  load("rough", (texture) => {
    for (const target of materials) target.roughnessMap = texture;
    roughReady = true;
    if (normalReady) fallbackRelief.dispose();
  });
}

function buildMap(mapId) {
  const targetScene = scene;
  bloodEffects = createBloodEffects(scene, { mapId, geometry: fieldGeometry, compact: graphics.compact || touchDevice });
  const military = ["harbor", "outpost", "airfield", "citadel", "spillway", "depot"].includes(mapId);
  const config = sceneLook(mapId);
  const lighting = lightingProfile(mapId);
  renderer.toneMappingExposure = lighting.exposure;
  const militaryMaterials = military ? militaryCoverMaterials(mapId) : null;
  scene.background = new THREE.Color(config.sky);
  atmosphere = createAtmosphere(scene, mapId, { compact: graphics.compact || touchDevice,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches });
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(120, 24, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(config.sky) },
        horizonColor: { value: new THREE.Color(config.horizon) }
      },
      vertexShader: "varying float h; void main(){ h=normalize(position).y; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }",
      fragmentShader: `uniform vec3 topColor; uniform vec3 horizonColor; varying float h;
        void main(){
          float t=smoothstep(-0.15,0.72,h);
          gl_FragColor=vec4(mix(horizonColor,topColor,t),1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`
    })
  );
  scene.add(sky);
  if (graphics.photographicSky && mapId !== "wickfall") {
    const panorama = config.panorama;
    const loader = graphics.hdr ? new RGBELoader() : new THREE.TextureLoader();
    loader.load(`/skies/${panorama}.${graphics.hdr ? "hdr" : "jpg"}`, (texture) => {
      if (scene !== targetScene) { texture.dispose(); return; }
      if (!graphics.hdr) texture.colorSpace = THREE.SRGBColorSpace;
      texture.mapping = THREE.EquirectangularReflectionMapping;
      scene.background = texture;
      scene.backgroundIntensity = mapId === "harbor" ? .65 : .9;
      scene.remove(sky);
      sky.geometry.dispose();
      sky.material.dispose();
    }, undefined, (error) => {
      if (scene !== targetScene) return;
      console.error(`Could not load ${panorama} sky; retaining gradient background.`, error);
      reportRuntimeError(`Sky panorama unavailable: ${panorama}`);
    });
  }
  scene.add(new THREE.HemisphereLight(config.horizon, 0x67716a, lighting.hemisphere));
  scene.add(new THREE.AmbientLight(config.fill, lighting.ambient));
  const sun = new THREE.DirectionalLight(config.sun, config.sunStrength);
  sun.position.set(...config.sunPosition);
  sun.castShadow = graphics.shadows;
  sun.shadow.mapSize.set(graphics.shadowSize, graphics.shadowSize);
  const shadowExtent = graphics.focusedShadows ? 24 : 45;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -shadowExtent;
  sun.shadow.camera.right = sun.shadow.camera.top = shadowExtent;
  sun.shadow.camera.far = 140;
  sun.shadow.bias = -.0006;
  sun.shadow.normalBias = .035;
  scene.add(sun);
  scene.add(sun.target);
  fieldSun = sun;
  const rim = new THREE.DirectionalLight(config.fill, lighting.rim);
  rim.position.set(-config.sunPosition[0], Math.max(12, config.sunPosition[1] * .45), -config.sunPosition[2]);
  scene.add(rim);
  const floorTexture = proceduralTexture(mapId);
  const floorRelief = proceduralTexture(mapId, "floor", true);
  const wetFloor = mapId === "harbor" || mapId === "spillway";
  const floorMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    map: floorTexture,
    bumpMap: floorRelief,
    bumpScale: mapId === "tundra" ? 0.09 : 0.055,
    roughnessMap: floorRelief,
    roughness: wetFloor ? mapId === "harbor" ? .38 : .5 : mapId === "tundra" ? 1 : .94,
    metalness: mapId === "harbor" ? .08 : 0,
    clearcoat: wetFloor ? mapId === "harbor" ? .8 : .45 : 0
  });
  const floorAsset = {
    wickfall: "rocky_terrain_02", foundry: "concrete_floor_worn_001",
    tundra: "snow_02",
    void: "rocky_terrain_02",
    harbor: "concrete_floor_worn_001",
    outpost: "rocky_terrain_02", airfield: "concrete_floor_worn_001", citadel: "concrete_floor_worn_001",
    spillway: "concrete_floor_worn_001", depot: "rocky_terrain_02", range: "concrete_floor_worn_001"
  }[mapId];
  applyPhotographicSurface(floorMaterial, floorAsset, mapId === "outpost" || mapId === "depot" ? 64 : 22,
    floorTexture, floorRelief, mapId === "outpost" ? "sand" : mapId === "depot" ? "gravel" : "original");
  if (mapId === "outpost") floorMaterial.color.setHex(0xe5c797);
  const floorSize = mapId === "outpost" ? 256 : 88;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(floorSize, floorSize), floorMaterial);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const floorBody = new CANNON.Body({
    mass: 0, collisionFilterGroup: 1, collisionFilterMask: 2, material: worldMaterial
  });
  floorBody.addShape(new CANNON.Plane());
  floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(floorBody);
  addArenaTerrain(scene, world, mapId, floorMaterial, worldMaterial, floorSize);

  const coverAsset = mapId === "void" ? "rocky_terrain_02" : "rusty_painted_metal";
  const coverRelief = mapId === "wickfall" ? wickfallStoneTexture(true) : proceduralTexture(mapId, "cover", true);
  const coverTexture = mapId === "wickfall" ? wickfallStoneTexture() : proceduralTexture(mapId, "cover");
  const coverMaterial = new THREE.MeshStandardMaterial({
    color: mapId === "tundra" ? 0x9cb8bc : mapId === "foundry" ? 0xb3a89e : 0xffffff,
    map: coverTexture,
    bumpMap: coverRelief, bumpScale: .035, roughnessMap: coverRelief,
    roughness: mapId === "wickfall" ? 1 : mapId === "void" ? .92 : .8,
    metalness: ["wickfall", "void"].includes(mapId) ? 0 : .4
  });
  if (military) {
    const paintedMaterials = [...militaryMaterials.container, militaryMaterials.crate, militaryMaterials.generator];
    for (const material of paintedMaterials) {
      material.map = coverTexture;
      material.bumpMap = coverRelief;
      material.bumpScale = .018;
      if (qualityLow) material.metalness = .1;
    }
    applyPhotographicSurface(paintedMaterials, "rusty_painted_metal", 1,
      coverTexture, coverRelief, "paint");
  } else if (mapId !== "wickfall") {
    applyPhotographicSurface(coverMaterial, coverAsset, 1, coverTexture, coverRelief,
      mapId === "void" ? "original" : "paint");
  }
  let wallMaterial = coverMaterial;
  if (mapId !== "void") {
    const wallTexture = mapId === "wickfall" ? wickfallStoneTexture() : proceduralTexture(mapId, "cover");
    const wallRelief = mapId === "wickfall" ? wickfallStoneTexture(true) : proceduralTexture(mapId, "cover", true);
    wallMaterial = new THREE.MeshStandardMaterial({
      color: mapId === "outpost" ? 0xcbb996 : mapId === "tundra" ? 0xb6c9c9 : 0xc3c6bd,
      map: wallTexture, bumpMap: wallRelief, bumpScale: .025,
      roughnessMap: wallRelief, roughness: mapId === "wickfall" ? 1 : .85,
      metalness: military || mapId === "wickfall" ? 0 : .24
    });
    if (mapId !== "harbor" && mapId !== "wickfall") {
      applyPhotographicSurface(wallMaterial, mapId === "outpost" ? "concrete_floor_worn_001" : "factory_wall",
        1, wallTexture, wallRelief);
    }
  }
  const trimMaterial = new THREE.MeshStandardMaterial({
    color: 0x343c3a, roughness: .73, metalness: .42
  });
  const coverGeometry = new THREE.BoxGeometry(1, 1, 1);
  const contactGeometry = new THREE.PlaneGeometry(1, 1);
  const contactMaterial = new THREE.MeshBasicMaterial({
    map: softContactTexture, color: 0x101311, transparent: true, opacity: .26, depthWrite: false
  });
  const contacts = new THREE.InstancedMesh(contactGeometry, contactMaterial, getMapObstacles(mapId).length);
  const contactPose = new THREE.Object3D();
  const batches = new Map();
  const batchCover = (mesh) => {
    mesh.updateMatrix();
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrix);
    if (!batches.has(mesh.material)) batches.set(mesh.material, []);
    batches.get(mesh.material).push(geometry);
  };
  for (const [obstacleIndex, obstacle] of getMapObstacles(mapId).entries()) {
    const obstacleMaterial = military
      ? obstacle.kind === "container" ? militaryMaterials.container[obstacleIndex % 4]
        : ["building", "roof", "barrier", "sandbag"].includes(obstacle.kind) ? wallMaterial
          : militaryMaterials[obstacle.kind] || militaryMaterials.crate
      : obstacle.buildingId ? wallMaterial
      : mapId !== "void" && obstacleIndex % 3 === 0 ? wallMaterial : coverMaterial;
    const inset = obstacle.kind === "container" ? .1 : 0;
    const geometry = military || obstacle.buildingId || mapId === "wickfall"
      ? tiledBox(obstacle.width - inset, obstacle.height, obstacle.depth - inset, 2.8)
      : roundedCoverGeometry(obstacle.width - inset, obstacle.height, obstacle.depth - inset, qualityLow);
    const mesh = new THREE.Mesh(geometry, obstacleMaterial);
    mesh.position.set(obstacle.x, (obstacle.base || 0) + obstacle.height / 2, obstacle.z);
    mesh.rotation.y = obstacle.rotation;
    mesh.receiveShadow = !qualityLow;
    mesh.castShadow = graphics.shadows;
    batchCover(mesh);
    geometry.dispose();
    const trim = new THREE.Mesh(coverGeometry, trimMaterial);
    trim.scale.set(obstacle.width + 0.025, 0.035, obstacle.depth + 0.025);
    trim.position.set(obstacle.x, (obstacle.base || 0) + obstacle.height - .04, obstacle.z);
    trim.rotation.y = obstacle.rotation;
    batchCover(trim);
    contactPose.scale.set(obstacle.width + 1.2, obstacle.depth + 1.2, 1);
    contactPose.position.set(obstacle.x, getTerrainHeight(mapId, obstacle.x, obstacle.z) + .006, obstacle.z);
    if (obstacle.kind === "roof" || (obstacle.base || 0) > getTerrainHeight(mapId, obstacle.x, obstacle.z) + .3) {
      contactPose.scale.set(0, 0, 0);
    }
    contactPose.rotation.set(-Math.PI / 2, 0, obstacle.rotation);
    contactPose.updateMatrix();
    contacts.setMatrixAt(obstacleIndex, contactPose.matrix);
    const body = new CANNON.Body({
      mass: 0,
      position: new CANNON.Vec3(obstacle.x, (obstacle.base || 0) + obstacle.height / 2, obstacle.z),
      collisionFilterGroup: 1,
      collisionFilterMask: 2,
      material: worldMaterial
    });
    body.addShape(new CANNON.Box(new CANNON.Vec3(obstacle.width / 2, obstacle.height / 2, obstacle.depth / 2)));
    body.quaternion.setFromEuler(0, obstacle.rotation, 0);
    world.addBody(body);
  }
  for (const [material, geometries] of batches) {
    const mesh = new THREE.Mesh(mergeGeometries(geometries), material);
    mesh.receiveShadow = !qualityLow;
    mesh.castShadow = graphics.shadows;
    scene.add(mesh);
    geometries.forEach((geometry) => geometry.dispose());
  }
  coverGeometry.dispose();
  contacts.computeBoundingSphere();
  scene.add(contacts);
  const interiorTexture = proceduralTexture(mapId);
  const interiorRelief = proceduralTexture(mapId, "floor", true);
  const interiorMaterial = new THREE.MeshStandardMaterial({
    color: 0xb7bab2, map: interiorTexture, bumpMap: interiorRelief, bumpScale: .025,
    roughnessMap: interiorRelief, roughness: .9
  });
  applyPhotographicSurface(interiorMaterial, "concrete_floor_worn_001", 1, interiorTexture, interiorRelief);
  interiorLighting = addArenaInteriors(scene, mapId, {
    lowDetail: qualityLow, buildings: getMapBuildings(mapId), floorMaterial: interiorMaterial, config
  });
  if (mapId !== "range" && graphics.surfaceMaps !== "procedural") addArenaSurfaceDetail(scene, mapId);
  const walls = [
    [0, 2.5, -ARENA_LIMIT - 0.5, ARENA_LIMIT * 2 + 2, 5, 1],
    [0, 2.5, ARENA_LIMIT + 0.5, ARENA_LIMIT * 2 + 2, 5, 1],
    [-ARENA_LIMIT - 0.5, 2.5, 0, 1, 5, ARENA_LIMIT * 2 + 2],
    [ARENA_LIMIT + 0.5, 2.5, 0, 1, 5, ARENA_LIMIT * 2 + 2]
  ];
  if (!military) {
    const mesh = new THREE.Mesh(mergedTiledBoxes(walls, 2.8), wallMaterial);
    mesh.receiveShadow = !qualityLow;
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
  }
  for (const [x, y, z, width, height, depth] of walls) {
    const body = new CANNON.Body({
      mass: 0, position: new CANNON.Vec3(x, y, z),
      collisionFilterGroup: 1, collisionFilterMask: 2, material: worldMaterial
    });
    body.addShape(new CANNON.Box(new CANNON.Vec3(width / 2, height / 2, depth / 2)));
    world.addBody(body);
  }
  for (let i = 0; i < graphics.pointLights; i++) {
    const lamp = new THREE.PointLight(config.accent, .55, 10, 2);
    const angle = i / graphics.pointLights * Math.PI * 2;
    lamp.position.set(Math.cos(angle) * 35, 2.2, Math.sin(angle) * 35);
    arenaLamps.push(lamp);
    scene.add(lamp);
  }
  if (mapId === "range") {
    addRangeDetails(scene);
  } else if (military) {
    arenaWeather = addMilitaryArena(scene, mapId, {
      lowDetail: qualityLow, rotors: ambientRotors, materials: militaryMaterials
    });
  } else if (mapId !== "wickfall") {
    addMapDetails(mapId, config, wallMaterial);
  }
  arenaDressing = addArenaDressing(scene, mapId, { detail: graphics.detail, shadows: graphics.shadows });
  if (mapId !== "wickfall") addArenaArchitecture(scene, mapId, { detail: graphics.detail, shadows: graphics.shadows });
  christmas = addChristmas(scene, mapId, { detail: graphics.detail,
    reducedMotion: reduceCameraMotion || cameraMotionPreference.matches, enabled: christmasEnabled });
  combatDecals = createImpactDecals(scene, { count: combatBudget.decals });
  muzzleSmoke = createMuzzleSmoke(scene, { count: combatBudget.smoke, interval: combatBudget.smokeInterval });
  surfaceImpacts = createSurfaceImpacts(scene, { count: qualityLow ? 24 : 72 });
  destructibleCover = createDestructibleCover(scene, world, mapId, {
    material: worldMaterial, shadows: graphics.shadows, contactTexture: softContactTexture,
    onBreak(prop) {
      const position = new THREE.Vector3(prop.x, prop.base + .85, prop.z);
      const hit = { position, normal: { x: 0, y: 1, z: 0 } };
      renderer.shadowMap.needsUpdate = graphics.shadows;
      if (!muted) combatAudio?.surface("impact", prop.kind === "generator" ? "metal" : "wood", { position, listener: player });
      if (position.distanceTo(player.position) < 16) toast("BREAKABLE COVER DESTROYED", "info");
      if (reduceCameraMotion || cameraMotionPreference.matches) return;
      surfaceImpacts.emit(hit, "debris");
      surfaceImpacts.emit(hit, prop.kind === "generator" ? "blast" : "dirt");
      muzzleSmoke.emit(position, new THREE.Vector3(0, 1, 0), { burst: true });
    }
  });
  if (state?.mapId === mapId) destructibleCover.sync(state.props, false);
  matteSurfaces(scene);
}

function addMapDetails(mapId, config, wallMaterial) {
  const instanced = (geometry, material, count, place) => {
    const mesh = instancedDetail(scene, geometry, material, count, place);
    mesh.receiveShadow = !qualityLow;
    return mesh;
  };
  const metal = new THREE.MeshStandardMaterial({ color: config.cover, metalness: .72, roughness: .36 });
  const glow = new THREE.MeshStandardMaterial({
    color: config.accent, emissive: config.accent, emissiveIntensity: .12, roughness: .46, metalness: .42
  });
  const edgeCount = qualityLow ? 12 : 24;
  const decorativeCover = getMapObstacles(mapId).slice(0, qualityLow ? 6 : 12);
  const ringPlace = (object, i, count, y = 2) => {
    const angle = i / count * Math.PI * 2;
    object.position.set(Math.cos(angle) * (34 + i % 3 * 2.2), y, Math.sin(angle) * (34 + i % 3 * 2.2));
    object.rotation.y = -angle;
  };
  const coverFacePlace = (object, i, y, scale = 1) => {
    const obstacle = decorativeCover[i % decorativeCover.length];
    const faceOffset = obstacle.depth / 2 + .015;
    object.position.set(
      obstacle.x + Math.sin(obstacle.rotation) * faceOffset,
      Math.min(y, obstacle.height - .12),
      obstacle.z + Math.cos(obstacle.rotation) * faceOffset
    );
    object.rotation.y = obstacle.rotation;
    object.scale.setScalar(scale);
  };
  const makeSignMaterial = (label, background, foreground) => {
    const canvas = document.createElement("canvas");
    canvas.width = 256; canvas.height = 96;
    const context = canvas.getContext("2d");
    context.fillStyle = background; context.fillRect(0, 0, 256, 96);
    context.strokeStyle = foreground; context.lineWidth = 6; context.strokeRect(7, 7, 242, 82);
    context.fillStyle = foreground;
    context.font = "700 34px Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, 128, 49);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    return new THREE.MeshStandardMaterial({
      map: texture, roughness: .72, metalness: .08, polygonOffset: true,
      polygonOffsetFactor: -1
    });
  };

  const decalMaterial = new THREE.MeshBasicMaterial({
    color: config.accent, transparent: true, opacity: mapId === "tundra" ? .13 : .2,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2
  });
  instanced(new THREE.PlaneGeometry(2.8, .34), decalMaterial, qualityLow ? 8 : 18, (o, i, count) => {
    const angle = i / count * Math.PI * 2;
    const radius = 12 + i % 3 * 8;
    o.position.set(Math.cos(angle) * radius, .024, Math.sin(angle) * radius);
    o.rotation.set(-Math.PI / 2, 0, angle + (mapId === "void" ? Math.PI / 2 : 0));
    o.scale.x = 1 + i % 3 * .5;
  });

  if (mapId === "foundry") {
    instanced(new THREE.CylinderGeometry(.7, .85, 6, 12), metal, edgeCount, (o, i, count) => ringPlace(o, i, count, 3));
    instanced(new THREE.TorusGeometry(.72, .11, 6, 16), glow, edgeCount * 2, (o, i, count) => {
      ringPlace(o, i % edgeCount, edgeCount, 1.2 + (i >= edgeCount ? 3.6 : 0)); o.rotation.x = Math.PI / 2;
    });
    instanced(new THREE.CylinderGeometry(.16, .16, 8, 8), metal, qualityLow ? 12 : 28, (o, i, count) => {
      const angle = i / count * Math.PI * 2; o.position.set(Math.cos(angle) * 39, 5.2, Math.sin(angle) * 39);
      o.rotation.z = Math.PI / 2; o.rotation.y = -angle;
    });
    instanced(new THREE.BoxGeometry(5.5, .25, 1.4), metal, 12, (o, i, count) => {
      const angle = i / count * Math.PI * 2; o.position.set(Math.cos(angle) * 38, 6.5, Math.sin(angle) * 38); o.rotation.y = -angle;
    });
    const crateMaterial = new THREE.MeshStandardMaterial({ color: 0x59615f, roughness: .82, metalness: .32 });
    instanced(new RoundedBoxGeometry(.9, .72, .18, 2, .03), crateMaterial, decorativeCover.length, (o, i) => {
      coverFacePlace(o, i, .48, .86 + i % 3 * .08);
    });
    instanced(new THREE.CylinderGeometry(.28, .3, .7, qualityLow ? 8 : 14), new THREE.MeshStandardMaterial({
      color: 0x684b39, metalness: .55, roughness: .62
    }), qualityLow ? 4 : 8, (o, i) => {
      coverFacePlace(o, i * 2 + 1, .42, .85);
      o.position.y = .4;
    });
    instanced(new THREE.CylinderGeometry(.035, .035, 2.2, 6), new THREE.MeshStandardMaterial({
      color: 0x1f2423, roughness: .86
    }), qualityLow ? 8 : 18, (o, i) => {
      coverFacePlace(o, i, .82 + i % 3 * .34);
      o.rotation.z = Math.PI / 2;
    });
    instanced(new THREE.PlaneGeometry(1.05, .38), makeSignMaterial("HOT ZONE", "#c57a35", "#1f211f"),
      qualityLow ? 3 : 7, (o, i) => coverFacePlace(o, i * 2, 1.25));
    instanced(new THREE.BoxGeometry(.72, .56, .07), new THREE.MeshStandardMaterial({
      color: 0x293130, metalness: .62, roughness: .46
    }), qualityLow ? 4 : 9, (o, i) => coverFacePlace(o, i + 2, 1.02));
    for (let i = 0; i < (qualityLow ? 2 : 4); i++) {
      const fan = new THREE.Mesh(new THREE.TorusGeometry(.42, .055, 6, 18), metal);
      coverFacePlace(fan, i * 3, 1.15);
      scene.add(fan);
      ambientRotors.push({ object: fan, axis: "z", speed: .24 + i * .035 });
    }
  } else if (mapId === "tundra") {
    const ice = new THREE.MeshPhysicalMaterial({
      color: 0xc8f5ff, emissive: 0x38c9ff, emissiveIntensity: .32, roughness: .18,
      transmission: qualityLow ? 0 : .22, transparent: true, opacity: .92
    });
    instanced(new THREE.ConeGeometry(.75, 5.5, 5), ice, edgeCount * 2, (o, i, count) => {
      ringPlace(o, i, count, 2.3); o.rotation.z = (i % 3 - 1) * .2; o.scale.setScalar(.65 + i % 5 * .12);
    });
    instanced(new THREE.CylinderGeometry(.15, .28, 9, 6), metal, qualityLow ? 6 : 10, (o, i, count) => {
      const angle = i / count * Math.PI * 2; o.position.set(Math.cos(angle) * 37, 4.5, Math.sin(angle) * 37);
    });
    instanced(new THREE.TorusGeometry(1.3, .11, 6, 20), glow, qualityLow ? 6 : 10, (o, i, count) => {
      const angle = i / count * Math.PI * 2; o.position.set(Math.cos(angle) * 37, 7.2, Math.sin(angle) * 37); o.rotation.x = Math.PI / 2;
    });
    instanced(new THREE.SphereGeometry(1, 8, 5), new THREE.MeshStandardMaterial({ color: 0xe4eff0, roughness: 1 }), 32, (o, i, count) => {
      const angle = i / count * Math.PI * 2; o.position.set(Math.cos(angle) * 40, .6, Math.sin(angle) * 40); o.scale.set(3.6, .8, 1.8);
    });
    instanced(new RoundedBoxGeometry(.76, 1.18, .16, 2, .035), new THREE.MeshStandardMaterial({
      color: 0x647b80, metalness: .48, roughness: .48
    }), decorativeCover.length, (o, i) => coverFacePlace(o, i, .72, .9));
    instanced(new THREE.SphereGeometry(1, qualityLow ? 8 : 14, 6), new THREE.MeshStandardMaterial({
      color: 0xe8f1ed, roughness: .98
    }), qualityLow ? 12 : 26, (o, i, count) => {
      const angle = i / count * Math.PI * 2;
      const radius = 15 + i % 4 * 6.1;
      o.position.set(Math.cos(angle) * radius, .055, Math.sin(angle) * radius);
      o.scale.set(1.4 + i % 3, .055, .7 + i % 2 * .35);
    });
    instanced(new THREE.CylinderGeometry(.025, .035, 1.5, 6), new THREE.MeshStandardMaterial({
      color: 0x354b52, metalness: .65, roughness: .38
    }), qualityLow ? 8 : 18, (o, i, count) => {
      const angle = i / count * Math.PI * 2;
      o.position.set(Math.cos(angle) * 44, .75, Math.sin(angle) * 44);
    });
    instanced(new THREE.BoxGeometry(.3, .09, .03), glow, qualityLow ? 8 : 18, (o, i, count) => {
      const angle = i / count * Math.PI * 2;
      o.position.set(Math.cos(angle) * 44, 1.35, Math.sin(angle) * 44);
      o.rotation.y = -angle;
    });
    instanced(new THREE.PlaneGeometry(.94, .34), makeSignMaterial("RELAY", "#d6e5df", "#3c555b"),
      qualityLow ? 3 : 7, (o, i) => coverFacePlace(o, i * 2, 1.32));
  } else {
    instanced(new THREE.BoxGeometry(1.8, 8, 1.3), metal, edgeCount, (o, i, count) => {
      ringPlace(o, i, count, 4); o.rotation.z = (i % 3 - 1) * .12; o.scale.y = .7 + i % 4 * .16;
    });
    instanced(new THREE.OctahedronGeometry(.9, 0), glow, edgeCount * 2, (o, i, count) => {
      const angle = i / count * Math.PI * 2; const radius = 25 + i % 4 * 4;
      o.position.set(Math.cos(angle) * radius, 3 + i % 6, Math.sin(angle) * radius); o.rotation.set(angle, angle * .4, .45);
    });
    instanced(new THREE.TorusGeometry(2.2, .14, 8, 28), glow, qualityLow ? 5 : 9, (o, i, count) => {
      const angle = i / count * Math.PI * 2; o.position.set(Math.cos(angle) * 36, 4.5, Math.sin(angle) * 36); o.rotation.set(Math.PI / 2, angle, angle);
    });
    instanced(new RoundedBoxGeometry(.86, .7, .15, 3, .04), new THREE.MeshStandardMaterial({
      color: 0x494754, metalness: .46, roughness: .38
    }), decorativeCover.length, (o, i) => coverFacePlace(o, i, .62 + i % 2 * .35));
    instanced(new THREE.CylinderGeometry(.12, .18, 1.65, qualityLow ? 7 : 12), metal,
      qualityLow ? 8 : 16, (o, i) => coverFacePlace(o, i, .84, .8));
    instanced(new THREE.OctahedronGeometry(.18, 0), glow, qualityLow ? 18 : 42, (o, i, count) => {
      const cluster = i % 7;
      const anchorAngle = Math.floor(i / 7) / Math.ceil(count / 7) * Math.PI * 2;
      const radius = 12 + Math.floor(i / 7) * 4.2;
      o.position.set(
        Math.cos(anchorAngle) * radius + (cluster % 3 - 1) * .45,
        2.8 + (cluster * 7 % 5) * .31,
        Math.sin(anchorAngle) * radius + (cluster % 2 ? .38 : -.38)
      );
      o.rotation.set(i * .27, i * .19, i * .13);
      o.scale.setScalar(.6 + cluster % 3 * .25);
    });
    instanced(new THREE.PlaneGeometry(1.02, .36), makeSignMaterial("CONTAIN", "#3e3948", "#b9a2c5"),
      qualityLow ? 3 : 7, (o, i) => coverFacePlace(o, i * 2, 1.26));
  }

  const particleCount = qualityLow ? 90 : 220;
  const positions = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) {
    const radius = 8 + Math.random() * 43;
    const angle = Math.random() * Math.PI * 2;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = 0.5 + Math.random() * 15;
    positions[i * 3 + 2] = Math.sin(angle) * radius;
  }
  const particlesGeometry = new THREE.BufferGeometry();
  particlesGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  mapParticles = new THREE.Points(particlesGeometry, new THREE.PointsMaterial({
    color: mapId === "tundra" ? 0xe8fbff : config.accent,
    size: mapId === "tundra" ? 0.1 : 0.16,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    blending: THREE.NormalBlending
  }));
  mapParticles.userData.kind = mapId;
  scene.add(mapParticles);
}

function animate(timestamp = performance.now()) {
  requestAnimationFrame(animate);
  updateLobbyMusic();
  const frameMs = previousFrameAt ? timestamp - previousFrameAt : 1000 / 60;
  previousFrameAt = timestamp;
  if (document.hidden) {
    frameBudget = frameBudgetState(frameBudget.scale);
    renderStartedAt = timestamp;
    return;
  }
  if (!playing || frameMs < 1000 / refreshSampler.hz * 1.1) refreshSampler.sample(frameMs);
  if (maintenanceActive || !playing || !renderer || !playerBody) return;
  const cpuStartedAt = performance.now();
  const frameSeconds = Math.max(.001, frameMs / 1000);
  gpuMilliseconds = gpuTimer.read() ?? gpuMilliseconds;
  const previousScale = frameBudget.scale;
  const adaptive = qualitySetting !== "low" && (qualitySetting !== "high" || settings.targetFps === 120);
  if (adaptive && timestamp - renderStartedAt > 4000) {
    frameBudget = updateFrameBudget(frameBudget, {
      frameMs, workMs: Math.max(renderStats.cpuMs, gpuMilliseconds ?? 0),
      targetFps: settings.targetFps, displayHz: refreshSampler.hz, elapsed: frameSeconds
    });
    if (previousScale !== frameBudget.scale) applyRenderBudget();
  }
  renderStats.fps = frameBudget.averageMs ? 1000 / frameBudget.averageMs : 1000 / frameMs;
  renderStats.displayHz = refreshSampler.hz;
  if (timestamp - lastPerformanceHud > 500) {
    lastPerformanceHud = timestamp;
    $("#renderStatus").textContent = `${Math.round(renderStats.fps)} FPS · ${settings.targetFps} target`;
    $("#performanceReadout").textContent =
      `${Math.round(renderStats.fps)} FPS · observed browser cadence ~${refreshSampler.hz} Hz · ${activeRenderPixelRatio.toFixed(2)}x render`;
    const heading = ((-player.yaw * 180 / Math.PI) % 360 + 360) % 360;
    $("#compass").textContent = `${["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(heading / 45) % 8]}  ${Math.round(heading).toString().padStart(3, "0")}°`;
  }
  const dt = Math.min(0.5, frameSeconds);
  if (bloodEnabled) bloodEffects?.update(dt);
  const inputEnabled = socket.connected && !roomSessionLost && !paused && !wasDead && !$("#settingsPanel").open &&
    $("#connectionPanel").classList.contains("hidden") && !isTypingTarget(document.activeElement);
  const me = state?.players.find((p) => p.socketId === myId);
  const downed = Boolean(me?.downedUntil);
  if (inputEnabled) applyKeyboardLook(player, keys, dt);
  const wantsFire = inputEnabled && !downed && (mouseFiring || touchControls.state.firing ||
    actionHeld(keys, bindings, "fire"));
  const now = performance.now();
  if (triggerCanFire(currentWeapon, wantsFire, triggerWasHeld) &&
    now - lastLocalShot >= currentWeapon.fireInterval) {
    lastLocalShot = now;
    fire();
  }
  triggerWasHeld = Boolean(wantsFire);
  updateTeamInteraction(inputEnabled && !downed, now);
  updateTeamMarkers();
  flightVertical = me?.flying && inputEnabled ? (actionHeld(keys, bindings, "jump") || touchControls.state.ascending ? 1 : 0) -
    (actionHeld(keys, bindings, "crouch") || touchControls.state.descending ? 1 : 0) : 0;
  const reloading = Boolean(me?.reloading && !me.deadUntil);
  const aiming = inputEnabled && !downed && !reloading && Boolean(mouseAiming || actionHeld(keys, bindings, "aim") || touchControls.state.aiming);
  adsAmount = stepAds(adsAmount, aiming, currentWeapon.id, dt);
  const forward = inputEnabled ? (actionHeld(keys, bindings, "forward") ? 1 : 0) - (actionHeld(keys, bindings, "backward") ? 1 : 0) + touchControls.state.forward : 0;
  const strafe = inputEnabled ? (actionHeld(keys, bindings, "right") ? 1 : 0) - (actionHeld(keys, bindings, "left") ? 1 : 0) + touchControls.state.strafe : 0;
  const wantsCrouch = downed || inputEnabled && !me?.flying && Boolean(actionHeld(keys, bindings, "crouch") || touchControls.state.crouching);
  if (wantsCrouch !== crouching) {
    const stance = playerStance(wantsCrouch);
    const nextEye = { x: playerBody.position.x, z: playerBody.position.z,
      y: playerBody.position.y - playerStance(crouching).height / 2 + stance.eyeHeight };
    if (canOccupyPosition(fieldGeometry(), nextEye, undefined, wantsCrouch)) {
      setPlayerCrouching(playerBody, wantsCrouch);
      crouching = wantsCrouch;
      previousPhysicsPosition.copy(playerBody.position);
    }
  }
  const sprinting = inputEnabled && !aiming && !crouching && forward > .001 &&
    Boolean(actionHeld(keys, bindings, "sprint") ||
      (touchControls.state.sprinting && Math.hypot(touchControls.state.forward, touchControls.state.strafe) > .65));
  const speed = movementSpeed({ sprinting, crouching, downed, forward, strafe });
  if (forward || strafe) playerBody.wakeUp();
  const length = Math.max(1, Math.hypot(forward, strafe));
  moveVector.set(
    (Math.sin(player.yaw) * -forward + Math.cos(player.yaw) * strafe) / length,
    0,
    (Math.cos(player.yaw) * -forward - Math.sin(player.yaw) * strafe) / length
  );
  const hasMovementInput = Boolean(forward || strafe);
  const horizontalSpeed = Math.hypot(playerBody.velocity.x, playerBody.velocity.z);
  movementBlockedFor = hasMovementInput && horizontalSpeed < 0.08
    ? movementBlockedFor + dt
    : 0;
  if (movementBlockedFor > 0.45) {
    const recoveryDirections = [
      { x: moveVector.x, z: 0 },
      { x: 0, z: moveVector.z },
      { x: -moveVector.z, z: moveVector.x },
      { x: moveVector.z, z: -moveVector.x }
    ];
    const recovery = recoveryDirections.find((direction) => {
      const length = Math.hypot(direction.x, direction.z);
      if (length < .1) return false;
      direction.x /= length; direction.z /= length;
      return canTraverse(fieldGeometry(), player.position, {
        x: playerBody.position.x + direction.x * 0.22,
        y: player.position.y,
        z: playerBody.position.z + direction.z * 0.22
      }, undefined, crouching);
    });
    if (recovery) {
      playerBody.position.x += recovery.x * 0.08;
      playerBody.position.z += recovery.z * 0.08;
      playerBody.velocity.x = recovery.x * speed * 0.3;
      playerBody.velocity.z = recovery.z * speed * 0.3;
      previousPhysicsPosition.copy(playerBody.position);
      playerBody.wakeUp();
    }
    movementBlockedFor = 0;
  }
  accumulator = stepPlayerPhysics(world, playerBody, previousPhysicsPosition, moveVector, dt, accumulator, {
    geometry: fieldGeometry(),
    grounded: grounded || Boolean(me?.flying), sprinting, crouching, enabled: inputEnabled,
    forward, strafe, downed, flying: Boolean(me?.flying)
  });
  const alpha = accumulator / PLAYER_PHYSICS_STEP;
  playerBody.position.lerp(previousPhysicsPosition, 1 - alpha, interpolatedPhysicsPosition);
  player.position.set(interpolatedPhysicsPosition.x, interpolatedPhysicsPosition.y + playerStance(crouching).eyeOffset, interpolatedPhysicsPosition.z);
  rayFrom.set(playerBody.position.x, playerBody.position.y, playerBody.position.z);
  rayTo.set(playerBody.position.x, playerBody.position.y - playerStance(crouching).height / 2 - .17, playerBody.position.z);
  rayResult.reset();
  world.raycastClosest(rayFrom, rayTo, { collisionFilterMask: 1, skipBackfaces: true }, rayResult);
  grounded = rayResult.hasHit && playerBody.velocity.y < 0.7;
  if (grounded && !wasGroundedFrame && previousVerticalVelocity < -2.6) {
    playSound("landing");
    recoil = Math.min(1, recoil + .12);
    kickCamera(cameraFeel, "landing", -previousVerticalVelocity * .008);
  }
  wasGroundedFrame = grounded;
  previousVerticalVelocity = playerBody.velocity.y;
  const moving = Boolean(forward || strafe) && grounded;
  if (moving && horizontalSpeed > .75) {
    footstepDistance += horizontalSpeed * dt;
    const strideLength = sprinting ? 2.4 : 2.2;
    if (footstepDistance >= strideLength) {
      footstepDistance %= strideLength;
      playSound("footstep", footstepIndex++ % 2);
    }
  } else {
    footstepDistance = Math.min(footstepDistance, .7);
  }
  bobTime += moving ? dt * (sprinting ? 14 : 9) : dt * 3;
  const reducedMotion = reduceCameraMotion || cameraMotionPreference.matches;
  const motion = stepCameraFeel(cameraFeel, dt, { reducedMotion, moving, sprinting, bobTime });
  const bob = motion.bob;
  camera.position.set(player.position.x, player.position.y + bob + motion.dip, player.position.z);
  stepRecoil(recoilState, currentWeapon.id, dt);
  camera.rotation.set(
    player.pitch + recoilState.pitch + motion.pitch,
    player.yaw + recoilState.yaw,
    (reducedMotion ? 0 : recoilState.yaw * -.25) + motion.roll * (1 - adsAmount * .7),
    "YXZ"
  );
  const scoped = currentWeapon.optic.zoom > 1;
  const targetFov = scoped
    ? settings.fov + motion.sprintFov
    : Math.max(52, settings.fov - adsAmount * 16 + motion.sprintFov);
  const nextFov = targetFov + (camera.fov - targetFov) * Math.exp(-8 * dt);
  if (Math.abs(camera.fov - nextFov) > .001) {
    camera.fov = nextFov;
    camera.updateProjectionMatrix();
  }
  if (renderer.shadowMap.enabled && timestamp - lastShadowUpdate >= 1000 / 30) {
    lastShadowUpdate = timestamp;
    renderer.shadowMap.needsUpdate = true;
  }
  if (fieldSun && graphics.focusedShadows && renderer.shadowMap.needsUpdate) {
    const position = sceneLook(selectedMap).sunPosition;
    fieldSun.position.set(player.position.x + position[0], position[1], player.position.z + position[2]);
    fieldSun.target.position.set(player.position.x, 0, player.position.z);
    fieldSun.target.updateMatrixWorld();
  }
  const scopeActive = scoped && adsAmount > .92 && !wasDead;
  weapon.visible = !scopeActive && !wasDead && !downed;
  $(".scope-overlay").classList.toggle("active", scopeActive);
  if (scopeActive) {
    $(".scope-lens").style.setProperty("--eyebox-x", `${(reducedMotion ? 0 : weaponSwayX * 110).toFixed(1)}px`);
    $(".scope-lens").style.setProperty("--eyebox-y", `${(reducedMotion ? 0 : weaponSwayY * 110).toFixed(1)}px`);
  }
  $(".crosshair").classList.toggle("scoped", scopeActive);
  $(".prompt").classList.toggle("hidden", !wasDead && (locked || paused || aiming || touchControls.enabled));
  recoil *= Math.pow(0.012, dt);
  const feedback = weaponFeedback(currentWeapon.id);
  weaponSwayX *= Math.pow(.008, dt / feedback.weight);
  weaponSwayY *= Math.pow(.008, dt / feedback.weight);
  const serverReloadPhase = reloadProgress(me);
  const layout = heldGun.layout, magazineMount = layout.mount;
  const pose = reloadPose(serverReloadPhase, reloading, me?.reloadType, magazineMount, layout);
  const lowered = sprinting && moving && !reloading ? 1 : 0;
  const view = weaponViewPose(layout, pose, {
    aspect: camera.aspect, ads: adsAmount, moving, bob, bobTime,
    swayX: reducedMotion ? 0 : weaponSwayX, swayY: reducedMotion ? 0 : weaponSwayY,
    recoil, lowered, reloading, progress: serverReloadPhase, weight: feedback.weight
  });
  weapon.position.copy(view.position);
  weapon.rotation.set(view.rotation.x, view.rotation.y, view.rotation.z);
  const spreadTarget = ((currentWeapon.pellets ? 6 : 0) +
    (moving ? sprinting ? 10 : 4.5 : 0) + (!grounded ? 7 : 0) + recoil * 8) *
    currentWeapon.spreadMultiplier * (1 - adsAmount * .68);
  crosshairSpread += (spreadTarget - crosshairSpread) * Math.min(1, dt * (spreadTarget > crosshairSpread ? 18 : 8));
  $(".crosshair").style.setProperty("--spread", `${crosshairSpread.toFixed(2)}px`);
  $(".crosshair").classList.toggle("ads", adsAmount > .62);
  if (heldHands) {
    heldHands.root.visible = !scopeActive && !wasDead && !downed;
    if (heldHands.root.visible) updateWeaponHands(heldHands, weapon, layout, pose);
  }
  chargingHandle.position.z = layout.charging.z + pose.boltZ;
  if (weaponMagazine && me) {
    if (reloading) {
      if (reloadEndSeen !== me.reloadEndsAt) {
        reloadEndSeen = me.reloadEndsAt;
        reloadEjected = false;
      }
      if (serverReloadPhase >= .43 && !reloadEjected) {
        if (me.reloadType === "empty") {
          const oldMagazine = reloadPose(.43, true, me.reloadType, magazineMount, layout).magazine;
          weaponMagazine.position.set(oldMagazine.x, oldMagazine.y, oldMagazine.z);
          weaponMagazine.rotation.x = oldMagazine.pitch;
          weapon.updateWorldMatrix(true, true);
          ejectMagazine();
        }
        reloadEjected = true;
      }
    } else {
      reloadEndSeen = 0;
      reloadEjected = false;
    }
    weaponMagazine.position.set(pose.magazine.x, pose.magazine.y, pose.magazine.z);
    weaponMagazine.rotation.x = pose.magazine.pitch;
    weaponMagazine.visible = pose.magazine.visible;
  }
  interiorLighting?.(player.position);
  if (now - lastAwarenessUpdate > 50) {
    updateAwareness();
    updateIncomingThreat();
    updateCombatAudio();
    lastAwarenessUpdate = now;
  }
  arenaWeather?.update(dt);
  arenaDressing?.update(dt, camera.position);
  christmas?.update(dt, reducedMotion || document.documentElement.classList.contains("reduce-motion"), camera.position);
  atmosphere?.update(dt, camera.position, reducedMotion);
  muzzleSmoke?.update(dt);
  surfaceImpacts?.update(dt);
  if (damageNumbersEnabled) damageNumbers.update(camera, now, reducedMotion);
  if (now >= muzzleUntil) { muzzleFlash.visible = false; muzzleLight.intensity = 0; }
  if (mapParticles) {
    const particleSpeed = mapParticles.userData.kind === "tundra" ? -.32 :
      mapParticles.userData.kind === "void" ? .035 : .12;
    mapParticles.rotation.y += dt * (mapParticles.userData.kind === "void" ? .05 : .015);
    mapParticles.position.y += particleSpeed * dt;
    if (Math.abs(mapParticles.position.y) > 3) mapParticles.position.y = 0;
  }
  for (const rotor of ambientRotors) rotor.object.rotation[rotor.axis] += dt * rotor.speed;
  for (const [entityId, item] of entities) {
    if (item.kind === "target") {
      item.steel.emissiveIntensity = item.hitUntil > now ? .8 : 0;
      continue;
    }
    if (item.dyingUntil) {
      const linearDeath = 1 - Math.max(0, item.dyingUntil - now) / 840;
      const deathProgress = linearDeath * linearDeath * (3 - 2 * linearDeath);
      if (item.modelKind === "tactical") updateTacticalEnemy(item, {
        delta: dt, death: deathProgress, reducedMotion
      });
      item.mesh.rotation.z += ((item.deathDirection || 1) * 1.22 * deathProgress - item.mesh.rotation.z) *
        (1 - Math.exp(-dt * (reducedMotion ? 5 : 12)));
      item.mesh.position.y = (item.target?.y ?? item.modelOffsetY ?? 0) - deathProgress * .34;
      item.health.visible = false;
      if (now >= item.dyingUntil) {
        scene.remove(item.mesh);
        disposeEntityModel(item);
        entities.delete(entityId);
      }
      continue;
    }
    if (item.target) {
      const alpha = Math.min(1, (now - item.snapshotAt) / item.interpolationMs);
      item.mesh.position.lerpVectors(item.from, item.target, alpha);
    }
    if (item.kind === "player" && item.modelKind === "tactical") {
      const attacking = item.attackUntil > now;
      const turn = Math.atan2(Math.sin(item.facing - item.mesh.rotation.y), Math.cos(item.facing - item.mesh.rotation.y));
      item.mesh.rotation.y += turn * (1 - Math.exp(-dt * 12));
      updateTacticalEnemy(item, { delta: dt, speed: item.moveBlend || 0, windingUp: !item.downed, downed: item.downed,
        attacking, hit: item.hitUntil > now, aimPitch: item.aimPitch || 0,
        crouchDrop: item.crouching ? (playerStance(false).eyeHeight - playerStance(true).eyeHeight) / .85 : 0, reducedMotion });
      item.enemyFlash.visible = item.flashUntil > now;
    }
    if (item.kind === "enemy") {
      const dx = item.motionX || 0;
      const dz = item.motionZ || 0;
      const attacking = item.attackUntil > now;
      const windingUp = item.windupUntil > now;
      if (windingUp) {
        const victim = state?.players.find((candidate) => candidate.socketId === item.windupTargetId);
        if (victim) {
          item.facing = enemyFacingYaw(victim.position.x - item.target.x,
            victim.position.z - item.target.z, false);
        }
      } else if (!attacking && Math.abs(dx) + Math.abs(dz) > .001) {
        item.facing = enemyFacingYaw(dx, dz, false);
      }
      const turn = Math.atan2(Math.sin(item.facing - item.mesh.rotation.y), Math.cos(item.facing - item.mesh.rotation.y));
      item.mesh.rotation.y += turn * Math.min(1, dt * 9);
      const movingEnemy = Math.abs(dx) + Math.abs(dz) > .006;
      if (item.modelKind === "tactical") {
        updateTacticalEnemy(item, {
          delta: dt, phase: item.phase,
          speed: attacking || windingUp ? 0 : movingEnemy
            ? Math.min(1, Math.hypot(dx, dz) / Math.max(.07, item.interpolationMs / 1000) / 5) : 0,
          attacking, windingUp, hit: item.hitUntil > now, reducedMotion
        });
      }
      const stagger = item.staggerUntil > now
        ? Math.sin((item.staggerUntil - now) / 90) * .065
        : 0;
      item.mesh.rotation.z += (stagger - item.mesh.rotation.z) * Math.min(1, dt * 16);
      item.health?.lookAt(camera.position);
      if (item.health) {
        const distance = item.mesh.position.distanceTo(camera.position);
        const fade = 1 - THREE.MathUtils.smoothstep(distance, 20, 39);
        const readabilityScale = THREE.MathUtils.clamp(
          distance / 18, .82, 1.45
        );
        item.health.scale.setScalar(readabilityScale);
        item.health.visible = (item.healthRatio < .999 || windingUp) && fade > .02;
        item.health.children.forEach((child) => {
          if (child.material) {
            child.material.transparent = true;
            child.material.opacity = fade * (child === item.fill ? .92 : .68);
          }
        });
        if (item.indicator) {
          item.indicator.visible = fade > .15 && (item.type === "brute" || attacking || windingUp);
          item.indicator.material.color.setHex(windingUp && item.windupTargetId === myId ? 0xe98b62 :
            windingUp ? 0xe9bd6a : item.type === "brute" ? 0xd99069 : 0xc7b28d);
          item.indicator.material.opacity = fade * (windingUp ? .96 : .72);
          item.indicator.scale.setScalar(windingUp ? 1.25 + Math.sin(now * .012) * .12 : 1);
        }
      }
      item.lastTarget.copy(item.target);
    }
  }
  for (const shell of shellPool) {
    if (!shell.visible) continue;
    shell.userData.life -= dt;
    if (shell.userData.life <= 0) shell.visible = false;
    else if (shell.userData.resting) {
      if (shell.userData.life < .5) shell.scale.multiplyScalar(Math.max(.0001, 1 - dt * 4));
    } else {
      shell.position.addScaledVector(shell.userData.velocity, dt);
      shell.userData.velocity.y -= 9 * dt;
      const shellGround = getSupportHeight(fieldGeometry(), shell.position) + .045;
      if (!shell.userData.bounced && shell.position.y <= shellGround && shell.userData.velocity.y < 0) {
        shell.position.y = shellGround;
        shell.userData.velocity.y *= -.26;
        shell.userData.velocity.x *= .62;
        shell.userData.velocity.z *= .62;
        shell.userData.bounced = true;
        playSound("shell", shellPool.indexOf(shell) % 2);
      } else if (shell.userData.bounced && combatBudget.casingRest > 0 && shell.position.y <= shellGround) {
        // Settle on its side so spent brass collects around firing positions.
        shell.position.y = shellGround - .045 + .018 * shell.scale.x;
        shell.rotation.set(0, Math.random() * Math.PI * 2, Math.PI / 2);
        shell.userData.resting = true;
        continue;
      }
      shell.rotation.x += dt * 13; shell.rotation.z += dt * 19;
    }
  }
  for (const magazine of magazinePool) {
    if (!magazine.visible) continue;
    magazine.userData.life -= dt;
    if (magazine.userData.life <= 0) magazine.visible = false;
    else {
      magazine.position.addScaledVector(magazine.userData.velocity, dt);
      if (!magazine.userData.resting) {
        magazine.userData.velocity.y -= 15 * dt;
        const magazineGround = getSupportHeight(fieldGeometry(), magazine.position);
        if (magazine.position.y <= magazineGround + .20 && magazine.userData.velocity.y < 0 &&
          magazineBounds.setFromObject(magazine).min.y <= magazineGround + .015) {
          magazine.position.y += magazineGround + .015 - magazineBounds.min.y;
          magazine.userData.velocity.y *= -.2;
          magazine.userData.velocity.x *= .45;
          magazine.userData.velocity.z *= .45;
          magazine.userData.bounced = true;
          if (Math.abs(magazine.userData.velocity.y) < .8) {
            magazine.userData.velocity.set(0, 0, 0);
            magazine.userData.resting = true;
          }
        }
        if (!magazine.userData.bounced) {
          magazine.rotateX(dt * 6);
          magazine.rotateZ(dt * 3);
        }
      }
    }
  }
  for (const burst of effectPool) {
    if (!burst.visible) continue;
    const age = (now - burst.userData.started) / 520;
    if (age >= 1) burst.visible = false;
    else {
      burst.children.forEach((shard, index) => {
        const seconds = age * .52;
        shard.position.copy(shard.userData.origin).addScaledVector(shard.userData.velocity, seconds);
        shard.position.y = Math.max(.035, shard.position.y - 4.9 * seconds * seconds);
        shard.rotation.x += dt * (4 + index); shard.rotation.y += dt * 5;
        shard.scale.setScalar(1 - age);
        shard.material.opacity = .9 * (1 - age);
      });
    }
  }
  for (const trail of tracerPool) {
    if (!trail.visible) continue;
    const age = (now - trail.userData.started) / (qualityLow ? 55 : 95);
    if (age >= 1) trail.visible = false;
    else trail.material.opacity = (1 - age) * .82;
  }
  for (const burst of combatBurstPool) {
    if (!burst.visible) continue;
    const ageSeconds = (now - burst.userData.started) / 1000;
    const life = burst.userData.life;
    if (ageSeconds >= life) {
      burst.visible = false;
    } else {
      const positions = burst.userData.positions;
      for (let i = 0; i < burst.userData.velocities.length; i++) {
        const velocity = burst.userData.velocities[i];
        positions[i * 3] = velocity.x * ageSeconds;
        positions[i * 3 + 1] = Math.max(-burst.position.y + .025,
          velocity.y * ageSeconds - 4.9 * ageSeconds * ageSeconds);
        positions[i * 3 + 2] = velocity.z * ageSeconds;
      }
      burst.userData.points.geometry.attributes.position.needsUpdate = true;
      burst.userData.points.material.opacity = Math.max(0, 1 - ageSeconds / life);
      burst.userData.dust.scale.setScalar(.35 + ageSeconds * 5);
      burst.userData.dust.material.opacity = Math.max(0, .32 * (1 - ageSeconds / life));
    }
  }
  for (const light of transientLightPool) {
    if (light.intensity <= 0) continue;
    const age = (now - light.userData.started) / light.userData.life;
    light.intensity = age >= 1 ? 0 : light.userData.peak * (1 - age);
  }
  const movement = movementPackets.next(now, player.position, player.yaw, player.pitch, crouching);
  if (movement) socket.volatile.emit("move", movement);
  gpuTimer.begin();
  if (!scopeActive || (!qualityLow && !performanceMode)) {
    if (composer && frameBudget.scale > .84) composer.render();
    else renderer.render(scene, camera);
  } else {
    renderer.setClearColor(0x050807);
    renderer.clear();
  }
  if (scopeActive) renderScopeLens(currentWeapon.optic.zoom);
  gpuTimer.end();
  renderStats.cpuMs = performance.now() - cpuStartedAt;
  renderStats.gpuMs = gpuMilliseconds;
}

function applyRenderBudget() {
  performanceMode = frameBudget.scale <= .76;
  renderer.shadowMap.enabled = graphics.shadows && !performanceMode;
  renderer.shadowMap.needsUpdate = renderer.shadowMap.enabled;
  if (occlusionPass) occlusionPass.enabled = frameBudget.scale > .84;
  if (bloomPass) bloomPass.enabled = frameBudget.scale > .84;
  resize(false);
}

function renderScopeLens(zoom) {
  const lensSize = Math.min(innerHeight * .70, innerWidth * .74) - 16;
  const targetSize = Math.max(128, Math.min(512, Math.round(lensSize * activeRenderPixelRatio)));
  if (!scopeTarget) {
    scopeTarget = new THREE.WebGLRenderTarget(targetSize, targetSize);
    scopeImage = new THREE.Mesh(new THREE.CircleGeometry(1, 48),
      new THREE.MeshBasicMaterial({ map: scopeTarget.texture, depthTest: false, depthWrite: false, toneMapped: false }));
    scopeImage.frustumCulled = false;
    scopeScene.add(scopeImage);
  } else if (scopeTarget.width !== targetSize) {
    scopeTarget.setSize(targetSize, targetSize);
  }
  scopeCamera.position.copy(camera.position);
  scopeCamera.quaternion.copy(camera.quaternion);
  scopeCamera.fov = scopeLensFov(settings.fov, zoom, lensSize, innerHeight);
  scopeCamera.updateProjectionMatrix();
  scopeImage.scale.set(lensSize / innerWidth, lensSize / innerHeight, 1);
  renderer.setRenderTarget(scopeTarget);
  renderer.render(scene, scopeCamera);
  renderer.setRenderTarget(null);
  renderer.autoClear = false;
  renderer.render(scopeScene, scopeHudCamera);
  renderer.autoClear = true;
}

function getEnemyGeometry() {
  if (enemyGeometry) return enemyGeometry;
  const radial = qualityLow ? 6 : 16;
  const smooth = qualityLow ? 8 : 24;
  enemyGeometry = {
    joint: new THREE.SphereGeometry(1, smooth, qualityLow ? 5 : 14),
    limb: new THREE.CapsuleGeometry(1, 1, qualityLow ? 2 : 7, radial),
    torso: new THREE.CapsuleGeometry(1, 1, qualityLow ? 3 : 9, radial),
    head: new THREE.SphereGeometry(1, smooth, qualityLow ? 6 : 16),
    armor: new THREE.SphereGeometry(1, smooth, qualityLow ? 5 : 12),
    armorShell: new THREE.CylinderGeometry(1, .83, 1, qualityLow ? 7 : 12, 1, true, Math.PI / 2, Math.PI),
    rounded: new RoundedBoxGeometry(1, 1, 1, qualityLow ? 2 : 6, qualityLow ? .08 : .14),
    foot: new THREE.CapsuleGeometry(1, 1, qualityLow ? 2 : 6, radial),
    claw: new THREE.ConeGeometry(1, 1, radial),
    core: new THREE.IcosahedronGeometry(1, qualityLow ? 1 : 2),
    antenna: new THREE.CylinderGeometry(1, 1, 1, radial)
  };
  return enemyGeometry;
}

function createEnemyModel(enemy, color) {
  const geometry = getEnemyGeometry();
  const isBrute = enemy.type === "brute";
  const isSkirmisher = enemy.type === "skirmisher";
  const uniformColor = sceneLook(selectedMap).soldiers[0];
  const plateColor = sceneLook(selectedMap).equipment[1];
  const mesh = new THREE.Group();
  const body = new THREE.Group();
  mesh.add(body);
  const bodyMaterial = new THREE.MeshPhysicalMaterial({
    color: isBrute ? 0x303339 : isSkirmisher ? 0x334b48 : uniformColor,
    emissive: color,
    emissiveIntensity: .035,
    metalness: .12,
    roughness: .72,
    clearcoat: qualityLow ? 0 : .16,
    clearcoatRoughness: .7
  });
  const armorMaterial = new THREE.MeshPhysicalMaterial({
    color: isBrute ? 0x515962 : isSkirmisher ? 0x72938a : plateColor,
    emissive: color,
    emissiveIntensity: .025,
    metalness: .14,
    roughness: .72,
    clearcoat: qualityLow ? 0 : .1,
    clearcoatRoughness: .7
  });
  const jointMaterial = new THREE.MeshStandardMaterial({
    color: 0x171a1c, metalness: .18, roughness: .88
  });
  const coreMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x705b48, emissive: color, emissiveIntensity: .12, roughness: .67,
    metalness: .3, clearcoat: .1
  });
  const skinMaterial = new THREE.MeshStandardMaterial({
    color: 0x8c7568, roughness: .82, metalness: 0
  });
  const reactiveMaterials = [bodyMaterial, armorMaterial];
  reactiveMaterials.forEach((material) => {
    material.userData.baseEmissive = material.emissive.clone();
    material.userData.baseEmissiveIntensity = material.emissiveIntensity;
  });
  const part = (parent, shape, material, position, scale, rotation = [0, 0, 0]) => {
    const object = new THREE.Mesh(shape, material);
    object.position.set(...position);
    object.scale.set(...scale);
    object.rotation.set(...rotation);
    object.castShadow = !qualityLow;
    object.receiveShadow = !qualityLow;
    parent.add(object);
    return object;
  };
  const joints = [];
  const arms = [];
  const scale = isBrute ? .93 : .82;
  body.scale.setScalar(scale);
  part(body, geometry.torso, bodyMaterial, [0, .43, 0], [.34, .37, .22]);
  part(body, geometry.armorShell, armorMaterial, [0, .48, .045],
    [isBrute ? .36 : .31, .47, .235], [0, Math.PI, 0]);
  part(body, geometry.armorShell, armorMaterial, [0, .48, -.04], [.3, .42, .23]);
  part(body, geometry.rounded, jointMaterial, [0, .02, 0], [.5, .28, .34]);
  for (const side of [-1, 1]) {
    part(body, geometry.rounded, jointMaterial, [side * .23, .54, .21], [.035, .48, .025], [0, 0, side * -.15]);
  }
  part(body, geometry.antenna, jointMaterial, [0, .98, 0], [.105, .18, .105]);
  part(body, geometry.head, skinMaterial, [0, 1.18, .015], [.21, .26, .215]);
  part(body, geometry.armor, armorMaterial, [0, 1.32, -.015], [.255, .165, .255]);
  part(body, geometry.rounded, armorMaterial, [0, 1.205, .185], [.37, .13, .13]);
  part(body, geometry.core, coreMaterial, [0, 1.2, .27], [.035, .025, .018]);
  part(body, geometry.rounded, coreMaterial, [0, .64, .285], [.09, .02, .016]);
  if (isSkirmisher) {
    part(body, geometry.rounded, coreMaterial, [0, .53, .28], [.19, .025, .02]);
  }

  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * .2, -.08, 0);
    body.add(hip);
    part(hip, geometry.joint, jointMaterial, [0, 0, 0], [.13, .13, .13]);
    part(hip, geometry.limb, bodyMaterial, [0, -.32, 0], [.13, .27, .14]);
    part(hip, geometry.rounded, armorMaterial, [0, -.28, .11], [.25, .36, .12]);
    const knee = new THREE.Group();
    knee.position.set(0, -.64, 0);
    hip.add(knee);
    part(knee, geometry.joint, armorMaterial, [0, 0, .08], [.14, .13, .11]);
    part(knee, geometry.limb, bodyMaterial, [0, -.3, 0], [.115, .26, .12]);
    part(knee, geometry.rounded, armorMaterial, [0, -.25, .1], [.2, .35, .1]);
    const foot = part(knee, geometry.foot, jointMaterial, [0, -.59, .12], [.15, .1, .26], [Math.PI / 2, 0, 0]);
    joints.push({ hip, knee, foot, side, offset: side > 0 ? 0 : Math.PI });

    const shoulder = new THREE.Group();
    shoulder.position.set(side * .46, .72, 0);
    shoulder.rotation.set(-.95, 0, side * -.12);
    body.add(shoulder);
    part(shoulder, geometry.joint, armorMaterial, [0, 0, 0], [.17, .18, .17]);
    part(shoulder, geometry.limb, bodyMaterial, [0, -.25, 0], [.105, .22, .11]);
    const elbow = new THREE.Group();
    elbow.position.set(0, -.49, 0);
    elbow.rotation.x = -.75;
    shoulder.add(elbow);
    part(elbow, geometry.joint, jointMaterial, [0, 0, 0], [.1, .1, .1]);
    part(elbow, geometry.limb, bodyMaterial, [0, -.23, 0], [.095, .2, .1]);
    part(elbow, geometry.head, jointMaterial, [0, -.45, 0], [.115, .14, .105]);
    arms.push({ shoulder, elbow, side, baseShoulderX: shoulder.rotation.x, baseElbowX: elbow.rotation.x });
  }
  const weapon = new THREE.Group();
  weapon.position.set(0, .45, .5);
  weapon.rotation.x = -.04;
  weapon.userData.baseRotationX = weapon.rotation.x;
  body.add(weapon);
  part(weapon, geometry.rounded, jointMaterial, [0, 0, 0], [.18, .15, .62]);
  part(weapon, geometry.rounded, armorMaterial, [0, .105, -.05], [.1, .1, .22]);
  part(weapon, geometry.antenna, jointMaterial, [0, 0, .57], [.035, .62, .035], [Math.PI / 2, 0, 0]);
  part(weapon, geometry.rounded, jointMaterial, [0, -.18, -.12], [.12, .32, .12], [-.18, 0, 0]);
  part(weapon, geometry.rounded, coreMaterial, [0, .12, .13], [.06, .035, .08]);
  const enemyFlash = part(weapon, new THREE.ConeGeometry(.09, .34, qualityLow ? 6 : 10),
    new THREE.MeshBasicMaterial({
      color: 0xffc179, transparent: true, opacity: .9, blending: THREE.AdditiveBlending,
      depthWrite: false
    }), [0, 0, .92], [.8, .8, 1], [Math.PI / 2, 0, 0]);
  enemyFlash.visible = false;
  enemyFlash.userData.disposeGeometry = true;
  joints.forEach((joint) => {
    joint.baseHipX = joint.hip.rotation.x;
    joint.baseHipZ = joint.hip.rotation.z;
    joint.baseKneeZ = joint.knee.rotation.z;
  });
  return { mesh, body, bodyMaterial, armorMaterial, coreMaterial, reactiveMaterials, joints, arms, weapon, enemyFlash };
}

function ensureTacticalBody() {
  if (!tacticalBodyLoadStarted) {
    tacticalBodyLoadStarted = true;
    fetchTacticalBody().then((body) => {
      setTacticalBody(body);
      loadedTacticalBody = body;
      rebuildWeaponHands();
      $("#assetStatus").textContent = "Winter tactical soldiers ready";
      syncEntities(state);
    }).catch((error) => {
      console.error("Deadlight Ops could not load the tactical character; fallback active.", error);
      $("#assetStatus").textContent = "Character asset failed · fallback active";
      $("#assetStatus").classList.add("asset-error");
    });
  }
}

function enemyVisual(enemy, detailed) {
  ensureTacticalBody();
  const model = createTacticalEnemy(enemy, {
    mapId: selectedMap, compact: qualityLow || performanceMode,
    distant: !detailed, shadows: graphics.shadows, weaponId: ENEMY_ROLES[enemy.role]?.weaponId
  });
  matteSurfaces(model.mesh);
  return model;
}

function disposeEntityModel(item) {
  item.skeleton?.dispose();
  const materials = new Set();
  item.mesh.traverse((object) => {
    if (object.isSprite && object.userData.playerTag) { disposePlayerTag(object); return; }
    if (!object.isMesh) return;
    if (object.userData.disposeGeometry) object.geometry?.dispose();
    if (!object.material) return;
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    objectMaterials.forEach((material) => materials.add(material));
  });
  materials.forEach((material) => {
    if (!material.userData.shared) material.dispose();
  });
}

function replaceEnemyVisual(item, enemy, detailed) {
  const oldMesh = item.mesh;
  oldMesh.remove(item.health);
  const model = enemyVisual(enemy, detailed);
  const offsetDelta = (model.modelOffsetY ?? 0) - (item.modelOffsetY ?? 0);
  model.mesh.position.copy(oldMesh.position);
  model.mesh.position.y += offsetDelta;
  model.mesh.rotation.copy(oldMesh.rotation);
  item.health.position.y = item.type === "brute" ? 2.55 : 2.3;
  model.mesh.add(item.health);
  scene.add(model.mesh);
  scene.remove(oldMesh);
  disposeEntityModel(item);
  Object.assign(item, model);
  item.contactShadow = null;
  item.target.y += offsetDelta;
  item.lastTarget.y += offsetDelta;
  item.from.y += offsetDelta;
  if (model.modelKind !== "distant") addEnemyContactShadow(item);
}

function addEnemyContactShadow(item) {
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(item.type === "brute" ? .68 : .52, qualityLow ? 12 : 28),
    new THREE.MeshBasicMaterial({
      color: 0x080a08, transparent: true, opacity: qualityLow ? .15 : .28,
      map: softContactTexture, depthWrite: false
    })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.userData.disposeGeometry = true;
  shadow.position.y = -(item.modelOffsetY ?? 0) + .018;
  shadow.scale.set(1, .62, 1);
  shadow.renderOrder = 1;
  item.mesh.add(shadow);
  item.contactShadow = shadow;
}

function syncEntities(next) {
  if (!scene || !next) return;
  if (destructibleCover && next.mapId === selectedMap) {
    destructibleCover.sync(next.props, playing && next.phase === "playing");
  }
  const active = new Set();
  const snapshotAt = performance.now();
  const teamObjects = [...(next.teamFields || []).map((field) => ({ ...field, kind: "station" })),
    ...(next.teamObjective ? [{ ...next.teamObjective, id: next.teamObjective.id },
      ...next.teamObjective.terminals.map((terminal) => ({ ...terminal, kind: "hack" }))] : [])];
  for (const object of teamObjects) {
    const id = `team:${object.id}`;
    active.add(id);
    let item = entities.get(id);
    if (!item) {
      item = { mesh: createTeamVisual(object.kind), kind: "team" };
      scene.add(item.mesh);
      entities.set(id, item);
    }
    item.mesh.position.set(object.position.x, object.position.y, object.position.z);
  }
  if (next.raid && next.phase === "playing") {
    const id = `r${next.raid.id}`;
    active.add(id);
    let item = entities.get(id);
    if (!item) {
      item = { mesh: createRaidMarker(next.raid), kind: "raid" };
      scene.add(item.mesh);
      entities.set(id, item);
    }
    item.mesh.position.set(next.raid.position.x, next.raid.position.y, next.raid.position.z);
  }
  let detailedCreates = 0;
  const visibleLoot = [...(next.loot || [])].sort((a, b) =>
    player.position.distanceToSquared(a.position) - player.position.distanceToSquared(b.position))
    .slice(0, touchDevice || qualityLow ? 12 : 32);
  for (const loot of visibleLoot) {
    const id = `l${loot.id}`; active.add(id);
    let item = entities.get(id);
    if (!item) {
      const mesh = createLootVisual(loot);
      mesh.castShadow = mesh.receiveShadow = graphics.shadows;
      scene.add(mesh);
      item = { kind: "loot", mesh };
      entities.set(id, item);
    }
    item.mesh.position.set(loot.position.x, loot.position.y, loot.position.z);
  }
  for (const supply of next.supplies || []) {
    const id = `s${supply.id}`; active.add(id);
    let item = entities.get(id);
    if (!item) {
      const mesh = new THREE.Group();
      const casing = new THREE.Mesh(new THREE.BoxGeometry(.9, .45, .6),
        new THREE.MeshStandardMaterial({ color: 0x64736a, metalness: .55, roughness: .48 }));
      const lid = new THREE.Mesh(new THREE.BoxGeometry(.95, .11, .65),
        new THREE.MeshStandardMaterial({ color: 0xb89c63, metalness: .54, roughness: .45 }));
      lid.position.y = .25;
      const marking = new THREE.Mesh(new THREE.BoxGeometry(.48, .04, .065),
        new THREE.MeshBasicMaterial({ color: 0xe7d6a2 }));
      marking.position.set(0, .32, .18);
      for (const part of [casing, lid, marking]) {
        part.userData.disposeGeometry = true;
        mesh.add(part);
      }
      matteSurfaces(mesh);
      scene.add(mesh);
      item = { kind: "supply", mesh };
      entities.set(id, item);
    }
    item.mesh.position.set(supply.position.x, supply.position.y, supply.position.z);
    item.mesh.visible = !supply.usedBy.includes(myId);
  }
  for (const enemy of next.enemies) {
    const id = `e${enemy.id}`; active.add(id);
    let item = entities.get(id);
    if (enemy.type === "practice") {
      if (!item) {
        item = { ...createPracticeTarget(enemy, { christmas: christmasEnabled }), kind: "target", hitUntil: 0 };
        matteSurfaces(item.mesh);
        entities.set(id, item);
        scene.add(item.mesh);
      }
      item.mesh.position.set(enemy.position.x, enemy.position.y, enemy.position.z);
      item.plates.rotation.x = enemy.health <= 0 ? -Math.PI / 2 : 0;
      continue;
    }
    const dx = enemy.position.x - player.position.x;
    const dz = enemy.position.z - player.position.z;
    const detailed = needsDetailedEnemy(dx * dx + dz * dz,
      item && item.modelKind !== "distant", qualityLow || performanceMode);
    if (!item) {
      const useDetail = detailed && detailedCreates < 2;
      if (useDetail) detailedCreates++;
      const model = enemyVisual(enemy, useDetail);
      const { mesh } = model;
      const health = new THREE.Group();
      health.position.y = enemy.type === "brute" ? 2.55 : 2.3;
      const back = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.075), new THREE.MeshBasicMaterial({
        color: 0x111411, transparent: true, opacity: .68, depthTest: true
      }));
      const fill = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.035), new THREE.MeshBasicMaterial({
        color: enemy.type === "brute" ? 0xa75d53 :
          enemy.type === "skirmisher" ? 0x84ab8d : 0xb78c65,
        transparent: true, opacity: .92, depthTest: true
      }));
      fill.position.z = 0.005;
      const indicator = new THREE.Mesh(
        new THREE.CircleGeometry(.075, 3),
        new THREE.MeshBasicMaterial({
          color: enemy.type === "brute" ? 0xd99069 : 0xc7b28d,
          transparent: true, opacity: .72, depthTest: true
        })
      );
      indicator.position.set(0, .16, .006);
      back.userData.disposeGeometry = true;
      fill.userData.disposeGeometry = true;
      indicator.userData.disposeGeometry = true;
      indicator.rotation.z = Math.PI;
      indicator.visible = enemy.type === "brute";
      health.add(back, fill, indicator);
      mesh.add(health);
      scene.add(mesh);
      item = {
        ...model, health, fill, indicator, kind: "enemy", type: enemy.type,
        serverId: enemy.id, wave: next.wave,
        target: new THREE.Vector3(enemy.position.x, enemy.position.y - 1 + (model.modelOffsetY ?? 0), enemy.position.z),
        lastTarget: new THREE.Vector3(enemy.position.x, enemy.position.y - 1 + (model.modelOffsetY ?? 0), enemy.position.z),
        from: new THREE.Vector3(enemy.position.x, enemy.position.y - 1 + (model.modelOffsetY ?? 0), enemy.position.z),
        snapshotAt, interpolationMs: 100,
        facing: 0, phase: Number(enemy.id) * 1.73, hitUntil: 0, staggerUntil: 0,
        attackUntil: 0, windupUntil: 0, windupTargetId: null,
        flashUntil: 0, healthRatio: 1,
        motionX: 0, motionZ: 0,
        baseScale: new THREE.Vector3(1, 1, 1)
      };
      mesh.position.copy(item.target);
      if (model.modelKind !== "distant") addEnemyContactShadow(item);
      entities.set(id, item);
    } else if (!item.dyingUntil) {
      if (tacticalBodyReady() && !item.sculpted && detailedCreates < 2) {
        replaceEnemyVisual(item, enemy, detailed);
        detailedCreates++;
      } else if (!detailed && item.modelKind !== "distant") {
        replaceEnemyVisual(item, enemy, false);
      } else if (detailed && detailedCreates < 2 &&
        item.modelKind === "distant") {
        replaceEnemyVisual(item, enemy, true);
        detailedCreates++;
      }
    }
    item.from.copy(item.mesh.position);
    item.interpolationMs = Math.max(70, Math.min(160, snapshotAt - item.snapshotAt));
    item.snapshotAt = snapshotAt;
    item.motionX = enemy.position.x - item.target.x;
    item.motionZ = enemy.position.z - item.target.z;
    item.target.set(enemy.position.x, enemy.position.y - 1 + (item.modelOffsetY ?? 0), enemy.position.z);
    item.windupUntil = enemy.threat ? snapshotAt + enemy.threat.remainingMs : 0;
    item.windupTargetId = enemy.threat?.targetId ?? null;
    if (enemy.staggerRemainingMs > 0) item.staggerUntil = snapshotAt + enemy.staggerRemainingMs;
    const healthRatio = Math.max(0, enemy.health / enemy.maxHealth);
    item.healthRatio = healthRatio;
    item.fill.scale.x = healthRatio;
    item.fill.position.x = -(1 - healthRatio) * 0.43;
    item.fill.material.color.setHex(healthRatio < .3 ? 0x9e514b :
      enemy.type === "brute" ? 0xa75d53 :
        enemy.type === "skirmisher" ? 0x84ab8d : 0xb78c65);
    item.health.visible = healthRatio < 0.999;
  }
  for (const teammate of next.players.filter((p) => p.socketId !== myId)) {
    const id = `p${teammate.socketId}`; active.add(id);
    let item = entities.get(id);
    if (item && (item.weaponId !== teammate.weaponId || item.skinId !== teammate.skinId ||
      item.attachmentId !== teammate.attachmentId || item.finishId !== teammate.finishId || tacticalBodyReady() && !item.sculpted)) {
      scene.remove(item.mesh);
      disposeEntityModel(item);
      entities.delete(id);
      item = null;
    }
    if (!item) {
      const model = createTacticalEnemy({ id: teammate.playerTag, type: "drone" }, {
        mapId: selectedMap, compact: graphics.compact || performanceMode,
        weaponId: teammate.weaponId, skinId: teammate.skinId, shadows: graphics.shadows,
        attachmentId: teammate.attachmentId, finishId: teammate.finishId
      });
      matteSurfaces(model.mesh);
      model.mesh.scale.setScalar(.85);
      scene.add(model.mesh);
      item = { ...model, kind: "player", type: "drone", weaponId: teammate.weaponId, skinId: teammate.skinId,
        attachmentId: teammate.attachmentId, finishId: teammate.finishId, target: new THREE.Vector3(),
        from: new THREE.Vector3(), snapshotAt, interpolationMs: 100 };
      entities.set(id, item);
      item.mesh.position.set(teammate.position.x, teammate.position.y - playerStance(teammate.crouching).eyeHeight, teammate.position.z);
    }
    const tagKey = `${teammate.name}:${teammate.staffRole}`;
    if (item.tagKey !== tagKey) {
      if (item.nameTag) {
        item.mesh.remove(item.nameTag);
        disposePlayerTag(item.nameTag);
      }
      item.nameTag = createPlayerTag(teammate.name, teammate.staffRole);
      item.nameTag.userData.playerTag = true;
      item.mesh.add(item.nameTag);
      item.tagKey = tagKey;
    }
    item.from.copy(item.mesh.position);
    item.interpolationMs = Math.max(70, Math.min(160, snapshotAt - item.snapshotAt));
    item.snapshotAt = snapshotAt;
    item.target.set(teammate.position.x, teammate.position.y - playerStance(teammate.crouching).eyeHeight, teammate.position.z);
    item.crouching = teammate.crouching;
    item.downed = Boolean(teammate.downedUntil);
    item.nameTag.position.y = 2.3 -
      (teammate.crouching ? (playerStance(false).eyeHeight - playerStance(true).eyeHeight) / .85 : 0);
    item.moveBlend = THREE.MathUtils.clamp(item.from.distanceTo(item.target) / (item.interpolationMs / 1000) / 6.4, 0, 1);
    item.mesh.visible = !teammate.deadUntil;
    item.facing = Number.isFinite(teammate.yaw) ? teammate.yaw + Math.PI : item.mesh.rotation.y;
    item.aimPitch = teammate.pitch;
  }
  for (const [id, item] of entities) {
    if (!active.has(id)) {
      if (item.kind === "enemy") {
        if (!item.dyingUntil) startEnemyDeath(item, id);
      } else {
        scene.remove(item.mesh);
        disposeEntityModel(item);
        entities.delete(id);
      }
    }
  }

  function startEnemyDeath(item, id) {
    item.dyingUntil = performance.now() + 840;
    item.deathDirection = Number(String(id).replace(/\D/g, "")) % 2 ? 1 : -1;
    item.motionX = 0;
    item.motionZ = 0;
    item.health.visible = false;
    item.enemyFlash && (item.enemyFlash.visible = false);
    deathBurst(item.mesh.position, item.type === "brute" ? 0x6f5b52 :
      item.type === "skirmisher" ? 0x55786d : 0x756b5b);
  }
  for (const attack of next.attacks || []) renderEnemyAttack(attack);
}

function renderEnemyAttack(attack) {
  if (seenAttackIds.has(attack.id)) return;
  seenAttackIds.add(attack.id);
  if (seenAttackIds.size > 200) {
    const oldest = seenAttackIds.values().next().value;
    seenAttackIds.delete(oldest);
  }
  const item = entities.get(`e${attack.enemyId}`);
  if (playing && !muted) playPositionalReport(item?.type === "sentinel" ? "marksman" :
    item?.type === "brute" ? "lmg" : "rifle", attack.origin);
  if (item) {
    item.attackUntil = performance.now() + 260;
    const dx = attack.target.x - attack.origin.x;
    const dz = attack.target.z - attack.origin.z;
    if (Math.hypot(dx, dz) > .001) {
      item.facing = enemyFacingYaw(dx, dz, false);
    }
  }
  const origin = item?.enemyFlash ? item.enemyFlash.getWorldPosition(new THREE.Vector3()) :
    new THREE.Vector3(attack.origin.x, attack.origin.y, attack.origin.z);
  const target = new THREE.Vector3(attack.target.x, attack.target.y, attack.target.z);
  const distance = origin.distanceTo(target);
  const direction = target.clone().sub(origin).normalize();
  tracer(origin, direction, 0xbfa783, distance);
  flashPointLight(origin, 0xffb56b, qualityLow ? .65 : 1.25, 70);
  if (item?.enemyFlash) {
    item.enemyFlash.visible = true;
    item.enemyFlash.rotation.z = (Number(attack.id) * 1.71) % Math.PI;
    setTimeout(() => { if (item.enemyFlash) item.enemyFlash.visible = false; }, 55);
  }
  if (attack.targetId === myId) showDamageDirection(attack.origin);
}

function reactEnemyHit(enemyId, hitZone, playerId) {
  const enemy = entities.get(playerId ? `p${playerId}` : `e${enemyId}`);
  if (!enemy) return;
  const now = performance.now();
  enemy.hitUntil = now + (hitZone === "head" ? 180 : 125);
  enemy.staggerUntil = now + (hitZone === "head" ? 230 : 155);
}

function emitEnemyBlood(hit, origin, direction) {
  if (!bloodEnabled || !bloodEffects) return;
  const enemy = entities.get(hit.playerId ? `p${hit.playerId}` : `e${hit.enemyId}`);
  if (!enemy || enemy.kind === "target") return;
  const contact = confirmedBloodContact(enemy, hit, origin, direction);
  bloodEffects.emit(contact.position, contact.normal, { headshot: hit.hitZone === "head", killed: hit.killed });
}

function showDamageDirection(origin) {
  const bearing = Math.atan2(origin.x - player.position.x, origin.z - player.position.z);
  const relativeDegrees = THREE.MathUtils.radToDeg(bearing - player.yaw);
  const indicator = $(".damage-direction");
  indicator.style.transform = `translate(-50%, -50%) rotate(${relativeDegrees}deg)`;
  indicator.classList.remove("active");
  requestAnimationFrame(() => indicator.classList.add("active"));
  setTimeout(() => indicator.classList.remove("active"), 420);
}

function updateIncomingThreat() {
  const indicator = $(".incoming-direction");
  const label = $(".incoming-label");
  const me = state?.players.find((candidate) => candidate.socketId === myId);
  let closest = null;
  if (!me?.deadUntil) {
    for (const item of entities.values()) {
      if (item.kind !== "enemy" || item.dyingUntil ||
        item.windupTargetId !== myId || item.windupUntil <= performance.now()) continue;
      const distance = item.mesh.position.distanceToSquared(camera.position);
      if (!closest || distance < closest.distance) closest = { item, distance };
    }
  }
  indicator.classList.toggle("active", Boolean(closest));
  label.classList.toggle("hidden", !closest);
  if (closest) {
    const origin = closest.item.mesh.position;
    const bearing = Math.atan2(origin.x - player.position.x, origin.z - player.position.z);
    indicator.style.transform =
      `translate(-50%, -50%) rotate(${THREE.MathUtils.radToDeg(bearing - player.yaw)}deg)`;
  }
}

function fire() {
  if (!state || state.phase !== "playing") return;
  const me = state.players.find((item) => item.socketId === myId);
  if (!me || me.deadUntil || me.downedUntil || me.reloading) return;
  if (me.ammo <= 0) {
    dryFire();
    return;
  }
  const direction = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(
    player.pitch + recoilState.pitch, player.yaw + recoilState.yaw, 0, "YXZ")).normalize();
  const shotOrigin = player.position.clone();
  const shotRoom = roomCode;
  const feedback = weaponFeedback(currentWeapon.id);
  muzzleLight.intensity = feedback.suppressed ? .6 : 2.4;
  muzzleFlash.visible = true;
  muzzleFlash.scale.setScalar(feedback.suppressed ? .45 : 1);
  muzzleFlash.rotation.z = Math.random() * Math.PI;
  recoil = Math.min(1, recoil + currentWeapon.recoil);
  const recoilAt = performance.now();
  if (recoilAt - lastRecoilShot > 500) recoilSequence = 0;
  lastRecoilShot = recoilAt;
  kickRecoil(recoilState, currentWeapon.id, recoilSequence++, adsAmount, currentWeapon.recoil / weaponFor(currentWeapon.id).recoil);
  kickCamera(cameraFeel, "shot", currentWeapon.recoil * .003);
  playSound("shot");
  ejectShell();
  const muzzlePosition = weapon.visible ? muzzleFlash.getWorldPosition(new THREE.Vector3()) :
    camera.position.clone().addScaledVector(direction, .7);
  muzzleUntil = recoilAt + feedback.muzzle.duration;
  for (const ray of shotDirections(currentWeapon.id, direction)) {
    tracer(muzzlePosition, ray, 0xffd27a, currentWeapon.pellets ? 12 : 25);
  }
  muzzleSmoke?.emit(muzzlePosition, direction, { heavy: Boolean(currentWeapon.pellets) || currentWeapon.recoil > .6 });
  socket.emit("shoot", { direction: { x: direction.x, y: direction.y, z: direction.z } }, (result) => {
    if (roomCode !== shotRoom || !playing) return;
    if (result?.ok) { recordTraining("fire"); addKillFeed(myId, result.hits); }
    if (result?.killed) recordTraining("kill");
    if (result?.ok) markCoverImpacts(result, shotOrigin, direction);
    if (result?.hit) {
      if (damageNumbersEnabled) damageNumbers.add(result.hits || [result], performance.now());
      const hitDirection = result.direction
        ? new THREE.Vector3(result.direction.x, result.direction.y, result.direction.z).normalize()
        : direction;
      const markerClass = result.killed ? "kill" : result.hitZone === "head" ? "headshot" : "hit";
      hitMarker.show(markerClass, result.killed ? 210 : 120);
      for (const hit of result.hits || [result]) {
        const ray = hit.direction ? new THREE.Vector3(hit.direction.x, hit.direction.y, hit.direction.z) : hitDirection;
        reactEnemyHit(hit.enemyId, hit.hitZone, hit.playerId);
        emitEnemyBlood(hit, shotOrigin, ray);
        if (!muted) combatAudio?.surface("impact", "flesh", {
          position: hit.position, listener: player
        });
      }
      playSound(result.killed ? "kill" : result.hitZone === "head" ? "headshot" : "hit");
      showCombatConfirmation(
        state.mode === "practice"
          ? result.killed ? "TARGET DOWN" : result.hitZone === "head" ? "HEADSHOT" : "TARGET HIT"
          : result.killed
          ? result.kills > 1 ? `${result.kills} ELIMINATED` : result.hitZone === "head" ? "HEADSHOT · ELIMINATED" : "ELIMINATED"
          : result.hitZone === "head" ? damageNumbersEnabled ? `HEADSHOT · ${result.damage}` : "HEADSHOT" :
            damageNumbersEnabled ? `HIT · ${result.damage}` : "HIT",
        markerClass
      );
    } else if (result?.ok && result.rays?.some((ray) => ray.propId)) {
      showCombatConfirmation("BREAKABLE COVER HIT", "hit");
    } else if (result?.reason === "Empty") {
      dryFire();
    } else if (result && !result.ok && result.reason !== "Fire rate") {
      toast(result.reason?.toUpperCase() || "SHOT REJECTED", "warning");
    }
  });
}

function markCoverImpacts(result, origin, fallback, weaponId = currentWeapon.id) {
  if (!state) return;
  const rays = result.rays?.length ? result.rays : [result];
  let sounded = false;
  for (const ray of rays.slice(0, 6)) {
    if (ray.impact !== "cover") continue;
    const surface = impactSurface(fieldGeometry(), origin, ray.direction || fallback, ray.distance);
    if (surface) {
      const material = contactMaterial(surface, state.mapId);
      if (!ray.propId) combatDecals?.add(surface, { size: weaponFor(weaponId).pellets ? .06 : .085 });
      surfaceImpacts?.emit(surface, material);
      if (!sounded && !muted) {
        combatAudio?.surface("impact", material, { position: surface.position, listener: player });
        sounded = true;
      }
    }
  }
}

function dryFire() {
  const now = performance.now();
  if (now - lastDryFire < 240) return;
  lastDryFire = now;
  playSound("dry");
  recoil = Math.min(1, recoil + .035);
  hitMarker.show("dry", 150);
  showCombatConfirmation(touchControls.enabled ? "MAGAZINE EMPTY · RELOAD" : "MAGAZINE EMPTY · R", "dry");
}

function showCombatConfirmation(text, kind = "hit") {
  const confirmation = $(".combat-confirm");
  confirmation.textContent = text;
  confirmation.className = `combat-confirm ${kind} active`;
  clearTimeout(showCombatConfirmation.timer);
  showCombatConfirmation.timer = setTimeout(() => {
    if (confirmation) confirmation.className = "combat-confirm";
  }, kind === "kill" ? 900 : 620);
}

function ejectShell() {
  let shell = shellPool.find((item) => !item.visible);
  // Keep a bounded number of casings on the ground and recycle the oldest one.
  if (!shell && shellPool.length >= combatBudget.casings) {
    shell = shellPool.reduce((oldest, item) => item.userData.ejectedAt < oldest.userData.ejectedAt ? item : oldest);
  }
  if (!shell) {
    shell = new THREE.Mesh(
      new THREE.CylinderGeometry(.018, .018, .075, 7),
      new THREE.MeshStandardMaterial({ color: 0xc99648, metalness: .9, roughness: .25 })
    );
    matteSurfaces(shell);
    shellPool.push(shell); scene.add(shell);
  }
  shell.position.set(.45, -.29, -1.09).applyMatrix4(camera.matrixWorld);
  shell.scale.set(currentWeapon.pellets ? 1.6 : 1, 1, currentWeapon.pellets ? 1.6 : 1);
  shell.material.color.setHex(currentWeapon.pellets ? 0x9a4a36 : 0xc99648);
  const velocity = new THREE.Vector3(2.2 + Math.random(), 1.7 + Math.random(), .1).applyQuaternion(camera.quaternion);
  shell.userData.velocity = velocity;
  shell.userData.life = .85 + combatBudget.casingRest;
  shell.userData.bounced = shell.userData.resting = false;
  shell.userData.ejectedAt = performance.now();
  shell.visible = true;
}

function ejectMagazine() {
  const dropped = acquireDroppedMagazine(magazinePool, weaponMagazine, currentWeapon.id);
  matteSurfaces(dropped);
  scene.add(dropped);
  weaponMagazine.getWorldPosition(dropped.position);
  weaponMagazine.getWorldQuaternion(dropped.quaternion);
  weaponMagazine.getWorldScale(dropped.scale);
  dropped.userData.velocity = new THREE.Vector3(-.65, .35, .25).applyQuaternion(camera.quaternion);
  dropped.userData.spawnedAt = performance.now();
  dropped.userData.life = 2.4;
  dropped.userData.bounced = false;
  dropped.userData.resting = false;
  dropped.visible = true;
}

function flashPointLight(position, color, peak = 3.5, life = 110) {
  let light = transientLightPool.find((item) => item.intensity <= 0);
  if (!light) {
    if (transientLightPool.length >= (qualityLow ? 2 : 6)) {
      light = transientLightPool.reduce((oldest, item) =>
        item.userData.started < oldest.userData.started ? item : oldest);
    } else {
      light = new THREE.PointLight(color, 0, qualityLow ? 2.8 : 4.5, 2);
      transientLightPool.push(light);
      scene.add(light);
    }
  }
  light.color.set(color);
  light.position.copy(position);
  light.userData.started = performance.now();
  light.userData.life = life;
  light.userData.peak = peak;
  light.intensity = peak;
}

function spawnCombatBurst(position, color, direction = { x: 0, y: 1, z: 0 }, intensity = 1, dust = true) {
  let burst = combatBurstPool.find((item) => !item.visible);
  if (!burst) {
    if (combatBurstPool.length >= (qualityLow ? 4 : 12)) {
      burst = combatBurstPool.reduce((oldest, item) =>
        item.userData.started < oldest.userData.started ? item : oldest);
    } else {
      const count = qualityLow ? 3 : 6;
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(count * 3);
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const points = new THREE.Points(geometry, new THREE.PointsMaterial({
        color, size: qualityLow ? .055 : .075, transparent: true, opacity: .75,
        blending: THREE.NormalBlending, depthWrite: false, sizeAttenuation: true
      }));
      const dustRing = new THREE.Mesh(
        new THREE.RingGeometry(.05, .18, qualityLow ? 8 : 16),
        new THREE.MeshBasicMaterial({
          color: 0x8d7760, transparent: true, opacity: .3, depthWrite: false,
          side: THREE.DoubleSide
        })
      );
      dustRing.rotation.x = -Math.PI / 2;
      burst = new THREE.Group();
      burst.add(points, dustRing);
      burst.userData = {
        points, dust: dustRing, positions, velocities: Array.from({ length: count }, () => new THREE.Vector3()),
        started: 0, life: .45
      };
      combatBurstPool.push(burst);
      scene.add(burst);
    }
  }
  const normal = new THREE.Vector3(direction.x, direction.y, direction.z).normalize();
  burst.position.copy(position);
  burst.userData.points.material.color.set(color);
  burst.userData.dust.visible = dust;
  burst.userData.dust.scale.setScalar(1);
  for (let i = 0; i < burst.userData.velocities.length; i++) {
    const spread = new THREE.Vector3(
      (Math.random() - .5) * 2.8,
      Math.random() * 2.8 + .25,
      (Math.random() - .5) * 2.8
    );
    burst.userData.velocities[i].copy(normal).multiplyScalar(-Math.random() * 2.2).add(spread).multiplyScalar(intensity);
    burst.userData.positions[i * 3] = 0;
    burst.userData.positions[i * 3 + 1] = 0;
    burst.userData.positions[i * 3 + 2] = 0;
  }
  burst.userData.points.geometry.attributes.position.needsUpdate = true;
  burst.userData.started = performance.now();
  burst.userData.life = qualityLow ? .32 : .5;
  burst.visible = true;
  if (!dust) flashPointLight(position, color, qualityLow ? .5 : 1.1 * intensity, 55);
}

function deathBurst(position, color) {
  const groundedPosition = new THREE.Vector3(position.x, Math.max(.14, position.y - 1.05), position.z);
  spawnCombatBurst(groundedPosition, color, { x: 0, y: -1, z: 0 }, .42, true);
}

function tracer(origin, direction, color, distance = 25) {
  if (!scene || !origin || !direction) return;
  const start = new THREE.Vector3(origin.x, origin.y, origin.z);
  const length = Number.isFinite(distance) ? Math.min(16, Math.max(.25, distance)) : 14;
  const end = start.clone().add(new THREE.Vector3(direction.x, direction.y, direction.z).multiplyScalar(length));
  let line = tracerPool.find((item) => !item.visible);
  if (!line) {
    if (tracerPool.length >= (qualityLow ? 8 : 24)) {
      line = tracerPool.reduce((oldest, item) =>
        item.userData.started < oldest.userData.started ? item : oldest);
    } else {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
      line = new THREE.Line(geometry, new THREE.LineBasicMaterial({
        color, transparent: true, opacity: .65,
        depthWrite: false
      }));
      tracerPool.push(line);
      scene.add(line);
    }
  }
  const positions = line.geometry.attributes.position.array;
  positions.set([start.x, start.y, start.z, end.x, end.y, end.z]);
  line.geometry.attributes.position.needsUpdate = true;
  line.geometry.computeBoundingSphere();
  line.material.color.set(color);
  line.material.opacity = .65;
  line.userData.started = performance.now();
  line.visible = true;
}

function updateAwareness() {
  const node = $(".awareness");
  if (!node || !state || state.mode === "practice" || !playing || state.phase !== "playing" || !state.enemies.length || wasDead) {
    node?.classList.add("hidden");
    return;
  }
  let nearest = null;
  for (const enemy of state.enemies) {
    const dx = enemy.position.x - player.position.x;
    const dz = enemy.position.z - player.position.z;
    const distance = Math.hypot(dx, dz);
    if (!nearest || distance < nearest.distance) nearest = { dx, dz, distance };
  }
  if (!nearest) return node.classList.add("hidden");
  const bearing = Math.atan2(nearest.dx, nearest.dz);
  const relativeDegrees = THREE.MathUtils.radToDeg(bearing - player.yaw);
  const coarseDistance = Math.max(5, Math.round(nearest.distance / 5) * 5);
  node.classList.remove("hidden");
  node.querySelector("i").style.transform = `rotate(${relativeDegrees}deg)`;
  node.querySelector("span").textContent =
    `${state.enemies.length} contact${state.enemies.length === 1 ? "" : "s"} · ~${coarseDistance} m`;
}

function updateHud(next) {
  const me = next.players.find((p) => p.socketId === myId);
  if (!me) return;
  const downed = Boolean(me.downedUntil);
  if (downed && !wasDowned && playerBody) {
    crouching = true;
    setPlayerCrouching(playerBody, true);
    playerBody.position.set(me.position.x, me.position.y - playerStance(true).eyeOffset, me.position.z);
    playerBody.velocity.setZero();
    previousPhysicsPosition.copy(playerBody.position);
    accumulator = 0;
  }
  wasDowned = downed;
  const coop = cooperativeMode(next.mode);
  $("#hud").classList.toggle("has-team-objective", Boolean(next.teamObjective));
  const classInfo = SQUAD_CLASSES[me.classId || DEFAULT_CLASS];
  const cooldown = Math.max(0, Math.ceil((me.abilityReadyAt - next.serverNow) / 1000));
  $("#classStatus").classList.toggle("hidden", !coop);
  $("#classStatus").textContent = `${classInfo.name} · ${touchControls.enabled ? "" : `${classInfo.ability} · `}${cooldown ? `${cooldown}s` : touchControls.enabled ? "Ready" : keyLabel(bindings.ability)}${me.guard ? ` · Guard ${me.guard}` : ""}`;
  $("#classStatus").title = classInfo.description;
  $("#downedStatus").classList.toggle("hidden", !downed);
  $("#downedStatus span").textContent = me.revivedBy
    ? `REVIVING · ${(me.reviveProgressMs / 1000).toFixed(1)} s`
    : `${Math.max(0, Math.ceil((me.downedUntil - next.serverNow) / 1000))} s · teammate must hold Interact within 3 m`;
  $(".touch-team-actions").classList.toggle("hidden", !coop);
  const interaction = teamInteractionTarget(next, myId, player.position);
  const interactButton = $("#touchControls [data-touch='interact']");
  interactButton.disabled = !interaction;
  interactButton.textContent = interaction?.id.startsWith("terminal-") ? "Hack" : "Revive";
  $("#touchControls [data-touch='ability']").disabled = Boolean(cooldown || downed || me.deadUntil);
  $("#touchControls [data-touch='ability']").textContent = cooldown ? `${cooldown}s` : classInfo.name;
  $("#touchControls [data-touch='ability']").setAttribute("aria-label", `${classInfo.ability}: ${classInfo.description}`);
  for (const action of ["fire", "jump", "aim", "sprint", "crouch"]) {
    $(`#touchControls [data-touch='${action}']`).disabled = downed || Boolean(me.deadUntil);
  }
  const points = [...(next.teamPings || []).map((ping) => ({ ...ping, id: `ping:${ping.id}`,
    label: ping.kind === "enemy" ? "Enemy reported" : ping.kind === "ammo" ? "Ammo" : "Route" })),
    ...next.players.filter((ally) => ally.socketId !== myId && ally.downedUntil)
      .map((ally) => ({ id: `down:${ally.socketId}`, position: ally.position, label: `REVIVE ${ally.name}` })),
    ...(next.teamObjective ? [{ id: "team-objective", position: next.teamObjective.position, label: next.teamObjective.title },
      ...next.teamObjective.terminals.map((terminal, index) => ({ ...terminal, label: `Terminal ${index + 1}` }))] : [])];
  const ids = new Set(points.map((point) => point.id));
  for (const [id, value] of teamMarkerNodes) if (!ids.has(id)) { value.node.remove(); teamMarkerNodes.delete(id); }
  for (const point of points) {
    if (!teamMarkerNodes.has(point.id)) {
      const node = document.createElement("span");
      node.className = "team-marker";
      $("#teamMarkers").append(node);
      teamMarkerNodes.set(point.id, { node, point });
    } else teamMarkerNodes.get(point.id).point = point;
  }
  const latestPing = next.teamPings?.at(-1);
  if (latestPing && $("#teamNotice").dataset.pingId !== String(latestPing.id)) {
    $("#teamNotice").dataset.pingId = String(latestPing.id);
    $("#teamNotice").textContent = `${next.players.find((ally) => ally.socketId === latestPing.byId)?.name || "Teammate"} marked ${latestPing.kind}.`;
  }
  if (weapon && (me.weaponId !== currentWeapon.id || renderedWeaponStyle !== JSON.stringify([me.attachmentId, me.finishId]) ||
    currentWeapon.reserve !== effectiveWeapon(me.weaponId, me).reserve ||
    currentWeapon.reloadMs !== effectiveWeapon(me.weaponId, me).reloadMs ||
    currentWeapon.spreadMultiplier !== effectiveWeapon(me.weaponId, me).spreadMultiplier)) replaceHeldWeapon(me.weaponId, me);
  $(".wave").textContent = next.mode === "operation" ? `TEAM OP · ${next.wave} / 4` : next.mode === "practice" ? "PRACTICE · NO REWARDS" : next.mode === "raid" ? `RAID · ${next.wave} / 3` : next.mode === "ffa" ? `FREE-FOR-ALL · ${Math.max(0, Math.ceil((next.matchEndsAt - next.serverNow) / 1000))}s` :
    next.phase === "between" ? `NEXT WAVE ${next.countdown}` : `WAVE ${next.wave} / ${next.maxWaves}`;
  if (!["ffa", "practice"].includes(next.mode) && next.phase === "playing" && next.wave !== lastWave) {
    lastWave = next.wave;
    $(".wave-alert strong").textContent = next.mode === "operation" ? `TEAM OBJECTIVE ${next.wave}` : next.mode === "raid" ? `RAID STAGE ${next.wave}` : `WAVE ${next.wave}`;
    $(".wave-alert").classList.remove("active");
    requestAnimationFrame(() => $(".wave-alert")?.classList.add("active"));
    setTimeout(() => $(".wave-alert")?.classList.remove("active"), 2200);
    playSound("wave");
  }
  $(".objective").textContent = next.objective;
  const pace = $("#encounterPace"), comms = $("#enemyComms");
  pace.classList.toggle("hidden", !next.director || next.phase !== "playing");
  pace.textContent = next.director ? `${AI_DIFFICULTIES[next.difficulty].name} · ${DIRECTOR_LABELS[next.director.phase]}` : "";
  const callout = !me.deadUntil && next.phase === "playing"
    ? audibleEnemyCallout(next.callouts || [], me.position, next.serverNow) : null;
  comms.classList.toggle("hidden", !callout);
  if (callout && comms.dataset.calloutId !== String(callout.id)) {
    comms.dataset.calloutId = String(callout.id);
    comms.querySelector("strong").textContent = `Hostile ${callout.speaker}`;
    comms.querySelector("span").textContent = callout.text;
  }
  $(".hostiles").textContent = next.mode === "practice"
    ? `${me.practiceStats.targets} targets · ${me.practiceStats.shots ? Math.round(me.practiceStats.hits / me.practiceStats.shots * 100) : 0}% accuracy`
    : next.mode === "ffa" ? `${me.kills} / ${next.scoreLimit} eliminations` :
    `${String(next.enemies.length).padStart(2, "0")} hostiles`;
  const supply = nearbySupply();
  const loot = nearbyLoot();
  const raidObjective = nearbyRaidObjective();
  const raidStatus = $("#raidStatus");
  raidStatus.classList.toggle("hidden", !next.raid && !next.teamObjective);
  if (next.raid) {
    const objective = next.raid, boss = next.enemies.find((enemy) => enemy.id === objective.bossId);
    const distance = Math.round(Math.hypot(me.position.x - objective.position.x, me.position.z - objective.position.z));
    raidStatus.querySelector("strong").textContent = objective.title;
    raidStatus.querySelector("span").textContent = objective.stage === 0
      ? `${distance} m · Hold ${(objective.progressMs / 1000).toFixed(1)} / 12 s${objective.contested ? " · CONTESTED" : ""}`
      : objective.stage === 1 ? `${distance} m · ${next.enemies.length ? `${next.enemies.length} guards remaining` : `Recover cache · ${touchControls.enabled ? "tap Objective" : "E"}`}`
        : boss ? `Commander ${Math.max(0, boss.health)} / ${boss.maxHealth} HP · ${next.enemies.length - 1} escorts`
          : "Commander down · eliminate the remaining escorts";
    const ratio = objective.stage === 0 ? objective.progressMs / objective.requiredMs :
      objective.stage === 2 && boss ? Math.max(0, boss.health / boss.maxHealth) : objective.stage === 1 ? 0 : 1;
    raidStatus.querySelector("i").style.width = `${Math.round(ratio * 100)}%`;
  }
  if (next.teamObjective) {
    const objective = next.teamObjective;
    const shortHint = { defend: "Hold the 5 m zone; clear threats", escort: "Stay within 5 m; clear threats",
      hack: `Hold separate terminals · ${objective.terminals.filter((terminal) => terminal.occupiedBy).length}/${Math.min(2, next.players.filter((member) => member.connected).length)} linked`,
      extract: "Clear the sector; gather all operators" }[objective.kind];
    raidStatus.title = objective.hint;
    raidStatus.querySelector("strong").textContent = objective.title;
    raidStatus.querySelector("span").textContent = `${touchControls.enabled ? shortHint : objective.hint}${objective.contested ? " CONTESTED" : ""} · ${
      objective.kind === "escort" ? `${Math.round(Math.hypot(objective.position.x - objective.destination.x, objective.position.z - objective.destination.z))} m left` :
        `${(objective.progressMs / 1000).toFixed(1)} / ${objective.requiredMs / 1000} s`}`;
    raidStatus.querySelector("i").style.width = `${objective.kind === "escort" ? 0 : objective.progressMs / objective.requiredMs * 100}%`;
  }
  $(".supply-prompt").classList.toggle("hidden", !supply && !loot && !raidObjective);
  $(".supply-prompt").textContent = raidObjective
    ? `${touchControls.enabled ? "TAP OBJECTIVE" : "E"} · RECOVER ENCRYPTED CACHE` : loot
    ? `${touchControls.enabled ? "TAP LOOT" : "E"} · ${loot.source === "chest" ? "OPEN CHEST" : "COLLECT"} · ${loot.kind === "weapon" ? weaponFor(loot.weaponId).name : loot.kind === "medkit" ? "MEDKIT" : "AMMO"}`
    : supply
    ? touchControls.enabled ? "TAP AMMO · RESUPPLY" : "E · RESUPPLY AMMO (2 MAGAZINES)" : "";
  if (interaction) {
    $(".supply-prompt").classList.remove("hidden");
    $(".supply-prompt").textContent = `HOLD ${touchControls.enabled ? "REVIVE / HACK" : keyLabel(bindings.interact)} · ${interaction.label} · STAY STILL${interaction.progressMs ? ` · ${(interaction.progressMs / 1000).toFixed(1)}s` : ""}`;
  }
  $("#touchControls [data-touch='supply']").textContent = raidObjective ? "Objective" : loot ? "Loot" : "Ammo";
  $("#touchControls [data-touch='supply']").setAttribute("aria-label", raidObjective ? "Recover encrypted cache" : loot ? "Collect nearby loot" : "Resupply ammunition");
  $("#touchControls [data-touch='supply']").disabled = !raidObjective && !loot && (!supply || me.reserve >= effectiveWeapon(me.weaponId, me).reserve);
  $("#touchControls [data-touch='reload']").disabled = downed || me.reloading || me.ammo >= weaponFor(me.weaponId).magSize || me.reserve <= 0;
  $(".medkit-count").classList.toggle("hidden", next.mode === "practice");
  $(".medkit-count").textContent = `Medkits ${me.medkits} / ${MAX_MEDKITS}${touchControls.enabled ? "" : " · H"}`;
  const healButton = $("#touchControls [data-touch='heal']");
  healButton.classList.toggle("hidden", next.mode === "practice");
  healButton.querySelector("b").textContent = `${me.medkits}/${MAX_MEDKITS}`;
  healButton.setAttribute("aria-label", `Use medkit: heal up to ${MEDKIT_HEAL} HP; ${me.medkits} of ${MAX_MEDKITS} carried`);
  healButton.disabled = medkitPending || me.medkits <= 0 || me.health >= PLAYER_MAX_HEALTH ||
    Boolean(me.deadUntil || me.downedUntil) || next.mutators?.includes("iron") || !["playing", "between"].includes(next.phase);
  if (next.mutators?.includes("iron")) healButton.setAttribute("aria-label", "Medkits disabled by No medkits mutator");
  $(".roomcode").textContent = `Room ${roomCode}`;
  const ranked = next.mode === "ffa" ? [...next.players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths) : next.players;
  setHudMarkup($(".squad"), `<span class="hud-label">${next.mode === "ffa" ? "Round scores · K / D" : "Fireteam"}</span>${ranked.map((p) =>
    `<div class="${p.deadUntil || p.downedUntil ? "down" : ""}"><i>${p.deadUntil ? "×" : p.downedUntil ? "+" : "•"}</i><b>${escapeHtml(p.name)}${staffLabel(p.staffRole) ? ` <em class="staff-badge">${staffLabel(p.staffRole)}</em>` : ""} <span class="player-tag">#${escapeHtml(p.playerTag)}</span></b><small>${next.mode === "ffa" ? `${p.kills} / ${p.deaths}` : p.downedUntil ? "REVIVE" : `${SQUAD_CLASSES[p.classId || DEFAULT_CLASS].name[0]} ${Math.ceil(p.health)}`}</small></div>`).join("")}`);
  $("#touchControls [data-touch='descend']").classList.toggle("hidden", !me.flying);
  $("#touchControls [data-touch='crouch']").classList.toggle("hidden", Boolean(me.flying));
  $("#touchControls [data-touch='jump']").textContent = me.flying ? "Up" : "Jump";
  $("#touchControls [data-touch='jump']").setAttribute("aria-label", me.flying ? "Ascend while flying" : "Jump");
  $(".health").textContent = `${Math.ceil(me.health)} HP`;
  $(".healthbar i").style.width = `${me.health}%`;
  const reloadPhase = reloadProgress(me);
  const reloadLabel = reloadPose(reloadPhase, me.reloading, me.reloadType).stage;
  setHudMarkup($(".ammo"), `${ammoHeaderMarkup(`${weaponFor(me.weaponId).name}${me.unlimitedAmmo ? " · unlimited reserve" : ""}`, profile.tokens)}<b>${String(me.ammo).padStart(2, "0")}</b> <small>/ ${me.unlimitedAmmo ? "∞" : String(me.reserve).padStart(2, "0")}</small><div class="reload ${me.reloading ? "active" : ""}"><span>${reloadLabel}</span><i style="width:${Math.round(reloadPhase * 100)}%"></i></div>`);
  const lowAmmoThreshold = Math.ceil(weaponFor(me.weaponId).magSize / 4);
  $(".ammo").classList.toggle("low", me.ammo <= lowAmmoThreshold && me.reserve > 0 && !me.reloading);
  const lowAmmo = me.ammo <= lowAmmoThreshold && me.ammo > 0 && me.reserve > 0 && !me.reloading;
  if (lowAmmo && !lastLowAmmo) {
    playSound("lowAmmo");
    toast("LOW AMMO", "warning");
    showCombatConfirmation(touchControls.enabled ? "LOW AMMO · RELOAD" : "LOW AMMO · R", "dry");
  }
  lastLowAmmo = lowAmmo;
  const protectionRemaining = Math.max(0, me.protectedUntil - Date.now());
  $(".protection").classList.toggle("hidden", protectionRemaining <= 0 || Boolean(me.deadUntil));
  $(".protection b").textContent = protectionRemaining > 0
    ? `${(protectionRemaining / 1000).toFixed(1)}s`
    : "";
  $("#hud").classList.toggle("critical", me.health <= 28 && !me.deadUntil);
  if (me.health < previousHealth) {
    $(".damage").classList.add("active"); setTimeout(() => $(".damage").classList.remove("active"), 130);
    playSound("damage");
    kickCamera(cameraFeel, "damage", Math.min(.009, (previousHealth - me.health) * .0002));
  }
  if (me.deadUntil) {
    const seconds = Math.max(1, Math.ceil((me.deadUntil - Date.now()) / 1000));
    $("#death").classList.remove("hidden");
    $("#death span").textContent = `${seconds}`;
    $(".prompt").textContent = "";
  }
  else {
    $("#death").classList.add("hidden");
    if (wasDead) {
      player.position.set(me.position.x, me.position.y, me.position.z);
      if (playerBody) {
        crouching = Boolean(me.crouching);
        setPlayerCrouching(playerBody, crouching);
        playerBody.position.set(me.position.x, me.position.y - playerStance(crouching).eyeOffset, me.position.z);
        playerBody.velocity.setZero();
        playerBody.wakeUp();
        previousPhysicsPosition.copy(playerBody.position);
        accumulator = 0;
      }
    }
    $(".prompt").textContent = me.downedUntil ? "Crawl to cover · ping for help · teammate must hold Interact" :
      locked ? "" : "WASD to move · Click to aim";
  }
  $(".prompt").classList.toggle("hidden",
    !me.deadUntil && (locked || paused || touchControls.enabled || $(".scope-overlay").classList.contains("active")));
  wasDead = Boolean(me.deadUntil);
  if (wasDead) resetGameplayInput();
  syncTouchControls();
  previousHealth = me.health;
}

function showResults(result) {
  if (!$("#reportPanel").classList.contains("hidden")) $("#reportClose").click();
  playing = false;
  stopAmbientAudio();
  damageNumbers.clear();
  resetGameplayInput();
  syncTouchControls();
  requestReload.token++;
  document.exitPointerLock?.();
  $("#hud").classList.add("hidden");
  $("#results").classList.remove("hidden");
  const ffa = result.mode === "ffa", winner = state?.players.find((candidate) => candidate.socketId === result.winnerId);
  $("#resultTitle").textContent = ffa ? result.abandoned ? "Round abandoned" :
      result.winnerId === myId ? "Free-for-All victory" : winner ? `${winner.name} wins` : "Free-for-All draw" :
      result.mode === "raid" ? result.won ? "Raid complete" : "Raid failed" : result.won ? "Sector secured" : "Mission failed";
  const mine = result.rewards.find((reward) => reward.socketId === myId);
  const resultingProfile = mine?.profile || profile;
  const previousXp = resultingProfile && mine
    ? Math.max(0, resultingProfile.xp - mine.xp)
    : matchStartProfile?.xp || 0;
  const progress = xpProgress(resultingProfile?.xp || 0);
  const unlocks = newlyUnlockedMaps(previousXp, resultingProfile?.xp || 0)
    .map((mapId) => MAPS.find((map) => map.id === mapId)?.name)
    .filter(Boolean);
  const newlyCleared = resultingProfile?.campaignCompleted?.find((mapId) =>
    !matchStartProfile?.campaignCompleted?.includes(mapId));
  const earnedSniper = newlyCleared === SNIPER_REWARD_MAP;
  const campaignIndex = CAMPAIGN_MAPS.findIndex((map) => map.id === selectedMap);
  const next = campaignIndex >= 0 ? CAMPAIGN_MAPS[campaignIndex + 1] : null;
  const campaignReady = result.mode === "campaign" && result.won && next &&
    resultingProfile?.campaignCompleted?.includes(selectedMap) &&
    resultingProfile?.unlockedMaps?.includes(next.id);
  resultCanContinue = Boolean(campaignReady);
  $("#resultText").textContent = ffa ? result.abandoned ? "Not enough players remained. No rewards awarded." :
      "Ranked by eliminations, then fewest deaths. Saved progression remains separate from campaign credit." :
      result.mode === "operation" ? result.won ? "Relay defended and escorted, terminals synchronized, entire fireteam extracted. Teamwork rewards saved." :
        `The squad reached objective ${result.wave}. Earned teamwork and combat rewards saved.` :
      result.mode === "raid" ? result.won ? "Uplink secured, cache recovered, commander and escorts defeated. Earned rewards have been saved." :
        `The squad reached Raid stage ${result.wave}. Earned combat rewards have been saved; objectives remain incomplete.` : result.won
      ? `All ${result.maxWaves} waves contained. Your operator record has been updated server-side.`
      : `The fireteam reached wave ${result.wave}. Earned progress has been secured server-side.`;
  $("#resultSummary").innerHTML = `
    <div><span>Result</span><strong>${ffa ? result.winnerId === myId ? "Victory" : result.abandoned ? "Abandoned" : "Round complete" : result.won ? "Victory" : "Overrun"}</strong></div>
    <div><span>${ffa ? "Your deaths" : result.mode === "raid" ? "Stage reached" : "Wave"}</span><strong>${ffa ? mine?.deaths ?? 0 : `${result.wave} / ${result.maxWaves}`}</strong></div>
    <div><span>Your eliminations</span><strong>${mine?.kills ?? 0}</strong></div>
    <div><span>Experience</span><strong>+${mine?.xp ?? 0} XP</strong></div>
    ${!ffa && mine?.rankedReason ? `<div><span>Verified rankings</span><strong>${escapeHtml(mine.rankedReason)}</strong></div>` : ""}
    ${!ffa ? `<div><span>Teamwork (included in XP)</span><strong>+${mine?.teamXp ?? 0} XP · ${mine?.revives ?? 0} revives · ${mine?.assists ?? 0} assists · ${mine?.objectiveScore ?? 0} objective</strong></div>` : ""}
    <div><span>Tokens earned</span><strong>+${(mine?.tokens ?? 0) + (mine?.killTokens ?? 0)} · ${resultingProfile?.tokens ?? 0} total</strong></div>
    <div class="clearance-progress"><span>Clearance level ${resultingProfile?.level || 1}</span><strong>${progress.current} / ${progress.required} XP</strong>
      <i><b style="width:${progress.percent}%"></b></i></div>`;
  const careerUnlocks = Object.keys(resultingProfile?.career?.weaponXp || {}).filter((id) =>
    masteryLevel(matchStartProfile?.career?.weaponXp[id] || 0) < masteryLevel(resultingProfile.career.weaponXp[id]))
    .map((id) => `${WEAPONS[id].name} mastery level ${masteryLevel(resultingProfile.career.weaponXp[id])}`);
  $("#unlockReport").classList.toggle("hidden", !unlocks.length && !newlyCleared && !careerUnlocks.length);
  $("#unlockReport").textContent = [
    unlocks.length ? `New deployment authorization: ${unlocks.join(", ")}` : "",
    newlyCleared ? `Operation ${campaignOperationNumber(newlyCleared)} cleared${earnedSniper ? " · Sentinel SR sniper permanently awarded!" : " · Campaign advanced!"}` : "",
    careerUnlocks.length ? `Mastery advanced: ${careerUnlocks.join(", ")}. See Career for equipment and rewards.` : ""
  ].filter(Boolean).join(" · ");
  $("#resultError").textContent = "";
  $("#campaignReport").textContent = result.mode !== "campaign"
    ? "This mode does not change campaign credit." : campaignIndex < 0
    ? "Side operation concluded. Earned XP and tokens are secured; the three-operation campaign is unchanged."
    : !result.won
    ? "Campaign objective incomplete. Replay this operation to try again."
    : !resultingProfile?.campaignCompleted?.includes(selectedMap)
      ? "Clear earlier operations in order to advance the campaign."
      : !next ? "All three campaign operations cleared."
        : !resultingProfile.unlockedMaps.includes(next.id)
          ? `Next: ${next.name} · level ${next.level} required. Replay unlocked operations to earn XP.`
          : `Next: ${next.name}. The fireteam lead can continue once every squad member is cleared and level ${next.level}.`;
  $("#results tbody").innerHTML = result.rewards.map((r) => {
    const p = state?.players.find((item) => item.socketId === r.socketId);
    return `<tr><td>${escapeHtml(p?.name || "Ranger")}</td><td>${r.kills}${ffa ? ` / ${r.deaths}` : ""}</td><td>+${r.xp}</td><td>Level ${r.level || p?.level || 1}</td></tr>`;
  }).join("");
  const isLeader = state?.leaderSocketId === myId;
  $(".result-actions").classList.toggle("has-continue", Boolean(next && result.won && result.mode === "campaign"));
  $("#continue").classList.toggle("hidden", !next || !result.won || result.mode !== "campaign");
  $("#continue").disabled = !campaignReady || !isLeader;
  $("#continue").innerHTML = isLeader
    ? `Continue to ${next?.name || "next operation"} <span>↗</span>`
    : `Awaiting fireteam lead <span>…</span>`;
  $("#replay").disabled = !isLeader;
  $("#replay").innerHTML = isLeader
    ? `Replay operation <span>↻</span>`
    : `Awaiting fireteam lead <span>…</span>`;
}

function toast(text, kind = "combat") {
  const node = document.createElement("div"); node.className = `toast ${kind}`; node.textContent = text;
  $("#hud").append(node); setTimeout(() => node.remove(), 1000);
}
function showError(message) { $("#error").textContent = message; }
function resize(resetTouch = true) {
  if (resetTouch) touchControls.reset();
  activeRenderPixelRatio = getRenderPixelRatio() * frameBudget.scale;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(activeRenderPixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  if (composer) {
    composer.setPixelRatio(activeRenderPixelRatio);
    composer.setSize(innerWidth, innerHeight);
  }
}
requestAnimationFrame(animate);
