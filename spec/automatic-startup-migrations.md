# Automatic startup migrations (local containers)

## Problem

The local container stacks (`compose.release.yaml`, `compose.dev.yaml`) only migrate when the operator runs a separate
step (`make dev` / `make release` call `containers/host.sh migrate <mode>` in a throwaway container). If you forget it,
or start the stack another way (`host.sh up`, the devcontainer, `docker compose up`), the app runs on an outdated
schema.

## Goals

- When the `web` service (release) or the `dev` container starts, check the database against the migrations in the
  image.
- Database up to date: log one line and start as usual. No write transaction, no backup, no `migrate()` call.
- Database behind: copy the SQLite file first, apply only the pending migrations, then start.
- Migration or backup fails: the container exits non-zero and the app never starts on a half-known schema.

## Non-goals

- Fly / `DockerfileWeb` / remote Turso. That path keeps its build-time Turbo `web#migrate` and is not changed.
- The `party` service never migrates.
- No backup pruning.

## Detection

Drizzle's libsql migrator (`drizzle-orm/sqlite-core/dialect.js`) applies every journal entry whose `when` (folderMillis)
is greater than the newest `created_at` in `__drizzle_migrations`. The check uses the same rule, so "up to date" here
means "`migrate()` would do nothing":

1. Read `src/lib/db/app/migrations/meta/_journal.json`; entries have `when` and `tag`.
2. If `__drizzle_migrations` does not exist (look it up in `sqlite_master`), every entry is pending.
3. Otherwise `applied = MAX(created_at)`; pending = entries with `when > applied`.
4. No pending entries: log `Database schema up to date (<latest tag>)` and exit 0. If `applied` is newer than the
   newest journal entry, also log a warning that the database is newer than this build (a downgrade). Don't fail.

## Backup (only when something is pending)

- Only for `file:` URLs, and only when the database already has user tables (a brand-new empty file needs no backup).
- Use `VACUUM INTO '<dir>/backups/app-<UTC yyyymmddThhmmssZ>-before-<first pending tag>.db'` with the same libsql
  client. It writes a consistent snapshot even with WAL files present. `<dir>` is the database file's directory (for
  the stacks, `/data/database/backups/`, which lives on the host bind mount). Escape `'` in the path.
- Backup fails: log it and exit non-zero without migrating.

## Apply

- `migrate(drizzle(client), { migrationsFolder })`. Drizzle runs all pending migrations in one transaction, so a failure
  rolls back.
- Log the tags that were applied, then exit 0. On error, log it and exit 1.
- For `file:` URLs, create the database directory first (as `src/lib/db/app/index.ts` does), so a fresh data root works.

## Implementation

| File                                        | Change                                                                                                                                                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web/scripts/migrate.js`               | Add check → backup → apply as above. Keep it the single entry point: `pnpm --filter web migrate` and `host.sh migrate` use it as well. Paths stay relative to `apps/web` (cwd).                                                                  |
| `containers/Dockerfile`                     | `release` stage: `CMD ["sh", "-c", "node scripts/migrate.js && exec node build"]`. `exec` makes node the child of the compose `init` (tini) so signals still reach it. `party` and `host.sh run …` override the command, so they are unaffected. |
| `containers/dev.sh`                         | After `pnpm install --frozen-lockfile`, run `pnpm --filter web migrate` (fails the container via `set -e`).                                                                                                                                      |
| `Makefile`                                  | Drop the `$(HOST) migrate <mode>` lines from `dev` and `release`; update help text. `host.sh migrate` stays for manual use.                                                                                                                      |
| `docs/local-container-hosting.md`           | Replace "Containers never apply migrations automatically" and the manual init/upgrade steps with the new behavior, the backup location, and the failure behavior.                                                                                |
| `.claude/skills/web-data-patterns/SKILL.md` | Note that local containers apply pending migrations at startup via `scripts/migrate.js`. Claude still never generates or runs migrations (D-3). Bump "last verified".                                                                            |

## Testing

Use temp SQLite files in a scratch directory, never `DATA_ROOT`:

1. Fresh file: every migration applies, no backup is written, the second run logs "up to date" and writes nothing (no new backup,
   file mtime unchanged).
2. Outdated: build a DB from a copy of the migrations folder with the last journal entry removed, then run the real
   script. Expect one backup and only the last tag applied. Run again: up to date.
3. Failure: make the pending migration fail (e.g. a DB where its column already exists but the row is missing). Expect a non-zero exit, the backup
   present, and `__drizzle_migrations` unchanged.
4. `pnpm run check` and `pnpm run format-check` pass.

## Edge cases

- Journal entries with an older `when` added after a newer one are skipped, the same as drizzle does today.
- Two stacks never share a database (separate `development/` and `release/` data folders); a single instance per DB is
  already a documented requirement.
- `TURSO_APP_DB_URL` missing: exit non-zero (unchanged).
