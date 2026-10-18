import { statBlockSchema } from '$lib/utils/statBlock';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import fixtureMonsters from './__fixtures__/monsters.json';
import { applyCopy, identityKey } from './copy';
import { buildStatBlock } from './index';
import type { RawMonster } from './raw';

const ADAPTER_VERSION = 'test';
const UPSTREAM_BESTIARY = fileURLToPath(
  new URL('../../../../../../../../.local-data/5etools-upstream/bestiary-mm.json', import.meta.url)
);

const fixture = fixtureMonsters as RawMonster[];

const indexOf = (monsters: RawMonster[]) =>
  new Map(monsters.map((monster) => [identityKey(monster.name, monster.source), monster]));

const buildNamed = (monsters: RawMonster[], name: string, source: string) => {
  const index = indexOf(monsters);
  const record = index.get(identityKey(name, source));
  if (!record) throw new Error(`Missing ${name}`);
  return buildStatBlock(applyCopy(record, index).record, ADAPTER_VERSION);
};

const fixtureStatBlock = (name: string, source: string) => buildNamed(fixture, name, source);

const findEntry = <T extends { name: string }>(entries: T[], name: string): T => {
  const entry = entries.find((candidate) => candidate.name === name);
  if (!entry) throw new Error(`Missing entry ${name}`);
  return entry;
};

