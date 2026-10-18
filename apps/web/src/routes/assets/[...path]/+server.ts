import {
  isLocalStorage,
  readLocalAsset,
  statLocalAsset,
  verifyLocalUpload,
  writeLocalAsset
} from '$lib/server/file/localStorage';
import { validateStoredMedia } from '$lib/server/file/validateImage';
import { mediaUploadLimit } from '$lib/utils/mediaUpload';
import { error, isHttpError, json, type RequestHandler } from '@sveltejs/kit';
import mime from 'mime';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

type RenderedAsset = { body: Uint8Array<ArrayBuffer>; type: string; etag: string };

const TRANSFORM_CACHE_LIMIT = 100;
const TRANSFORM_CACHE_MAX_BYTES = 5 * 1024 * 1024;
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const MUTABLE_CACHE_CONTROL = 'no-cache';
const WEBP_FORMATS = ['auto', 'webp'];
const transformCache = new Map<string, RenderedAsset>();

const securityHeaders = {
  'x-content-type-options': 'nosniff',
  'content-security-policy': "default-src 'none'; sandbox"
};

const etagFor = (body: Uint8Array) => `"${createHash('sha1').update(body).digest('hex')}"`;

const cacheControlFor = (key: string) =>
  key.startsWith('originals/') ? IMMUTABLE_CACHE_CONTROL : MUTABLE_CACHE_CONTROL;

const parseDimension = (value: string | null) => {
  if (value === null) return undefined;
  const size = Number(value);
  if (!Number.isInteger(size) || size < 1 || size > 4096) error(400, 'Invalid image dimensions');
  return size;
};

const renderTransform = async (data: Buffer, options: URLSearchParams): Promise<RenderedAsset> => {
  const pipeline = sharp(data)
    .rotate()
    .resize(parseDimension(options.get('w')), parseDimension(options.get('h')), {
      fit: options.get('fit') === 'cover' ? 'cover' : 'inside',
      withoutEnlargement: true
    });
  const webp = WEBP_FORMATS.includes(options.get('format') ?? '');
  const encoded = webp ? await pipeline.webp({ quality: 85 }).toBuffer() : await pipeline.png().toBuffer();
  const body = new Uint8Array(encoded);
  return { body, type: webp ? 'image/webp' : 'image/png', etag: etagFor(body) };
};

const recallTransform = (cacheKey: string) => {
  const cached = transformCache.get(cacheKey);
  if (cached) {
    transformCache.delete(cacheKey);
    transformCache.set(cacheKey, cached);
  }
  return cached;
};

const rememberTransform = (cacheKey: string, asset: RenderedAsset) => {
  transformCache.delete(cacheKey);
  transformCache.set(cacheKey, asset);
  const oldest = transformCache.keys().next().value;
  if (transformCache.size > TRANSFORM_CACHE_LIMIT && oldest !== undefined) transformCache.delete(oldest);
};

const evictTransforms = (key: string) => {
  for (const cacheKey of transformCache.keys()) {
    if (cacheKey.startsWith(`${key}|`)) transformCache.delete(cacheKey);
  }
};

const assetResponse = (request: Request, asset: RenderedAsset, cacheControl: string) => {
  const headers = {
    'content-type': asset.type,
    'cache-control': cacheControl,
    etag: asset.etag,
    ...securityHeaders
  };
  if (request.headers.get('if-none-match') === asset.etag) return new Response(null, { status: 304, headers });
  return new Response(asset.body, { headers });
};

// Cheap validator for untransformed files: hashing a 100MB video per request would cost more than the read
const fileVersion = async (key: string) => {
  const info = await statLocalAsset(key);
  return `${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}`;
};

const resizedResponse = async (request: Request, key: string, options: URLSearchParams) => {
  const version = await fileVersion(key);
  const cacheKey = `${key}|${version}|${options.get('w') ?? ''}|${options.get('h') ?? ''}|${options.get('fit') ?? ''}|${options.get('format') ?? ''}`;
  const cached = recallTransform(cacheKey);
  if (cached) return assetResponse(request, cached, cacheControlFor(key));
  const asset = await renderTransform(await readLocalAsset(key), options);
  if (asset.body.length < TRANSFORM_CACHE_MAX_BYTES) rememberTransform(cacheKey, asset);
  return assetResponse(request, asset, cacheControlFor(key));
};

export const GET: RequestHandler = async ({ params, request }) => {
  if (!isLocalStorage()) error(404, 'Local assets are disabled');
  let key = params.path || '';
  let options: URLSearchParams | null = null;
  if (key.startsWith('cdn-cgi/image/')) {
    const parts = key.slice('cdn-cgi/image/'.length).split('/');
    options = new URLSearchParams((parts.shift() || '').replaceAll(',', '&'));
    key = parts.join('/');
  }
  try {
    if (options?.get('format') === 'json') {
      const data = await readLocalAsset(key);
      const metadata = await sharp(data).metadata();
      return json(
        {
          width: metadata.width,
          height: metadata.height,
          original: { width: metadata.width, height: metadata.height, file_size: data.length, format: metadata.format }
        },
        { headers: securityHeaders }
      );
    }
    if (options && (options.has('w') || options.has('h'))) return await resizedResponse(request, key, options);
    const etag = `W/"${await fileVersion(key)}"`;
    const type = mime.getType(key) || 'application/octet-stream';
    if (request.headers.get('if-none-match') === etag) {
      return assetResponse(request, { body: new Uint8Array(), type, etag }, cacheControlFor(key));
    }
    const body = new Uint8Array(await readLocalAsset(key));
    return assetResponse(request, { body, type, etag }, cacheControlFor(key));
  } catch (cause) {
    if (isHttpError(cause)) throw cause;
    error(404, 'Asset not found');
  }
};

export const PUT: RequestHandler = async ({ params, request, url }) => {
  if (!isLocalStorage()) error(404, 'Local assets are disabled');
  const key = params.path || '';
  const contentType = request.headers.get('content-type') || '';
  try {
    if (!verifyLocalUpload(key, contentType, url.searchParams)) error(403, 'Invalid or expired upload URL');
  } catch {
    error(403, 'Invalid or expired upload URL');
  }
  const limit = mediaUploadLimit(contentType);
  const reader = request.body?.getReader();
  if (!reader) error(400, 'Upload body is required');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      error(413, 'Upload exceeds the size limit');
    }
    chunks.push(value);
  }
  const data = Buffer.concat(chunks);
  try {
    await validateStoredMedia(data, contentType);
  } catch (cause) {
    error(400, cause instanceof Error ? cause.message : 'Invalid media');
  }
  await writeLocalAsset(key, data);
  evictTransforms(key);
  return new Response(null, { status: 204 });
};

export const HEAD: RequestHandler = async ({ params }) => {
  if (!isLocalStorage()) error(404, 'Local assets are disabled');
  try {
    const info = await statLocalAsset(params.path || '');
    return new Response(null, { headers: { 'content-length': String(info.size) } });
  } catch {
    error(404, 'Asset not found');
  }
};
