import { db } from '$lib/db/app';
import { assetImportReceiptsTable, assetsTable } from '$lib/db/app/schema';
import { storeImportedArtwork } from '$lib/server/file/files';
import type { StatBlock } from '$lib/utils/statBlock/types';
import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { FIVETOOLS_ADAPTER_VERSION, fiveToolsIdentity, previewFiveToolsJson } from './adapter';
import { fiveToolsCatalogStatBlock } from './catalog';
import { downloadFiveToolsArtwork } from './download';
import type { FiveToolsImportItem, FiveToolsImportResult, FiveToolsPreview } from './types';

export const fiveToolsImageBase = () => process.env.FIVETOOLS_IMAGE_BASE_URL || 'https://5e.tools/img/';
const sourceUrl = (record: FiveToolsPreview) =>
  `https://5e.tools/bestiary.html#${encodeURIComponent(record.name.toLowerCase())}_${encodeURIComponent(record.source.toLowerCase())}`;

export const previewFiveToolsImport = async (ownerId: string, json: string) => {
  const records = previewFiveToolsJson(json, fiveToolsImageBase());
  return fiveToolsDuplicates(ownerId, records);
};

export const fiveToolsDuplicates = async (ownerId: string, records: FiveToolsPreview[]) => {
  const assets = await db
    .select({ id: assetsTable.id, name: assetsTable.name, identity: assetsTable.sourceIdentity })
    .from(assetsTable)
    .where(and(eq(assetsTable.ownerId, ownerId), eq(assetsTable.provider, '5etools')))
    .all();
  return records.map((record) => ({
    ...record,
    duplicates: assets.filter((asset) => asset.identity === record.identity).map(({ id, name }) => ({ id, name }))
  }));
};

const resolveStatBlock = async (record: FiveToolsPreview) =>
  record.statBlock !== undefined ? record.statBlock : fiveToolsCatalogStatBlock(record.identity);

const fingerprintItem = ({ record, policy, targetId }: FiveToolsImportItem, statBlock: StatBlock | null) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        identity: record.identity,
        name: record.name,
        source: record.source,
        artworkUrl: record.artworkUrl,
        tokenUrl: record.tokenUrl,
        statBlockHash: createHash('sha256').update(JSON.stringify(statBlock)).digest('hex'),
        policy,
        targetId: targetId ?? null
      })
    )
    .digest('hex');

export const importFiveToolsItems = async (
  ownerId: string,
  items: FiveToolsImportItem[]
): Promise<FiveToolsImportResult[]> => {
  const results: FiveToolsImportResult[] = [];
  // Sequential imports bound download/decode work and keep result order stable.
  for (const item of items) {
    const { record, requestId, policy, targetId } = item;
    try {
      if (record.identity !== fiveToolsIdentity(record))
        throw new Error('Import identity does not match the original name and source');
      const statBlock = await resolveStatBlock(record);
      const fingerprint = fingerprintItem(item, statBlock);
      const receiptCondition = and(
        eq(assetImportReceiptsTable.ownerId, ownerId),
        eq(assetImportReceiptsTable.requestId, requestId)
      );
      const previous = await db.select().from(assetImportReceiptsTable).where(receiptCondition).get();
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new Error('This import request was already used for different input; preview again');
        results.push(previous.result);
        continue;
      }
      const duplicates = await db
        .select()
        .from(assetsTable)
        .where(
          and(
            eq(assetsTable.ownerId, ownerId),
            eq(assetsTable.provider, '5etools'),
            eq(assetsTable.sourceIdentity, record.identity)
          )
        )
        .all();
      const target = targetId
        ? duplicates.find((asset) => asset.id === targetId)
        : duplicates.length === 1
          ? duplicates[0]
          : undefined;
      if (policy === 'update' && duplicates.length && !target) throw new Error('Select the duplicate asset to update');
      if (policy === 'update' && targetId && !target)
        throw new Error('The selected duplicate is no longer available; preview again');
      let artworkLocation: string | null = null;
      let tokenArtworkLocation: string | null = null;
      if (!(policy === 'skip' && duplicates.length)) {
        const store = async (url: string) => {
          const download = await downloadFiveToolsArtwork(url, process.env.FIVETOOLS_IMAGE_BASE_URL);
          return storeImportedArtwork(download.data, download.contentType, ownerId);
        };
        if (record.artworkUrl) artworkLocation = await store(record.artworkUrl);
        if (record.tokenUrl)
          tokenArtworkLocation = record.tokenUrl === record.artworkUrl ? artworkLocation : await store(record.tokenUrl);
      }
      const result = await db.transaction(async (tx) => {
        const racedReceipt = await tx.select().from(assetImportReceiptsTable).where(receiptCondition).get();
        if (racedReceipt) {
          if (racedReceipt.fingerprint !== fingerprint) throw new Error('Import request conflict');
          return racedReceipt.result;
        }
        const currentDuplicates = await tx
          .select()
          .from(assetsTable)
          .where(
            and(
              eq(assetsTable.ownerId, ownerId),
              eq(assetsTable.provider, '5etools'),
              eq(assetsTable.sourceIdentity, record.identity)
            )
          )
          .all();
        if (policy === 'update' && !target && currentDuplicates.length)
          throw new Error('A matching asset was created during import; preview again');
        let result: Omit<FiveToolsImportResult, 'status'> & { status: 'created' | 'updated' | 'skipped' };
        if (policy === 'skip' && currentDuplicates.length) {
          result = { identity: record.identity, requestId, status: 'skipped', assetId: currentDuplicates[0].id };
        } else {
          const provenance = {
            provider: '5etools',
            originalName: record.name,
            sourceIdentity: record.identity,
            sourceUrl: sourceUrl(record),
            adapterVersion: FIVETOOLS_ADAPTER_VERSION
          };
          const currentTarget = target ? currentDuplicates.find((asset) => asset.id === target.id) : undefined;
          if (target && policy === 'update' && !currentTarget)
            throw new Error('The selected asset was deleted during import');
          if (policy === 'update' && currentTarget) {
            const asset = await tx
              .update(assetsTable)
              .set({
                ...provenance,
                ...(artworkLocation ? { artworkLocation } : {}),
                ...(tokenArtworkLocation ? { tokenArtworkLocation } : {}),
                ...(statBlock ? { statBlock } : {}),
                updatedAt: new Date()
              })
              .where(and(eq(assetsTable.ownerId, ownerId), eq(assetsTable.id, currentTarget.id)))
              .returning()
              .get();
            if (!asset) throw new Error('The selected asset is no longer available');
            result = { identity: record.identity, requestId, status: 'updated', assetId: asset.id };
          } else {
            const asset = await tx
              .insert(assetsTable)
              .values({
                ...provenance,
                ownerId,
                name: record.name,
                artworkLocation,
                tokenArtworkLocation,
                statBlock,
                importRequestId: requestId
              })
              .returning()
              .get();
            result = { identity: record.identity, requestId, status: 'created', assetId: asset.id };
          }
          if (!artworkLocation && !tokenArtworkLocation)
            result.message =
              currentTarget && policy === 'update'
                ? 'No replacement artwork; existing artwork preserved'
                : 'Imported without artwork; use Edit to upload an image';
        }
        await tx.insert(assetImportReceiptsTable).values({ ownerId, requestId, fingerprint, result });
        return result;
      });
      results.push(result);
    } catch (error) {
      results.push({
        identity: record.identity,
        requestId,
        status: 'failed',
        message: error instanceof Error ? error.message : 'Import failed'
      });
    }
  }
  return results;
};
