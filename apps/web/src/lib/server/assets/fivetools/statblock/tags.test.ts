import { inlinesToPlainText } from '$lib/utils/statBlock';
import { describe, expect, it } from 'vitest';
import { parseInlineTags } from './tags';

describe('parseInlineTags', () => {
  it('turns attack and hit tags into structured inlines', () => {
    expect(parseInlineTags('{@atk mw} {@hit 4} to hit')).toEqual([
      { kind: 'attack', label: 'Melee Weapon Attack:' },
      { kind: 'text', text: ' ' },
      { kind: 'hit', bonus: 4 },
      { kind: 'text', text: ' to hit' }
    ]);
  });

  it('keeps nested tags inside formatting tags', () => {
    expect(parseInlineTags('{@note See the {@spell fireball}.}')).toEqual([
      { kind: 'text', text: 'See the ' },
      { kind: 'ref', refType: 'spell', text: 'fireball' },
      { kind: 'text', text: '.' }
    ]);
  });

  it('reads recharge with and without a value', () => {
    expect(parseInlineTags('{@recharge 5}')).toEqual([{ kind: 'recharge', min: 5 }]);
    expect(parseInlineTags('{@recharge}')).toEqual([{ kind: 'recharge', min: 6 }]);
  });

  it('gives d20 bonuses a signed formula', () => {
    expect(parseInlineTags('{@d20 +5}')).toEqual([{ kind: 'dice', formula: '1d20+5' }]);
    expect(parseInlineTags('{@d20 -1}')).toEqual([{ kind: 'dice', formula: '1d20-1' }]);
  });

  it('labels saving throw and hit-or-miss tags', () => {
    expect(parseInlineTags('{@actSave dex}')).toEqual([{ kind: 'em', text: 'Dexterity Saving Throw:' }]);
    expect(parseInlineTags('{@hom}')).toEqual([{ kind: 'em', text: 'Hit or Miss: ' }]);
  });

  it('uses the display text of pipe-separated references', () => {
    expect(parseInlineTags('{@sense tremorsense|MM}')).toEqual([
      { kind: 'ref', refType: 'sense', text: 'tremorsense' }
    ]);
    expect(parseInlineTags('{@condition prone|PHB|knocked prone}')).toEqual([
      { kind: 'ref', refType: 'condition', text: 'knocked prone' }
    ]);
  });

  it('falls back to the display text of unknown tags', () => {
    expect(parseInlineTags('{@foo bar|x|shown}')).toEqual([{ kind: 'text', text: 'shown' }]);
  });

  it('never leaves a raw tag opener behind', () => {
    const inlines = parseInlineTags('Unclosed {@hit 4 and {@damage 1d6 + 2} {@unknown');
    expect(JSON.stringify(inlines)).not.toContain('{@');
  });

  it('reads the display text from the right segment of each tag', () => {
    const plain = (input: string) => inlinesToPlainText(parseInlineTags(input));
    expect(plain('{@quickref difficult terrain||3}')).toBe('difficult terrain');
    expect(plain('{@quickref Vision and Light|PHB|2||heavily obscured}')).toBe('heavily obscured');
    expect(plain('{@book Chapter 5|DMG|5}')).toBe('Chapter 5');
    expect(plain('{@filter dragons|bestiary|type=dragon}')).toBe('dragons');
    expect(plain('{@variantrule Emanation [Area of Effect]|XPHB|Emanation}')).toBe('Emanation');
    expect(plain('{@spell fireball|phb|Fireball!}')).toBe('Fireball!');
    expect(plain('{@creature goblin}')).toBe('goblin');
  });
});
