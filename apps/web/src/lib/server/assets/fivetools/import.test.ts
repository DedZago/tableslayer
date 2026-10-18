import { assetImportReceiptsTable, assetsTable } from '$lib/db/app/schema';
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { importFiveToolsItems, previewFiveToolsImport } from './import';
import type { FiveToolsImportItem } from './types';

const mocks = vi.hoisted(() => ({ download: vi.fn(), store: vi.fn() }));
vi.mock('./download', () => ({ downloadFiveToolsArtwork: mocks.download }));
vi.mock('$lib/server/file/files', () => ({ storeImportedArtwork: mocks.store }));
vi.mock('$lib/db/app', async () => {
  const { createClient } = await import('@libsql/client');
  const { drizzle } = await import('drizzle-orm/libsql');
  const client = createClient({ url: 'file::memory:' });
  return { db: drizzle(client), testClient: client };
});
const { db, testClient } = (await import('$lib/db/app')) as unknown as {
  db: ReturnType<typeof drizzle>;
  testClient: ReturnType<typeof createClient>;
};
await testClient.execute('CREATE TABLE users (id text PRIMARY KEY)');
await testClient.execute("INSERT INTO users VALUES ('owner'), ('other')");
const assetMigration = await readFile(
  new URL('../../../db/app/migrations/0052_cheerful_sunspot.sql', import.meta.url),
  'utf8'
);
for (const statement of assetMigration
  .split('--> statement-breakpoint')
  .filter((statement) => !statement.includes('ALTER TABLE')))
  await testClient.execute(statement);
await testClient.execute(
  await readFile(new URL('../../../db/app/migrations/0053_famous_mac_gargan.sql', import.meta.url), 'utf8')
);
const combatMigration = await readFile(
  new URL('../../../db/app/migrations/0056_known_doomsday.sql', import.meta.url),
  'utf8'
);
for (const statement of combatMigration
  .split('--> statement-breakpoint')
  .filter((statement) => statement.includes('ALTER TABLE `asset`')))
  await testClient.execute(statement);
// Mirrors the token role and framing columns until their migration is generated
for (const statement of [
  'ALTER TABLE `asset` ADD `role` text',
  'ALTER TABLE `asset` ADD `crop_x` real DEFAULT 0.5 NOT NULL',
  'ALTER TABLE `asset` ADD `crop_y` real DEFAULT 0.5 NOT NULL',
  'ALTER TABLE `asset` ADD `crop_zoom` real DEFAULT 1 NOT NULL'
])
  await testClient.execute(statement);
afterAll(() => testClient.close());
beforeEach(async () => {
  await db.delete(assetImportReceiptsTable);
  await db.delete(assetsTable);
  vi.resetAllMocks();
  mocks.download.mockResolvedValue({ data: Buffer.from('image'), contentType: 'image/png' });
  mocks.store.mockResolvedValue('originals/owner/import.png');
});
const item = (changes: Partial<FiveToolsImportItem> = {}): FiveToolsImportItem => ({
  record: { identity: '["mm","wolf"]', name: 'Wolf', source: 'MM', artworkUrl: null, tokenUrl: null, warnings: [] },
  requestId: 'request-1',
  policy: 'skip',
  ...changes
});
const seeded = () =>
  db
    .insert(assetsTable)
    .values({
      ownerId: 'owner',
      name: 'My edited wolf',
      provider: '5etools',
      sourceIdentity: '["mm","wolf"]',
      artworkLocation: 'originals/portrait.png',
      tokenArtworkLocation: 'originals/token.png',
      shape: 2,
      shapeColor: '#aabbcc',
      size: 3,
      imageScale: 1.8
    })
    .returning()
    .get();

