import * as THREE from 'three';
import { MarkerShape } from '../components/MarkerLayer/types';

export const TOKEN_CANVAS_SIZE = 512;

const RING_INNER_RADIUS = 0.46;
const RING_OUTER_RADIUS = 0.5;
const FALLBACK_COLOR = '#ffffff';

const cssColors = new Map<string, string>();
let themeObserver: MutationObserver | null = null;

export const clearCssColorCache = () => cssColors.clear();

const observeThemeChanges = () => {
  if (themeObserver || typeof document === 'undefined') return;
  themeObserver = new MutationObserver(() => {
    clearCssColorCache();
    syncRingColors();
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
};

let colorProbe: OffscreenCanvasRenderingContext2D | null | undefined;

// THREE.Color only parses hex/rgb/hsl/named colours, while the theme tokens are oklch().
// The canvas accepts any CSS colour, so paint one pixel and read it back as sRGB.
const toRgbColor = (value: string): string => {
  if (colorProbe === undefined) {
    colorProbe =
      typeof OffscreenCanvas === 'undefined'
        ? null
        : new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true });
  }
  if (!colorProbe) return value;
  colorProbe.clearRect(0, 0, 1, 1);
  colorProbe.fillStyle = FALLBACK_COLOR;
  colorProbe.fillStyle = value;
  colorProbe.fillRect(0, 0, 1, 1);
  const [r, g, b] = colorProbe.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
};

export const getCssColor = (name: string): string => {
  const cached = cssColors.get(name);
  if (cached !== undefined) return cached;
  if (typeof document === 'undefined') return FALLBACK_COLOR;
  observeThemeChanges();
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!value) return FALLBACK_COLOR;
  const color = toRgbColor(value);
  cssColors.set(name, color);
  return color;
};

export const createCanvasTexture = (canvas: OffscreenCanvas) => {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return texture;
};

export const tokenQuadGeometry = new THREE.PlaneGeometry(1, 1);

const createFrameGeometry = (points: Array<[number, number]>) => {
  const toPath = (radius: number) => points.map(([x, y]) => new THREE.Vector2(x * radius, y * radius));
  const shape = new THREE.Shape(toPath(RING_OUTER_RADIUS));
  shape.holes.push(new THREE.Path(toPath(RING_INNER_RADIUS)));
  return new THREE.ShapeGeometry(shape);
};

const createHighlightGeometry = (shape: MarkerShape) => {
  switch (shape) {
    case MarkerShape.Square:
      return createFrameGeometry([
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1]
      ]);
    case MarkerShape.Triangle:
      // Apex up, matching the canvas triangle (the quad's texture is flipY'd, so canvas top is +y)
      return createFrameGeometry([
        [0, 1],
        [-1, -1],
        [1, -1]
      ]);
    default:
      return new THREE.RingGeometry(RING_INNER_RADIUS, RING_OUTER_RADIUS, 64);
  }
};

const highlightGeometries = new Map<MarkerShape, THREE.BufferGeometry>();

export const getHighlightGeometry = (shape: MarkerShape): THREE.BufferGeometry => {
  let geometry = highlightGeometries.get(shape);
  if (!geometry) {
    geometry = createHighlightGeometry(shape);
    highlightGeometries.set(shape, geometry);
  }
  return geometry;
};

const createRingMaterial = (color: string, opacity = 1) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false });

export const selectedRingMaterial = createRingMaterial(getCssColor('--fgPrimary'));
export const hoverRingMaterial = createRingMaterial(getCssColor('--fgPrimary'), 0.6);
export const activeTurnRingMaterial = createRingMaterial(getCssColor('--yellow-500'));

export const syncRingColors = () => {
  selectedRingMaterial.color.set(getCssColor('--fgPrimary'));
  hoverRingMaterial.color.set(getCssColor('--fgPrimary'));
  activeTurnRingMaterial.color.set(getCssColor('--yellow-500'));
};

const IMAGE_CACHE_LIMIT = 128;
const imageCache = new Map<string, Promise<ImageBitmap>>();

export const loadTokenImage = (url: string): Promise<ImageBitmap> => {
  const cached = imageCache.get(url);
  if (cached) {
    imageCache.delete(url);
    imageCache.set(url, cached);
    return cached;
  }
  const request = fetch(url, { mode: 'cors' })
    .then((response) => response.blob())
    .then((blob) => createImageBitmap(blob))
    .catch((error: unknown) => {
      imageCache.delete(url);
      throw error;
    });
  imageCache.set(url, request);
  while (imageCache.size > IMAGE_CACHE_LIMIT) {
    imageCache.delete(imageCache.keys().next().value!);
  }
  return request;
};

let skullMaterial: THREE.MeshBasicMaterial | null = null;

export const getSkullMaterial = (): THREE.MeshBasicMaterial => {
  if (skullMaterial) return skullMaterial;
  const canvas = new OffscreenCanvas(TOKEN_CANVAS_SIZE, TOKEN_CANVAS_SIZE);
  const ctx = canvas.getContext('2d')!;
  const center = TOKEN_CANVAS_SIZE / 2;
  ctx.font = `${TOKEN_CANVAS_SIZE * 0.7}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = TOKEN_CANVAS_SIZE * 0.03;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.strokeText('☠', center, center);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('☠', center, center);
  skullMaterial = new THREE.MeshBasicMaterial({
    map: createCanvasTexture(canvas),
    transparent: true,
    depthTest: false
  });
  return skullMaterial;
};
