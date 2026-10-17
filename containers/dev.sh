#!/usr/bin/env bash
set -euo pipefail
cd /workspace
pnpm install --frozen-lockfile
pnpm --filter @tableslayer/ui package
pnpm --filter @tableslayer/stage build
pids=()
cleanup() {
  trap - EXIT INT TERM
  kill "${pids[@]}" 2>/dev/null || true
  wait || true
}
trap cleanup EXIT INT TERM
pnpm --filter @tableslayer/ui dev & pids+=("$!")
pnpm --filter @tableslayer/stage dev & pids+=("$!")
pnpm --filter docs exec vite dev --host 0.0.0.0 --port 5173 --strictPort & pids+=("$!")
pnpm --filter web exec vite dev --host 0.0.0.0 --port 5174 --strictPort & pids+=("$!")
(cd apps/web && node ../../containers/party.mjs) & pids+=("$!")
wait -n
