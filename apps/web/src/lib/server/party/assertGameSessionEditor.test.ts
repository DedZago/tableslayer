import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { beforeEach, expect, it, vi } from 'vitest';
import { assertGameSessionEditor } from './assertGameSessionEditor';

const { select, where, get } = vi.hoisted(() => ({ select: vi.fn(), where: vi.fn(), get: vi.fn() }));
vi.mock('$lib/db/app', () => ({ db: { select } }));
beforeEach(() => {
  vi.resetAllMocks();
  const chain = { from: vi.fn(), innerJoin: vi.fn(), where, get };
  chain.from.mockReturnValue(chain);
  chain.innerJoin.mockReturnValue(chain);
  where.mockReturnValue(chain);
  select.mockReturnValue(chain);
});
it('binds scene creation to the actual session, party and admin/editor membership', async () => {
  get.mockResolvedValue({ partyId: 'party' });
  await expect(assertGameSessionEditor('user', 'session', 'party')).resolves.toEqual({ partyId: 'party' });
  expect(new SQLiteSyncDialect().sqlToQuery(where.mock.calls[0][0]).params).toEqual([
    'session',
    'party',
    'user',
    'admin',
    'editor'
  ]);
});
it('rejects viewers, nonmembers and a mismatched party/session', async () => {
  get.mockResolvedValue(undefined);
  await expect(assertGameSessionEditor('viewer', 'session', 'wrong-party')).rejects.toThrow('Unauthorized');
});
