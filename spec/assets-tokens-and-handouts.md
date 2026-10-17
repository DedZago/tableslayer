# Assets, token workflows, and player handouts

Date: 2026-10-05  
Status: A–G and manual cleanup implemented; local acceptance complete, with external validation limits recorded below.  
Scope: Persistent reusable assets, 5etools names/artwork import, group token copying across sessions and tabs, image drops, and GM-controlled handouts.

## Problem statement

Table Slayer persists uploaded files and markers within scenes, but it lacks an independently reusable asset library. Preparing repeated enemies requires manually creating tokens and assigning images. The editor selects one marker at a time and has no token clipboard workflow. Sidebar dragging reorders scenes rather than importing image files. Player views support marker notes and hover reveals but cannot display a shared maximized image over the map.

The intended workflow is to import or create an enemy once, place independently editable copies in different sessions, copy groups between tabs, assign images by dropping files, and show artwork to players without replacing the active map.

## Agreed requirements and boundaries

- Assets contain editable names, artwork, and default token appearance. Statblocks, HP, and combat tracking are outside this scope.
- Use a personal reusable library across parties and sessions. Party-shared libraries are a possible later extension.
- Provide in-app 5etools search/import and JSON-file import through one adapter. JSON import is an intermediate milestone, not the completion of direct importing.
- Imported artwork is stored in Table Slayer so placed assets work without the upstream service after import.
- Library names and individual token names can be changed independently.
- Library changes affect future placements by default. Existing tokens retain their instance values.
- Support multi-selection and group copy/paste between scenes, sessions, and tabs on the same Table Slayer deployment for an authorized user.
- Preserve group spacing in grid-cell units where meaningful; provide a deterministic fallback for scenes without a usable grid.
- Support image-file drops into the scene sidebar and onto token previews and canvas tokens.
- Sidebar file drops create new scenes. Map replacement remains an explicit action.
- A GM-controlled image overlay appears in player map views and can be hidden by the GM. Players cannot dismiss it globally.
- Keep file-picker workflows available, including on touch devices.
- Preserve existing R2 and local-storage operation, realtime synchronization, and undo/redo behavior.

Cross-deployment clipboard transfer, artwork embedded in clipboard payloads, live propagation of library edits to placed tokens, player-openable handout collections, and website-image URL drops are outside the initial scope. Portable asset export is a follow-up; ordinary deployment backups must include the database, artwork, and realtime storage.

## Current implementation anchors

| Area                   | Current files and behavior                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persistence            | `apps/web/src/lib/db/app/schema.ts`: `files`, `user_files`, scene-bound `marker` records; marker deletion cascades with scene deletion                              |
| Uploads                | `apps/web/src/lib/queries/file.ts`, `apps/web/src/lib/server/file/`, `apps/web/src/routes/assets/[...path]/`: presigned uploads, R2/local storage, image transforms |
| Scene creation         | `apps/web/src/lib/components/GameSession/SceneSelector.svelte`: file upload, scene API creation, realtime insertion, filename grid detection                        |
| Token editing          | `apps/web/src/lib/components/GameSession/MarkerManager.svelte`: editable title, file-picker artwork upload, visibility, shape, size, notes                          |
| Editor                 | `apps/web/src/routes/(app)/[party]/[gameSession]/[[selectedScene]]/+page.svelte`: marker callbacks, context menu, keyboard handling                                 |
| Selection/rendering    | `packages/stage/src/lib/components/Stage/components/MarkerLayer/`: single marker selection and marker hit testing                                                   |
| Coordinates            | `packages/stage/src/lib/components/Stage/helpers/mapSpace.ts`, `apps/web/src/lib/utils/mapCoordinates.test.ts`                                                      |
| Realtime               | `apps/web/src/lib/realtime/`, `apps/web/partykit/gameSession.ts`, `apps/web/partykit/party.ts`, `apps/web/src/lib/server/realtime/`                                 |
| Player surface         | `apps/web/src/routes/(app)/[party]/play/`: shared session/party state, pause overlay, idle sleep and wake                                                           |
| Existing import/export | `apps/web/src/routes/api/gameSessions/{importGameSession,exportGameSession}/`: Table Slayer session metadata and image references, not bundled artwork              |

