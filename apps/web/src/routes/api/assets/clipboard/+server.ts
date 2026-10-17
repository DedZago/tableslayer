import { dev } from '$app/environment';
import { apiFactory } from '$lib/factories';
import { clipboardPlacements, createClipboardGrant } from '$lib/server/assets';
import { clipboardPointSchema, tokenClipboardSchema } from '$lib/utils/tokenClipboardSchema';
import { z } from 'zod';

export const POST = apiFactory(
  async ({ body, locals }) => {
    const userId = locals.user?.id;
    const secret = process.env.INTERNAL_API_TOKEN || (dev ? 'dev-internal-token' : undefined);
    if (!userId || !secret) throw new Error('Unauthorized');
    if (body.action === 'grant') return createClipboardGrant(userId, body.sceneId, body.locations, secret);
    return { markers: await clipboardPlacements(userId, body.sceneId, body.clipboard, body.positions, secret) };
  },
  {
    validationSchema: z.discriminatedUnion('action', [
      z
        .object({
          action: z.literal('grant'),
          sceneId: z.string().min(1).max(100),
          locations: z.array(z.string().min(1).max(1024)).max(100)
        })
        .strict(),
      z
        .object({
          action: z.literal('paste'),
          sceneId: z.string().min(1).max(100),
          clipboard: tokenClipboardSchema,
          positions: z.array(clipboardPointSchema).min(1).max(100)
        })
        .strict()
    ])
  }
);
