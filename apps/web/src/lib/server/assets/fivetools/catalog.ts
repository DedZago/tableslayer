import { readCatalogCache, writeCatalogCache } from '$lib/server/file/files';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { normalizeFiveToolsDocuments, parseFiveToolsDocument } from './adapter';
import { downloadFiveToolsResource } from './download';
import { fiveToolsDuplicates, fiveToolsImageBase } from './import';
import type { FiveToolsCatalogResult, FiveToolsCatalogStatus, FiveToolsPreview } from './types';

export const DEFAULT_FIVETOOLS_CATALOG_BASE =
  'https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/data/bestiary/';
const indexSchema = z
  .record(z.string().max(100), z.string().regex(/^(?:fluff-)?bestiary-[a-z0-9-]+\.json$/))
  .refine((index) => Object.keys(index).length <= 500, 'Catalog source index exceeds the limit');
const receiptSchema = z.object({
  sourceUrl: z.string(),
  pulledAt: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/)
});
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

export const cachedFiveToolsJson = async (url: string, refresh = false) => {
  const prefix = `catalog/5etools/${digest(url)}`;
  if (!refresh) {
    const latest = await readCatalogCache(`${prefix}/latest.json`);
    if (latest) {
      const receipt = receiptSchema.parse(JSON.parse(latest.toString('utf8')));
      const cached = await readCatalogCache(`${prefix}/${receipt.sha256}.json`);
      if (receipt.sourceUrl === url && cached && digest(cached) === receipt.sha256) return cached.toString('utf8');
    }
  }
  const resource = await downloadFiveToolsResource(url, process.env.FIVETOOLS_CATALOG_BASE_URL, true);
  const sha256 = digest(resource.data);
  await writeCatalogCache(`${prefix}/${sha256}.json`, resource.data);
  const receipt = Buffer.from(
    JSON.stringify({ sourceUrl: url, resolvedUrl: resource.sourceUrl, pulledAt: new Date().toISOString(), sha256 })
  );
  // Retain provenance revisions alongside immutable downloaded JSON.
  await writeCatalogCache(`${prefix}/${digest(receipt)}.json`, receipt);
  await writeCatalogCache(`${prefix}/latest.json`, receipt);
  return resource.data.toString('utf8');
};

type Catalog = {
  key: string;
  status: FiveToolsCatalogStatus;
  records: FiveToolsPreview[];
  loading?: Promise<void>;
};
let catalog: Catalog | undefined;

const loadCatalog = async (current: Catalog, base: string, refresh: boolean) => {
  try {
    const index = indexSchema.parse(JSON.parse(await cachedFiveToolsJson(new URL('index.json', base).href, refresh)));
    let fluffIndex: Record<string, string> = {};
    try {
      fluffIndex = indexSchema.parse(
        JSON.parse(await cachedFiveToolsJson(new URL('fluff-index.json', base).href, refresh))
      );
    } catch (error) {
      current.status.warnings.push(
        `Portrait index unavailable: ${error instanceof Error ? error.message : 'Download failed'}`
      );
    }
    const files = [...new Set([...Object.values(index), ...Object.values(fluffIndex)])].sort();
    current.status.total = files.length;
    let next = 0;
    let totalBytes = 0;
    const documents = new Map<string, ReturnType<typeof parseFiveToolsDocument>>();
    await Promise.all(
      Array.from({ length: Math.min(4, files.length) }, async () => {
        while (next < files.length) {
          const filename = files[next++];
          try {
            const json = await cachedFiveToolsJson(new URL(filename, base).href, refresh);
            totalBytes += Buffer.byteLength(json);
            if (totalBytes > 256 * 1024 * 1024) {
              current.status.completed += files.length - next;
              next = files.length;
              throw new Error('Catalog exceeds the 256MB limit');
            }
            documents.set(filename, parseFiveToolsDocument(json));
          } catch (error) {
            current.status.warnings.push(`${filename}: ${error instanceof Error ? error.message : 'Load failed'}`);
          } finally {
            current.status.completed++;
          }
        }
      })
    );
    current.records = normalizeFiveToolsDocuments(
      files.flatMap((file) => (documents.has(file) ? [documents.get(file)!] : [])),
      fiveToolsImageBase()
    ).sort((a, b) => a.name.localeCompare(b.name) || a.source.localeCompare(b.source));
    if (!current.records.length) throw new Error('No supported bestiary records were loaded');
    current.status.recordCount = current.records.length;
    current.status.state = 'ready';
  } catch (error) {
    current.status.state = 'error';
    current.status.error = error instanceof Error ? error.message : 'Catalog loading failed';
  }
};

const getCatalog = (refresh = false) => {
  const configured = process.env.FIVETOOLS_CATALOG_BASE_URL || DEFAULT_FIVETOOLS_CATALOG_BASE;
  const base = configured.endsWith('/') ? configured : `${configured}/`;
  const key = JSON.stringify([base, fiveToolsImageBase()]);
  if (!catalog || catalog.key !== key || (refresh && !catalog.loading)) {
    catalog = { key, records: [], status: { state: 'loading', completed: 0, total: 0, recordCount: 0, warnings: [] } };
    const current = catalog;
    current.loading = loadCatalog(current, base, refresh).finally(() => {
      current.loading = undefined;
    });
  }
  return catalog;
};

export const searchFiveToolsCatalog = async (
  ownerId: string,
  search: string,
  source: string,
  offset: number
): Promise<FiveToolsCatalogResult> => {
  const current = getCatalog();
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = current.records.filter(
    (record) =>
      (!source || record.source === source) &&
      terms.every((term) => `${record.name} ${record.source}`.toLowerCase().includes(term))
  );
  return {
    status: { ...current.status, warnings: [...current.status.warnings] },
    records: await fiveToolsDuplicates(ownerId, matches.slice(offset, offset + 100)),
    totalMatches: matches.length,
    sources: [...new Set(current.records.map((record) => record.source))].sort()
  };
};

export const refreshFiveToolsCatalog = () => ({ status: getCatalog(true).status });
