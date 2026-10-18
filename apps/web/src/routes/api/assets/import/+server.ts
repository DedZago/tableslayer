import { apiFactory } from '$lib/factories';
import { importFiveToolsItems, previewFiveToolsImport } from '$lib/server';
import { statBlockSchema } from '$lib/utils/statBlock/schema';
import { z } from 'zod';

const recordSchema = z.object({
  identity: z.string().min(1).max(1000),
  name: z.string().trim().min(1).max(200),
  source: z.string().trim().min(1).max(100),
  tokenUrl: z.string().max(2048).nullable(),
  artworkUrl: z.string().max(2048).nullable(),
  warnings: z.array(z.string().max(1000)).max(100).default([]),
  cr: z.string().max(40).optional(),
  creatureType: z.string().max(100).optional(),
  size: z.string().max(100).optional(),
  statBlock: statBlockSchema.nullable().optional()
});
const validationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('preview'), json: z.string().max(10 * 1024 * 1024) }),
  z.object({
    action: z.literal('import'),
    items: z
      .array(
        z.object({
          record: recordSchema,
          requestId: z.uuid(),
          policy: z.enum(['skip', 'update', 'another']),
          targetId: z.uuid().optional()
        })
      )
      .min(1)
      .max(100)
      .refine(
        (items) => new Set(items.map((item) => item.requestId)).size === items.length,
        'Each item needs a unique import request'
      )
  })
]);

export const POST = apiFactory(
  async ({ body, locals }) => {
    const ownerId = locals.user?.id;
    if (!ownerId) throw new Error('Unauthorized');
    if (body.action === 'preview') return { records: await previewFiveToolsImport(ownerId, body.json) };
    return { results: await importFiveToolsItems(ownerId, body.items) };
  },
  { validationSchema }
);
