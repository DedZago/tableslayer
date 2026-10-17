#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command=${1:-help}
mode=${2:-development}
if [[ "$command" == setup ]]; then
  data_root=${2:?Usage: host.sh setup /absolute/data/path LAN_IP_OR_HOSTNAME}
  lan_host=${3:?Specify the Linux host LAN IP or hostname}
  [[ "$data_root" == /* && "$data_root" != / && "$data_root" != *[\$\`\"\\]* && "$data_root" != *$'\n'* ]] || { echo 'Use a non-root absolute data directory without shell metacharacters.' >&2; exit 1; }
  [[ "$lan_host" =~ ^[a-zA-Z0-9.-]+$ ]] || { echo 'Use an IPv4 address or hostname without a port.' >&2; exit 1; }
  [[ ! -e .env ]] || { echo 'Root .env already exists; edit it manually instead of overwriting it.' >&2; exit 1; }
  umask 077
  mkdir -p "$data_root"/{development,release}/{database,assets,realtime} "$data_root/backups"
  secret=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
  printf 'DATA_ROOT="%s"\nLAN_HOST=%s\nBIND_ADDRESS=0.0.0.0\nINTERNAL_API_TOKEN=%s\n' "$data_root" "$lan_host" "$secret" > .env
  echo 'Created .env and separate data directories. See docs/local-container-hosting.md for initialization.'
  exit
fi
[[ "$mode" == development || "$mode" == release ]] || { echo 'Mode must be development or release.' >&2; exit 1; }
if [[ "$mode" == development ]]; then
  compose_file=compose.dev.yaml
  app=dev
else
  compose_file=compose.release.yaml
  app=web
fi
compose=(docker compose --env-file .env -f "$compose_file")
case "$command" in
  up)
    if [[ "$mode" == development ]]; then
      "${compose[@]}" up -d --build --wait --wait-timeout 180
    else
      "${compose[@]}" up -d --build
    fi
    ;;
  down) "${compose[@]}" down ;;
  logs) "${compose[@]}" logs -f ;;
  migrate)
    running=$("${compose[@]}" ps -q --status running)
    [[ -z "$running" ]] || { echo 'Stop this stack before migrating: host.sh down development_or_release' >&2; exit 1; }
    if [[ "$mode" == development ]]; then
      "${compose[@]}" run --rm --no-deps dev bash -c 'pnpm install --frozen-lockfile && pnpm --filter web migrate'
    else
      "${compose[@]}" run --rm --no-deps web pnpm migrate
    fi
    ;;
  assets)
    "${compose[@]}" run --rm --no-deps "$app" node /workspace/containers/assets.mjs
    ;;
  cleanup)
    running=$("${compose[@]}" ps -q --status running)
    [[ -z "$running" ]] || { echo 'Stop this stack and close all clients before cleanup: host.sh down development_or_release' >&2; exit 1; }
    "${compose[@]}" run --rm --no-deps --workdir /workspace/apps/web "$app" node scripts/cleanup-media.mjs "${@:3}" --offline
    ;;
  backup)
    data_root=$(sed -n 's/^DATA_ROOT=//p' .env)
    data_root=${data_root#\"}
    data_root=${data_root%\"}
    [[ "$data_root" == /* && -d "$data_root/$mode" ]] || { echo 'Invalid DATA_ROOT in .env' >&2; exit 1; }
    exec 9>"$data_root/.backup-$mode.lock"
    flock -n 9 || { echo 'A backup is already running for this dataset.' >&2; exit 1; }
    mapfile -t running < <("${compose[@]}" ps -q --status running)
    restart() { if ((${#running[@]})); then docker start "${running[@]}" >/dev/null; fi; }
    trap restart EXIT
    # Stop writers before taking the complete database/assets/room-state snapshot.
    "${compose[@]}" stop -t 30
    mkdir -p "$data_root/backups"
    archive="$data_root/backups/$mode-$(date -u +%Y%m%dT%H%M%SZ)-$$.tar.gz"
    umask 077
    tar -czf "$archive.partial" -C "$data_root" "$mode"
    mv "$archive.partial" "$archive"
    printf 'Backup: %s\nSave root .env separately; it contains your storage settings and secret.\n' "$archive"
    ;;
  restore)
    archive=${3:?Usage: host.sh restore development_or_release archive.tar.gz /new/empty/data/root}
    destination=${4:?Specify a new empty absolute data root}
    [[ "$destination" == /* && "$destination" != / ]] || { echo 'Use an absolute non-root destination.' >&2; exit 1; }
    [[ ! -e "$destination" ]] || { echo 'Restore requires a new directory; existing data is never overwritten.' >&2; exit 1; }
    while IFS= read -r entry; do
      [[ "$entry" == "$mode/"* && "$entry" != *../* && "$entry" != /* ]] || { echo 'Archive contains an unsafe path.' >&2; exit 1; }
    done < <(tar -tzf "$archive")
    # Only accept ordinary files and directories, never links or device entries.
    tar -tvzf "$archive" | awk 'substr($0,1,1) != "-" && substr($0,1,1) != "d" { exit 1 }'
    umask 077
    mkdir -p "$destination"
    tar -xzf "$archive" --no-same-owner --no-same-permissions -C "$destination"
    printf 'Restored into %s. Stop the target stack, update DATA_ROOT in .env, then start it.\n' "$destination"
    ;;
  *) printf 'Usage: %s {setup|up|down|logs|migrate|assets|cleanup|backup|restore} [development|release]\nRead docs/local-container-hosting.md before initialization or restore.\n' "$0" ;;
esac
