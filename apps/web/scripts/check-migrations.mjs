// Fails when schema.ts has changes that no committed migration covers.
// Runs drizzle-kit generate against a temporary copy of the migrations, so nothing in the repo changes.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const migrationsFolder = resolve('src/lib/db/app/migrations');
const schemaPath = resolve('src/lib/db/app/schema.ts');
const workDir = mkdtempSync(join(tmpdir(), 'check-migrations-'));
const outDir = join(workDir, 'migrations');
const configPath = join(workDir, 'drizzle.config.mjs');

try {
  cpSync(migrationsFolder, outDir, { recursive: true });
  writeFileSync(
    configPath,
    // drizzle-kit prefixes `out` with "./", so it must be relative to the working directory
    `export default ${JSON.stringify({ schema: schemaPath, out: relative(process.cwd(), outDir), dialect: 'turso', dbCredentials: { url: 'file::memory:' } })};\n`
  );
  const before = new Set(readdirSync(outDir));
  const result = spawnSync('pnpm', ['exec', 'drizzle-kit', 'generate', '--config', configPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000
  });
  const added = readdirSync(outDir).filter((name) => !before.has(name));
  // drizzle-kit exits 0 even when it fails, so a clean run must say so explicitly
  if (added.length === 0 && !result.stdout.includes('No schema changes')) {
    console.error(result.stdout, result.stderr);
    console.error('drizzle-kit generate failed (it may need an interactive answer, e.g. for a column rename)');
    process.exitCode = 1;
  } else if (added.length > 0) {
    console.error(`schema.ts has changes without a migration (drizzle-kit would add ${added.join(', ')}).`);
    console.error('Run `pnpm --filter web run generate`, review the SQL, and commit the migration.');
    process.exitCode = 1;
  } else {
    console.log('Migrations match schema.ts');
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
