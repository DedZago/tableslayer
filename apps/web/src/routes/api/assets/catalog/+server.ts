import { apiFactory } from '$lib/factories';
import { fiveToolsCatalogStatBlock, refreshFiveToolsCatalog, searchFiveToolsCatalog } from '$lib/server';
import { z } from 'zod';

const validationSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('search'),
    search: z.string().max(200).default(''),
    source: z.string().max(100).default(''),
    offset: z.number().int().min(0).max(100000).default(0),
    crRange: z.string().max(20).default(''),
    creatureType: z.string().max(40).default('')
  }),
  z.object({ action: z.literal('statBlock'), identity: z.string().max(1000) }),
  z.object({ action: z.literal('refresh') })
]);
export const POST = apiFactory(
  async ({ body, locals }) => {
    if (!locals.user?.id) throw new Error('Unauthorized');
    if (body.action === 'refresh') return refreshFiveToolsCatalog();
    if (body.action === 'statBlock') return { statBlock: await fiveToolsCatalogStatBlock(body.identity) };
    return searchFiveToolsCatalog(locals.user.id, body.search, body.source, body.offset, {
      crRange: body.crRange,
      creatureType: body.creatureType
    });
  },
  { validationSchema }
);
