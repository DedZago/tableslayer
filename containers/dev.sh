#!/usr/bin/env bash
set -euo pipefail
cd /workspace
rm -f /tmp/tableslayer-warm
pnpm install --frozen-lockfile
pnpm --filter web migrate

# The watchers below rebuild on change; build up front only when the output is missing or stale
needs_build() {
  [ ! -f "$1/dist/index.js" ] || [ -n "$(find "$1/src" "$1/package.json" -newer "$1/dist/index.js" -print -quit)" ]
}
WEATHER_SIM_WASM=packages/stage/src/lib/components/Stage/components/AtmosphereLayer/sim/weather_sim.wasm
SIM_BUILD_FAILED=/tmp/tableslayer-sim-failed
# The committed .wasm is used as is when cargo is missing; polling (not file events) so it works on WSL drives
sim_stale() {
  local reference=$WEATHER_SIM_WASM
  [ ! -f "$SIM_BUILD_FAILED" ] || reference=$SIM_BUILD_FAILED
  [ ! -f "$reference" ] || [ -n "$(find packages/stage/sim/src packages/stage/sim/Cargo.toml packages/stage/sim/rust-toolchain.toml packages/stage/scripts/build-sim.mjs -newer "$reference" -print -quit)" ]
}
build_sim() {
  command -v cargo >/dev/null 2>&1 || return 0
  sim_stale || return 0
  if pnpm --filter @tableslayer/stage build:sim; then
    rm -f "$SIM_BUILD_FAILED"
  else
    touch "$SIM_BUILD_FAILED"
    echo "[dev] weather_sim.wasm build failed; keeping the existing binary"
  fi
}
watch_sim() {
  while sleep 3; do build_sim; done
}
pids=()
rm -f "$SIM_BUILD_FAILED"
build_sim
# Skip the typedoc step of the ui "package" script; dev has no use for the generated docs
needs_build packages/ui && pnpm --filter @tableslayer/ui exec sh -c 'svelte-kit sync && svelte-package'
needs_build packages/stage && pnpm --filter @tableslayer/stage build
warm_pid=
cleanup() {
  trap - EXIT INT TERM
  kill "${pids[@]}" "$warm_pid" 2>/dev/null || true
  wait || true
}
trap cleanup EXIT INT TERM
# svelte-package --watch empties dist before its first build; vite must not load packages until "Watching" appears
watch_package() {
  local log=/tmp/tableslayer-$1.log
  rm -f "$log"
  pnpm --filter "@tableslayer/$1" dev > >(tee "$log") 2>&1 & pids+=("$!")
}
package_ready() {
  until grep -q 'Watching src/lib' "/tmp/tableslayer-$1.log" 2>/dev/null; do sleep 0.5; done
}
watch_package ui
watch_package stage
if command -v cargo >/dev/null 2>&1; then watch_sim & pids+=("$!"); fi
package_ready ui
package_ready stage
pnpm --filter docs exec vite dev --host 0.0.0.0 --port 5173 --strictPort & pids+=("$!")
pnpm --filter web exec vite dev --host 0.0.0.0 --port 5174 --strictPort & pids+=("$!")
(cd apps/web && node ../../containers/party.mjs) & pids+=("$!")

# Compile the app's routes now so the first browser visit is served from cache
warm() {
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
