import { dev } from '$app/environment';
import { apiFactory } from '$lib/factories';
import { signPartyConnectionToken } from '$lib/server/realtime/partyConnectionToken';
import { z } from 'zod';

// Any signed-in user may join a party room, so the TV view works for players outside the party
export const POST = apiFactory(
  async ({ body, locals }) => {
    const userId = locals.user?.id;
    const secret = process.env.INTERNAL_API_TOKEN || (dev ? 'dev-internal-token' : undefined);
    if (!userId || !secret) throw new Error('Unauthorized');
    return { token: signPartyConnectionToken(userId, body.partyId, secret) };
  },
  { validationSchema: z.object({ partyId: z.string().min(1) }) }
);
