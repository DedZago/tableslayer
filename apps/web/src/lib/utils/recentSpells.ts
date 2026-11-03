export interface RecentSpell {
  spellId: string;
  /** Summons: the chosen variant */
  variantId?: string;
  /** The slot it was cast with, when above the spell's own level */
  slotLevel?: number;
}

export const RECENT_SPELLS_KEY = 'tableslayer:recentSpells';
export const RECENT_SPELLS_MAX = 8;

const isRecentSpell = (value: unknown): value is RecentSpell =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as RecentSpell).spellId === 'string' &&
  ((value as RecentSpell).variantId === undefined || typeof (value as RecentSpell).variantId === 'string') &&
  ((value as RecentSpell).slotLevel === undefined || Number.isInteger((value as RecentSpell).slotLevel));

/** The spell moves to the front; casting the same spell and variant again (at any slot) replaces it */
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
