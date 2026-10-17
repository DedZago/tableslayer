import { apiFactory } from '$lib/factories';
import { assertPartyEditor, prepareHandout } from '$lib/server';
import { z } from 'zod';

const sourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('asset'), id: z.uuid(), artwork: z.enum(['portrait', 'token']).default('portrait') }),
  z.object({ type: z.literal('upload'), location: z.string().min(1).max(1024) }),
  z.object({
    type: z.literal('marker'),
    sceneId: z.string().min(1),
    markerId: z.string().min(1),
    location: z.string().min(1).max(1024)
  })
]);
const validationSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('prepare'),
    partyId: z.string(),
    source: sourceSchema,
    title: z.string().trim().max(200).nullable().default(null)
  }),
  z.object({ action: z.literal('authorize'), partyId: z.string() })
]);
export const POST = apiFactory(
  async ({ body, locals }) => {
    const userId = locals.user?.id;
    if (!userId) throw new Error('Unauthorized');
    if (body.action === 'authorize') {
      await assertPartyEditor(userId, body.partyId);
      return { success: true };
    }
    return { handout: await prepareHandout(userId, body.partyId, body.source, body.title) };
  },
  { validationSchema }
);