These anchors describe the reviewed working tree, including uncommitted local-hosting changes. Recheck them before implementation and preserve unrelated work.

## Proposed solution

### Assets and placed tokens

Introduce an asset domain independent of scenes. Proposed asset fields:

- ID and owner user ID.
- Editable display name.
- Original artwork file reference; optional separate token artwork reference if an import supplies both.
- Default shape, shape color, size, and image scale using existing marker vocabulary.
- Optional provenance: provider, original name, source identifier, source URL/identity, and adapter version.
- Created/updated timestamps using the database's Unix-seconds convention.

Add a nullable asset ID to markers. Placement copies the asset's current name, image reference, and appearance into a new marker. The asset ID records origin; it does not turn the token into a live view of the asset.

Use `ON DELETE SET NULL` for the marker-to-asset reference, or an equivalent explicitly tested deletion transaction. Deleting an asset must preserve placed tokens and their artwork. Owner deletion must also preserve media referenced by surviving tokens in other parties.

The library provides search, create, edit, delete, import, and place actions. Existing markers gain a "Save as asset" action. Support placing a requested quantity with unique token IDs. New enemy placements default to DM-only visibility; ordinary pasted tokens retain their copied visibility and are therefore an intentional placement action.

Personal-library metadata is owner-authorized. Placing an asset publishes the selected token values and artwork reference into the destination party's existing shared scene model; it does not expose the rest of the library.

### Immutable media references

Each new image upload receives a fresh storage key. Replacing token or library artwork changes that object's reference rather than overwriting bytes shared by other instances. Reuse existing uploaded media when copying and placing tokens.

Store original media locations, not cropped thumbnail URLs, as authoritative references. Derive thumbnails and token crops at render time. Preserve original resolution for handouts. A 5etools token image can still be used as a handout when no portrait is available, without claiming that a higher-resolution portrait exists.

Validate file type, byte limits, and decodability on the server as well as the client. Harmonize limits across the upload mutation and local-storage endpoint. Failed metadata creation or cancelled uploads must have a defined orphan-media cleanup strategy. User decision (2026-10-05): abandoned staging uploads remain until manual cleanup; do not introduce automatic expiry or scheduled deletion. Deletion/cleanup must never remove artwork still referenced by an asset, marker, or handout.

### 5etools adapter

Normalize supported bestiary JSON into preview records containing original identity, display name, artwork candidates, and optional appearance defaults. Do not import statblocks into marker notes.

Use an isolated adapter rather than scraping rendered bestiary HTML or loading the full 5etools renderer into the application. Follow upstream token resolution precedence for `tokenUrl`, `token`, `tokenHref`, and implicit source/name paths. Preserve upstream identity when the user renames an asset.

Support single and multiple monster selection. File import and in-app catalog search use the same preview, normalization, artwork download, duplicate handling, and asset creation service.

The catalog source and image base must be configurable for a supported remote source or self-hosted mirror. Fetch and cache catalog data server-side. Source discovery can use the upstream bestiary index; searches must not redownload the whole catalog on every keystroke. User decision (2026-10-05): search all sources by default; source filtering remains optional. Pin/document the supported adapter format and maintain representative fixtures.

Resolve reference-based artwork/identity where the adapter supports it. If a required base record is unavailable, report the unsupported dependency explicitly and offer manual artwork replacement. Detect reference cycles. Full statblock inheritance processing is outside scope.

Download selected artwork into the configured storage backend with timeouts, byte limits, decoded-image validation, bounded concurrency, and destination validation, including redirect targets. Arbitrary import URLs must not grant unrestricted access to local/private network services; an operator-configured mirror is an explicit trusted source.

Deduplicate by upstream identity and owner, independently of editable names. Preview duplicates and offer skip, update, or create another asset. Update changes the library asset only. User decision (2026-10-05): reimport updates preserve edited names and appearance defaults; refresh artwork and provenance only. Preserve each existing artwork reference when the upstream record supplies no replacement; download failures leave the asset unchanged and allow retry. Missing artwork leaves a usable named asset with a placeholder. Provide per-item results and retry failed items without duplicating successful imports. Define import idempotency before adding the bulk endpoint.

