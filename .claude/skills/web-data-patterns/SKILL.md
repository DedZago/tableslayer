---
name: web-data-patterns
description: Data-layer patterns for apps/web — apiFactory error semantics, mutationFactory/handleMutation, drizzle schema conventions, the Y.js/PartyKit realtime model (no save pipeline!), auth, R2 uploads, Stripe, email, env vars. Load when adding/changing API endpoints, queries/mutations, schema, realtime behavior, or server logic in apps/web.
---

# apps/web data & server patterns

> **Freshness**: last verified 2026-10-18.
> Authoritative deep-dives (verified current): `docs/yjs-sync-architecture.md`, `docs/undo-redo-architecture.md`, `docs/grid-system-architecture.md`, `docs/playwright-testing-guide.md`. Prefer them over re-deriving.
> Anchor files at the bottom — if one is missing/renamed, the code wins; update this skill.

## apiFactory (every /routes/api endpoint — CLAUDE.md C-5)

Defined in `apps/web/src/lib/factories/apiFactory.ts`. `apiFactory<Body>(handler, { validationSchema, …messages })` — zod-validates the JSON body, hands the handler `event & { body }`, JSON-serializes the return.

**Error semantics (load-bearing):**

- `throw new Error('Unauthorized')` — the **exact string** — → 401. This is the canonical auth-fail idiom inside handlers.
- `ZodError` → 400 with `errors: issues`.
- `AppError` (from `src/lib/errors.ts`) or plain `Error` → 400, message surfaced, **not** sent to Sentry.
- Anything else → 500 + `Sentry.captureException`.
- Response shape is always `{ success, status, message, errors? }` — `FormMutationError` on the client matches it.

Canonical endpoint (`src/routes/api/scenes/createScene/+server.ts`): build the schema from drizzle-zod exports (`insertSceneSchema.extend(...)`), auth-check inline (`locals.user?.id` + awaited `assertGameSessionEditor`), delegate business logic to a `$lib/server` domain function.

**Exception:** the Stripe webhook (`api/stripe/webhook/+server.ts`) is a raw RequestHandler — it needs the raw body for signature verification. Internal endpoints (`/api/internal/*`) are token-guarded via `assertInternalRequest` (x-internal-token vs `INTERNAL_API_TOKEN`), no user session.

## Frontend queries/mutations (CLAUDE.md C-6)

All in `src/lib/queries/*.ts`, one file per domain. `mutationFactory` (`src/lib/factories/mutationFactory.ts`) wraps TanStack `createMutation`; two config forms: `{ endpoint, method }` (auto-fetch, throws the error JSON on `!ok`) or `{ mutationFn }` (custom work, e.g. R2 upload in `queries/file.ts`).

- **Invalidation default**: no `onSuccess` → `invalidateAll()` (full load re-run). Hooks pass `onSuccess: async () => { return; }` to **opt out** — required for realtime-doc flows so a doc write doesn't trigger a pointless reload (see `queries/scenes.ts`, `queries/gameSessions.ts`).
- Components wrap `mutation.mutateAsync` in `handleMutation({ mutation, formLoadingState, toastMessages, … })` (same file) for loading state + `addToast` feedback.
- Queries use TanStack `createQuery` directly (no factory) — see `queries/users.ts`.

## Database (drizzle + Turso/libSQL)

- **One** app database. Schema: `src/lib/db/app/schema.ts` (21 tables). Per-table convention: `sqliteTable` → `InsertX`/`SelectX` inferred types → `insertXSchema`/`selectXSchema`/`updateXSchema` via drizzle-zod, `.extend()`ed where needed.
- Timestamps: `integer({ mode: 'timestamp' })` = **Unix seconds** (CLAUDE.md D-5 — use `date -d @<ts>`). Booleans: `integer({ mode: 'boolean' })`. JSON: `text({ mode: 'json' }).$type<…>()`.
- Client (`src/lib/db/app/index.ts`): a `file:` URL selects a persistent local SQLite database in all environments with no sync. Otherwise, in production an **embedded replica** (`/app/data/turso_local.db`, syncInterval 30s) with remote fallback; dev is remote-only. Wrapped in `makeResilientClient` (`resilientClient.ts`) — a Proxy that reconnect-retries once on Hrana stream errors; transactions deliberately not retried (rationale: `spec/embedded-replica-stream-recovery.md`).
- Migrations live in `src/lib/db/app/migrations/`. **Never generate/run migrations or `pnpm run push`** — ask the user (CLAUDE.md D-3/D-4).

