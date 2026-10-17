import { describe, expect, it } from 'vitest';
import { signPartyConnectionToken, verifyPartyConnectionToken } from './partyConnectionToken';

describe('party connection authorization', () => {
  const now = 1_000_000;
  const token = signPartyConnectionToken('user', 'party', 'secret', now);
  it('binds the ticket to its user, party, deployment, and expiry', () => {
    expect(verifyPartyConnectionToken(token, 'party', 'secret', now + 1)).toBe('user');
    expect(() => verifyPartyConnectionToken(token, 'other', 'secret', now)).toThrow('Unauthorized');
    expect(() => verifyPartyConnectionToken(token, 'party', 'other', now)).toThrow('Unauthorized');
    expect(() => verifyPartyConnectionToken(token, 'party', 'secret', now + 60_000)).toThrow('Unauthorized');
    const altered = token.replace(
      token.split('.')[0],
      Buffer.from(JSON.stringify({ userId: 'admin', partyId: 'party', expires: now + 60_000 })).toString('base64url')
    );
    expect(() => verifyPartyConnectionToken(altered, 'party', 'secret', now)).toThrow('Unauthorized');
  });
  it.each(['', 'a.b', 'a.b.c', 'x'.repeat(3000)])('rejects malformed tickets', (value) => {
    expect(() => verifyPartyConnectionToken(value, 'party', 'secret', now)).toThrow('Unauthorized');
  });
});