### Multi-selection and portable token clipboard

Track selected marker IDs separately from the one marker being edited. Support modifier-click toggling, rectangle selection in marker mode, a clear-selection action, and selection outlines. Reserve a gesture distinct from existing map pan, drawing, and token placement. Touch users can select multiple tokens through sidebar selection controls.

Selection remains local UI state. Scene changes clear selection. Remote deletion prunes deleted IDs. Rectangle selection includes only tokens selectable by the current surface; initial group clipboard actions belong to the editor.

Use a validated, versioned clipboard envelope with a recognizable format identifier, source deployment identity, coordinate basis, group anchor, token snapshots, and artwork references. Never depend solely on source token IDs or an in-memory clipboard.

Copy title, label, artwork, image scale, shape, color, size, visibility, and existing note content. Exclude source IDs, scene IDs, and pinned-tooltip state. Clone mutable nested content. Preserve an asset link only if it is accessible in the destination context; otherwise paste a standalone token.

Represent relative group offsets in grid-cell units when the source and destination have usable grids. For other combinations, use a documented display-space fallback that preserves the group's formation. Define and test the conversion for both map-defined and fill-space scenes. Existing token size remains the existing grid-relative marker size.

Paste at the last valid pointer position in the destination map, or viewport center if none exists. Snap the group anchor once so individual token snapping does not distort formation. Offset repeated pastes by one destination grid cell, or a documented fallback distance.

Create fresh IDs for every paste. Validate destination editing access and media references. Paste the group through one origin-tagged Y.js transaction, isolated from adjacent edits, so undo removes the whole pasted group and redo restores it.

Handle native copy/paste events with a recognizable `text/plain` JSON fallback for cross-tab transport. Use asynchronous clipboard APIs only where available. HTTP LAN hosting must remain supported through browser event clipboard access; test Chromium and Firefox rather than assuming secure-context APIs exist. Leave normal copying/pasting in inputs and rich-text editors untouched. Invalid or foreign payloads must not mutate the scene.

### Image drop targets

Extract file-based operations from event handlers so file pickers and drops share validation, loading states, error feedback, and mutations.

Scene sidebar: distinguish `Files` transfers from internal reorder drags. Dropping one or more accepted images creates scenes in file order, retains filename grid detection, and respects existing plan limits. Report rejected files and partial failures. Upload/create sequentially or reserve ordering explicitly. Do not activate new scenes for players automatically. Navigate the editor to the first successfully created scene after the batch.

Token preview: dropping a single accepted image replaces that token's image after a successful upload. Multiple-file drops report that one image is required.

Canvas token: translate browser drop coordinates through the stage's camera, scene, and map transforms, then reuse marker hit testing. Highlight the target before drop. An empty canvas drop does not create a map or token in this scope. Capture target scene and token IDs when the operation begins; never retarget completion to a newly selected token. If the target was deleted, do not recreate it.

Prevent supported file drops from navigating the browser to the image. Keep reorder handlers from swallowing external files. Clear drag feedback on leave, cancellation, and completion. Website URL and HTML image drops produce guidance to use an image file rather than silently creating a broken asset.

### Player handout overlay

Add an application-level overlay above the stage. Actions are available from token artwork, asset artwork, and an uploaded handout image. Provide GM preview, "Show to players", and "Hide handout" controls.

Extend party state with an optional active handout descriptor: presentation ID, original artwork location, optional title, presenter identity, and publication time. Publish only presentation data; do not include private library metadata. Define role enforcement consistently with the repository's current collaboration model and authorize asset selection on the server. UI-only capability flags must not be represented as a security boundary.

Render using contain sizing with a theme-aware background, loading/error state, and accessible image text. The player overlay consumes map gestures while visible. The GM retains access to editor controls and sees the same presentation in a preview. Players cannot globally hide the presentation.

Showing a new image replaces the current handout. Hiding clears the shared descriptor. Handouts remain visible across scene/session switches until explicitly hidden. Pause retains the descriptor but the pause overlay takes visual precedence; resuming restores the handout. A late-joining or reconnecting player sees the currently active handout. Presenter disconnect does not automatically hide it.

