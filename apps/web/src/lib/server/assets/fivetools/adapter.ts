import { z } from 'zod';
import type { FiveToolsPreview } from './types';

export const FIVETOOLS_ADAPTER_VERSION = 'bestiary-art-v1';
export const MAX_IMPORT_JSON_BYTES = 10 * 1024 * 1024;
const identitySchema = z.object({ name: z.string().trim().min(1).max(200), source: z.string().trim().min(1).max(100) });
const hrefSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('internal'), path: z.string().min(1).max(2048) }),
  z.object({ type: z.literal('external'), url: z.string().min(1).max(2048) })
]);
const recordSchema = identitySchema.extend({
  tokenUrl: z.string().min(1).max(2048).optional(),
  token: identitySchema.optional(),
  tokenHref: hrefSchema.optional(),
  hasToken: z.boolean().optional(),
  _copy: identitySchema
    .extend({
      _mod: z.record(z.string(), z.unknown()).optional(),
      _preserve: z.record(z.string(), z.unknown()).optional()
    })
    .optional(),
  _appendCopy: z.unknown().optional(),
  fluff: z
    .object({
      _monsterFluff: identitySchema.optional(),
      images: z
        .array(z.object({ href: hrefSchema }))
        .max(100)
        .nullable()
        .optional()
    })
    .optional(),
  images: z
    .array(z.object({ href: hrefSchema }))
    .max(100)
    .nullable()
    .optional()
});
const documentSchema = z.object({
  monster: z.array(recordSchema).max(10000).default([]),
  monsterFluff: z.array(recordSchema).max(10000).default([])
});
type RecordData = z.infer<typeof recordSchema>;

export const fiveToolsIdentity = ({ name, source }: { name: string; source: string }) =>
  JSON.stringify([source.toLowerCase(), name.toLowerCase()]);

export const fiveToolsTokenName = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/Æ/g, 'AE')
    .replace(/æ/g, 'ae')
    .replace(/"/g, '');

const imageUrl = (path: string, imageBase: string) => {
  if (path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => part === '..')) {
    throw new Error('Unsupported internal artwork path');
  }
  const base = new URL(imageBase.endsWith('/') ? imageBase : `${imageBase}/`);
  const result = new URL(path.split('/').map(encodeURIComponent).join('/'), base);
  if (!result.href.startsWith(base.href)) throw new Error('Artwork path escapes the image base');
  return result.href;
};
const hrefUrl = (href: z.infer<typeof hrefSchema>, imageBase: string) =>
  href.type === 'internal' ? imageUrl(href.path, imageBase) : href.url;

const resolveRecord = (
  record: RecordData,
  records: Map<string, RecordData>,
  visited: Set<string> = new Set()
): { record: RecordData; warnings: string[] } => {
  const identity = fiveToolsIdentity(record);
  if (visited.has(identity) || visited.size >= 32)
    return { record, warnings: ['Artwork reference cycle or depth limit; use manual artwork replacement'] };
  if (
    record._appendCopy ||
    Object.keys(record._copy?._mod ?? {}).some((key) =>
      ['tokenUrl', 'token', 'tokenHref', 'hasToken', 'images', 'fluff', '*'].includes(key)
    ) ||
    Object.keys(record._copy?._preserve ?? {}).some((key) =>
      ['images', 'fluff', 'token', 'tokenHref', 'tokenUrl', 'hasToken', '*'].includes(key)
    )
  ) {
    return { record, warnings: ['Unsupported artwork inheritance directives; use manual artwork replacement'] };
  }
  if (!record._copy) return { record, warnings: [] };
  const base = records.get(fiveToolsIdentity(record._copy));
  if (!base)
    return {
      record,
      warnings: [`Missing base ${record._copy.name} (${record._copy.source}); use manual artwork replacement`]
    };
  const resolved = resolveRecord(base, records, new Set([...visited, identity]));
  return { record: { ...resolved.record, ...record }, warnings: resolved.warnings };
};

export const parseFiveToolsDocument = (json: string) => {
  if (Buffer.byteLength(json, 'utf8') > MAX_IMPORT_JSON_BYTES) throw new Error('Bestiary JSON exceeds the 10MB limit');
  return documentSchema.parse(JSON.parse(json));
};

export const normalizeFiveToolsDocuments = (
  documents: ReturnType<typeof parseFiveToolsDocument>[],
  imageBase: string
): FiveToolsPreview[] => {
  const document = {
    monster: documents.flatMap((document) => document.monster),
    monsterFluff: documents.flatMap((document) => document.monsterFluff)
  };
  if (document.monster.length > 100000 || document.monsterFluff.length > 100000)
    throw new Error('Catalog exceeds the record limit');
  const monsters = new Map(document.monster.map((record) => [fiveToolsIdentity(record), record]));
  const fluff = new Map(document.monsterFluff.map((record) => [fiveToolsIdentity(record), record]));
  return [...monsters.values()].map((original) => {
    const resolved = resolveRecord(original, monsters);
    const record = resolved.record;
    const fluffReference = record.fluff?._monsterFluff;
    const fluffRecord = fluff.get(fiveToolsIdentity(fluffReference ?? original));
    if (fluffReference && !fluffRecord)
      resolved.warnings.push(
        `Missing fluff base ${fluffReference.name} (${fluffReference.source}); use manual artwork replacement`
      );
    const resolvedFluff = fluffRecord ? resolveRecord(fluffRecord, fluff) : null;
    const warnings = [...resolved.warnings, ...(resolvedFluff?.warnings ?? [])];
    let tokenUrl: string | null = null;
    let artworkUrl: string | null = null;
    try {
      if (record.tokenUrl) tokenUrl = record.tokenUrl;
      else if (record.token)
        tokenUrl = imageUrl(
          `bestiary/tokens/${record.token.source}/${fiveToolsTokenName(record.token.name)}.webp`,
          imageBase
        );
      else if (record.tokenHref) tokenUrl = hrefUrl(record.tokenHref, imageBase);
      else if (record.hasToken && !resolved.warnings.length)
        tokenUrl = imageUrl(`bestiary/tokens/${record.source}/${fiveToolsTokenName(record.name)}.webp`, imageBase);
      const image = record.fluff?.images?.[0] ?? resolvedFluff?.record.images?.[0];
      if (image) artworkUrl = hrefUrl(image.href, imageBase);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : 'Unsupported artwork reference');
    }
    if (!tokenUrl && !artworkUrl) warnings.push('No artwork found; import a named asset and replace artwork manually');
    return {
      identity: fiveToolsIdentity(original),
      name: original.name,
      source: original.source,
      tokenUrl,
      artworkUrl,
      warnings
    };
  });
};

export const previewFiveToolsJson = (json: string, imageBase: string): FiveToolsPreview[] => {
  const document = parseFiveToolsDocument(json);
  if (!document.monster.length) throw new Error('Choose bestiary JSON containing a monster array');
  return normalizeFiveToolsDocuments([document], imageBase);
};
