import { dev } from '$app/environment';
import { apiFactory } from '$lib/factories';
import { isUserInParty } from '$lib/server';
import { signPartyConnectionToken } from '$lib/server/realtime/partyConnectionToken';
import { z } from 'zod';

export const POST = apiFactory(
  async ({ body, locals }) => {
    const userId = locals.user?.id;
    const secret = process.env.INTERNAL_API_TOKEN || (dev ? 'dev-internal-token' : undefined);
    if (!userId || !secret || !(await isUserInParty(userId, body.partyId))) throw new Error('Unauthorized');
    return { token: signPartyConnectionToken(userId, body.partyId, secret) };
  },
  { validationSchema: z.object({ partyId: z.string().min(1) }) }
);