Persist state through the party document and its server persistence pipeline. Extend party hydration, serialization, snapshots, live-state polling, activity classification, and sleep wakeup so show/hide changes reach sleeping player views. Keep presentation changes separate from scene undo history.

## Alternatives and tradeoffs

| Decision          | Selected approach                      | Alternative and tradeoff                                                                        |
| ----------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Ownership         | Personal library                       | Party library improves shared curation but adds ownership/sharing rules; defer                  |
| Instance updates  | Snapshot values per placement          | Live-linked tokens propagate library edits but can change prepared scenes unexpectedly          |
| Import delivery   | JSON milestone plus in-app search      | JSON alone is smaller but does not complete the agreed direct-search workflow                   |
| Media             | Immutable stored originals             | External URLs avoid downloads but retain upstream availability and browser-loading dependencies |
| Clipboard         | Versioned snapshots with text fallback | ID-only/internal clipboard is smaller but fails across tabs and source deletion                 |
| Handout rendering | DOM overlay in the web app             | A WebGL stage layer adds rendering complexity without improving image presentation              |

## Scores and implementation sequence

Scores are planning judgments, not measured estimates. Effort and risk use 1–5, where 5 is highest. Value uses 1–5, where 5 has the greatest workflow benefit. Priority uses P0 for foundations, P1 for core delivery, and P2 for later delivery within this scope. Scores must be revisited after the first implementation milestone; they are not calendar commitments.

| Phase | Deliverable                                                 | Priority | Value | Effort | Risk | Dependencies                                   |
| ----- | ----------------------------------------------------------- | -------- | ----- | ------ | ---- | ---------------------------------------------- |
| A     | Immutable media references and shared file operations       | P0       | 5     | 3      | 4    | None                                           |
| B     | Persistent personal asset library and independent placement | P1       | 5     | 4      | 3    | A; operator-applied schema changes             |
| C     | Sidebar, preview, and canvas image drops                    | P1       | 4     | 3      | 3    | A                                              |
| D     | 5etools JSON import and stored artwork                      | P1       | 4     | 3      | 3    | A, B                                           |
| E     | Multi-selection and group clipboard across tabs/sessions    | P1       | 5     | 5      | 4    | A; optional asset linkage uses B               |
| F     | In-app 5etools catalog search and import                    | P2       | 5     | 4      | 4    | D                                              |
| G     | GM-controlled synchronized handout overlay                  | P2       | 4     | 4      | 4    | A; operator-applied party-state schema changes |

Recommended delivery order: A → B → C → D → E → F → G. C can follow A independently, and G can move earlier once media handling is stable. Keep each phase reviewable; do not merge a single change containing all seven phases.

### Implementation status — 2026-10-05

Core implementation for A–G and manual cleanup is complete. Local acceptance covers the workflows below; external and supplementary validation limits remain explicit. Detailed implementation decisions and test evidence are recorded in [implementation checkpoints](assets-tokens-and-handouts-implementation.md).

| Phase | Implemented                                                                                                                                                                                                                                                                                                             | Still required                                                                                                                             |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| A     | Shared upload operation, owner-scoped staging, immutable registered originals, server byte/MIME/pixel/decode validation, rollback of failed registration                                                                                                                                                                | Live R2 acceptance (no configured disposable cloud environment)                                                                            |
| B     | Personal asset schema and library UI, owner-authorized CRUD/search, save token as asset, quantity placement with fresh IDs and independent values, DM-only enemy defaults, nullable marker origin with `ON DELETE SET NULL`, image-scale round trip                                                                     | Additional library combinations beyond the verified ownership/independence/deletion and restart workflows                                  |
| C     | Shared picker/drop operations, sequential sidebar batches with filename grids and partial failures, preview/canvas replacement, transformed target highlighting, captured destination and atomic existing-token-only writes, website-image guidance, admin/editor scene creation authorization                          | Live Stripe-enabled plan-limit boundary and additional in-flight navigation combinations                                                   |
| D     | JSON preview/selection, shared fixture-tested adapter, token precedence and supported artwork references, bounded destination/redirect/DNS-pinned downloads into immutable originals, owner-scoped duplicate policies, durable per-item receipts and retry; updates preserve edited defaults and missing artwork        | Live R2 acceptance                                                                                                                         |
| E     | Local group selection, Shift-click/drag, touch sidebar controls, whole-view Ctrl-drag pan, strict versioned native clipboard, deployment-bound artwork grants, map-aligned coordinate conversion, pointer/viewport placement, repeat offsets, one-step paste undo/redo                                                  | Physical mobile devices and additional browser grid-mode/fallback/snapping combinations; conversion and rejection rules have unit coverage |
| F     | All-source catalog search by default, optional source filter, paginated results and shared import preview/service; configurable bestiary/image bases; four-worker bounded loading; server memory cache backed by immutable persisted raw JSON/provenance revisions; explicit upstream refresh and partial-file feedback | Live R2 cache acceptance                                                                                                                   |
| G     | Persisted presentation-only party descriptor; fresh admin/editor and artwork authorization; upload/asset/token previews, show/hide controls, original-image overlay, reconnect fallback and sleep-wake comparison                                                                                                       | No remaining local acceptance blocker                                                                                                      |

