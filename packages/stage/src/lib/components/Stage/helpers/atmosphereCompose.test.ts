import { describe, expect, it } from 'vitest';
import { DensityMode } from '../components/AtmosphereLayer/sim/types';
import { AmbienceType, LightingType, WeatherType } from '../components/WeatherLayer/types';
import { composeAtmosphere } from './atmosphereCompose';

const none = { type: 0 };

describe('composeAtmosphere activity', () => {
  it('is inactive with every slot None', () => {
    const composed = composeAtmosphere(none, none, none);
    expect(composed.active).toBe(false);
    expect(composed.featureSignature).toBe('');
    expect(composed.particles).toEqual([]);
    expect(composed.lighting).toBeNull();
    expect(composed.layers).toEqual({ ambienceGround: false, darkness: false, air: false, lightning: false });
  });

  it('treats missing slots, unknown ids and Custom as None', () => {
    for (const type of [999, WeatherType.Custom]) {
      const composed = composeAtmosphere({ type }, undefined, undefined);
      expect(composed.active).toBe(false);
      expect(composed.slots.weather).toEqual({ type: 0, intensity: 0 });
    }
  });

  it('honours an intensity of 0', () => {
    expect(composeAtmosphere({ type: WeatherType.Rain, intensity: 0 }, none, none).active).toBe(false);
    expect(composeAtmosphere({ type: WeatherType.Rain }, none, none).slots.weather).toEqual({
      type: WeatherType.Rain,
      intensity: 1
    });
  });
});

