import { SPELLS, type RadialMenuItemProps } from '@tableslayer/stage';
import { describe, expect, it } from 'vitest';
import {
  EDITOR_NO_CASTER_HINT,
  parseSpellItemId,
  slotLevelItems,
  SPELL_MENU_ROOT_ID,
  spellFxToPrewarm,
  spellItemId,
  spellMenuItem,
  spellsAtSlot,
  type SpellMenuState
} from './spellMenus';

const state: SpellMenuState = {
  ruleset: 'dnd5e-2024',
  recent: [],
  hasCaster: false,
  noCasterHint: EDITOR_NO_CASTER_HINT
};

const find = (items: RadialMenuItemProps[] | undefined, id: string) => items?.find((item) => item.id === id);
const ids = (items: RadialMenuItemProps[] | undefined) => items?.map((item) => item.id);

const findDeep = (items: RadialMenuItemProps[] | undefined, id: string): RadialMenuItemProps | undefined => {
  for (const item of items ?? []) {
    if (item.id === id) return item;
    const found = item.id.startsWith('spell:') ? undefined : findDeep(item.submenu, id);
    if (found) return found;
  }
  return undefined;
};
const slotRing = (menuState: SpellMenuState, slot: number) =>
  find(spellMenuItem(menuState).submenu, `spell-slot:${slot}`)!;
const leaves = (items: RadialMenuItemProps[] | undefined): RadialMenuItemProps[] =>
  (items ?? []).flatMap((item) => (item.id.startsWith('spell:') ? [item] : leaves(item.submenu)));

describe('spellItemId', () => {
  it('round-trips a spell, a summon variant and a slot', () => {
    expect(parseSpellItemId(spellItemId({ spellId: 'fireball' }))).toEqual({ spellId: 'fireball' });
    expect(parseSpellItemId(spellItemId({ spellId: 'find-familiar', variantId: 'owl' }))).toEqual({
      spellId: 'find-familiar',
      variantId: 'owl'
    });
    expect(spellItemId({ spellId: 'find-steed', variantId: 'pony', slotLevel: 4 })).toBe('spell:find-steed:pony@4');
    expect(parseSpellItemId('spell:find-steed:pony@4')).toEqual({
      spellId: 'find-steed',
      variantId: 'pony',
      slotLevel: 4
    });
    expect(parseSpellItemId('spell:fog-cloud@3')).toEqual({ spellId: 'fog-cloud', slotLevel: 3 });
  });

  it('reads old ids without a slot as the base level', () => {
    expect(parseSpellItemId('spell:fireball')).toEqual({ spellId: 'fireball' });
    expect(parseSpellItemId('spell:fireball@x')).toEqual({ spellId: 'fireball' });
  });

  it('ignores other menu items', () => {
    expect(parseSpellItemId('measure-line')).toBeNull();
    expect(parseSpellItemId('spell-category:blast@3')).toBeNull();
    expect(parseSpellItemId('spell-slot:3')).toBeNull();
    expect(parseSpellItemId('spell:')).toBeNull();
  });
});

