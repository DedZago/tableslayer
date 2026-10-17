import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';

export const isLocalStorage = () => process.env.ASSET_STORAGE === 'local';

export const localAssetPath = (key: string) => {
  if (!key || key.includes('\\') || key.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Invalid asset path');
  }
  const root = path.resolve(process.env.LOCAL_ASSET_DIR || '/app/data/assets');
  const target = path.resolve(root, key);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error('Invalid asset path');
  return target;
};

export const localAssetUrl = (key: string) => {
  localAssetPath(key);
  const base = process.env.CLOUDFLARE_R2_BUCKET_URL || '/assets';
  return `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
};

const uploadSignature = (key: string, contentType: string, expires: string) => {
  const secret = process.env.INTERNAL_API_TOKEN;
  if (!secret) throw new Error('INTERNAL_API_TOKEN is required for local uploads');
  return createHmac('sha256', secret)
    .update(JSON.stringify([key, contentType, expires]))
    .digest('hex');
};

export const signedLocalUploadUrl = (key: string, contentType: string) => {
  const expires = String(Math.floor(Date.now() / 1000) + 3600);
  const query = new URLSearchParams({ expires, contentType, signature: uploadSignature(key, contentType, expires) });
  return `${localAssetUrl(key)}?${query}`;
};

export const verifyLocalUpload = (key: string, contentType: string, query: URLSearchParams) => {
  localAssetPath(key);
  const expires = query.get('expires') || '';
  const signature = query.get('signature') || '';
  if (!/^\d+$/.test(expires) || Number(expires) < Math.floor(Date.now() / 1000)) return false;
  if (query.get('contentType') !== contentType || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = uploadSignature(key, contentType, expires);
  return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
};

export const writeLocalAsset = async (key: string, data: Buffer | Readable) => {
  const target = localAssetPath(key);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  if (Buffer.isBuffer(data)) {
    await writeFile(temporary, data);
  } else {
    const chunks: Buffer[] = [];
    for await (const chunk of data) chunks.push(Buffer.from(chunk));
    await writeFile(temporary, Buffer.concat(chunks));
  }
  await rename(temporary, target);
};

export const copyLocalAsset = async (sourceKey: string, destinationKey: string) => {
  const target = localAssetPath(destinationKey);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await copyFile(localAssetPath(sourceKey), temporary);
  await rename(temporary, target);
  return destinationKey;
};

export const readLocalAsset = (key: string) => readFile(localAssetPath(key));
export const statLocalAsset = (key: string) => stat(localAssetPath(key));
