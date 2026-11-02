export const RULESETS = ['dnd5e-2014', 'dnd5e-2024'] as const;

export type Ruleset = (typeof RULESETS)[number];

export const DEFAULT_RULESET: Ruleset = 'dnd5e-2024';

export const RULESET_LABELS: Record<Ruleset, string> = {
  'dnd5e-2014': 'D&D 5e (2014)',
  'dnd5e-2024': 'D&D 5e (2024)'
};

export const isRuleset = (value: unknown): value is Ruleset =>
  typeof value === 'string' && (RULESETS as readonly string[]).includes(value);

export type RulesetSpec<T extends object> = { base: T } & Partial<Record<Ruleset, Partial<T>>>;

/** Resolves a value that differs per ruleset: the ruleset's fields shallow-merge over `base` */
export const byRuleset = <T extends object>(spec: RulesetSpec<T>, ruleset: Ruleset): T => ({
  ...spec.base,
  ...spec[ruleset]
});
