# Deadlight Ops

Online co-op browser shooter. JavaScript ES modules, Vite, Three.js, Cannon ES,
Express, and Socket.IO. Use Node.js 22 and npm from the repository root.

## Commands

- `npm ci` - install locked dependencies.
- `npm run dev` - client at `localhost:5173`, server at `localhost:3000`.
- `npm run check` - production client build, then Node tests.
- `npm run build && npm start` - serve production at `localhost:3000`.
- `npm run build:html && npm run serve:html` - standalone HTML client export.

## Layout

- `src/main.js`, `src/style.css` - client rendering, physics, networking, and UI.
- Other `src/*.js` - testable client helpers.
- `server/` - room lifecycle, authoritative gameplay, identity, admin, persistence.
- `shared/` - rules, weapons, progression, and deterministic collision helpers.
- `test/` - Node unit, persistence, and Socket.IO integration tests.
- `public/` - models, textures, skies, and privacy policy.
- `README.md` - detailed setup, features, asset licenses, and deployment.

## Basics

- Combat, rewards, progression, and permissions are validated server-side.
  Keep client/server rules and network payloads consistent.
- Profiles and signing secrets live in `DATA_DIR` (default `data/`).
  `IDENTITY_SECRET` overrides the generated secret. Staff roles and hashed
  one-use codes also live in `DATA_DIR`; `ADMIN_PLAYER_IDS` does not bypass
  individual code verification. Never publish secrets, codes, or player data.
- Use separate browser profiles when testing distinct multiplayer identities.
  Builds/tests alone do not verify gameplay, visuals, or frame rate.
- Edit source rather than generated `dist/`, `html-dist/`, or `node_modules/`.
  Add relevant tests and update documentation when behavior changes.
- Current owner-directed workflow: keep public gameplay running during local
  development. Do not toggle maintenance, restart/stop the app, deploy, or migrate
  production storage without explicit approval. Complete, check and report each
  improvement phase before starting the next. Azure revision changes can erase
  current ephemeral data and active rooms; maintenance is not a backup.
- Owner-only update previews use `HOST=127.0.0.1`, isolated `DATA_DIR` and no
  production credentials. Do not add a public maintenance bypass. Halloween
  event content ends only when the owner requests it; collected event guns
  cannot be used after the event. Keep availability gates server-authoritative.
- For each published update, update `src/release.js` with a new release ID and
  accurate shipped changes. Preserve the in-game What's new panel and summarize
  the changes in the user-facing deployment result. The maintenance target
  challenge is browser-only entertainment, never real XP or ranked progress.
- The HTML export still needs the Node server and adjacent asset folders.
  Production sockets use the page's origin; `/api/health` checks server readiness.
- Use `/deploy-last-light` for Azure deployment/redeployment: one coordinated
  small-model child, current checkout, Express, public HTTPS, ephemeral data.
  The worker verifies exact built assets and live two-player WebSockets.
- `Dockerfile` also supports `fly.toml` with persistent `/data`. Both hosts need
  one instance and in-memory rooms; static hosting alone cannot run co-op.
