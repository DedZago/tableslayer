import type { ClipboardGrant } from '$lib/utils/tokenClipboardSchema';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const claimsSchema = z
  .object({
    deploymentId: z.string().min(1).max(100),
    locations: z.array(z.string().min(1).max(1024)).max(100)
  })
  .strict();

export const signClipboardGrant = (locations: string[], secret: string): ClipboardGrant => {
  const deploymentId = createHash('sha256').update(`tableslayer.clipboard.v1:${secret}`).digest('hex');
  const payload = Buffer.from(JSON.stringify({ deploymentId, locations: [...new Set(locations)].sort() })).toString(
    'base64url'
  );
  const signature = createHmac('sha256', secret).update(`clipboard:${payload}`).digest('base64url');
  return { deploymentId, mediaGrant: `${payload}.${signature}` };
};

export const verifyClipboardGrant = (grant: ClipboardGrant, locations: string[], secret: string) => {
  try {
    const [payload, signature, extra] = grant.mediaGrant.split('.');
    if (!payload || !signature || extra || grant.mediaGrant.length > 150_000) throw new Error();
    const expected = createHmac('sha256', secret).update(`clipboard:${payload}`).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
    const claims = claimsSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString()));
    if (
      claims.deploymentId !== grant.deploymentId ||
      claims.deploymentId !== signClipboardGrant([], secret).deploymentId ||
      locations.some((location) => !claims.locations.includes(location))
    )
      throw new Error();
  } catch {
    throw new Error('Token clipboard belongs to another deployment or contains unauthorized artwork');
  }
};
