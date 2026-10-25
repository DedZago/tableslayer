import { apiFactory } from '$lib/factories';
import { getPartyLiveState } from '$lib/server/realtime';
import { z } from 'zod';

const validationSchema = z.object({
  partyId: z.string()
});

// Polled by a sleeping playfield (every 20 s) to decide whether to reconnect.
// Reads the DB, never a room, so polling costs no Durable Object time.
// Open to any signed-in user, like the TV view's party room.
export const POST = apiFactory(
  async (event) => {
    if (!event.locals.user?.id) throw new Error('Unauthorized');
    const state = await getPartyLiveState(event.body.partyId);
    return { success: true, ...state };
  },
  {
    validationSchema,
    unauthorizedMessage: 'Sign in to view this party.',
    unexpectedErrorMessage: 'Failed to load party state.'
  }
);
