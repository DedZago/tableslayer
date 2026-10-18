import { abilityMod, statBlockSchema, type Ability, type StatBlock, type StatEntry } from '$lib/utils/statBlock';
import { parseEntries } from './entries';
import { parseStatEntry } from './entry';
import {
  parseAc,
  parseAlignment,
  parseCr,
  parseDamageList,
  parseHp,
  parseInitiative,
  parseSaves,
  parseSize,
  parseSkills,
  parseSpeed,
  parseType
} from './fields';
import { asNumber, recordsOf, stringsOf } from './guards';
import { rawMonsterSchema, type RawMonster } from './raw';
import { parseSpellcasting } from './spellcasting';
import { plainTextOf } from './tags';

export { applyCopy, type CopyOptions } from './copy';
export { parseInlineTags } from './tags';

const FALLBACK_MONSTER: RawMonster = { name: 'Unknown creature', source: 'Unknown' };
const DEFAULT_LEGENDARY_COUNT = 3;
const MAX_WARNINGS = 100;

const entriesOf = (monster: RawMonster, key: string, warnings: string[]): StatEntry[] =>
  recordsOf(monster[key]).map((entry) => parseStatEntry(entry, warnings));

const abilityEntry = (score: number, save?: number) => ({
  score,
  mod: abilityMod(score),
  ...(save !== undefined ? { save } : {})
});

const parseAbilities = (monster: RawMonster, saves: Partial<Record<Ability, number>>): StatBlock['abilities'] => {
  const score = (ability: Ability) => asNumber(monster[ability]) ?? 10;
  return {
    str: abilityEntry(score('str'), saves.str),
    dex: abilityEntry(score('dex'), saves.dex),
    con: abilityEntry(score('con'), saves.con),
    int: abilityEntry(score('int'), saves.int),
    wis: abilityEntry(score('wis'), saves.wis),
    cha: abilityEntry(score('cha'), saves.cha)
  };
};

export const buildStatBlock = (raw: unknown, adapterVersion: string): StatBlock => {
  const parsed = rawMonsterSchema.safeParse(raw);
  const monster = parsed.success ? parsed.data : FALLBACK_MONSTER;
  const warnings: string[] = parsed.success ? [] : ['Missing name or source'];
  const cr = parseCr(monster.cr, warnings);
  const abilities = parseAbilities(monster, parseSaves(monster.save));
  const { speed, canHover } = parseSpeed(monster.speed);
  const legendary = entriesOf(monster, 'legendary', warnings);
  const legendaryHeader = parseEntries(monster.legendaryHeader, warnings);
  const legendaryCount =
    asNumber(monster.legendaryActions) ?? (legendary.length > 0 ? DEFAULT_LEGENDARY_COUNT : undefined);
  const page = asNumber(monster.page);
  const passive = asNumber(monster.passive);

  const statBlock = {
    version: 1,
    source: {
      provider: '5etools',
      name: monster.name,
      source: monster.source,
      ...(page !== undefined ? { page } : {}),
      adapterVersion
    },
    name: monster.name,
    size: parseSize(monster.size, warnings),
    type: parseType(monster.type),
    alignment: parseAlignment(monster.alignment),
    ac: parseAc(monster.ac, warnings),
    hp: parseHp(monster.hp),
    speed,
    ...(canHover ? { canHover } : {}),
    abilities,
    skills: parseSkills(monster.skill),
    senses: stringsOf(monster.senses).map(plainTextOf),
    ...(passive !== undefined ? { passive } : {}),
    languages: stringsOf(monster.languages).map(plainTextOf),
    cr,
    initiative: parseInitiative(monster.initiative, abilities.dex.mod, cr.pb),
    vulnerable: parseDamageList(monster.vulnerable),
    resist: parseDamageList(monster.resist),
    immune: parseDamageList(monster.immune),
    conditionImmune: parseDamageList(monster.conditionImmune),
    traits: entriesOf(monster, 'trait', warnings),
    actions: entriesOf(monster, 'action', warnings),
    bonusActions: entriesOf(monster, 'bonus', warnings),
    reactions: entriesOf(monster, 'reaction', warnings),
    legendary,
    ...(legendaryHeader.length > 0 ? { legendaryHeader } : {}),
    ...(legendaryCount !== undefined ? { legendaryCount } : {}),
    mythic: entriesOf(monster, 'mythic', warnings),
    spellcasting: parseSpellcasting(monster.spellcasting, warnings),
    warnings: warnings.slice(0, MAX_WARNINGS)
  };
  return statBlockSchema.parse(statBlock);
};
