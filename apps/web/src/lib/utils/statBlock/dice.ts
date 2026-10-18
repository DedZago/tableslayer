export type DiceTerm = { count: number; sides: number };

export type ParsedDice = { terms: DiceTerm[]; modifier: number };

export type DiceRoll = { total: number; rolls: number[]; modifier: number; text: string };

const TOKEN_PATTERN = /([+-]?)(\d*)d(\d+)|([+-]?)(\d+)/gi;

const toSign = (value: string) => (value === '-' ? -1 : 1);

export const parseDiceFormula = (formula: string): ParsedDice => {
  const normalized = formula.replace(/\s+/g, '').replace(/−/g, '-');
  const terms: DiceTerm[] = [];
  let modifier = 0;
  for (const match of normalized.matchAll(TOKEN_PATTERN)) {
    if (match[3] !== undefined) {
      const count = match[2] === '' ? 1 : Number(match[2]);
      terms.push({ count: toSign(match[1]) * count, sides: Number(match[3]) });
    } else {
      modifier += toSign(match[4]) * Number(match[5]);
    }
  }
  return { terms, modifier };
};

const formatSignedModifier = (modifier: number) => (modifier < 0 ? `− ${Math.abs(modifier)}` : `+ ${modifier}`);

const rollDie = (sides: number, rng: () => number) => Math.floor(rng() * sides) + 1;

const rollTerm = ({ count, sides }: DiceTerm, rng: () => number) => {
  const sign = count < 0 ? -1 : 1;
  return Array.from({ length: Math.abs(count) }, () => sign * rollDie(sides, rng));
};

export const rollFormula = (formula: string, rng: () => number = Math.random): DiceRoll => {
  const { terms, modifier } = parseDiceFormula(formula);
  const rolls = terms.flatMap((term) => rollTerm(term, rng));
  const total = rolls.reduce((sum, value) => sum + value, modifier);
  const text =
    rolls.length === 0
      ? `${formula} → ${total}`
      : `${formula} → [${rolls.join(', ')}] ${formatSignedModifier(modifier)} = ${total}`;
  return { total, rolls, modifier, text };
};
