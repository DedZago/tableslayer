export type TokenCrop = { x: number; y: number; zoom: number };
export type ImageSize = { width: number; height: number };

export const DEFAULT_TOKEN_CROP: TokenCrop = { x: 0.5, y: 0.5, zoom: 1 };
export const MIN_CROP_ZOOM = 1;
export const MAX_CROP_ZOOM = 8;
export const TOKEN_IMAGE_SIZE = 512;
const TOKEN_IMAGE_QUALITY = 0.85;

// Side of the square window, in source pixels, that the token circle shows
const windowSide = (crop: TokenCrop, image: ImageSize) => Math.min(image.width, image.height) / crop.zoom;

// Keeps the zoom in range and the window inside the image
export const clampCrop = (crop: TokenCrop, image: ImageSize): TokenCrop => {
  const zoom = Math.min(MAX_CROP_ZOOM, Math.max(MIN_CROP_ZOOM, crop.zoom));
  const side = windowSide({ ...crop, zoom }, image);
  const halfX = side / 2 / image.width;
  const halfY = side / 2 / image.height;
  return {
    zoom,
    x: Math.min(1 - halfX, Math.max(halfX, crop.x)),
    y: Math.min(1 - halfY, Math.max(halfY, crop.y))
  };
};

export const cropSourceRect = (crop: TokenCrop, image: ImageSize) => {
  const clamped = clampCrop(crop, image);
  const side = windowSide(clamped, image);
  return { sx: clamped.x * image.width - side / 2, sy: clamped.y * image.height - side / 2, side };
};

// Moves the window as if the image were dragged by `dx`/`dy` pixels inside a `viewport`-pixel square
export const panCrop = (crop: TokenCrop, image: ImageSize, dx: number, dy: number, viewport: number): TokenCrop => {
  const scale = windowSide(crop, image) / viewport;
  return clampCrop({ ...crop, x: crop.x - (dx * scale) / image.width, y: crop.y - (dy * scale) / image.height }, image);
};

export const zoomCrop = (crop: TokenCrop, image: ImageSize, zoom: number): TokenCrop =>
  clampCrop({ ...crop, zoom }, image);

export const isDefaultCrop = (crop: TokenCrop) =>
  crop.x === DEFAULT_TOKEN_CROP.x && crop.y === DEFAULT_TOKEN_CROP.y && crop.zoom === DEFAULT_TOKEN_CROP.zoom;

// Renders the framed area as a compressed square so tokens never ship the full-size artwork
export const renderTokenImage = (
  source: CanvasImageSource & ImageSize,
  crop: TokenCrop,
  size = TOKEN_IMAGE_SIZE
): Promise<Blob> => {
  const { sx, sy, side } = cropSourceRect(crop, source);
  const output = Math.min(size, Math.round(side));
  const canvas = document.createElement('canvas');
  canvas.width = output;
  canvas.height = output;
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new Error('Image processing is not available'));
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, sx, sy, side, side, 0, 0, output, output);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not process the image'))),
      'image/webp',
      TOKEN_IMAGE_QUALITY
    )
  );
};
