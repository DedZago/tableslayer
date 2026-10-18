import { averageDamage, inlinesToPlainText, type Ability, type Inline, type StatEntry } from '$lib/utils/statBlock';
import { ABILITY_NAMES } from './constants';
import { parseEntries } from './entries';
import { asString, lookup } from './guards';
import { parseInlineTags } from './tags';

const COST_PATTERN = /\s*\(Costs (\d) Actions\)/;
const ABILITY_WORDS = 'Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma';
const FOLLOWING_SAVE_PATTERN = new RegExp(`^\\s*(${ABILITY_WORDS}) saving throw`, 'i');
const SAVE_LABEL_PATTERN = new RegExp(`^(${ABILITY_WORDS}) Saving Throw:`, 'i');

type Damage = NonNullable<StatEntry['attack']>['damage'][number];

const parseDamage = (paragraph: Inline[]): Damage[] =>
  paragraph.flatMap((inline, index): Damage[] => {
    if (inline.kind !== 'damage') return [];
    const before = paragraph[index - 1];
    const after = paragraph[index + 1];
    const printedAverage = before?.kind === 'text' ? before.text.match(/(\d+) \($/)?.[1] : undefined;
    const type = after?.kind === 'text' ? after.text.match(/\)\s*([a-z]+) damage/i)?.[1] : undefined;
    return [
      {
        formula: inline.formula,
        average: printedAverage ? Number(printedAverage) : averageDamage(inline.formula),
        ...(type ? { type: type.toLowerCase() } : {})
      }
    ];
  });

const parseAttack = (paragraph: Inline[]): StatEntry['attack'] => {
  const attack = paragraph.find((inline) => inline.kind === 'attack');
  if (attack?.kind !== 'attack') return undefined;
  const hit = paragraph.find((inline) => inline.kind === 'hit');
  const plain = inlinesToPlainText(paragraph);
  const reach = plain.match(/reach (\d+) ft\./)?.[1];
  const range = plain.match(/range ([\d/]+) ft\./)?.[1];
  return {
    toHit: hit?.kind === 'hit' ? hit.bonus : 0,
    kind: attack.label,
    ...(reach ? { reach: `${reach} ft.` } : {}),
    ...(range ? { range: `${range} ft.` } : {}),
    damage: parseDamage(paragraph)
  };
};

const abilityFromSaveText = (paragraph: Inline[], dcIndex: number): Ability | undefined => {
  const following = paragraph[dcIndex + 1];
  const followingWord = following?.kind === 'text' ? following.text.match(FOLLOWING_SAVE_PATTERN)?.[1] : undefined;
  const labelWord = paragraph
    .map((inline) => (inline.kind === 'em' ? inline.text.match(SAVE_LABEL_PATTERN)?.[1] : undefined))
    .find(Boolean);
  const word = followingWord ?? labelWord;
  return word ? lookup(ABILITY_NAMES, word.toLowerCase()) : undefined;
};

const parseSave = (paragraph: Inline[]): StatEntry['save'] => {
  const dcIndex = paragraph.findIndex((inline) => inline.kind === 'dc');
  const dc = paragraph[dcIndex];
  if (dc?.kind !== 'dc') return undefined;
  const ability = abilityFromSaveText(paragraph, dcIndex);
  return { dc: dc.dc, ...(ability ? { ability } : {}) };
};

const parseRecharge = (nameInlines: Inline[]) => {
  const recharge = nameInlines.find((inline) => inline.kind === 'recharge');
  return recharge?.kind === 'recharge' ? recharge.min : undefined;
};

export const parseStatEntry = (raw: Record<string, unknown>, warnings: string[]): StatEntry => {
  const rawName = asString(raw.name) ?? '';
  const cost = rawName.match(COST_PATTERN)?.[1];
  const nameInlines = parseInlineTags(rawName.replace(COST_PATTERN, ''));
  const name = inlinesToPlainText(nameInlines.filter((inline) => inline.kind !== 'recharge')).trim();
  const body = parseEntries(raw.entries, warnings);
  const firstParagraph = body[0] ?? [];
  const attack = parseAttack(firstParagraph);
  const save = parseSave(firstParagraph);
  const recharge = parseRecharge(nameInlines);

  return {
    name,
    nameInlines,
    body,
    ...(attack ? { attack } : {}),
    ...(save ? { save } : {}),
    ...(recharge !== undefined ? { recharge } : {}),
    ...(cost ? { cost: Number(cost) } : {})
  };
};
