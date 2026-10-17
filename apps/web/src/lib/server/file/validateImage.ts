import { MAX_IMAGE_PIXELS, validateMediaUpload } from '$lib/utils/mediaUpload';
import sharp from 'sharp';

const imageFormats: Record<string, string[]> = {
  'image/jpeg': ['jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/avif': ['heif'],
  'image/gif': ['gif'],
  'image/tiff': ['tiff']
};

export const validateStoredMedia = async (data: Buffer, contentType: string) => {
  validateMediaUpload({ type: contentType, size: data.length });
  if (!contentType.startsWith('image/')) return;
  try {
    const image = sharp(data, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'warning', animated: true });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || !imageFormats[contentType]?.includes(metadata.format || '')) {
      throw new Error('Image contents do not match the declared file type');
    }
    if (metadata.width * (metadata.pageHeight ?? metadata.height) * (metadata.pages || 1) > MAX_IMAGE_PIXELS) {
      throw new Error('Image exceeds the pixel limit');
    }
    await image.stats();
  } catch {
    throw new Error('The image cannot be decoded or exceeds the pixel limit');
  }
};
