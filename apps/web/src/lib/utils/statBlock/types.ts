// Client-safe stat block types. Built server-side from 5etools data and stored as JSON
// on assets and markers.

export type Ability = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

export type InlineRefType =
  'spell' | 'condition' | 'item' | 'creature' | 'skill' | 'action' | 'status' | 'sense' | 'other';

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'hit'; bonus: number } // {@hit 5}
  | { kind: 'damage'; formula: string } // {@damage 1d6+3}
  | { kind: 'dice'; formula: string } // {@dice 1d10}, {@d20 +5}
  | { kind: 'dc'; dc: number } // {@dc 13}
  | { kind: 'attack'; label: string } // {@atk mw} → "Melee Weapon Attack:"
  | { kind: 'ref'; refType: InlineRefType; text: string }
  | { kind: 'recharge'; min: number }
  | { kind: 'em'; text: string };

export type StatEntry = {
  name: string;
  nameInlines: Inline[];
  body: Inline[][];
  attack?: {
    toHit: number;
    kind: string;
    reach?: string;
    range?: string;
    damage: { formula: string; average?: number; type?: string }[];
  };
  save?: { dc: number; ability?: Ability };
  recharge?: number;
  cost?: number;
};

export type StatSpellcasting = {
  name: string;
  header: Inline[][];
  displayAs: 'trait' | 'action' | 'bonus' | 'reaction' | 'legendary';
  dc?: number;
  toHit?: number;
  ability?: Ability;
  groups: { label: string; slots?: number; spells: string[] }[];
  footer: Inline[][];
};

export type SpeedMode = 'walk' | 'fly' | 'swim' | 'climb' | 'burrow';

export type StatBlock = {
  version: 1;
  source: { provider: '5etools'; name: string; source: string; page?: number; adapterVersion: string };
  name: string;
  size: string[];
  type: string;
  alignment: string;
  ac: { value: number; note?: string }[];
  hp: { average: number | null; formula?: string; note?: string };
  speed: { mode: SpeedMode; feet: number; note?: string }[];
  canHover?: boolean;
  abilities: Record<Ability, { score: number; mod: number; save?: number }>;
  skills: { name: string; bonus: string }[];
  senses: string[];
  passive?: number;
  languages: string[];
  cr: { display: string; value: number; xp?: number; pb: number; lair?: string };
  initiative?: number;
  vulnerable: string[];
  resist: string[];
  immune: string[];
  conditionImmune: string[];
  traits: StatEntry[];
  actions: StatEntry[];
  bonusActions: StatEntry[];
  reactions: StatEntry[];
  legendary: StatEntry[];
  legendaryHeader?: Inline[][];
  legendaryCount?: number;
  mythic: StatEntry[];
  spellcasting: StatSpellcasting[];
  warnings: string[];
};
