import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  copyLocalAsset,
  localAssetPath,
  signedLocalUploadUrl,
  verifyLocalUpload,
  writeLocalAsset
} from './localStorage';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'tableslayer-assets-'));
  vi.stubEnv('LOCAL_ASSET_DIR', root);
  vi.stubEnv('CLOUDFLARE_R2_BUCKET_URL', '/assets');
  vi.stubEnv('INTERNAL_API_TOKEN', 'test-secret-not-for-deployment');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe('local campaign assets', () => {
  it.each(['../app.db', 'map/../../secret', '/etc/passwd', 'map//image.png', 'map/./image.png', 'map\\image.png', ''])(
    'rejects unsafe object key %s',
    (key) => {
      expect(() => localAssetPath(key)).toThrow('Invalid asset path');
    }
  );

  it('binds upload authorization to the object, content type, expiry, and deployment secret', () => {
    const url = new URL(signedLocalUploadUrl('map/image.png', 'image/png'), 'http://localhost');
    expect(verifyLocalUpload('map/image.png', 'image/png', url.searchParams)).toBe(true);
    expect(verifyLocalUpload('map/other.png', 'image/png', url.searchParams)).toBe(false);
    expect(verifyLocalUpload('map/image.png', 'image/jpeg', url.searchParams)).toBe(false);
    const expired = new URLSearchParams(url.searchParams);
    expired.set('expires', '1');
    expect(verifyLocalUpload('map/image.png', 'image/png', expired)).toBe(false);
    const altered = new URLSearchParams(url.searchParams);
    altered.set('expires', String(Number(altered.get('expires')) + 100));
    expect(verifyLocalUpload('map/image.png', 'image/png', altered)).toBe(false);
    vi.stubEnv('INTERNAL_API_TOKEN', 'different-secret');
    expect(verifyLocalUpload('map/image.png', 'image/png', url.searchParams)).toBe(false);
  });

  it('writes, replaces, and copies persistent files without changing object keys', async () => {
    await writeLocalAsset('map/source.png', Buffer.from('original'));
    await copyLocalAsset('map/source.png', 'thumbnail/copied.png');
    await writeLocalAsset('map/source.png', Buffer.from('replacement'));
    expect(await readFile(path.join(root, 'map/source.png'), 'utf8')).toBe('replacement');
    expect(await readFile(path.join(root, 'thumbnail/copied.png'), 'utf8')).toBe('original');
  });
});
