import { createHmac, timingSafeEqual } from 'node:crypto';

export const signPartyConnectionToken = (userId: string, partyId: string, secret: string, now = Date.now()) => {
  const payload = Buffer.from(JSON.stringify({ userId, partyId, expires: now + 60_000 })).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
};

export const verifyPartyConnectionToken = (
  token: string,
  partyId: string,
  secret: string,
  now = Date.now()
): string => {
  try {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra || token.length > 2048) throw new Error('Unauthorized');
    const expected = createHmac('sha256', secret).update(payload).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Unauthorized');
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      userId: unknown;
      partyId: unknown;
      expires: unknown;
    };
    if (
      typeof parsed.userId !== 'string' ||
      !parsed.userId ||
      parsed.partyId !== partyId ||
      typeof parsed.expires !== 'number' ||
      parsed.expires <= now ||
      parsed.expires > now + 60_000
    )
      throw new Error('Unauthorized');
    return parsed.userId;
  } catch {
    throw new Error('Unauthorized');
  }
};
