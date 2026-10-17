import { assetsTable, markerTable } from '$lib/db/app/schema';
import type { SQL } from 'drizzle-orm';
import { getTableConfig, SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertSceneEditor,
  assetFromMarker,
  assetPlacements,
  deleteAsset,
  getOwnedAsset,
  pruneUnavailableAssetLinks
} from './assets';

const { get, where, insert, remove, select } = vi.hoisted(() => ({
  get: vi.fn(),
  where: vi.fn(),
  insert: vi.fn(),
  remove: vi.fn(),
  select: vi.fn()
}));
vi.mock('$lib/db/app', () => ({ db: { select, insert, delete: remove } }));

const asset = {
  id: 'asset',
  ownerId: 'owner',
  name: 'Wolf',
  artworkLocation: 'originals/art.png',
  tokenArtworkLocation: 'originals/token.png',
  shape: 1,
  shapeColor: '#ffffff',
  size: 1,
  imageScale: 1.5
};
let chain: {
  from: ReturnType<typeof vi.fn>;
  innerJoin: ReturnType<typeof vi.fn>;
  where: typeof where;
  get: typeof get;
  all: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.resetAllMocks();
  chain = { from: vi.fn(), innerJoin: vi.fn(), where, get, all: vi.fn() };
  chain.from.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  where.mockReturnValue(chain);
  select.mockReturnValue(chain);
  remove.mockReturnValue(chain);
});

describe('personal asset ownership and placement', () => {
  it('scopes lookup to both owner and asset identity', async () => {
    get.mockResolvedValue(asset);
    await expect(getOwnedAsset('owner', 'asset')).resolves.toEqual(asset);
    const condition = where.mock.calls[0][0] as SQL;
    expect(new SQLiteSyncDialect().sqlToQuery(condition).params).toEqual(['owner', 'asset']);
    get.mockResolvedValue(undefined);
    await expect(getOwnedAsset('other', 'asset')).rejects.toThrow('Unauthorized');
  });

  it('requires an admin or editor in the destination party', async () => {
    get.mockResolvedValue(undefined);
    await expect(assertSceneEditor('viewer', 'scene')).rejects.toThrow('Unauthorized');
    const params = new SQLiteSyncDialect().sqlToQuery(where.mock.calls[0][0] as SQL).params;
    expect(params).toEqual(['scene', 'viewer', 'admin', 'editor']);
  });

  it('places unique independent snapshots with private visibility and no statblocks', async () => {
    get.mockResolvedValueOnce({ partyId: 'party' }).mockResolvedValueOnce(asset);
    const first = await assetPlacements('owner', 'asset', 'scene', 2, 10, 20);
    expect(first[0].id).not.toBe(first[1].id);
    expect(first[0]).toMatchObject({
      title: 'Wolf',
      visibility: 1,
      imageLocation: 'originals/token.png',
      imageScale: 1.5,
      pinnedTooltip: false,
      note: null
    });
    get.mockResolvedValueOnce({ partyId: 'party' }).mockResolvedValueOnce({
      ...asset,
      name: 'Dire wolf',
      artworkLocation: 'replacement',
      tokenArtworkLocation: null
    });
    const second = await assetPlacements('owner', 'asset', 'scene', 1, 10, 20);
    expect(second[0].title).toBe('Dire wolf');
    expect(second[0].imageLocation).toBe('replacement');
    expect(first[0].title).toBe('Wolf');
    expect(first[0].imageLocation).toBe('originals/token.png');
  });

  it('saves current token values before the scene persistence debounce completes', async () => {
    get
      .mockResolvedValueOnce({ partyId: 'party' })
      .mockResolvedValueOnce({ title: 'Old title', imageLocation: 'originals/art.png', note: { secret: true } });
    const values = vi.fn().mockReturnValue({ returning: () => ({ get: async () => ({ id: 'new-asset' }) }) });
    insert.mockReturnValue({ values });
    await assetFromMarker('owner', 'scene', 'token', {
      name: 'Current title',
      artworkLocation: 'originals/art.png',
      shape: 2,
      shapeColor: '#ffffff',
      size: 2,
      imageScale: 1.75
    });
    expect(values).toHaveBeenCalledWith({
      ownerId: 'owner',
      name: 'Current title',
      artworkLocation: 'originals/art.png',
      shape: 2,
      shapeColor: '#ffffff',
      size: 2,
      imageScale: 1.75
    });
  });

  it('deletes library metadata without deleting artwork or token rows', async () => {
    get.mockResolvedValue(asset);
    await deleteAsset('owner', 'asset');
    expect(remove).toHaveBeenCalledExactlyOnceWith(assetsTable);
    const markerForeignKey = getTableConfig(markerTable).foreignKeys.find(
      (key) => key.reference().foreignTable === assetsTable
    );
    expect(markerForeignKey?.onDelete).toBe('set null');
  });

  it('does not resurrect a deleted origin when a stale live doc persists', async () => {
    const markers = [{ id: 'token', assetId: 'deleted', imageLocation: 'originals/token.png' }];
    chain.all.mockResolvedValue([]);
    const result = await pruneUnavailableAssetLinks(markers as Parameters<typeof pruneUnavailableAssetLinks>[0]);
    expect(result[0].assetId).toBeNull();
    expect(result[0].imageLocation).toBe('originals/token.png');
    expect(markers[0].assetId).toBe('deleted');
  });
});