### Confirmed implementation decisions

- Public 5etools upstream is the default, with configurable mirrors. Persist pulled metadata and downloaded/created artwork locally so imported assets remain usable without upstream.
- Scene creation and handout show/hide are limited to admins/editors. Viewer party state is read-only; game-session token movement remains available to players.
- Party member role changes and invitation management are admin-only; members may leave their own party, retaining last-admin protection.
- Shift-drag selects a group; Ctrl-drag pans the whole view, including grid and tokens. Pasted formations align with the destination's rotated map.
- Abandoned staging uploads remain until manual cleanup. Do not introduce automatic staging expiry or scheduled deletion. Manual cleanup must protect asset, token, handout and durable clipboard artwork references.
- Reimport updates preserve edited names and appearance defaults, refresh provenance and supplied artwork, and preserve existing artwork when no replacement is supplied. Download failures leave the asset unchanged.
- Development migrations 0052–0055 (assets, import receipts, handout persistence and permanent clipboard artwork retention) were generated, backed up, applied and verified under the user's explicit authorization.

### Verification recorded so far

- Required `pnpm run check` and `pnpm run format-check` gates passed at the latest implementation checkpoint; existing Svelte warnings remain. `git diff --check` also passed.
- First media/library checkpoint: nine focused Vitest files, 58 passing tests. Local/R2 abstraction tests cover immutable originals and failed-registration rollback; these do not constitute live R2 acceptance.
- Selection geometry: seven passing tests. Clipboard protocol, conversion, grants and group-undo checkpoint: four focused files, 38 passing tests.
- Latest role/deleted-token checks: two focused files, 23 passing tests. These checkpoint counts overlap and must not be added into a unique test total.
- Chromium and Firefox on LAN HTTP: image-drop regression passed in both browsers, and native cross-tab clipboard regression passed again in both browsers (four browser tests). Checks cover source deletion, group undo/redo, ordinary text copy/paste, token-image replacement, multiple-image rejection, empty canvas drops, ordered sidebar creation, filename grids, partial failure and preservation of the active player scene.
- JSON importer checkpoint: four focused test files passed 53 tests, including real redirect/decoded-image fixtures, immutable original registration/rollback, SQL-backed duplicate policies and durable receipt replay. Chromium and Firefox LAN HTTP importer regression both passed (2 tests), including locally stored public artwork, replay without duplication, renamed-asset lookup and preservation of edits/missing artwork.
- All-source catalog browser acceptance passed in both LAN browsers; public upstream loading completed 204 files with 4559 records across 109 sources and no warnings. Handout upload/preview, publish, late join, reload, hide/show and presenter disconnect passed in both LAN browsers. Controlled restart preserved original bytes, asset defaults, handout state and cached catalog search. Both LAN browsers passed pause/resume, sleeping-client wakeup, session carryover, viewer enforcement and viewer token movement. Both passed emulated touch selection, rotated-map/different-scale clipboard placement, concurrent-editor paste undo/redo, rejected cross-deployment grants, transformed canvas drops after Ctrl-pan, internal scene reorder and deletion during an upload. Physical mobile devices, live R2 and the Stripe-enabled plan boundary were not exercised; local development has Stripe disabled. Unit conversion coverage is broader than the browser grid-mode/fallback/snapping combinations.

