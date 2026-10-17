import type { RequestHandler } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as createInvite } from '../../src/routes/api/partyInvite/createPartyInvite/+server';
import { POST as deleteInvite } from '../../src/routes/api/partyInvite/deletePartyInvite/+server';
import { POST as refreshInvite } from '../../src/routes/api/partyInvite/refreshPartyInviteLink/+server';
import { POST as resendInvite } from '../../src/routes/api/partyInvite/resendPartyInvite/+server';
import { POST as deleteMember } from '../../src/routes/api/partyMember/deletePartyMember/+server';
import { POST } from '../../src/routes/api/partyMember/updatePartyMember/+server';

const {
  isUserAdminInParty,
  isUserInParty,
  updatePartyMember,
  createPartyInvite,
  deletePartyMember,
  resendPartyInvite,
  refreshPartyInviteLink,
  deletePartyInviteByEmail
} = vi.hoisted(() => ({
  isUserAdminInParty: vi.fn(),
  isUserInParty: vi.fn(),
  createPartyInvite: vi.fn(),
  deletePartyMember: vi.fn(),
  resendPartyInvite: vi.fn(),
  refreshPartyInviteLink: vi.fn(),
  deletePartyInviteByEmail: vi.fn(),
  updatePartyMember: vi.fn()
}));
vi.mock('$lib/server', () => ({
  isUserAdminInParty,
  isUserInParty,
  updatePartyMember,
  createPartyInvite,
  deletePartyMember,
  resendPartyInvite,
  refreshPartyInviteLink,
  deletePartyInviteByEmail,
  UserAlreadyInPartyError: class extends Error {},
  UserAlreadyInvitedError: class extends Error {}
}));
vi.mock('@sentry/sveltekit', () => ({ captureException: vi.fn() }));

const request = (userId?: string) =>
  POST({
    request: new Request('https://example.test/api/partyMember/updatePartyMember', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ partyId: 'party', userId: 'target', role: 'admin' })
    }),
    locals: { user: userId ? { id: userId } : null }
  } as Parameters<RequestHandler>[0]);

beforeEach(() => vi.resetAllMocks());

describe('party member role authorization', () => {
  it('rejects unauthenticated requests', async () => {
    expect((await request()).status).toBe(401);
    expect(isUserAdminInParty).not.toHaveBeenCalled();
    expect(updatePartyMember).not.toHaveBeenCalled();
  });

  it.each(['viewer', 'editor', 'outsider'])('rejects %s role changes after awaiting authorization', async (userId) => {
    isUserAdminInParty.mockResolvedValue(false);
    expect((await request(userId)).status).toBe(401);
    expect(isUserAdminInParty).toHaveBeenCalledWith(userId, 'party');
    expect(updatePartyMember).not.toHaveBeenCalled();
  });

  it('allows an administrator to change a member role', async () => {
    isUserAdminInParty.mockResolvedValue(true);
    updatePartyMember.mockResolvedValue({ userId: 'target', partyRole: 'admin' });
    expect((await request('administrator')).status).toBe(200);
    expect(updatePartyMember).toHaveBeenCalledWith({ partyId: 'party', userId: 'target', role: 'admin' });
  });
});

const invoke = (handler: RequestHandler, body: unknown, userId = 'viewer') =>
  handler({
    request: new Request('https://example.test/api', { method: 'POST', body: JSON.stringify(body) }),
    locals: { user: { id: userId } }
  } as Parameters<RequestHandler>[0]);

describe('alternate membership escalation paths', () => {
  it('rejects an admin invitation created by a non-admin and propagates authorization failure', async () => {
    isUserAdminInParty.mockResolvedValue(false);
    const response = await invoke(createInvite, { partyId: 'party', email: 'member@example.test', role: 'admin' });
    expect(response.status).toBe(401);
    expect(createPartyInvite).not.toHaveBeenCalled();
  });

  it('permits an administrator to invite a member', async () => {
    isUserAdminInParty.mockResolvedValue(true);
    createPartyInvite.mockResolvedValue({ code: 'invite' });
    expect(
      (await invoke(createInvite, { partyId: 'party', email: 'member@example.test', role: 'viewer' }, 'admin')).status
    ).toBe(200);
    expect(createPartyInvite).toHaveBeenCalledWith('member@example.test', 'party', 'admin', 'viewer');
  });

  it('rejects removing another member without admin permissions', async () => {
    isUserAdminInParty.mockResolvedValue(false);
    expect((await invoke(deleteMember, { partyId: 'party', userId: 'other' })).status).toBe(401);
    expect(deletePartyMember).not.toHaveBeenCalled();
  });

  it('allows a member to leave their own party', async () => {
    isUserInParty.mockResolvedValue(true);
    expect((await invoke(deleteMember, { partyId: 'party', userId: 'viewer' })).status).toBe(200);
    expect(deletePartyMember).toHaveBeenCalledWith('viewer', 'party');
    expect(isUserAdminInParty).not.toHaveBeenCalled();
  });

  it('rejects a non-member attempting the self-leave path', async () => {
    isUserInParty.mockResolvedValue(false);
    expect((await invoke(deleteMember, { partyId: 'party', userId: 'viewer' })).status).toBe(401);
    expect(deletePartyMember).not.toHaveBeenCalled();
  });
});

describe('existing invitation management', () => {
  it.each([
    ['resend', resendInvite, resendPartyInvite],
    ['refresh', refreshInvite, refreshPartyInviteLink],
    ['delete', deleteInvite, deletePartyInviteByEmail]
  ] as const)('rejects a non-admin attempting to %s an invitation', async (_, handler, mutation) => {
    isUserAdminInParty.mockResolvedValue(false);
    expect((await invoke(handler, { partyId: 'party', email: 'member@example.test' })).status).toBe(401);
    expect(mutation).not.toHaveBeenCalled();
  });
});
