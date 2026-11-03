import { describe, expect, it } from 'vitest';
import { AoeEffect, AoeShape } from '../components/AoeTemplateLayer/types';
import { RULESETS } from './rulesets';
import { SPELL_FX_INDEX } from './spellCasts';
import {
  INSTANT_FADE_MS,
  instantTemplateExpiresAt,
  isEffectOnlyPreset,
  resolveSpell,
  resolveSpellAnyRuleset,
  resolveSpellAtSlot,
  resolveSummonSize,
  SPELL_CATEGORIES,
  SPELL_CATEGORY_GROUPS,
  spellAreaAtSlot,
  spellFxKinds,
  SPELLS,
  spellsInCategory,
  type SpellCastFx,
  type TokenFx
} from './spells';
import { TOKEN_FX_INDEX } from './tokenEffects';

const CAST_FX: SpellCastFx[] = ['burst', 'cone', 'bolt', 'wave', 'zone', 'aura', 'summon', 'rain', 'beam'];
const TOKEN_FXS: TokenFx[] = [
  'orbit',
  'glow',
  'shimmer',
  'ghosts',
  'ward',
  'chains',
  'motes',
  'haze',
  'sigil',
  'rift',
  'charm',
  'clock',
  'streaks',
  'halo',
  'veil',
  'wind',
  'blind',
  'calm',
  'heal',
  'trance',
  'outline',
  'dread',
  'slumber'
];
const SHAPES = Object.values(AoeShape);
const HEX = /^#[0-9a-f]{6}$/i;

describe('SPELLS', () => {
  it('keys every spell by its own unique, kebab-case id', () => {
    for (const [key, spell] of Object.entries(SPELLS)) {
      expect(spell.id).toBe(key);
      expect(key).toMatch(/^[a-z]+(-[a-z]+)*$/);
    }
    expect(new Set(Object.values(SPELLS).map((spell) => spell.name)).size).toBe(Object.keys(SPELLS).length);
  });

  it('uses sentence case names', () => {
    for (const spell of Object.values(SPELLS)) {
      expect(spell.name).toMatch(/^[A-Z]/);
      expect(spell.name.slice(1).replace('Hadar', '')).not.toMatch(/[A-Z]/);
    }
  });

  it('resolves every spell in each ruleset that lists it', () => {
    for (const spell of Object.values(SPELLS)) {
      expect(spell.rulesets.length).toBeGreaterThan(0);
      for (const ruleset of spell.rulesets) {
        const resolved = resolveSpell(spell.id, ruleset);
        expect(resolved?.resolved).toBeDefined();
      }
    }
  });

  it('resolves to valid areas, effects, colors and cast fx', () => {
    for (const spell of Object.values(SPELLS)) {
      for (const ruleset of spell.rulesets) {
        const { resolved } = resolveSpell(spell.id, ruleset)!;
        const where = `${spell.id} (${ruleset})`;
        expect(AoeEffect[resolved.effect], where).toBeDefined();
        expect(resolved.color, where).toMatch(HEX);
        expect(CAST_FX, where).toContain(resolved.cast.fx);
        expect(resolved.cast.durationMs, where).toBeGreaterThanOrEqual(1000);
        expect(resolved.cast.durationMs, where).toBeLessThanOrEqual(2500);
        expect(resolved.cast.palette, where).toHaveLength(2);
        resolved.cast.palette.forEach((color) => expect(color, where).toMatch(HEX));
        expect(resolved.hint.length, where).toBeGreaterThan(0);
        expect(resolved.level, where).toBeGreaterThanOrEqual(0);
        expect(resolved.rangeFt, where).toBeGreaterThanOrEqual(0);
        if (resolved.area) {
          expect(SHAPES, where).toContain(resolved.area.shape);
          expect(resolved.area.size, where).toBeGreaterThan(0);
          if (resolved.area.shape === AoeShape.Line) expect(resolved.area.width, where).toBeGreaterThan(0);
        } else {
          expect(resolved.summon ?? resolved.tokenFx, where).toBeDefined();
        }
      }
    }
  });

  it('starts self-range areas at the caster and ranged ones at a point', () => {
    for (const spell of Object.values(SPELLS)) {
      for (const ruleset of spell.rulesets) {
        const { resolved } = resolveSpell(spell.id, ruleset)!;
        if (resolved.area && resolved.rangeFt === 0) expect(resolved.origin, spell.id).toBe('caster');
        if (resolved.rangeFt > 0) expect(resolved.origin, spell.id).toBe('point');
      }
    }
  });

  it('anchors only spells that follow a token: auras, the flaming sphere and token effects', () => {
    for (const spell of Object.values(SPELLS)) {
      const { resolved } = resolveSpell(spell.id, spell.rulesets[0])!;
      expect(resolved.anchored, spell.id).toBe(!!resolved.tokenFx || spell.id === 'flaming-sphere');
    }
  });

  it('gives every summon variants with art ids and a token size', () => {
    for (const spell of Object.values(SPELLS)) {
      for (const ruleset of spell.rulesets) {
        const { summon } = resolveSpell(spell.id, ruleset)!.resolved;
        if (!summon) continue;
        expect(summon.variants.length, spell.id).toBeGreaterThan(0);
        expect(new Set(summon.variants.map((variant) => variant.id)).size, spell.id).toBe(summon.variants.length);
        summon.variants.forEach((variant) => expect(variant.icon, spell.id).toBeTruthy());
      }
    }
  });
});