### Remaining validation and optional follow-up

1. **External validation:** run live R2 checks with a disposable configured bucket, the Stripe-enabled plan boundary, and physical mobile device checks when those environments are available.
2. **Supplementary regression coverage:** expand browser combinations for grid modes, fallback/snapping and navigation during an upload. Current unit coverage and captured-destination/existing-token-only writes cover these rules; the recorded browser suite is not an exhaustive interaction matrix.
3. **Architecture documentation:** offer a consolidated document in `/docs`; existing realtime, hosting, cleanup documentation and affected skills already reflect the implementation.

## Planned files and modules

Exact new module names should follow repository conventions during implementation.

- `apps/web/src/lib/db/app/schema.ts`: assets, nullable marker origin, handout persistence fields.
- `apps/web/src/lib/server/assets/` and `apps/web/src/routes/api/assets/`: ownership, asset CRUD, placement inputs, import orchestration.
- `apps/web/src/lib/server/imports/fiveTools/`: catalog loading, format adapter, artwork resolution, import result types.
- `apps/web/src/lib/queries/assets.ts` and `apps/web/src/lib/queries/file.ts`: `createQuery` and `mutationFactory` integration.
- `apps/web/src/lib/server/file/`: immutable media writes, validated downloads, reference-safe cleanup.
- `apps/web/src/lib/components/Assets/`: library, import previews, search, edit, and placement UI with `types.ts` and barrel exports.
- `apps/web/src/lib/components/GameSession/{SceneSelector,MarkerManager,Shortcuts}.svelte` and `UpdateMapImage.svelte`: shared file operations, drop targets, asset actions, shortcuts.
- Editor route and session integration: selection state, clipboard events, context menus, transaction boundaries, destination positioning.
- `apps/web/src/lib/utils/`: clipboard validation/coordinate conversion and shared file-input utilities where reused.
- `packages/stage/src/lib/components/Stage/components/MarkerLayer/` and stage types/exports: multi-selection, target hit testing, selection gestures and outlines.
- `packages/stage/src/lib/components/Stage/helpers/mapSpace.ts`: reuse existing transforms; extend only where needed.
- `apps/web/src/lib/realtime/`, `apps/web/partykit/party.ts`, `apps/web/src/lib/server/realtime/`, party live-state API/query: handout state, serialization, persistence, and wakeup.
- `apps/web/src/lib/components/Handout/` and player/editor routes: presentation overlay and GM preview.
- Unit tests, `apps/web/tests/e2e/`, and stage playground controls where public stage APIs change.
- `.claude/skills/{web-data-patterns,stage-rendering}/SKILL.md`: update changed patterns and last-verified dates. Update relevant existing `/docs` references if implementation changes their contracts.

Prefer app-local components and existing UI primitives. If `packages/ui/` changes become necessary, the user must generate the required changeset; suggest a minor bump for new public components or capabilities. No changeset is needed solely for web/stage/spec changes.

## Acceptance criteria

