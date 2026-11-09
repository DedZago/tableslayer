import { describe, expect, it } from 'vitest';
import { airTargetSize } from './airTargetSize';

const base = {
  mapWidth: 1920,
  mapHeight: 1080,
  screenScale: 1,
  pixelRatio: 1,
  bufferWidth: 1920,
  bufferHeight: 1080,
  resolutionScale: 1
};

describe('airTargetSize', () => {
  it('follows the map aspect', () => {
    const { width, height } = airTargetSize(base);
    expect(width / height).toBeCloseTo(1920 / 1080, 1);
  });

  it('never exceeds the drawing buffer by more than one size step', () => {
    const { height } = airTargetSize({ ...base, screenScale: 4 });
    expect(height).toBeLessThanOrEqual(1080 * 1.19);
  });

  it('halves with the tier scale', () => {
    const full = airTargetSize(base).height;
    const half = airTargetSize({ ...base, resolutionScale: 0.5 }).height;
    expect(half / full).toBeGreaterThan(0.4);
    expect(half / full).toBeLessThan(0.6);
  });

  it('keeps the same size across small zoom changes', () => {
    const a = airTargetSize({ ...base, screenScale: 0.61 });
    const b = airTargetSize({ ...base, screenScale: 0.62 });
    expect(a).toEqual(b);
  });

  it('has a floor', () => {
    expect(airTargetSize({ ...base, screenScale: 0.001 }).height).toBeGreaterThanOrEqual(32);
  });
});
