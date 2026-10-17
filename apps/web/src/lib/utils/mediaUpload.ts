export const IMAGE_UPLOAD_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/tiff'
] as const;
export const VIDEO_UPLOAD_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'] as const;
export const MAX_IMAGE_PIXELS = 64 * 1024 * 1024;

export const mediaUploadLimit = (contentType: string) =>
  contentType === 'image/gif' || VIDEO_UPLOAD_TYPES.includes(contentType as (typeof VIDEO_UPLOAD_TYPES)[number])
    ? 100 * 1024 * 1024
    : 15 * 1024 * 1024;

export const validateMediaUpload = (file: { type: string; size: number }, imagesOnly = false) => {
  const supported = IMAGE_UPLOAD_TYPES.includes(file.type as (typeof IMAGE_UPLOAD_TYPES)[number]);
  if (!supported && (imagesOnly || !VIDEO_UPLOAD_TYPES.includes(file.type as (typeof VIDEO_UPLOAD_TYPES)[number]))) {
    throw new Error(imagesOnly ? 'Choose a supported image file' : 'Choose a supported image or video file');
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error('The file is empty or has an invalid size');
  const limit = mediaUploadLimit(file.type);
  if (file.size > limit) throw new Error(`File size exceeds the ${limit / (1024 * 1024)}MB limit`);
};
