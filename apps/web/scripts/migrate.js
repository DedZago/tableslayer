import { createClient } from '@libsql/client';
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';

config({ path: '.env' });

const runMigrations = async () => {
  const url = process.env.TURSO_APP_DB_URL;
  if (!url) throw new Error('TURSO_APP_DB_URL is required');

  const client = createClient({ url, authToken: process.env.TURSO_APP_DB_AUTH_TOKEN });
  try {
    console.log('Applying existing database migrations...');
    await migrate(drizzle(client), { migrationsFolder: './src/lib/db/app/migrations' });
    console.log('Database migrations completed');
  } finally {
    client.close();
  }
};

runMigrations().catch((error) => {
  console.error('Database migration failed:', error);
  process.exitCode = 1;
});
