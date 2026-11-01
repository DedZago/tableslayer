import { describe, expect, it } from 'vitest';
import { AnnotationEffect, AnnotationEffectDefaults } from '../components/AnnotationLayer/types';
import {
  ANNOTATION_EFFECT_CATEGORIES,
  ANNOTATION_EFFECTS,
  annotationEffectDefinition,
  annotationEffectsInCategory
} from './annotationEffects';

const allEffects = Object.values(AnnotationEffect).filter(
  (value): value is AnnotationEffect => typeof value === 'number' && value !== AnnotationEffect.None
);

describe('annotation effect catalog', () => {
  it('lists every effect exactly once', () => {
    expect(ANNOTATION_EFFECTS.map(({ effect }) => effect).sort((a, b) => a - b)).toEqual(
      [...allEffects].sort((a, b) => a - b)
    );
  });

  it('has defaults for every effect', () => {
    for (const effect of allEffects) expect(AnnotationEffectDefaults[effect]).toBeDefined();
  });

  it('keeps labels unique and categories small enough for one radial ring', () => {
    expect(new Set(ANNOTATION_EFFECTS.map(({ label }) => label)).size).toBe(ANNOTATION_EFFECTS.length);
    for (const { id } of ANNOTATION_EFFECT_CATEGORIES) {
      const effects = annotationEffectsInCategory(id);
      expect(effects.length).toBeGreaterThan(0);
      expect(effects.length).toBeLessThanOrEqual(6);
    }
  });

  it('looks up an effect definition', () => {
    expect(annotationEffectDefinition(AnnotationEffect.Lava)).toMatchObject({ label: 'Lava', category: 'elements' });
    expect(annotationEffectDefinition(AnnotationEffect.None)).toBeUndefined();
  });
});
