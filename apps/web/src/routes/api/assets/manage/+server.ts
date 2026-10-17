import { apiFactory } from '$lib/factories';
import {
  assertOwnedMedia,
  assertSceneEditor,
  assetFromMarker,
  assetPlacements,
  deleteAsset,
  listAssets,
  saveAsset
} from '$lib/server';
import { z } from 'zod';

const fields = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(200),
  artworkLocation: z.string().max(1024).nullable().optional(),
  tokenArtworkLocation: z.string().max(1024).nullable().optional(),
  shape: z.number().int().min(0).max(4).optional(),
  shapeColor: z
    .string()
    .regex(/^#[a-fA-F0-9]{6}$/)
    .optional(),
  size: z.number().int().min(1).max(3).optional(),
  imageScale: z.number().finite().min(0.1).max(10).optional()
});
const validationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('authorizeArtwork'), sceneId: z.string(), location: z.string().max(1024).optional() }),
  z.object({ action: z.literal('list'), search: z.string().max(200).default('') }),
  z.object({ action: z.literal('save'), fields }),
  z.object({ action: z.literal('delete'), id: z.uuid() }),
  z.object({
    action: z.literal('saveMarker'),
    sceneId: z.string(),
    markerId: z.string(),
    snapshot: fields.omit({ id: true, tokenArtworkLocation: true }).optional()
  }),
  z.object({
    action: z.literal('place'),
    id: z.uuid(),
    sceneId: z.string(),
    quantity: z.number().int().min(1).max(100),
    x: z.number().finite(),
    y: z.number().finite()
  })
]);

export const POST = apiFactory(
  async ({ body, locals }) => {
    const ownerId = locals.user?.id;
    if (!ownerId) throw new Error('Unauthorized');
    switch (body.action) {
      case 'authorizeArtwork':
        await assertSceneEditor(ownerId, body.sceneId);
        if (body.location) await assertOwnedMedia(ownerId, body.location);
        return { success: true };
      case 'list':
        return { assets: await listAssets(ownerId, body.search) };
      case 'save':
        return { asset: await saveAsset(ownerId, body.fields) };
      case 'delete':
        return deleteAsset(ownerId, body.id);
      case 'saveMarker':
        return { asset: await assetFromMarker(ownerId, body.sceneId, body.markerId, body.snapshot) };
      case 'place':
        return { markers: await assetPlacements(ownerId, body.id, body.sceneId, body.quantity, body.x, body.y) };
    }
  },
  { validationSchema }
);
