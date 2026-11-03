import { describe, expect, it } from 'vitest';
import { MarkerVisibility } from '../components/MarkerLayer/types';
import { StageMode } from '../components/Stage/types';
import type { TokenEffect } from '../components/TokenEffectLayer/types';
import type { TokenEffectKind } from './spells';
import {
  effectStartOnClock,
  groupPlacedByKind,
  isTokenEffectHighlighted,
  isTokenFxOverMarkers,
  LOW_TIER_EFFECT_FPS,
  MAX_TOKEN_EFFECTS_PER_KIND,
  placedEffectsSignature,
  placeTokenEffects,
  REDUCED_MOTION_EFFECT_TIME,
  TOKEN_EFFECT_MAX_AGE_S,
  TOKEN_FX_INDEX,
  TOKEN_FX_LIST,
  tokenEffectClock,
  tokenFxExtent
} from './tokenEffects';

const placement = { cellPx: 100, ftToPx: 20, mode: StageMode.Player, tokensVisible: true };

const marker = (id: string, overrides: Partial<{ x: number; y: number; size: number; visibility: number }> = {}) => ({
  id,
  position: { x: overrides.x ?? 0, y: overrides.y ?? 0 },
  size: overrides.size ?? 1,
  visibility: overrides.visibility ?? MarkerVisibility.Always
});

const effect = (overrides: Partial<TokenEffect> = {}): TokenEffect => ({
  id: 'e1',
  markerId: 'm1',
  fx: 'chains',
  color: '#aab4c8',
  startedAt: 0,
  ...overrides
});

describe('highlight', () => {
  const highlight = { templateIds: new Set(['bless-row']), markerIds: new Set(['cleric']) };

  it('lights an effect by its row id and a concentration seal by its caster', () => {
    expect(isTokenEffectHighlighted(effect({ id: 'bless-row', fx: 'motes' }), highlight)).toBe(true);
    expect(isTokenEffectHighlighted(effect({ id: 'other', fx: 'motes' }), highlight)).toBe(false);
    expect(
      isTokenEffectHighlighted(
        effect({ id: 'concentration:cleric', fx: 'concentration', markerId: 'cleric' }),
        highlight
      )
    ).toBe(true);
    // A token in the highlight lights only its seal, not every effect it carries
    expect(isTokenEffectHighlighted(effect({ id: 'shimmer', fx: 'shimmer', markerId: 'cleric' }), highlight)).toBe(
      false
    );
    expect(isTokenEffectHighlighted(effect({ id: 'bless-row' }), undefined)).toBe(false);
  });

  it('marks placed effects and changes the signature, so the buffers are rewritten', () => {
    const effects = [effect({ id: 'bless-row', fx: 'motes' })];
    const plain = placeTokenEffects(effects, [marker('m1')], placement);
    const lit = placeTokenEffects(effects, [marker('m1')], { ...placement, highlight });
    expect(plain[0].highlighted).toBe(false);
    expect(lit[0].highlighted).toBe(true);
    expect(placedEffectsSignature(lit)).not.toBe(placedEffectsSignature(plain));
  });
});

describe('TOKEN_FX_INDEX', () => {
  it('gives every kind a unique define value', () => {
    expect(new Set(Object.values(TOKEN_FX_INDEX)).size).toBe(TOKEN_FX_LIST.length);
  });

  it('keeps the persisted order append-only', () => {
    expect(TOKEN_FX_LIST).toEqual([
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
      'concentration',
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
    ]);
  });

  it('draws the effects that frame or cloak the token over it and the rest under it', () => {
    const over = TOKEN_FX_LIST.filter(isTokenFxOverMarkers);
    expect(over.sort()).toEqual([
      'blind',
      'chains',
      'charm',
      'clock',
      'concentration',
      'dread',
      'outline',
      'rift',
      'sigil',
      'slumber',
      'veil',
      'ward'
    ]);
  });

  it('gives every kind room for what it draws', () => {
    TOKEN_FX_LIST.forEach((fx) => expect(tokenFxExtent(fx, 3)).toBeGreaterThanOrEqual(1.5));
    expect(tokenFxExtent('orbit', 6)).toBeGreaterThan(6);
    expect(tokenFxExtent('glow', 6)).toBeGreaterThan(12);
    expect(tokenFxExtent('concentration', 0)).toBeGreaterThan(1.5);
  });
});

