import type { MarkerCondition } from '../components/MarkerLayer/types';

/** How conditions are organized in the editor picker and the TV radial menu, in display order */
export type ConditionCategory = 'cantAct' | 'senses' | 'mind' | 'movement' | 'debuffs' | 'buffs' | 'actions' | 'life';

export type ConditionCategoryDefinition = {
  id: ConditionCategory | 'custom';
  label: string;
  color: string;
  description: string;
};

export const MARKER_CONDITION_CATEGORIES: ConditionCategoryDefinition[] = [
  {
    id: 'cantAct',
    label: "Can't act",
    color: '#f59e0b',
    description: 'Stunned, paralyzed, asleep or caught off guard.'
  },
  { id: 'senses', label: 'Senses', color: '#94a3b8', description: 'Seeing, hearing and being seen.' },
  { id: 'mind', label: 'Mind', color: '#ec4899', description: 'Charm, fear, turning and transformation.' },
  { id: 'movement', label: 'Movement', color: '#14b8a6', description: 'Held, knocked down or airborne.' },
  { id: 'debuffs', label: 'Debuffs', color: '#ef4444', description: 'Penalties, curses and ongoing harm.' },
  { id: 'buffs', label: 'Buffs', color: '#22c55e', description: 'Help from spells and allies.' },
  { id: 'actions', label: 'Actions', color: '#38bdf8', description: 'What it is doing this round.' },
  { id: 'life', label: 'Life', color: '#be123c', description: 'Bloodied, dying, stable or dead.' },
  { id: 'custom', label: 'Custom', color: '#8b5cf6', description: "Your table's own statuses." }
];

export type ConditionDefinition = {
  label: string;
  abbr: string;
  color: string;
  category: ConditionCategory;
  description: string;
  maxValue?: number;
};

export type ResolvedCondition = {
  label: string;
  abbr: string;
  color: string;
  description: string;
  category: ConditionCategory | 'custom';
};

const CUSTOM_DEFAULT_COLOR = '#8b5cf6';

