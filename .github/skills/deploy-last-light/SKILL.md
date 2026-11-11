---
name: deploy-last-light
description: Deploy or redeploy this Deadlight Ops game (formerly Last Light) to its existing public Azure Container Apps Express instance. Starts one small-model child session, builds a privacy-safe immutable image in ACR, preserves app configuration, verifies live assets and two-player WebSockets, and reports back.
---

# Deploy Deadlight Ops

Target: `rg-ema`, Sweden Central, app `last-light`, environment `last-light-env`,
registry `lastlightxwybgmnmy3ons`. Public, anonymous HTTPS; HTTP min 0/max 1.
Deploy the real Node/Socket.IO game, not the `aca-web-publish` static Blob proxy.
Player progress, signing identities and rooms are ephemeral; replacing or
stopping the replica can erase them. Compute and Basic ACR remain billable.

## Coordinator

Do not deploy while merely creating/reviewing this skill. A deployment request
authorizes updating the existing app, not creating resources or changing access.

1. Check `list_sessions_and_chats` and `get_sessions_status`; do not launch a
   duplicate deployment. Inspect a matching session before reusing it.
   The user requires maintenance during changes: before editing game source,
   enable and confirm `node scripts/azure-maintenance.mjs on`. Do not stop the
   app. The first rollout installing maintenance support is the only bootstrap
   exception. Revision changes still carry the existing ephemeral-data risk.
2. Announce one small-model deployment child. Use `create_session` with the
   current `project_id`, `workspace_type: "branch"` (same checkout, including
   uncommitted changes), **omit `base_branch`**, `coordinate_with_creator: true`,
   `notify_on_idle: "once"`, and `kickoff` with `model: "mai-code-1.1-flash"` and
   `mode: "autopilot"`. Pause source edits until its build snapshot is taken.
3. Give a standalone kickoff: "You are the deployment worker. Read AGENTS.md and
   .github/skills/deploy-last-light/SKILL.md, follow Worker only, and do not spawn
   children. Deploy the current checkout to the target defined there. Do not
   switch branches, commit, push, or change game code. Report URL, previous/new
   image digest, live verification, and blockers to your creator using
   send_session_message." Include the user's exact request separately.
4. Link the child using its exact `app_url` from `list_sessions_and_chats`.
   Track through idle notifications; do not poll/sleep or mistake idle for
   success. On notification, inspect `get_session` and the worker's report.
   Resolve genuine decisions with the user; never archive the child automatically.

## Worker

Execute once; no further delegation. Use existing Azure CLI login. Keep logs,
JSON snapshots and build staging in this session's artifact directory, not Git.
Never print credentials/tokens or upload local player data.

1. Preflight: inspect `git status`, active Azure subscription, installed CLI,
   and npm registry. Read `last-light-foundation` deployment outputs in `rg-ema`;
   require the expected registry, environment and user-assigned identity.
   Use that subscription explicitly on Azure commands; do not switch the global
   account. Verify actual `environmentMode: Express`, region, admin-disabled
   ACR, external HTTPS/port 3000, single `game` container, and HTTP min 0/max 1.
   Missing resources, configuration drift or concurrent publishing: stop and
   report; do not provision or silently change hosting/auth/scaling.
2. Confirm maintenance is enabled before checks/builds with
   `node scripts/azure-maintenance.mjs on`; this is the only authorized env
   change. On the first bootstrap, if `/api/maintenance` does not yet exist,
   skip the unsupported command and set `MAINTENANCE_MODE=true` alongside the
   new image in step 5. Do not claim the old build is locked in that case.
   Run `npm run check`. Restore locked dependencies with `npm ci` only if
   dependencies are missing; keep the approved registry and lockfile.
   If the approved feed differs from the Docker build's feed, stop, never bypass.
3. Snapshot the previous image and full app template. Build a dedicated context
   containing ONLY `Dockerfile`, `.dockerignore`, `package.json`,
   `package-lock.json`, `index.html`, `vite.config.js`, `src/`, `server/`,
   `shared/`, `public/`. Reject links; exclude hidden descendants. Never build
   from the checkout directly: Azure CLI can choke on Git's daemon socket.
4. `az acr build --registry lastlightxwybgmnmy3ons --platform linux/amd64
   --image last-light:<unique-UTC-tag> --no-logs <staging>`.
   Require a successful run; save its build log. Resolve the resulting digest
   using `az acr repository show`; deploy `registry/last-light@sha256:...`,
   never a mutable tag. Save previous/new digests before updating.
5. Use ARM API `2026-03-02-preview`: GET the app, compare its template to the
   snapshot to catch concurrent edits, then PATCH **only**
   `properties.template` copied from the live app, changing `game.image` and
   removing `revisionSuffix`. Keep `MAINTENANCE_MODE=true` until readiness.
   Preserve all other env (including the `IDENTITY_SECRET` and
   `STAFF_ACCESS_SEED` secret references and `ADMIN_SIGN_IN`), secret references, probes, volumes,
   identity and configuration. Do not reapply the bootstrap Bicep to an
   existing app. Limit provisioning/health retries to 10 minutes; do not trust
   ARM alone.
6. Discover the actual ingress origin. While maintenance is on, require a 503
   interactive waiting-room entry page and its `/maintenance-range.js` asset,
   healthy `/api/health`, `/api/maintenance` enabled, and a
   WebSocket `connect_error` with code `MAINTENANCE` (no identity or gameplay).
   Once the finished image and revision are healthy, reopen with
   `node scripts/azure-maintenance.mjs off`. This changes only the flag and may
   create another revision; wait for its actual readiness too. Then run
   `node scripts/verify-azure-deployment.mjs <https-origin>`.
   This requires the current local production build and checks its exact bytes,
   media ranges, a real two-player WebSocket match and denied admin access.
   Do not claim browser rendering, load capacity or observed idle scale-to-zero.
7. If the update fails verification, enable maintenance again and report failure;
   restore the previous image
   with the same configuration-preserving patch only if no other operator has
   changed the app. Verify rollback health and image; never claim it restores
   erased player data. Keep maintenance enabled on failure unless the user
   explicitly directs reopening; report if a pre-maintenance rollback image
   cannot enforce it. Retain recovery evidence on failure; clean build staging.
8. Send one completion/blocker report to the creator: URL, image digests, Express
   and scaling evidence, smoke result, rollback if any, ephemeral-data warning,
   costs. Include the current release title/changes from `src/release.js` for the
   user's post-update summary. No success claim until the new digest and live verification both pass.
