import { db } from '$lib/db/app';
import {
  type AssetRole,
  assetsTable,
  filesTable,
  gameSessionTable,
  markerTable,
  partyMemberTable,
  sceneTable,
  userFilesTable
} from '$lib/db/app/schema';
import type { MarkerRow } from '$lib/realtime';
import { validateMediaUpload } from '$lib/utils/mediaUpload';
import type { StatBlock } from '$lib/utils/statBlock/types';
import { and, eq, inArray, sql } from 'drizzle-orm';
import mime from 'mime';
import { randomUUID } from 'node:crypto';

export type AssetStatSummary = { cr: string | null; type: string | null; size: string | null };
const parseStatSummary = (value: string | null) => (value ? (JSON.parse(value) as AssetStatSummary) : null);
const assetListColumns = {
  id: assetsTable.id,
  ownerId: assetsTable.ownerId,
  name: assetsTable.name,
  artworkLocation: assetsTable.artworkLocation,
  tokenArtworkLocation: assetsTable.tokenArtworkLocation,
  shape: assetsTable.shape,
  shapeColor: assetsTable.shapeColor,
  size: assetsTable.size,
  imageScale: assetsTable.imageScale,
  role: assetsTable.role,
  cropX: assetsTable.cropX,
  cropY: assetsTable.cropY,
  cropZoom: assetsTable.cropZoom,
  provider: assetsTable.provider,
  originalName: assetsTable.originalName,
  sourceIdentity: assetsTable.sourceIdentity,
  sourceUrl: assetsTable.sourceUrl,
  adapterVersion: assetsTable.adapterVersion,
  importRequestId: assetsTable.importRequestId,
  initiativeBonus: assetsTable.initiativeBonus,
  createdAt: assetsTable.createdAt,
  updatedAt: assetsTable.updatedAt
};

export const assertSceneEditor = async (userId: string, sceneId: string) => {
  const result = await db
    .select({ partyId: gameSessionTable.partyId })
    .from(sceneTable)
    .innerJoin(gameSessionTable, eq(sceneTable.gameSessionId, gameSessionTable.id))
    .innerJoin(partyMemberTable, eq(partyMemberTable.partyId, gameSessionTable.partyId))
    .where(
      and(
        eq(sceneTable.id, sceneId),
        eq(partyMemberTable.userId, userId),
        inArray(partyMemberTable.role, ['admin', 'editor'])
      )
    )
    .get();
  if (!result) throw new Error('Unauthorized');
  return result;
};

export const assertOwnedMedia = async (userId: string, location?: string | null) => {
  if (!location) return;
  validateMediaUpload({ type: mime.getType(location.split('?')[0]) || '', size: 1 }, true);
  const file = await db
    .select({ id: filesTable.id })
    .from(filesTable)
    .innerJoin(userFilesTable, eq(filesTable.id, userFilesTable.fileId))
    .where(and(eq(userFilesTable.userId, userId), eq(filesTable.location, location)))
    .get();
  if (!file) throw new Error('Unauthorized');
};

export const listAssets = (ownerId: string, search: string) =>
  db
    .select({
      ...assetListColumns,
      statSummary:
        sql<AssetStatSummary | null>`CASE WHEN ${assetsTable.statBlock} IS NULL THEN NULL ELSE json_object('cr', json_extract(${assetsTable.statBlock}, '$.cr.display'), 'type', json_extract(${assetsTable.statBlock}, '$.type'), 'size', json_extract(${assetsTable.statBlock}, '$.size[0]')) END`.mapWith(
          parseStatSummary
        )
    })
    .from(assetsTable)
    .where(and(eq(assetsTable.ownerId, ownerId), sql`instr(lower(${assetsTable.name}), lower(${search})) > 0`))
    .orderBy(assetsTable.name)
    .all();

export const getOwnedAsset = async (ownerId: string, id: string) => {
  const asset = await db
    .select()
    .from(assetsTable)
    .where(and(eq(assetsTable.ownerId, ownerId), eq(assetsTable.id, id)))
    .get();
  if (!asset) throw new Error('Unauthorized');
  return asset;
};