describe('placeTokenEffects', () => {
  it('follows the marker list, so a dragged token drags its effects', () => {
    const [before] = placeTokenEffects([effect()], [marker('m1', { x: 10, y: 20 })], placement);
    const [after] = placeTokenEffects([effect()], [marker('m1', { x: 140, y: -60 })], placement);
    expect([before.x, before.y]).toEqual([10, 20]);
    expect([after.x, after.y]).toEqual([140, -60]);
  });

  it('drops effects of missing tokens', () => {
    expect(placeTokenEffects([effect({ markerId: 'gone' })], [marker('m1')], placement)).toEqual([]);
  });

  it('drops effects of tokens hidden from this viewer', () => {
    const dmOnly = marker('m1', { visibility: MarkerVisibility.DM });
    expect(placeTokenEffects([effect()], [dmOnly], placement)).toEqual([]);
    expect(placeTokenEffects([effect()], [dmOnly], { ...placement, mode: StageMode.DM })).toHaveLength(1);
    const playerOnly = marker('m1', { visibility: MarkerVisibility.Player });
    expect(placeTokenEffects([effect()], [playerOnly], { ...placement, mode: StageMode.DM })).toEqual([]);
    expect(placeTokenEffects([effect()], [playerOnly], placement)).toHaveLength(1);
  });

  it('draws nothing while the marker layer is hidden', () => {
    expect(placeTokenEffects([effect()], [marker('m1')], { ...placement, tokensVisible: false })).toEqual([]);
  });

  it('sizes effects from the token footprint', () => {
    const [small] = placeTokenEffects([effect()], [marker('m1', { size: 1 })], placement);
    const [large] = placeTokenEffects([effect()], [marker('m1', { size: 2 })], placement);
    expect(small.tokenPx).toBeCloseTo(45);
    expect(large.tokenPx).toBeCloseTo(90);
  });

  it('turns an orbit radius in feet into token radii', () => {
    const [placed] = placeTokenEffects([effect({ fx: 'orbit', radius: 15 })], [marker('m1')], placement);
    expect(placed.orbitRadii).toBeCloseTo((15 * 20) / 45);
    expect(placed.extent).toBeGreaterThan(placed.orbitRadii);
    const [plain] = placeTokenEffects([effect({ fx: 'ward', radius: 15 })], [marker('m1')], placement);
    expect(plain.orbitRadii).toBe(0);
  });

  it('draws nothing when there are no effects', () => {
    expect(placeTokenEffects([], [marker('m1')], placement)).toEqual([]);
  });
});

describe('groupPlacedByKind', () => {
  it('makes one group per kind present and caps each', () => {
    const many = Array.from({ length: MAX_TOKEN_EFFECTS_PER_KIND + 5 }, (_, i) =>
      effect({ id: `w${i}`, fx: 'ward', markerId: 'm1' })
    );
    const placed = placeTokenEffects([...many, effect({ id: 'c', fx: 'chains' })], [marker('m1')], placement);
    const groups = groupPlacedByKind(placed);
    expect([...groups.keys()].sort() as TokenEffectKind[]).toEqual(['chains', 'ward']);
    expect(groups.get('ward')).toHaveLength(MAX_TOKEN_EFFECTS_PER_KIND);
  });
});

describe('placedEffectsSignature', () => {
  it('changes with position and color but not with object identity', () => {
    const a = placeTokenEffects([effect()], [marker('m1')], placement);
    const same = placeTokenEffects([{ ...effect() }], [{ ...marker('m1') }], placement);
    expect(placedEffectsSignature(same)).toBe(placedEffectsSignature(a));
    const moved = placeTokenEffects([effect()], [marker('m1', { x: 5 })], placement);
    expect(placedEffectsSignature(moved)).not.toBe(placedEffectsSignature(a));
    const recolored = placeTokenEffects([effect({ color: '#ff0000' })], [marker('m1')], placement);
    expect(placedEffectsSignature(recolored)).not.toBe(placedEffectsSignature(a));
  });
});

describe('effect clock', () => {
  it('starts an effect at its age on the layer clock, clamped for old ones', () => {
    expect(effectStartOnClock(9_000, 10_000, 50)).toBeCloseTo(49);
    expect(effectStartOnClock(0, 10_000_000, 100)).toBe(100 - TOKEN_EFFECT_MAX_AGE_S);
    expect(effectStartOnClock(20_000, 10_000, 5)).toBe(5);
  });

  it('settles every effect under reduced motion', () => {
    expect(effectStartOnClock(10_000, 10_000, 3, true)).toBe(3 - TOKEN_EFFECT_MAX_AGE_S);
  });

  it('steps the low tier and holds reduced motion still', () => {
    expect(tokenEffectClock(1.04, false, false)).toBe(1.04);
    expect(tokenEffectClock(1.04, true, false)).toBeCloseTo(
      Math.floor(1.04 * LOW_TIER_EFFECT_FPS) / LOW_TIER_EFFECT_FPS
    );
    expect(tokenEffectClock(99, false, true)).toBe(REDUCED_MOTION_EFFECT_TIME);
    expect(tokenEffectClock(99, true, true)).toBe(REDUCED_MOTION_EFFECT_TIME);
  });
});
