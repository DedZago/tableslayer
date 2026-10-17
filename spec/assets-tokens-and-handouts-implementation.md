# Assets, tokens, and handouts implementation checkpoints

Date: 2026-10-05

This records intermediate implementation, not completion of `assets-tokens-and-handouts.md`.

## Confirmed decisions

- Use public 5etools upstream by default; retain configuration for mirrors.
- Persist imported asset information and downloaded artwork in Table Slayer. Created assets must work without upstream.
- Admins and editors may create scenes and show/hide handouts.
- Shift-drag selects groups; Ctrl-drag pans the whole view, including grid and tokens.
- Pasted groups align with the destination map rotation.
- Abandoned staging uploads remain until manual cleanup; no automatic expiry or scheduled deletion.
- Authenticate party-document connections. Viewers read party state; admins/editors write it. Game-session token movement stays available to players.

## First checkpoint: media and personal library

Implemented code:

- Shared `uploadMediaFile` operation; backend-generated, owner-scoped staging keys.
- Fresh stored original on registration, independent of reusable signed staging URLs.
- Server image byte, MIME, pixel and full-decode validation. Local uploads and browser uploads share byte limits.
- Personal asset schema, owner-authorized library search/create/edit/delete, save current token snapshot as asset, quantity placement, and editor sidebar library.
- Marker asset origin with `ON DELETE SET NULL`. Persistence drops stale origin IDs after asset/owner deletion.
- Placement creates independent values and fresh IDs in one isolated undo transaction. Enemy visibility defaults to DM-only.
- Stored image scale now survives rendering/editing instead of being replaced by token size or a constant.
- Signed party connection tickets with fresh membership checks. Viewer party connections are read-only; party BroadcastChannel transport is disabled to prevent bypass through a writable peer tab.

Media retention at this checkpoint:

- Successful registration removes its staging object.
- Failed registration rolls back file metadata and removes only its newly generated original.
- Cancelled/invalid staged uploads remain in `uploads/` until an operator performs reference-aware cleanup. No automatic sweep or media lifecycle policy is enabled.
- Library/owner deletion never deletes stored artwork. Referenced originals and legacy media remain available.
- A manual orphan inventory/cleanup workflow across the final reference types still needs completion within the full specification; abandoned staging files have no automatic expiry.
- Existing video upload limits/workflows are retained; decoded validation here applies to image uploads.

## Development schema applied

The user explicitly authorized this agent to generate/apply migrations to the development environment on 2026-10-05, overriding the default operator-only rule for this work.

Generated `0052_cheerful_sunspot.sql` using the running development container's pinned pnpm 9.11.0. Reviewed its scope: only the `asset` table/indexes and nullable `marker.asset_id`. Corrected drizzle-kit's generated `ADD COLUMN` SQL to retain the schema's `ON DELETE SET NULL` action; the generated snapshot already records that action.

Stopped the development container and saved a complete development backup at `/home/dede/Documents/MEGA/obsidian/Dede/DnD/TableSlayer/backups/development-20261005T125604Z-1994780.tar.gz`. Applied migrations through `containers/host.sh migrate development` and verified the installed table's 17 columns and marker foreign key's `SET NULL` action. Also executed the generated SQL against an isolated in-memory SQLite fixture: deleting the asset or its owner preserves the token/image and clears its origin.

The development service was restarted after application. Account/browser workflow verification remains separate from the successful migration.

## Verification of the first checkpoint

- `pnpm run check`: passed; web reports zero errors and 44 warnings. Other workspace checks passed from Turbo cache.
- `pnpm run format-check`: passed.
- Nine relevant Vitest files: 58 tests passed, covering immutable local/R2 originals, failed registration cleanup, malformed images, owner/destination authorization, independent placements, live-token snapshot saving, delete linkage, party tickets/read-only connections, image scale, document behavior, and wire serialization.
- `git diff --check`: passed.
- Host tooling used installed pnpm 10.30.3 with package-manager auto-download disabled, and Node 24 on the child-command PATH. The launcher still reports its embedded Node 20 engine warning; the pinned pnpm 9.11.0 was not installed by this task.
- The development migration and installed schema were verified, and the service was restarted. Browser campaign workflows, artwork restart persistence, and live R2 verification remain unverified.

## Current status and remaining scope

