import { describe, expect, it } from 'vitest';
import { clampCrop, cropSourceRect, DEFAULT_TOKEN_CROP, MAX_CROP_ZOOM, panCrop, zoomCrop } from './tokenCrop';

const landscape = { width: 2000, height: 1000 };

describe('tokenCrop', () => {
  it('shows the largest centered square at the default crop', () => {
    expect(cropSourceRect(DEFAULT_TOKEN_CROP, landscape)).toEqual({ sx: 500, sy: 0, side: 1000 });
  });

  it('shrinks the window as the zoom grows', () => {
    expect(cropSourceRect({ x: 0.5, y: 0.5, zoom: 4 }, landscape)).toEqual({ sx: 875, sy: 375, side: 250 });
  });

  it('keeps the window inside the image', () => {
    const crop = clampCrop({ x: 0, y: 1, zoom: 2 }, landscape);
    expect(crop).toEqual({ x: 0.125, y: 0.75, zoom: 2 });
    const { sx, sy, side } = cropSourceRect({ x: 5, y: -5, zoom: 2 }, landscape);
    expect(sx).toBe(1500);
    expect(sy).toBe(0);
    expect(side).toBe(500);
  });

  it('clamps zoom to the allowed range', () => {
    expect(zoomCrop(DEFAULT_TOKEN_CROP, landscape, 100).zoom).toBe(MAX_CROP_ZOOM);
    expect(zoomCrop({ ...DEFAULT_TOKEN_CROP, zoom: 3 }, landscape, 0.2).zoom).toBe(1);
  });

  it('pans opposite to the drag, scaled to the viewport', () => {
    const zoomed = { x: 0.5, y: 0.5, zoom: 2 };
    const panned = panCrop(zoomed, landscape, 50, 0, 100);
    // 100px viewport shows 500 source px, so a 50px drag moves 250 source px of 2000
    expect(panned.x).toBeCloseTo(0.5 - 250 / 2000);
    expect(panned.y).toBe(0.5);
  });

  it('cannot pan past the image edge', () => {
    const panned = panCrop({ x: 0.5, y: 0.5, zoom: 2 }, landscape, -100000, 100000, 100);
    expect(panned).toEqual({ x: 0.875, y: 0.25, zoom: 2 });
  });
});
