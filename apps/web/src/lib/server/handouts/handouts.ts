import { db } from '$lib/db/app';
import { gameSessionTable, markerTable, partyMemberTable, sceneTable } from '$lib/db/app/schema';
import type { HandoutDescriptor } from '$lib/realtime/types';
import { assertOwnedMedia, getOwnedAsset } from '$lib/server/assets/assets';
import { validateMediaUpload } from '$lib/utils/mediaUpload';
import { and, eq, inArray } from 'drizzle-orm';
import mime from 'mime';
import { randomUUID } from 'node:crypto';
import type { HandoutSource } from './types';

export const assertPartyEditor = async (userId: string, partyId: string) => {
  const membership = await db
    .select({ role: partyMemberTable.role })
    .from(partyMemberTable)
    .where(
      and(
        eq(partyMemberTable.userId, userId),
        eq(partyMemberTable.partyId, partyId),
        inArray(partyMemberTable.role, ['admin', 'editor'])
      )
    )
    .get();
  if (!membership) throw new Error('Unauthorized');
};

export const prepareHandout = async (
  userId: string,
  partyId: string,
  source: HandoutSource,
  title: string | null
): Promise<HandoutDescriptor> => {
  await assertPartyEditor(userId, partyId);
  let artworkLocation: string | null;
  if (source.type === 'asset') {
    const asset = await getOwnedAsset(userId, source.id);
    artworkLocation =
      source.artwork === 'token'
        ? asset.tokenArtworkLocation || asset.artworkLocation
        : asset.artworkLocation || asset.tokenArtworkLocation;
  } else if (source.type === 'upload') {
    await assertOwnedMedia(userId, source.location);
    artworkLocation = source.location;
  } else {
    const scene = await db
      .select({ partyId: gameSessionTable.partyId })
      .from(sceneTable)
      .innerJoin(gameSessionTable, eq(sceneTable.gameSessionId, gameSessionTable.id))
      .where(and(eq(sceneTable.id, source.sceneId), eq(gameSessionTable.partyId, partyId)))
      .get();
    if (!scene) throw new Error('Unauthorized');
    const marker = await db
      .select({ imageLocation: markerTable.imageLocation })
      .from(markerTable)
      .where(and(eq(markerTable.id, source.markerId), eq(markerTable.sceneId, source.sceneId)))
      .get();
    if (!marker || marker.imageLocation !== source.location) await assertOwnedMedia(userId, source.location);
    artworkLocation = source.location;
  }
  if (!artworkLocation) throw new Error('Choose artwork before showing a handout');
  validateMediaUpload({ type: mime.getType(artworkLocation.split('?')[0]) || '', size: 1 }, true);
  // Fresh membership after asynchronous selection prevents publishing after role removal.
  await assertPartyEditor(userId, partyId);
  return {
    presentationId: randomUUID(),
    artworkLocation,
    title,
    presenterId: userId,
    publishedAt: Math.floor(Date.now() / 1000)
  };
};
