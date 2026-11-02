export interface RecentSpell {
  spellId: string;
  /** Summons: the chosen variant */
  variantId?: string;
}

export const RECENT_SPELLS_KEY = 'tableslayer:recentSpells';
export const RECENT_SPELLS_MAX = 8;

const isRecentSpell = (value: unknown): value is RecentSpell =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as RecentSpell).spellId === 'string' &&
  ((value as RecentSpell).variantId === undefined || typeof (value as RecentSpell).variantId === 'string');

/** The spell moves to the front; casting the same spell and variant again never duplicates it */
export const withRecentSpell = (recent: readonly RecentSpell[], spell: RecentSpell): RecentSpell[] =>
  [spell, ...recent.filter((entry) => entry.spellId !== spell.spellId || entry.variantId !== spell.variantId)].slice(
    0,
    RECENT_SPELLS_MAX
  );

/** Per device; storage can be missing or blocked (private windows, the server), which reads as empty */
export const readRecentSpells = (): RecentSpell[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_SPELLS_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isRecentSpell).slice(0, RECENT_SPELLS_MAX) : [];
  } catch {
    return [];
  }
};

export const writeRecentSpells = (recent: readonly RecentSpell[]) => {
  try {
    localStorage.setItem(RECENT_SPELLS_KEY, JSON.stringify(recent));
  } catch {
    // Recent spells are a convenience; a blocked store just forgets them
  }
};