describe('token effect spells', () => {
  const ids = Object.keys(SPELLS);

  it('resolves every tokenFx and aim spell per ruleset with known effects and at least one target', () => {
    for (const id of ids) {
      for (const ruleset of SPELLS[id].rulesets) {
        const { resolved } = resolveSpell(id, ruleset)!;
        const where = `${id} (${ruleset})`;
        if (resolved.tokenFx) expect(TOKEN_FXS, where).toContain(resolved.tokenFx);
        if (resolved.tokenFx) expect(TOKEN_FX_INDEX[resolved.tokenFx], where).toBeDefined();
        expect(SPELL_FX_INDEX[resolved.cast.fx], where).toBeDefined();
      }
    }
  });

  it('aims target spells at tokens: a range and no area of their own', () => {
    const targeted = ids.filter((id) => resolveSpellAnyRuleset(id)!.resolved.aim === 'target');
    expect(targeted.sort()).toEqual(
      [
        'banishment',
        'bane',
        'bless',
        'charm-person',
        'command',
        'hex',
        'hold-monster',
        'hold-person',
        'hunters-mark',
        'light',
        'protection-from-evil-and-good',
        'shield-of-faith',
        'haste',
        'aid',
        'heroism',
        'invisibility',
        'fly',
        'blindness-deafness'
      ].sort()
    );
    for (const id of targeted) {
      const { resolved } = resolveSpellAnyRuleset(id)!;
      expect(resolved.area, id).toBeUndefined();
      expect(resolved.rangeFt, id).toBeGreaterThan(0);
      expect(resolved.tokenFx, id).toBeDefined();
      expect(resolved.cast.fx, id).toBe('beam');
    }
  });

  it('places an area then picks creatures for the area-pick spells, with effects only', () => {
    const picks = ids.filter((id) => resolveSpellAnyRuleset(id)!.resolved.areaPick);
    expect(picks.sort()).toEqual(
      ['calm-emotions', 'faerie-fire', 'fear', 'hypnotic-pattern', 'mass-cure-wounds', 'sleep', 'slow'].sort()
    );
    for (const id of picks) {
      const { resolved } = resolveSpellAnyRuleset(id)!;
      expect(resolved.area, id).toBeDefined();
      expect(resolved.aim, id).toBeUndefined();
      expect(resolved.tokenFx, id).toBeDefined();
      expect(isEffectOnlyPreset(resolved), id).toBe(true);
    }
    const area = (id: string, ruleset: 'dnd5e-2014' | 'dnd5e-2024' = 'dnd5e-2014') =>
      resolveSpell(id, ruleset)!.resolved;
    expect(area('slow').areaPick).toBe('choose');
    expect(area('hypnotic-pattern').areaPick).toBe('saves');
    expect(area('fear').area).toEqual({ shape: AoeShape.Cone, size: 30 });
    expect(area('fear').origin).toBe('caster');
    expect(area('mass-cure-wounds').lingers).toBe(false);
    expect(area('sleep').area?.size).toBe(20);
    expect(area('sleep').concentration).toBe(false);
    expect(area('sleep', 'dnd5e-2024').area?.size).toBe(5);
    expect(area('sleep', 'dnd5e-2024').concentration).toBe(true);
    expect(area('mass-cure-wounds', 'dnd5e-2024').hint).not.toBe(area('mass-cure-wounds').hint);
  });

  it('casts self effects from the caster with no aiming', () => {
    for (const id of ['blur', 'mirror-image']) {
      const { resolved } = resolveSpellAnyRuleset(id)!;
      expect(resolved.aim).toBeUndefined();
      expect(resolved.rangeFt).toBe(0);
      expect(resolved.origin).toBe('caster');
      expect(isEffectOnlyPreset(resolved)).toBe(true);
    }
  });

  it('keeps the spirit guardians area and adds its orbit', () => {
    const { resolved } = resolveSpell('spirit-guardians', 'dnd5e-2024')!;
    expect(resolved.area).toEqual({ shape: AoeShape.Circle, size: 15 });
    expect(resolved.tokenFx).toBe('orbit');
    expect(isEffectOnlyPreset(resolved)).toBe(false);
    expect(resolved.templateOpacity).toBeLessThan(0.6);
  });

  it('follows the duration rules: command is instant, charm person and light are not concentration', () => {
    expect(resolveSpellAnyRuleset('command')!.resolved.lingers).toBe(false);
    expect(resolveSpellAnyRuleset('charm-person')!.resolved.concentration).toBe(false);
    expect(resolveSpellAnyRuleset('light')!.resolved.concentration).toBe(false);
    expect(resolveSpellAnyRuleset('mirror-image')!.resolved.concentration).toBe(false);
    expect(resolveSpellAnyRuleset('hold-person')!.resolved.concentration).toBe(true);
  });

  it('gives hunters mark the crosshair variant and a per ruleset hint', () => {
    expect(resolveSpellAnyRuleset('hunters-mark')!.resolved.tokenFxVariant).toBe(1);
    expect(resolveSpell('hunters-mark', 'dnd5e-2024')!.resolved.hint).not.toBe(
      resolveSpell('hunters-mark', 'dnd5e-2014')!.resolved.hint
    );
  });

  it('resolves a spell without a ruleset from the first ruleset that lists it', () => {
    expect(resolveSpellAnyRuleset('stinking-cloud')).not.toBeNull();
    expect(resolveSpellAnyRuleset('not-a-spell')).toBeNull();
  });

  it('collects just the cast and token programs a set of spells needs', () => {
    const picks = ['hold-person', 'hunters-mark', 'fireball'].map((id) => resolveSpellAnyRuleset(id)!);
    const kinds = spellFxKinds(picks);
    expect(kinds.cast.sort()).toEqual(['beam', 'burst']);
    expect(kinds.token.sort()).toEqual(['chains', 'concentration', 'sigil']);
  });
});

