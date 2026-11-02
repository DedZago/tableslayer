import { describe, expect, it } from 'vitest';
import { byRuleset, DEFAULT_RULESET, isRuleset, RULESET_LABELS, RULESETS } from './rulesets';

describe('rulesets', () => {
  it('labels every ruleset and defaults to a known one', () => {
    expect(Object.keys(RULESET_LABELS)).toEqual([...RULESETS]);
    expect(RULESETS).toContain(DEFAULT_RULESET);
  });

  it('recognizes only known rulesets', () => {
    expect(isRuleset('dnd5e-2014')).toBe(true);
    expect(isRuleset('dnd5e-2024')).toBe(true);
    expect(isRuleset('pathfinder')).toBe(false);
    expect(isRuleset(null)).toBe(false);
    expect(isRuleset(2014)).toBe(false);
  });
});

describe('byRuleset', () => {
  const spec = { base: { size: 15, range: 60, label: 'Cube' }, 'dnd5e-2014': { size: 20 } };

  it('returns the base when the ruleset has no override', () => {
    expect(byRuleset(spec, 'dnd5e-2024')).toEqual({ size: 15, range: 60, label: 'Cube' });
  });

  it('shallow-merges the override over the base', () => {
    expect(byRuleset(spec, 'dnd5e-2014')).toEqual({ size: 20, range: 60, label: 'Cube' });
  });

  it('does not mutate the spec', () => {
    byRuleset(spec, 'dnd5e-2014');
    expect(spec.base.size).toBe(15);
  });
});
