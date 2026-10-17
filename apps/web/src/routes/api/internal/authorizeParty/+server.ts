import { dev } from '$app/environment';
import { db } from '$lib/db/app';
import { partyMemberTable } from '$lib/db/app/schema';
import { apiFactory } from '$lib/factories';
import { assertInternalRequest } from '$lib/server/realtime';
import { verifyPartyConnectionToken } from '$lib/server/realtime/partyConnectionToken';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

export const POST = apiFactory(
  async ({ body, request }) => {
    assertInternalRequest(request);
    const secret = process.env.INTERNAL_API_TOKEN || (dev ? 'dev-internal-token' : undefined);
    if (!secret) throw new Error('Unauthorized');
    const userId = verifyPartyConnectionToken(body.token, body.partyId, secret);
    const member = await db
      .select({ role: partyMemberTable.role })
      .from(partyMemberTable)
      .where(and(eq(partyMemberTable.userId, userId), eq(partyMemberTable.partyId, body.partyId)))
      .get();
    if (!member) throw new Error('Unauthorized');
    return { userId, readOnly: member.role === 'viewer' };
  },
  { validationSchema: z.object({ partyId: z.string().min(1), token: z.string().min(1).max(2048) }) }
);
