import { createClient } from '@libsql/client';
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

config({ path: '.env' });

const migrationsFolder = './src/lib/db/app/migrations';

const readJournalEntries = () =>
  JSON.parse(readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')).entries;

const readAppliedMillis = async (client) => {
  const table = await client.execute(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'"
  );
  if (table.rows.length === 0) return null;
  const result = await client.execute('SELECT MAX(created_at) AS applied FROM __drizzle_migrations');
  const applied = result.rows[0]?.applied;
  return applied === null || applied === undefined ? null : Number(applied);
};

const hasUserTables = async (client) => {
  const result = await client.execute(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1"
  );
  return result.rows.length > 0;
};

const formatUtcStamp = (date) =>
  date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');

const backupDatabase = async (client, databasePath, firstPendingTag) => {
  const backupDir = join(dirname(databasePath), 'backups');
  mkdirSync(backupDir, { recursive: true });
  const backupPath = join(backupDir, `app-${formatUtcStamp(new Date())}-before-${firstPendingTag}.db`);
  await client.execute(`VACUUM INTO '${backupPath.replaceAll("'", "''")}'`);
  console.log(`Database backup written to ${backupPath}`);
  // A failing migration restarts the container in a loop; keep only the newest backup per pending tag
  const staleBackups = readdirSync(backupDir).filter(
    (name) => name.endsWith(`-before-${firstPendingTag}.db`) && join(backupDir, name) !== backupPath
  );
  for (const name of staleBackups) rmSync(join(backupDir, name));
};

const runMigrations = async () => {
  const url = process.env.TURSO_APP_DB_URL;
  if (!url) throw new Error('TURSO_APP_DB_URL is required');

  const isFileDatabase = url.startsWith('file:');
  const databasePath = isFileDatabase ? url.slice(5) : null;
  if (databasePath) mkdirSync(dirname(databasePath), { recursive: true });

  const client = createClient({ url, authToken: process.env.TURSO_APP_DB_AUTH_TOKEN });
  try {
    const entries = readJournalEntries();
    const latest = entries[entries.length - 1];
    const applied = await readAppliedMillis(client);
    const pending = entries.filter((entry) => applied === null || entry.when > applied);

    if (pending.length === 0) {
      console.log(`Database schema up to date (${latest.tag})`);
      if (applied > latest.when) console.warn('Warning: the database is newer than this build');
      return;
    }

    console.log(`Pending migrations: ${pending.length}`);
    if (databasePath && (await hasUserTables(client))) {
      await backupDatabase(client, databasePath, pending[0].tag);
    }

    await migrate(drizzle(client), { migrationsFolder });
    console.log(`Applied migrations: ${pending.map((entry) => entry.tag).join(', ')}`);
  } finally {
    client.close();
  }
};

runMigrations().catch((error) => {
  console.error('Database migration failed:', error);
  process.exitCode = 1;
});
