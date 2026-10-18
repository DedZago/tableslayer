import {
  crToNumber,
  crToProficiency,
  crToXp,
  type Ability,
  type SpeedMode,
  type StatBlock
} from '$lib/utils/statBlock';
import { ABILITY_KEYS, ALIGNMENT_NAMES, SIZE_NAMES } from './constants';
import { asArray, asNumber, asString, isRecord, lookup, stringsOf } from './guards';
import { plainTextOf } from './tags';

const SPEED_MODES: SpeedMode[] = ['walk', 'burrow', 'climb', 'fly', 'swim'];
const SMALL_WORDS = new Set(['of']);
const DAMAGE_LIST_KEYS = ['resist', 'immune', 'vulnerable', 'conditionImmune'];

const stripParens = (value: string) => value.replace(/^\((.*)\)$/, '$1');

const parseBonus = (value: unknown) => {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value.replace('−', '-')) : asNumber(value);
  return parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined;
};

const titleCase = (value: string) =>
  value
    .split(' ')
    .map((word, index) =>
      index > 0 && SMALL_WORDS.has(word) ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`
    )
    .join(' ');

const joinWithAnd = (items: string[]) =>
  items.length <= 2 ? items.join(' and ') : `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;

const parseDamageItem = (item: unknown): string[] => {
  if (typeof item === 'string') return [plainTextOf(item)];
  if (!isRecord(item)) return [];
  const special = asString(item.special);
  if (special) return [plainTextOf(special)];
  const listKey = DAMAGE_LIST_KEYS.find((key) => Array.isArray(item[key]));
  const names = listKey ? stringsOf(item[listKey]).map(plainTextOf) : [];
  if (names.length === 0) return [];
  const preNote = asString(item.preNote);
  const note = asString(item.note);
  return [[preNote, joinWithAnd(names), note].filter((part): part is string => Boolean(part)).join(' ')];
};

export const parseAc = (raw: unknown, warnings: string[]): StatBlock['ac'] =>
  asArray(raw).flatMap((entry) => {
    if (typeof entry === 'number') return [{ value: entry }];
    if (!isRecord(entry)) return [];
    const value = asNumber(entry.ac);
    if (value === undefined) {
      warnings.push('Armor class entry without a value');
      return [];
    }
    const from = stringsOf(entry.from).map(plainTextOf);
    const condition = asString(entry.condition);
    const note = [from.join(', '), condition ? stripParens(plainTextOf(condition)) : ''].filter(Boolean).join(' ');
    return [{ value, ...(note ? { note } : {}) }];
  });

export const parseHp = (raw: unknown): StatBlock['hp'] => {
  const record = isRecord(raw) ? raw : {};
  const formula = asString(record.formula);
  const special = asString(record.special);
  return {
    average: asNumber(record.average) ?? null,
    ...(formula ? { formula } : {}),
    ...(special ? { note: plainTextOf(special) } : {})
  };
};

export const parseSpeed = (raw: unknown): { speed: StatBlock['speed']; canHover: boolean } => {
  const record = isRecord(raw) ? raw : {};
  const canHover = record.canHover === true;
  const speed = SPEED_MODES.flatMap((mode) => {
    const value = record[mode];
    const feet = asNumber(value) ?? (isRecord(value) ? asNumber(value.number) : undefined);
    if (feet === undefined) return [];
    const condition = isRecord(value) ? asString(value.condition) : undefined;
    const note = condition ? stripParens(plainTextOf(condition)) : mode === 'fly' && canHover ? 'hover' : undefined;
    return [{ mode, feet, ...(note ? { note } : {}) }];
  });
  return { speed, canHover };
};

export const parseType = (raw: unknown): string => {
  if (typeof raw === 'string') return raw;
  if (!isRecord(raw)) return 'unknown';
  const choices = stringsOf(raw.choose);
  const base = asString(raw.type) ?? (choices.length > 0 ? choices.join(' or ') : 'unknown');
  const swarmName = lookup(SIZE_NAMES, asString(raw.swarmSize) ?? '');
  const kind = swarmName ? `swarm of ${swarmName} ${base}s` : base;
  const tags = asArray(raw.tags).flatMap((tag) => {
    const name = typeof tag === 'string' ? tag : isRecord(tag) ? asString(tag.tag) : undefined;
    return name ? [name] : [];
  });
  return tags.length > 0 ? `${kind} (${tags.join(', ')})` : kind;
};

export const parseSize = (raw: unknown, warnings: string[]): string[] =>
  stringsOf(raw).map((code) => {
    const name = lookup(SIZE_NAMES, code);
    if (!name) warnings.push(`Unknown size code ${code}`);
    return name ?? code;
  });

export const parseAlignment = (raw: unknown): string => {
  const entries = asArray(raw);
  const special = entries.map((entry) => (isRecord(entry) ? asString(entry.special) : undefined)).find(Boolean);
  if (special) return plainTextOf(special);
  const codes = entries.flatMap((entry) =>
    typeof entry === 'string' ? [entry] : isRecord(entry) ? stringsOf(entry.alignment) : []
  );
  if (codes.includes('U')) return 'unaligned';
  if (codes.includes('A')) return 'any alignment';
  if (codes.length > 2) {
    const moral = ['E', 'G'].find((code) => codes.includes(code));
    const moralName = moral ? lookup(ALIGNMENT_NAMES, moral) : undefined;
    return moralName ? `any ${moralName} alignment` : 'any alignment';
  }
  const words = [
    ...new Set(codes.map((code) => lookup(ALIGNMENT_NAMES, code)).filter((word): word is string => Boolean(word)))
  ];
  return words.length > 0 ? words.join(' ') : 'unaligned';
};

export const parseCr = (raw: unknown, warnings: string[]): StatBlock['cr'] => {
  const record = isRecord(raw) ? raw : {};
  const crText = typeof raw === 'string' ? raw : (asString(record.cr) ?? '');
  const parsed = crToNumber(crText);
  if (parsed === null) warnings.push(`Unknown challenge rating ${crText}`);
  const value = parsed ?? 0;
  const lair = asString(record.lair);
  const xp = asNumber(record.xp) ?? crToXp(value);
  return {
    display: lair ? `${crText} (${lair} in lair)` : crText,
    value,
    pb: crToProficiency(value),
    ...(xp !== undefined ? { xp } : {}),
    ...(lair ? { lair } : {})
  };
};

export const parseSaves = (raw: unknown): Partial<Record<Ability, number>> => {
  const record = isRecord(raw) ? raw : {};
  const saves: Partial<Record<Ability, number>> = {};
  for (const ability of ABILITY_KEYS) {
    const bonus = parseBonus(record[ability]);
    if (bonus !== undefined) saves[ability] = bonus;
  }
  return saves;
};

export const parseSkills = (raw: unknown): StatBlock['skills'] => {
  if (!isRecord(raw)) return [];
  return Object.entries(raw).flatMap(([name, bonus]) =>
    typeof bonus === 'string' ? [{ name: titleCase(name), bonus: bonus.replace(/^-/, '−') }] : []
  );
};

export const parseDamageList = (raw: unknown): string[] => asArray(raw).flatMap(parseDamageItem);

export const parseInitiative = (raw: unknown, dexMod: number, proficiencyBonus: number): number => {
  const bonus = asNumber(raw);
  if (bonus !== undefined) return bonus;
  const proficiency = isRecord(raw) ? (asNumber(raw.proficiency) ?? 0) : 0;
  return dexMod + proficiency * proficiencyBonus;
};