describe('durable per-item asset imports', () => {
  it('creates a placeholder once and replays its persisted receipt', async () => {
    const first = await importFiveToolsItems('owner', [item()]);
    expect(first[0]).toMatchObject({ status: 'created', message: expect.stringContaining('without artwork') });
    expect(await importFiveToolsItems('owner', [item()])).toEqual(first);
    expect(await db.select().from(assetsTable)).toHaveLength(1);
  });
  it('detects duplicates after rename and scopes them to their owner', async () => {
    const asset = await seeded();
    const json = JSON.stringify({ monster: [{ name: 'Wolf', source: 'MM' }] });
    expect((await previewFiveToolsImport('owner', json))[0].duplicates).toEqual([{ id: asset.id, name: asset.name }]);
    expect((await previewFiveToolsImport('other', json))[0].duplicates).toEqual([]);
    expect((await importFiveToolsItems('owner', [item()]))[0].status).toBe('skipped');
    expect((await importFiveToolsItems('other', [item()]))[0].status).toBe('created');
  });
  it('updates provenance while preserving edited defaults and absent artwork', async () => {
    const asset = await seeded();
    expect((await importFiveToolsItems('owner', [item({ policy: 'update', targetId: asset.id })]))[0].status).toBe(
      'updated'
    );
    const updated = await db.select().from(assetsTable).where(eq(assetsTable.id, asset.id)).get();
    expect(updated).toMatchObject({
      name: asset.name,
      shape: 2,
      shapeColor: '#aabbcc',
      size: 3,
      imageScale: 1.8,
      artworkLocation: asset.artworkLocation,
      tokenArtworkLocation: asset.tokenArtworkLocation,
      originalName: 'Wolf',
      adapterVersion: 'bestiary-stats-v1'
    });
  });
  it('replaces only supplied artwork and never changes edited names', async () => {
    const asset = await seeded();
    const update = item({ policy: 'update', targetId: asset.id });
    update.record.tokenUrl = 'https://example.com/token.png';
    await importFiveToolsItems('owner', [update]);
    expect(await db.select().from(assetsTable).where(eq(assetsTable.id, asset.id)).get()).toMatchObject({
      name: asset.name,
      artworkLocation: asset.artworkLocation,
      tokenArtworkLocation: 'originals/owner/import.png'
    });
    expect(mocks.download).toHaveBeenCalledTimes(1);
    await importFiveToolsItems('owner', [update]);
    expect(mocks.download).toHaveBeenCalledTimes(1);
  });
  it('reports a failed item independently and retries without duplicating successes', async () => {
    const fail = item({
      requestId: 'request-2',
      record: {
        ...item().record,
        name: 'Goblin',
        identity: '["mm","goblin"]',
        tokenUrl: 'https://example.com/token.png'
      }
    });
    mocks.download.mockRejectedValueOnce(new Error('Download failed'));
    const first = await importFiveToolsItems('owner', [item(), fail]);
    expect(first.map((result) => result.status)).toEqual(['created', 'failed']);
    expect(await db.select().from(assetImportReceiptsTable)).toHaveLength(1);
    expect((await importFiveToolsItems('owner', [item(), fail])).map((result) => result.status)).toEqual([
      'created',
      'created'
    ]);
    expect(await db.select().from(assetsTable)).toHaveLength(2);
  });
  it('leaves existing artwork and metadata unchanged on download failure', async () => {
    const asset = await seeded();
    mocks.download.mockRejectedValueOnce(new Error('Download failed'));
    const update = item({
      policy: 'update',
      targetId: asset.id,
      record: { ...item().record, tokenUrl: 'https://example.com/token.png' }
    });
    expect((await importFiveToolsItems('owner', [update]))[0].status).toBe('failed');
    expect(await db.select().from(assetsTable).where(eq(assetsTable.id, asset.id)).get()).toEqual(asset);
  });
  it('allows an intentional independent duplicate but not a changed replay', async () => {
    await seeded();
    const create = item({ policy: 'another' });
    expect((await importFiveToolsItems('owner', [create]))[0].status).toBe('created');
    expect((await importFiveToolsItems('owner', [item()]))[0]).toMatchObject({
      status: 'failed',
      message: expect.stringContaining('different input')
    });
    expect(await db.select().from(assetsTable)).toHaveLength(2);
  });
  it('does not authorize updating another owner through an asset ID', async () => {
    const asset = await seeded();
    expect((await importFiveToolsItems('other', [item({ policy: 'update', targetId: asset.id })]))[0].status).toBe(
      'failed'
    );
    expect(await db.select().from(assetsTable).where(eq(assetsTable.id, asset.id)).get()).toEqual(asset);
  });
});