describe('composeAtmosphere merge rules', () => {
  const stormy = composeAtmosphere(
    { type: WeatherType.Thunderstorm },
    { type: LightingType.Night },
    { type: AmbienceType.CloudShadows }
  );

  it('keeps particle populations in slot order and scales them by intensity', () => {
    const half = composeAtmosphere({ type: WeatherType.Rain, intensity: 0.5 }, none, none, { tier: 'high' });
    expect(half.particles).toHaveLength(1);
    expect(half.particles[0].maxCount).toBe(1800);
    expect(half.particles[0].activeCount).toBe(900);
    const mixed = composeAtmosphere(
      { type: WeatherType.Blizzard },
      { type: LightingType.Sunbeams },
      { type: AmbienceType.Underwater }
    );
    expect(mixed.particles.map((p) => p.slot)).toEqual(['weather', 'weather', 'lighting', 'ambience']);
  });

  it('takes the larger darkness and multiplies tints', () => {
    expect(stormy.lighting?.darkness).toBeCloseTo(0.8, 6);
    const night = composeAtmosphere(none, { type: LightingType.Night }, none).lighting!;
    const storm = composeAtmosphere({ type: WeatherType.Thunderstorm }, none, none).lighting!;
    expect(stormy.lighting!.tint[2]).toBeCloseTo(night.tint[2] * storm.tint[2], 6);
    expect(stormy.lighting!.exposure).toBeCloseTo(night.exposure * storm.exposure, 6);
  });

  it('scales darkness and tint with the slot intensity', () => {
    const faint = composeAtmosphere(none, { type: LightingType.Night, intensity: 0.5 }, none).lighting!;
    expect(faint.darkness).toBeCloseTo(0.4, 6);
    const full = composeAtmosphere(none, { type: LightingType.Night }, none).lighting!;
    expect(faint.tint[0]).toBeGreaterThan(full.tint[0]);
  });

  it('mixes the night tint with the moon tint param', () => {
    const base = composeAtmosphere(none, { type: LightingType.Night }, none).lighting!.tint;
    const silver = composeAtmosphere(none, { type: LightingType.Night }, none, {
      settings: { params: { moonTint: 1 } }
    }).lighting!.tint;
    expect(silver[0]).toBeGreaterThan(base[0]);
  });

  it('schedules lightning from the strike rate param, scaled by intensity', () => {
    expect(stormy.events).toEqual([{ kind: 'lightning', ratePerMin: 6, bolts: [1, 2], hueMode: 'none', hue: 0 }]);
    const fast = composeAtmosphere({ type: WeatherType.Thunderstorm, intensity: 0.5 }, none, none, {
      settings: { params: { strikeRate: 12 } }
    });
    expect(fast.events[0].ratePerMin).toBe(6);
    expect(fast.layers.lightning).toBe(true);
    expect(fast.featureSignature).toContain('lightning');
  });

  it('adds ground rates with clamps and defaults the dry and melt rates', () => {
    const wet = composeAtmosphere({ type: WeatherType.HeavyRain }, none, none).ground;
    expect(wet.wetRate).toBeCloseTo(1 / 28, 9);
    expect(wet.dryRate).toBeCloseTo(1 / 180, 9);
    expect(wet.meltRate).toBeCloseTo(1 / 240, 9);
    expect(wet.puddles).toBeCloseTo(0.7, 9);
  });

  it('keeps the denser density and clamps octaves to the tier', () => {
    const composed = composeAtmosphere({ type: WeatherType.DustStorm }, none, { type: AmbienceType.GroundFog });
    expect(composed.density?.mode).toBe(DensityMode.EdgeInflow);
    expect(composed.density?.coverage).toBeCloseTo(0.45, 9);
    expect(composed.density?.overTokens).toBe(0.5);
    expect(composeAtmosphere({ type: WeatherType.DustStorm }, none, none, { tier: 'low' }).density?.octaves).toBe(1);
    expect(composeAtmosphere({ type: WeatherType.DustStorm }, none, none, { tier: 'medium' }).density?.octaves).toBe(2);
  });

  it('clamps depth layers and particle counts to the tier', () => {
    const low = composeAtmosphere({ type: WeatherType.HeavyRain }, none, none, { tier: 'low' });
    expect(low.particles[0].depthLayers).toBe(1);
    expect(low.particles[0].maxCount).toBe(900);
    expect(
      composeAtmosphere({ type: WeatherType.HeavyRain }, none, none, { tier: 'medium' }).particles[0].depthLayers
    ).toBe(2);
  });

  it('multiplies the weather opacity into weather alpha only', () => {
    const composed = composeAtmosphere({ type: WeatherType.Rain }, { type: LightingType.Sunbeams }, none, {
      weatherOpacity: 0.5
    });
    expect(composed.particles[0].alpha).toBeCloseTo(0.275, 9);
    expect(composed.particles[1].alpha).toBeCloseTo(0.6, 9);
    expect(composeAtmosphere({ type: WeatherType.Rain }, none, none, { weatherOpacity: 0 }).particles[0].alpha).toBe(0);
  });

  it('resolves wind in map UV radians and honours zero strength', () => {
    const wind = composeAtmosphere({ type: WeatherType.Rain }, none, none, { wind: { angle: 90, strength: 0.5 } }).wind;
    expect(wind.angle).toBeCloseTo(Math.PI / 2, 9);
    expect(wind.strength).toBeCloseTo(0.5, 9);
    expect(composeAtmosphere({ type: WeatherType.Rain }, none, none, { wind: { strength: 0 } }).wind.strength).toBe(0);
    expect(
      composeAtmosphere({ type: WeatherType.Sandstorm }, none, none, { wind: { strength: 0.9 } }).wind.strength
    ).toBe(1);
  });

  it('feeds the simulation parameters', () => {
    const { sim } = composeAtmosphere({ type: WeatherType.Blizzard }, none, none);
    expect(sim.densityMode).toBe(DensityMode.Everywhere);
    expect(sim.densityAmount).toBeCloseTo(0.55, 9);
    expect(sim.snowRate).toBeCloseTo(1 / 25, 9);
    const instant = composeAtmosphere({ type: WeatherType.Blizzard }, none, none, {
      settings: { accumulation: false }
    });
    expect(instant.ground.instant).toBe(true);
    expect(instant.sim.snowRate).toBeCloseTo(60 / 25, 9);
  });
});

describe('composeAtmosphere safety', () => {
  const storm = { type: WeatherType.Thunderstorm };

  it('caps the flash by default and by setting', () => {
    expect(composeAtmosphere(storm, none, none).safety.flashScale).toBeCloseTo(0.6, 9);
    expect(composeAtmosphere(storm, none, none, { settings: { flashBrightness: 0.2 } }).safety.flashScale).toBeCloseTo(
      0.2,
      9
    );
    expect(composeAtmosphere(storm, none, none, { settings: { flashBrightness: 5 } }).safety.flashScale).toBe(1);
  });

  it('reduces flashes, drops the afterimage and the shake', () => {
    const settings = { reduceFlashes: true, shake: true };
    const safety = composeAtmosphere(storm, none, none, { settings }).safety;
    expect(safety.flashScale).toBeCloseTo(0.18, 9);
    expect(safety.afterimage).toBe(false);
    expect(safety.shake).toBe(false);
  });

  it('treats reduced motion like reduce flashes and calms the wind', () => {
    const composed = composeAtmosphere(storm, none, none, { reducedMotion: true, settings: { shake: true } });
    expect(composed.safety.flashScale).toBeCloseTo(0.18, 9);
    expect(composed.safety.shake).toBe(false);
    expect(composed.motionScale).toBeCloseTo(0.4, 9);
    expect(composed.wind.gustiness).toBeLessThan(composeAtmosphere(storm, none, none).wind.gustiness);
  });

  it('allows shake only when asked for on the high tier', () => {
    const shake = (tier: 'high' | 'medium' | 'low', value?: boolean) =>
      composeAtmosphere(storm, none, none, { tier, settings: { shake: value } }).safety.shake;
    expect(shake('high')).toBe(false);
    expect(shake('high', true)).toBe(true);
    expect(shake('medium', true)).toBe(false);
    expect(shake('low', true)).toBe(false);
  });

  it('keeps HDR bolts to the high tier', () => {
    expect(composeAtmosphere(storm, none, none, { tier: 'high' }).featureSignature).toContain('hdr');
    expect(composeAtmosphere(storm, none, none, { tier: 'low' }).featureSignature).not.toContain('hdr');
  });
});

