# Manual media cleanup

Cleanup is an explicit operator action. No staging expiry, background sweep or lifecycle deletion runs automatically. The tool supports the local SQLite deployment with local storage or the configured R2 bucket. Remote databases are rejected because all database and realtime writers must be stopped together.

Migration 0055 creates a permanent artwork ledger and seeds it with every previously registered media location. Clipboard grant creation records each authorized artwork location before returning its signature. Ledger entries have no account/file foreign key or expiry, so source deletion and account deletion cannot invalidate retained clipboard artwork. Never prune this ledger while old clipboard grants remain valid.

The inventory retains:

- Permanent ledger locations, including the migration's legacy baseline.
- Artwork referenced by assets, markers, handouts, scene maps, stored notes or other database content, and files referenced by database foreign keys.
- Unregistered originals, whose prior clipboard usage cannot be established.
- Catalog revisions, derived media and other namespaces.
- Objects less than 24 hours old, including staging uploads.

Only abandoned staging and registered, unreferenced, unprotected originals become candidates. Ownership metadata alone does not make an original referenced. Review the inventory's reasons; every item initially has `delete: false`.

## Review and apply

Close editor/player tabs so their undo histories and in-flight uploads cannot refer to artwork being cleaned. Let realtime persistence finish, then back up and stop the selected deployment:

```sh
./containers/host.sh backup development
./containers/host.sh down development
./containers/host.sh cleanup development --inventory /data/media-inventory.json
```

The inventory is written privately inside the selected deployment's persistent directory. Open it from the host's `DATA_ROOT/development/media-inventory.json`, inspect candidate keys and set `delete: true` only on selected candidates. Keep protected rows unchanged. Then run:

```sh
./containers/host.sh cleanup development --apply /data/media-inventory.json
./containers/host.sh up development
```

Use `release` instead of `development` for that separate dataset. The helper refuses cleanup while the selected stack is running. Backups and inventories are not interchangeable between deployments; do not reuse an inventory after restoring/replacing the database or storage directory.

Apply rescans all references and objects before deleting anything. Changed, newly referenced or newly protected selections abort the operation. Local objects are hashed and checked again immediately before unlinking; R2 deletion uses the inventoried ETag as a conditional request. Object deletion precedes file/ownership metadata removal. A storage/database failure stops further deletion; already completed deletions are not rolled back. The complete offline backup is the recovery path. Generate a new inventory before retrying; existing inventory files are never overwritten.

For a manually operated R2-backed local SQLite deployment, run `node scripts/cleanup-media.mjs --inventory /private/plan.json --offline` from `apps/web` with its storage environment, after stopping every app/PartyKit writer. Apply uses `--apply` instead. Live R2 acceptance requires a configured disposable bucket; abstraction tests do not establish cloud acceptance.
