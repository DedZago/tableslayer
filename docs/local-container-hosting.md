# Local development and self-hosting

Table Slayer can run entirely on one Linux host. Containers provide Node 22 and pnpm 9.11.0; installing Node on the host is unnecessary. Use Docker with Compose v2 or a compatible Docker CLI connected to rootless Podman. The container runtime must already be running. Any editor works; editors with Dev Containers support can open `.devcontainer/devcontainer.json`.

## First setup

Choose an **absolute storage directory outside the repository** and the Linux machine's LAN IPv4 address or a hostname that every player can resolve. Reserve its DHCP address if possible. Replace these examples with your own values:

```sh
./containers/host.sh setup /home/you/TableSlayerData 192.168.1.50
```

This creates an ignored root `.env` and separate folders:

```text
TableSlayerData/
  development/
    database/app.db
    assets/
    realtime/
  release/
    database/app.db
    assets/
    realtime/
  backups/
```

The root `.env` configures Compose; `apps/web/.env` is for the original host-based workflow. The containers set their own local configuration and do not need `apps/web/.env`. Keep that file absent or avoid adding optional cloud keys to it if you want entirely local development. Root `.env` contains a generated shared secret: back it up privately. Never commit it.

`BIND_ADDRESS=0.0.0.0` makes the app available on network interfaces. To restrict access to one interface, set it to your LAN IP. Do not forward these ports on your router. Registration is open to people who can reach the app. Login still uses email-address-shaped identifiers and passwords, but email verification, email delivery, Stripe, Google login, and Turnstile are not required. Without Stripe, new parties receive the existing lifetime plan. Password recovery by email is unavailable.

## Development

Build the development image, then **run the existing migrations yourself** to initialize its SQLite file:

```sh
docker compose -f compose.dev.yaml build
./containers/host.sh migrate development
./containers/host.sh assets development
./containers/host.sh up development
```

The assets command downloads the repository's manifest of illustrations, default maps, and LUT files once from its existing asset CDN. It skips files already present, so retries resume safely. This requires internet during initial setup; no cloud account is required. If you already have these assets, copy their manifest paths directly into `development/assets/` instead. Check that `map/pirateking-30x60.jpg` is present before creating scenes.

Open `http://192.168.1.50:5174` for the app and `http://192.168.1.50:5173` for UI docs. PartyKit uses port 1999. The development service installs the lockfile, packages workspace dependencies, and starts watchers for web, UI, and stage. Editing host files triggers hot reload. Logs and shutdown:

```sh
./containers/host.sh logs development
./containers/host.sh down development
```

For an editor devcontainer, do the setup and migration steps above first, stop any standalone development stack, then reopen the repository in its container. It uses the same Compose service and data folder. Command-line development does not depend on an editor extension. Workspace dependency caches live in named container volumes; campaign data lives in your selected directory. The development container runs as root inside the container; on rootful Docker generated files can need ownership adjustment on the host. Rootless Podman maps container root to your user. Bind mounts use `:z` for SELinux sharing.

The UI documentation contains upstream examples that still load sample maps from the original CDN; campaign assets and the actual application use your local backend.

## Release

The release image serves the built Node application rather than Vite. Build and initialize the **separate release database**:

```sh
docker compose -f compose.release.yaml build
./containers/host.sh migrate release
./containers/host.sh assets release
./containers/host.sh up release
```

Open `http://192.168.1.50:8080`. Local realtime uses port 2000. Allow these ports through your host firewall for your LAN clients; development additionally needs 5173, 5174, and 1999. Ports for the database and an object-store service are unnecessary: both are embedded/local. Release services restart after a host reboot when your runtime starts, and data survives container replacement or `down`.

The release image deliberately keeps the migration CLI and PartyKit dependencies so operator migrations and the realtime service use the same built source. Image builds do not run migrations, contact a campaign database, or include `.env` files. The production app uses the existing Node adapter. PartyKit runs its persistent **local development emulator**, not Cloudflare Workers; this is a personal trusted-LAN deployment, not an internet production or multi-host installation. Do not run multiple app instances against these files.

Wait for edits to settle before stopping the app. PartyKit persists its Y.js snapshots to `realtime/` and sends application database updates through authenticated internal callbacks. Keeping **both** directories ensures room state survives restarts even if the last database update was pending.

## Manual backups and restore

End the session and allow active writes to finish, then run:

```sh
./containers/host.sh backup release
# Or: ./containers/host.sh backup development
```

The helper stops the selected stack, archives its complete database/assets/realtime folder, and restarts services that were running. It publishes the archive atomically under `DATA_ROOT/backups/` only after success. A failed backup still attempts to restart the previous services. Keep `.env` separately: it contains deployment settings and the signing/callback secret. Archives contain campaign data and account records, so keep them private.

Restore into a **new, nonexistent directory**, preserving existing data:

```sh
./containers/host.sh restore release /path/to/release-backup.tar.gz /home/you/TableSlayerRestored
./containers/host.sh down release
```

Change `DATA_ROOT` in `.env` to `/home/you/TableSlayerRestored`, then:

```sh
./containers/host.sh up release
```

