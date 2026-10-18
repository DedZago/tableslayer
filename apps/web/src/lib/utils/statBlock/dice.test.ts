import { describe, expect, it } from 'vitest';
import { parseDiceFormula, rollFormula } from './dice';

const sequenceRng = (values: number[]) => {
  let index = 0;
  return () => values[index++ % values.length];
};

describe('parseDiceFormula', () => {
  it('reads dice terms and a modifier', () => {
    expect(parseDiceFormula('2d6+8')).toEqual({ terms: [{ count: 2, sides: 6 }], modifier: 8 });
  });

  it('accepts spaces, the unicode minus sign and d20 without a count', () => {
    expect(parseDiceFormula('d20 − 1')).toEqual({ terms: [{ count: 1, sides: 20 }], modifier: -1 });
  });

  it('keeps multiple dice terms', () => {
    expect(parseDiceFormula('1d8 + 2d4 + 3')).toEqual({
      terms: [
        { count: 1, sides: 8 },
        { count: 2, sides: 4 }
      ],
      modifier: 3
    });
  });
});

describe('rollFormula', () => {
  it('rolls every die with the seeded generator and adds the modifier', () => {
    const roll = rollFormula('2d6+8', sequenceRng([0.99, 0.5]));
    expect(roll).toEqual({ total: 18, rolls: [6, 4], modifier: 8, text: '2d6+8 → [6, 4] + 8 = 18' });
  });

  it('matches the documented text example', () => {
    const roll = rollFormula('2d6+8', sequenceRng([0.5, 0.99]));
    expect(roll.text).toBe('2d6+8 → [4, 6] + 8 = 18');
    expect(roll.total).toBe(18);
  });

  it('rolls a d20 with a bonus', () => {
    const roll = rollFormula('d20 +5', sequenceRng([0]));
    expect(roll.total).toBe(6);
    expect(roll.text).toBe('d20 +5 → [1] + 5 = 6');
  });

  it('formats a negative modifier with the unicode minus sign', () => {
    const roll = rollFormula('1d4-2', sequenceRng([0.99]));
    expect(roll.text).toBe('1d4-2 → [4] − 2 = 2');
  });

  it('returns the modifier alone for a formula without dice', () => {
    expect(rollFormula('5', sequenceRng([0])).total).toBe(5);
  });
});
