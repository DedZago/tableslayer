import type * as Party from 'partykit/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import PartyServer from '../../partykit/party';

const { authorize, connect } = vi.hoisted(() => ({ authorize: vi.fn(), connect: vi.fn() }));
vi.mock('../../partykit/appApi', () => ({ appRequest: authorize }));
vi.mock('../../partykit/roomActivity', () => ({
  createRoomActivityReporter: () => ({ queue: vi.fn(), flush: vi.fn() })
}));
vi.mock('y-partykit', () => ({
  onConnect: connect,
  unstable_getYDoc: async () => {
    const doc = new Y.Doc();
    doc.getMap('meta').set('schemaVersion', 2);
    doc.getMap('meta').set('hydratedAt', 1);
    return doc;
  }
}));

beforeEach(() => vi.resetAllMocks());

const createServer = () => new PartyServer({ id: 'party', env: {}, getConnections: () => [] } as unknown as Party.Room);
const context = {
  request: new Request('https://example.test/parties/party/party?token=signed-ticket')
} as unknown as Party.ConnectionContext;

describe('party document write permissions', () => {
  it('rejects unauthorized connections before attaching the Y.js protocol', async () => {
    authorize.mockRejectedValue(new Error('Unauthorized'));
    const close = vi.fn();
    await createServer().onConnect({ close } as unknown as Party.Connection, context);
    expect(close).toHaveBeenCalledWith(1008, 'Party authorization failed');
    expect(connect).not.toHaveBeenCalled();
  });

  it.each([true, false])('sets per-connection readOnly=%s from verified server membership', async (readOnly) => {
    authorize.mockResolvedValue({ userId: 'member', readOnly });
    const connection = { close: vi.fn() } as unknown as Party.Connection;
    await createServer().onConnect(connection, context);
    expect(authorize).toHaveBeenCalledWith(expect.anything(), '/api/internal/authorizeParty', {
      partyId: 'party',
      token: 'signed-ticket'
    });
    expect(connect).toHaveBeenCalledWith(connection, expect.anything(), expect.objectContaining({ readOnly }));
  });
});
