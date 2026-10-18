import { describe, expect, it } from 'vitest';
import { placementPositions } from './assetPlacement';

describe('placementPositions', () => {
  it('places a single copy exactly at the point', () => {
    expect(placementPositions(1, { x: 10, y: 20 }, 50)).toEqual([{ x: 10, y: 20 }]);
  });

  it('centres a block of copies on the point', () => {
    const positions = placementPositions(4, { x: 0, y: 0 }, 50);
    expect(positions).toEqual([
      { x: -25, y: 25 },
      { x: 25, y: 25 },
      { x: -25, y: -25 },
      { x: 25, y: -25 }
    ]);
  });

  it('centres a partial last row on the block, not on the copies', () => {
    const positions = placementPositions(3, { x: 0, y: 0 }, 10);
    expect(positions).toEqual([
      { x: -5, y: 5 },
      { x: 5, y: 5 },
      { x: -5, y: -5 }
    ]);
  });

  it('snaps the block origin and keeps whole-cell offsets', () => {
    const snap = ({ x, y }: { x: number; y: number }) => ({ x: Math.round(x / 50) * 50, y: Math.round(y / 50) * 50 });
    const positions = placementPositions(2, { x: 12, y: 42 }, 50, snap);
    expect(positions).toEqual([
      { x: 0, y: 50 },
      { x: 50, y: 50 }
    ]);
  });
});