The archive retains its mode directory, so release backups restore as `release/` and development backups as `development/`. Restore refuses links, special files, traversal paths, and an existing destination. A restored root initially contains only the restored mode; create the other mode's folders if you also need it. Restore using the same source version first. Schema upgrades require an explicit migration step and a fresh backup; never downgrade the app against a newer schema.

## Google Drive, Dropbox, and MEGA

You may choose a directory managed by your sync client for `DATA_ROOT`. **Pause synchronization of its live `development/` and `release/` folders while the app runs.** SQLite writes across several files, and realtime snapshots have their own database files; a sync client copying them at different times can produce an inconsistent dataset. Do not merge conflict copies or run the app simultaneously on two machines against synchronized files.

The preferred arrangement is to exclude the live folders from sync and synchronize only the completed `backups/` archives. Restore an archive on another host before starting it. Live folders can be synchronized when all relevant services are stopped, but archives are easier to transfer consistently. You can manually copy completed archives to a different synchronized directory without moving live storage.

## Updating and configuration

Before pulling changes, make a backup and stop the selected stack with `down`. Rebuild the release image, then run migrations yourself when the upstream schema changes, before starting the updated app. The migration helper refuses to run while that stack is serving. Containers never apply migrations automatically. The existing `pnpm run push` is not part of this workflow.

Edit root `.env` to change `DATA_ROOT`, `LAN_HOST`, or `BIND_ADDRESS`, then recreate services with `up`. If `LAN_HOST` changes, update bookmarks. The public address used by browsers differs from the internal callback addresses used by containers.

The application retains its original cloud mode when `TURSO_APP_DB_URL` is a remote URL and `ASSET_STORAGE` is absent or `r2`. The provided local Compose files intentionally choose local storage. To use accounts, create a private Compose override supplying the remote database URL/token and/or R2 credentials, set `ASSET_STORAGE=r2` and `CLOUDFLARE_R2_BUCKET_URL` to your public bucket URL. A deployed PartyKit service also needs matching `INTERNAL_API_TOKEN`, `APP_API_URL`/`BASE_URL`, and its browser-facing host. See `apps/web/.env-example`. Existing local files are not automatically copied to cloud services, and local backup commands only archive local folders.

`SESSION_COOKIE_SECURE=false` is explicitly selected for trusted HTTP LAN use. For HTTPS or internet hosting, enable secure cookies and configure the HTTPS origin and WebSocket endpoint. That deployment is outside the current local-network setup.

## Architecture

Compose owns environment separation, port publication, and bind mounts. The app connects directly to `file:/data/database/app.db`; this branch precedes the existing remote-replica logic. Build analysis uses an in-memory client without querying a campaign database.

`localStorage.ts` validates object keys, writes files using atomic rename, copies files, and signs upload URLs with HMAC over the key, content type, and expiry. Existing `apiFactory` upload endpoints still authenticate the user and issue upload URLs; the separate `/assets/[...path]` route accepts only valid signed PUT requests, enforces the size limit, and serves assets and Sharp image transformations. It also supports the Cloudflare-style JSON metadata URLs consumed by existing image code. Asset reads are public to people with network access, matching the upstream public bucket model; this is not per-user private document storage.

`files.ts` selects local filesystem helpers or the original R2 SDK. The browser receives `/assets` as its bucket URL. Default maps, annotation textures, and existing upstream LUT URLs use that configured backend. `transform.ts` reads image dimensions directly for local storage, avoiding HTTP requests back to the public LAN address.

`containers/party.mjs` writes a temporary private PartyKit configuration with absolute source paths and passes `--persist /data/realtime` explicitly; PartyKit CLI defaults otherwise override the config-file persistence path. PartyKit calls the web service at `APP_API_URL`; web resync calls use `PARTYKIT_INTERNAL_URL`; clients use `PUBLIC_PARTYKIT_HOST` and `PUBLIC_PARTYKIT_PROTOCOL=ws` in local Compose. Without that override, the provider retains its normal cloud/localhost protocol selection. The existing Y.js persistence model is unchanged.

To extend local storage, keep path validation and signed upload verification centralized; preserve the object keys stored in the database. To change realtime runtimes, preserve both named parties, their persistent snapshots, and their authenticated database callback contract. Changing schema is a separate operator-controlled migration.

## Verification

The pinned Linux images were built and served over HTTP. `pnpm run check` passed with zero errors (existing warnings remain), `pnpm run format-check` passed, and 15 storage/URL regression tests passed. Immutable lockfile installation, image metadata/resizing, signed PUT authorization, file retention after restart, and backup/restore with overwrite/traversal refusal were checked with disposable data. A real PartyKit WebSocket document was tested against mock application callbacks and retained its state after replacing the container. All 87 manifest assets were downloaded successfully into disposable local storage.

Migrations were not generated or run. Account creation, authenticated campaign operations, and database write persistence still require operator schema initialization and an end-to-end campaign check. No campaign deployment or chosen personal storage path was configured during implementation.

## Manual artwork cleanup

See [Manual media cleanup](media-cleanup.md) for the stopped-stack inventory and review workflow. Abandoned staging has no automatic expiry. Permanent clipboard and legacy artwork protection prevents cleanup from breaking old token copies.
