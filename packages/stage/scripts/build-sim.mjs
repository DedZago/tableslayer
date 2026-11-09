import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const simRoot = join(packageRoot, 'sim');
const targetDir = resolve(process.env.CARGO_TARGET_DIR ?? join(simRoot, 'target'));
const outputPath = join(packageRoot, 'src/lib/components/Stage/components/AtmosphereLayer/sim/weather_sim.wasm');

const rustflags = [process.env.RUSTFLAGS, `--remap-path-prefix=${simRoot}=.`, '-C link-arg=-zstack-size=65536']
  .filter(Boolean)
  .join(' ');

spawnSync('rustup', ['target', 'add', 'wasm32-unknown-unknown'], { cwd: simRoot, stdio: 'ignore' });

const build = spawnSync(
  'cargo',
  ['build', '--manifest-path', join(simRoot, 'Cargo.toml'), '--target', 'wasm32-unknown-unknown', '--release'],
  { cwd: simRoot, stdio: 'inherit', env: { ...process.env, CARGO_TARGET_DIR: targetDir, RUSTFLAGS: rustflags } }
);

if (build.error?.code === 'ENOENT') {
  console.error('[build-sim] cargo not found. Install rustup (https://rustup.rs) to rebuild weather_sim.wasm.');
  process.exit(1);
}
if (build.status !== 0) process.exit(build.status ?? 1);

const builtPath = join(targetDir, 'wasm32-unknown-unknown/release/weather_sim.wasm');
if (!existsSync(builtPath)) {
  console.error(`[build-sim] expected ${builtPath} was not produced`);
  process.exit(1);
}

mkdirSync(dirname(outputPath), { recursive: true });
copyFileSync(builtPath, outputPath);
console.log(`[build-sim] wrote ${outputPath} (${statSync(outputPath).size} bytes)`);
