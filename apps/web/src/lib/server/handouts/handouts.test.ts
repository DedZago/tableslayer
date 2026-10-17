import type { SQL } from 'drizzle-orm';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertPartyEditor, prepareHandout } from './handouts';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  where: vi.fn(),
  select: vi.fn(),
  ownedMedia: vi.fn(),
  ownedAsset: vi.fn()
}));
vi.mock('$lib/db/app', () => ({ db: { select: mocks.select } }));
vi.mock('$lib/server/assets/assets', () => ({ assertOwnedMedia: mocks.ownedMedia, getOwnedAsset: mocks.ownedAsset }));
beforeEach(() => {
  vi.resetAllMocks();
  const chain = { from: vi.fn(), innerJoin: vi.fn(), where: mocks.where, get: mocks.get };
  chain.from.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  mocks.where.mockReturnValue(chain);
  mocks.select.mockReturnValue(chain);
  mocks.get.mockResolvedValue({ role: 'editor' });
  mocks.ownedAsset.mockResolvedValue({
    artworkLocation: 'originals/portrait.png',
    tokenArtworkLocation: 'originals/token.png',
    name: 'Private asset name',
    provider: 'private metadata'
  });
});

describe('handout selection authorization', () => {
  it('requires fresh admin/editor membership before selection', async () => {
    mocks.get.mockResolvedValueOnce(undefined);
    await expect(assertPartyEditor('viewer', 'party')).rejects.toThrow('Unauthorized');
    const params = new SQLiteSyncDialect().sqlToQuery(mocks.where.mock.calls[0][0] as SQL).params;
    expect(params).toEqual(['viewer', 'party', 'admin', 'editor']);
    expect(mocks.ownedAsset).not.toHaveBeenCalled();
  });
  it('selects owned original portrait art and publishes only presentation fields', async () => {
    const handout = await prepareHandout(
      'owner',
      'party',
      { type: 'asset', id: 'asset', artwork: 'portrait' },
      'Shown title'
    );
    expect(mocks.ownedAsset).toHaveBeenCalledExactlyOnceWith('owner', 'asset');
    expect(handout).toMatchObject({
      artworkLocation: 'originals/portrait.png',
      title: 'Shown title',
      presenterId: 'owner'
    });
    expect(handout.publishedAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    expect(Object.keys(handout).sort()).toEqual([
      'artworkLocation',
      'presentationId',
      'presenterId',
      'publishedAt',
      'title'
    ]);
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });
  it('supports token artwork and fallback when a portrait does not exist', async () => {
    expect(
      (await prepareHandout('owner', 'party', { type: 'asset', id: 'asset', artwork: 'token' }, null)).artworkLocation
    ).toBe('originals/token.png');
    mocks.ownedAsset.mockResolvedValueOnce({ artworkLocation: null, tokenArtworkLocation: 'originals/token.png' });
    expect(
      (await prepareHandout('owner', 'party', { type: 'asset', id: 'asset', artwork: 'portrait' }, null))
        .artworkLocation
    ).toBe('originals/token.png');
  });
  it('checks uploaded image ownership and rejects role removal before publication', async () => {
    mocks.get.mockResolvedValueOnce({ role: 'editor' }).mockResolvedValueOnce(undefined);
    await expect(
      prepareHandout('owner', 'party', { type: 'upload', location: 'originals/owner/image.png' }, null)
    ).rejects.toThrow('Unauthorized');
    expect(mocks.ownedMedia).toHaveBeenCalledExactlyOnceWith('owner', 'originals/owner/image.png');
  });
  it('checks token scene belongs to the destination party and accepts shared persisted art', async () => {
    mocks.get
      .mockResolvedValueOnce({ role: 'editor' })
      .mockResolvedValueOnce({ partyId: 'party' })
      .mockResolvedValueOnce({ imageLocation: 'originals/other/shared.png' })
      .mockResolvedValueOnce({ role: 'editor' });
    expect(
      (
        await prepareHandout(
          'owner',
          'party',
          { type: 'marker', sceneId: 'scene', markerId: 'marker', location: 'originals/other/shared.png' },
          null
        )
      ).artworkLocation
    ).toBe('originals/other/shared.png');
    expect(mocks.ownedMedia).not.toHaveBeenCalled();
    expect(new SQLiteSyncDialect().sqlToQuery(mocks.where.mock.calls[1][0] as SQL).params).toEqual(['scene', 'party']);
  });
  it('does not authorize another party scene or an unowned replacement', async () => {
    mocks.get.mockResolvedValueOnce({ role: 'editor' }).mockResolvedValueOnce(undefined);
    await expect(
      prepareHandout(
        'owner',
        'party',
        { type: 'marker', sceneId: 'other-scene', markerId: 'marker', location: 'originals/image.png' },
        null
      )
    ).rejects.toThrow('Unauthorized');
    mocks.get
      .mockResolvedValueOnce({ role: 'editor' })
      .mockResolvedValueOnce({ partyId: 'party' })
      .mockResolvedValueOnce({ imageLocation: 'old.png' });
    mocks.ownedMedia.mockRejectedValueOnce(new Error('Unauthorized'));
    await expect(
      prepareHandout(
        'owner',
        'party',
        { type: 'marker', sceneId: 'scene', markerId: 'marker', location: 'originals/unowned.png' },
        null
      )
    ).rejects.toThrow('Unauthorized');
  });
  it('rejects absent and non-image artwork', async () => {
    mocks.ownedAsset.mockResolvedValueOnce({ artworkLocation: null, tokenArtworkLocation: null });
    await expect(
      prepareHandout('owner', 'party', { type: 'asset', id: 'asset', artwork: 'portrait' }, null)
    ).rejects.toThrow('Choose artwork');
    mocks.ownedAsset.mockResolvedValueOnce({ artworkLocation: 'originals/video.mp4' });
    await expect(
      prepareHandout('owner', 'party', { type: 'asset', id: 'asset', artwork: 'portrait' }, null)
    ).rejects.toThrow('supported image');
  });
});
