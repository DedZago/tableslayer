import type { TokenClipboard } from '$lib/utils/tokenClipboardSchema';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clipboardPlacements, createClipboardGrant } from './clipboard';
import { signClipboardGrant } from './clipboardGrant';

const { authorize, all, select, where, insert, values, onConflictDoNothing } = vi.hoisted(() => ({
  authorize: vi.fn(),
  all: vi.fn(),
  select: vi.fn(),
  where: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  onConflictDoNothing: vi.fn()
}));
vi.mock('./assets', () => ({ assertSceneEditor: authorize }));
vi.mock('$lib/db/app', () => ({ db: { select, insert } }));

beforeEach(() => {
  vi.resetAllMocks();
  const chain = { from: vi.fn(), innerJoin: vi.fn(), where, all };
  chain.from.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  where.mockReturnValue(chain);
  select.mockReturnValue(chain);
  insert.mockReturnValue({ values });
  values.mockReturnValue({ onConflictDoNothing });
  onConflictDoNothing.mockResolvedValue(undefined);
  authorize.mockResolvedValue({ partyId: 'party' });
});

const copied = (): TokenClipboard => ({
  format: 'tableslayer.tokens',
  version: 1,
  ...signClipboardGrant(['originals/a.png'], 'secret'),
  basis: 'grid',
  anchor: { x: 0, y: 0 },
  tokens: [
    {
      title: 'Wolf',
      label: null,
      imageLocation: 'originals/a.png',
      imageScale: 1.5,
      shape: 1,
      shapeColor: '#ffffff',
      size: 1,
      visibility: 1,
      assetId: 'library-origin',
      note: { type: 'doc', content: [{ type: 'paragraph' }] },
      offset: { x: 0, y: 0 },
      displayOffset: { x: 0, y: 0 }
    }
  ]
});
const positions = [{ x: 10, y: 20 }];

describe('clipboard destination and artwork authorization', () => {
  it('checks source editing access and scopes grant artwork to owned media/assets or source scene references', async () => {
    all
      .mockResolvedValueOnce([{ location: 'originals/owned.png' }])
      .mockResolvedValueOnce([{ artwork: 'originals/library.png', token: null }])
      .mockResolvedValueOnce([{ location: 'originals/shared.png' }]);
    const grant = await createClipboardGrant(
      'owner',
      'source-scene',
      ['originals/owned.png', 'originals/shared.png', 'originals/library.png'],
      'secret'
    );
    expect(grant.mediaGrant).toBeTruthy();
    expect(values).toHaveBeenCalledWith([
      { location: 'originals/owned.png' },
      { location: 'originals/shared.png' },
      { location: 'originals/library.png' }
    ]);
    expect(onConflictDoNothing).toHaveBeenCalledOnce();
    expect(authorize).toHaveBeenCalledWith('owner', 'source-scene');
    const conditions = where.mock.calls.map(([condition]) => new SQLiteSyncDialect().sqlToQuery(condition).params);
    expect(conditions[0][0]).toBe('owner');
    expect(conditions[1]).toEqual(['owner']);
    expect(conditions[2]).toEqual(['source-scene']);
  });

  it('does not grant another owner artwork absent from the source scene', async () => {
    all.mockResolvedValue([]);
    await expect(createClipboardGrant('owner', 'source', ['originals/private.png'], 'secret')).rejects.toThrow(
      'Unauthorized'
    );
    expect(insert).not.toHaveBeenCalled();
  });

  it('does not issue a grant if durable artwork retention fails', async () => {
    all.mockResolvedValue([{ location: 'originals/owned.png' }]);
    onConflictDoNothing.mockRejectedValue(new Error('Ledger unavailable'));
    await expect(createClipboardGrant('owner', 'source', ['originals/owned.png'], 'secret')).rejects.toThrow(
      'Ledger unavailable'
    );
  });

  it('rejects a destination viewer before producing any placement', async () => {
    authorize.mockRejectedValue(new Error('Unauthorized'));
    await expect(clipboardPlacements('viewer', 'destination', copied(), positions, 'secret')).rejects.toThrow(
      'Unauthorized'
    );
    expect(select).not.toHaveBeenCalled();
  });

  it('creates fresh IDs after source deletion and drops unavailable library links without losing artwork or notes', async () => {
    all.mockResolvedValue([]);
    const clipboard = copied();
    const first = await clipboardPlacements('owner', 'destination', clipboard, positions, 'secret');
    const second = await clipboardPlacements('owner', 'destination', clipboard, positions, 'secret');
    expect(first[0].id).not.toBe(second[0].id);
    expect(first[0]).toMatchObject({
      sceneId: 'destination',
      assetId: null,
      imageLocation: 'originals/a.png',
      pinnedTooltip: false,
      positionX: 10,
      positionY: 20
    });
    (first[0].note as { content: unknown[] }).content.length = 0;
    expect((second[0].note as { content: unknown[] }).content).toHaveLength(1);
    expect((clipboard.tokens[0].note as { content: unknown[] }).content).toHaveLength(1);
  });

  it('retains only destination-user-owned library links', async () => {
    all.mockResolvedValue([{ id: 'library-origin' }]);
    expect((await clipboardPlacements('owner', 'destination', copied(), positions, 'secret'))[0].assetId).toBe(
      'library-origin'
    );
    const params = new SQLiteSyncDialect().sqlToQuery(where.mock.calls[0][0]).params;
    expect(params).toEqual(['owner', 'library-origin']);
  });

  it('rejects mismatched group positions and an injected artwork reference', async () => {
    await expect(clipboardPlacements('owner', 'destination', copied(), [], 'secret')).rejects.toThrow('positions');
    const injected = copied();
    injected.tokens[0].imageLocation = 'originals/private.png';
    await expect(clipboardPlacements('owner', 'destination', injected, positions, 'secret')).rejects.toThrow(
      'unauthorized artwork'
    );
    expect(select).not.toHaveBeenCalled();
  });
});