describe('feature signature', () => {
  const rain = { type: WeatherType.Rain };

  it('is stable across intensity, params, wind, seed and opacity changes', () => {
    const base = composeAtmosphere(rain, { type: LightingType.Night }, none).featureSignature;
    const variants = [
      composeAtmosphere({ type: WeatherType.Rain, intensity: 0.3 }, { type: LightingType.Night, intensity: 0.2 }, none),
      composeAtmosphere(rain, { type: LightingType.Night }, none, { wind: { angle: 200, strength: 1 }, seed: 99 }),
      composeAtmosphere(rain, { type: LightingType.Night }, none, {
        settings: { params: { moonTint: 0.9 }, tokenDarkness: 0.1 }
      }),
      composeAtmosphere(rain, { type: LightingType.Night }, none, { weatherOpacity: 0.4 })
    ];
    for (const variant of variants) expect(variant.featureSignature).toBe(base);
  });

  it('is sorted, `|` joined and reproducible', () => {
    const composed = composeAtmosphere(rain, none, none);
    expect(composed.features).toEqual([...composed.features].sort());
    expect(composed.featureSignature).toBe(composed.features.join('|'));
    expect(composed.featureSignature).toBe(
      'air:streak|depth:2|ground:lighting|ground:ripples|ground:wet|taps:3|darkness'.split('|').sort().join('|')
    );
    expect(composeAtmosphere(rain, none, none)).toEqual(composed);
  });

  it('changes with the shader features it needs', () => {
    const signatures = [
      composeAtmosphere(rain, none, none).featureSignature,
      composeAtmosphere({ type: WeatherType.Snow }, none, none).featureSignature,
      composeAtmosphere(rain, none, none, { tier: 'low' }).featureSignature,
      composeAtmosphere(rain, none, { type: AmbienceType.GroundFog }).featureSignature
    ];
    expect(new Set(signatures).size).toBe(signatures.length);
  });
});

describe('composeAtmosphere darkness cap', () => {
  it('caps lighting darkness with maxDarkness and leaves it alone otherwise', () => {
    const night = { type: LightingType.Night };
    const full = composeAtmosphere(none, night, none).lighting!;
    const capped = composeAtmosphere(none, night, none, { maxDarkness: 0.5 }).lighting!;
    expect(full.darkness).toBeGreaterThan(0.5);
    expect(capped.darkness).toBe(0.5);
  });
});

describe('composeAtmosphere phase 2 ground features', () => {
  it('mounts the ambience ground and the tremor features for sandworm tremors', () => {
    const composed = composeAtmosphere(none, none, { type: AmbienceType.SandwormTremors });
    expect(composed.layers.ambienceGround).toBe(true);
    expect(composed.features).toEqual(expect.arrayContaining(['ground:tremor', 'ambience:tremor']));
  });

  it('adds the grade, speckle, pools, aurora and tentacle features', () => {
    expect(composeAtmosphere(none, none, { type: AmbienceType.InfernalHellfire }).features).toEqual(
      expect.arrayContaining(['ground:grade', 'ground:speckle'])
    );
    expect(composeAtmosphere(none, none, { type: AmbienceType.FeywildLights }).features).toContain('ground:pools');
    expect(composeAtmosphere(none, { type: LightingType.AuroraNight }, none).features).toContain('ground:aurora');
    expect(composeAtmosphere(none, none, { type: AmbienceType.AbyssalTentacles }).features).toContain(
      'ambience:tentacles'
    );
  });

  it('does not change the signature with the pulse amount or fog density params', () => {
    const a = composeAtmosphere(none, { type: LightingType.Eclipse }, { type: AmbienceType.DivineRadiance });
    const b = composeAtmosphere(
      none,
      { type: LightingType.Eclipse, intensity: 0.5 },
      { type: AmbienceType.DivineRadiance }
    );
    expect(a.featureSignature).toBe(b.featureSignature);
  });
});
