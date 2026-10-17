import { apiFactory } from '$lib/factories';
import { refreshFiveToolsCatalog, searchFiveToolsCatalog } from '$lib/server';
import { z } from 'zod';

const validationSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('search'),
    search: z.string().max(200).default(''),
    source: z.string().max(100).default(''),
    offset: z.number().int().min(0).max(100000).default(0)
  }),
  z.object({ action: z.literal('refresh') })
]);
export const POST = apiFactory(
  async ({ body, locals }) => {
    if (!locals.user?.id) throw new Error('Unauthorized');
    if (body.action === 'refresh') return refreshFiveToolsCatalog();
    return searchFiveToolsCatalog(locals.user.id, body.search, body.source, body.offset);
  },
  { validationSchema }
);
