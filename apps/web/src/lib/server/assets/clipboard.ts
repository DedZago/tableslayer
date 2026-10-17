import { db } from '$lib/db/app';
import { assetsTable, clipboardArtworkTable, filesTable, markerTable, userFilesTable } from '$lib/db/app/schema';
import type { MarkerRow } from '$lib/realtime';
import { serializeTokenClipboard, type ClipboardPoint, type TokenClipboard } from '$lib/utils/tokenClipboardSchema';
import { and, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { assertSceneEditor } from './assets';
import { signClipboardGrant, verifyClipboardGrant } from './clipboardGrant';

export const createClipboardGrant = async (userId: string, sceneId: string, locations: string[], secret: string) => {
  await assertSceneEditor(userId, sceneId);
  const uniqueLocations = [...new Set(locations)];
  if (uniqueLocations.length) {
    const [files, assets, markers] = await Promise.all([
      db
        .select({ location: filesTable.location })
        .from(filesTable)
        .innerJoin(userFilesTable, eq(userFilesTable.fileId, filesTable.id))
        .where(and(eq(userFilesTable.userId, userId), inArray(filesTable.location, uniqueLocations)))
        .all(),
      db
        .select({ artwork: assetsTable.artworkLocation, token: assetsTable.tokenArtworkLocation })
        .from(assetsTable)
        .where(eq(assetsTable.ownerId, userId))
        .all(),
      db.select({ location: markerTable.imageLocation }).from(markerTable).where(eq(markerTable.sceneId, sceneId)).all()
    ]);
    const available = new Set([
      ...files.map((file) => file.location),
      ...markers.map((marker) => marker.location),
      ...assets.flatMap((asset) => [asset.artwork, asset.token])
    ]);
    if (uniqueLocations.some((location) => !available.has(location))) throw new Error('Unauthorized');
  }
  if (uniqueLocations.length)
    await db
      .insert(clipboardArtworkTable)
      .values(uniqueLocations.map((location) => ({ location })))
      .onConflictDoNothing();
  return signClipboardGrant(uniqueLocations, secret);
};

export const clipboardPlacements = async (
  userId: string,
  sceneId: string,
  clipboard: TokenClipboard,
  positions: ClipboardPoint[],
  secret: string
): Promise<MarkerRow[]> => {
  serializeTokenClipboard(clipboard);
  await assertSceneEditor(userId, sceneId);
  if (positions.length !== clipboard.tokens.length) throw new Error('Token clipboard positions do not match the group');
  verifyClipboardGrant(
    clipboard,
    clipboard.tokens.flatMap((token) => (token.imageLocation ? [token.imageLocation] : [])),
    secret
  );
  const assetIds = [...new Set(clipboard.tokens.flatMap((token) => (token.assetId ? [token.assetId] : [])))];
  const availableAssets = new Set(
    assetIds.length
      ? (
          await db
            .select({ id: assetsTable.id })
            .from(assetsTable)
            .where(and(eq(assetsTable.ownerId, userId), inArray(assetsTable.id, assetIds)))
            .all()
        ).map((asset) => asset.id)
      : []
  );
  return clipboard.tokens.map((token, index) => ({
    id: randomUUID(),
    sceneId,
    title: token.title,
    label: token.label,
    imageLocation: token.imageLocation,
    imageScale: token.imageScale,
    shape: token.shape,
    shapeColor: token.shapeColor,
    size: token.size,
    visibility: token.visibility,
    note: structuredClone(token.note),
    assetId: token.assetId && availableAssets.has(token.assetId) ? token.assetId : null,
    positionX: positions[index].x,
    positionY: positions[index].y,
    pinnedTooltip: false
  }));
};
