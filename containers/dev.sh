#!/usr/bin/env bash
set -euo pipefail
cd /workspace
rm -f /tmp/tableslayer-warm
pnpm install --frozen-lockfile

# The watchers below rebuild on change; build up front only when the output is missing or stale
needs_build() {
  [ ! -f "$1/dist/index.js" ] || [ -n "$(find "$1/src" "$1/package.json" -newer "$1/dist/index.js" -print -quit)" ]
}
# Skip the typedoc step of the ui "package" script; dev has no use for the generated docs
needs_build packages/ui && pnpm --filter @tableslayer/ui exec sh -c 'svelte-kit sync && svelte-package'
needs_build packages/stage && pnpm --filter @tableslayer/stage build
pids=()
warm_pid=
cleanup() {
  trap - EXIT INT TERM
  kill "${pids[@]}" "$warm_pid" 2>/dev/null || true
  wait || true
}
trap cleanup EXIT INT TERM
pnpm --filter @tableslayer/ui dev & pids+=("$!")
stage_log=/tmp/tableslayer-stage.log
rm -f "$stage_log"
# svelte-package --watch empties dist before its first build, so warm waits for "Watching" below
pnpm --filter @tableslayer/stage dev > >(tee "$stage_log") 2>&1 & pids+=("$!")
pnpm --filter docs exec vite dev --host 0.0.0.0 --port 5173 --strictPort & pids+=("$!")
pnpm --filter web exec vite dev --host 0.0.0.0 --port 5174 --strictPort & pids+=("$!")
(cd apps/web && node ../../containers/party.mjs) & pids+=("$!")

# Compile the app's routes now so the first browser visit is served from cache
warm() {
  until grep -q 'Watching src/lib' "$stage_log" 2>/dev/null; do sleep 0.5; done
  for _ in $(seq 1 150); do
    node -e "fetch('http://127.0.0.1:5174/login').then(() => process.exit(0), () => process.exit(1))" && break
    sleep 0.5
  done
  node -e "fetch('http://127.0.0.1:5174/').then(() => process.exit(0), () => process.exit(0))"
  touch /tmp/tableslayer-warm
  echo "[dev] app warmed: http://localhost:5174"
}
warm & warm_pid=$!
# Only the servers decide when the container stops; warm finishing is success, not shutdown
wait -n "${pids[@]}"