// Catalog order is display order: badges and pickers sort by it
export const MARKER_CONDITIONS: Record<string, ConditionDefinition> = {
  incapacitated: {
    label: 'Incapacitated',
    abbr: 'In',
    color: '#64748b',
    category: 'cantAct',
    description: 'No actions, bonus actions or reactions. Concentration breaks.'
  },
  stunned: {
    label: 'Stunned',
    abbr: 'St',
    color: '#facc15',
    category: 'cantAct',
    description: 'Incapacitated. Fails Str and Dex saves. Attacks against it have advantage.'
  },
  paralyzed: {
    label: 'Paralyzed',
    abbr: 'Pa',
    color: '#eab308',
    category: 'cantAct',
    description:
      'Incapacitated, speed 0. Fails Str and Dex saves. Attacks against it have advantage; hits within 5 ft are crits.'
  },
  unconscious: {
    label: 'Unconscious',
    abbr: 'Un',
    color: '#1e3a8a',
    category: 'cantAct',
    description: 'Incapacitated, prone, drops what it holds. Fails Str and Dex saves. Hits within 5 ft are crits.'
  },
  petrified: {
    label: 'Petrified',
    abbr: 'Pe',
    color: '#78716c',
    category: 'cantAct',
    description: 'Turned to stone: incapacitated, speed 0, resistant to all damage, immune to poison.'
  },
  surprised: {
    label: 'Surprised',
    abbr: 'Su',
    color: '#fbbf24',
    category: 'cantAct',
    description: 'Caught off guard: disadvantage on initiative, no reactions until its first turn ends.'
  },
  blinded: {
    label: 'Blinded',
    abbr: 'Bl',
    color: '#6b7280',
    category: 'senses',
    description: "Can't see. Attacks against it have advantage; its attacks have disadvantage."
  },
  deafened: {
    label: 'Deafened',
    abbr: 'De',
    color: '#9ca3af',
    category: 'senses',
    description: "Can't hear; fails any check that relies on hearing."
  },
  invisible: {
    label: 'Invisible',
    abbr: 'Iv',
    color: '#a5b4fc',
    category: 'senses',
    description: "Can't be seen. Attacks against it have disadvantage; its attacks have advantage."
  },
  hidden: {
    label: 'Hidden',
    abbr: 'Hd',
    color: '#475569',
    category: 'senses',
    description: 'Unseen and unheard. Attacks against it have disadvantage until it is found.'
  },
  outlined: {
    label: 'Outlined',
    abbr: 'Ou',
    color: '#e879f9',
    category: 'senses',
    description: "Faerie Fire: attacks against it have advantage and it can't benefit from being invisible."
  },
  silenced: {
    label: 'Silenced',
    abbr: 'Si',
    color: '#cbd5e1',
    category: 'senses',
    description: "Can't speak or cast spells with verbal components."
  },
  charmed: {
    label: 'Charmed',
    abbr: 'Ch',
    color: '#ec4899',
    category: 'mind',
    description: "Can't attack or harm the charmer. The charmer has advantage on social checks against it."
  },
  frightened: {
    label: 'Frightened',
    abbr: 'Fr',
    color: '#a855f7',
    category: 'mind',
    description: "Disadvantage on checks and attacks while it can see the source; can't move closer to it."
  },
  turned: {
    label: 'Turned',
    abbr: 'Tu',
    color: '#fde047',
    category: 'mind',
    description: 'Turn Undead: must move away and take no reactions. Ends if it takes damage.'
  },
  polymorphed: {
    label: 'Polymorphed',
    abbr: 'Pm',
    color: '#84cc16',
    category: 'mind',
    description: 'Transformed (Polymorph, Wild Shape): uses the new form until it drops to 0 HP.'
  },
  grappled: {
    label: 'Grappled',
    abbr: 'Gr',
    color: '#d97706',
    category: 'movement',
    description: 'Speed 0. Disadvantage on attacks against anyone other than the grappler.'
  },
  restrained: {
    label: 'Restrained',
    abbr: 'Re',
    color: '#0d9488',
    category: 'movement',
    description: 'Speed 0. Disadvantage on attacks and Dex saves. Attacks against it have advantage.'
  },
  prone: {
    label: 'Prone',
    abbr: 'Pr',
    color: '#b45309',
    category: 'movement',
    description: 'Crawls or stands up. Melee attacks against it have advantage, ranged ones disadvantage.'
  },
  flying: {
    label: 'Flying',
    abbr: 'Fl',
    color: '#7dd3fc',
    category: 'movement',
    description: 'Airborne. Falls if knocked prone or its speed drops to 0.'
  },
  poisoned: {
    label: 'Poisoned',
    abbr: 'Po',
    color: '#22c55e',
    category: 'debuffs',
    description: 'Disadvantage on attack rolls and ability checks.'
  },
  exhaustion: {
    label: 'Exhaustion',
    abbr: 'Ex',
    color: '#92400e',
    category: 'debuffs',
    description: 'Each level: −2 to d20 tests and −5 ft speed. Dies at level 6.',
    maxValue: 6
  },
  baned: {
    label: 'Baned',
    abbr: 'Bn',
    color: '#7f1d1d',
    category: 'debuffs',
    description: 'Bane: −1d4 to attack rolls and saving throws.'
  },
  slowed: {
    label: 'Slowed',
    abbr: 'Sl',
    color: '#60a5fa',
    category: 'debuffs',
    description: 'Slow: −2 AC and Dex saves, half speed, no reactions, one action or bonus action.'
  },
  marked: {
    label: 'Marked',
    abbr: 'Mk',
    color: '#e11d48',
    category: 'debuffs',
    description: "Hunter's Mark or Hex: takes extra damage from whoever marked it."
  },
  burning: {
    label: 'Burning',
    abbr: 'Bu',
    color: '#ea580c',
    category: 'debuffs',
    description: 'Takes fire damage at the start of each turn until put out.'
  },
  cursed: {
    label: 'Cursed',
    abbr: 'Cu',
    color: '#6d28d9',
    category: 'debuffs',
    description: 'Bestow Curse or similar: suffers the penalty the caster chose.'
  },
  reduced: {
    label: 'Reduced',
    abbr: 'Rd',
    color: '#0ea5e9',
    category: 'debuffs',
    description: 'Reduce: one size smaller, disadvantage on Str checks and saves, −1d4 weapon damage.'
  },
  blessed: {
    label: 'Blessed',
    abbr: 'Bs',
    color: '#fde68a',
    category: 'buffs',
    description: 'Bless: +1d4 to attack rolls and saving throws.'
  },
  hasted: {
    label: 'Hasted',
    abbr: 'Ha',
    color: '#f97316',
    category: 'buffs',
    description: 'Haste: +2 AC, advantage on Dex saves, double speed, one extra limited action.'
  },
  inspired: {
    label: 'Inspired',
    abbr: 'Ip',
    color: '#f472b6',
    category: 'buffs',
    description: 'Bardic Inspiration: can add the die to one check, attack or save.'
  },
  shielded: {
    label: 'Shielded',
    abbr: 'Sh',
    color: '#93c5fd',
    category: 'buffs',
    description: 'Shield of Faith: +2 AC.'
  },
  protected: {
    label: 'Protected',
    abbr: 'Pt',
    color: '#fcd34d',
    category: 'buffs',
    description:
      "Protection from Evil and Good: aberrations, fiends, undead and others attack it with disadvantage and can't charm or frighten it."
  },
  sanctuary: {
    label: 'Sanctuary',
    abbr: 'Sa',
    color: '#bae6fd',
    category: 'buffs',
    description: 'Attackers must pass a Wis save or choose another target. Ends if it attacks or casts on a foe.'
  },
  enlarged: {
    label: 'Enlarged',
    abbr: 'En',
    color: '#16a34a',
    category: 'buffs',
    description: 'Enlarge: one size larger, advantage on Str checks and saves, +1d4 weapon damage.'
  },
  concentrating: {
    label: 'Concentrating',
    abbr: 'Co',
    color: '#38bdf8',
    category: 'actions',
    description: 'Holding a spell. Con save (DC 10 or half the damage) whenever it takes damage.'
  },
  raging: {
    label: 'Raging',
    abbr: 'Ra',
    color: '#b91c1c',
    category: 'actions',
    description: 'Resists bludgeoning, piercing and slashing; bonus melee damage; advantage on Str checks and saves.'
  },
  dodging: {
    label: 'Dodging',
    abbr: 'Dg',
    color: '#34d399',
    category: 'actions',
    description: 'Attacks against it have disadvantage; advantage on Dex saves.'
  },
  reacted: {
    label: 'Reaction used',
    abbr: 'Rx',
    color: '#a3a3a3',
    category: 'actions',
    description: 'No reaction left until the start of its next turn.'
  },
  bloodied: {
    label: 'Bloodied',
    abbr: 'Bd',
    color: '#dc2626',
    category: 'life',
    description: 'At or below half its hit points.'
  },
  dying: {
    label: 'Dying',
    abbr: 'Dy',
    color: '#991b1b',
    category: 'life',
    description: 'At 0 HP and making death saving throws.'
  },
  stable: {
    label: 'Stable',
    abbr: 'Sb',
    color: '#4ade80',
    category: 'life',
    description: 'At 0 HP but no longer dying. Regains 1 HP after 1d4 hours.'
  },
  dead: {
    label: 'Dead',
    abbr: '☠',
    color: '#111827',
    category: 'life',
    description: 'Dead. Shown as a skull over the token.'
  }
};

