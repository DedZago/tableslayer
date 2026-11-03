import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readRecentSpells,
  RECENT_SPELLS_KEY,
  RECENT_SPELLS_MAX,
  withRecentSpell,
  writeRecentSpells
} from './recentSpells';

const stubStorage = (store: Record<string, string> = {}) => {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    }
  });
  return store;
};

afterEach(() => vi.unstubAllGlobals());

describe('withRecentSpell', () => {
  it('moves a repeated spell to the front without duplicating it', () => {
    const recent = withRecentSpell([{ spellId: 'a' }, { spellId: 'b' }], { spellId: 'b' });
    expect(recent).toEqual([{ spellId: 'b' }, { spellId: 'a' }]);
  });

  it('keeps summon variants apart', () => {
    const recent = withRecentSpell([{ spellId: 'find-familiar', variantId: 'owl' }], {
      spellId: 'find-familiar',
      variantId: 'cat'
    });
    expect(recent).toHaveLength(2);
  });

  it('replaces a spell cast again at another slot, keeping the newest slot', () => {
    const recent = withRecentSpell([{ spellId: 'fog-cloud' }, { spellId: 'web' }], {
      spellId: 'fog-cloud',
      slotLevel: 3
    });
    expect(recent).toEqual([{ spellId: 'fog-cloud', slotLevel: 3 }, { spellId: 'web' }]);
  });

  it('keeps at most eight', () => {
    const many = Array.from({ length: RECENT_SPELLS_MAX }, (_, index) => ({ spellId: `s${index}` }));
    const recent = withRecentSpell(many, { spellId: 'new' });
    expect(recent).toHaveLength(RECENT_SPELLS_MAX);
    expect(recent[0]).toEqual({ spellId: 'new' });
  });
});

describe('recent spells storage', () => {
  it('round-trips through localStorage', () => {
    const store = stubStorage();
    writeRecentSpells([{ spellId: 'fireball' }, { spellId: 'find-steed', variantId: 'pony' }]);
    expect(JSON.parse(store[RECENT_SPELLS_KEY])).toHaveLength(2);
    expect(readRecentSpells()).toEqual([{ spellId: 'fireball' }, { spellId: 'find-steed', variantId: 'pony' }]);
  });

  it('drops malformed entries and survives corrupt data', () => {
    stubStorage({ [RECENT_SPELLS_KEY]: JSON.stringify([{ spellId: 'web' }, 4, { spellId: 7 }, null]) });
    expect(readRecentSpells()).toEqual([{ spellId: 'web' }]);
    stubStorage({
      [RECENT_SPELLS_KEY]: JSON.stringify([
        { spellId: 'fog-cloud', slotLevel: 3 },
        { spellId: 'web', slotLevel: '3' }
      ])
    });
    expect(readRecentSpells()).toEqual([{ spellId: 'fog-cloud', slotLevel: 3 }]);
    stubStorage({ [RECENT_SPELLS_KEY]: '{not json' });
    expect(readRecentSpells()).toEqual([]);
  });

  it('reads as empty and ignores writes when storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      }
    });
    expect(readRecentSpells()).toEqual([]);
    expect(() => writeRecentSpells([{ spellId: 'web' }])).not.toThrow();
  });
});
