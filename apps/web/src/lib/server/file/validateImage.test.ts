import { mediaUploadLimit, validateMediaUpload } from '$lib/utils/mediaUpload';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { validateStoredMedia } from './validateImage';

describe('media validation', () => {
  it('shares the existing image and animated-media size limits', () => {
    expect(mediaUploadLimit('image/png')).toBe(15 * 1024 * 1024);
    expect(mediaUploadLimit('image/gif')).toBe(100 * 1024 * 1024);
    expect(() => validateMediaUpload({ type: 'image/png', size: 15 * 1024 * 1024 + 1 })).toThrow('15MB');
    expect(() => validateMediaUpload({ type: 'image/svg+xml', size: 20 })).toThrow('supported');
    expect(() => validateMediaUpload({ type: 'video/mp4', size: 20 }, true)).toThrow('image file');
    expect(() => validateMediaUpload({ type: 'image/png', size: 0 })).toThrow('empty');
  });

  it('decodes images rather than trusting a MIME declaration or header', async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'red' } })
      .png()
      .toBuffer();
    await expect(validateStoredMedia(png, 'image/png')).resolves.toBeUndefined();
    await expect(validateStoredMedia(png, 'image/jpeg')).rejects.toThrow('cannot be decoded');
    await expect(validateStoredMedia(Buffer.from('not an image'), 'image/png')).rejects.toThrow('cannot be decoded');
    await expect(validateStoredMedia(png.subarray(0, 40), 'image/png')).rejects.toThrow('cannot be decoded');
  });
});
