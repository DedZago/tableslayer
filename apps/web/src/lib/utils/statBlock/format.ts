import { parseDiceFormula } from './dice';
import type { Inline, StatBlock } from './types';

const CR_XP = new Map<number, number>([
  [0, 10],
  [0.125, 25],
  [0.25, 50],
  [0.5, 100],
  [1, 200],
  [2, 450],
  [3, 700],
  [4, 1100],
  [5, 1800],
  [6, 2300],
  [7, 2900],
  [8, 3900],
  [9, 5000],
  [10, 5900],
  [11, 7200],
  [12, 8400],
  [13, 10000],
  [14, 11500],
  [15, 13000],
  [16, 15000],
  [17, 18000],
  [18, 20000],
  [19, 22000],
  [20, 25000],
  [21, 33000],
  [22, 41000],
  [23, 50000],
  [24, 62000],
  [25, 75000],
  [26, 90000],
  [27, 105000],
  [28, 120000],
  [29, 135000],
  [30, 155000]
]);

export const formatModifier = (value: number) => (value < 0 ? `−${Math.abs(value)}` : `+${value}`);

export const abilityMod = (score: number) => Math.floor((score - 10) / 2);

export const crToNumber = (cr: string): number | null => {
  const fraction = cr.trim().match(/^(\d+)\/(\d+)$/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const value = Number(cr);
  return cr.trim() !== '' && Number.isFinite(value) ? value : null;
};

export const crToXp = (cr: number) => CR_XP.get(cr);

export const crToProficiency = (cr: number) => (cr < 1 ? 2 : Math.max(2, Math.floor((cr - 1) / 4) + 2));

export const averageDamage = (formula: string) => {
  const { terms, modifier } = parseDiceFormula(formula);
  const diceAverage = terms.reduce((sum, { count, sides }) => sum + (count * (sides + 1)) / 2, 0);
  return Math.floor(diceAverage + modifier);
};

export const formatSpeed = (speed: StatBlock['speed']) =>
  speed
    .map(({ mode, feet, note }) => `${mode === 'walk' ? '' : `${mode} `}${feet} ft.${note ? ` (${note})` : ''}`)
    .join(', ');

const formatRecharge = (min: number) => (min >= 6 ? '(Recharge 6)' : `(Recharge ${min}–6)`);

const formatInline = (inline: Inline): string => {
  switch (inline.kind) {
    case 'text':
    case 'ref':
    case 'em':
      return inline.text;
    case 'hit':
      return formatModifier(inline.bonus);
    case 'damage':
    case 'dice':
      return inline.formula;
    case 'dc':
      return `DC ${inline.dc}`;
    case 'attack':
      return inline.label;
    case 'recharge':
      return formatRecharge(inline.min);
  }
};

export const inlinesToPlainText = (inlines: Inline[]) => inlines.map(formatInline).join('');