Core code for A–G and manual cleanup is implemented. Development migrations 0052–0055 are backed up and applied. Local acceptance includes controlled restart, personal library independence, handout authorization/pause/wakeup/carryover, player movement, native clipboard retention, touch/concurrent paste and transformed drop/reorder workflows in Chromium and Firefox.

Remaining validation requires environments not available here: live R2, a Stripe-enabled plan boundary and physical mobile devices. Supplementary browser grid-mode/fallback/snapping and in-flight navigation combinations are also documented; unit coverage is broader than the browser matrix. No automatic cleanup or application-media deletion was performed. The focused feature suite passed 178 tests across 22 files.

The main [specification plan](assets-tokens-and-handouts.md#implementation-status--2026-10-05) contains the current per-phase status and remaining acceptance boundaries. Test counts below are checkpoint results and overlap; do not sum them into a unique total.

## Selection gesture checkpoint

User-approved desktop gestures: Shift-drag adds selectable token centers to a local group selection; Shift-click toggles an individual token. Ctrl-drag pans the whole scene, including map, grid and tokens. Shift-drag no longer changes the map image offset. Existing touch view gestures and explicit map keyboard/wheel controls remain available.

The editor keeps selected IDs separately from its edited token and does not persist the selection. Scene changes clear it; remote deletion/visibility changes prune it. The stage exposes client-coordinate hit testing and rectangle selection using the rendered map/scene transforms and current surface visibility. Sidebar checkboxes, select-all and clear-selection provide touch access. Ctrl/Meta mouse-downs yield to view controls instead of starting a layer edit.

Selection geometry tests cover reverse drag directions, boundary centers, overlapping tokens, unequal token sizes and empty space. Group clipboard support was pending at this selection checkpoint and is implemented in the following clipboard checkpoint.

Verification of this checkpoint: `pnpm run check` passed (web: zero errors, 44 existing warnings), `pnpm run format-check` passed, and seven selection geometry tests passed. The local docs stage rendered in installed Chromium and completed token placement and Ctrl-drag with no page runtime errors. This smoke test does not verify the authenticated editor marquee/sidebar workflow or portable clipboard acceptance criteria.

## Portable group clipboard checkpoint

The user chose destination-map alignment on 2026-10-05. Copied groups use unrotated map axes: MapDefined token coordinates already use those axes; FillSpace source offsets are inverse-rotated by the source map rotation. When both grids are usable, relative offsets are measured in source grid cells and expanded by the destination cell size. MapDefined destinations store these values in map coordinates and rendering applies the destination rotation; FillSpace destinations explicitly rotate offsets by the destination map rotation. Camera seating rotation and camera zoom are view transforms and never become clipboard offsets.

If either grid is unusable, each snapshot's unrotated display-pixel offset preserves formation and apparent size in the destination display coordinate system. MapDefined source offsets multiply by map zoom; MapDefined destinations divide by their map zoom. FillSpace uses display pixels directly. The destination group anchor uses the last valid map pointer position, falling back to viewport center. It snaps once through the actual renderer grid helper. Repeated pastes advance diagonally by one destination cell in map axes, or 40 display pixels without a usable grid.

The strict version-1 JSON envelope includes deployment identity, coordinate basis, source anchor, independent token/note snapshots, original artwork references and a signed artwork grant. Source token/scene IDs and pinned tooltips are excluded. Payloads are limited to 100 tokens and 1 MiB; notes have bounded depth/node count. Copy authorization prepares through a frontend query because native clipboard-event writes must be synchronous. Until authorization is ready, copy reports that it should be retried. Native copy/paste uses recognizable `text/plain` JSON and leaves text/rich-text editors alone.

Server grants cover only artwork the copying editor owns through media/library metadata or can access through the authorized source scene. Grants are bound to deployment secret and artwork; they remain valid after source tokens disappear. Changing deployment secret invalidates old clipboard grants. Paste checks current destination admin/editor access, envelope size/schema, grant coverage, and current destination-user asset ownership. Missing or inaccessible asset origins become standalone tokens. Each returned row has a fresh ID and independent note data. The client creates the whole group in one isolated undo transaction and cancels a pending paste if its destination changed.

Originals are retained at this checkpoint, including copied artwork whose source token was deleted. The planned manual cleanup workflow must preserve this clipboard behavior rather than treating source deletion as proof that its original can be removed.

Four focused test files passed 38 tests, covering snapshots/proxy-note cloning, map rotation, grid changes, fallback coordinates, one-time anchor snapping, repeat offsets, bounded/strict payloads, grants/tampering/deployments, source/destination authorization, lost origin links, and group undo alongside another editor's changes. Chromium and Firefox loopback-HTTP native clipboard workflows passed across two authenticated tabs; Firefox also exercised uploaded original artwork. Chromium and Firefox also passed native clipboard workflows on actual non-secure LAN HTTP (`secureContext: false`), and the tracked two-browser regression passed (2 tests). Normal text-field copy/paste remained available.

Development browser fixture metadata, private test account/state, copied envelopes, screenshots and results are saved locally under ignored `.local-data/clipboard-verification/`. No existing campaign data was changed by these checks.

### Image-drop implementation checkpoint

The user confirmed that scene creation is limited to admins/editors. The scene API now awaits fresh role authorization and binds the supplied party to the actual destination session. Sidebar picker/drop batches share sequential creation, filename grid detection, captured destination, partial-failure feedback, existing plan capacity, and navigation to the first successful scene after completion. They do not activate scenes for players. Preview and canvas replacement share one captured-scene/token upload operation, validate one supported image, authorize artwork on the server, and perform an atomic existing-token-only write. Canvas highlighting uses the renderer's existing transformed hit test; empty canvas drops do not create objects. Chromium and Firefox LAN HTTP image-drop regression tests both passed (2 tests): preview and transformed canvas replacements, multiple-image rejection, empty-canvas guidance, ordered sidebar creation, invalid-file partial failure, filename grid counts, and preservation of the existing active player scene. The existing native clipboard regression also passed again in both browsers after the shared picker/upload changes (2 tests), bringing this checkpoint to 4 passing LAN browser tests. Two focused unit files passed 23 tests, including fresh role/session/party authorization and token deletion before artwork completion. `pnpm run check` passed with existing warnings and `pnpm run format-check` passed.

### Public upstream investigation saved locally

Downloaded renderer, parser, bestiary index, representative bestiary and artwork metadata are retained in ignored `.local-data/5etools-upstream/` with URL provenance in `sources.json`. The site's index request returned HTTP 403; the public upstream source repository supplied the index and representative data. A small metadata/artwork-only fixture is saved beside the adapter; no statblock text was included in that fixture. The upstream name-normalization helper and public Goblin token image were also pulled and saved locally with URL provenance.

Cleanup policy confirmed on 2026-10-05: abandoned upload staging files remain until manual cleanup. No automatic staging expiry or scheduled deletion will be introduced. Provide a manual cleanup workflow with a reviewable inventory; preserve original artwork referenced by assets, tokens, handouts and durable clipboard grants.

### JSON importer implementation checkpoint

The personal library now provides bestiary JSON preview, name/source filtering, single/multiple selection, duplicate skip/update/create-another controls and retry of failed items. Batches contain at most 100 selected items; completed rows remain marked so subsequent batches do not duplicate them. The adapter `bestiary-art-v1` supports the upstream token precedence (`tokenUrl`, `token`, `tokenHref`, implicit source/name), Unicode token-name normalization, inline portraits, matched monsterFluff, available `_copy` bases and inline `_monsterFluff` references. Missing bases, cycles/depth limits and unsupported artwork inheritance directives report manual-replacement guidance. Statblocks and notes are not imported.

User decisions: duplicate updates preserve editable names and all appearance defaults; refresh only provenance and available artwork. Each absent upstream artwork candidate preserves its existing reference. Download failures do not update the asset. Stable owner/upstream identity finds duplicates after renaming. Durable receipts bind each owner/request ID to an input fingerprint and store successful per-item outcomes atomically with asset metadata; response-loss retries replay the receipt, and changed input requires a new request ID. Receipts outlive asset deletion to prevent an old request from recreating it.

Artwork downloads validate every URL/redirect, disallow credentials/non-HTTP schemes, require public HTTPS for arbitrary destinations, validate DNS addresses and pin the selected address, enforce a shared 20-second network deadline, byte limits, image MIME and full decode/pixel validation. An explicitly configured `FIVETOOLS_IMAGE_BASE_URL` mirror is trusted only within its exact origin/base path. Imports store fresh immutable originals through either local storage or R2 and register ownership transactionally. Metadata-registration failure removes only the new unregistered original. Originals retained after later import failure remain for the planned manual inventory/cleanup; no automatic deletion is added.

Development migration `0053_famous_mac_gargan.sql` adds the owner/request primary-keyed receipt table. It was generated/reviewed and applied under the user's explicit development authorization after backup `/home/dede/Documents/MEGA/obsidian/Dede/DnD/TableSlayer/backups/development-20261005T201515Z-2432645.tar.gz`.

Four focused unit files passed 53 tests, including adapter fixtures, public/private address and mirror-path checks, real HTTP redirect/decoded-image fixtures, original registration/rollback, and real in-memory SQLite import/receipt behavior. Chromium and Firefox LAN HTTP regression passed (2 tests, 16.2 seconds): file preview/selection, public artwork storage and serving, placeholder creation, response replay without duplication, duplicate lookup after rename, and updates preserving name/defaults/missing artwork. The first browser attempt omitted opening marker mode, which contains the library; the corrected regression passed. Sandbox loopback binding was unavailable for downloader fixtures; the tests passed in the development container. Full workspace checks passed with zero errors and existing warnings; formatting passed. Live R2, controlled restart, full catalog dependencies and handouts remain unverified.

## Catalog and handout checkpoints

The catalog searches all sources by default and supports a source filter. Bounded loading persists immutable source JSON and provenance revisions locally or through the R2 abstraction; explicit refresh replaces only cache pointers. Actual public upstream loading completed 204 files, 4559 records and 109 sources without warnings. Chromium and Firefox LAN catalog tests passed, including shared importer selection and independently stored original portrait/token artwork. Upstream nullable fluff image arrays are accepted.

Handouts now use a presentation-only party descriptor, persisted in `party.active_handout` through PartyKit. Server preparation freshly checks admin/editor membership and authorizes asset ownership, uploaded originals or markers within the destination party. Controls provide local upload/asset/token preview, optional title, show and hide. The player overlay renders original artwork with contain sizing, retains state across client transitions and compares presentation IDs when polling asleep. Pause retains the descriptor and suppresses the handout until resume.

Development migration `0054_glorious_carlie_cooper.sql` was reviewed and applied after backup `development-20261005T203645Z-2478528.tar.gz`; its column was verified after daemon recovery. Six focused unit files passed 84 tests at the initial handout checkpoint. Chromium and Firefox LAN handout tests passed (2 tests): local preview, publishing, late join, reload, hide/show and presenter disconnect. Browser pause/resume, sleeping-client wakeup, session carryover, viewer enforcement and controlled restart remain outstanding.

The user authorized repairing party member role escalation before continuing. Role updates and invitation management now require awaited admin checks. Invitation creation propagates authorization errors instead of swallowing them. Removal of other members is admin-only while self-leave retains current membership and last-admin protection. Authorization regression tests cover these paths.

## Permanent clipboard retention and offline cleanup

The user delegated policy selection. Clipboard grants now persist a global permanent artwork location ledger before issuance; failures do not issue grants. Migration 0055 seeds every previously registered file location, without ownership/file foreign keys that could cascade away. Unregistered originals are retained conservatively. The development migration was applied after backup `development-20261005T212509Z-2558784.tar.gz`.

The manual command creates a private inventory, with every delete flag initially false. Offline apply rescans stored text/foreign-key references and object fingerprints; it protects active content, clipboard/legacy locations, unknown originals, other namespaces and objects under 24 hours old. Local files use SHA-256 checks; R2 objects use conditional ETags. No automatic sweep exists. The host wrapper refuses running stacks. Documentation: [manual workflow](../docs/media-cleanup.md). Sixteen focused tests passed, including actual temporary SQLite/filesystem command execution, private output, symlink refusal, stale plans and metadata preservation on storage failure. A stopped development inventory covered 759 objects without deleting media.

Controlled restart acceptance passed for original byte identity, asset defaults, persisted handout and catalog search. LAN Chromium/Firefox role/pause/sleep checks passed. Both browsers passed library ownership, independent quantity placement and instance edits, saving a live token, future placement after library rename, and preservation after library deletion. Actual PartyKit read-only viewer rejection and writable game-session movement were checked. Touch acceptance identified a raw checkbox with zero size and collapsed mobile list; the fix uses the existing styled checkbox and natural mobile content height through the outer tools scroller. Both browsers subsequently passed clipboard/drop/player edge checks. Duplicate Ctrl-pan handling found during transformed drops was removed; the pointer manager is the single pan path with client-coordinate deltas. Reorder acceptance waits for batch navigation to finish before using the drag handle.
