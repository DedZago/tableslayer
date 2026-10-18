import { describe, expect, it } from 'vitest';
import { formatFeet, getGridSteps } from './moveDistance';

describe('getGridSteps', () => {
  it('counts diagonals as one step', () => {
    expect(getGridSteps({ x: 0, y: 0 }, { x: 100, y: 100 }, 50)).toBe(2);
  });

  it('uses the longer axis', () => {
    expect(getGridSteps({ x: 0, y: 0 }, { x: 150, y: 50 }, 50)).toBe(3);
  });

  it('rounds partial cells and ignores a zero cell size', () => {
    expect(getGridSteps({ x: 0, y: 0 }, { x: 74, y: 0 }, 50)).toBe(1);
    expect(getGridSteps({ x: 0, y: 0 }, { x: 74, y: 0 }, 0)).toBe(0);
  });
});

describe('formatFeet', () => {
  it('appends the unit and trims float noise', () => {
    expect(formatFeet(15)).toBe('15 ft');
    expect(formatFeet(7.5000001)).toBe('7.5 ft');
  });
});
