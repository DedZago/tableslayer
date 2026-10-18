import { crToNumber, crToXp, type StatBlock } from '$lib/utils/statBlock';
import { ENTRY_LIST_KEYS } from './constants';
import { asArray, asNumber, asString, isRecord, lookup, recordsOf, stringsOf } from './guards';
import type { RawMonster } from './raw';
import { plainTextOf } from './tags';

const MAX_COPY_DEPTH = 32;
const COPY_ONLY_KEYS = ['srd', 'page', 'otherSources'];
const SIZE_ORDER = ['T', 'S', 'M', 'L', 'H', 'G', 'C'];

type Mod = Record<string, unknown>;
type ValueHandler = (value: unknown, op: Mod, warnings: string[]) => unknown;
type RecordHandler = (target: Mod, op: Mod, warnings: string[]) => void;

export const identityKey = (name: string, source: string) => `${name.toLowerCase()}|${source.toLowerCase()}`;

const recordOf = (value: unknown): Mod => (isRecord(value) ? value : {});

const itemsOf = (op: Mod) => (op.items === undefined ? [] : asArray(Array.isArray(op.items) ? op.items : [op.items]));

const nameOf = (item: unknown) => (isRecord(item) ? asString(item.name) : undefined);

const namesOf = (op: Mod) => (typeof op.names === 'string' ? [op.names] : stringsOf(op.names));

const hasNamed = (list: unknown[], name: unknown) => list.some((item) => nameOf(item) === name);

const replaceNamed = (list: unknown[], name: unknown, items: unknown[]) => {
  const index = list.findIndex((item) => nameOf(item) === name);
  return index === -1 ? list : [...list.slice(0, index), ...items, ...list.slice(index + 1)];
};

const mapStrings = (value: unknown, transform: (text: string) => string): unknown => {
  if (typeof value === 'string') return transform(value);
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, transform));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, key === 'name' ? item : mapStrings(item, transform)])
    );
  }
  return value;
};

const spellNameOf = (text: string) => plainTextOf(text).toLowerCase();

const removeSpellNames = (value: unknown, names: string[]): unknown => {
  if (Array.isArray(value)) {
    return value
      .filter((item) => !(typeof item === 'string' && names.includes(spellNameOf(item))))
      .map((item) => removeSpellNames(item, names));
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, removeSpellNames(item, names)]));
  }
  return value;
};

const shiftTag = (text: string, tag: string, scalar: number) =>
  text.replace(
    new RegExp(`\\{@${tag} (-?\\d+)\\}`, 'g'),
    (_match, digits: string) => `{@${tag} ${Number(digits) + scalar}}`
  );

// 5etools always replaces globally; extra flags (usually "i") are added on top
const replaceFlags = (flags: string | undefined) => `g${(flags ?? '').replace(/g/g, '')}`;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const toRegExp = (op: Mod, warnings: string[]) => {
  const source = asString(op.replace);
  if (source === undefined) return undefined;
  try {
    return new RegExp(source, replaceFlags(asString(op.flags)));
  } catch {
    warnings.push(`Invalid replaceTxt pattern ${source}`);
    return undefined;
  }
};

const scaleXp = (value: unknown, op: Mod) => {
  const record = isRecord(value) ? value : { cr: value };
  const cr = crToNumber(asString(record.cr) ?? '');
  const xp = asNumber(record.xp) ?? (cr === null ? undefined : crToXp(cr));
  if (xp === undefined) return value;
  return { ...record, xp: Math.round(xp * (asNumber(op.scalar) ?? 1)) };
};

const capSize = (value: unknown, op: Mod) => {
  const maxIndex = SIZE_ORDER.indexOf(asString(op.max) ?? '');
  if (maxIndex === -1) return value;
  return stringsOf(value).map((code) => (SIZE_ORDER.indexOf(code) > maxIndex ? SIZE_ORDER[maxIndex] : code));
};

const VALUE_MODS: Record<string, ValueHandler> = {
  replaceTxt: (value, op, warnings) => {
    const pattern = toRegExp(op, warnings);
    return pattern ? mapStrings(value, (text) => text.replace(pattern, asString(op.with) ?? '')) : value;
  },
  scalarAddHit: (value, op) => mapStrings(value, (text) => shiftTag(text, 'hit', asNumber(op.scalar) ?? 0)),
  scalarAddDc: (value, op) => mapStrings(value, (text) => shiftTag(text, 'dc', asNumber(op.scalar) ?? 0)),
  appendArr: (value, op) => [...asArray(value), ...itemsOf(op)],
  prependArr: (value, op) => [...itemsOf(op), ...asArray(value)],
  insertArr: (value, op) => {
    const list = asArray(value);
    const index = asNumber(op.index) ?? list.length;
    return [...list.slice(0, index), ...itemsOf(op), ...list.slice(index)];
  },
  replaceArr: (value, op, warnings) => {
    const list = asArray(value);
    if (!hasNamed(list, op.replace)) warnings.push(`replaceArr target ${String(op.replace)} not found`);
    return replaceNamed(list, op.replace, itemsOf(op));
  },
  replaceOrAppendArr: (value, op) => {
    const list = asArray(value);
    return hasNamed(list, op.replace) ? replaceNamed(list, op.replace, itemsOf(op)) : [...list, ...itemsOf(op)];
  },
  removeArr: (value, op) => {
    const names = namesOf(op);
    return asArray(value).filter((item) => !names.includes(nameOf(item) ?? ''));
  },
  appendIfNotExistsArr: (value, op) => {
    const list = asArray(value);
    const fresh = itemsOf(op).filter((item) => !hasNamed(list, nameOf(item)));
    return [...list, ...fresh];
  },
  scalarMultXp: scaleXp,
  maxSize: capSize
};