export const saveAsset = async (
  ownerId: string,
  fields: {
    id?: string;
    name?: string;
    artworkLocation?: string | null;
    tokenArtworkLocation?: string | null;
    shape?: number;
    shapeColor?: string;
    size?: number;
    imageScale?: number;
    role?: AssetRole | null;
    cropX?: number;
    cropY?: number;
    cropZoom?: number;
    statBlock?: StatBlock | null;
    initiativeBonus?: number | null;
  }
) => {
  const previous = fields.id ? await getOwnedAsset(ownerId, fields.id) : null;
  if (fields.artworkLocation !== previous?.artworkLocation) await assertOwnedMedia(ownerId, fields.artworkLocation);
  if (fields.tokenArtworkLocation !== previous?.tokenArtworkLocation)
    await assertOwnedMedia(ownerId, fields.tokenArtworkLocation);
  const { id, ...values } = fields;
  if (id) {
    return db
      .update(assetsTable)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(assetsTable.id, id), eq(assetsTable.ownerId, ownerId)))
      .returning()
      .get();
  }
  if (!values.name) throw new Error('Name is required');
  return db
    .insert(assetsTable)
    .values({ ...values, name: values.name, ownerId })
    .returning()
    .get();
};

export const deleteAsset = async (ownerId: string, id: string) => {
  await getOwnedAsset(ownerId, id);
  await db.delete(assetsTable).where(and(eq(assetsTable.id, id), eq(assetsTable.ownerId, ownerId)));
  return { success: true };
};

export const assetFromMarker = async (
  ownerId: string,
  sceneId: string,
  markerId: string,
  snapshot?: {
    name: string;
    artworkLocation?: string | null;
    shape?: number;
    shapeColor?: string;
    size?: number;
    imageScale?: number;
    statBlock?: StatBlock | null;
    initiativeBonus?: number | null;
  }
) => {
  await assertSceneEditor(ownerId, sceneId);
  const marker = await db
    .select()
    .from(markerTable)
    .where(and(eq(markerTable.id, markerId), eq(markerTable.sceneId, sceneId)))
    .get();
  if (!marker && !snapshot) throw new Error('Token has not been saved yet; try again after synchronization');
  const values = snapshot
    ? {
        ...snapshot,
        statBlock: snapshot.statBlock !== undefined ? snapshot.statBlock : (marker?.statBlock ?? null),
        initiativeBonus:
          snapshot.initiativeBonus !== undefined ? snapshot.initiativeBonus : (marker?.initiativeBonus ?? null)
      }
    : {
        name: marker!.title,
        artworkLocation: marker!.imageLocation,
        shape: marker!.shape,
        shapeColor: marker!.shapeColor,
        size: marker!.size,
        imageScale: marker!.imageScale,
        statBlock: marker!.statBlock,
        initiativeBonus: marker!.initiativeBonus
      };
  if (values.artworkLocation !== marker?.imageLocation) await assertOwnedMedia(ownerId, values.artworkLocation);
  return db
    .insert(assetsTable)
    .values({ ...values, ownerId })
    .returning()
    .get();
};

export const assetPlacements = async (
  ownerId: string,
  id: string,
  sceneId: string,
  quantity: number,
  x: number,
  y: number
): Promise<MarkerRow[]> => {
  await assertSceneEditor(ownerId, sceneId);
  const asset = await getOwnedAsset(ownerId, id);
  return Array.from({ length: quantity }, () => ({
    id: randomUUID(),
    sceneId,
    assetId: asset.id,
    title: asset.name,
    label: null,
    imageLocation: asset.tokenArtworkLocation || asset.artworkLocation,
    imageScale: asset.imageScale,
    positionX: x,
    positionY: y,
    shape: asset.shape,
    shapeColor: asset.shapeColor,
    size: asset.size,
    visibility: 0,
    note: null,
    pinnedTooltip: false,
    statBlock: asset.statBlock ?? null,
    hitPoints: asset.statBlock?.hp.average ?? null,
    tempHitPoints: null,
    initiativeBonus: asset.initiativeBonus ?? null
  }));
};

export const pruneUnavailableAssetLinks = async (markers: MarkerRow[]) => {
  const ids = [...new Set(markers.flatMap((marker) => (marker.assetId ? [marker.assetId] : [])))];
  if (!ids.length) return markers;
  const existing = new Set(
    (await db.select({ id: assetsTable.id }).from(assetsTable).where(inArray(assetsTable.id, ids)).all()).map(
      (asset) => asset.id
    )
  );
  return markers.map((marker) => ({
    ...marker,
    assetId: marker.assetId && existing.has(marker.assetId) ? marker.assetId : null
  }));
};