## Realtime (the biggest thing to internalize)

Full doc: `docs/yjs-sync-architecture.md` (current, trust it). The one-paragraph model:

PartyKit + Y.js. Two Y docs per session (`game_session` = scene content, `party` = party state). Client entry is `src/lib/realtime/SessionDocClient.svelte.ts`: reactive snapshot getters (pages never touch Y types), writes through origin-tagged writers, per-scene `Y.UndoManager`. The PartyKit room (`partykit/gameSession.ts`) hydrates from the DB and is the **only** writer of scene data back to the DB (debounced 2s/max 10s via `/api/internal/persistSession`).

**Consequences when adding features:**

- **There is no save pipeline.** Do not add autosave, save buttons, or scene-update API mutations. Edits are doc writes; PartyKit persists.
- Scene **create** still goes through `/api/scenes/createScene` (server computes alignment), then the client adds the row to the doc. Update/delete/reorder scenes = doc writes only (see the comment atop `queries/scenes.ts`).
- After any **direct DB write** to scene data (import, admin tooling), trigger a room `resync` (`requestGameSessionRoomResync` in `src/lib/server/realtime/`), or the live doc won't see it.
- **Snapshot rows are shared, read-only objects.** `getSceneSnapshot` reuses each row's plain object until its Y.Map changes (WeakMap cache in `docSchema.ts`, invalidated by an `observeDeep` attached per doc on first read — this also covers the PartyKit server's persist path). Never mutate a snapshot row (markers, lights, aoeTemplates, annotations); copy first. `buildSceneProps` builds fresh objects for stageProps and memoizes the fog gradient and fog-room parse by input value.
- **Persist writes are batched.** `replaceRows` in `server/realtime/index.ts` sends the delete + all upserts for a collection in one `db.batch` (one round-trip, atomic, idempotent so the resilient client's retry is safe). Don't reintroduce per-row awaits.
- **Image URLs**: `generateR2Url` adds `format=auto` to every Cloudflare transform (AVIF/WebP by `Accept`). The local `/assets` route mirrors it (WebP for `format=auto|webp`, PNG otherwise), keeps a 100-entry in-memory transform LRU keyed by file size+mtime, serves `originals/` as `immutable`, and answers `If-None-Match` with 304.
- **Write cadence is handled for you.** `queuePropertyUpdate` applies locally at once and flushes to the doc event-driven (`$lib/utils/propertyUpdateBroadcaster.ts`: 8ms leading-edge gate + trailing timer), and `SessionDocClient` coalesces remote rev bumps via `setTimeout(0)` so message backlogs drain into one rebuild. Do not bypass the broadcaster with per-event `client.write.*` calls in a gesture loop, and never schedule realtime send/receive work on `requestAnimationFrame` — rAF cadence is per-window (focus/occlusion/GPU contention) and makes sync smoothness depend on which window has scheduler priority.
- **Never write settings fields you didn't change.** The broadcaster writes field-level diffs (only fields mapped from queued paths — `sceneSettingsFieldsForPropPaths`). Writing a full settings object from local stageProps pushes stale copies of other clients' in-flight fields into the doc and rubber-bands their gestures. Same rule for any new direct `write.setSceneSettings` call: pass only the fields you actually changed.
- System writes that must not pollute user undo (e.g. thumbnails, and all combat/initiative writes) go through `systemWrite`.
- **New doc fields are optional.** Rooms persisted before a field existed won't have it, so `MarkerRow`/`SceneSettings` additions are typed optional and read with defaults (`m.conditions ?? []`, `s.combatRound ?? 0`, `s.combatShowOnTv ?? true`). A new field must be threaded through `fromDb.ts`, `wire.ts`, the persist schema in `api/internal/persistSession`, `server/realtime` load, game-session export/import, scene duplicate (`SceneSelector`) and the token clipboard — check each one. `DOC_SCHEMA_VERSION` is 3 (adds the `aoeTemplates` collection; rows carry `createdAt` as Unix seconds).
- **Multi-step gestures as one undo step**: wrap the writes in `client.beginUndoGroup()` / `client.endUndoGroup()` (group token drag uses this, closing the group on the stage's `onMarkersMoveEnd`). A cancelled gesture that restored the doc passes `endUndoGroup({ discard: true })` to drop its no-op step. Flush any open group before `undo()`/`redo()`.

**Idle sleep** (Durable Objects bill while a room holds any socket — see spec/realtime-idle-sleep-and-usage.md):

- Both routes sleep their connections via `SleepController` (`src/lib/realtime/SleepController.svelte.ts`) driven by the pure reducer in `idlePolicy.ts` (`EDITOR_IDLE_POLICY` / `PLAY_IDLE_POLICY`). **Never hand-roll `client.connect()`/`disconnect()` from a page**; construct a controller, `bindClient`, pass `canSleep` for gestures, and `destroy` on unmount.
- `SessionDocClient` exposes `status` (real provider state), `synced`, `sleeping` (deliberate, flips before status), `onRemoteActivity`. `ready` latches so pages keep rendering while asleep.
- Two user endpoints under `api/party/`: `editorActivity` (editor ping, `editor_active` row) and `liveState` (DB-only poll for a sleeping playfield). Client side: `queries/realtimeActivity.ts` — `useEditorActivityMutation` (opts out of `invalidateAll`, silent errors) and `createPartyLiveStateQuery(partyId, enabled)` (poll pattern: `enabled` + `refetchInterval` + `refetchIntervalInBackground`, `staleTime: 0`, `gcTime: 0`, `retry: false`).

**Realtime activity** (`realtime_activity` table, usage on `/admin/usage`):

- Rooms batch `connect`/`close` (1 s) to `/api/internal/roomActivity` via `partykit/roomActivity.ts`; never throws, never retries. Persist endpoints add `edit` / `party_state` rows. `src/lib/server/realtime/activity.ts` is the **only writer** (and the retention pruner, 90 days). The rollup (`activityRollup.ts`) is pure and tested; `usage.ts` joins metadata and is imported by path from the admin page only (not barrel-exported — see the Rolldown note under Turnstile). Optional Cloudflare gauge: `src/lib/server/cloudflare/` (`CLOUDFLARE_WORKERS_KEY` + `CLOUDFLARE_ACCOUNT_ID`, 10 min cache).
- Editor integration: `useEditorSession.svelte.ts` in `routes/(app)/[party]/[gameSession]/[[selectedScene]]/` (applies remote fog/annotation masks to the stage, idle thumbnail regen).

- **Grid size and token visibility**: `scene.gridSpacing` is a per-scene fractional inch value (the column keeps integer affinity, which stores reals; `insertSceneSchema` overrides it to a positive number and `convertPropsToSceneDetails` no longer rounds). Library placement and click-placed markers default to `MarkerVisibility.Always`; `AssetLibrary` binds a `visibility` toggle that `placeAsset` applies client-side. AoE `visibility`/`snapAngle` are stripped from the saved `aoeTool` preference (`withoutSessionAoeFields`).

## Auth

Custom session-token auth (oslojs), not a library. `src/lib/server/auth.ts`: token in httpOnly `session` cookie; session id = SHA-256 of token; 30-day expiry, sliding renewal at 15 days. `hooks.server.ts` populates `locals.user`/`locals.session` (+ Sentry, prod-only).

- Page protection: the `(app)` route-group layout guard (`routes/(app)/+layout.server.ts` → redirect to /login). Everything under `(app)/` is authed.
- API protection: inline per-handler (`throw new Error('Unauthorized')`), plus `isUserInParty`/`isUserAdminInParty` for party-scoped resources.
- **Party document authorization**: `SessionDocClient` fetches a short-lived signed connection ticket from `/api/party/connectionToken` on every connection attempt. The party room verifies it through `/api/internal/authorizeParty`, which checks live membership. Admins/editors can write; viewers connect with y-partykit's per-connection `readOnly` option. Party-provider BroadcastChannel sync is disabled to avoid bypassing server checks through another tab. Game-session document permissions and player token movement remain unchanged.
- **Token clipboard**: `utils/tokenClipboardSchema.ts` is the server-safe versioned protocol/size/note validator; `utils/tokenClipboard.ts` converts group offsets into destination map axes, grid units and display-pixel fallback. `/api/assets/clipboard` authorizes grants from owned media/assets or editable source-scene references, then validates destination admin/editor membership and signed same-deployment artwork coverage before returning fresh independent rows. Durable grants support paste after source deletion; originals must remain retained. Optional asset links survive only for the destination user's current library. Native clipboard events supply `text/plain` JSON over LAN HTTP; copy grants are prepared through `createQuery` before the synchronous copy event, and paste uses `mutationFactory`. The editor inserts returned rows in one isolated origin-tagged transaction, without an API scene save or full reload.
- **Personal assets**: `server/assets/` and `/api/assets/manage` scope library operations to `ownerId`. Placement separately checks admin/editor membership in the destination scene's party and returns independent marker snapshots for one client doc transaction. `marker.assetId` uses `ON DELETE SET NULL`; persistence prunes stale links from live documents after asset/owner deletion. No media is deleted when library metadata is removed.

## Quick map: uploads, Stripe, email, env

- **Asset library panel**: tile click opens the stat block (`get` action, full `statBlock`), the `+` button or a drag places it. An empty library search falls through to an inline 5etools search (`AssetCatalogInline`), where `+` adds to the library (`policy: 'skip'`). The overlay (`AssetCatalogOverlay`) is for bulk import only.
- **Local hosting**: see `docs/local-container-hosting.md`. `containers/dev.sh` builds `ui`/`stage` only when `dist` is missing or stale (no typedoc), then warms `/login` and `/`; the dev healthcheck waits for `/tmp/tableslayer-warm`, so `make dev` returns once the app is compiled (`vite.config.ts` also sets `server.warmup` and `optimizeDeps.include`). `ASSET_STORAGE=local` selects ordinary files under `LOCAL_ASSET_DIR`; `/assets/[...path]` serves files, signed PUT uploads, and Sharp image transforms. Signatures bind path, MIME type, and expiry to `INTERNAL_API_TOKEN`. `SESSION_COOKIE_SECURE=false` explicitly allows trusted HTTP LAN sessions. `PARTYKIT_INTERNAL_URL` separates server resync from public WebSocket addresses. Local PartyKit state persists separately from the application SQLite file.
- **Uploads (R2 via S3 API, or local filesystem)**: `uploadMediaFile` in `queries/file.ts` is the shared file operation behind `useUploadFileMutation`. The presign endpoint returns a fresh owner-scoped `uploads/` staging location; clients must use the returned location rather than their requested filename. `/api/file/createFile` verifies ownership, enforces byte limits, fully decodes images with Sharp and pixel limits, stores a fresh `originals/` key, and registers file/owner metadata in a transaction. Replacements ignore legacy `id/currentUrl` arguments. Successful registration removes staging; failed metadata removes only its newly created original. Cancelled staging is retained pending operator cleanup; referenced originals are never swept automatically. Shared byte limits are 15MB for still images, 100MB for GIF/video; video decode validation is not added by this image feature. Local PUT uses the same limits and decoded-image validation. Derived media (fog, thumbnails, annotation masks) retain existing mutable keys/versioning and skip file registration. Server: `src/lib/server/file/files.ts`.

- **Stripe**: `api/stripe/{checkout,customerPortal,webhook}`; price→plan via `STRIPE_PRICE_ID_*` envs; updates `partyTable` plan fields; gated by `isStripeEnabled()`.
- **Email (Cloudflare Email Sending, replaced Resend 2026-06)**: `src/lib/server/email/email.ts` → Cloudflare API, from `no-reply@tableslayer.com`. Dev redirects all mail to `DEV_EMAIL`; `ENV_NAME === 'preview'` skips sending.
- **Turnstile (bot check on signup)**: `src/lib/server/turnstile.ts` `verifyTurnstileToken()` (fails closed) — imported directly, NOT via the `$lib/server` barrel: a server module with a single endpoint consumer that is also barrel-re-exported makes Rolldown (Vite 8) inline it into the endpoint chunk with an extra `export { x as t }`, and SvelteKit's build fails with `Invalid export 't'`; gated by `isTurnstileEnabled()` (`TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY`). Widget is `lib/components/Turnstile.svelte` (`appearance` prop: `always` outside production so it can be seen/tested, `interaction-only` in production); site key reaches the page via `signup/+page.server.ts`. CI preview uses Cloudflare's always-pass test keys.
- **Env**: `ENV_NAME ∈ production|preview|dev` drives behavior throughout. `PUBLIC_PARTYKIT_HOST` selects the public realtime host and optional `PUBLIC_PARTYKIT_PROTOCOL` selects `ws`/`wss` (local Compose sets `ws`). `CLOUDFLARE_WORKERS_KEY` (Account Analytics: Read) + `CLOUDFLARE_BILLING_CYCLE_START_DAY` are optional and only feed the admin usage gauge. See `.env-example` for the full list.
- Server business logic lives under `src/lib/server/<domain>/`, re-exported from `$lib/server` — endpoints import from there, not from deep paths.
- **Dev**: `pnpm run dev` runs vite (port 5174) + partykit (1999) together. Gates: `pnpm run check`, `pnpm run format-check`.

## Anchor files (freshness check)

- `apps/web/src/lib/factories/apiFactory.ts`
- `apps/web/src/lib/factories/mutationFactory.ts`
- `apps/web/src/lib/db/app/schema.ts` / `index.ts` / `resilientClient.ts`
- `apps/web/src/lib/realtime/SessionDocClient.svelte.ts` / `docSchema.ts`
- `apps/web/src/lib/realtime/idlePolicy.ts` / `SleepController.svelte.ts`
- `apps/web/partykit/gameSession.ts` / `roomActivity.ts`
- `apps/web/src/lib/server/realtime/activity.ts` / `activityRollup.ts` / `usage.ts`
- `apps/web/src/lib/server/assets/assets.ts` — placement copies `statBlock`/`initiativeBonus`; `listAssets` returns `statSummary`, not the full block
- `apps/web/src/lib/server/assets/fivetools/statblock/` — 5etools → `StatBlock` (`utils/statBlock/types.ts`, client-safe)
- `apps/web/src/lib/realtime/fromDb.ts` / `wire.ts` / `apps/web/src/routes/api/internal/persistSession/+server.ts` — field plumbing
- `apps/web/src/lib/server/file/files.ts` / `validateImage.ts`
- `apps/web/src/lib/server/realtime/partyConnectionToken.ts`
- `apps/web/partykit/party.ts`
- `apps/web/src/lib/server/auth.ts`, `apps/web/src/hooks.server.ts`
- `apps/web/src/routes/api/scenes/createScene/+server.ts` — canonical endpoint

## Keeping this skill current

If this document contradicts the code, trust the code and update this file in the same PR. Changes to factory signatures, the realtime persistence model, or auth flow must be reflected here (and in the relevant `/docs` file).

Token artwork pickers and drops share `useTokenArtworkMutation`: validate one image, check scene editing access before upload and recheck owned original/role afterward. Capture the destination client, scene and token before awaiting; apply only `imageLocation` using `setExistingMarkerFields`, which atomically refuses a missing token/scene. Scene creation uses `assertGameSessionEditor` to bind current admin/editor membership to both the actual session and supplied party. Sidebar batch creation is sequential and never changes party active scene.

- **5etools JSON import**: `server/assets/fivetools/` isolates the `bestiary-art-v1` adapter, bounded destination/redirect/DNS-pinned image downloader and owner-scoped import service. `/api/assets/import` uses `apiFactory`; preview/import frontend calls use `mutationFactory` and invalidate library and catalog duplicate queries. Import successes and owner/request fingerprints are persisted in `asset_import_receipt` atomically with library metadata, so retry after a lost response cannot duplicate successful items. Update changes provenance and supplied artwork only; preserve edited names/appearance and omit missing artwork fields from the SQL update. Original-image registration is shared with local/R2 storage and rolls back only its new original on registration failure. Imported originals retained after later metadata/import failure remain for manual cleanup. Explicit `FIVETOOLS_IMAGE_BASE_URL` mirrors are trusted only within the configured origin/base path; arbitrary URLs require public HTTPS and validated pinned DNS addresses. Native HTTP LAN workflows use UUID utilities rather than secure-context-only `crypto.randomUUID`.

- **5etools catalog**: `/api/assets/catalog` exposes authenticated search and explicit refresh. `server/assets/fivetools/catalog.ts` builds one all-source catalog from `index.json` and `fluff-index.json`, with at most four concurrent validated downloads and shared in-flight loading. Each raw JSON body and provenance revision is retained under `catalog/5etools/<URL hash>/`; only `latest.json` is replaced on explicit refresh. Cache reads use local/R2 storage and validate content hashes before reuse after restart. Search, optional source filtering and 100-result pagination operate on normalized memory records and never refetch source files on keystrokes; `createAssetCatalogQuery` debounces through component state and polls only while the initial load is in progress. Catalog selections feed the same preview, duplicate handling and import mutation as JSON files; import completion invalidates catalog duplicate metadata as well as library queries.

## Handouts and membership authorization

Handouts use `queries/handouts.ts` mutation factories and `/api/handouts/manage` via `apiFactory`. `server/handouts/` freshly checks admin/editor membership and artwork ownership/party context before preparing a presentation-only descriptor. `createPartyWriter.setHandout` writes party state; PartyKit persists `activeHandout` in `party.active_handout`. Preserve the descriptor during pause and scene/session switches; player overlays use original artwork with contain sizing. Include presentation ID in sleeping-client live-state comparisons. See `docs/yjs-sync-architecture.md`.

Member role updates and all invitation management are admin-only server operations; await membership checks. Member deletion allows administrators to remove others and members to leave themselves, retaining the service's last-admin protection. Never swallow authorization failures in route catch blocks.

## Manual media retention

`clipboard_artwork` is a global, permanent location ledger without cascading foreign keys. Migration 0055 seeds all existing registered artwork; `createClipboardGrant` must persist authorized locations before issuing a signed grant and fail closed if retention fails. Never delete ledger rows during asset/account cleanup. Unregistered originals are conservatively retained.

`apps/web/scripts/cleanup-media.mjs` provides a private reviewable inventory and explicit offline apply for local SQLite with local/R2 storage. The host wrapper refuses a running stack. Apply rescans database text/foreign-key references and verifies object fingerprints, retaining clipboard/legacy references, unknown originals, other namespaces and recent objects. No scheduled deletion exists. See `docs/media-cleanup.md` for backup, stopped-client and recovery requirements.