export const MARKER_CONDITION_ORDER: string[] = Object.keys(MARKER_CONDITIONS);

const isCatalogCondition = (condition: MarkerCondition) => MARKER_CONDITION_ORDER.includes(condition.id);

const titleCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();

const resolveCustomCondition = (condition: MarkerCondition): ResolvedCondition => {
  const label = condition.label ?? 'Custom';
  return {
    label,
    abbr: titleCase(label.slice(0, 2)),
    color: condition.color ?? CUSTOM_DEFAULT_COLOR,
    description: 'Custom condition',
    category: 'custom'
  };
};

export const resolveCondition = (condition: MarkerCondition): ResolvedCondition => {
  if (!isCatalogCondition(condition)) return resolveCustomCondition(condition);
  const { label, abbr, color, description, category } = MARKER_CONDITIONS[condition.id];
  return { label, abbr, color, description, category };
};

const catalogRank = (condition: MarkerCondition) => {
  const index = MARKER_CONDITION_ORDER.indexOf(condition.id);
  return index === -1 ? MARKER_CONDITION_ORDER.length : index;
};

const compareConditions = (a: MarkerCondition, b: MarkerCondition) =>
  catalogRank(a) - catalogRank(b) ||
  resolveCondition(a).label.localeCompare(resolveCondition(b).label) ||
  a.id.localeCompare(b.id);

export const sortConditions = (list: MarkerCondition[]): MarkerCondition[] => [...list].sort(compareConditions);

const conditionKey = (condition: MarkerCondition) =>
  [condition.id, condition.value, condition.label, condition.color, condition.dmOnly && 'dm'].filter(Boolean).join(':');

export const conditionsKey = (list: MarkerCondition[]): string => sortConditions(list).map(conditionKey).join('|');

export const toggleCondition = (list: MarkerCondition[], id: string): MarkerCondition[] =>
  list.some((condition) => condition.id === id)
    ? sortConditions(list.filter((condition) => condition.id !== id))
    : sortConditions([...list, { id }]);

/** Catalog ids in one category, in display order */
export const conditionIdsInCategory = (category: ConditionCategory): string[] =>
  MARKER_CONDITION_ORDER.filter((id) => MARKER_CONDITIONS[id].category === category);
