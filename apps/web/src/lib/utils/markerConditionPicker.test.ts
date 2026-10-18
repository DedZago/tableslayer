import { describe, expect, it } from 'vitest';
import { conditionPickerState, stepConditionValue } from './markerConditionPicker';

const statBlock = { hp: { average: 20 } } as never;

describe('conditionPickerState', () => {
  it('splits stored conditions into active and mixed', () => {
    const state = conditionPickerState([
      { conditions: [{ id: 'prone' }, { id: 'stunned' }] },
      { conditions: [{ id: 'prone' }] }
    ]);
    expect(state.active).toEqual([{ id: 'prone' }]);
    expect([...state.mixed]).toEqual(['stunned']);
  });

  it('keeps a shared exhaustion level and drops differing ones', () => {
    expect(
      conditionPickerState([
        { conditions: [{ id: 'exhaustion', value: 2 }] },
        { conditions: [{ id: 'exhaustion', value: 2 }] }
      ]).active
    ).toEqual([{ id: 'exhaustion', value: 2 }]);
    expect(
      conditionPickerState([
        { conditions: [{ id: 'exhaustion', value: 1 }] },
        { conditions: [{ id: 'exhaustion', value: 3 }] }
      ]).active
    ).toEqual([{ id: 'exhaustion', value: undefined }]);
  });

  it('shows derived bloodied as automatic, never as stored', () => {
    const state = conditionPickerState([{ conditions: [], statBlock, hitPoints: 5 }]);
    expect(state.active).toEqual([]);
    expect([...state.automatic]).toEqual(['bloodied']);
  });

  it('treats a stored bloodied as a normal condition', () => {
    const state = conditionPickerState([{ conditions: [{ id: 'bloodied' }], statBlock, hitPoints: 5 }]);
    expect(state.active).toEqual([{ id: 'bloodied' }]);
    expect(state.automatic.size).toBe(0);
  });

  it('does not mark bloodied automatic unless every target is bloodied', () => {
    const state = conditionPickerState([
      { conditions: [], statBlock, hitPoints: 5 },
      { conditions: [], statBlock, hitPoints: 15 }
    ]);
    expect(state.automatic.size).toBe(0);
  });
});

describe('stepConditionValue', () => {
  it('steps each token relative to its own level', () => {
    expect(stepConditionValue([{ id: 'exhaustion', value: 1 }], 'exhaustion', 1)).toEqual([
      { id: 'exhaustion', value: 2 }
    ]);
    expect(stepConditionValue([{ id: 'exhaustion', value: 3 }], 'exhaustion', 1)).toEqual([
      { id: 'exhaustion', value: 4 }
    ]);
  });

  it('caps at the catalog max and removes below 1', () => {
    expect(stepConditionValue([{ id: 'exhaustion', value: 6 }], 'exhaustion', 1)).toEqual([
      { id: 'exhaustion', value: 6 }
    ]);
    expect(stepConditionValue([{ id: 'prone' }, { id: 'exhaustion', value: 1 }], 'exhaustion', -1)).toEqual([
      { id: 'prone' }
    ]);
  });

  it('keeps the GM-only flag', () => {
    expect(stepConditionValue([{ id: 'exhaustion', value: 2, dmOnly: true }], 'exhaustion', -1)).toEqual([
      { id: 'exhaustion', value: 1, dmOnly: true }
    ]);
  });
});