describe('buildStatBlock with the committed fixture', () => {
  it('produces a schema-valid goblin', () => {
    const goblin = fixtureStatBlock('Goblin', 'MM');
    expect(statBlockSchema.safeParse(goblin).success).toBe(true);
    expect(goblin.name).toBe('Goblin');
    expect(goblin.source).toEqual({
      provider: '5etools',
      name: 'Goblin',
      source: 'MM',
      page: 166,
      adapterVersion: ADAPTER_VERSION
    });
  });

  it('reads armor class, hit points, size, type and alignment', () => {
    const goblin = fixtureStatBlock('Goblin', 'MM');
    expect(goblin.ac).toEqual([{ value: 15, note: 'leather armor, shield' }]);
    expect(goblin.hp).toEqual({ average: 7, formula: '2d6' });
    expect(goblin.size).toEqual(['Small']);
    expect(goblin.type).toBe('humanoid (goblinoid)');
    expect(goblin.alignment).toBe('neutral evil');
  });

  it('reads a scimitar attack with damage', () => {
    const scimitar = findEntry(fixtureStatBlock('Goblin', 'MM').actions, 'Scimitar');
    expect(scimitar.attack).toEqual({
      toHit: 4,
      kind: 'Melee Weapon Attack:',
      reach: '5 ft.',
      damage: [{ formula: '1d6 + 2', average: 5, type: 'slashing' }]
    });
  });

  it('reads the challenge rating, proficiency and experience', () => {
    const goblin = fixtureStatBlock('Goblin', 'MM');
    expect(goblin.cr).toEqual({ display: '1/4', value: 0.25, xp: 50, pb: 2 });
    expect(goblin.abilities.dex).toEqual({ score: 14, mod: 2 });
    expect(goblin.skills).toEqual([{ name: 'Stealth', bonus: '+6' }]);
    expect(goblin.passive).toBe(9);
  });

  it('keeps reference text readable in trait bodies', () => {
    const trait = findEntry(fixtureStatBlock('Goblin', 'MM').traits, 'Nimble Escape');
    const [paragraph] = trait.body;
    expect(paragraph.map((inline) => ('text' in inline ? inline.text : '')).join('')).toContain(
      'take the Disengage or Hide action'
    );
  });

  it('reads the lich spell save, damage immunities and CR with lair value', () => {
    const lich = fixtureStatBlock('Lich', 'MM');
    expect(lich.spellcasting[0].dc).toBe(20);
    expect(lich.spellcasting[0].toHit).toBe(12);
    expect(lich.spellcasting[0].ability).toBe('int');
    expect(lich.spellcasting[0].groups[1]).toEqual({
      label: 'Level 1 (4 slots)',
      slots: 4,
      spells: ['detect magic', 'magic missile', 'shield', 'thunderwave']
    });
    expect(lich.immune.some((entry) => entry.includes('from nonmagical attacks'))).toBe(true);
    expect(lich.conditionImmune).toContain('charmed');
    expect(lich.cr).toEqual({ display: '21 (22 in lair)', value: 21, xp: 33000, pb: 7, lair: '22' });
    expect(lich.alignment).toBe('any evil alignment');
  });

  it('reads the lich paralyzing touch save and damage', () => {
    const touch = findEntry(fixtureStatBlock('Lich', 'MM').actions, 'Paralyzing Touch');
    expect(touch.save).toEqual({ dc: 18, ability: 'con' });
    expect(touch.attack?.damage).toEqual([{ formula: '3d6', average: 10, type: 'cold' }]);
  });

  it('reads dragon recharge and legendary action cost', () => {
    const dragon = fixtureStatBlock('Adult Red Dragon', 'MM');
    expect(findEntry(dragon.actions, 'Fire Breath').recharge).toBe(5);
    expect(findEntry(dragon.legendary, 'Wing Attack').cost).toBe(2);
    expect(dragon.legendaryCount).toBe(3);
    expect(dragon.speed).toEqual([
      { mode: 'walk', feet: 40 },
      { mode: 'climb', feet: 40 },
      { mode: 'fly', feet: 80 }
    ]);
  });

  it('splits multi-type damage in a bite', () => {
    const bite = findEntry(fixtureStatBlock('Adult Red Dragon', 'MM').actions, 'Bite');
    expect(bite.attack?.damage).toEqual([
      { formula: '2d10 + 8', average: 19, type: 'piercing' },
      { formula: '2d6', average: 7, type: 'fire' }
    ]);
  });

  it('reads the dragon frightful presence save ability', () => {
    const presence = findEntry(fixtureStatBlock('Adult Red Dragon', 'MM').actions, 'Frightful Presence');
    expect(presence.save).toEqual({ dc: 19, ability: 'wis' });
  });

  it('applies _copy and _mod on top of the base monster', () => {
    const scout = fixtureStatBlock('Goblin Scout', 'TST');
    expect(scout.cr.display).toBe('1/2');
    expect(scout.cr.pb).toBe(2);
    expect(findEntry(scout.actions, 'Scimitar').attack?.damage[0].type).toBe('piercing');
    expect(findEntry(scout.actions, 'Sling').attack?.damage[0]).toEqual({
      formula: '1d4 + 2',
      average: 4,
      type: 'bludgeoning'
    });
    expect(scout.warnings).toEqual([]);
  });

  it('reads the 2024 initiative proficiency and walking speed', () => {
    const warrior = fixtureStatBlock('Goblin Warrior', 'XMM');
    expect(warrior.initiative).toBe(4);
    expect(warrior.speed).toEqual([{ mode: 'walk', feet: 30 }]);
    expect(warrior.bonusActions.map((entry) => entry.name)).toEqual(['Dash Away']);
  });
});

describe.skipIf(!existsSync(UPSTREAM_BESTIARY))('buildStatBlock with the upstream 5etools bestiary', () => {
  const upstream = JSON.parse(readFileSync(UPSTREAM_BESTIARY, 'utf8')).monster as RawMonster[];

  it('builds every monster without leaving raw inline tags', () => {
    const index = indexOf(upstream);
    for (const monster of upstream) {
      const block = buildStatBlock(applyCopy(monster, index).record, ADAPTER_VERSION);
      expect(JSON.stringify(block), monster.name).not.toContain('{@');
    }
  });

  it('matches the goblin from the committed fixture', () => {
    const goblin = buildNamed(upstream, 'Goblin', 'MM');
    expect(goblin.ac).toEqual([{ value: 15, note: 'leather armor, shield' }]);
    expect(findEntry(goblin.actions, 'Scimitar').attack?.toHit).toBe(4);
  });
});
