import { describe, expect, it } from 'vitest';
import {
  abilityMod,
  averageDamage,
  crToNumber,
  crToProficiency,
  crToXp,
  formatModifier,
  formatSpeed,
  inlinesToPlainText
} from './format';

describe('formatModifier', () => {
  it('prefixes positive values and zero with a plus sign', () => {
    expect(formatModifier(2)).toBe('+2');
    expect(formatModifier(0)).toBe('+0');
  });

  it('uses the unicode minus sign for negative values', () => {
    expect(formatModifier(-1)).toBe('−1');
  });
});

describe('abilityMod', () => {
  it('rounds down ability scores to modifiers', () => {
    expect(abilityMod(8)).toBe(-1);
    expect(abilityMod(9)).toBe(-1);
    expect(abilityMod(10)).toBe(0);
    expect(abilityMod(27)).toBe(8);
  });
});

describe('crToNumber', () => {
  it('reads fractions and whole numbers', () => {
    expect(crToNumber('1/8')).toBe(0.125);
    expect(crToNumber('1/4')).toBe(0.25);
    expect(crToNumber('21')).toBe(21);
  });

  it('returns null for text that is not a challenge rating', () => {
    expect(crToNumber('unknown')).toBeNull();
  });
});

describe('crToXp', () => {
  it('looks up the experience value for a challenge rating', () => {
    expect(crToXp(0.25)).toBe(50);
    expect(crToXp(21)).toBe(33000);
    expect(crToXp(31)).toBeUndefined();
  });
});

describe('crToProficiency', () => {
  it('follows the proficiency bonus table', () => {
    expect(crToProficiency(0)).toBe(2);
    expect(crToProficiency(4)).toBe(2);
    expect(crToProficiency(5)).toBe(3);
    expect(crToProficiency(17)).toBe(6);
    expect(crToProficiency(21)).toBe(7);
  });
});

describe('averageDamage', () => {
  it('averages each die and adds the modifier', () => {
    expect(averageDamage('2d6+3')).toBe(10);
    expect(averageDamage('1d6 + 2')).toBe(5);
  });
});

describe('formatSpeed', () => {
  it('omits the walk label and labels other modes', () => {
    expect(
      formatSpeed([
        { mode: 'walk', feet: 40 },
        { mode: 'fly', feet: 80, note: 'hover' }
      ])
    ).toBe('40 ft., fly 80 ft. (hover)');
  });
});

describe('inlinesToPlainText', () => {
  it('renders each inline kind as readable text', () => {
    expect(
      inlinesToPlainText([
        { kind: 'attack', label: 'Melee Weapon Attack:' },
        { kind: 'text', text: ' ' },
        { kind: 'hit', bonus: -1 },
        { kind: 'text', text: ' ' },
        { kind: 'dc', dc: 13 },
        { kind: 'text', text: ' ' },
        { kind: 'damage', formula: '1d6 + 2' },
        { kind: 'text', text: ' ' },
        { kind: 'ref', refType: 'condition', text: 'prone' },
        { kind: 'text', text: ' ' },
        { kind: 'recharge', min: 5 },
        { kind: 'recharge', min: 6 }
      ])
    ).toBe('Melee Weapon Attack: −1 DC 13 1d6 + 2 prone (Recharge 5–6)(Recharge 6)');
  });
});
