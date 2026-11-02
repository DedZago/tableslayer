import { SPELLS, spellsInCategory, type RadialMenuItemProps } from '@tableslayer/stage';
import { describe, expect, it } from 'vitest';
import {
  EDITOR_NO_CASTER_HINT,
  parseSpellItemId,
  SPELL_MENU_ROOT_ID,
  spellFxToPrewarm,
  spellItemId,
  spellMenuItem,
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

describe('spellItemId', () => {
  it('round-trips a spell and a summon variant', () => {
    expect(parseSpellItemId(spellItemId({ spellId: 'fireball' }))).toEqual({ spellId: 'fireball' });
    expect(parseSpellItemId(spellItemId({ spellId: 'find-familiar', variantId: 'owl' }))).toEqual({
      spellId: 'find-familiar',
      variantId: 'owl'
    });
  });

  it('ignores other menu items', () => {
    expect(parseSpellItemId('measure-line')).toBeNull();
    expect(parseSpellItemId('spell-category:blast')).toBeNull();
    expect(parseSpellItemId('spell:')).toBeNull();
  });
});

describe('spellMenuItem', () => {
  it('opens one ring per category, without Recent until something was cast', () => {
    const item = spellMenuItem(state);
    expect(item).toMatchObject({ id: SPELL_MENU_ROOT_ID, label: 'Cast spell' });
    expect(ids(item.submenu)).toEqual([
      'spell-category:blast',
      'spell-category:zone-control',
      'spell-category:zone-obscure',
      'spell-category:zone-magic',
      'spell-category:aura',
      'spell-category:summon',
      'spell-group:target'
    ]);
  });

  it('keeps the top ring within 8 items and nests the targeted categories under one group', () => {
    const withRecent = spellMenuItem({ ...state, recent: [{ spellId: 'fireball' }] });
    expect(withRecent.submenu!.length).toBeLessThanOrEqual(8);
    const group = find(withRecent.submenu, 'spell-group:target')!;
    expect(ids(group.submenu)).toEqual([
      'spell-category:target-hold',
      'spell-category:target-curse',
      'spell-category:target-boon',
      'spell-category:target-enhance'
    ]);
    group.submenu!.forEach((ring) => expect(ring.submenu!.length).toBeLessThanOrEqual(8));
    expect(ids(find(group.submenu, 'spell-category:target-hold')!.submenu)).toContain('spell:hold-person');
  });

  it('does not need a caster for targeted spells but needs one for self effects', () => {
    const aura = find(spellMenuItem(state).submenu, 'spell-category:aura')!;
    expect(find(aura.submenu, 'spell:blur')).toMatchObject({ disabled: true });
    const group = find(spellMenuItem(state).submenu, 'spell-group:target')!;
    const boons = find(group.submenu, 'spell-category:target-boon')!;
    expect(find(boons.submenu, 'spell:bless')?.disabled).toBeUndefined();
  });

  it('lists the spells of the ruleset', () => {
    const obscuring = (ruleset: SpellMenuState['ruleset']) =>
      find(spellMenuItem({ ...state, ruleset }).submenu, 'spell-category:zone-obscure')!.submenu!;
    expect(find(obscuring('dnd5e-2014'), 'spell:stinking-cloud')).toBeDefined();
    expect(find(obscuring('dnd5e-2024'), 'spell:stinking-cloud')).toBeUndefined();
  });

  it('colours each spell with its palette and names it with no hint, so the hub shows just the name', () => {
    const fireball = find(find(spellMenuItem(state).submenu, 'spell-category:blast')!.submenu, 'spell:fireball')!;
    expect(fireball).toMatchObject({ label: 'Fireball', accent: '#ff6a1a' });
    expect(fireball.hint).toBeUndefined();
    expect(fireball.submenu).toBeUndefined();
  });

  it('keeps every ring at eight or fewer options', () => {
    const check = (items: RadialMenuItemProps[]) => {
      expect(items.length).toBeLessThanOrEqual(8);
      items.forEach((item) => item.submenu && check(item.submenu));
    };
    check(
      spellMenuItem({
        ...state,
        recent: Object.keys(SPELLS)
          .slice(0, 8)
          .map((spellId) => ({ spellId }))
      }).submenu!
    );
    check(spellMenuItem({ ...state, ruleset: 'dnd5e-2014' }).submenu!);
  });

  it('opens a variant ring for a summon', () => {
    const summons = find(spellMenuItem(state).submenu, 'spell-category:summon')!.submenu!;
    const familiar = find(summons, 'spell:find-familiar')!;
    expect(familiar.submenu).toHaveLength(8);
    expect(find(familiar.submenu, 'spell:find-familiar:owl')).toMatchObject({ label: 'Owl' });
    expect(find(familiar.submenu, 'spell:find-familiar:lizard')).toBeDefined();
    expect(find(familiar.submenu, 'spell:find-familiar:snake')).toBeUndefined();
  });

  it('puts every spell of a category in its ring', () => {
    const blasts = find(spellMenuItem(state).submenu, 'spell-category:blast')!.submenu!;
    expect(ids(blasts)).toEqual(spellsInCategory('blast', state.ruleset).map((spell) => `spell:${spell.id}`));
  });
});

describe('Spirit guardians', () => {
  const guardians = (menuState: SpellMenuState) =>
    find(find(spellMenuItem(menuState).submenu, 'spell-category:aura')!.submenu, 'spell:spirit-guardians')!;

  it('is off without a caster and says how to get one', () => {
    expect(guardians(state)).toMatchObject({ disabled: true, hint: EDITOR_NO_CASTER_HINT });
  });

  it('is on with a caster, with no hint', () => {
    const item = guardians({ ...state, hasCaster: true });
    expect(item.disabled).toBeUndefined();
    expect(item.hint).toBeUndefined();
  });

  it('keeps Flaming sphere available without a caster', () => {
    const auras = find(spellMenuItem(state).submenu, 'spell-category:aura')!.submenu!;
    expect(find(auras, 'spell:flaming-sphere')!.disabled).toBeUndefined();
  });
});

describe('Recent ring', () => {
  it('comes first once something was cast, newest first, one tap each', () => {
    const item = spellMenuItem({
      ...state,
      recent: [{ spellId: 'fireball' }, { spellId: 'find-familiar', variantId: 'owl' }]
    });
    expect(item.submenu![0]).toMatchObject({ id: 'spell-recent', label: 'Recent' });
    const recent = item.submenu![0].submenu!;
    expect(ids(recent)).toEqual(['spell:fireball', 'spell:find-familiar:owl']);
    expect(recent[1]).toMatchObject({ label: 'Find familiar: Owl' });
    expect(recent[1].submenu).toBeUndefined();
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
  const leaf = (category: string, spellId: string, hasCaster: boolean) => {
    const group = find(spellMenuItem({ ...state, hasCaster }).submenu, 'spell-group:target');
    const ring =
      find(group?.submenu, `spell-category:${category}`) ??
      find(spellMenuItem({ ...state, hasCaster }).submenu, `spell-category:${category}`);
    return find(ring?.submenu, `spell:${spellId}`);
  };

  it('lists them in their rings, each ring within 8, and only a cone from the caster needs one', () => {
    expect(leaf('target-hold', 'slow', false)).toBeDefined();
    expect(leaf('target-hold', 'calm-emotions', false)?.disabled).toBeUndefined();
    expect(leaf('target-boon', 'mass-cure-wounds', false)?.disabled).toBeUndefined();
    expect(leaf('zone-magic', 'faerie-fire', false)?.disabled).toBeUndefined();
    expect(leaf('target-curse', 'fear', false)).toMatchObject({ disabled: true, hint: EDITOR_NO_CASTER_HINT });
    expect(leaf('target-curse', 'fear', true)?.disabled).toBeUndefined();
  });
});

describe('spellFxToPrewarm', () => {
  const base = { ruleset: 'dnd5e-2024' as const, recent: [] };

  it('links only the programs of the category ring that opened', () => {
    const { cast, token } = spellFxToPrewarm('spell-category:target-hold', base);
    expect(cast.sort()).toEqual(['beam', 'zone']);
    expect(token.sort()).toEqual(['calm', 'chains', 'charm', 'clock', 'concentration', 'rift']);
    expect(spellFxToPrewarm('spell-category:blast', base).token).toEqual([]);
  });

  it('links the recent spells and one summon, and nothing for the root or a group', () => {
    const recent = [{ spellId: 'hold-person' }, { spellId: 'fireball' }];
    expect(spellFxToPrewarm('spell-recent', { ...base, recent }).cast.sort()).toEqual(['beam', 'burst']);
    expect(spellFxToPrewarm('spell:find-familiar', base).cast).toEqual(['summon']);
    expect(spellFxToPrewarm(SPELL_MENU_ROOT_ID, base)).toEqual({ cast: [], token: [] });
    expect(spellFxToPrewarm('spell-group:target', base)).toEqual({ cast: [], token: [] });
  });
});
