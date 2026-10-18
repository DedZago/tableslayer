import { z } from 'zod';
import { statBlockSchema } from './statBlock/schema';

export const TOKEN_CLIPBOARD_FORMAT = 'tableslayer.tokens';
export const TOKEN_CLIPBOARD_LIMIT = 1024 * 1024;
export const clipboardPointSchema = z
  .object({
    x: z.number().finite().min(-1e9).max(1e9),
    y: z.number().finite().min(-1e9).max(1e9)
  })
  .strict();

const validNote = (note: unknown) => {
  if (note === null) return true;
  if (!note || typeof note !== 'object' || Array.isArray(note) || typeof (note as { type?: unknown }).type !== 'string')
    return false;
  const pending = [{ value: note, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (++count > 10_000 || depth > 32) return false;
    if (value === null || typeof value === 'string' || typeof value === 'boolean') continue;
    if (typeof value === 'number' && Number.isFinite(value)) continue;
    if (typeof value !== 'object') return false;
    for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) return false;
      pending.push({ value: child, depth: depth + 1 });
    }
  }
  return true;
};

const conditionSchema = z
  .object({
    id: z.string().max(64),
    label: z.string().max(24).optional(),
    color: z
      .string()
      .regex(/^#[\da-f]{6}$/i)
      .optional(),
    value: z.number().int().min(1).max(6).optional(),
    dmOnly: z.boolean().optional()
  })
  .strict();

export const clipboardTokenSchema = z
  .object({
    title: z.string().max(1000),
    label: z.string().max(200).nullable(),
    imageLocation: z.string().min(1).max(1024).nullable(),
    imageScale: z.number().finite().min(0.1).max(10),
    shape: z.number().int().min(0).max(4),
    shapeColor: z.string().regex(/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i),
    size: z.number().int().min(1).max(3),
    visibility: z.number().int().min(0).max(3),
    note: z.unknown().refine(validNote, 'Invalid token note'),
    assetId: z.string().min(1).max(100).nullable(),
    offset: clipboardPointSchema,
    displayOffset: clipboardPointSchema,
    conditions: z.array(conditionSchema).max(32).optional(),
    statBlock: statBlockSchema.nullable().optional(),
    hitPoints: z.number().int().min(0).max(100_000).nullable().optional(),
    tempHitPoints: z.number().int().min(0).max(100_000).nullable().optional(),
    initiativeBonus: z.number().int().min(-20).max(30).nullable().optional()
  })
  .strict();

export const tokenClipboardSchema = z
  .object({
    format: z.literal(TOKEN_CLIPBOARD_FORMAT),
    version: z.literal(1),
    deploymentId: z.string().min(1).max(100),
    basis: z.enum(['grid', 'display']),
    anchor: clipboardPointSchema,
    tokens: z.array(clipboardTokenSchema).min(1).max(100),
    mediaGrant: z.string().min(1).max(150_000)
  })
  .strict();

export type TokenClipboard = z.infer<typeof tokenClipboardSchema>;
export type ClipboardPoint = z.infer<typeof clipboardPointSchema>;
export type ClipboardGrant = { deploymentId: string; mediaGrant: string };

export const serializeTokenClipboard = (clipboard: TokenClipboard) => {
  const text = JSON.stringify(tokenClipboardSchema.parse(clipboard));
  if (new TextEncoder().encode(text).byteLength > TOKEN_CLIPBOARD_LIMIT)
    throw new Error('Copied tokens exceed the clipboard size limit');
  return text;
};

export const parseTokenClipboard = (text: string): TokenClipboard => {
  if (new TextEncoder().encode(text).byteLength > TOKEN_CLIPBOARD_LIMIT)
    throw new Error('Token clipboard exceeds the size limit');
  return tokenClipboardSchema.parse(JSON.parse(text));
};