const RECORD_MODS: Record<string, RecordHandler> = {
  addSkills: (target, op) => {
    target.skill = { ...recordOf(target.skill), ...recordOf(op.skills) };
  },
  addSaves: (target, op) => {
    target.save = { ...recordOf(target.save), ...recordOf(op.saves) };
  },
  addSenses: (target, op) => {
    target.senses = [...stringsOf(target.senses), ...stringsOf(op.senses)];
  },
  addSpells: (target, op, warnings) => {
    const caster = recordsOf(target.spellcasting)[0];
    if (!caster) {
      warnings.push('addSpells without spellcasting');
      return;
    }
    const levels = recordOf(caster.spells);
    for (const [level, added] of Object.entries(recordOf(op.spells))) {
      const existing = recordOf(levels[level]);
      const addedRecord = recordOf(added);
      levels[level] = {
        ...existing,
        ...addedRecord,
        spells: [...stringsOf(existing.spells), ...stringsOf(addedRecord.spells)]
      };
    }
    caster.spells = levels;
  },
  replaceSpells: (target, op) => {
    const from = asString(op.replace)?.toLowerCase();
    const to = asString(op.with);
    if (!from || !to) return;
    target.spellcasting = mapStrings(target.spellcasting, (text) => (spellNameOf(text) === from ? to : text));
  },
  removeSpells: (target, op) => {
    target.spellcasting = removeSpellNames(
      target.spellcasting,
      namesOf(op).map((name) => name.toLowerCase())
    );
  }
};

const propKeys = (target: Mod, prop: string) =>
  prop === '*' ? ENTRY_LIST_KEYS.filter((key) => target[key] !== undefined) : [prop];

export const applyMod = (target: Mod, prop: string, op: Mod, warnings: string[]) => {
  const mode = asString(op.mode) ?? '';
  const valueHandler = lookup(VALUE_MODS, mode);
  if (valueHandler) {
    for (const key of propKeys(target, prop)) target[key] = valueHandler(target[key], op, warnings);
    return;
  }
  const recordHandler = lookup(RECORD_MODS, mode);
  if (recordHandler) {
    recordHandler(target, op, warnings);
    return;
  }
  warnings.push(`Unsupported _mod mode ${mode || '(none)'}`);
};

export type CopyOptions = {
  /** Untrusted (uploaded) data: replaceTxt patterns are matched as literal text, never as regexes */
  literalReplaceTxt?: boolean;
};

const safeOp = (op: Mod, options: CopyOptions): Mod => {
  if (!options.literalReplaceTxt || op.mode !== 'replaceTxt' || typeof op.replace !== 'string') return op;
  return { ...op, replace: escapeRegExp(op.replace) };
};

const applyModsFor = (target: Mod, mods: unknown, warnings: string[], options: CopyOptions) => {
  for (const [prop, ops] of Object.entries(recordOf(mods))) {
    if (prop.startsWith('_')) {
      warnings.push(`Unsupported _mod target ${prop}`);
      continue;
    }
    for (const op of Array.isArray(ops) ? ops : [ops]) {
      if (isRecord(op)) applyMod(target, prop, safeOp(op, options), warnings);
    }
  }
};

export const applyCopy = (
  record: RawMonster,
  index: Map<string, RawMonster>,
  options: CopyOptions = {},
  depth = 0
): { record: RawMonster; warnings: string[] } => {
  const { _copy: copy, ...own } = record;
  const ownWarnings = own._appendCopy === undefined ? [] : ['_appendCopy is not supported'];
  if (!isRecord(copy)) return { record, warnings: ownWarnings };
  if (copy._trait !== undefined) ownWarnings.push('_copy._trait templates are not supported');
  if (depth > MAX_COPY_DEPTH) {
    return { record: own as RawMonster, warnings: [...ownWarnings, '_copy chain is too deep'] };
  }

  const baseName = asString(copy.name) ?? '';
  const baseSource = asString(copy.source) ?? '';
  const base = index.get(identityKey(baseName, baseSource));
  if (!base) {
    return {
      record: own as RawMonster,
      warnings: [...ownWarnings, `Missing base monster ${baseName} (${baseSource})`]
    };
  }

  const resolved = applyCopy(base, index, options, depth + 1);
  const target: Mod = structuredClone(resolved.record);
  const preserved = recordOf(copy._preserve);
  for (const key of COPY_ONLY_KEYS) {
    if (!Object.hasOwn(preserved, key)) delete target[key];
  }
  delete target._versions;
  Object.assign(target, own);
  const warnings = [...ownWarnings, ...resolved.warnings];
  applyModsFor(target, copy._mod, warnings, options);
  return { record: target as RawMonster, warnings };
};
