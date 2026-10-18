import { inlinesToPlainText, type Inline, type InlineRefType } from '$lib/utils/statBlock';
import { ABILITY_NAMES } from './constants';
import { lookup } from './guards';

const ATTACK_LABELS: Record<string, string> = {
  mw: 'Melee Weapon Attack:',
  rw: 'Ranged Weapon Attack:',
  ms: 'Melee Spell Attack:',
  rs: 'Ranged Spell Attack:',
  'mw,rw': 'Melee or Ranged Weapon Attack:',
  m: 'Melee Attack Roll:',
  r: 'Ranged Attack Roll:',
  'm,r': 'Melee or Ranged Attack Roll:'
};

const EM_LABELS: Record<string, string> = {
  h: 'Hit: ',
  hom: 'Hit or Miss: ',
  actsavefail: 'Failure:',
  actsavesuccess: 'Success:',
  actsavesuccessorfail: 'Failure or Success:',
  acttrigger: 'Trigger:',
  actresponse: 'Response:'
};

const REF_TYPES: InlineRefType[] = ['spell', 'condition', 'item', 'creature', 'skill', 'action', 'status', 'sense'];

const DEFAULT_RECHARGE = 6;

// Pipe segment holding the display text: most tags use the 3rd (name|source|display),
// these keep it elsewhere or have none (the name itself is the display)
const DEFAULT_DISPLAY_SEGMENT = 2;
const DISPLAY_SEGMENTS: Record<string, number> = {
  quickref: 4,
  book: 0,
  adventure: 0,
  filter: 0
};

const text = (value: string): Inline => ({ kind: 'text', text: value });

const parseInteger = (value: string) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const findTagEnd = (input: string, start: number) => {
  let depth = 0;
  for (let index = start; index < input.length; index++) {
    if (input[index] === '{') depth++;
    if (input[index] === '}') {
      depth--;
      if (depth === 0) return index;
    }
  }
  return -1;
};

const splitTopLevel = (body: string) => {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of body) {
    if (char === '{') depth++;
    if (char === '}') depth--;
    if (char === '|' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
};

export const plainTextOf = (value: string) => inlinesToPlainText(parseInlineTags(value));

const abilitySavingThrowLabel = (code: string) => {
  const name = Object.entries(ABILITY_NAMES).find(([, value]) => value === code)?.[0];
  return name ? `${name.charAt(0).toUpperCase()}${name.slice(1)} Saving Throw:` : 'Saving Throw:';
};

const signedDigits = (value: string) => {
  const parsed = parseInteger(value);
  if (parsed === undefined) return '';
  return parsed < 0 ? `${parsed}` : `+${parsed}`;
};

const parseTag = (inner: string): Inline[] => {
  const spaceIndex = inner.indexOf(' ');
  const tag = (spaceIndex === -1 ? inner : inner.slice(0, spaceIndex)).toLowerCase();
  const body = spaceIndex === -1 ? '' : inner.slice(spaceIndex + 1);
  const segments = splitTopLevel(body);
  const first = segments[0] ?? '';
  const display = segments[lookup(DISPLAY_SEGMENTS, tag) ?? DEFAULT_DISPLAY_SEGMENT] || first;

  switch (tag) {
    case 'hit': {
      const bonus = parseInteger(first);
      return bonus === undefined ? [text(first)] : [{ kind: 'hit', bonus }];
    }
    case 'dc': {
      const dc = parseInteger(first);
      return dc === undefined ? [text(first)] : [{ kind: 'dc', dc }];
    }
    case 'damage':
      return [{ kind: 'damage', formula: first }];
    case 'dice':
      return [{ kind: 'dice', formula: first }];
    case 'd20':
      return [{ kind: 'dice', formula: `1d20${signedDigits(first)}` }];
    case 'atk':
    case 'atkr':
      return [{ kind: 'attack', label: lookup(ATTACK_LABELS, first) ?? 'Attack:' }];
    case 'recharge':
      return [{ kind: 'recharge', min: parseInteger(first) ?? DEFAULT_RECHARGE }];
    case 'actsave':
      return [{ kind: 'em', text: abilitySavingThrowLabel(first) }];
    case 'chance':
      return [text(`${first} percent`)];
    case 'b':
    case 'bold':
    case 'i':
    case 'italic':
    case 'note':
      return parseInlineTags(body);
    default:
      break;
  }

  if (REF_TYPES.includes(tag as InlineRefType)) {
    return [{ kind: 'ref', refType: tag as InlineRefType, text: plainTextOf(display) }];
  }
  const emLabel = lookup(EM_LABELS, tag);
  if (emLabel !== undefined) return [{ kind: 'em', text: emLabel }];
  return parseInlineTags(display);
};

const mergeText = (nodes: Inline[]) => {
  const merged: Inline[] = [];
  for (const node of nodes) {
    const previous = merged.at(-1);
    if (node.kind === 'text' && previous?.kind === 'text') {
      previous.text += node.text;
    } else if (!(node.kind === 'text' && node.text === '')) {
      merged.push(node);
    }
  }
  return merged;
};

export const parseInlineTags = (input: string): Inline[] => {
  const nodes: Inline[] = [];
  let cursor = 0;
  while (cursor < input.length) {
    const start = input.indexOf('{@', cursor);
    if (start === -1) {
      nodes.push(text(input.slice(cursor)));
      break;
    }
    nodes.push(text(input.slice(cursor, start)));
    const end = findTagEnd(input, start);
    const inner = end === -1 ? input.slice(start + 2) : input.slice(start + 2, end);
    nodes.push(...parseTag(inner));
    cursor = end === -1 ? input.length : end + 1;
  }
  return mergeText(nodes);
};
