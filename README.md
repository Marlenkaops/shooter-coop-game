# Deadlight Ops

Development continues at [Marlenkaops/shooter-coop-game](https://github.com/Marlenkaops/shooter-coop-game).

A browser co-op and competitive survival FPS. Up to four players join a short room
code, fight server-controlled enemies through five waves, and earn saved
XP that unlocks new arenas. The first two ordered campaign victories earn a sniper.
Play with mouse/keyboard or a phone's two-thumb touch controls.
Arenas, weapons, and restrained combat effects are
generated locally. Tactical opponents combine a bundled CC0 sculpted human rig
with original winter uniforms, helmets, goggles, face coverings and rifles.
Arena surfaces use bundled CC0 photographic PBR textures, with procedural
fallbacks for low-quality rendering or a failed texture download. Phones retain
photographic ground and cover textures, sky backgrounds and animated soldiers
without desktop-only shadow and postprocessing passes.
All surfaces use a matte finish: guns, scope glass, outfits, floors, water and
buildings have no shiny specular highlights or environment-map reflections.
Diffuse lighting, textures, shadows and the live magnified scope view remain.
Balanced sky/ground fill and a sun-opposed diffuse light keep uniforms, hands
and cover readable without reflections. Low-quality surfaces use fine grain,
subtle weathering and narrow seams instead of repeated black hazard patches;
photographic painted metal is neutralized before arena-specific tinting.
The lightweight sky gradient uses the same tone mapping and color conversion
as the rest of the scene. Phone pixel budgets and shadow/effect limits stay unchanged.

Its original near-future containment presentation combines a spacious tactical
deployment interface with text-only operation briefings, believable human
proportions and field equipment, readable lighting, restrained combat
information, and grounded rifle feedback with map-specific weather, anomalous
technology, and the game's own co-op mission identity.

## Field features

- **Winterwatch Christmas update (local, not published):** a winter command
  screen, evergreen/ice/gold palette, original illustrated field station, clearer
  zone / deployment / operator columns, and compact expandable tactics/account
  controls. Phone layouts stack deployment before the operator inventory.
  Christmas trees, snow caps, gifts and warm festoon lights replace Halloween
  decorations across the nine available arenas and the practice range.
  Gift-wrapped bullseyes keep the range's existing head/body circles, hit
  feedback and reset timing. Ornaments, presents and snowflakes also appear in
  the maintenance challenge; this does not enable maintenance or stop gameplay.
- **Halloween has ended at the owner's request in this local update.**
  Wickfall, Jack-o'-Six and Graveglass G9 remain archived in source and saved
  collections are retained, but the server denies the map, equipping, practice,
  admin grants, stale event loot and forged combat use. Twelve regular guns
  remain available. No campaign, XP, wallet, inventory or identity reset occurs.
  The published release metadata stays unchanged until publication is approved.
- **Tactical movement and fog:** forward walking is 4.2 m/s, forward sprinting
  6.4 m/s, and crouching 2.1 m/s. Strafing uses 85% speed and backing up 80%;
  sprinting requires forward input and is disabled while focusing or crouched.
  Acceleration and braking run inside the fixed 60 Hz physics step, not once per
  rendered frame. Crouching lowers the actual capsule, eye, replicated soldier
  pose and PvP hitboxes; standing requires overhead clearance on both client and
  server. Capsule contact friction no longer fights the
  movement controller: the controller handles acceleration and braking while
  Cannon still enforces collisions and wall sliding. Movement remains
  server-validated during the between-wave regroup countdown, so repositioning
  is retained when the next wave begins instead of rubber-banding. Arenas have
  stronger distance fog and low ground mist; Wickfall has a denser night preset.
  Ground mist uses one instanced draw call, eight wisps on phones, and respects
  reduced motion.
- **Owner-only update workflow:** keep public gameplay running while developing
  these phased improvements locally. Do not deploy, toggle maintenance, restart
  the app or change production storage without explicit approval.
  Private previews bind to loopback
  using `HOST=127.0.0.1`, use an isolated `DATA_DIR`, and do not inherit production
  credentials. The normal container binding remains `0.0.0.0`. Do not upload
  this in-progress update until the owner explicitly approves it.

- **Interactive update waiting room:** `MAINTENANCE_MODE=true` serves a themed
  30-second target challenge with HTTP 503, `Retry-After`, and automatic
  readiness checks. Click/tap targets or use Tab/Enter; hits award 100 points,
  consecutive hits add a capped combo bonus, misses/escaped targets break the
  combo, and rounds show score, accuracy, time remaining and best score for this
  page visit. Scores stay in page memory: no XP, tokens, saves or leaderboard
  submissions. When the main game is ready, an **Enter game** button appears
  without interrupting the current round. All Socket.IO identities, including administrators and old
  cached clients, are denied with a structured maintenance error, so hiding the
  screen cannot bypass the lock. Health, privacy and ban-appeal endpoints remain
  available. Normal play is the default (`false`); invalid values fail startup.
  For the existing Azure app, an authenticated operator runs
  `node scripts/azure-maintenance.mjs on` **before making changes**, and `off`
  only once the finished image is ready, followed by the deployment verifier.
  `status` checks the live setting. The script changes only this flag in the
  existing template, preserves the image, credentials and other configuration,
  and confirms the live response. It never stops/deletes the app. Azure revision
  changes can still erase ephemeral profiles, bans, appeals and active matches;
  this does not add persistent storage or preserve in-progress matches.
  The runtime image includes `public/maintenance.html` and
  `public/maintenance-range.js` explicitly: the server needs these files even
  though Vite also copies them into the built client.
- **What's new** appears once per release in each browser, with a saved dismissal
  marker and menu/lobby buttons to reopen it. Each release has its own ID and a
  concise list of shipped changes in `src/release.js`; gameplay, bans and other
  open dialogs are not interrupted by the automatic display. Update this data
  before publishing, and summarize the changes in the deployment handoff.
- **Christmas decorations, lights and snowfall** use seven instanced mesh batches,
  one wire draw and one lightweight snowfall batch, without new lights, shadows,
  physics bodies or terrain changes. Low/mobile settings retain eight snowy evergreens
  outside the playable boundary and 84 bulbs; higher detail has twelve trees
  and 164 bulbs. Small gifts sit on existing static cover; doors, firing lanes,
  destructible cover and supply routes stay clear. Existing ambient lamps retain
  their normal graphics budget. Gentle emissive variation freezes with OS or
  camera reduced motion. Snow also falls in the menus and fireteam lobby.
  **Settings → Graphics → Christmas decorations, lights & snow**
  immediately toggles menu snow, the arena layer and seasonal target faces, with its own
  saved browser preference (`deadlightChristmas`), enabled by default. An old
  Halloween preference cannot disable Christmas. Target plates/rings are merged
  into two draws rather than a mesh per ring; seasonal aiming surfaces remain
  within the original server-authoritative body/head silhouettes.
- **Combat refinement, first stage:** acceleration-limited walking, sprinting,
  directional braking and momentum-preserving air control retain the existing
  server movement limits and shared collision geometry. Fourteen individually tuned
  camera-recoil springs settle without drift, with less kick while aiming and
  layered procedural crack/body weapon reports (quieter for suppressed weapons).
  Soldier carry-to-aim poses blend smoothly; gait cadence follows movement speed
  and stops at rest, with subtle breathing and upper-body hit reactions.
  Enemy squads share sightings and audible shot locations, investigate a
  last-known position for up to six seconds instead of following hidden movement,
  search nearby buildings when contact is lost,
  distribute target pressure, flank under ranged support, and briefly seek
  occluding cover when badly wounded. Suppressed shots have a shorter hearing
  radius. Threat windups, spawn protection and final line-of-sight checks remain
  authoritative. This stage does not add dynamic destruction, physical ragdolls,
  regional/seasonal ranking infrastructure, classes or a new progression economy.
- **Phase 4 enemy AI (local, not published):** campaign, Blitz and Raid rooms
  now field explicit **rusher, rifleman, sniper, heavy and support** roles.
  Rushers close for quick melee attacks; riflemen fire at up to 8 m, snipers
  hold 11 m sightlines, heavies anchor 7 m lanes and support covers 9 m lanes
  with more frequent telegraphed fire. Their visible SMGs, rifles, precision
  rifles and machine guns match their roles. Wave 1 introduces rushers,
  riflemen and support; wave 2 adds snipers and wave 3 introduces a heavy.
  Squad IDs coordinate support with nearby flanking rushers. Flank goals
  expire after 1.8 seconds and have a six-second cooldown, so soldiers close
  in rather than circle forever. Standard/Veteran riflemen, snipers and
  support briefly move toward reserved occluding cover after shooting;
  wounded soldiers withdraw for 1.6 seconds (below 35% health, or 20% for
  heavies) without regenerating health. Cover use has cooldowns, never
  changes solid geometry and does not permit shooting through walls.
  Last sightings and audible shot origins are remembered, never hidden
  player movement; suppressors retain their reduced hearing radius.
- **Tactical difficulty:** choose **Enemy tactics** before creating or finding
  a squad; the lobby shows the room's authoritative tier and coded joins
  inherit it. Matchmaking never mixes tiers. **Recruit** remembers contacts
  for four seconds, limits build-up/peak pressure to 1/2 simultaneous attacks
  per living operator and uses wounded-only cover. **Standard** uses six
  seconds, 2/3 attacks and fire/cover movement. **Veteran** uses eight
  seconds, 3/4 attacks and lets riflemen also flank under squad covering fire.
  Health, damage, movement speed, rewards and unlock requirements do not
  change between those three tiers. Phase 6 adds the level-gated Nightmare
  tier described below. Practice and Free-for-All do not use tactical tiers.
  Replay and campaign continuation retain the room's tier.
- **Fight pacing and enemy callouts:** a server director alternates nine
  seconds of build-up, up to fourteen seconds of peak pressure and a short
  regroup (Recruit/Standard/Veteran: 5/4/3 seconds). A struggling squad can
  shorten the peak after its first three seconds. Regroup stops **new**
  attacks; already announced attacks finish only if their targets are still
  living, connected, unprotected, in range and in current line of sight.
  Enemies still reposition, and pressure resumes automatically. The HUD
  labels the pace and captions nearby hostile contacts, sound investigations,
  flanks, covering fire and retreats. These are bounded, throttled text
  callouts, not recorded or synthesized speech. Captions are limited to 26 m,
  work while muted and on phones, and never interrupt controls. The server
  emits only public role/intent/callout data, not internal contact memories,
  cover/flank reservations, director budgets, profiles or identity tokens.
- **Worldwide leaderboard** in the deployment menu and lobby, with separate
  all-time **Level & XP** and **Eliminations** rankings, a Phase 6 **This season**
  earned-match-XP view, your own rank, refresh,
  and 20-player pages on desktop and phone. Rankings include offline profiles
  saved on this installation, not just the current room. A saved match, positive
  XP, or recorded eliminations qualifies a profile; practice and empty visitor
  profiles do not count. XP ordering uses saved XP (including admin level changes),
  then eliminations; elimination ordering uses total saved kills, then XP.
  Remaining ties use username then private ID for deterministic positions.
  Only usernames, short public tags, rank, level, XP, eliminations and match
  counts are shared. Clients cannot submit scores or choose another player's
  personal rank. Rankings persist with `players.json`; ephemeral hosting can
  erase them. Separate self-hosted installations do not share a ranking database.
- Server-authoritative body and smaller elevated head hit zones. Headshots deal
  increased damage, while shot origin, hit zone, cover intersection, damage,
  ammo, kills, and rewards are all resolved by the server. Supplied aim vectors
  are normalized and checked against the server's latest validated yaw/pitch;
  movement and sustained-fire spread use a deterministic server-known pattern.
- Focus/ADS with smooth weapon alignment and a defined optic on every gun:
  transparent 1× reflex/holographic sights, a 1.5× shotgun ring, 2× scout/support
  lenses, the DMR's 3× prism, a 4× battle optic and the earned sniper's 6× mil-dot.
  Magnified optics render a separate circular lens over normal-FOV peripheral
  vision, with eye-relief shading and per-weapon reticles. Low and adaptive
  performance modes can black out the periphery while scoped to save a
  full-scene render. The center dot uses the same camera ray as the
  server-validated shot; markings are visual references, not a simulated
  ballistic-drop calibration. Movement/sprint/recoil
  crosshair response, and server-timed reloads. An empty magazine is dropped
  and replaced before the bolt is worked (2.1 seconds); a tactical reload
  retains a partially used magazine and skips the bolt (1.65 seconds).
  The animated support hand, magazine, HUD stages, and audio track the server
  timer. Other feedback includes distinct
  headshot/elimination confirmation, dry-fire and low-ammo cues, shell bounce,
  surface-specific footsteps, landing weight, and quiet synthesized ambience.
- Server-owned saved loadout with twelve regular weapons plus two event weapons: the default AR-17 rifle
  (24-round magazine), Viper SMG (36 rounds, faster firing, lighter damage),
  Longwatch DMR (12 rounds, slower firing, higher precision and damage), and
  the campaign-earned Sentinel SR sniper (6 rounds, 6× scope), the Rook-12
  Breacher (8 shells, eight buckshot pellets per tap), and the Bastion K60
  support machine gun (60 rounds, slower focus and heavier reload), plus the
  Kestrel C9 scout carbine, Mako P48 PDW, Atlas B14 battle rifle and Cyclone D12
  automatic drum shotgun, the compact **Kite P12** service pistol, and suppressed
  **Ember H8** heavy pistol. The sidearms have distinct grip-fed magazines,
  handling, fire rates, damage and reload timings. Buckshot
  uses a deterministic cone with damage falloff and a 38 m limit; every pellet
  independently stops at cover. One shell can hit multiple opponents, but each
  elimination is awarded only once.
- Four weapon chests spawn per wave. Confirmed enemy and PvP eliminations drop
  ammo or guns; drops expire after two minutes and remain bounded to 64 total
  loot items. Press **E**, or the phone **Loot** button, nearby to collect.
  New guns save ownership and equip immediately; duplicates replenish current
  reserve ammo. A failed ownership save leaves the chest available. Older
  purchased guns and tokens remain saved; the gun shop is replaced by loot.
  NPC eliminations immediately award six in-game tokens; the outfit shop offers
  original cosmetic character palettes, with a visible wallet in menus and combat.
  Equipped loadout, ammo, reload timings,
  fire rate, and damage are validated and stored server-side. No real-money
  purchases or external token services are involved.
- Foundry crates, drums, cable conduits, warning placards and vents; tundra
  relay cabinets, shallow drifts and ice markers; and void research housings,
  containment pylons and floating fragment clusters. These use reusable or
  instanced procedural geometry. Solid navigation cover remains the exact
  shared server/client collision layout; decorative additions are flat,
  embedded in cover, overhead, or beyond the arena boundary.
- All ten maps include raised, textured flanking terrain with wide ramps at
  both ends, distinct terrace heights and lengths, and enterable field stations.
  Existing barracks, guardhouses and hangars have real through-door interiors
  instead of solid bunker boxes. Interior cabinets provide cover; framed
  entrances, ceiling beams, lights and operation signs make routes readable.
  Two of the four weapon chests are inside the raised stations.
  Shared geometry drives Cannon physics, server movement, enemy ramp/door
  navigation, roof/wall/terrain bullet occlusion, and elevation-aware loot,
  supplies, blood and dropped magazines. Static textured cover is batched by
  material; phone interiors retain emissive lights without extra point lights.
- Six original grounded military side arenas: **Breakwater Docks**, a wet cargo
  terminal with staggered container lanes, working rain, crane silhouettes and
  an offshore freighter; and **Dustline Outpost**, a dusty radar station with
  a defended courtyard, enterable barracks, sandbag nests and a rotating dish;
  **Crosswind Airbase**, an offset-deflector runway with equipment bays,
  accessible hangars and parked aircraft; and **Iron Bastion**, a concrete
  fortress with diagonal checkpoints, an armored power block and watchtowers;
  **Blackwater Spillway** (level 2), a rain-soaked hydroelectric yard with
  turbine blocks, staggered flood barriers and open maintenance flanks; and
  **Ember Rail Depot** (level 5), an evening rail interchange with offset freight
  cars, long sightline lanes and crate alleys.
  Their hand-authored cover layouts are shared by rendering, physics and the
  authoritative server, not recolored copies of the campaign arenas.
- Phone controls automatically appear on coarse-pointer devices: an analog
  movement stick, swipe-to-look area, drag-to-aim Fire button, toggled Focus and
  Sprint, and Jump/Reload/Ammo buttons. Portrait and landscape layouts respect
  display cutouts; input resets on pause, death, rotation, disconnect and
  backgrounding. Touch controls can also be enabled in the field menu.
- Directional contact awareness reports only hostile count, bearing, and a
  coarse distance—never through-wall silhouettes. Opponents visibly aim before
  a server-validated attack; leaving range, reaching cover, death, or spawn
  protection cancels the shot. Nearby blocked opponents flank rather than
  firing through cover. Brutes are tougher and slower with longer, stronger
  attacks. Heavy-role brutes now use telegraphed short-range covering fire.
  From wave 2, lighter-armored skirmishers close quickly on an
  off-axis path and deliver quicker but lighter melee strikes; ranged sentinels
  hold a longer sightline, take longer to aim and cannot fire through cover.
  A headshot interrupts an announced shot and briefly staggers the opponent.
  Target selection favors clear sightlines and retains targets through small
  distance changes; sentinels strafe or retreat during their cooldown, but
  stop moving while winding up. Directional warnings, spawn protection, connection state, asset
  loading progress, distance-faded hostile health, and restrained
  attack/hit/death reactions keep combat readable.
- Opponents accelerate into motion instead of instantly changing speed, retain
  a side while flanking cover, slide along valid cover boundaries, and separate
  when crowded. The server validates their paths and resolves all attacks;
  clients interpolate authoritative snapshots. Nearby hostiles retain their
  detailed animated models, while distant hostiles use merged low-cost
  silhouettes so large waves do not animate dozens of off-screen skeletons.
  Remote operators use the same human rig and their actual equipped firearm,
  with movement, pitch-aware aiming, muzzle/recoil and confirmed-hit reactions.
- Hostiles use curved, close-fitting fabric/armor vests instead of oversized
  rectangular body plates; brute and skirmisher identifiers remain distinct.
- The server issues a stable signed player ID and persists a unique, validated
  username per player. The operator record displays your full ID; the squad
  roster and HUD display a short public tag, and the allowlisted admin roster
  displays full IDs. Room codes and browser profiles allow friends to team up
  without sharing their identity tokens.
- The after-action report records result, wave, eliminations, XP, resulting
  clearance level and progress, newly authorized maps, squad rewards, replay,
  and return-to-operations actions.
- **Your loadout** is visible in the operations menu, staging lobby, and field
  menu (**Esc** on desktop, **Menu** on phone). Original slot-style cards show
  the equipped gun, its actual model preview, firing mode, optic, magazine and
  reserve; expand **Collected guns** to inspect your saved weapon collection.
  The field view follows authoritative live ammo, reload and loot-equipment
  updates, not just the saved profile. Offline views are marked **Last synced**.
  You still carry one weapon; collected cards are not extra carried slots or
  shortcuts. Use **Change weapon** before deployment; in-match equipment changes
  only through the existing server-validated loot rules. Card accents distinguish
  weapons visually, not invented rarity bonuses.
- Two ammo containers spawn near the squad at each wave. Press **E** nearby
  to replenish up to two magazines of reserve ammo per container per player
  per wave; the server validates distance, remaining capacity, and eligibility.
- Start each combat match with **one medkit** and carry at most **three**.
  Press **H**, or tap the phone **Heal** button, to consume one for an instant
  **50 HP** heal, capped at 100 HP. The HUD shows your carried count. Medkits
  cannot revive downed players and are not consumed at full health. Enemy
  kills have a 20% chance to drop a cream medical case with a green cross;
  collect it with **E / Loot**. A full inventory leaves the case for teammates.
  Medkits last for the match, persist through respawns, and reset on replay;
  the non-combat shooting range has no medkit inventory.
- A server-verified administrator panel provides room moderation, online/offline
  profile search by username/Operator ID, level assignment, all-gun/all-map
  grants, and private administrator/authentication/anti-cheat audit logs.
  Server input budgets and strict command schemas reject forged fields and
  flooding, while movement speed credit is shared over time instead of granted
  again per packet. See [Admin setup](#admin-setup).
- Choose five-wave **Co-op survival**, three-wave **Co-op Blitz** with faster
  threat escalation, or **Free-for-All**: level 5 required for every participant,
  2–4 operators, first to 12 eliminations or a three-minute limit. Free-for-All
  ranks eliminations then fewest deaths, uses separated safe respawns, has no
  AI or campaign credit, and grants no XP/tokens when abandoned. Firing removes
  the shooter's spawn shield. Only the campaign survival mode advances operations.
- **Shooting range** is a separate solo mode, open from level 1 on **Daybreak
  Range**: four marked lanes and twelve resetting steel targets at 10, 25 and
  45 metres. Magazines and reload timing stay realistic, with unlimited reserve
  ammo. The field menu lets you try collected guns without changing your saved
  equipment, view session-only target/headshot/accuracy statistics, and leave.
  Each trigger pull counts once, including shotgun pellets. Targets reset after
  1.2 seconds; practice never grants XP, tokens, loot, campaign credit, saved
  kills or match counts. Other players, including admins, cannot join your range.
- **Raid** is an original three-stage co-op operation for solo play or 1–4
  operators on any unlocked arena. Hold the marked uplink for 12 uncontested
  seconds, eliminate the cache guards and press **E** (phone: **Objective**) to
  recover the encrypted cache, then defeat the armored commander and escorts.
  The HUD shows objective distance, capture progress and commander health.
  Enemies persist between stages; loot and ammo supplies refresh at each stage.
  Enemy counts and commander health scale with the squad. Server-validated
  objectives cannot be skipped from afar or completed by a downed player.
  NPC kills pay the usual immediate tokens, with normal XP/completion rewards;
  Raid victories do not advance the ordered campaign.
- **Local Phase 5 teamwork** extends all co-op modes, not Free-for-All or the
  shooting range. Choose a saved **Medic / Assault / Recon / Engineer** class
  before deployment; active missions lock the choice. See the local Phase 5
  section below for abilities, revive rules, coordination objectives and rewards.
- Lobby chat keeps the latest 50 messages, with an identity-based cooldown.
  The fireteam lead can transfer leadership or remove another lobby member;
  removals prevent that identity from rejoining the same room. Leadership
  survives campaign reconnects and passes to a remaining operator on departure.
- Report a room peer from the roster or field menu with a typed reason.
  Reports are private, persist in `DATA_DIR/reports.json`, retain the latest 500
  records, and allow up to three per ten minutes, at least 30 seconds apart.
  Admins can page, review, dismiss or reopen reports. Claims never trigger
  automatic punishment. The expanded panel also grants individual guns,
  heals/refills live players, restocks chests and shows save/backup status.
- Confirmed hits generate bounded blood droplets with gravity, swept shared
  cover/floor collision, and wet-to-dry stains. Field settings can disable them.
  Desktop **Ultra** adds budgeted contact occlusion; phone and adaptive quality
  retain capped resolution/effects and can reduce rendering under sustained load.
  These are realistic-inspired effects, not a guarantee of photorealism or
  physical-device frame rate.

The default `PERSISTENCE_BACKEND=file` keeps local development compatible with
`DATA_DIR`. Profile files are fsynced and atomically replaced, with a previous-save
backup. Server commands additionally use a private, fsynced write-ahead journal
and a writer lock for multi-file changes; an interrupted journal is replayed
before profiles load. Do not run offline setup tools against a running server.
**The currently published Azure game still uses its old ephemeral backend and
cannot guarantee progress across replacement/restarts.** Adding this code does
not migrate it, change maintenance, publish an image or authorize cutover.

### Optional Azure Table Storage backend

The approved replacement design is identity-authenticated Azure Storage Tables,
Standard_LRS in Sweden Central. The attempted free-tier Cosmos resource was
rejected for this subscription; there is no Cosmos backend or paid Cosmos
fallback. Tables is pay-as-you-go, **not free and not hard-capped**. Storage,
individual entity operations, scans, exports and traffic all affect the bill.
Keep one game instance: active rooms still live in memory.

| Variable | Required setting |
| --- | --- |
| `PERSISTENCE_BACKEND` | `tables` (default is `file` without a Table endpoint) |
| `TABLES_ENDPOINT` | Primary `https://<account>.table.core.windows.net`; never a secondary or connection string |
| `TABLES_TABLE` | Existing table, default `state` |
| `TABLES_CLIENT_ID` | Client ID of the runtime user-assigned managed identity |
| `PERSISTENCE_DATASET_ID` | UUID returned only after a fully verified import |
| `TABLES_AUTH_MODE` | Runtime: absent or `managed-identity`; private tooling may explicitly use `azure-cli` |

Provisioning is separate. The table must already exist, use HTTPS/TLS 1.2 and
disabled shared-key authentication, and grant the runtime **Storage Table Data
Contributor** at table scope. This subscription's `StorageAccount_PublicNetwork_Modify`
policy requires the approved **SecuredByPerimeter** topology: Network Security
Perimeter `deadlight-saves`, profile `game`, and the `game-subscription` inbound
subscription rule for runtime managed-identity traffic, plus a temporary /32
operator ingress rule for private migration tooling. Do not switch to public
`Enabled`, add broad IP exceptions, exempt policy or self-grant permissions.
Completing the subscription rule requires an authorized subscription administrator
with `Microsoft.Network/networkSecurityPerimeters/joinPerimeterRule/action` on the
game subscription. Until that prerequisite is satisfied and both operator/runtime
connectivity are verified, **real cloud integration is blocked and unverified**.
A disabled/incomplete perimeter or 403 is not permission to weaken security or
silently use local files.
Preserve the existing private `IDENTITY_SECRET` and `STAFF_ACCESS_SEED` references.
Imported staff state always takes precedence over a seed, so consumed codes
cannot be reset by a restart.

Cloud startup requires the expected initialized dataset, complete entity/file
checksums, valid domain data and the original identity-signing fingerprint.
Missing data, an outage, corrupt state or a wrong identity secret fails closed;
it never initializes empty players or falls back to `DATA_DIR`. `/api/health`
checks persistence readiness and returns 503 when unavailable.

Every saved mutation is serialized, validated against a fresh root revision and
committed with that root's exact ETag in the **same atomic entity-group
transaction**. Concurrent revisions cannot overwrite each other's wallets,
usernames, roles, codes or moderation decisions. A conflicting operation fails
explicitly and may be retried against fresh data. Success ACKs, profile pushes,
loot removal, privileged room actions and staff sessions are released only after
commit. All supported writers must use this protocol; direct table edits are
unsupported and require a full verification before restarting service.

NPC and match rewards have durable pending intents and permanent per-reward
receipts. Wallet/progression changes, receipt creation and intent removal commit
together; a lost response followed by retry/restart cannot credit twice. Startup
replays committed pending intents before accepting traffic. A five-second retry
keeps unavailable rewards pending while the server runs. Frames only schedule
asynchronous persistence: they do not wait for network I/O. **An event not yet
durably staged can still be lost in a process crash**, as can active matches;
shot/room-state ACKs are not reward-save confirmations. `tokensEarned`,
`matchEnded` and saved profile pushes confirm durable reward application.

Profiles and reward receipts are individual entities, not one growing
`players.json` entity. Reports, bans, appeals, staff members and audit entries are
also separate entities with checked collection order. Opaque snapshot files use
16 KiB raw chunks; payloads are measured in UTF-16 bytes and limited to 60 KiB per
string property (below Table's 64 KiB limit). Mutations are limited conservatively
to 90 entities and 1.5 MB including estimated HTTP overhead, below the service's
100-entity/4 MiB transaction limits. Oversized records/transactions fail **before**
mutation; imports are fully prevalidated and may stage many bounded batches.
Existing store limits remain: 5,000 bans/4 MB, 500 reports/2 MB, 500 appeals/4 MB,
1,000 staff/2 MB and the latest 1,000 audit entries. Very large individual legacy
profile records may require an explicit offline redesign rather than truncation.

The validated dataset is cached in server RAM; each persistent command checks
the root, while startup or another writer's revision requires a full dataset
scan. Encoding/validation is proportional to the cached dataset. This is a
small-game design, not an unlimited-player performance guarantee. Reward receipts
are intentionally not pruned: they preserve idempotency but grow storage,
startup/scanning costs and RAM usage. Review usage and retention before scaling.
LRS replication is not a backup; retain private verified exports independently.

### Private snapshot and migration tools (Node.js 22)

`npm run persistence -- <command>` never provisions resources or changes the live
app. Keep all source directories/bundles outside the repository and image.
Bundles contain private player records, signing files and hashed codes; use
private directories/backups, not chat, browser code, logs or Git. Commands print
only counts, revisions, a verified dataset UUID and sanitized failures.

Pack a **complete, quiescent copy** of `DATA_DIR`, with an explicit expected
profile count:

```sh
npm run persistence -- pack --source "$PRIVATE_SNAPSHOT" --output "$PRIVATE_BUNDLE" \
  --expected-profiles 42 --identity environment --normalize-missing
```

Use `--identity environment` only with the original `IDENTITY_SECRET` privately
available to the command; its fingerprint, not its value, is included as metadata.
Use `--identity file` when the saved `identity-secret` supplies signing material.
`--normalize-missing` explicitly initializes legacy absent optional empty
moderation/audit stores; if staff state is absent it uses the private
`STAFF_ACCESS_SEED`, otherwise an empty staff registry. It never replaces existing
files or invents missing players/moderation signing material. New reward journals
default to empty for a legacy snapshot. Corrupt/missing core data, duplicate
usernames, inconsistent codes and a profile-count mismatch are rejected.

With an explicitly configured private migration operator:

```sh
export TABLES_ENDPOINT="https://<approved-account>.table.core.windows.net"
export TABLES_TABLE=state TABLES_AUTH_MODE=azure-cli
npm run persistence -- import --bundle "$PRIVATE_BUNDLE"
# Save the verified result's dataset UUID privately, then:
npm run persistence -- verify --dataset "$DATASET_ID" --bundle "$PRIVATE_BUNDLE"
npm run persistence -- export --dataset "$DATASET_ID" --output "$NEW_PRIVATE_EXPORT"
npm run persistence -- restore-local --bundle "$NEW_PRIVATE_EXPORT" --output "$NEW_PRIVATE_DIR"
```

Import refuses **any existing active dataset**. It stages a new isolated UUID,
reads it back, validates every checksum and domain surface, then atomically
creates the active marker. Failure before activation leaves no partial active
dataset; inactive staging entities may need operator cleanup later. A failed
post-activation response must be investigated with `verify`, never by deleting or
overwriting the active marker. If import could not return a UUID, run
`npm run persistence -- verify --bundle "$PRIVATE_BUNDLE"`: it discovers the active
UUID privately and returns it only after the complete expected snapshot and
identity metadata match. Runtime still requires an explicit dataset UUID.
Restore-local requires a new directory. Known JSON is canonicalized semantically;
unknown files, including binary backups, are preserved byte-for-byte.

For isolated endpoint/RBAC checks, generate synthetic data instead of importing
players:

```sh
npm run persistence -- fixture --output "$NEW_PRIVATE_FIXTURE_DIR"
npm run persistence -- pack --source "$NEW_PRIVATE_FIXTURE_DIR" \
  --output "$FIXTURE_BUNDLE" --expected-profiles 2 --identity file
```

Fixtures include two invented profiles and disposable staff hashes; **never use
them for public traffic**. Test import/verify/export/restore against an isolated
test table, not a table reserved for the eventual real snapshot. Never set the
live app's dataset UUID to a fixture.

A real cutover still requires separate owner approval: stop/quiesce writes in an
approved window, capture a final full snapshot, verify all identities/progression/
wallets/unlocks/rankings/staff used hashes/moderation/audit/backups, prove the
runtime identity's access, and only then switch one runtime to that exact dataset.
Do not restart the old ephemeral replica first. An earlier backup is not a final
zero-loss copy of a game that continued accepting writes. Rollback must preserve
any writes already accepted by the new backend; do not casually revert to an old
file snapshot.

### Local Phase 1 audit (not deployed)

The foundation changes remain local; the public game and maintenance setting
are unchanged. Reproduced issues and their fixes:

| Reproduction | Local fix |
| --- | --- |
| Hold W, then Shift+W: the previous build traveled about 10/15 m/s. | Shared 4.2/6.4 m/s walk/sprint targets, 2.1 m/s crouch and directional penalties. |
| Compare acceleration/reversal at 30 and 120 fps. | Acceleration now runs inside each fixed physics tick; 30/60/120 fps travel regressions agree. |
| Press ArrowUp/ArrowDown while aiming. | Corrected the inverted vertical camera direction. |
| Clear a wave, walk during regroup, then begin the next wave. | The server now validates and retains intermission movement instead of discarding it and causing corrections. |
| Win Ash Foundry with Wickfall first in the map list. | Results use campaign-only numbering: Operation 1, not Operation 2. |
| Stand still and inspect ammo/squad DOM mutations. | Unchanged HUD markup no longer rebuilds its child nodes. |
| Stand still and inspect Cannon's ground contacts. | Resting capsules sleep; movement, flight, stance, corrections and respawn explicitly wake them. |
| Profile first-person hand posing. | Removed the redundant traversal of the previous skeleton pose. |
| Inspect perimeter draw submissions in non-military arenas. | Four visual walls share one merged mesh; collision bodies and texture UVs remain intact. |
| Observe stationary movement packets. | Identical poses use a 250 ms heartbeat, including a final stopped snapshot to settle firing spread. |

Local checks pass 340 Node tests and a production build. Browser coverage includes
desktop and phone emulation, all maps/weapons, co-op stance/death/respawn, the three
campaign continuation/reconnects and sniper unlock, PvP deaths/respawns, saved
results/replay/profile/leaderboards, and four-layout Raid/medkit/objective controls.
Isolated fixtures stage damage, enemy positions/health, wave clears and timer
expiry; real inputs and the normal authoritative combat/reward paths are used.
These checks do not represent an unassisted full campaign playthrough.

A 602-second, two-browser co-op run completed 39 mission/replay cycles with no
console errors. After five warmup cycles, tracked live GPU resources stayed at
533 desktop / 441 phone-emulated; post-GC heaps varied within 0.27 / 0.35 MB.
This bounded check is not proof of leak-free hours-long sessions. Physical-phone
and representative mid-range-laptop acceptance remain unverified; emulation is
not a device result. Durable Azure storage still requires the resource, network
and complete-data backup/cutover approvals described above. The owner approved
continuing locally with physical-phone testing and the storage migration pending.

### Local Phase 2 interface (not deployed)

The command menu, staging lobby, field HUD/menu, results, armory/outfits,
leaderboards, staff tools, bans/appeals and maintenance waiting room now share
a navy, amber and blue design language. `public/ui-theme.css` supplies the common
palette and typography; the runtime image also includes it for maintenance.
The later Winterwatch menu replaces the radar with a static original SVG field
station, with no animated background or additional 3D scene.

- **Play now** creates and starts a solo operation, except Free-for-All, which
  still waits in staging for its second player. **Squad** reaches create/join
  controls; **Loadout**, **Operator**, **Rankings** and **Settings** provide direct
  navigation without removing the existing controls.
- **Find a squad** joins or creates a public, opt-in lobby for the selected map
  and mode. Ordinary code-created rooms remain private. The server enforces
  clearance, capacity, kicked identities and lobby-only admission. No random
  players can enter active missions or reserved campaign transitions. The
  fireteam lead starts the operation; matching does not auto-start a squad.
- **Settings** is available before deployment and from the field menu. Controls,
  gameplay, graphics, audio and accessibility have separate tabs. Keyboard
  bindings persist locally and swap conflicting actions rather than leaving an
  action unbound; Escape cancels capture, and Reset restores defaults. Existing
  mouse/touch inputs, graphics/FPS, sensitivity/FOV, fullscreen, blood, Christmas
  and mute controls remain. Master volume, 80-115% information-panel HUD scale,
  reduced interface motion and blue/amber high-contrast indicators are saved.
  The local Phase 3 additions below extend this with camera-motion, damage-number
  and combat-music preferences.
- **Navigation** supports keyboard focus/arrow navigation and controller menus:
  D-pad/left stick moves focus, horizontal input adjusts a selected slider or
  choice, A activates and B closes a dialog. This is menu navigation, not
  controller movement/aiming support. Controller polling runs only while a
  controller is connected. Native dialogs contain settings and connection focus.
- **HUD** adds a compass and a bounded feed populated only by server-confirmed
  eliminations. Health and actual spawn protection remain unchanged; there is
  no invented armor meter. Timed respawn remains the current death behavior.
- **First-time tutorial invitation:** new operators with no XP or completed
  matches see "First time playing? Want a quick tutorial?" before the automatic
  release notes. **Start tutorial** launches the existing guided range; **Skip
  for now** or Escape leaves them in the menu. The choice is remembered in this
  browser, so it is not asked again on refresh or reconnect. Previously
  completed training also suppresses the invitation. Returning progressed
  operators are not interrupted, and everyone can replay the drill manually.
- **60-second drill** launches the real solo range with skippable, contextual
  movement, firing, reload and target-elimination hints. Completion requires
  replicated movement, an accepted shot, authoritative reloading and a
  confirmed target kill. It awards no real progress. Automated desktop and
  phone-touch runs completed in under three seconds; that is an input-driven
  reachability check, not a claim about a new human player's learning time.
  The local Phase 5 update adds revive, ping and class-ability instructions to
  the completion hint; the shooting drill itself remains non-combat practice.
- **Loading and recovery** show deployment tips, bounded request timeouts,
  connection retry and a safe return to operations. A restored socket does not
  resume a stale disconnected room or enable ghost gameplay.

Local checks pass **350 tests and a production build**, up from 340 at the end of
Phase 1. Production-browser checks cover desktop and phone emulation, saved
settings/rebinding, real touch training, private-room isolation, two-browser
matching/co-op/results, campaign continuity, death/respawn, rewards, replay,
profiles/rankings, admin sign-in and ban/appeal review. Campaign clears and some
combat positions/health use isolated in-memory test fixtures, not production
debug endpoints. Preview screenshots cover the menu, HUD and results on both
layouts.

Paired nine-second Metal/Auto range samples on the local Apple A18 Pro host:

| Measurement | Before | After |
| --- | ---: | ---: |
| Desktop range FPS | 59.89 | 60.00 |
| Phone-emulated range FPS | 60.00 | 60.00 |
| Desktop menu readiness, one local sample | 451 ms | 152 ms |
| Phone-emulated menu readiness, one local sample | 129 ms | 112 ms |

The single load samples are cache-sensitive and do **not** establish a load-time
improvement. These range samples do not certify every combat scene or physical
phone. Physical-phone and representative laptop acceptance, persistent Azure
storage and deployment approval remain outstanding. Public hosting, player data,
secrets and maintenance state were not changed.

Issues reproduced and resolved during the interface work: the phone look layer
intercepted training Skip/Finish taps; legacy high-specificity button styles
overrode the new components; Enter on a focused menu button could also create a
room; reconnecting could leave a stale mission locally playable; and initial
upward controller/keyboard navigation skipped the last control.

### Local Phase 3 gunplay and feel (not deployed)

All fourteen existing guns retain their server-owned damage, cadence, magazines,
spread and reload completion. This phase changes presentation and handling, not
rewards, permissions or damage claims:

- Each gun has its own repeatable horizontal recoil sequence, handling weight,
  explicit ADS speed, muzzle color/shape/duration, reload tilt/roll and layered
  procedural report. Suppressed weapons have smaller, quieter flashes/reports.
  Existing under-fed, top-fed, bullpup, box, drum and pistol magazine/hand
  choreography is retained. Reload sound pitch also follows weapon weight.
  ADS interpolation and recoil recovery agree at 30, 60 and 120 fps.
- Server-confirmed body hits, headshots and eliminations drive the crosshair,
  sounds, existing enemy flinch and floating damage. A headshot has an outlined
  marker as well as a different tone/color. Up to twelve damage labels follow
  the confirmed world-space contacts; labels behind the camera are hidden.
  **Settings → Gameplay → Confirmed damage numbers** disables floating labels
  and numeric hit text immediately and remembers the choice.
- Confirmed cover rays reconstruct the actual supporting face for concrete
  chips, metal sparks, dirt puffs or wood fragments and matching impact sounds.
  Existing confirmed blood contacts supply flesh visuals, respecting the Blood
  effects switch. Squad shots render cover impacts too. A single reusable point
  cloud is capped at 24 particles on compact quality or 72 otherwise; existing
  bounded decals, smoke and casing pools remain.
- Added subtle firing/damage shake, landing dip and sprint FOV kick. **Settings
  → Accessibility → Reduce camera motion**, or the operating system's reduced
  motion setting, removes these extras, walking bob and scope-eyebox sway.
  Aim zoom, weapon recoil and server ballistics are not weakened. Decorative
  camera motion is excluded from the direction submitted for a shot.
- Surface-aware footsteps and positional enemy/squad reports use facing-relative
  stereo panning, distance attenuation and cover muffling. Headphones are
  recommended. Original synthesized map ambience and a quiet minor-key score
  build as threats approach and firing starts, then settle between fights.
  **Settings → Audio → Lobby & combat music** adjusts music independently of master
  volume; mute still silences everything. The three-voice score and short-lived,
  capped combat sounds release their graphs when finished or leaving combat.
  There are no new audio downloads or third-party music assets.

Local Node 22 checks pass **385 tests and the production build**, up from 369.
Production-browser checks exercise every gun's accepted firing and tactical
reload on desktop and phone touch, saved settings, two separate browser
identities in Wickfall co-op, remote reports, confirmed elimination/damage
labels, readable feedback and audio shutdown at results. Tests cover recoil and
ADS timing, reload uniqueness, camera accessibility, contact materials, particle
pool/recovery, positional mixing, voice cleanup/caps, score pacing and labels.
No browser exceptions or missing assets were observed in these runs.

Repeated paired nine-second Chromium/Metal/Auto samples on the local Apple A18 Pro host,
with identical warm-up shots/reloads and audio enabled:

| Measurement | Before | After |
| --- | ---: | ---: |
| Desktop range FPS, both repeats | 60.00 | 60.00 |
| Phone-emulated range FPS, both repeats | 60.00 | 60.00 |
| Two-player Wickfall FPS, both repeats | 60.00 | 60.00 |
| 95th-percentile frame time across these samples | 16.7-16.8 ms | 16.7-16.8 ms |
| Desktop range draw submissions/frame | 169.2 | 166.3 |
| Phone-emulated range draw submissions/frame | 177.5 | 175.8 |
| Desktop menu readiness, one local sample | 382 ms | 204 ms |
| Phone-emulated menu readiness, one local sample | 216 ms | 171 ms |
| Compressed client JavaScript | 352.32 kB | 356.98 kB |
| Node tests | 369 | 385 |

An initial un-warmed after sample averaged 57.01 desktop FPS and 59.79
phone-emulated FPS; the repeated, controlled warmed samples above do not erase
that first-run observation or guarantee stutter-free play. Menu timings are
single, cache-sensitive observations, not evidence of faster loading. These
measurements do not replace acceptance on a representative mid-range laptop or
physical recent phone, which remains outstanding.

The app's embedded Safari preview separately measured 29.99 FPS in the range
and 30.14 FPS on the plain health-response page with no game canvas (median
33 ms in both). Its observed browser cadence is therefore reported separately;
the Chromium results are not a claim that the embedded preview runs at 60 FPS.

Issues addressed in this phase:

- Hold automatic fire on a target with the Viper/Mako: an older hit-marker
  timeout could clear a newer hit. Markers now replace the previous timeout
  and clear the previous shape before showing the new confirmation.
- Hit or eliminate a target: confirmation text inherited crosshair rotation
  and appeared diagonal. It now lives in a separate, level HUD layer.
- Finish a mission and remain on results: arena ambience could continue in
  the background. Combat ambience/music stop on results/staging, and completed
  one-shot oscillators explicitly disconnect their audio graph.
- Muzzle expiry used global delayed callbacks that could outlive a held-weapon
  replacement. Each current weapon now expires its flash using the render
  clock instead; rebuilding the weapon clears the deadline.

The public game was not deployed, restarted, stopped or put in maintenance.
Azure Table connectivity and a separately approved data-safe cutover remain
blocked on the previously documented administrator action; this phase does not
claim live durable storage. Phase 4 enemy-AI work is separate from this phase.

### Local Phase 4 enemy AI (not deployed)

The role, squad, tactical-difficulty, director and caption behavior described
above extends the existing authoritative AI; Phases 1-3 remain in place.
New tests cover role composition and matching squad support, exact attack
windups, bounded per-player pressure, recovery/resumption, wounded retreat
(including heavies), real cover and reservations, bounded flanks, tier-specific
memory and rifleman tactics, sound investigation, public-state privacy, caption
distance/expiry, replay resets and strict/rate-limited difficulty input.
Socket integration also checks tier-isolated matchmaking, coded joins and
leader-only deployment. Node 22 `npm run check` passes **403 tests and the
production build**, up from 385; the existing large-chunk warning remains.

Production Chromium/Metal/Auto checks used two isolated identities on the same
local host, actual desktop keys and phone-emulated touch input. Both solo and
two-player Wickfall encounters exercised all five roles, observed real
server-resolved attacks, flanking, suppression, healthy/wounded cover, audible
gunshot investigation, all director phases, a quiet recovery window and
automatic resumption. Captions and pace labels were checked for overlap with
the compass, contact awareness and squad roster. No browser exceptions or
missing assets were observed.

These are paired nine-second **warm** samples of a private sustained wave-3
fixture (9 solo / 11 co-op enemies), not a claim about a physical phone or
mission difficulty. The fixture raises enemy health and lowers enemy damage
to keep the same encounter alive; movement, LOS, role decisions and attack
resolution still run normally. Before-source and client assets were preserved
privately before the comparison. No builds/tests ran during frame sampling.

| Measurement | Before | After |
| --- | ---: | ---: |
| Desktop active solo FPS | 60.00 | 60.00 |
| Phone-emulated active solo FPS | 60.00 | 60.00 |
| Desktop two-player co-op FPS | 60.00 | 60.00 |
| Phone-emulated two-player co-op FPS | 60.00 | 60.00 |
| 95th-percentile frame time, all four samples | 16.7-16.8 ms | 16.7-16.8 ms |
| Desktop menu readiness, one local sample | 334 ms | 401 ms |
| Phone-emulated menu readiness, one local sample | 243 ms | 149 ms |
| Four-player / 19-enemy Wickfall mean server tick | 2.28 ms | 3.25 ms |
| Four-player / 19-enemy Wickfall p95 server tick | 8.51 ms | 8.41 ms |
| Four-player / 19-enemy Foundry mean server tick | 1.99 ms | 2.84 ms |
| Four-player / 19-enemy Foundry p95 server tick | 6.87 ms | 6.66 ms |
| Node tests | 385 | 403 |

The server benchmark keeps four synthetic players alive over 600 deterministic
20 Hz ticks, sampling the last 500; its p95 remains below the 50 ms tick budget,
but the richer decisions cost more average CPU. An initial un-warmed desktop
solo sample was 51.22 FPS before / 57.78 after; warm results do not erase
first-run shader/asset stalls. Menu readings are single cache-sensitive
observations, not a loading improvement. Representative mid-range-laptop and
physical recent-phone acceptance remain outstanding, as does the separately
blocked Azure durable-storage verification/cutover. Enemy callouts are text
captions, not spoken voice lines.

Phase-specific bugs fixed during validation: squad assignment could leave a
rusher without covering support in its own squad; untimed lateral approaches
could keep an attacker circling; contact chatter could mask a short retreat
callout; and the new HUD labels initially overlapped existing awareness/roster
elements. Callout DOM updates now also avoid repeatedly announcing an unchanged
caption to assistive technology, and reset cleanly on a new deployment.

No player data, secrets, admin codes, event availability or published release
notes were changed. No deployment, maintenance, live restart, storage migration
or Azure operation was performed. The public game remains unchanged.

### Local Phase 5 teamwork (not deployed)

Co-op survival, Blitz, Raid and the new **Team operation** mode share real
server-authoritative teamwork. Solo retains the existing death/respawn rules:
an operator is downed only while another connected teammate can still act.
With that support, lethal damage creates a **20-second downed state**, a low
injured pose and **0.9 m/s forward crawl** (normal strafe/backward modifiers
still apply). Downed operators can move, look and ping, but cannot shoot, aim,
jump, sprint, reload, use supplies/medkits or activate abilities. Bleeding out
enters the existing four-second respawn cycle; complete incapacitation ends the
mission as a squad wipe, including when the last standing teammate disconnects.

Hold **Interact (E)** within **3 m and clear line of sight** to revive an ally.
It takes **2.8 seconds**, or **1.5 seconds** for a Medic or an operator inside an
Engineer station. The revived ally has **45 HP** and **1.2 seconds of spawn
protection**. Releasing, taking a hit, moving more than half a metre from the
channel start, losing reach/LOS, stale input or disconnecting resets progress.
The phone has a genuine held **Revive / Hack** button; assistive-technology
activation toggles the hold. Revives and abilities remain available while
regrouping between waves. This is not a medkit auto-revive.

| Class | Actual ability | Cooldown / combinations |
| --- | --- | --- |
| Medic | Triage pulse heals standing allies within 6 m and LOS for 30 HP, capped at 100 | 25 s; heals 50 HP inside an Engineer station; passive faster held revives |
| Assault | Rally gives nearby allies 20 guard and an 8 s rallied window | 30 s; rallied shots deal 25% extra damage only against Recon-scanned enemies |
| Recon | Sweep scans enemies currently visible within 22 m for 8 s | 25 s; up to three last-reported squad markers; no wall-through tracking |
| Engineer | A 12 s station grants each nearby identity one magazine of reserve ammo, within capacity | 30 s; within 4 m and LOS, reduces incoming damage 30%, improves Medic healing and speeds held revives |

Use **V** for the selected class ability. **G** marks an aimed visible enemy,
**Z** marks visible ammunition and **X** marks a walkable route about 10 m ahead.
Server range/LOS/terrain validation, a one-second manual ping cooldown, six-second
expiry and a 12-marker room bound apply. Manual pings replace the sender's old
marker. Enemy markers keep the **reported position**, not a hidden moving target.
Downed allies and mission terminals also have readable waypoints. Phone has
matching Enemy / Ammo ping / Route / class buttons, each at least 44 px, with a
separate portrait layout. All five new actions are rebindable; old custom
bindings retain keys already occupied by another action.

**Team operation**, available at level 1 on unlocked maps, adds four genuine
coordinated stages without replacing the existing Raid or campaign:
1. **Defend:** accumulate 10 uncontested seconds with an operator in the relay's
   5 m zone. Visible enemies within 6 m contest it.
2. **Escort:** accompany a moving relay drone along a collision-safe route.
   At least one operator must remain within 5 m; nearby enemies halt the drone.
3. **Hack:** hold Interact at separate terminals for five synchronized,
   uncontested seconds. Two connected operators require two different terminal
   users; solo requires one. Release, damage or lost eligibility resets the
   synchronized progress. A dead/downed teammate does not reduce a duo to solo.
4. **Extract:** clear the sector, then gather every connected, standing operator
   in the extraction zone for five uninterrupted seconds. No abandoning a downed
   teammate at the exit.

Each stage refreshes enemies and supplies; uncleared defenders are withdrawn at
the stage transition without kill rewards. The drone is an escort objective,
not a damageable teammate or destructible prop. Operations give no campaign
credit. Raid also grants objective-play credit for uplink participation, cache
recovery and contributing to the final fight.

Teamwork is added to the existing match XP, **not paid twice**: 25 XP for a
revive, 8 XP for an assist and 35 XP / 100 objective score per completed stage
participated in. A valid contribution shares 3 XP with each other standing
connected ally; total teamwork XP is capped at **250 per operator per match**.
Revive credit is once per victim per wave; assists require recent (eight-second)
meaningful damage and cannot credit the killer or pay twice for the same enemy.
Healing and ammo giveaways grant no XP. Rewards settle with existing durable
match receipts; partial missions earn their accrued teamwork at an overrun,
while leaving before settlement retains the existing in-progress-match rules.
New lifetime assists, revives, objective score, teamwork XP and saved class
metadata preserve older records and pass snapshot/import/recovery validation.
Class levels, challenges and new profile/ranking views remain later phases.

Phase 5 validation completed **438/438 Node 22 tests** and a production build
(Phase 4: 403 tests). Coverage includes interrupted/stale revives, crawl action
restrictions, disconnect/wipe handling, class cooldowns and combinations,
duplicate/capped rewards, every map's objective layout and escort route, real
Socket.IO commands, and durable snapshot/restart/receipt recovery.

Private Chromium/Metal browser checks completed all four operation stages solo
on desktop and phone-touch emulation, and with two isolated operator identities.
Escort completion used actual keyboard/touch movement; hacks used held inputs
at separate terminals. Checks also exercised all four class abilities, the
Medic/Engineer healing combination, three ping types, interrupted and successful
desktop/touch revives, low-speed touch crawl and results with objective credit.
New controls and HUD panels were checked at 844x390, 390x844 and 320x568;
teamwork buttons are at least 44 px. No client exceptions or missing assets were
observed in the completed runs.

The paired warm active-combat comparison below uses immutable Phase 4 assets
and the final Phase 5 build, Auto quality and a 60 FPS cap. Each sample covers
about nine seconds of the same private wave-3 fixture: 9 enemies solo or 11
with two operators. Increased enemy health and reduced damage keep the
encounter alive; authoritative movement, tactics, LOS and attacks remain active.
Desktop and phone are isolated browser contexts, measured sequentially in one
Chromium process. No builds or tests ran during frame sampling.

| Measurement | Before | After |
| --- | ---: | ---: |
| Desktop active solo FPS | 60.00 | 60.00 |
| Phone-emulated active solo FPS | 60.00 | 60.00 |
| Desktop two-player co-op FPS | 60.00 | 60.00 |
| Phone-emulated two-player co-op FPS | 59.78 | 60.00 |
| 95th-percentile frame time, all four samples | 16.7-16.8 ms | 16.7-16.8 ms |
| Desktop solo menu readiness, one local sample | 369 ms | 359 ms |
| Phone-emulated solo menu readiness, one local sample | 230 ms | 154 ms |
| Desktop co-op menu readiness, one local sample | 149 ms | 129 ms |
| Phone-emulated co-op menu readiness, one local sample | 135 ms | 142 ms |
| Node tests | 403 | 438 |

A separate short station/objective geometry sample measured 60.00 FPS on each
viewport (p95 16.7 ms; about 99 phone / 110 desktop draw calls per frame). Its
2.2-second, lower-enemy fixture is not equivalent to sustained combat. Menu
readings are single cache-sensitive observations, not proof of faster loading.
Other runs on the shared host had substantial frame stalls before and after;
a later separate-browser-process repeat also stopped on a localhost socket
disconnect/reconnection in the immutable **before** phone client. Its partial
results are not a completed comparison or a Phase 5 pass. Successful warm
samples do not establish worst-case performance or physical-device acceptance.

Validation fixes included safe hack-terminal placement on Tundra, preserving
occupied custom bindings during migration, and avoiding new objective/class/
touch-control overlaps with the existing HUD in short portrait and landscape
layouts. Representative mid-range-laptop and physical recent-phone acceptance,
and the separately blocked Azure durable-storage verification/cutover, remain
outstanding. No production data, secrets, admin codes, deployment, live restart,
Azure configuration or published release notes were changed; the existing
public game and earlier private owner preview remain running.

### Local Phase 6 progression and retention (not deployed)

**Career, mastery & rewards**, available in the deployment menu and lobby,
adds working loadout, contracts, season and honors screens. Existing player
levels still require **500 XP per level**; campaign order, sniper ownership,
collected weapons, outfits, wallets, staff codes and signed identities are not
reset. Legacy operators start with empty additional mastery, not replacement
profiles. New career credit comes from settled, active PvE matches in Campaign,
Blitz, Raid and Team Operations. Training and Free-for-All do not earn it;
FFA retains its previous rewards and uses standard attachment handling with
no operator perk. An idle wipe does not advance new progression.

**Mastery and usable equipment**

- Every actual PvE elimination earns **20 mastery XP for the gun used**,
  saved at match settlement. Weapon levels run from 1 to 25. The first
  **Control grip** needs level 2 / **40 XP / two eliminations** and reduces
  spread by 15% and camera recoil by 10%. Level 4 unlocks a quick-change kit
  with 10% faster tactical and empty reloads; level 8 unlocks an extra reserve
  magazine. Equip one attachment per gun.
- Cosmetic weapon finishes unlock at weapon levels 3 (**Copper**) and 10
  (**Arctic**); claimed free-season tier 4 unlocks **Aurora**. Coatings and
  attachment geometry are visible on held and teammate weapons. Their geometry
  stays within the existing merged-material mesh/draw budget for all 14 guns.
  Event ownership and availability gates still apply to event weapons.
- The deployed class earns **half of settled match XP**, rounded down.
  Each class has 20 levels; level 3 requires 450 class XP and level 20 requires
  28,500. **Prepared**, unlocked at player level 2, adds a reserve magazine.
  Class-level-3 perks are **Advanced triage** (Medic pulse heals 10 more HP),
  **Drilled reload** (Assault reloads 10% faster), **Steady focus** (Recon
  spread reduced by 15%) and **Extended station** (Engineer station lasts
  15 rather than 12 seconds). Equip one operator perk; class perks only
  function with their matching class.
- Ownership and equip eligibility are checked server-side; changes are locked
  during deployment, including regroup. Reload timing, spread, reserve capacity,
  loot, supplies, support and station refills use the same effective weapon
  rules as client feedback. The quick kit and Assault perk combine
  multiplicatively: the rifle's 1,650 ms tactical reload becomes **1,337 ms**.
  Healing and station duration are actual authoritative effects.

Weapon level 25 requires **42,360 XP / 2,118 eliminations per gun**; four class
masteries, weapon collections, recurring seasons and increasing prestige
thresholds provide long-horizon targets. These are balance thresholds, **not
empirical evidence of months-long retention**. Private fresh-operator browser
fixtures earned and equipped the first grip in **1.76-1.86 seconds desktop /
1.62-1.67 seconds phone emulation** across completed repeats, including career inspection, two real input-
driven eliminations and an overrun settlement. Their two stationary 20-HP
targets deliberately isolate the unlock path: they prove the requirement can
settle well below ten minutes, not typical new-player completion time.

**Daily/weekly contracts, seasons and badges**

Daily contracts require 12 eliminations, three team actions or one victory;
their respective rewards are **150/150/200 XP and 30/30/40 tokens**.
Weekly contracts require 200 eliminations, 25 team actions or ten victories,
rewarding **1,000/750/1,000 XP and 180/120/180 tokens**. A team action is an
assist, revive or completed 100-point objective stage. Daily reset is midnight
UTC; weekly reset is Monday midnight UTC. Only the current period's completed
contracts can be claimed. The latest eight daily and eight weekly counters
are retained to bound profile size; expired counters are retired, never
lifetime statistics, mastery or reward receipts.

Seasons last **28 days**, anchored at **2026-01-05 00:00 UTC**. Each has a free
20-tier track, one tier per **1,000 earned match XP**, granting **20 times the
tier number in tokens**; tier 4 also owns Aurora. The **This season** ranking
uses only that season's earned match XP, not lifetime or contract-claim XP.
A boundary switches to a fresh ranking/track without erasing any lifetime
data, prior season archive or equipment; earned old track rewards remain
claimable. Match settlement time determines its day, week and season, including
delayed durable recovery. Contract-claim XP increases the existing player level
only; it does not recursively award class mastery, seasonal XP or prestige.

Eight earned achievement badges cover the first elimination, 1,000 PvE
eliminations, 25 lifetime revives, 10,000 objective score, maximum class/weapon
mastery, a Nightmare victory and prestige. Honors shows locked and earned
badges; the operator card shows prestige and an earned-badge showcase.
**Prestige never resets anything**: rank 1 needs 20,000 cumulative earned-match
XP, rank 2 needs 60,000, and subsequent thresholds increase. Each voluntary
claim grants 250 tokens and the prestige badge.

**Endgame and durable rewards**

Player level **10 / 4,500 XP** unlocks **Nightmare** and two optional mutators.
Nightmare retains normal enemy health, damage and movement speed, but remembers
contacts for ten seconds, enables rifleman flanks, permits 5/7 build-up/peak
attackers per living operator and shortens recovery to 1.5 seconds.
**Scarce ammunition** halves reserve capacity, including refills, with a
one-magazine minimum. **No medkits** disables medkits but preserves Medic and
revives. Both can be combined; all squad members must qualify. Coded joins,
quick matchmaking and replay preserve the authoritative difficulty/mutators;
matchmaking never mixes them. There is no new difficulty XP multiplier.

Clients submit only a claim identifier, never amounts, counters or timestamps.
Existing durable transactions, staged rewards and identity-bound deterministic
claim receipts prevent duplicate credit, including concurrent/repeated requests,
lost acknowledgements, snapshot import and restart recovery. Equip/claim success
is acknowledged after persistence. Current/backup profile and journal validators
retain career metadata or reject corruption explicitly instead of resetting it.
No live data import, migration or storage cutover was performed.

**Local validation and measurements**

Phase 6 completed **463/463 Node 22 tests and a production build**
(Phase 5: 438). Coverage includes ownership/level/class gates, real shots and
kit effects, all contract thresholds and UTC boundaries, cached seasonal ranking
rollover, no-reset prestige, idle/FFA exclusions, forged payloads, duplicate
claims, Table lost-ACK recovery, snapshot/import/restart and corrupt backups.
The existing greater-than-500-kB bundle warning remains.

Final Chromium/Metal checks exercised fresh-operator unlock/equip and practice
without mastery credit on desktop and phone-touch emulation; daily/weekly
claims, current-season rankings, season reward/finish, prestige, badges and actual two-identity Nightmare
with both mutators; combined reload timing and a Medic pulse healing both allies
from 20 to 60 HP. All four career tabs fit 844x390, 390x844 and 320x568, with
at least 44-CSS-pixel controls. No client exceptions or missing assets were
observed in completed runs.

The comparison uses immutable Phase 5 assets and the final Phase 6 build, Auto
quality, a 60 FPS cap and the same active wave-3 private fixture (9 enemies solo,
11 with two operators). Health/damage adjustments keep encounters active;
server tactics, movement, LOS and attacks remain enabled. Isolated identity
contexts share one Chromium process and render sequentially in the foreground.
Each warm sample spans about nine seconds; no builds/tests run during sampling.

| Measurement | Before | After |
| --- | ---: | ---: |
| Desktop active solo FPS | 60.00 | 60.00 |
| Phone-emulated active solo FPS | 60.00 | 60.00 |
| Desktop two-player co-op FPS | 57.48 | 60.00 |
| Phone-emulated two-player co-op FPS | 60.00 | 59.46 |
| 95th-percentile frame time, all four samples | 16.7-16.8 ms | 16.7-16.8 ms |
| Desktop solo menu readiness, one local sample | 429 ms | 155 ms |
| Phone-emulated solo menu readiness, one local sample | 147 ms | 135 ms |
| Desktop co-op menu readiness, one local sample | 150 ms | 230 ms |
| Phone-emulated co-op menu readiness, one local sample | 131 ms | 146 ms |
| Node tests | 438 | 463 |

The before desktop co-op sample includes one **400 ms** stall; the final after
phone co-op sample includes one **100 ms** stall. Cold after phone solo was
59.89 FPS with one 33.3 ms frame; other cold samples were 60.00. An earlier
completed after comparison reached 60.00 in all four warm samples. These
adverse readings remain recorded, not replaced by the faster repeat. Load
readings are single cache-sensitive observations, not proof of improvement.

Validation fixed an ordinary leaderboard payload regression and misplaced
career-handler registration, and tightened the career header/safe-area layout.
The first full run had a durable Socket.IO ACK-test timeout; its isolated retry
and subsequent full runs passed without relaxing its timeout or guards.
Failed browser fixtures (nonnumeric enemy IDs/occluded targets and reload input
before shot-state acknowledgement) and a 0.000015-pixel transformed-rectangle
rounding failure remain preserved separately from successful evidence.
Representative mid-range-laptop and physical recent-phone acceptance, empirical
retention/playtime balance and the separately blocked Azure durable-storage
verification remain outstanding. No production data, cloud configuration,
deployment, live restart, Git publication or published release notes changed;
the public game and earlier private owner previews remain running.

### Local Phase 7 leaderboards and profiles (not deployed)

**Verified records** adds daily, Monday-based weekly, calendar-monthly,
28-day seasonal and all-time PvE rankings. All boundaries use the server's UTC
clock. Select teamwork score, eliminations, assists, revives, objective score,
accuracy, damage, fastest clear or highest cleared difficulty; compare all
operators, accepted mutual friends plus yourself, or registered squads.
Twenty-row pages include your own rank even when it is off-page. The original
all-time Level & XP / Eliminations and current-season XP tabs remain intact.

Detailed tracking starts with eligible settlements after this local update.
Historical XP, eliminations and existing teamwork totals are preserved, but
missing historical dates, damage, accuracy and mission times are **unrecorded**,
not reconstructed. Only the newest day/week/month/season detail buckets are
retained; all-time records never roll over. Late recovery adds lifetime credit
once and cannot resurrect an older window over a newer one. Existing career
season archives, claimable rewards and player progression are unchanged.

**Eligibility and scoring**

- Only server-produced, durably settled co-op match evidence enters verified
  records. A participant needs at least 30 seconds and a confirmed hit,
  elimination, assist, revive or objective contribution. Training and FFA do not
  enter these PvE boards; their existing reward rules are unchanged.
- Score is 100 per elimination, 50 per assist, 150 per revive, objective points,
  and 250 per fully participated victory. Accuracy counts hit triggers, not
  pellets, and needs at least 20 triggers for ranking.
- Victory, highest difficulty and fastest-clear credit require participation
  from deployment. Late joiners may still earn eligible combat/teamwork stats.
  Fastest time includes the whole mission, including wave breaks, compares a
  selected map/mode route across difficulties, and displays its difficulty.
  Mutator runs can earn other stats but never replace unmodified clear times.
- Flight, unlimited ammo, admin support or chest restocking exclude the round.
  Plausibility limits reject excessive trigger rates, kills, damage, XP and
  teamwork farming; damage bounds include real pellet counts and the
  Assault/Recon damage combo. These are basic checks, not a claim that browser
  cheating or alternate-account abuse is impossible. Results state whether
  they qualified and why. A failed ranking check does not reset earned wallets
  or earlier career rewards.
- Clients cannot submit scores, times, difficulty or a different identity.
  Strict schemas and rate limits protect all new read/social commands.
  Rankings use deterministic tie-breaking, bounded caches and explicit error,
  timeout and disconnect states. Cache revisions also cover transaction drafts,
  rolled-back writes, profile changes and period boundaries.

**Public profiles and private social controls**

Use **Profile, friends & squad** in the menu/lobby, or select an operator in a
ranking. Public-tag lookup shows saved XP rank, player level, prestige, badges,
verified statistics, route clear times and favorite weapon by confirmed weapon
mastery XP. Operators can select up to three actually earned achievements for
their showcase; that selection also updates the original operator card.
Profiles explicitly distinguish saved totals from newly tracked statistics.

Friends require a request and acceptance; either party can cancel, decline or
remove the relationship. Only the requesting operator receives their private
friend/request list. Public lookup and rankings never return full identity IDs,
tokens, ownership records, friend lists or signing material.

Create a named persistent squad, invite mutual friends and accept invitations
from the social panel. Squads have at most four members. Captains can remove
members; members can leave. Captain departure disbands rather than silently
transferring ownership. Disbanded ranked archives remain visible, and the same
captain can reactivate their stable-tag squad without resetting its record.
Names, rankings, membership counts and archive status are public; roster and
invitation controls are available to the squad's operators.

Squad credit requires at least two distinct authenticated registered members,
the entire deployed room roster belonging to that squad, and eligible full
participation by every member through settlement. Solo, mixed-roster, late-join
or disconnected rosters cannot farm squad credit. Contributions aggregate, but
each match, victory and clear time counts once, not once per operator.
Membership changes are locked while members are deployed. Delayed durable
receipts retain their earned squad credit even if the squad is subsequently
disbanded, without duplicating a clear.

Friends, showcases, detailed stats and optional `squads.json` use the existing
private persistence transactions. Old snapshots without the new optional file
still load; present corrupt files, corrupt current/backup stats and inconsistent
friend/squad graphs fail private snapshot validation. Table encoding, export,
import, restart, pending receipts and lost acknowledgements retain the new
metadata. No existing profile is rewritten to invent a history.

**Local validation and measurements**

Phase 7 completed **478/478 Node 22 tests and a production build**
(Phase 6: 463). Coverage includes period boundaries, scoring, accuracy/time
eligibility, sorting, pagination, cache changes, social ownership/privacy,
registered-squad Socket.IO settlement from real guarded shots, earned showcases,
lost-ACK recovery, archived-squad recovery, old snapshots and corrupt metadata.
The existing greater-than-500-kB bundle warning remains.

Final Chromium/Metal checks passed desktop and phone-touch-emulated solo and
two-identity gameplay, all five windows and nine metrics, actual mutual-friend
and squad invitation/join/leave/disband controls, squad score accumulation,
public lookup and earned showcase updates. Profile/social and ranking panels
fit 844x390, 390x844 and 320x568, with at least 44-CSS-pixel primary controls.
The ranked browser fixture waits a real 30.5 seconds, then uses actual
keyboard/touch shots against stationary 20-HP final-wave targets. It verifies
eligibility and persistence, **not representative mission completion times**.
No client exceptions or missing assets were observed in completed runs.

The paired performance comparison uses immutable Phase 6 assets and the final
Phase 7 build, Auto quality, a 60 FPS cap and the same active wave-3 private
fixture. Enemy movement, tactics, attacks and LOS remain active; fixture health
and damage keep the fights running. Isolated identities share one Chromium
process and render sequentially in the foreground. Each warm sample spans
about nine seconds, without simultaneous builds or tests.

| Measurement | Before | After |
| --- | ---: | ---: |
| Desktop active solo FPS | 60.00 | 60.00 |
| Phone-emulated active solo FPS | 60.00 | 60.00 |
| Desktop two-player co-op FPS | 60.00 | 60.00 |
| Phone-emulated two-player co-op FPS | 60.00 | 60.00 |
| 95th-percentile frame time, all four samples | 16.7-16.8 ms | 16.7 ms |
| Desktop solo menu readiness, one local sample | 331 ms | 306 ms |
| Phone-emulated solo menu readiness, one local sample | 152 ms | 202 ms |
| Desktop co-op menu readiness, one local sample | 129 ms | 150 ms |
| Phone-emulated co-op menu readiness, one local sample | 153 ms | 139 ms |
| Node tests | 463 | 478 |

Both cold desktop co-op samples were **58.80 FPS with one 200-ms stall**.
Other cold samples were 60.00; no warm sample had a frame over 50 ms.
Menu values are single cache-sensitive readings, not proof of improvement.
Final own-profile click-to-render samples were 118 ms desktop / 92 ms phone
emulation. Across 17 ranking WebSocket requests per device, round-trip times
were 3.6-15.9 ms desktop (median 4.4) and 3.8-9.3 ms phone emulation
(median 5.8), on loopback with six synthetic identities. A separate isolated
1,000-profile local-transaction test measured 47 ms cold ranking, 27 ms warm
ranking and 33 ms public profile; these are synthetic local results, not
production-scale latency guarantees.

Validation fixed the missing optional-squad-file validator, removed repeated
whole-dataset profile reads from ranking construction, made cache revisions
stable across transaction reloads, preserved delayed credit after disbanding,
and accounted for legitimate rallied sniper damage. Existing leaderboard unit
fixtures were updated for the real new controls rather than bypassing them.
The first full run's three old DOM-fixture failures and the first browser run's
obsolete result-selector timeout are retained separately from successful final
checks. No acceptance guard or timeout was weakened.

Physical recent-phone and representative mid-range-laptop acceptance and the
separately blocked Azure durable-storage verification remain outstanding.
There was no production-data or cloud access, deployment, live restart, Git
publication or published-release change. The public game and previous private
owner previews were not stopped.

### Local Phase 8 visuals and atmosphere (not deployed)

Lighting now uses map-specific exposure, a softer hemisphere/fill balance,
rim light and adjusted shadow bias. Existing quality presets still control
shadows, ambient occlusion, bloom, antialiasing and phone resolution limits.
High/Ultra add restrained split-tone grading and edge shading inside the
existing output pass, not another full-screen pass. Low and phone Auto retain
their cheaper rendering path. Terrain-grounded, layered mist replaces the
floating fog sheets; Wickfall keeps readable nearby targets and obscured
long sightlines. All new cover remains matte, with no added dynamic lights.

**Real breakable cover**

Each combat map has two to six small, deterministically placed wooden crates
and generators on clear, flat ground (Foundry: three). The training range has
none. These are additional props, not destructible buildings or terrain.
Each has 80 health: four unmodified close-range rifle body-damage hits.
Normal server-validated shots damage them; there is no client destruction
command. Darkening communicates damage, and a breaking prop disappears for
every operator. The generator's orange rupture is cosmetic, not splash damage.

Intact cover blocks movement, enemy navigation, LOS and bullets. Destruction
removes the same rotated box from server rules, client prediction, Cannon
collision and rendering. Supported bodies wake when their support disappears,
and attached blood stains are removed. A shotgun's entire trigger sees the
pre-trigger geometry: even the breaking shot cannot hit through it. Later
shots and movement can use the hole. Props do not award kills, confirmed
hits/damage, mastery XP or tokens; firing still counts toward accuracy.
Their state survives an authorized active join and resets on replay or
campaign map advance. Existing active-admission permissions are unchanged.

Room topology is immutable and isolated. Navigation reuses the static map
graph, overlays only prop-affected nodes/links and bounds its route cache;
destroying cover cannot invalidate another room's intact walls. Static
buildings, terrain, rewards, progression and private social data are unchanged.

**Effects and animation**

Sparks, soft dust, rectangular flying chips and generator ruptures share the
existing single Points draw and fixed 24-particle Low / 72-particle normal
ring. Smoke bursts reuse the existing fixed smoke pool. Debris is cosmetic,
with no rigid-body fragments, permanent collision or ragdolls. Blood and
The seasonal decoration control remains intact (Christmas replaces Halloween
in the later local Winterwatch update). Reduced motion freezes mist drift and
suppresses new destruction bursts without changing authoritative destruction.

The existing tactical skeleton now blends aim pitch, crouching and downed
poses, smooths teammate facing across angle wrap, and retains hit reactions.
Finite skeletal death poses settle over 840 ms before disposal rather than
spawning a physics ragdoll. Hands remain attached to their real equipped
weapon; reduced motion retains functional stance and aiming information.

**Local validation and measurements**

Final Node 22 `npm run check` passed **493/493 tests and the production build**
(Phase 7: 478). New coverage includes every map's bounded placement, shared
collision/LOS/support/rays, topology restoration and route-cache isolation,
shotgun nonpenetration, FFA, reward exclusion, guarded two-identity network
shots, authorized late snapshots, Cannon contact slop, instance/body bounds,
disposal, particle budgets, fog contrast and finite blended poses.
The existing greater-than-500-kB bundle warning remains.

Real Chromium checks passed desktop and iPhone-touch-emulated solo and
two-player destruction: actual keyboard/joystick movement stops at intact
cover without server correction, regulated weapon shots open a shared hole,
both operators walk through it, and later shots reach the target behind it.
Replay restores real cover. Low/High/Ultra reduced-motion destruction also
passed. Completed runs had no client exceptions or missing assets.

Performance compares an immutable Phase 7 source/build with Phase 8, using
Chromium/Metal, Auto quality, a 60 FPS cap and the same active wave-3 private
fixture. AI movement, tactics, attacks and LOS stay active; synthetic high
health/low damage sustain combat. Separate identities share a browser process
and render sequentially in the foreground. Approximately nine-second cold
and warm samples run without simultaneous builds, tests or CPU benchmarks.

| Controlled repeat, warm | Phase 7 | Phase 8 |
| --- | ---: | ---: |
| Desktop active solo FPS | 60.00 | 60.00 |
| Phone-emulated active solo FPS | 60.00 | 60.00 |
| Desktop active two-player FPS | 56.24 | 59.14 |
| Phone-emulated active two-player FPS | 56.72 | 59.57 |
| Desktop solo menu readiness, one local sample | 1184 ms | 922 ms |
| Phone solo menu readiness, one local sample | 706 ms | 705 ms |
| Desktop co-op menu readiness, one local sample | 501 ms | 660 ms |
| Phone co-op menu readiness, one local sample | 633 ms | 787 ms |
| Node tests | 478 | 493 |

These are not uniformly smooth or hardware-certified results. The repeat's
cold desktop co-op was **50.19 FPS / 450-ms maximum frame before** and
**46.42 FPS / 1383-ms maximum frame after**. Cold phone co-op was 55.85 /
52.97 FPS. Phase 8 warm co-op p95 was 16.7-16.8 ms, with one 50.1-ms phone
frame. High-quality warm stress was 40.73 FPS before (2749.9-ms stall) /
56.23 after (66.6-ms maximum); High is not a guaranteed 60-FPS preset.
Single menu samples are cache/host-sensitive, not proof of load improvement.

The original comparison is retained separately: Phase 7 warm desktop solo,
phone solo, desktop co-op and phone co-op were 58.91/60.00/60.00/60.00 FPS;
the first Phase 8 run was **40.25/60.00/54.20/47.43 FPS**, including a
2366.6-ms desktop stall. Host contention is a possible confound, not grounds
to discard those readings or attribute every stall externally. Consistent
60-FPS laptop acceptance remains open.

A separate Node 22 synthetic five-enemy/Cannon benchmark measured mean server
ticks 2.812 -> 2.926 ms (p95 8.952 -> 9.580 ms), and mean Cannon steps
0.0987 -> 0.1246 ms with 47 -> 50 bodies. This is CPU fixture timing, not
device FPS. Stress exposed a real full-navigation-rebuild regression:
shooting and ticking after destruction took 454-523 ms. Reusing the static
graph reduced those three measured topology changes to **25-29 ms**.

Final ten-cycle High destruction stress used synthetic authoritative resets
and actual regulated keyboard taps/reloads; it is not normal prop respawning.
It measured 58.16 FPS, p95 16.8 ms, maximum 100.1 ms and two frames over
50 ms, with no fire-rate rejections. After exercising every prop/effect,
WebGL resources stayed at 405 buffers, 61 textures, 54 programs, 25
framebuffers and 20 renderbuffers through cycle ten. Separate map replays
exercise disposal; their counts vary with active character models and shader
warmup, so they are not a claim that the entire game has zero allocations.

Validation fixed the real Cannon contact-penetration/server-correction bug
using canonical swept bounds, the navigation rebuild stall, an extra impact
draw, and Wickfall fog contrast. Failed fixtures (occluded target/observer
placement and held-fire stress during stalls) remain separate from successful
final runs. One earlier full run had an existing durable Socket.IO ACK timeout;
its isolated retry and the final full check passed without weakening guards
or increasing timeouts.

A new immutable loopback preview runs the matching final client/server
snapshot with isolated synthetic saves and no production credentials.
Physical recent-phone and representative mid-range-laptop acceptance,
consistent frame pacing, empirical long-term retention, and the separately
blocked Azure durable-storage integration remain outstanding. Nothing was
deployed, published, committed or pushed; published release metadata is
unchanged. The public game and earlier private previews were not stopped.

**Bounded final acceptance follow-up**

The touch token balance now lives inside the ammo card's scaled header,
instead of floating independently over it. Narrow portrait cards also respect
the selected HUD scale so health and ammo do not overlap. Actual touch checks
covered 844x390, 390x664 and 320x568 at 80%, 100% and 115%, including a
1,234,567-token synthetic wallet and a real reload. Wallet/weapon text and
health/ammo cards did not collide, balances stayed visible and all visible
touch buttons retained at least 44x44 CSS-pixel targets.

One focused cold High/two-player Chrome timeline and V8 CPU investigation
identified synchronous first-use WebGL shader/program queries on the main
thread: 842.6 ms sampled in `getProgramInfoLog` and 124.7 ms in
`getShaderInfoLog`, across the recording, not one frame. Three.js invokes
these from its first-use render path. Captured render callbacks reached
431 ms; initial synchronous scene construction took 246 ms. The isolated
server's initial navigation tick also took 310 ms. These are identified
code/driver synchronization paths, not a proven explanation of every earlier
1.38-2.37-second stall or evidence that the hardware alone caused them.

An asynchronous shader-preparation experiment was rejected, not shipped.
Its first attempt exposed an asset/material-disposal race and rendered no
gameplay; its apparent 60 FPS is invalid. Waiting for assets fixed that race,
but preparation still took 426 ms, both clients took 1542 ms to become ready,
and later gameplay callbacks still blocked for 391 and 234 ms in the same
shader query path. The corrected experiment measured 58.58 FPS cold and
60.00 warm, with a 233-ms cold frame. It did not establish a safe, complete
fix. Rendering and shader diagnostics therefore remain unchanged rather than
adding an unproven loading lifecycle or suppressing error checks. Raw traces,
failed runs and the rejected diagnostic build are retained separately.

On the final HUD-only source, one uninstrumented High desktop/touch-Auto
two-player run measured desktop cold 60.00 FPS, warm **59.02 FPS with a
166.8-ms frame**, and phone emulation 60.00 cold/warm. Samples contained
149-194 actual draw calls per frame; a loading screen cannot satisfy the
frame assertion. These later readings do not replace the earlier adverse
runs or close consistent-60-FPS acceptance. Final ten-cycle destruction
stress measured 59.48 FPS, p95 16.7 ms, maximum 83.4 ms and four frames over
50 ms, with identical stabilized resource counts and no fire-rate rejections.
Desktop/touch solo/co-op cover, replay and Low/High/Ultra reduced-motion
checks passed again. Final Node 22 `npm run check` passed **494/494 tests and
the production build**. No thresholds, guards, features or quality settings
were relaxed.

### Local Winterwatch Christmas / UI verification (not published)

The owner chose to replace Halloween, including training and update-time
targets. The public game, existing previews, production storage and published
`src/release.js` were not changed. The menu hero follows the selected map with
an actual in-game arena overview, its name and terrain/time caption, including
the practice range. Ten local 1200x720 WebP captures in `public/map-previews/`
replace the fixed winter illustration; images load on selection rather than
preloading the catalog. No external images, video or second live WebGL scene
are used. Phones show the image in its own readable card below the hero copy.
Deployment is above the detailed briefing and before the operator inventory.
All existing modes, classes, difficulties, modifiers, loadouts, social/career,
staff and settings controls remain available.

The initial Christmas/UI Node 22 `npm run check` passed **499/499 tests and the production build**;
the existing large-bundle warning remains. Coverage includes retained raw event
ownership, ended-map/equip/admin/practice/forged-shot/stale-loot rejection,
deterministic collision-free seasonal placement, the eight-draw/no-new-light
budget, resource disposal, reduced motion, exact practice silhouettes, and the
mounted Christmas challenge's unchanged points/combo/focus behavior.
Archived Wickfall geometry still has coverage; runtime all-map tests use
available arenas rather than reopening the ended event.

The selected-map follow-up adds asset checks for unique, correctly sized
previews under 128 KiB each, plus browser coverage for selection, rapid changes,
practice/normal-mode switching, restored selection and phone layouts. Leaving
practice selection defaults to the first campaign arena, not the retired
Halloween entry at the beginning of the full map catalog.

Chromium desktop and iPhone-touch-emulated browser checks passed real range
hits/resets, live seasonal toggles, keyboard/touch shooting and two authenticated
identities sharing combat. Practice earned no XP/tokens; saved Halloween
ownership remained on disk. Menu/deployment hit areas and horizontal fit were
checked at 1440x900, 844x390, 390x844 and 320x568. Nine phone HUD combinations
(three phone sizes at 80/100/115%) retained a readable 1,234,567-token wallet,
nonoverlapping health/ammo cards and at least 44-CSS-pixel gameplay controls.
This caught a real 390px portrait overlap with the longer practice-ammunition
label; the scaled two-card width limit now covers all phone portrait widths.
Desktop and touch maintenance rounds each actually ran for 30 seconds, scored
330 points for three hits, handled a miss/restart and kept playing when a
test-only mocked readiness response changed. A separate isolated maintenance
server returned 503/Retry-After, rejected WebSockets and created no profiles or
reward writes. No public maintenance flag was toggled.

One immutable pre-update comparison versus the final build used the same
private range / active wave-3 eleven-enemy co-op fixture, Auto/60 cap,
sequential foreground identity contexts in shared Chromium/Metal, and roughly
nine-second warm samples with real fire/reload inputs. No build/tests ran
during these measurements:

| Warm case | Before FPS | Final FPS | Before / final mean draws |
| --- | ---: | ---: | ---: |
| Desktop range | 59.89 | 60.00 | 165.1 / 101.2 |
| Phone-emulated range | 60.00 | 60.00 | 174.8 / 106.8 |
| Desktop co-op | 58.78 | 60.00 | 180.4 / 175.4 |
| Phone-emulated co-op | 60.00 | 60.00 | 157.3 / 153.1 |

p95 remained 16.7-16.8 ms. Baseline desktop co-op had a 200ms frame; the first
completed Christmas pass still measured 58.89 FPS with a 183.4ms frame. Those
adverse results and all earlier Phase 8 stalls are retained; the final faster
sample does **not** close consistent-60-FPS or cold/High pacing acceptance.
Single menu-ready samples (desktop range / phone range / desktop co-op / phone
co-op) were 333/131/111/122ms before and 238/149/125/139ms after: cache-sensitive,
not evidence of a universal loading improvement. Reduced range draws come from
merged plate/ring artwork, not omitted targets or disabled gameplay.
Physical-phone/representative-laptop acceptance, the prior cold/High issues and
the separately blocked durable Azure integration remain outstanding.

### Local arena visual upgrade (not published)

The nine available combat arenas and the practice range now have distinct,
static background architecture rather than repeated skyline pillars:
Foundry workshops and banded stacks; Tundra snowy ridges and a relay radome;
Void's broken research ring; Harbor's loaded cargo vessel; Outpost's desert
installation and ridges; Airfield hangars; Citadel ramparts; Spillway's dam;
Depot's station and freight cars; and a wooded range building. Exterior ground
skirts or quay footings ground the scenery. Snow uses vertex colors on the
same irregular ridge surface, not overlapping caps. The selected-map WebP
photos were recaptured from the actual High-quality scenes.

Existing solid cover gains map-colored numbered stencils, inset corner frames
and base bands. These are cosmetic: all routes, collision, navigation, enemy
rules, destructible holes and rewards remain server-authoritative and unchanged.
Every complete background primitive stays more than two metres beyond the
42-metre playable boundary. Cover paint extends at most about 7 mm beyond its
original collider; roofs, furniture, sandbags and destructible props are excluded.
Christmas decorations and gift targets remain, and archived Wickfall is untouched.
Reduced non-event fill lighting and fog improve directional contrast without
adding another output pass.

The new layer uses two merged, static, matte draw batches per map, with one
shared material and no new textures, lights, shadow casters, physics bodies or
per-frame animation. Lower detail reduces geometry while retaining landmarks;
each High layer has fewer than 20,000 vertices. Tests check deterministic,
distinct geometry, full exterior bounds, rotated cover tolerances, no destroyed
cover overlays, finite vertex data, disposal and detail budgets. Actual High
captures of all ten scenes completed without browser errors.

All **504 tests passed sequentially on Node 22**, followed by the production
build; the existing large-bundle warning remains. Two earlier default-parallel
`npm run check` attempts did not pass: the first timed out in the durable ACK
test, and the second timed out in three network cases. The durable case passed
an isolated retry, and the complete sequential run passed with original
timeouts and guards. Those earlier failures are retained, not counted as passes.

A bounded, sequential immutable-before/current-after Chromium/Metal comparison
used Auto/60 cap, twelve range targets or eleven active co-op enemies, real
fire/reload input and approximately nine-second samples after three seconds
of warmup. No build, test or capture job ran during measurement:

| Warm case | Before FPS | After FPS | Before / after maximum frame |
| --- | ---: | ---: | ---: |
| Desktop range | 60.00 | 60.00 | 16.8 / 16.8 ms |
| Phone-emulated range | 60.00 | 60.00 | 16.8 / 16.8 ms |
| Desktop co-op | 52.42 | 50.81 | 433.2 / 600.0 ms |
| Phone-emulated co-op | 60.00 | 60.00 | 16.8 / 16.8 ms |

p95 was 16.7-16.8 ms, but both desktop co-op runs had six frames above 50 ms
and observed main-thread long tasks. The first comparison was also adverse:
desktop co-op 58.89 -> 54.45 FPS with maximum frames 183.3 -> 683.4 ms;
phone co-op 60.00 -> 59.58 FPS. Its range samples were 60.00 -> 59.89
desktop and 60.00 -> 59.68 phone. These results do not establish the source
of every stall, demonstrate a performance improvement, or meet steady-60-FPS
acceptance. Range draws rose by approximately two; combat draws vary with
visible enemies and effects and are not an equivalent geometry benchmark.
Physical-phone/representative-laptop and cold/High frame-pacing acceptance
remain open alongside the previous Phase 8 limitations.

### Local wrists and firearm detail (not published)

First-person wrists now have a flexible sleeve-to-glove gusset, fitted wraparound
bands with raised edging, dorsal padding and shaped knuckle pads. The gusset
blends forearm and hand skin weights so it follows bent reload poses without a
loose closure tab. The pair still uses two material groups and fewer than
3,000 triangles: 2,924 High and 2,692 Low.

The shared gun builder adds layered ejection ports, selectors, fasteners, small
weapon markings, chamfered vents, stamped magazines, drum spokes, conforming
cheek pads, buttpad grooves and optic mounts/adjusters. Pistols have slide
serrations, shotguns fore-end ribs, the LMG a hinged feed cover and the sniper
a shaped bolt knob. Receivers are slightly lighter, retaining matte surfaces
and existing finishes. No textures, lights, stats, ownership rules, aiming
sockets or reload timings were added or changed.

Details merge into the existing material and moving-assembly buckets; some
guns gain one or two material draws, not a draw for each added piece.
All fourteen models, including archived event guns, stay within the original
ceilings: at most 2,808 High / 1,350 Low triangles and fourteen mesh draws.
Distant enemy guns omit close-up hardware, preserving their original lean
silhouette budget; the event availability gate remains closed.

Final Node 22 `npm run check` passed **505 tests and the production build**.
The first full run exposed a real distant-NPC LOD budget regression; omitting
close-up detail at that LOD fixed it without relaxing the original test.
New cuff checks cover both detail profiles, normalized four-slot skin weights,
finite deformation and wrist attachment through reload poses. Actual-game
desktop High and phone-touch-emulated Auto checks switched, fired, aimed and
tactically reloaded all twelve available guns, plus empty AR-17 reloads.
Repeated warmed rifle/sniper switches kept live buffer/texture/program counts
stable: desktop 590/72/60; phone emulation 540/55/46. No client errors occurred.
Earlier private-fixture failures (missing legitimate sniper ownership metadata
and input before the weapon-switch fire interval) remain retained; production
ownership/cooldown guards were not bypassed or changed.

A fresh immutable-before/current-after Chromium/Metal pair used Auto/60 cap,
three seconds of warmup and approximately nine seconds of real fire/reload
input, twelve range targets or eleven active co-op enemies. All four warm
cases (desktop/phone-emulated range and co-op) measured 60.00 -> 60.00 FPS,
p95 16.7-16.8 ms and maximum 16.8 ms, with no frames above 50 ms.
This short pair is not cold/High or physical-device certification and does
not supersede the adverse arena/Phase 8 measurements above. Those acceptance
limits remain open; the existing production bundle-size warning remains.

### Local snowfall and acoustic lobby music (not published)

Winterwatch now has gentle, non-interactive CSS snowfall in the main menu and
fireteam lobby, plus round, depth-tested flakes in every available arena and
the range. World snow reuses one dynamic buffer and one draw: 40 flakes on Low,
64 on mobile Auto, 110 on desktop Auto and 150 on High/Ultra. It adds one 16px
sprite texture, no lights, collisions or accumulated snow. The Christmas
graphics toggle hides it immediately. System reduced motion, Reduce interface
motion and Reduce camera motion hide falling snow without changing aiming.

The original 88-BPM lobby score uses plucked-string synthesis with a soft
upper melody, not a downloaded song. It starts only after a click, tap or
keypress, continues through staging and stops on deployment, results, hidden
pages, global mute or zero music/master volume. At most eight short-lived
voices play together; notes are cached and finished graphs are released.
Music volume remains separate from effects. **Lobby → Sound settings** opens
the audio controls directly; **Settings → Audio → Lobby & combat music**
controls both scores. There are no third-party music assets or new downloads.

Node 22 `npm run check` passed **507 tests and the production build**.
Desktop High and genuine phone-touch-emulated Auto/Low browser runs exercised
audible output, autoplay gating, mute/master/music controls, staging-to-game
audio handoff, snow draws/live toggles, reduced motion, guarded shots and reloads.
The approximately nine-second warm range samples measured 60.00 FPS,
p95 16.7-16.8 ms, maximum 16.8 ms and no frames above 50 ms. These are short
range samples, not a paired co-op comparison or physical-device certification;
prior cold/High pacing and Phase 8 acceptance remain open. The visibility
handler was exercised with a synthetic browser event, not certified on a
physical backgrounded phone. Initial syntax and private-browser selector
failures are retained; they are not counted as passes.

## Run

Use Node.js 22.

Local player saves, signing secrets, environment files, dependencies and generated
builds are not included in this repository. A fresh checkout creates new local
game data; publishing the code does not deploy or change the live game.

```bash
npm ci
npm run dev
```

Open `http://localhost:5173` in two browser windows, create a room, share its
code, and launch. For a production build:

```bash
npm run build
npm start
```

The production server serves the built client at `http://localhost:3000`.
Useful scripts are `npm test`, `npm run build`, `npm run dev:client`,
`npm run dev:server`, and `npm run check`. Use `npm run check` on a fresh checkout:
the integration tests need the production assets it builds first.

## Persistent public hosting

Cloudflare Quick Tunnel URLs are temporary and expire when the local process
stops. The included `Dockerfile`, `.dockerignore`, and `fly.toml` prepare the
game for a single always-on [Fly.io](https://fly.io/) Machine with HTTPS,
WebSocket support, and a persistent volume. Hosting requires your own Fly.io
account and billing; no permanent public deployment is created by this repo
alone. From the repository root, after installing
[flyctl](https://fly.io/docs/flyctl/install/) and signing in:

```bash
fly auth login
fly apps create last-light-coop-erik-marusan
fly volumes create player_data --region ams --size 1 -a last-light-coop-erik-marusan
fly deploy -a last-light-coop-erik-marusan
fly scale count 1 -a last-light-coop-erik-marusan
fly status -a last-light-coop-erik-marusan
curl -fsS https://last-light-coop-erik-marusan.fly.dev/api/health
```

If that app name is taken, choose a unique name and change `app` in `fly.toml`
and the commands accordingly. Share the resulting `https://<app>.fly.dev/`
address only after confirming the health check and a two-player match.

### Azure Container Apps Express

Public deployment: [Play Deadlight Ops](https://last-light.politesand-4ce673aa.swedencentral.azurecontainerapps.io/).

Use **`/deploy-last-light`** to deploy the current checkout again. The repository
skill launches one coordinated `mai-code-1.1-flash` child session, tracks completion,
builds an immutable image in ACR, and changes only the existing app's image,
preserving its configuration. It includes uncommitted source changes without
switching branches, committing, or pushing. Avoid editing source while its build
snapshot is being taken. Updating the app can interrupt games and erase progress.

The worker checks the live deployment against `npm run build` output with:

```bash
node scripts/verify-azure-deployment.mjs https://last-light.politesand-4ce673aa.swedencentral.azurecontainerapps.io
```

This checks exact HTML/JS/CSS bytes, models/textures, media byte ranges and a real
two-player WebSocket match. It creates two temporary anonymous player profiles,
then disconnects its clients; it does not establish browser rendering or capacity.

The templates in `infra/azure-foundation.bicep` and `infra/azure-app.bicep`
deploy the existing Node/Socket.IO game with anonymous public HTTPS in Sweden
Central. This is a live game container, not the static Blob reader supplied by
the `aca-web-publish` skill. Client assets are bundled in the game image; no
Blob publishing API or storage roles are needed.

**Player data is ephemeral in this deployment.** Express supports `EmptyDir`,
not persistent Azure Files mounts. Scaling to zero, replacing the replica, or
redeploying can erase profiles, progress, and the generated identity signing
secret. Active rooms are always in memory and are lost when the process stops.
Existing local `data/` is not uploaded. Use a durable backend or standard
Container Apps with persistent storage if progress must survive restarts.

Keep the configured maximum at one replica because rooms and profiles are not
shared between processes. HTTP scaling is configured from zero to one replica,
with a concurrency target of 50, not a guarantee of game capacity. An active
WebSocket match requires the live server; scale-to-zero is intended for idle
periods. Express uses a generated `azurecontainerapps.io` HTTPS hostname and
does not support custom domains.

After explicitly approving cloud resource creation and role assignment, deploy
from the repository root with Azure CLI and Bicep:

```bash
az deployment group create -g rg-ema -n last-light-foundation \
  --template-file infra/azure-foundation.bicep
```

Read `registryName`, `registryServer`, `environmentId`, and `identityId` from the
deployment outputs. Build the image in that registry without a local Docker
daemon:

```bash
az acr build --registry '<registryName>' --image 'last-light:<unique-tag>' .
az acr repository show --name '<registryName>' \
  --image 'last-light:<unique-tag>' --query digest -o tsv
az deployment group create -g rg-ema -n last-light-app \
  --template-file infra/azure-app.bicep \
  --parameters environmentId='<environmentId>' identityId='<identityId>' \
    registryServer='<registryServer>' \
    image='<registryServer>/last-light@<verified-digest>'
```

The `.dockerignore` allows only application source, public game assets, build
configuration, and locked dependency manifests. It excludes local player data,
credentials, Git history, deployment settings, and skill files. Registry admin
credentials are disabled; a user-assigned identity has only registry-scoped
`AcrPull`. No administrator player IDs are configured by these templates.

Verify the actual environment reports `properties.environmentMode: Express`,
then check the returned HTTPS URL, `/api/health`, static assets, and a two-player
WebSocket match. Express compute and the Basic container registry are billable;
zero idle replicas do not remove the registry's ongoing cost. These templates
do not create Blob Storage, private endpoints, DNS zones, or persistent volumes.

### Custom domain

The proposed address is `playlastlight.com`. Register it with a domain
registrar before configuring DNS; checking availability does not reserve it.
Once the Fly app is deployed and you control the domain, attach it and obtain
its **actual** DNS instructions:

```bash
fly certs add playlastlight.com -a last-light-coop-erik-marusan
fly certs setup playlastlight.com -a last-light-coop-erik-marusan
```

Because `playlastlight.com` is the root/apex domain, configure the A/AAAA records
reported by Fly at your DNS provider, not an ordinary CNAME. Add any ownership
or certificate-validation records required by `fly certs setup`. Do not point
the domain at a temporary `trycloudflare.com` tunnel. Wait for DNS and the
HTTPS certificate, then verify:

```bash
fly certs check playlastlight.com -a last-light-coop-erik-marusan
curl -fsS https://playlastlight.com/api/health
```

Open the custom URL in two browser profiles and join a shared room before
sharing it. The production client uses the page's origin for Socket.IO, so
HTTPS and multiplayer use the same domain without client changes. A custom
domain does not itself keep the game online: the Fly Machine and persistent
volume must already exist, and the owner must maintain domain registration,
DNS, hosting, and billing. No domain or hosting account is provisioned by this
repository.

Keep exactly one Machine: rooms are in memory and the file-backed profiles are not
replicated. The volume mounts at `/data`, and `DATA_DIR=/data` puts both
`players.json` and the signing secret there, so progress and browser identities
survive restarts. The mounted directory must be writable by the container's
`node` user; container startup assigns that directory to `node`. Back up the
volume: a single volume is not highly available.
Deploying without the volume loses progression; do not copy local `data/`
into a container or publish it. Data from the local preview is not migrated
automatically. Fly.io hosting costs money; confirm its current pricing before
creating the app and volume.

## Single-HTML client export

Build the distributable client and serve it with the existing production
server:

```bash
npm run build:html
npm run serve:html
```

Then open `http://localhost:3000`. The build creates
`html-dist/standalone.html`. **This is the HTML deliverable:** it is a genuine
HTML document containing the compiled game JavaScript in an inline `<script>`
and the game CSS in an inline `<style>`, with no external JavaScript or CSS
bundle references. The modular files in `src/` remain the maintainable source.
The build also copies `html-dist/textures/`
and `html-dist/skies/`; photographic textures and sky panoramas
remain adjacent rather than embedded. Serve the whole `html-dist/` directory;
its HTML and assets must stay together.
`CLIENT_DIST=html-dist` selects this client directory and
`CLIENT_ENTRY=standalone.html` selects its fallback entry.

The HTML file is a single-file **client**, not a serverless version of the
game. It connects to Socket.IO on the same origin and still requires this Node
server for real co-op, identity and progression persistence, enemy simulation,
combat validation, and match authority. Opening it directly with `file://` is
not supported. The normal `npm run dev` and `npm run build` workflows remain
unchanged.

## Controls

- Left click: capture pointer; hold to fire automatic weapons, tap for the Breacher/Kestrel/Atlas
- Right click or Q: hold focus/ADS (sprinting is suppressed while focused)
- Mouse: aim
- Arrow keys: aim/turn (frame-rate independent)
- F or Ctrl: fire (hold automatic weapons; press again for each semi-auto shot)
- W/A/S/D: move
- Shift: sprint
- C: hold crouch (still descends when an authorized operator is flying)
- Space: jump
- R: reload
- E: collect nearby loot, resupply ammo, or recover a Raid cache; hold to revive/hack in co-op
- H: use a medkit (instant 50 HP, maximum 100 HP)
- V: use the selected co-op class ability
- G / Z / X: mark an aimed enemy / nearby ammunition / route ahead
- M: mute/unmute synthesized combat audio
- Enter: create a room, submit a room code, launch as leader, or resume
- Escape: release pointer / open the live field menu

All lobby actions can be completed with the keyboard. Callsign and room-code
fields suppress movement and combat input while focused. Releasing the pointer
opens the tactical pause presentation; simulation remains live because matches
are shared with the squad. Mouse/pointer-lock play remains fully supported.

Forward walk/sprint/crouch speeds are 4.2 / 6.4 / 2.1 m/s. Diagonal input is
normalized, strafe speed is 85% and reverse speed 80%; sprinting does not boost
sideways or reverse-only movement. Phones have separate Sprint and Crouch
toggles. The server validates movement with shared speed limits and stance-aware
collision and corrects position and stance after rejected updates so a delayed packet
does not leave movement out of sync. All held weapons and the soldiers'
role-specific rifles use the same original, human-scale firearm builder:
matte receivers, layered ejection ports, ventilated handguards, steel controls,
receiver markings, optic adjusters and rubber furniture, with detailed box,
drum, top-fed and bullpup magazines.
Static parts are batched by material, with reduced geometry on phones.
First-person sleeves, palms and fingers come from the licensed human rig,
using the same two-bone arm solver as the soldiers instead of capsule hands.
The view rig uses slimmer tapered sleeves and fitted two-tone tactical gloves
with padded knuckles, fitted wrist bands, flexible sleeve-to-glove gussets and
cloth/leather surface detail. Finger poses account
for the source model's natural bend: the trigger finger contacts the trigger,
the support fingers wrap the handguard, and the support hand opens to exchange
magazines instead of retaining the same curled pose throughout a reload.
Wrist targets, palm orientation, magazine paths, optic alignment and charging-handle
travel follow each gun's actual sockets. The support hand turns between its
foregrip and magazine grip during handling. Empty AR-17 reloads take 2.1 seconds on the authoritative server:
the support hand extracts and drops the old magazine, fetches and seats a fresh
one, then works the charging handle. Tactical reloads take 1.65 seconds; the
partially used magazine is stowed, not dropped, and the bolt stays forward.
Both preserve remaining ammunition and are cancelled on death. The HUD and
audio follow the same server-provided timer even when the client's clock differs.
Gun geometry is original procedural artwork, not a photogrammetry or licensed
firearm asset. The anatomical hands retain the human model's CC0 provenance.
Dropped magazines own their geometry and materials, retain their weapon-specific
shape, and use a bounded eight-object pool independent of weapon switching.

Create/join and launch actions appear before the collapsible loadout browser.
Equipped and unlocked guns appear first; locked guns still show how to find them.
The field HUD uses compact, dark-backed health and ammunition panels, a smaller
mission introduction above the aiming area, and keeps diagnostic errors visible
while hiding routine rendering/asset status. Existing keyboard, touch, room and
administrator controls are retained.

### Phone controls

Open the same hosted game URL on a phone; no app installation or pointer lock
is needed. Create or join a fireteam normally. Landscape gives more room, but
portrait is supported, including small 320 px-wide screens.

| Control | Action |
| --- | --- |
| Left stick | Analog movement; further from center moves faster |
| Right-side swipe | Look around without firing |
| Fire | Hold for automatic weapons; tap for the Breacher/Kestrel/Atlas; drag while firing to aim |
| Focus / Sprint | Toggle, so two thumbs can still move and shoot |
| Jump / Reload | Tap to jump or reload |
| Ammo | Tap near a supply container; disabled when unavailable or reserves are full |
| Loot / Objective | Collect nearby drops or recover a cleared Raid cache |
| Heal | Use one medkit for up to 50 HP; shows the carried count, maximum three |
| Revive / Hack | Hold while stationary in clear reach; release to interrupt |
| Class button | Use the selected Medic / Assault / Recon / Engineer ability; shows cooldown |
| Enemy / Ammo ping / Route | Mark an aimed visible enemy, ammunition or walkable route ahead |
| Menu | Adjust look sensitivity, FOV, sound and touch controls; optional fullscreen where supported |

Use the public HTTPS address, or serve on your local network and open the
computer's LAN address from the phone (not `localhost`, which means the phone
itself). The shared mission stays live while the field menu is open.

## Tokens, outfits and loadout

Every server-confirmed NPC elimination credits **6 tokens immediately**, including
before a mission finishes. Completed co-op missions additionally grant
`18 × reached wave`, plus 45 tokens for a five-wave victory. The kill portion is
not paid again at the end. Free-for-All retains its existing completed-match
elimination rewards and gives no XP/tokens when abandoned.

The token balance is visible in the operations menu, staging lobby, combat HUD
and field menu. Open **Outfit shop** in the menu or lobby to buy **Nightwatch
for 120 tokens**, **Copperline for 240**, or **Glacier for 360**, then select
**Equip outfit**. The original **Field Standard** remains free. Outfits are
original cosmetic palettes, not Fortnite assets; they change teammates' character
uniforms and your first-person sleeves/gloves without changing combat stats.
Preview cards show the actual game models. Buying does not auto-equip; equipment
is locked during deployment, including alternate sessions with the same identity.
Guns still come from chests, NPC drops, campaign rewards or administrator grants.

Ownership, equipped outfits and token balances are saved atomically in
`players.json`; existing profiles keep their inventory and acquire the free
outfit. Prices and kills are validated on the server. Tokens cannot be bought
with real money or set through the browser. A failed token save is explicitly
reported and retried; pending NPC rewards retain their room even after disconnect,
block replay/campaign advance and block administrative room closure until saved.
Unsaved rewards remain in server memory and can be lost if the process stops.
Saved purchases survive only while `DATA_DIR` and the identity secret survive;
the public Azure EmptyDir deployment can erase wallets and outfits on replacement.
The Sentinel SR is earned by ordered campaign wins or rare loot, not purchased.

The Breacher has a wider, short-barrel receiver, shell carrier and detachable
box magazine. Its close-range body hit can deliver eight 10-damage pellets;
per-pellet damage falls to 2 by 26 m. The Bastion has a heavier receiver,
large magazine, carry handle and folded bipod. It fires every 105 ms, but
sustained-fire spread, slower focus, and 3.85 s empty / 3.15 s tactical reloads
reward short controlled bursts rather than replacing the rifle in every role.
Both are original procedural designs with different silhouettes and audio.

The Kestrel has a compact suppressor and precise 220 ms semi-auto cadence.
The Mako uses a compact chassis and top-magazine detail, 48 rounds and an
80 ms automatic cadence. The Atlas uses a heavy bullpup-style receiver,
14 rounds, 49/98 body/head damage and a 580 ms semi-auto cadence. The Cyclone
has a 12-shell drum and fires six lower-damage pellets every 410 ms; its cone
and falloff favor close-range sustained fire rather than replacing the Breacher.
All stats, ownership, pellets, reloads and damage remain server-authoritative.

## Campaign

Win **01 Ash Foundry** (level 1), earn enough XP for level 3, then win
**02 Frozen Relay** to receive the Sentinel SR sniper. Earn level 5 and win
**03 Void Garden** to finish the campaign. Map authorization still depends on
XP (500 XP per level), unless an administrator explicitly grants all-map
access, so existing players keep their unlocked maps;
winning later maps out of order gives normal XP/tokens but does not skip
campaign milestones. Each player in a squad is credited individually for a
win only when it is their next operation. A failed match gives XP/tokens but
does not clear an operation. Existing player profiles begin campaign 01
without losing their earned XP or purchased weapons.

**Breakwater Docks is available at level 1**; **Dustline Outpost unlocks at
level 2 (500 XP)**; **Crosswind Airbase unlocks at level 3 (1,000 XP)** and
**Iron Bastion at level 4 (1,500 XP)**. These are independent five-wave side operations. They award
normal XP and tokens without adding campaign milestones, changing the sniper
reward, or extending the original three-operation campaign.

After a victory, the fireteam lead can select **Continue campaign** to move the
same room to the next operation. All participating players must have cleared
the current operation in order and reached the next map's level; otherwise the
results explain who needs a clearance level or earlier victory. The client
reconnects to the staging lobby with the same room code so each arena loads
cleanly, and the room waits up to 30 seconds if everyone reconnects at once.
Deployment waits for the squad to rejoin, or for the 30-second grace period to
end, before the lead can start the next five-wave mission. If clearance is
missing, replay an unlocked operation to earn XP, or return to operations and
select the next available campaign map. Progression and campaign credit are
validated and saved by the server, not by this transition button.

## Admin setup

By default **nobody** has admin access. During a match, open **Settings / the
field menu → Admin login** and enter the credentials configured by the server
operator. The same entry is available under **Operator record** on the operations screen
and in the lobby. Once authenticated, the Operator record shows **Admin panel**
and a **Log out** button for password sessions, so you can reopen the controls
or sign out without entering a match.
Room controls are enabled only after server verification. **Log out** revokes the staff
session without removing your player identity or progression; sessions also end
on disconnect/reload or after 15 minutes. By default, sign-in needs only a
configured username and password; with `ADMIN_SIGN_IN` set to `password+code`
or `code` it also needs one unused, six-digit verification code issued by the
server (see below).
Knowing the shared password, choosing a staff-looking username, or claiming a
role in a network packet does not confer administrator or owner access.

To create a local administrator account, stop the server and run:

```bash
npm run setup:admin
```

Enter a username and password at the prompts; the password is not echoed.
The setup command writes only the username and a randomly salted scrypt password
hash to the private, git-ignored `DATA_DIR/admin-login.json` (default
`data/admin-login.json`), with owner-only file permissions. Restart the server
after setup. Existing credentials are not overwritten automatically. Use a
strong, unique password for public installations; a simple test account should
remain local.

### Individual staff codes and tags

The first owner must be provisioned privately, not through an unauthenticated
web button. Copy that browser profile's **Operator ID** from the operations
screen. With the server stopped, after configuring the password above, run:

```bash
npm run setup:staff -- --player-id <operator-uuid> --role owner
```

The command prints **three different six-digit codes once**. Keep them private
and restart the server. Each code works once. After the configured password
is accepted, a code also works from a different **Operator ID** (for example a
new browser or a reset identity): the code's role moves to the signing-in
identity and the old identity loses it. Allowlisted staff who skip the password
can use only codes issued to their own identity. Because the password and a code
together grant the role, use a strong password and do not share codes in lobby
chat, source, screenshots, logs or deployment contexts. Codes are generated with cryptographic randomness;
only salted scrypt hashes persist in private `DATA_DIR/staff-access.json`.
Invalid-code attempts are limited per identity and to 30 failures per minute
server-wide. If every
owner is locked out, use the stopped-server command above for recovery.

Ephemeral hosts (such as the Azure Express deployment) start without
`staff-access.json`. Generate a private seed instead of writing `DATA_DIR`:

```bash
npm run setup:staff -- --player-id <operator-uuid> --role owner --seed-file <new-private-file>
```

The command prints the three codes once and writes only the salted hashes to
the new file (mode 600). Store its contents as the host secret
`STAFF_ACCESS_SEED`; when the staff file is missing at startup the server loads
the seed. Set a fixed private `IDENTITY_SECRET` secret as well so the Operator
ID survives restarts. Changes made with `?role` or `?codes` last only until the
next restart, and **codes already used work again after a restart** because the
seed is restored. Generate a new seed to replace codes permanently. The seed
contains hashes of six-digit codes, so treat it as a secret.

`ADMIN_SIGN_IN` chooses how the admin panel signs in:

- unset (`password`, the default): only a configured username and password.
  A successful sign-in with any configured account makes that identity an
  **Owner**, from any Operator ID; no code is asked for and the panel hides the
  code field and code-related tools. The password is then the only credential,
  so make it strong and private.
- `password+code`: the configured username and password plus an unused staff
  code, as described above.
- `code`: only a six-digit staff code. The panel hides the username and
  password, and an unused code works from any Operator ID, moving its role to
  that identity. Attempts are limited to five per minute per identity and per
  client address, and to 30 failures per minute server-wide.

The admin panel's **Commands** section uses **?**. **?help** lists all commands:

| Command | Action |
| --- | --- |
| `?help` | Show every supported command in the panel |
| `?fly <player> [on\|off]` | Toggle flight for a living player in combat; Space / phone Up rises, C / Down descends |
| `?ban <player> [length] [reason]` | Ban an account and disconnect its sessions. `length` is optional: `30m`, `2h`, `1d`, `7d`, `2w` (up to 365 days) or `perm` (default). Only owners can ban staff |
| `?ipban <player> [length] [reason]` | Ban an online player's network address (every account on it) with the same lengths |
| `?announcement <message>` | Send a plain-text announcement to every connected player, including menus |
| `?role <player> <role>` | **Owner only:** assign `admin`, `owner`, `developer`, `co-owner`, `co-dev`, or `none` |
| `?codes <player>` | **Owner only:** privately display three new one-use codes; old codes and other sessions are revoked |

Use an exact username, `#` plus the eight-character player tag, or the full
Operator ID. Quote usernames containing spaces, e.g. `?fly "Player Name" on`.
Duplicate usernames are rejected rather than picking the wrong person.
Ban commands require confirmation and create a reviewed moderation record;
use **Active bans** to reverse a ban. Announcements include the sender's
staff role and username, expire after 15 seconds and can be dismissed; their
text is never interpreted as HTML or code. Flight remains server-authorized,
collision-checked and capped at 9.5 metres
eye height; it does not enable teleportation or wall traversal. It ends on
respawn or a new match, or with `?fly <player> off`. Practice has no flight.

Staff tags appear in the lobby, fireteam HUD and above other players in the
world, subject to normal depth occlusion. Only the owner can assign them.
Developer, Co-dev and Co-owner are staff roles, **not** owner permission
shortcuts. Removing a role or rotating codes revokes existing sessions;
the owner rotating their own codes keeps the issuing session so they can
securely record the replacement codes. The last owner cannot be removed
until another owner is assigned. Private codes are cleared when the panel
is closed or the staff session is revoked.

Keep the staff file, password configuration and signing secret together on
durable private storage. **The current Azure deployment is ephemeral**:
replacement, scale-down or restart can erase staff/code records and signed
identities as well as player progress. An existing deployment needs explicit
initial-owner provisioning before this mandatory-verification update is usable;
never ship a default owner or public recovery code.

To rotate an existing local account explicitly, stop the server and run
`npm run setup:admin -- --replace`. The new hash replaces the validated private
credential file atomically. Hosted credentials must be rotated separately in
the host's environment and secret configuration.

Public deployments can instead configure `ADMIN_LOGIN_USER` and
`ADMIN_LOGIN_PASSWORD_HASH` privately through host environment variables/secret
references. Use the generated `passwordHash` value, not a plaintext password.
To support multiple admin accounts, set `ADMIN_LOGIN_CREDENTIALS` to a JSON
array such as `[{"username":"KikiCat","passwordHash":"scrypt:..."}, ...]`.
The legacy single-user environment variables remain supported for backwards
compatibility. No login credentials are shipped in the client or enabled by
default in Azure. Keep credentials and password hashes out of committed source
and deployment build contexts. Invalid or incomplete credential configuration
stops server startup visibly instead of silently disabling authentication.

On the Azure Express deployment, use the app-level ARM `stop` and `start`
actions (`2026-03-02-preview`) after changing credentials so the running
server reloads them. Updating the environment/secret configuration alone
may leave the existing process running with its previous settings. This
restart may erase ephemeral player progress and active rooms.

The existing operator-ID allowlist is still supported. Open the operations
screen and copy your **Operator ID**, then set `ADMIN_PLAYER_IDS`
to that ID (or comma-separated IDs) and restart:

```bash
ADMIN_PLAYER_IDS="your-operator-uuid" npm start
```

Admin status requires a server-assigned staff role and a verified, socket-scoped
session. Allowlisted ordinary admins may verify using their signed identity and
an unused individual code; password-based staff access also requires the
configured credentials. Owners require password verification when configured
and an unused Owner code; a password-verified code moves its role to the
signing-in identity. The password alone is no
longer an owner grant. `ADMIN_PLAYER_IDS` never bypasses individual codes and
does not grant Owner.
Owner access expires with the 15-minute session and is revoked on logout or
disconnect; reconnecting requires signing in again. Password verification uses
timing-safe comparisons; attempts are limited
to five per minute per connection address, including across reconnects, with
bounded concurrent verification work. A reverse proxy may cause several users
to share that address. Logging out also revokes code-verified allowlist sessions;
sign in again with an unused code.
Admins can refresh a room list, remove
individual participants, or close a room; closing disconnects its participants
without awarding unfinished-match completion bonuses (already-earned NPC tokens
remain saved). Removing a participant does not
delete their server-side progression. Keep identity tokens private: possession of an
admin's token confers that identity's privileges. Configure the environment
variable privately on a host; do not publish a real admin ID/token in the repo.

Signed-in admins can also use **Join active** in the room list, or enter a
running room's code normally, to join as a playing teammate during combat or
the between-wave countdown. Admission is validated server-side and audited,
with a fresh protected spawn and the admin's existing equipped weapon; it does
not restart the wave, reset other players or award an immediate reward.
Clearance is bypassed only for this administrative admission, not permanently
granted to the profile. Guests, logged-out password sessions and duplicate
copies of an operator cannot enter a running match. Already-present admins
cannot rejoin to refill ammo or renew protection. Switching from another
mission requires confirmation and leaves its unfinished rewards behind.
Ended matches and reserved campaign reconnection lobbies retain their existing
restrictions.

### Profile controls and logs

The **Admin panel** is one player-control workspace, with your own profile
selected automatically when you first open it. Search by partial username or
ID to select another player, including offline records; **My profile** returns
to your own record. Search results are paginated. Compact player cards show
level, gun/map counts and tokens; expand **Full profile & player ID** for the
complete ID, inventory and match history. **Apply level** assigns absolute
XP for that level (starting at 1), bounded by JavaScript's exact safe-integer XP
range. **Guns only**, **Maps only**, and **Unlock all guns & maps**
save explicit server-side grants; they do not fabricate campaign wins.
Grants include future catalog additions and survive subsequent rewards/level
changes. Changes update all connected copies of the selected profile; an
active-match weapon and ammo are not replaced. Equip the desired gun in a
staging lobby or before the next deployment. Each mutation needs confirmation
and is audited before application. Neither grants nor high levels grant admin
permissions.

**Rooms** and **Activity & anti-cheat** expand inside the same panel, so
moderation and logs remain available without crowding the main controls.
Activity logs are administrator-only, filtered and paginated.
The last 1,000 entries are held in `DATA_DIR/audit.json`, with owner-only
permissions; noisy equivalent rejections aggregate within five seconds.
Authentication events, moderation, profile views/searches, progression changes,
invalid/forged commands, rate-limit rejections, invalid aim/fire cadence and
rejected movement are recorded without plaintext passwords, password hashes,
identity tokens, IP addresses or raw command payloads. Administrator mutations
fail visibly if their pre-action audit cannot be persisted. Rejection logs
are batched to disk and flushed on graceful shutdown.

Anti-cheat enforces authoritative ownership, damage, ammo, range, cover,
movement/shot rules and bounded per-socket command rates. Packets exceeding
16 KiB are rejected by Socket.IO. Unauthorized admin commands and malformed
input are rejected before handlers run. A movement rejection can also reflect
latency or a client collision disagreement; logs are evidence for review,
**not proof of cheating**. The game does not automatically ban players, scan
their devices, or claim to detect every aimbot or modified client.

### Report-linked bans

In **Player reports**, administrators can explicitly confirm **Ban player** or
**IP ban** after reviewing the evidence. Reports do not punish anyone automatically.
Player bans block that signed operator identity; clearing browser storage can create
a different anonymous identity. IP bans block the exact captured address across
identities, not an entire subnet; VPNs, changed addresses and shared carrier networks
limit their accuracy. The confirmation warns that innocent players sharing a network
may also be blocked. Connected matching players are removed immediately, and new
connections are refused before profile creation. Each report ban has a length
(permanent, 1 hour, 1 day, 3 days, 7 days or 30 days) and an optional reason;
without a reason the report's text is used. Temporary bans end on their own;
any ban can be removed early under **Active bans**, and removing one does not
remove another overlapping ban.

Banned players see a full-page ban screen, both when they are removed from a
match and whenever they reopen the game. It says whether the ban is temporary,
permanent or an IP ban, shows the moderator's reason and when it was applied,
and for temporary bans shows the end time, a live countdown and a **Try again**
button that unlocks when the ban ends. The screen never reveals who reported or
banned the player.

The ban screen's **Contact / Appeal ban** button opens a private form asking why
the player should be unbanned (10-1000 characters). It works without a game
connection: `POST /api/ban-appeals` matches the signed browser identity or the
verified connection address to an active ban, never a caller-supplied target or
ban ID. Submissions are limited to five attempts per minute per address and one
appeal per ban, including after review; retrying does not create duplicates.
IP appeals concern the shared address, not proof of the sender's identity.

In **Admin panel > Ban appeals**, signed-in administrators can read open
requests, **Approve & unban**, or **Reject appeal**, and view reviewed requests.
Approval removes only the appealed ban; overlapping bans remain active.
Rejection leaves the ban in place. Players can use **Check ban status** after
submission to reload and check whether access has been restored, even before
a temporary ban's scheduled end. Appeals do not automatically grant access.
Private `DATA_DIR/ban-appeals.json` keeps up to 500 requests and their ban
context, explanations, decisions and reviewer IDs/times. At capacity, reviewed
requests are displaced first; open requests are never silently discarded.
On the current ephemeral Azure host these records can be erased on restart,
replica replacement or scale-to-zero, just like bans. Do not include passwords
or personal information in appeals.

Ordinary administrators cannot ban configured/connected administrators or a
player who was an administrator when the report was submitted. Only the private
owner login can confirm these bans, including after a reported administrator
disconnects. IP bans shared with connected administrators also require the owner.
Self-bans and IP bans shared with the acting owner's/admin's own connection are
always refused. A banned administrator cannot reconnect or sign in using that
banned identity/address; another unbanned owner session or operator intervention
is needed for recovery. Banning an identity does not remove an allowlist entry
or rotate the private shared owner credentials.

The server captures a keyed address hash when a report is submitted, so an
administrator can act after the reported player disconnects. Old reports without a
captured address retain player-ban controls but disable IP banning explicitly.
Raw IP addresses are never stored or returned to administrators. Private
`DATA_DIR/bans.json` holds up to 5,000 active bans, without silently evicting bans;
`DATA_DIR/moderation-secret` keys address hashes and must be kept with the reports
and bans across restarts. Owner-only files are written atomically; storage or audit
errors reject the operation visibly. These records survive only while `DATA_DIR`
survives: the existing Azure EmptyDir deployment can erase bans and reports on
restart, replica replacement or scale-to-zero.

Address resolution ignores client-supplied forwarding headers in direct/local
hosting. Azure Container Apps (identified by its platform-provided
`CONTAINER_APP_NAME` and `CONTAINER_APP_ENV_DNS_SUFFIX`) uses only the rightmost
`X-Forwarded-For` address appended by its managed ingress, never earlier spoofable
values. `CLIENT_IP_SOURCE=direct|azure` explicitly selects either deployment mode.
Only use `azure` behind that ingress with no direct access to the Node port. Other
reverse proxies need a separately verified address policy; do not treat their
shared proxy address as the player's address. Missing/invalid Azure headers disable
IP bans for that report rather than banning the proxy.

## Privacy

Read the [in-game privacy policy](public/privacy.html) for browser/server data,
room visibility, storage, retention and hosting considerations. The same page
is available at `/privacy.html` when the client is served. Clearing browser
storage loses access to the old player ID but does not delete the server record.

## Field settings and quality

The Escape field menu provides mouse sensitivity, base field of view, a
saved **Graphics quality** choice (Auto, Low · battery saver, High · full
scenery detail, Ultra · desktop only), a saved
120 FPS high-refresh or 60 FPS balanced target, a live FPS/browser-cadence readout, audio mute, and
a complete controls reference. Sensitivity and FOV are saved in browser local
storage; mute already persists there as well. Focus/ADS scales sensitivity and
narrows the selected base FOV rather than replacing it.

The HUD reports live command-link state and tactical-opponent readiness.
Asset, network, and unexpected runtime failures remain visible as warnings
instead of silently falling back. Opponents are generated from original source
geometry, with no character-model download or external animation dependency. Reduced-motion
preferences suppress UI animation without forcing low-resolution rendering;
`?quality=low` explicitly selects the lighter graphics profile. Adaptive mode
retains photographic color, normal and roughness surfaces on both PC and phone.
It adjusts resolution to the selected frame budget, bypasses expensive
postprocessing before disabling shadows, and gradually restores quality when
headroom returns. The default is a **120 FPS target**, not a performance guarantee:
120 FPS requires a 120 Hz (or faster) display, a browser allowing that refresh
rate, and sufficient CPU/GPU performance. Set high refresh in the device's OS
and disable battery-saving refresh restrictions if appropriate. A 60 Hz browser
is budgeted for 60 Hz rather than blurred trying to reach an unavailable 120 Hz.
The cadence readout is a browser timing estimate, not a hardware display query.
`?fps=60` or `?fps=120` overrides the saved target when opening the page.
High with a 60 FPS target retains fixed quality; High with 120 FPS remains adaptive.
Rendering follows native `requestAnimationFrame`, with no artificial 60 FPS cap;
physics and multiplayer tick rates remain independent of display refresh.

### Scene detail

Each quality level also selects a scene-detail level (Low 0, Auto on phones 1,
Auto on desktop 2, High/Ultra 3). Phones can choose High for full scenery
detail while still skipping shadows and postprocessing. The choice is stored in
browser local storage; a `?quality=` link overrides it for that visit and a
change applies after reloading. Detail controls:

- Per-arena ground dressing generated deterministically from the map layout:
  rubble and brick piles against cover, gravel, wind-swayed grass, snow drifts,
  void crystals, rope coils, scrap, paper litter, oil and water stains, cracks,
  tyre tracks, scorch marks and brass on the range firing line. Dressing is
  ankle-height, non-colliding, kept out of cover, buildings, ramps, terrace
  edges and the range lanes, and drawn as instanced matte meshes.
- Near-camera ambient dust, snow, embers, pollen or spores (rain maps keep their rain).
- Bullet marks on the exact face of cover the server reported, muzzle smoke,
  and spent casings that rest on the ground before being recycled.
- Weapon hardware (grip stippling, sights, flash hiders, gas blocks, sling
  swivels and weapon lights) and enemy knee pads, magazine pouches and radios.

Server collision and shot occlusion for rotated cover use the same orientation
as the rendered meshes.

## Surface assets

The locally bundled 1K diffuse, OpenGL normal, and roughness textures for
[Concrete Floor Worn 001](https://polyhaven.com/a/concrete_floor_worn_001),
[Snow 02](https://polyhaven.com/a/snow_02),
[Rocky Terrain 02](https://polyhaven.com/a/rocky_terrain_02), and
[Rusty Painted Metal](https://polyhaven.com/a/rusty_painted_metal), and
[Factory Wall](https://polyhaven.com/a/factory_wall) are
[Poly Haven CC0 assets](https://polyhaven.com/license). They tile by world
dimensions on the floor, cover, and arena walls. The textures are
self-hosted; gameplay does not depend on an asset CDN.
The same CC0 terms cover the bundled 1K HDR skies:
[Industrial Sunset 02 (Pure Sky)](https://polyhaven.com/a/industrial_sunset_02_puresky),
[Snow Field (Pure Sky)](https://polyhaven.com/a/snow_field_puresky), and
[Wasteland Clouds (Pure Sky)](https://polyhaven.com/a/wasteland_clouds_puresky).
The bundled JPEG versions of those same CC0 panoramas are used on phones,
avoiding HDR downloads while retaining cloud detail.
The procedural gradient remains as a fallback if a sky
cannot load. Painted cargo containers use a neutralized version of the bundled
metal photograph so their individual paint colors remain readable.
The outpost ground uses a neutralized, sand-tinted version of the rocky terrain
photograph rather than retaining the original green patches.

## Progression and maps

XP, matches, and kills are stored in `data/players.json` locally, or
`$DATA_DIR/players.json` when that variable is set. A generated browser
identity is bound to an HMAC-signed server token; map access is always checked
server-side. Levels require 500 XP each. **Ash Foundry** unlocks at level 1,
**Frozen Relay** at level 3, and **Void Garden** at level 5. Match rewards scale
with reached wave, eliminations, and victory.

## Architecture

- `src/`: Vite/Three.js first-person client, Cannon ES physics, deterministic
  procedural maps, responsive lobby/HUD/states, original articulated tactical
  opponents with cloth uniforms, plate carriers, helmets, faces, boots,
  map/wave equipment variants, target-facing attacks, shared teammate-hit
  reactions, stagger/attack/death reactions, useful-only
  distance-faded health indicators, believable rifle inertia, ADS and recoil,
  synthesized ambient/combat/movement Web Audio, a persistent compact field
  menu, contact bearing and expanded after-action reporting, plus a responsive
  briefing/fireteam interface with
  original procedural map previews, map-specific lighting and fog, soft
  shadows, matte diffuse materials, optional high-quality bloom,
  neutral ACES tone mapping, and pooled/reusable rendering resources. Arenas
  use locally bundled photographic PBR textures with generated CanvasTexture
  fallbacks plus distinct foundry tanks,
  gantries and pipes; tundra crystals, relay towers and snow banks; or void
  monoliths, shards and energy rings.
  `touch-controls.js` isolates multi-pointer ownership and analog input;
  `graphics.js` budgets rendering by device; `arena-visuals.js` builds the
  military arenas using instanced detail and shared cover descriptors.
  `tactical-enemies.js` shares original character geometry while keeping
  skeletons, weapon grips, animations, and hit responses independent.
- `server/`: Express + Socket.IO rooms, signed identity, token/loadout
  persistence, 20 Hz
  authoritative enemies, deterministic cover avoidance/sliding and separation,
  line-of-sight close-range combat, authoritative head/body hit resolution,
  validated aim and deterministic movement/burst spread, brief redeploy
  protection, waves, death, replay, and respawn; `anti-cheat.js` validates
  command schemas/budgets, `audit.js` stores private bounded logs,
  `enemy-tactics.js` handles contacts, cover reservations, squad flanks and
  callouts; `enemy-director.js` controls bounded build-up/peak/recovery pressure.
  `shared/enemy-ai.js` defines canonical tactical tiers, roles and caption text;
  `src/enemy-comms.js` selects nearby unexpired captions without extra meshes.
- `shared/`: progression, weapon definitions, cached deterministic arena
  descriptors, cover collision/ray rules, and gameplay balancing shared by
  browser, server, and tests
- `test/`: Node test runner coverage for progression, unlocks, ray hits,
  deterministic map collision/traversal, enemy cover/LOS/separation and spawn
  protection, movement, authoritative head/body damage and aim rejection,
  reloads, buckshot aggregation/falloff/cover, side-arena spawn accessibility,
  multi-touch input, semi-auto triggers, graphics budgets, scaling, after-action
  progress details, unlock deltas, rewards, administrator grants/search/log
  permissions and persistence, rejection budgets and all weapon optics

The server owns health, ammo, enemy simulation, hits, match state, rewards, and
map authorization. Client movement runs in a Cannon ES compound capsule body at
a fixed 60 Hz step, interpolated into `requestAnimationFrame` rendering. The
physics world includes gravity, floor, arena walls, and the exact shared cover
layout rendered by Three.js. Physics catch-up is capped at 100 ms to avoid
long frame stalls recursively triggering dozens of extra collision steps.
Pixel ratio is capped, shadows use a bounded 1024px adaptive / 2048px high-quality
map, static geometry/materials are reused, and network movement is throttled.
Sun shadows refresh at up to 30 Hz independently of rendering. Interior lighting
uses one reusable local light, not a separate shader light for every building.
Interior floors, signs and skyline surfaces are batched rather than rendered
once for every building.
Sweep-and-prune collision broadphase avoids repeatedly comparing every static
wall pair. Awareness HUD updates run at 20 Hz; aiming and render interpolation
continue on every display frame. GPU timing uses asynchronous timer queries
where available and never waits for the GPU.

The foundation pass avoids rebuilding unchanged ammo, squad and loadout markup;
changing reload progress and expanded loadout drawers still update normally.
Resting player capsules can sleep, with explicit wake-up for movement, stance,
jump, corrections, respawn and authorized flight. First-person hand posing no
longer traverses the old skeleton pose before the renderer traverses the new
one. Non-military perimeter walls share one visual geometry while retaining all
four original collision bodies and their world-scaled UVs. Moving and turning
retain the existing packet throttle and send a final stopped snapshot so
server-owned firing spread settles promptly; stationary players then send a
250 ms heartbeat instead of repeating identical movement snapshots. These are local changes,
not a claim that the public deployment or physical-device FPS has changed.

Desktop adaptive rendering uses hardware antialiasing, soft sun shadows,
instanced soft contact shadows, detailed soldiers and photographic surfaces.
Cover has subtly rounded edges and world-scaled texture coordinates. The docks
have visible corrugations, cargo frames, crane bracing and irregular wet patches;
the outpost has continuous, shaded desert ridges instead of cone-shaped mountains.
Visual cover stays inside the shared collision bounds and the ridges remain
outside the playable area.
Weapons use shared human-scale geometry, matte painted metal and open optic
housings instead of oversized receivers and solid metal end caps.
It draws directly without postprocessing, at no more than 1.5× pixel ratio and
a 2.5-megapixel framebuffer budget. Phones automatically use compact geometry,
photographic color/normal/roughness textures capped at 512px, lightweight JPEG sky
backgrounds, and animated soldiers only at close range. They retain a maximum
1× ratio and a one-megapixel budget, without HDR downloads,
dynamic shadows, extra scenery lights or bloom. All guns retain mipmapped
micro-finish maps for brushed metal, painted parts and matte polymer; contact
shadows fade softly and instanced wall-base grime grounds cover and interiors.
First-person arms use dark arena-adapted camouflage sleeves, matte two-tone
gloves, shaped flexible wrist cuffs and raised wraparound band edging. Their licensed anatomical
rig and finger contact points stay unchanged; the entire pair remains under
3,000 triangles and two material draws, including cuffs and stitching.
Explicit Low and devices with no more than two cores or 2GB reported memory
retain procedural assets; explicit High can override that hardware fallback.
Sustained overload of the selected display-relative budget (8.33 ms at 120 Hz)
reduces resolution, then expensive passes and distant soldier detail, with a
65% resolution-scale floor and slow quality recovery. Loading spikes and hidden
tabs do not trigger degradation. The server caches deterministic cover geometry
and rotations; it simulates combat at 20 Hz but broadcasts state at 10 Hz during
play and 2 Hz in the lobby to reduce work and bandwidth. Add `?quality=high`
to opt into a maximum 2× ratio, a 5-megapixel budget, 2048px sun shadows, and
restrained bloom/SMAA on desktop. On phones, High restores detailed assets but
keeps shadows and postprocessing off and caps rendering at 1.5× / 1.8 megapixels.
Use `?quality=low` to force a maximum 0.75× ratio / 800,000-pixel budget and
compact geometry, debris and atmosphere. Reduced-motion preferences limit
interface animations. Isolated loading or shader-compilation stalls no longer
trigger a permanent resolution reduction.
Performance remains device-dependent; no fixed frame rate is guaranteed.
Surface textures are bundled locally.

## Tactical opponents

Hostile characters use [**3D male by Drummyfish**](https://opengameart.org/content/3d-male-0),
a creator-published, manually modeled CC0 human with natural proportions and a
39-joint rig, replacing the previous superhero base. Its prepared geometry is
bundled as `public/models/tactical-body.json` and `.bin`. The creator's 1024px
diffuse texture is retained as `tactical-skin.jpg` for exposed facial anatomy,
with separate cloth, hardware and lens materials; it is not painted over as fabric.
Provenance is recorded in `public/models/LICENSE-tactical-body.txt`.
No Sketchfab or Epic account is needed.
The winter-operator outfit is original: pale padded jackets with a contrasting
yoke and collar, mottled snow-camouflage trousers and helmets, blue-lensed goggles,
fitted face coverings, backpack webbing, cargo pockets, gloves and shaped boots.
The outfit is fitted to the new human anatomy, with padded clothing surfaces and
boots aligned to the new foot joints. Sleeve padding follows each arm's
anatomical axis without stretching the joint chain; the jacket zipper follows
the actual cloth surface and inherits its skin weights. Shared generated cloth
textures provide restrained weave, with normal and roughness detail on desktop;
phones omit those extra texture passes.
This is a budgeted sculpted reconstruction, not a photogrammetry asset or an exact
copy of another game's character.

Skirmishers carry shorter rifles and radios, sentinels carry larger optics and
folded bipods, and brutes have gunner weapons, chest protection and extra pouches.
Both hands follow their rifle grips, fingers curl around the weapon, and rifles
sit across the chest at idle before lifting into a forward shoulder-aiming pose
for windup and firing. Visible tracers start at the rendered muzzle; server-side
damage and line-of-sight calculations remain authoritative and unchanged.
Leg articulation keeps supporting boots grounded.
Visible head centers match the existing authoritative head targets at rest:
1.9 meters for regular opponents and 2.1 meters for brutes. Combat rules and
enemy behavior are unchanged.

Desktop, phone Adaptive, and explicit Low share the same character proportions
and forward direction. Compact models reduce geometry, and distant opponents
use a single-draw-call version of the same pose, preserving helmets, goggles,
and equipment without a reversed-facing LOD switch. Detailed opponents share
geometry and fabric textures but own their skeletons and reactive materials;
replacing a model releases its skeleton texture without disposing shared assets.
The unused Three.js example model has been removed. Its previous Quaternius/CC0
attribution was incorrect; no part of that model or its animations is used by
the new opponents.

To reproduce the human assets, download the original `.blend` linked by the
creator's page and use an official Blender installation offline:

```sh
blender --factory-startup --background --disable-autoexec /path/to/male_3d.blend \
  --python-exit-code 1 --python scripts/prepare-realistic-body.py -- /path/to/staging-directory
```

The converter checks the original file's recorded checksum and expected rig, retains texture coordinates and skin
weights, normalizes ground/head placement, and prepares a one-level subdivision
near mesh plus the original lower-detail mesh. It ignores optional facial morphs;
runtime animation is skeletal. Inspect staged output before replacing the three
`tactical-body.json`, `tactical-body.bin`, and `tactical-skin.jpg` files in
`public/models`. Do not enable automatic execution in third-party Blender files.

The visual direction favors natural daylight, realistic material response,
neutral color, short tracers, small impact dust, and subtle health feedback.
Bloom, emissive scenery, sparks, muzzle effects, and explosive death effects
are deliberately minimized.

The server independently samples movement paths against the same deterministic
oriented cover boxes, preventing clients from tunneling or walking through
obstacles. Server ray tests also prevent shots from damaging enemies through
cover.

## MVP limitations

Persistence is a local JSON file and identity recovery is tied to browser
storage; keep both the data directory and the generated signing secret on
persistent storage, or configure a stable `IDENTITY_SECRET`. Movement is
client-predicted without reconciliation/rewind, and there are no accounts,
matchmaking, or in-process TLS (the deployment proxy terminates HTTPS).
One Node process owns all rooms, so horizontal scaling would require a
shared Socket.IO adapter and database.