import type { Ability } from '$lib/utils/statBlock';

export const ABILITY_KEYS: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export const ABILITY_NAMES: Record<string, Ability> = {
  strength: 'str',
  dexterity: 'dex',
  constitution: 'con',
  intelligence: 'int',
  wisdom: 'wis',
  charisma: 'cha'
};

export const SIZE_NAMES: Record<string, string> = {
  T: 'Tiny',
  S: 'Small',
  M: 'Medium',
  L: 'Large',
  H: 'Huge',
  G: 'Gargantuan',
  C: 'Colossal',
  V: 'Varies'
};

export const ALIGNMENT_NAMES: Record<string, string> = {
  L: 'lawful',
  N: 'neutral',
  NX: 'neutral',
  NY: 'neutral',
  C: 'chaotic',
  G: 'good',
  E: 'evil'
};

export const ENTRY_LIST_KEYS = ['trait', 'action', 'bonus', 'reaction', 'legendary', 'mythic'];