| ID   | Observable result                                                                                                                                        |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AS-1 | A named asset and its stored artwork survive page reload and a controlled service/container restart after persistence completes                          |
| AS-2 | The owner can browse the same library from different parties/sessions; another user cannot enumerate or edit that personal library                       |
| AS-3 | Placing an asset twice creates unique token IDs; renaming or replacing artwork on one instance leaves the other instance and library unchanged           |
| AS-4 | Renaming/replacing a library asset affects future placements while existing tokens retain their instance values                                          |
| AS-5 | Deleting a library asset or its original source scene preserves surviving placed tokens and their referenced artwork                                     |
| AS-6 | Saving an existing token as an asset and placing multiple copies succeeds without importing statblocks or combat fields                                  |
| IM-1 | JSON import previews supported monsters, imports selected names/artwork, and creates reusable assets                                                     |
| IM-2 | In-app search finds monsters from the configured supported catalog and imports them without manual JSON editing                                          |
| IM-3 | Explicit and implicit artwork references resolve correctly; missing or unsupported artwork produces an explicit result and a replaceable placeholder     |
| IM-4 | Duplicate policies and retries work independently of renamed display names; successful items are not duplicated by retry                                 |
| IM-5 | Imported artwork remains usable after the upstream source becomes unavailable                                                                            |
| CP-1 | Modifier-click and rectangle selection select multiple editor tokens; touch sidebar controls provide an equivalent selection path                        |
| CP-2 | Copying a group and pasting in another scene/session/tab on the same deployment creates independent tokens with fresh IDs                                |
| CP-3 | A copied group can still be pasted after source tokens are deleted; mutable notes are independent copies                                                 |
| CP-4 | Relative formation survives different grid resolutions, map rotations, and coordinate modes according to the documented conversion policy                |
| CP-5 | Cursor placement, viewport fallback, repeated-paste offsets, and group-anchor snapping work predictably                                                  |
| CP-6 | One undo removes an entire paste, redo restores it, and unrelated concurrent editor changes remain intact                                                |
| CP-7 | Copy/paste works in two tabs on LAN HTTP in Chromium and Firefox; ordinary text-editor clipboard behavior is preserved                                   |
| CP-8 | Invalid, oversized, inaccessible-media, and foreign-deployment clipboard payloads create no tokens and provide appropriate feedback                      |
| DD-1 | Dropping images into the sidebar creates new scenes in file order without activating them for players or breaking scene reordering                       |
| DD-2 | Filename grid detection and scene limits apply equally to picker and drop workflows; batch partial failures are reported                                 |
| DD-3 | Dropping an image onto a sidebar token preview or a canvas token updates only that token                                                                 |
| DD-4 | Canvas targeting remains correct under pan, zoom, scene rotation, and map-defined grids                                                                  |
| DD-5 | Unsupported/multiple token files, interrupted uploads, scene changes, and target deletion do not mutate the wrong object or navigate away                |
| HO-1 | GM show/hide actions display/remove the same handout in an already connected player map view                                                             |
| HO-2 | The original image fits without cropping; showing/hiding preserves map, camera, fog, and token state                                                     |
| HO-3 | Late join/reconnect restores the active handout; replacement displays the new presentation                                                               |
| HO-4 | Sleeping player views wake for show/hide changes and do not retain a stale handout                                                                       |
| HO-5 | Scene/session switching retains the handout; pause takes precedence and resume restores it; presenter disconnect retains it                              |
| HO-6 | Player gestures cannot move underlying map content through the overlay or globally dismiss the presentation                                              |
| ST-1 | Local storage and R2 paths preserve originals and do not overwrite artwork shared by copied/placed tokens                                                |
| ST-2 | Server validation rejects unsupported/oversized media and unauthorized asset operations; import downloading respects configured destination restrictions |
| ST-3 | Cleanup preserves every image still referenced by a library asset, placed token, or active handout                                                       |

## Testing strategy and completion gates

Use focused unit tests for adapter fixtures, token URL resolution, duplicate/idempotency behavior, clipboard schema validation, coordinate conversion, selection state, and immutable media/reference handling. Include malformed payloads, punctuation/non-ASCII monster names, absent images, reference cycles, and invalid destination references.

Use integration tests for owner authorization, instance independence, import retries, delete semantics, and handout wire/persistence round trips. Test storage operations with temporary files and mocked R2 boundaries rather than production media.

Use Playwright with editor/player contexts and two editor tabs for actual clipboard events, group paste/undo, image file drops, reconnects, and handout wakeup. Cover Chromium and Firefox over the LAN HTTP configuration, plus touch selection where supported. Include a rotated map and different grid scales. Do not treat synthetic keyboard dispatch alone as proof of native clipboard behavior.

Verify persistence with an operator-initialized local dataset: create assets/tokens, allow persistence to complete, restart services, and check metadata and artwork. Record any unavailable cloud/browser/device verification separately; do not claim checks that were not run.

Required gates: `pnpm run check` and `pnpm run format-check`. Run relevant existing tests and the new behavioral tests. Do not use Svelte MCP autofixer/validator tools. Update project skills when their documented patterns change, and keep existing architecture docs consistent with code.

