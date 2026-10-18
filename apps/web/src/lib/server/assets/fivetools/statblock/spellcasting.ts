import { type Inline, type StatSpellcasting } from '$lib/utils/statBlock';
import { ABILITY_KEYS } from './constants';
import { parseEntries } from './entries';
import { asNumber, asString, isRecord, recordsOf, stringsOf } from './guards';
import { plainTextOf } from './tags';

type Group = StatSpellcasting['groups'][number];

const DISPLAY_AS = ['trait', 'action', 'bonus', 'reaction', 'legendary'] as const;

const spellNames = (spells: unknown) => stringsOf(spells).map(plainTextOf);

const spellGroup = (label: string, spells: unknown): Group[] => {
  const names = spellNames(spells);
  return names.length > 0 ? [{ label, spells: names }] : [];
};

const keyedGroups = (record: unknown, label: (key: string) => string): Group[] =>
  isRecord(record) ? Object.entries(record).flatMap(([key, value]) => spellGroup(label(key), value)) : [];

const dailyLabel = (key: string) => {
  const match = key.match(/^(\d+)(e?)$/);
  return match ? `${match[1]}/day${match[2] ? ' each' : ''}` : key;
};

const levelGroups = (record: unknown): Group[] =>
  isRecord(record)
    ? Object.entries(record).flatMap(([level, value]) => {
        if (!isRecord(value)) return [];
        const names = spellNames(value.spells);
        if (names.length === 0) return [];
        const slots = asNumber(value.slots);
        const slotText = slots === undefined ? '' : ` (${slots} ${slots === 1 ? 'slot' : 'slots'})`;
        const label = level === '0' ? 'Cantrips' : `Level ${level}${slotText}`;
        return [{ label, ...(slots !== undefined ? { slots } : {}), spells: names }];
      })
    : [];

const findInline = (inlines: Inline[], kind: 'dc' | 'hit') => inlines.find((inline) => inline.kind === kind);

const parseSpellcastingEntry = (entry: Record<string, unknown>, warnings: string[]): StatSpellcasting => {
  const header = parseEntries(entry.headerEntries, warnings);
  const headerInlines = header.flat();
  const dc = findInline(headerInlines, 'dc');
  const hit = findInline(headerInlines, 'hit');
  const ability = ABILITY_KEYS.find((code) => code === asString(entry.ability));
  const displayAs = DISPLAY_AS.find((value) => value === asString(entry.displayAs)) ?? 'trait';
  const groups = [
    ...spellGroup('At will', entry.will),
    ...keyedGroups(entry.daily, dailyLabel),
    ...keyedGroups(entry.rest, (key) => `${key}/rest`),
    ...keyedGroups(entry.weekly, (key) => `${key}/week`),
    ...keyedGroups(entry.recharge, (key) => `Recharge ${key}`),
    ...levelGroups(entry.spells),
    ...spellGroup('Rituals', entry.ritual)
  ];

  return {
    name: plainTextOf(asString(entry.name) ?? 'Spellcasting'),
    header,
    displayAs,
    ...(dc?.kind === 'dc' ? { dc: dc.dc } : {}),
    ...(hit?.kind === 'hit' ? { toHit: hit.bonus } : {}),
    ...(ability ? { ability } : {}),
    groups,
    footer: parseEntries(entry.footerEntries, warnings)
  };
};

export const parseSpellcasting = (raw: unknown, warnings: string[]): StatSpellcasting[] =>
  recordsOf(raw).map((entry) => parseSpellcastingEntry(entry, warnings));
