import { createClient } from '@libsql/client';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const execute = promisify(execFile);
let directory;
let database;
let environment;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'tableslayer-cleanup-'));
  const root = path.join(directory, 'assets');
  await mkdir(path.join(root, 'uploads'), { recursive: true });
  await mkdir(path.join(root, 'originals'));
  for (const key of ['uploads/abandoned.png', 'originals/unused.png', 'originals/legacy.png']) {
    const target = path.join(root, key);
    await writeFile(target, 'stored image');
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await utimes(target, old, old);
  }
  const url = `file:${path.join(directory, 'app.db')}`;
  database = createClient({ url });
  await database.executeMultiple(`
    CREATE TABLE files (id INTEGER PRIMARY KEY, location TEXT UNIQUE);
    CREATE TABLE clipboard_artwork (location TEXT PRIMARY KEY, created_at INTEGER);
    CREATE TABLE marker (image_location TEXT);
    INSERT INTO files VALUES (1, 'originals/unused.png'), (2, 'originals/legacy.png');
    INSERT INTO clipboard_artwork VALUES ('originals/legacy.png', 1);
  `);
  environment = { ...process.env, TURSO_APP_DB_URL: url, ASSET_STORAGE: 'local', LOCAL_ASSET_DIR: root };
});
afterEach(async () => {
  database.close();
  await rm(directory, { recursive: true, force: true });
});
const command = (...args) => execute(process.execPath, ['scripts/cleanup-media.mjs', ...args], { env: environment });

describe('local manual cleanup command', () => {
  it('writes a private non-destructive inventory and applies chosen objects without touching protected artwork', async () => {
    const planPath = path.join(directory, 'plan.json');
    await command('--inventory', planPath, '--offline');
    expect((await stat(planPath)).mode & 0o777).toBe(0o600);
    const plan = JSON.parse(await readFile(planPath, 'utf8'));
    expect(await readFile(path.join(environment.LOCAL_ASSET_DIR, 'originals/unused.png'), 'utf8')).toBe('stored image');
    for (const item of plan.items) item.delete = item.classification === 'candidate';
    await writeFile(planPath, JSON.stringify(plan));
    await command('--apply', planPath, '--offline');
    await expect(stat(path.join(environment.LOCAL_ASSET_DIR, 'originals/unused.png'))).rejects.toThrow();
    await expect(stat(path.join(environment.LOCAL_ASSET_DIR, 'uploads/abandoned.png'))).rejects.toThrow();
    expect(await readFile(path.join(environment.LOCAL_ASSET_DIR, 'originals/legacy.png'), 'utf8')).toBe('stored image');
    expect((await database.execute('SELECT location FROM files')).rows).toEqual([{ location: 'originals/legacy.png' }]);
  });

  it('requires an explicit offline invocation and refuses to overwrite an inventory', async () => {
    const planPath = path.join(directory, 'plan.json');
    await expect(command('--inventory', planPath)).rejects.toThrow('Stop all writers');
    await command('--inventory', planPath, '--offline');
    await expect(command('--inventory', planPath, '--offline')).rejects.toThrow('EEXIST');
  });

  it('refuses symbolic links in storage', async () => {
    await symlink(path.join(directory, 'app.db'), path.join(environment.LOCAL_ASSET_DIR, 'uploads', 'linked'));
    await expect(command('--inventory', path.join(directory, 'plan.json'), '--offline')).rejects.toThrow(
      'symbolic links'
    );
  });
});
