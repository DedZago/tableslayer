import { describe, expect, it } from 'vitest';
import type { MarkerCondition } from '../components/MarkerLayer/types';
import {
  conditionIdsInCategory,
  conditionsKey,
  MARKER_CONDITION_CATEGORIES,
  MARKER_CONDITION_ORDER,
  MARKER_CONDITIONS,
  resolveCondition,
  sortConditions,
  toggleCondition
} from './markerConditions';

const CUSTOM = { id: 'custom:1', label: 'Hexed', color: '#ffff00' } satisfies MarkerCondition;

describe('MARKER_CONDITIONS', () => {
  it('keeps every description within 140 characters', () => {
    for (const definition of Object.values(MARKER_CONDITIONS)) {
      expect(definition.description.length).toBeLessThanOrEqual(140);
    }
  });

  it('exposes the catalog keys as the order', () => {
    expect(MARKER_CONDITION_ORDER).toEqual(Object.keys(MARKER_CONDITIONS));
  });

  it('includes every official 5e condition and the common table statuses', () => {
    for (const id of [
      'blinded',
      'charmed',
      'deafened',
      'exhaustion',
      'frightened',
      'grappled',
      'incapacitated',
      'invisible',
      'paralyzed',
      'petrified',
      'poisoned',
      'prone',
      'restrained',
      'stunned',
      'unconscious',
      'turned',
      'dying'
    ]) {
      expect(MARKER_CONDITIONS[id], id).toBeDefined();
    }
  });

  it('gives every condition a unique badge abbreviation', () => {
    const abbrs = Object.values(MARKER_CONDITIONS).map((definition) => definition.abbr);
    expect(new Set(abbrs).size).toBe(abbrs.length);
  });

  it('fits every category in one radial ring, in catalog order', () => {
    const categories = MARKER_CONDITION_CATEGORIES.flatMap(({ id }) => (id === 'custom' ? [] : [id]));
    for (const category of categories) {
      const ids = conditionIdsInCategory(category);
      expect(ids.length, category).toBeGreaterThan(0);
      expect(ids.length, category).toBeLessThanOrEqual(8);
    }
    expect(categories.flatMap(conditionIdsInCategory)).toEqual(MARKER_CONDITION_ORDER);
  });
});

describe('sortConditions', () => {
  it('orders catalog entries by catalog order and custom entries last', () => {
    const sorted = sortConditions([CUSTOM, { id: 'prone' }, { id: 'blinded' }]);
    expect(sorted.map((c) => c.id)).toEqual(['blinded', 'prone', 'custom:1']);
  });

  it('sorts custom entries by label', () => {
    const sorted = sortConditions([
      { id: 'custom:b', label: 'Zeal' },
      { id: 'custom:a', label: 'Adder' }
    ]);
    expect(sorted.map((c) => c.id)).toEqual(['custom:a', 'custom:b']);
  });

  it('does not mutate its input', () => {
    const input = [{ id: 'prone' }, { id: 'blinded' }];
    sortConditions(input);
    expect(input.map((c) => c.id)).toEqual(['prone', 'blinded']);
  });
});

describe('conditionsKey', () => {
  it('is independent of input order', () => {
    expect(conditionsKey([{ id: 'prone' }, { id: 'blinded' }])).toBe(
      conditionsKey([{ id: 'blinded' }, { id: 'prone' }])
    );
  });

  it('encodes value, custom fields and dm-only flags', () => {
    const key = conditionsKey([{ id: 'exhaustion', value: 2 }, { ...CUSTOM, dmOnly: true }, { id: 'prone' }]);
    expect(key).toBe('prone|exhaustion:2|custom:1:Hexed:#ffff00:dm');
  });

  it('is empty for an empty list', () => {
    expect(conditionsKey([])).toBe('');
  });
});

describe('resolveCondition', () => {
  it('resolves catalog conditions', () => {
    expect(resolveCondition({ id: 'stunned' })).toEqual({
      label: 'Stunned',
      abbr: 'St',
      color: '#facc15',
      description: MARKER_CONDITIONS.stunned.description,
      category: 'cantAct'
    });
  });

  it('falls back to custom defaults when only an id is known', () => {
    expect(resolveCondition({ id: 'custom:2', label: 'hEXED' })).toEqual({
      label: 'hEXED',
      abbr: 'He',
      color: '#8b5cf6',
      description: 'Custom condition',
      category: 'custom'
    });
  });

  it('uses the stored custom colour', () => {
    expect(resolveCondition(CUSTOM).color).toBe('#ffff00');
  });
});

describe('toggleCondition', () => {
  it('adds a missing condition in catalog order', () => {
    expect(toggleCondition([{ id: 'prone' }], 'blinded').map((c) => c.id)).toEqual(['blinded', 'prone']);
  });

  it('removes a present condition', () => {
    expect(toggleCondition([{ id: 'blinded' }, { id: 'prone' }], 'blinded')).toEqual([{ id: 'prone' }]);
  });

  it('keeps the values of other conditions when toggling', () => {
    const list = [{ id: 'exhaustion', value: 3 }];
    expect(toggleCondition(list, 'prone')).toEqual([{ id: 'prone' }, { id: 'exhaustion', value: 3 }]);
  });
});