describe('categories', () => {
  it('lists every spell in exactly one known category', () => {
    const known = SPELL_CATEGORIES.map((category) => category.id);
    for (const spell of Object.values(SPELLS)) expect(known).toContain(spell.category);
  });

  it('keeps every category ring within 8 spells in each ruleset', () => {
    for (const ruleset of RULESETS) {
      for (const category of SPELL_CATEGORIES) {
        expect(spellsInCategory(category.id, ruleset).length, `${category.id} (${ruleset})`).toBeLessThanOrEqual(8);
      }
    }
  });

  it('keeps the top spell ring within 8 items once grouped categories share one item', () => {
    const grouped = new Set(SPELL_CATEGORIES.flatMap((category) => (category.group ? [category.group] : [])));
    const ungrouped = SPELL_CATEGORIES.filter((category) => !category.group);
    const recent = 1;
    expect(ungrouped.length + grouped.size + recent).toBeLessThanOrEqual(8);
    SPELL_CATEGORIES.forEach((category) => {
      if (category.group) expect(SPELL_CATEGORY_GROUPS.map((group) => group.id)).toContain(category.group);
    });
  });

  it('shows every spell of a ruleset in some category', () => {
    for (const ruleset of RULESETS) {
      const listed = SPELL_CATEGORIES.flatMap((category) => spellsInCategory(category.id, ruleset)).map((s) => s.id);
      const expected = Object.values(SPELLS)
        .filter((spell) => spell.rulesets.includes(ruleset))
        .map((spell) => spell.id);
      expect(listed.sort()).toEqual(expected.sort());
    }
  });
});

describe('resolveSpell', () => {
  it('returns null for unknown ids and spells the ruleset does not list', () => {
    expect(resolveSpell('not-a-spell', 'dnd5e-2024')).toBeNull();
    expect(resolveSpell('stinking-cloud', 'dnd5e-2024')).toBeNull();
    expect(resolveSpell('stinking-cloud', 'dnd5e-2014')).not.toBeNull();
  });

  it('applies ruleset overrides over the base preset', () => {
    expect(resolveSpell('thunderwave', 'dnd5e-2014')!.resolved.area).toEqual({ shape: AoeShape.Square, size: 15 });
    expect(resolveSpell('thunderwave', 'dnd5e-2024')!.resolved.area).toEqual({ shape: AoeShape.Circle, size: 15 });
    expect(resolveSpell('sleep', 'dnd5e-2014')!.resolved.area?.size).toBe(20);
    expect(resolveSpell('sleep', 'dnd5e-2024')!.resolved.area?.size).toBe(5);
    expect(resolveSpell('spiritual-weapon', 'dnd5e-2014')!.resolved.concentration).toBe(false);
    expect(resolveSpell('spiritual-weapon', 'dnd5e-2024')!.resolved.concentration).toBe(true);
  });

  it('matches the PHB areas of the headline blasts', () => {
    const area = (id: string) => resolveSpell(id, 'dnd5e-2024')!.resolved.area;
    expect(area('fireball')).toEqual({ shape: AoeShape.Circle, size: 20 });
    expect(area('lightning-bolt')).toEqual({ shape: AoeShape.Line, size: 100, width: 5 });
    expect(area('cone-of-cold')).toEqual({ shape: AoeShape.Cone, size: 60 });
    expect(area('burning-hands')).toEqual({ shape: AoeShape.Cone, size: 15 });
  });

  it('expires instant blasts after the cast and a 3 s fade, rounded up to whole seconds', () => {
    expect(INSTANT_FADE_MS).toBe(3000);
    expect(instantTemplateExpiresAt(1_700_000_000_500, 2200)).toBe(1_700_000_006);
    expect(instantTemplateExpiresAt(1_700_000_000_000, 2000)).toBe(1_700_000_005);
  });

  it('expires instant blasts and lingers zones', () => {
    expect(resolveSpell('fireball', 'dnd5e-2024')!.resolved.lingers).toBe(false);
    expect(resolveSpell('web', 'dnd5e-2024')!.resolved.lingers).toBe(true);
    expect(resolveSpell('spirit-guardians', 'dnd5e-2024')!.resolved.lingers).toBe(true);
  });
});

