import type { MarkerCondition } from '../components/MarkerLayer/types';

export type ConditionGroup = 'condition' | 'combat';

export type ConditionDefinition = {
  label: string;
  abbr: string;
  color: string;
  group: ConditionGroup;
  description: string;
  maxValue?: number;
};

export type ResolvedCondition = {
  label: string;
  abbr: string;
  color: string;
  description: string;
  group: ConditionGroup | 'custom';
};

const CUSTOM_DEFAULT_COLOR = '#8b5cf6';

export const MARKER_CONDITIONS: Record<string, ConditionDefinition> = {
  blinded: {
    label: 'Blinded',
    abbr: 'Bl',
    color: '#6b7280',
    group: 'condition',
    description: "Can't see; auto-fails sight checks. Attacks against have advantage; its attacks have disadvantage."
  },
  charmed: {
    label: 'Charmed',
    abbr: 'Ch',
    color: '#ec4899',
    group: 'condition',
    description: "Can't attack the charmer or target them with harmful effects. Charmer has advantage on social checks."
  },
  deafened: {
    label: 'Deafened',
    abbr: 'De',
    color: '#9ca3af',
    group: 'condition',
    description: "Can't hear; auto-fails hearing checks."
  },
  exhaustion: {
    label: 'Exhaustion',
    abbr: 'Ex',
    color: '#92400e',
    group: 'condition',
    description: 'Each level: −2 to d20 tests, −5 ft speed. Dies at level 6.',
    maxValue: 6
  },
  frightened: {
    label: 'Frightened',
    abbr: 'Fr',
    color: '#a855f7',
    group: 'condition',
    description: "Disadvantage on checks/attacks while source is in sight; can't willingly move closer."
  },
  grappled: {
    label: 'Grappled',
    abbr: 'Gr',
    color: '#d97706',
    group: 'condition',
    description: 'Speed 0. Disadvantage on attacks against targets other than the grappler.'
  },
  incapacitated: {
    label: 'Incapacitated',
    abbr: 'In',
    color: '#64748b',
    group: 'condition',
    description: 'No actions, bonus actions or reactions. Concentration breaks.'
  },
  invisible: {
    label: 'Invisible',
    abbr: 'Iv',
    color: '#a5b4fc',
    group: 'condition',
    description: "Can't be seen. Attacks against have disadvantage; its attacks have advantage."
  },
  paralyzed: {
    label: 'Paralyzed',
    abbr: 'Pa',
    color: '#eab308',
    group: 'condition',
    description:
      'Incapacitated, speed 0. Fails Str/Dex saves. Attacks against have advantage; hits within 5 ft are crits.'
  },
  petrified: {
    label: 'Petrified',
    abbr: 'Pe',
    color: '#78716c',
    group: 'condition',
    description: 'Turned to stone: incapacitated, speed 0, resistance to all damage, immune to poison.'
  },
  poisoned: {
    label: 'Poisoned',
    abbr: 'Po',
    color: '#22c55e',
    group: 'condition',
    description: 'Disadvantage on attack rolls and ability checks.'
  },
  prone: {
    label: 'Prone',
    abbr: 'Pr',
    color: '#b45309',
    group: 'condition',
    description: 'Crawl only. Disadvantage on attacks. Melee attacks against have advantage, ranged have disadvantage.'
  },
  restrained: {
    label: 'Restrained',
    abbr: 'Re',
    color: '#0d9488',
    group: 'condition',
    description: 'Speed 0. Disadvantage on attacks and Dex saves. Attacks against have advantage.'
  },
  stunned: {
    label: 'Stunned',
    abbr: 'St',
    color: '#facc15',
    group: 'condition',
    description: 'Incapacitated. Fails Str/Dex saves. Attacks against have advantage.'
  },
  unconscious: {
    label: 'Unconscious',
    abbr: 'Un',
    color: '#1e3a8a',
    group: 'condition',
    description: 'Incapacitated, prone, drops items. Fails Str/Dex saves. Hits within 5 ft are crits.'
  },
  concentrating: {
    label: 'Concentrating',
    abbr: 'Co',
    color: '#38bdf8',
    group: 'combat',
    description: 'Maintaining a spell. Con save (DC 10 or half damage) when damaged.'
  },
  bloodied: {
    label: 'Bloodied',
    abbr: 'Bd',
    color: '#dc2626',
    group: 'combat',
    description: 'At or below half hit points.'
  },
  blessed: {
    label: 'Blessed',
    abbr: 'Bs',
    color: '#fde68a',
    group: 'combat',
    description: '+1d4 to attack rolls and saving throws.'
  },
  baned: {
    label: 'Baned',
    abbr: 'Bn',
    color: '#7f1d1d',
    group: 'combat',
    description: '−1d4 to attack rolls and saving throws.'
  },
  hasted: {
    label: 'Hasted',
    abbr: 'Ha',
    color: '#f97316',
    group: 'combat',
    description: '+2 AC, advantage on Dex saves, double speed, one extra limited action.'
  },
  slowed: {
    label: 'Slowed',
    abbr: 'Sl',
    color: '#60a5fa',
    group: 'combat',
    description: '−2 AC and Dex saves, half speed, no reactions, limited actions.'
  },
  dodging: {
    label: 'Dodging',
    abbr: 'Dg',
    color: '#34d399',
    group: 'combat',
    description: 'Attacks against have disadvantage; advantage on Dex saves.'
  },
  hidden: {
    label: 'Hidden',
    abbr: 'Hd',
    color: '#475569',
    group: 'combat',
    description: 'Unseen and unheard; attacks against have disadvantage.'
  },
  raging: {
    label: 'Raging',
    abbr: 'Ra',
    color: '#b91c1c',
    group: 'combat',
    description: 'Resistance to B/P/S damage, bonus melee damage, advantage on Str checks/saves.'
  },
  marked: {
    label: 'Marked',
    abbr: 'Mk',
    color: '#e11d48',
    group: 'combat',
    description: "Hunter's Mark / Hex: extra damage from the marker."
  },
  burning: {
    label: 'Burning',
    abbr: 'Bu',
    color: '#ea580c',
    group: 'combat',
    description: 'Takes fire damage at the start of its turn until extinguished.'
  },
  flying: {
    label: 'Flying',
    abbr: 'Fl',
    color: '#7dd3fc',
    group: 'combat',
    description: 'Airborne. Falls if knocked prone or speed drops to 0.'
  },
  dead: {
    label: 'Dead',
    abbr: '☠',
    color: '#111827',
    group: 'combat',
    description: 'Dead. Rendered as a skull over the token.'
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
    group: 'custom'
  };
};

export const resolveCondition = (condition: MarkerCondition): ResolvedCondition => {
  if (!isCatalogCondition(condition)) return resolveCustomCondition(condition);
  const { label, abbr, color, description, group } = MARKER_CONDITIONS[condition.id];
  return { label, abbr, color, description, group };
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
