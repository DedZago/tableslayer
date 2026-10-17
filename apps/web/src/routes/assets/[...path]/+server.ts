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
import sharp from 'sharp';

export const GET: RequestHandler = async ({ params }) => {
  if (!isLocalStorage()) error(404, 'Local assets are disabled');
  let key = params.path || '';
  let options: URLSearchParams | null = null;
  if (key.startsWith('cdn-cgi/image/')) {
    const parts = key.slice('cdn-cgi/image/'.length).split('/');
    options = new URLSearchParams((parts.shift() || '').replaceAll(',', '&'));
    key = parts.join('/');
  }
  try {
    const data = await readLocalAsset(key);
    if (options?.get('format') === 'json') {
      const metadata = await sharp(data).metadata();
      return json({
        width: metadata.width,
        height: metadata.height,
        original: { width: metadata.width, height: metadata.height, file_size: data.length, format: metadata.format }
      });
    }
    const headers = {
      'content-type': mime.getType(key) || 'application/octet-stream',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox"
    };
    if (options && (options.has('w') || options.has('h'))) {
      const dimension = (value: string | null) => {
        if (value === null) return undefined;
        const size = Number(value);
        if (!Number.isInteger(size) || size < 1 || size > 4096) error(400, 'Invalid image dimensions');
        return size;
      };
      const resized = await sharp(data)
        .rotate()
        .resize(dimension(options.get('w')), dimension(options.get('h')), {
          fit: options.get('fit') === 'cover' ? 'cover' : 'inside',
          withoutEnlargement: true
        })
        .png()
        .toBuffer();
      return new Response(new Uint8Array(resized), { headers: { ...headers, 'content-type': 'image/png' } });
    }
    return new Response(new Uint8Array(data), { headers });
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
