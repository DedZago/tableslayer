import { describe, expect, it } from 'vitest';
import fixtureMonsters from './__fixtures__/monsters.json';
import { applyCopy, identityKey } from './copy';
import type { RawMonster } from './raw';

const fixture = fixtureMonsters as RawMonster[];

const indexOf = (monsters: RawMonster[]) =>
  new Map(monsters.map((monster) => [identityKey(monster.name, monster.source), monster]));

const findFixture = (name: string) => fixture.find((monster) => monster.name === name) as RawMonster;

describe('applyCopy', () => {
  it('returns a record without _copy and the copied base fields', () => {
    const index = indexOf(fixture);
    const { record, warnings } = applyCopy(findFixture('Goblin Scout'), index);
    expect(record).not.toHaveProperty('_copy');
    expect(record.cr).toBe('1/2');
    expect(record.page).toBe(1);
    expect(record.hp).toEqual({ average: 7, formula: '2d6' });
    expect(warnings).toEqual([]);
  });

  it('applies replaceTxt across entries and appendArr to a list', () => {
    const { record } = applyCopy(findFixture('Goblin Scout'), indexOf(fixture));
    const actions = record.action as { name: string; entries: string[] }[];
    expect(actions.map((action) => action.name)).toEqual(['Scimitar', 'Shortbow', 'Sling']);
    expect(actions[0].entries[0]).toContain('piercing damage');
    expect(actions[0].entries[0]).not.toContain('slashing');
  });

  it('does not change the base monster', () => {
    const index = indexOf(fixture);
    applyCopy(findFixture('Goblin Scout'), index);
    const goblin = findFixture('Goblin');
    expect(JSON.stringify(goblin)).toContain('slashing');
    expect(goblin.action).toHaveLength(2);
  });

  it('keeps base page and source out of the copy unless _preserve lists them', () => {
    const base: RawMonster = { name: 'Base', source: 'A', page: 5, srd: true, str: 9 };
    const child: RawMonster = { name: 'Child', source: 'B', _copy: { name: 'Base', source: 'A' } };
    const { record } = applyCopy(child, indexOf([base]));
    expect(record).not.toHaveProperty('page');
    expect(record).not.toHaveProperty('srd');
    expect(record.str).toBe(9);
  });

  it('warns when the base monster is missing', () => {
    const child: RawMonster = { name: 'Orphan', source: 'B', _copy: { name: 'Nobody', source: 'A' } };
    const { warnings } = applyCopy(child, new Map());
    expect(warnings).toEqual(['Missing base monster Nobody (A)']);
  });

  it('stops copy cycles with a warning', () => {
    const first: RawMonster = { name: 'First', source: 'A', _copy: { name: 'Second', source: 'A' } };
    const second: RawMonster = { name: 'Second', source: 'A', _copy: { name: 'First', source: 'A' } };
    const { warnings } = applyCopy(first, indexOf([first, second]));
    expect(warnings).toContain('_copy chain is too deep');
  });

  it('warns on unknown modes and leaves the record usable', () => {
    const base: RawMonster = { name: 'Base', source: 'A', action: [{ name: 'Bite', entries: ['Bite.'] }] };
    const child: RawMonster = {
      name: 'Child',
      source: 'B',
      _copy: { name: 'Base', source: 'A', _mod: { action: { mode: 'mysteryMode' } } }
    };
    const { record, warnings } = applyCopy(child, indexOf([base]));
    expect(warnings).toEqual(['Unsupported _mod mode mysteryMode']);
    expect(record.action).toEqual([{ name: 'Bite', entries: ['Bite.'] }]);
  });

  it('warns on an invalid replaceTxt pattern', () => {
    const base: RawMonster = { name: 'Base', source: 'A', action: [{ name: 'Bite', entries: ['Bite.'] }] };
    const child: RawMonster = {
      name: 'Child',
      source: 'B',
      _copy: { name: 'Base', source: 'A', _mod: { '*': { mode: 'replaceTxt', replace: '(' } } }
    };
    const { warnings } = applyCopy(child, indexOf([base]));
    expect(warnings).toEqual(['Invalid replaceTxt pattern (']);
  });

  it('replaces every match even when flags are given', () => {
    const base: RawMonster = {
      name: 'Base',
      source: 'A',
      action: [{ name: 'Breath', entries: ['The Dragon exhales. The dragon roars.'] }]
    };
    const child: RawMonster = {
      name: 'Child',
      source: 'B',
      _copy: {
        name: 'Base',
        source: 'A',
        _mod: { '*': { mode: 'replaceTxt', replace: 'the dragon', with: 'the dracolich', flags: 'i' } }
      }
    };
    const { record } = applyCopy(child, indexOf([base]));
    expect((record.action as { entries: string[] }[])[0].entries[0]).toBe(
      'the dracolich exhales. the dracolich roars.'
    );
  });

  it('matches replaceTxt patterns as literal text for untrusted data', () => {
    const base: RawMonster = {
      name: 'Base',
      source: 'A',
      action: [{ name: 'Bite', entries: ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa! (a+)+$ here'] }]
    };
    const child: RawMonster = {
      name: 'Child',
      source: 'B',
      _copy: { name: 'Base', source: 'A', _mod: { action: { mode: 'replaceTxt', replace: '(a+)+$', with: 'X' } } }
    };
    const { record } = applyCopy(child, indexOf([base]), { literalReplaceTxt: true });
    expect((record.action as { entries: string[] }[])[0].entries[0]).toBe(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa! X here'
    );
  });

  it('warns about _trait templates', () => {
    const base: RawMonster = { name: 'Base', source: 'A' };
    const child: RawMonster = {
      name: 'Child',
      source: 'B',
      _copy: { name: 'Base', source: 'A', _trait: { name: 'Zombie', source: 'VRGR' } }
    };
    const { warnings } = applyCopy(child, indexOf([base]));
    expect(warnings).toContain('_copy._trait templates are not supported');
  });
});