describe('upcast areas', () => {
  it('grows Fog cloud by 20 ft of radius per slot above 1st in both rulesets', () => {
    for (const ruleset of RULESETS) {
      expect(resolveSpellAtSlot('fog-cloud', ruleset, 3)!.resolved.area).toEqual({ shape: AoeShape.Circle, size: 60 });
      expect(resolveSpellAtSlot('fog-cloud', ruleset, 1)!.resolved.area!.size).toBe(20);
      expect(resolveSpellAtSlot('fog-cloud', ruleset)!.resolved.area!.size).toBe(20);
    }
  });

  it('grows the 2024 Cloud of daggers cube by 5 ft per slot above 2nd, but not the 2014 one', () => {
    expect(resolveSpellAtSlot('cloud-of-daggers', 'dnd5e-2024', 4)!.resolved.area!.size).toBe(15);
    expect(resolveSpellAtSlot('cloud-of-daggers', 'dnd5e-2014', 4)!.resolved.area!.size).toBe(5);
  });

  it('leaves areas that do not grow, and slots at or below the spell level, unchanged', () => {
    const fireball = resolveSpell('fireball', 'dnd5e-2024')!;
    expect(resolveSpellAtSlot('fireball', 'dnd5e-2024', 9)).toEqual(fireball);
    expect(
      spellAreaAtSlot({ level: 3, area: { shape: AoeShape.Circle, size: 20 }, upcast: { sizePerSlot: 10 } }, 2)
    ).toEqual({
      shape: AoeShape.Circle,
      size: 20
    });
    expect(spellAreaAtSlot({ level: 1, upcast: { sizePerSlot: 10 } }, 5)).toBeUndefined();
  });

  it('widens a line by its width step', () => {
    expect(
      spellAreaAtSlot(
        { level: 2, area: { shape: AoeShape.Line, size: 60, width: 5 }, upcast: { sizePerSlot: 10, widthPerSlot: 5 } },
        4
      )
    ).toEqual({ shape: AoeShape.Line, size: 80, width: 15 });
  });

  it('only lists upcast areas on spells that have an area', () => {
    for (const ruleset of RULESETS) {
      Object.keys(SPELLS).forEach((id) => {
        const spell = resolveSpell(id, ruleset);
        if (spell?.resolved.upcast) expect(spell.resolved.area).toBeDefined();
      });
    }
  });
});

describe('resolveSummonSize', () => {
  it('uses the variant size, falling back to the summon size', () => {
    const { summon } = resolveSpell('find-steed', 'dnd5e-2014')!.resolved;
    expect(resolveSummonSize(summon!, 'warhorse')).toBe(2);
    expect(resolveSummonSize(summon!, 'pony')).toBe(1);
    expect(resolveSummonSize(summon!, 'unknown')).toBe(1);
  });
});

describe('spell descriptions and looks', () => {
  it('gives every spell a plain one-line description without numbers', () => {
    for (const [id, spell] of Object.entries(SPELLS)) {
      expect(spell.description, id).toBeTruthy();
      expect(spell.description, id).not.toMatch(/\d/);
      expect(spell.description, id).not.toContain('\n');
    }
  });

  it('gives holds, curses, clouds and voids their own cast variant', () => {
    const variant = (id: string) => resolveSpell(id, 'dnd5e-2024')!.resolved.cast.variant;
    expect(variant('web')).toBe(4);
    expect(variant('fog-cloud')).toBe(5);
    expect(variant('darkness')).toBe(6);
    expect(variant('hold-person')).toBe(1);
    expect(variant('hex')).toBe(2);
    expect(variant('moonbeam')).toBe(2);
    expect(resolveSpell('hold-monster', 'dnd5e-2024')!.resolved.tokenFxVariant).toBe(1);
  });
});