describe('spellMenuItem', () => {
  it('opens Cantrips and one ring per slot level, without Recent until something was cast', () => {
    const item = spellMenuItem(state);
    expect(item).toMatchObject({ id: SPELL_MENU_ROOT_ID, label: 'Cast spell' });
    expect(ids(item.submenu)).toEqual([
      'spell-slot:0',
      'spell-slot:1',
      'spell-slot:2',
      'spell-slot:3',
      'spell-slot:4',
      'spell-slot:5'
    ]);
    expect(item.submenu!.map((ring) => ring.label)).toEqual([
      'Cantrips',
      'Level I',
      'Level II',
      'Level III',
      'Level IV',
      'Level V'
    ]);
    expect(item.submenu!.map((ring) => ring.iconText)).toEqual([undefined, 'I', 'II', 'III', 'IV', 'V']);
  });

  it('lists the cantrips directly', () => {
    expect(ids(slotRing(state, 0).submenu)).toEqual(['spell:light', 'spell:mage-hand']);
  });

  it('shows every spell up to the slot, and only those, through the non-empty category rings', () => {
    const slots = [1, 2, 3, 4, 5];
    for (const slot of slots) {
      const shown = leaves(slotRing(state, slot).submenu).map((item) => parseSpellItemId(item.id)!.spellId);
      const expected = Object.values(SPELLS)
        .filter((spell) => spell.rulesets.includes(state.ruleset))
        .filter((spell) => {
          const { level } = spell.preset.base;
          return level > 0 && level <= slot;
        })
        .map((spell) => spell.id);
      expect(new Set(shown)).toEqual(new Set(expected));
      expect(shown).toHaveLength(expected.length);
    }
    const firstLevel = slotRing(state, 1).submenu!;
    expect(ids(firstLevel)).not.toContain('spell-category:aura@1');
    expect(ids(find(firstLevel, 'spell-group:target@1')!.submenu)).toEqual([
      'spell-category:target-hold@1',
      'spell-category:target-curse@1',
      'spell-category:target-boon@1'
    ]);
  });

  it('sorts a ring by level, then name', () => {
    const blasts = find(slotRing(state, 3).submenu, 'spell-category:blast@3')!.submenu!;
    expect(ids(blasts)).toEqual([
      'spell:burning-hands@3',
      'spell:color-spray@3',
      'spell:ice-knife@3',
      'spell:thunderwave@3',
      'spell:shatter@3',
      'spell:fireball',
      'spell:lightning-bolt'
    ]);
  });

  it('casts lower spells at the slot and says so in the hub, and names a base-level spell only', () => {
    const fireball = findDeep(slotRing(state, 3).submenu, 'spell:fireball')!;
    expect(fireball).toMatchObject({ label: 'Fireball', accent: '#ff6a1a' });
    expect(fireball.hint).toBeUndefined();
    expect(fireball.submenu).toBeUndefined();
    expect(findDeep(slotRing(state, 5).submenu, 'spell:fireball@5')).toMatchObject({
      label: 'Fireball',
      hint: 'At level V'
    });
  });

  it('keeps every ring at eight or fewer options', () => {
    const check = (items: RadialMenuItemProps[]) => {
      expect(items.length).toBeLessThanOrEqual(8);
      items.forEach((item) => item.submenu && check(item.submenu));
    };
    const recent = Object.keys(SPELLS)
      .slice(0, 8)
      .map((spellId) => ({ spellId }));
    check(spellMenuItem({ ...state, recent }).submenu!);
    check(spellMenuItem({ ...state, recent, ruleset: 'dnd5e-2014' }).submenu!);
  });

  it('does not need a caster for targeted spells but needs one for self effects', () => {
    const auras = find(slotRing(state, 2).submenu, 'spell-category:aura@2')!;
    expect(find(auras.submenu, 'spell:blur')).toMatchObject({ disabled: true });
    expect(findDeep(slotRing(state, 1).submenu, 'spell:bless')?.disabled).toBeUndefined();
  });

  it('lists the spells of the ruleset', () => {
    const obscuring = (ruleset: SpellMenuState['ruleset']) =>
      find(slotRing({ ...state, ruleset }, 3).submenu, 'spell-category:zone-obscure@3')!.submenu!;
    expect(find(obscuring('dnd5e-2014'), 'spell:stinking-cloud')).toBeDefined();
    expect(find(obscuring('dnd5e-2024'), 'spell:stinking-cloud')).toBeUndefined();
  });

  it('opens a variant ring for a summon, carrying the slot', () => {
    const familiar = findDeep(slotRing(state, 1).submenu, 'spell:find-familiar')!;
    expect(familiar.submenu).toHaveLength(8);
    expect(find(familiar.submenu, 'spell:find-familiar:owl')).toMatchObject({ label: 'Owl' });
    expect(find(familiar.submenu, 'spell:find-familiar:lizard')).toBeDefined();
    expect(find(familiar.submenu, 'spell:find-familiar:snake')).toBeUndefined();
    const upcast = findDeep(slotRing(state, 2).submenu, 'spell:find-familiar@2')!;
    expect(find(upcast.submenu, 'spell:find-familiar:owl@2')).toMatchObject({ hint: 'At level II' });
  });
});

describe('slotLevelItems', () => {
  const make = (level: number) => ({ id: `slot-${level}`, label: String(level) });

  it('keeps up to seven slot items beside Recent', () => {
    expect(slotLevelItems([0, 1, 2, 3, 4, 5, 6], make)).toHaveLength(7);
  });

  it('groups the highest levels under one item when they do not fit', () => {
    const items = slotLevelItems([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], make);
    expect(items).toHaveLength(7);
    expect(items.at(-1)).toMatchObject({ id: 'spell-slots:6-9', label: 'Level VI–IX', iconText: 'VI–IX' });
    expect(ids(items.at(-1)!.submenu)).toEqual(['slot-6', 'slot-7', 'slot-8', 'slot-9']);
  });
});

describe('spellsAtSlot', () => {
  it('casts cantrips at slot 0 and every leveled spell up to a slot', () => {
    expect(spellsAtSlot('dnd5e-2024', 0).every((spell) => spell.resolved.level === 0)).toBe(true);
    const third = spellsAtSlot('dnd5e-2024', 3);
    expect(third.every((spell) => spell.resolved.level >= 1 && spell.resolved.level <= 3)).toBe(true);
    expect(third.map((spell) => spell.id)).toContain('fireball');
    expect(third.map((spell) => spell.id)).not.toContain('cone-of-cold');
  });
});

describe('Spirit guardians', () => {
  const guardians = (menuState: SpellMenuState) =>
    find(find(slotRing(menuState, 3).submenu, 'spell-category:aura@3')!.submenu, 'spell:spirit-guardians')!;

  it('is off without a caster and says how to get one', () => {
    expect(guardians(state)).toMatchObject({ disabled: true, hint: EDITOR_NO_CASTER_HINT });
  });

  it('is on with a caster, with no hint', () => {
    const item = guardians({ ...state, hasCaster: true });
    expect(item.disabled).toBeUndefined();
    expect(item.hint).toBeUndefined();
  });

  it('keeps Flaming sphere available without a caster', () => {
    expect(findDeep(slotRing(state, 2).submenu, 'spell:flaming-sphere')!.disabled).toBeUndefined();
  });
});

