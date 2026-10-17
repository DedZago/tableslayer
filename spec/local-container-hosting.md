# Local container hosting

## Problem

The current images require cloud services and do not provide a hot-reload development workspace. Campaign databases, maps, uploads, and realtime snapshots must survive container replacement and be portable between Linux hosts.

## Requirements

- Linux containers usable with Docker Compose and optional Dev Containers editors.
- Local-first operation without Turso, Cloudflare, email, billing, or OAuth accounts; retain existing cloud configuration paths.
- Open email/password registration over a trusted LAN, with no outgoing email.
- Separate development and release datasets below a configurable absolute host directory.
- Manual consistent backup/restore, with portable archives suitable for Drive, Dropbox, or MEGA.
- No automatic migrations or direct database commands by the implementation agent. The operator initializes and upgrades the schema explicitly.

## Proposed solution

Use the existing libSQL client with a local SQLite file, a filesystem upload backend, and PartyKit's persistent local runtime. Serve assets and Cloudflare-style image routes from SvelteKit so existing map and thumbnail consumers continue to work. Use a pinned Node 22 image and the repository's pinned pnpm version. Build the release app separately from its writable data.

Filesystem storage keeps ordinary files portable and avoids running a separate object-storage database. An S3-compatible container would preserve the existing SDK but adds another service and storage format; existing R2 remains available for operators who prefer cloud assets.

## Implementation

Create a multi-stage container image, development/release Compose files, an optional editor devcontainer, operator configuration and backup helpers, and a self-hosting guide. Add explicit local database initialization, local asset storage and signed upload handling, local image metadata/resizing, LAN HTTP cookie support, and separate internal/public realtime addresses. Preserve cloud defaults when local settings are absent. Update documented server patterns and add an architecture document.

## Files

- `containers/`, `compose.dev.yaml`, `compose.release.yaml`, `.devcontainer/`
- `.dockerignore`, `.gitignore`, `README.md`, `apps/web/.env-example`
- `apps/web/src/lib/db/app/index.ts`
- `apps/web/src/lib/server/file/` and `apps/web/src/routes/assets/[...path]/`
- `apps/web/src/lib/server/auth.ts`, realtime connection configuration and asset URL consumers
- Asset import tooling, dependencies/lockfile as required
- `docs/local-container-hosting.md`, `.claude/skills/web-data-patterns/SKILL.md`

## Validation

Validate both Compose configurations, shell syntax, immutable dependency installation, container builds, `pnpm run check`, and `pnpm run format-check`. Test local asset traversal rejection, signed upload authorization, image metadata, backups and non-destructive restore. Runtime campaign/login/restart validation requires operator-run migrations first; report this boundary clearly.

## Edge cases

- Synchronizing open SQLite/WAL and PartyKit files can corrupt a dataset. Pause live-folder sync while running; prefer syncing completed backup archives. Never run two hosts against one synced dataset.
- LAN clients need the host's LAN address rather than localhost for realtime. Containers need a separate internal app/realtime URL.
- HTTP LAN sessions need explicitly configured cookie security; cloud defaults remain secure.
- Static illustrations and LUTs absent from Git require a one-time asset download or an existing local copy. Subsequent operation uses the local copies.
- Restore must refuse a running target or overwrite of existing data; use a new empty data root.
- Local PartyKit uses its development emulator, suitable here for a trusted personal LAN, rather than a production Cloudflare deployment.
