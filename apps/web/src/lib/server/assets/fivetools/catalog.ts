import { readCatalogCache, writeCatalogCache } from '$lib/server/file/files';
import { crToNumber } from '$lib/utils/statBlock/format';
import type { StatBlock } from '$lib/utils/statBlock/types';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  buildFiveToolsStatBlock,
  fiveToolsIdentity,
  normalizeFiveToolsDocuments,
  parseFiveToolsDocument,
  statBlockKey
} from './adapter';
import { downloadFiveToolsResource } from './download';
import { fiveToolsDuplicates, fiveToolsImageBase } from './import';
import type { FiveToolsCatalogResult, FiveToolsCatalogStatus, FiveToolsPreview } from './types';

type FiveToolsDocument = ReturnType<typeof parseFiveToolsDocument>;

export const DEFAULT_FIVETOOLS_CATALOG_BASE =
  'https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/data/bestiary/';
const maxParsedFiles = 8;
const maxCopyChain = 32;
const parsedFiles = new Map<string, FiveToolsDocument>();
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
  base: string;
  fileByIdentity: Map<string, string>;
  status: FiveToolsCatalogStatus;
  records: FiveToolsPreview[];
  loading?: Promise<void>;
};
let catalog: Catalog | undefined;

const loadParsedFile = async (url: string) => {
  const cached = parsedFiles.get(url);
  if (cached) {
    parsedFiles.delete(url);
    parsedFiles.set(url, cached);
    return cached;
  }
  const document = parseFiveToolsDocument(await cachedFiveToolsJson(url));
  parsedFiles.set(url, document);
  if (parsedFiles.size > maxParsedFiles) parsedFiles.delete(parsedFiles.keys().next().value!);
  return document;
};

const copyBaseIdentity = (document: FiveToolsDocument, identity: string) => {
  const copy = document.monster.find((record) => fiveToolsIdentity(record) === identity)?._copy;
  return copy ? fiveToolsIdentity(copy) : undefined;
};

const loadStatBlockChain = async (current: Catalog, identity: string) => {
  const documents: FiveToolsDocument[] = [];
  const visited = new Set<string>();
  let pending: string | undefined = identity;
  while (pending && !visited.has(pending) && visited.size < maxCopyChain) {
    const key: string = pending;
    const filename = current.fileByIdentity.get(key);
    if (!filename) break;
    visited.add(key);
    const document = await loadParsedFile(new URL(filename, current.base).href);
    documents.push(document);
    pending = copyBaseIdentity(document, key);
  }
  return documents;
};

export const fiveToolsCatalogStatBlock = async (identity: string): Promise<StatBlock | null> => {
  const current = getCatalog();
  // fileByIdentity is only filled once the catalog finishes loading
  await current.loading;
  const documents = await loadStatBlockChain(current, identity);
  const target = documents[0]?.monster.find((record) => fiveToolsIdentity(record) === identity);
  if (!target) return null;
  const index = new Map(
    documents.flatMap((document) => document.monster).map((record) => [statBlockKey(record), record])
  );
  return buildFiveToolsStatBlock(target, index).statBlock;
};

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
    current.fileByIdentity.clear();
    for (const file of files)
      for (const record of documents.get(file)?.monster ?? [])
        current.fileByIdentity.set(fiveToolsIdentity(record), file);
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
    if (refresh) parsedFiles.clear();
    catalog = {
      key,
      base,
      fileByIdentity: new Map(),
      records: [],
      status: { state: 'loading', completed: 0, total: 0, recordCount: 0, warnings: [] }
    };
    const current = catalog;
    current.loading = loadCatalog(current, base, refresh).finally(() => {
      current.loading = undefined;
    });
  }
  return catalog;
};

const crInRange = (cr: string | undefined, crRange: string) => {
  if (!crRange) return true;
  const [min, max] = crRange.split('-').map(Number);
  const value = cr === undefined ? null : crToNumber(cr);
  return value !== null && value >= min && value <= max;
};

const sourceCounts = (records: FiveToolsPreview[]) => {
  const counts = new Map<string, number>();
  for (const record of records) counts.set(record.source, (counts.get(record.source) ?? 0) + 1);
  return [...counts].map(([source, count]) => ({ source, count })).sort((a, b) => a.source.localeCompare(b.source));
};

export const searchFiveToolsCatalog = async (
  ownerId: string,
  search: string,
  source: string,
  offset: number,
  filters: { crRange: string; creatureType: string } = { crRange: '', creatureType: '' }
): Promise<FiveToolsCatalogResult> => {
  const current = getCatalog();
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const creatureType = filters.creatureType.toLowerCase();
  const matches = current.records.filter(
    (record) =>
      (!source || record.source === source) &&
      (!creatureType || record.creatureType?.toLowerCase() === creatureType) &&
      crInRange(record.cr, filters.crRange) &&
      terms.every((term) => `${record.name} ${record.source}`.toLowerCase().includes(term))
  );
  return {
    status: { ...current.status, warnings: [...current.status.warnings] },
    records: await fiveToolsDuplicates(ownerId, matches.slice(offset, offset + 100)),
    totalMatches: matches.length,
    sources: sourceCounts(current.records)
  };
};

export const refreshFiveToolsCatalog = () => ({ status: getCatalog(true).status });