describe('Recent ring', () => {
  it('comes first once something was cast, newest first, one tap each', () => {
    const item = spellMenuItem({
      ...state,
      recent: [{ spellId: 'fireball' }, { spellId: 'find-familiar', variantId: 'owl' }]
    });
    expect(item.submenu![0]).toMatchObject({ id: 'spell-recent', label: 'Recent' });
    expect(item.submenu!.length).toBeLessThanOrEqual(8);
    const recent = item.submenu![0].submenu!;
    expect(ids(recent)).toEqual(['spell:fireball', 'spell:find-familiar:owl']);
    expect(recent[1]).toMatchObject({ label: 'Find familiar: Owl' });
    expect(recent[1].submenu).toBeUndefined();
  });

  it('casts again at the stored slot, and at base level for old entries', () => {
    const item = spellMenuItem({
      ...state,
      recent: [{ spellId: 'fog-cloud', slotLevel: 3 }, { spellId: 'web' }, { spellId: 'web', slotLevel: 1 }]
    });
    const recent = item.submenu![0].submenu!;
    expect(recent[0]).toMatchObject({ id: 'spell:fog-cloud@3', hint: 'At level III' });
    expect(recent[1].id).toBe('spell:web');
    expect(recent[2].id).toBe('spell:web');
  });

  it('skips spells the ruleset no longer lists and unknown variants', () => {
    const item = spellMenuItem({
      ...state,
      recent: [
        { spellId: 'stinking-cloud' },
        { spellId: 'gone' },
        { spellId: 'find-familiar', variantId: 'snake' },
        { spellId: 'web' }
      ]
    });
    expect(ids(item.submenu![0].submenu)).toEqual(['spell:web']);
  });

  it('is left out when nothing recent can be cast', () => {
    expect(ids(spellMenuItem({ ...state, recent: [{ spellId: 'gone' }] }).submenu)).not.toContain('spell-recent');
  });

  it('disables a recent aura without a caster', () => {
    const item = spellMenuItem({ ...state, recent: [{ spellId: 'spirit-guardians' }] });
    expect(item.submenu![0].submenu![0]).toMatchObject({ disabled: true, hint: EDITOR_NO_CASTER_HINT });
  });
});

describe('area-pick spells in the menu', () => {
  const leaf = (spellId: string, hasCaster: boolean) => findDeep(slotRing({ ...state, hasCaster }, 5).submenu, spellId);

  it('lists them in their rings, and only a cone from the caster needs one', () => {
    expect(leaf('spell:slow@5', false)).toBeDefined();
    expect(leaf('spell:calm-emotions@5', false)?.disabled).toBeUndefined();
    expect(leaf('spell:mass-cure-wounds', false)?.disabled).toBeUndefined();
    expect(leaf('spell:faerie-fire@5', false)?.disabled).toBeUndefined();
    expect(leaf('spell:fear@5', false)).toMatchObject({ disabled: true, hint: EDITOR_NO_CASTER_HINT });
    expect(leaf('spell:fear@5', true)?.disabled).toBeUndefined();
  });
});

describe('spellFxToPrewarm', () => {
  const base = { ruleset: 'dnd5e-2024' as const, recent: [] };

  it('links only the programs of the category ring that opened, at its slot', () => {
    const { cast, token } = spellFxToPrewarm('spell-category:target-hold@5', base);
    expect(cast.sort()).toEqual(['beam', 'zone']);
    expect(token.sort()).toEqual(['calm', 'chains', 'charm', 'clock', 'concentration', 'rift']);
    expect(spellFxToPrewarm('spell-category:target-hold@1', base).token.sort()).toEqual(['charm']);
    expect(spellFxToPrewarm('spell-category:blast@3', base).token).toEqual([]);
  });

  it('links the spells a slot ring lists directly, and nothing for a crowded one', () => {
    const cantrips = spellFxToPrewarm('spell-slot:0', base);
    expect(cantrips.cast.sort()).toEqual(['beam', 'summon']);
    expect(cantrips.token).toEqual(['glow']);
    expect(spellFxToPrewarm('spell-slot:3', base)).toEqual({ cast: [], token: [] });
  });

  it('links the recent spells and one summon, and nothing for the root or a group', () => {
    const recent = [{ spellId: 'hold-person' }, { spellId: 'fireball', slotLevel: 4 }];
    expect(spellFxToPrewarm('spell-recent', { ...base, recent }).cast.sort()).toEqual(['beam', 'burst']);
    expect(spellFxToPrewarm('spell:find-familiar', base).cast).toEqual(['summon']);
    expect(spellFxToPrewarm('spell:find-familiar@3', base).cast).toEqual(['summon']);
    expect(spellFxToPrewarm(SPELL_MENU_ROOT_ID, base)).toEqual({ cast: [], token: [] });
    expect(spellFxToPrewarm('spell-group:target@2', base)).toEqual({ cast: [], token: [] });
  });
});
