import { describe, expect, it } from 'vitest';
import { AMBIENCE_PRESETS, LIGHTING_PRESETS, WEATHER_PRESETS } from '../components/AtmosphereLayer/presets';
import type { AtmosphereSlot } from '../components/AtmosphereLayer/types';
import { AmbienceType, LightingType, WeatherType } from '../components/WeatherLayer/types';
import {
  ATMOSPHERE_CATEGORIES,
  ATMOSPHERE_EFFECTS,
  QUICK_SCENES,
  atmosphereEffectDefinition,
  atmosphereEffectsInCategory
} from './atmosphereEffects';

const SLOTS: AtmosphereSlot[] = ['weather', 'lighting', 'ambience'];
const PRESETS = { weather: WEATHER_PRESETS, lighting: LIGHTING_PRESETS, ambience: AMBIENCE_PRESETS };
const ENUMS = { weather: WeatherType, lighting: LightingType, ambience: AmbienceType };

const enumIds = (slot: AtmosphereSlot) =>
  Object.values(ENUMS[slot]).filter(
    (value): value is number => typeof value === 'number' && value !== 0 && value !== WeatherType.Custom
  );

describe('atmosphere catalog', () => {
  it.each(SLOTS)('lists every %s id exactly once', (slot) => {
    expect(ATMOSPHERE_EFFECTS[slot].map(({ id }) => id).sort((a, b) => a - b)).toEqual(
      enumIds(slot).sort((a, b) => a - b)
    );
  });

  it.each(SLOTS)('has a non-empty preset for every %s id', (slot) => {
    for (const { id } of ATMOSPHERE_EFFECTS[slot]) {
      const preset = PRESETS[slot][id];
      expect(preset, `${slot} ${id}`).toBeDefined();
      expect(Object.keys(preset ?? {}).length, `${slot} ${id}`).toBeGreaterThan(0);
    }
  });

  it.each(SLOTS)('keeps %s labels unique and in sentence case', (slot) => {
    const labels = ATMOSPHERE_EFFECTS[slot].map(({ label }) => label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) expect(label).toMatch(/^[A-Z][a-z0-9 -]*$/);
  });

  it.each(SLOTS)('fits every %s category on one radial ring', (slot) => {
    for (const { id } of ATMOSPHERE_CATEGORIES[slot]) {
      const effects = atmosphereEffectsInCategory(slot, id);
      expect(effects.length).toBeGreaterThan(0);
      expect(effects.length).toBeLessThanOrEqual(8);
    }
    const known = new Set(ATMOSPHERE_CATEGORIES[slot].map(({ id }) => id));
    for (const effect of ATMOSPHERE_EFFECTS[slot]) expect(known.has(effect.category)).toBe(true);
  });

  it('keeps params valid and unique across slots', () => {
    const owner = new Map<string, AtmosphereSlot>();
    for (const slot of SLOTS) {
      for (const effect of ATMOSPHERE_EFFECTS[slot]) {
        expect(effect.params.length).toBeLessThanOrEqual(3);
        for (const param of effect.params) {
          expect(param.min).toBeLessThan(param.max);
          expect(param.step).toBeGreaterThan(0);
          expect(param.default).toBeGreaterThanOrEqual(param.min);
          expect(param.default).toBeLessThanOrEqual(param.max);
          expect(owner.get(param.key) ?? slot).toBe(slot);
          owner.set(param.key, slot);
        }
        expect(new Set(effect.params.map(({ key }) => key)).size).toBe(effect.params.length);
      }
    }
  });

  it('has a preset for every phase 1 id and none for unknown ones', () => {
    for (const slot of SLOTS) {
      for (const effect of ATMOSPHERE_EFFECTS[slot]) {
        if (effect.phase === 1) expect(PRESETS[slot][effect.id], `${slot} ${effect.label}`).toBeDefined();
      }
      for (const id of Object.keys(PRESETS[slot])) {
        expect(atmosphereEffectDefinition(slot, Number(id)), `${slot} ${id}`).toBeDefined();
      }
    }
  });

  it('only binds params that its effect declares', () => {
    for (const slot of SLOTS) {
      for (const effect of ATMOSPHERE_EFFECTS[slot]) {
        const preset = PRESETS[slot][effect.id];
        if (!preset) continue;
        const keys = new Set(effect.params.map(({ key }) => key));
        const bound = [
          ...(preset.events ?? []).flatMap((event) => [event.rateParam, event.hueParam]),
          preset.lighting?.tintAltParam,
          preset.lighting?.aurora?.hueParam,
          preset.ground?.groundFog?.densityParam,
          preset.ground?.clouds?.coverageParam
        ].filter((key): key is string => key !== undefined);
        for (const key of bound) expect(keys.has(key), `${slot} ${effect.label} binds ${key}`).toBe(true);
      }
    }
  });

  it('has well-formed phase 1 presets', () => {
    const hex = /^#[0-9a-f]{6}$/i;
    for (const slot of SLOTS) {
      for (const [id, preset] of Object.entries(PRESETS[slot])) {
        expect(preset!.particles?.length ?? 0, `${slot} ${id}`).toBeLessThanOrEqual(3);
        for (const particle of preset!.particles ?? []) {
          expect(particle.count).toBeGreaterThan(0);
          expect(particle.size[0]).toBeLessThanOrEqual(particle.size[1]);
          expect(particle.lifetime[0]).toBeLessThanOrEqual(particle.lifetime[1]);
          expect(particle.colorA).toMatch(hex);
          expect(particle.colorB).toMatch(hex);
          expect(particle.alpha).toBeGreaterThan(0);
          expect(particle.alpha).toBeLessThanOrEqual(1);
        }
        if (preset!.lighting) {
          expect(preset!.lighting.tint).toMatch(hex);
          expect(preset!.lighting.darkness).toBeGreaterThanOrEqual(0);
          expect(preset!.lighting.darkness).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('builds quick scenes from known ids', () => {
    expect(new Set(QUICK_SCENES.map(({ id }) => id)).size).toBe(QUICK_SCENES.length);
    for (const scene of QUICK_SCENES) {
      const checks: [AtmosphereSlot, number][] = [
        ['weather', scene.weather],
        ['lighting', scene.lighting],
        ['ambience', scene.ambience]
      ];
      for (const [slot, id] of checks) {
        if (id !== 0) expect(atmosphereEffectDefinition(slot, id), `${scene.label} ${slot}`).toBeDefined();
      }
    }
  });
});
