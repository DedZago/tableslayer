import { describe, expect, it } from 'vitest';
import { concentrationHighlight, nextConcentrationFocus, NO_CONCENTRATION_HIGHLIGHT } from './concentration';

const concentration = (templateIds: string[], markerIds: string[] = []) => ({
  spellId: 'bless',
  startedAt: 1,
  templateIds,
  markerIds
});

const snapshot = {
  markers: [
    { id: 'cleric', concentration: concentration(['bless-a', 'bless-b', 'bless-gone']) },
    { id: 'wizard', concentration: concentration(['moonbeam'], ['sphere']) },
    { id: 'fighter', concentration: null },
    { id: 'rogue', concentration: concentration(['deleted']) },
    { id: 'sphere' },
    { id: 'goblin' }
  ],
  aoeTemplates: [{ id: 'bless-a' }, { id: 'bless-b' }, { id: 'moonbeam' }, { id: 'web' }]
};

describe('concentrationHighlight', () => {
  it('lists the rows that still exist and the caster, for its seal', () => {
    expect(concentrationHighlight(snapshot, ['cleric'])).toEqual({
      templateIds: ['bless-a', 'bless-b'],
      markerIds: ['cleric']
    });
  });

  it('includes the summons of a concentration', () => {
    expect(concentrationHighlight(snapshot, ['wizard'])).toEqual({
      templateIds: ['moonbeam'],
      markerIds: ['sphere', 'wizard']
    });
  });

  it('joins several casters', () => {
    const highlight = concentrationHighlight(snapshot, ['cleric', 'wizard', 'goblin']);
    expect(highlight.templateIds).toEqual(['bless-a', 'bless-b', 'moonbeam']);
    expect(highlight.markerIds).toEqual(['cleric', 'sphere', 'wizard']);
  });

  it('is empty for tokens not concentrating, an inactive concentration, or deleted casters', () => {
    expect(concentrationHighlight(snapshot, ['fighter'])).toBe(NO_CONCENTRATION_HIGHLIGHT);
    expect(concentrationHighlight(snapshot, ['rogue'])).toBe(NO_CONCENTRATION_HIGHLIGHT);
    expect(concentrationHighlight(snapshot, ['gone'])).toBe(NO_CONCENTRATION_HIGHLIGHT);
    expect(concentrationHighlight(snapshot, [])).toBe(NO_CONCENTRATION_HIGHLIGHT);
    expect(concentrationHighlight(null, ['cleric'])).toBe(NO_CONCENTRATION_HIGHLIGHT);
  });
});

describe('nextConcentrationFocus', () => {
  const concentrating = (id: string) => id === 'cleric' || id === 'wizard';

  it('focuses a concentrating token, and moves to another one tapped', () => {
    expect(nextConcentrationFocus(null, 'cleric', concentrating)).toBe('cleric');
    expect(nextConcentrationFocus('cleric', 'wizard', concentrating)).toBe('wizard');
  });

  it('clears on the focused token again, a token not concentrating, or empty map', () => {
    expect(nextConcentrationFocus('cleric', 'cleric', concentrating)).toBeNull();
    expect(nextConcentrationFocus('cleric', 'goblin', concentrating)).toBeNull();
    expect(nextConcentrationFocus('cleric', null, concentrating)).toBeNull();
  });
});