Repository defaults reserve migration generation/application and direct database commands for the operator. For this implementation, the user explicitly authorized the agent to generate/apply migrations in development; the asset migration is already applied and verified. Preserve that development-only scope. Do not run `pnpm run push` or alter another environment without authorization. Do not run release/publish commands or write changesets on the user's behalf.

Completion requires all in-scope phases and acceptance criteria, with any unavailable verification explicitly recorded. A JSON-only importer, single-token clipboard, sidebar-only drop support, or a GM-local image preview is an intermediate deliverable, not completion of this spec.

## Potential edge cases and material risks

- Clipboard snapshots outlive source tokens, but their media must remain available; manual cleanup must account for surviving asset/token/handout references and durable clipboard grants; abandoned staging files have no automatic expiry.
- A clipboard copied before its source's asset deletion must paste as a standalone token if the origin link no longer exists.
- Concurrent token deletion/image replacement must not resurrect a deleted token or overwrite another user's newer image change without an explicit conflict policy.
- Large image decode costs require server pixel/dimension limits as well as byte limits. Do not send image bytes through Y.js or clipboard payloads.
- Existing media URLs may be cropped, transformed, or versioned; resolve original storage references without destroying valid version parameters.
- Existing room sharing and local media GET behavior do not establish owner-only media secrecy. Personal-library authorization must be enforced, and any stronger artwork secrecy requirement would require a separate media/room authorization design.
- Imported catalog conventions can drift. Keep the adapter isolated, configured, fixture-tested, and explicit about unsupported input.
- A failed image upload must not clear the current image. A failed handout image load must leave the GM able to hide or replace the presentation.
- Rapid show/hide/show operations must resolve to the latest shared presentation, including clients waking from sleep.
- A service crash during the existing debounced persistence window is distinct from a completed durable save; this scope must not imply synchronous durability for every gesture.

## Follow-up work

After the agreed scope is complete, consider portable asset packages containing metadata plus media, party-shared libraries, player-openable handout collections, and optional explicit propagation of library edits to selected instances. Statblocks/combat support require a separate spec.

Offer an architecture document in `/docs` after implementation, covering asset/instance relationships, immutable media, clipboard coordinates, catalog integration, and handout realtime flow.

### Retention and final acceptance checkpoint

The user delegated the cleanup choice. A permanent `clipboard_artwork` ledger is persisted before grant issuance; migration 0055 protects all previously registered artwork. Unknown originals remain retained. Manual cleanup defaults to a non-destructive inventory, protects stored content and foreign-key references, and requires offline review before explicit deletion. Development backup before migration: `development-20261005T212509Z-2558784.tar.gz`. Sixteen focused tests passed, including real temporary SQLite/filesystem command behavior. A stopped development inventory recorded 759 objects without deleting application media.

A controlled development restart preserved original bytes, asset appearance defaults, active handout and catalog search through persisted cache. Chromium and Firefox both passed handout role checks and pause/sleep-wakeup checks, and personal library ownership/instance independence/future placement/deletion workflows. Actual PartyKit viewer write rejection and game-session movement were verified; both browsers also passed player overlay interception and subsequent token movement, session carryover, native clipboard retention, touch/concurrent paste checks and transformed drop/reorder checks. Touch checks exposed zero-sized raw checkboxes and a collapsed list in short mobile panes; styled checkbox and mobile outer-scrolling fixes are included.

### Final local verification — 2026-10-06

The focused feature suite passed 178 tests across 22 files. Browser checkpoints cover Chromium and Firefox on LAN HTTP; counts overlap and should not be summed. Acceptance exposed and fixed duplicate Ctrl-pan handling: the pointer manager now owns the pan gesture and uses client-coordinate deltas. The transformed drop test verifies that grid/tokens move with the view while map offsets stay unchanged. Internal reorder waits for batch creation/navigation to finish and starts from the drag handle.

Final `pnpm run check` and `pnpm run format-check` passed. Web validation reported zero errors and 44 existing warnings in 17 files; all workspace check tasks passed. `git diff --check`, shell syntax and cleanup script syntax checks also passed.

Manual cleanup was verified using temporary SQLite/filesystem fixtures and a read-only development inventory. No application media was deleted. The recorded development inventory predates the strengthened deployment/database/storage identity binding and must be regenerated before any apply.
