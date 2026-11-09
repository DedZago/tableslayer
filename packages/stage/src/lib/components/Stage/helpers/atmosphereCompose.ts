import { AMBIENCE_PRESETS, LIGHTING_PRESETS, WEATHER_PRESETS } from '../components/AtmosphereLayer/presets';
import { DensityMode, type AtmosphereSimParams } from '../components/AtmosphereLayer/sim/types';
import type {
  AtmosphereEventKind,
  AtmospherePreset,
  AtmosphereSlot,
  ComposedAtmosphere,
  ComposedDensity,
  ComposedEvent,
  ComposedGround,
  ComposedLighting,
  ComposedParticleLayer,
  ComposedSlot,
  EventSpec,
  LightingSpec,
  ParticleLayerSpec,
  Rgb
} from '../components/AtmosphereLayer/types';
import { PERFORMANCE_TIER_SETTINGS, type PerformanceTier } from '../components/Stage/types';
import type { AtmosphereSettings, AtmosphereSlotProps, AtmosphereWindProps } from '../components/WeatherLayer/types';
import { atmosphereEffectDefinition } from './atmosphereEffects';

export interface ComposeOptions {
  /** uint32 from `hashSceneSeed`, default 0 */
  seed?: number;
  tier?: PerformanceTier;
  wind?: AtmosphereWindProps;
  settings?: AtmosphereSettings;
  /** `prefers-reduced-motion` */
  reducedMotion?: boolean;
  /** Weather particle opacity, 0..1 */
  weatherOpacity?: number;
  /** Upper bound for lighting darkness (the GM view keeps the map readable) */
  maxDarkness?: number;
}

export const DEFAULT_WIND_ANGLE = 45;
export const DEFAULT_WIND_STRENGTH = 0.35;
export const DEFAULT_FLASH_BRIGHTNESS = 0.6;
export const DEFAULT_TOKEN_DARKNESS = 0.6;
export const MAX_COMPOSED_PARTICLE_LAYERS = 4;
export const REDUCED_FLASH_SCALE = 0.3;
export const REDUCED_MOTION_SCALE = 0.4;
const DEFAULT_DRY_RATE = 1 / 180;
const DEFAULT_MELT_RATE = 1 / 240;
const INSTANT_RATE_SCALE = 60;
const MAX_ACCUMULATION_RATE = 0.2;
const MAX_DENSITY_OCCLUSION = 0.7;
const DEFAULT_SHADOW_COLOR = '#14061f';
const DEFAULT_SHADOW_STRENGTH = 0.7;
const DEFAULT_SNOW_COLOR = '#eef3f8';
const FLASH_KINDS: AtmosphereEventKind[] = ['lightning', 'surge', 'meteor'];
/** Events the LightningLayer draws (bolts, meteors, tremor dust) */
const LIGHTNING_LAYER_KINDS: AtmosphereEventKind[] = ['lightning', 'surge', 'meteor', 'tremor'];

const SLOT_PRESETS: Record<AtmosphereSlot, Partial<Record<number, AtmospherePreset>>> = {
  weather: WEATHER_PRESETS,
  lighting: LIGHTING_PRESETS,
  ambience: AMBIENCE_PRESETS
};
const SLOT_ORDER: AtmosphereSlot[] = ['weather', 'lighting', 'ambience'];
const SLOT_RANK: Record<AtmosphereSlot, number> = { weather: 3, ambience: 2, lighting: 1 };

interface ResolvedSlot {
  slot: AtmosphereSlot;
  type: number;
  intensity: number;
  preset: AtmospherePreset;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const clamp01 = (value: number) => clamp(value, 0, 1);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const parseHexColor = (color: string): Rgb => {
  const hex = color.startsWith('#') ? color.slice(1) : color;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  const value = Number.parseInt(full, 16);
  if (full.length !== 6 || Number.isNaN(value)) return [1, 1, 1];
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
};

const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const towardWhite = (color: Rgb, intensity: number): Rgb => mixRgb([1, 1, 1], color, intensity);

/** Whether the id has a preset, so unknown and not yet authored ids behave as None */
export const hasAtmospherePreset = (slot: AtmosphereSlot, type: number) => SLOT_PRESETS[slot][type] !== undefined;

export const isAtmosphereSlotActive = (slot: AtmosphereSlot, type: number, intensity = 1) =>
  hasAtmospherePreset(slot, type) && intensity > 0;

const resolveSlot = (slot: AtmosphereSlot, input: AtmosphereSlotProps | undefined): ResolvedSlot | null => {
  const intensity = clamp01(input?.intensity ?? 1);
  const preset = input ? SLOT_PRESETS[slot][input.type] : undefined;
  return preset && intensity > 0 ? { slot, type: input!.type, intensity, preset } : null;
};

const paramValue = (slot: ResolvedSlot, params: Record<string, number>, key: string | undefined, fallback: number) => {
  if (!key) return fallback;
  const definition = atmosphereEffectDefinition(slot.slot, slot.type)?.params.find((p) => p.key === key);
  if (!definition) return fallback;
  return clamp(params[key] ?? definition.default, definition.min, definition.max);
};

const composeParticles = (slots: ResolvedSlot[], tier: PerformanceTier, weatherOpacity: number) => {
  const knobs = PERFORMANCE_TIER_SETTINGS[tier];
  const layers: { layer: ComposedParticleLayer; rank: number }[] = [];
  for (const resolved of slots) {
    resolved.preset.particles?.slice(0, 3).forEach((spec: ParticleLayerSpec, index) => {
      const maxCount = Math.max(1, Math.round(spec.count * knobs.weatherParticleScale));
      layers.push({
        rank: SLOT_RANK[resolved.slot] * 1000 + (spec.priority ?? 0) * 10 - index,
        layer: {
          ...spec,
          slot: resolved.slot,
          intensity: resolved.intensity,
          maxCount,
          activeCount: Math.round(maxCount * resolved.intensity),
          depthLayers: Math.min(spec.depthLayers, knobs.atmoDepthLayers) as 1 | 2 | 3,
          alpha: resolved.slot === 'weather' ? spec.alpha * weatherOpacity : spec.alpha
        }
      });
    });
  }
  if (layers.length <= MAX_COMPOSED_PARTICLE_LAYERS) return layers.map(({ layer }) => layer);
  const kept = new Set(
    [...layers]
      .sort((a, b) => b.rank - a.rank)
      .slice(0, MAX_COMPOSED_PARTICLE_LAYERS)
      .map(({ layer }) => layer)
  );
  return layers.map(({ layer }) => layer).filter((layer) => kept.has(layer));
};

const composeDensity = (slots: ResolvedSlot[], tier: PerformanceTier): ComposedDensity | null => {
  const knobs = PERFORMANCE_TIER_SETTINGS[tier];
  let strongest: { spec: NonNullable<AtmospherePreset['density']>; coverage: number } | null = null;
  let overTokens = 0;
  for (const { preset, intensity } of slots) {
    if (!preset.density) continue;
    const coverage = clamp01(preset.density.coverage * intensity);
    overTokens = Math.max(overTokens, preset.density.overTokens);
    if (!strongest || coverage > strongest.coverage) strongest = { spec: preset.density, coverage };
  }
  if (!strongest || strongest.coverage <= 0) return null;
  const { spec, coverage } = strongest;
  return {
    mode: spec.mode,
    colorA: spec.colorA,
    colorB: spec.colorB,
    scale: spec.scale,
    octaves: Math.min(spec.octaves, knobs.atmoNoiseOctaves) as 1 | 2 | 3,
    coverage,
    overTokens,
    speed: spec.speed ?? 1,
    nebula: spec.nebula === true,
    maxOcclusion: MAX_DENSITY_OCCLUSION
  };
};

const composeGround = (
  slots: ResolvedSlot[],
  params: Record<string, number>,
  accumulation: boolean
): ComposedGround => {
  const ground: ComposedGround = {
    wetRate: 0,
    dryRate: 0,
    puddles: 0,
    ripples: 0,
    snowRate: 0,
    meltRate: 0,
    instant: !accumulation,
    clouds: null,
    haze: null,
    caustics: 0,
    tint: null,
    groundFog: null,
    shadows: null,
    shadowColor: parseHexColor(DEFAULT_SHADOW_COLOR),
    shadowStrength: DEFAULT_SHADOW_STRENGTH,
    wetTint: null,
    snowStrength: 0,
    snowColor: parseHexColor(DEFAULT_SNOW_COLOR),
    grade: null,
    speckle: null,
    glowPools: null
  };
  let strongestSnow = 0;
  for (const resolved of slots) {
    const spec = resolved.preset.ground;
    if (!spec) continue;
    const { intensity } = resolved;
    ground.wetRate = Math.min(MAX_ACCUMULATION_RATE, ground.wetRate + (spec.wetRate ?? 0) * intensity);
    ground.snowRate = Math.min(MAX_ACCUMULATION_RATE, ground.snowRate + (spec.snowRate ?? 0) * intensity);
    ground.dryRate = Math.max(ground.dryRate, spec.dryRate ?? 0);
    ground.meltRate = Math.max(ground.meltRate, spec.meltRate ?? 0);
    ground.puddles = clamp01(ground.puddles + (spec.puddles ?? 0) * intensity);
    ground.ripples = Math.max(ground.ripples, (spec.ripples ?? 0) * intensity);
    ground.caustics = Math.max(ground.caustics, (spec.caustics ?? 0) * intensity);
    if (spec.shadows) {
      ground.shadows = spec.shadows;
      ground.shadowColor = parseHexColor(spec.shadowColor ?? DEFAULT_SHADOW_COLOR);
      ground.shadowStrength = clamp01((spec.shadowStrength ?? DEFAULT_SHADOW_STRENGTH) * intensity);
    }
    if ((spec.snowRate ?? 0) > 0) {
      ground.snowStrength = Math.max(ground.snowStrength, clamp01(spec.snowStrength ?? 1));
      if ((spec.snowRate ?? 0) * intensity >= strongestSnow) {
        strongestSnow = (spec.snowRate ?? 0) * intensity;
        ground.snowColor = parseHexColor(spec.snowColor ?? DEFAULT_SNOW_COLOR);
      }
    }
    if (spec.wetTint) {
      const strength = clamp01(spec.wetTint.strength * intensity);
      if (!ground.wetTint || strength > ground.wetTint.strength) {
        ground.wetTint = { color: parseHexColor(spec.wetTint.color), strength };
      }
    }
    if (spec.grade) {
      const saturation = lerp(1, spec.grade.saturation ?? 1, intensity);
      const contrast = lerp(1, spec.grade.contrast ?? 1, intensity);
      ground.grade = {
        saturation: (ground.grade?.saturation ?? 1) * saturation,
        contrast: (ground.grade?.contrast ?? 1) * contrast
      };
    }
    if (spec.speckle) {
      const strength = clamp01(spec.speckle.strength * intensity);
      if (!ground.speckle || strength > ground.speckle.strength) {
        ground.speckle = {
          color: parseHexColor(spec.speckle.color),
          strength,
          glow: clamp01((spec.speckle.glow ?? 0) * intensity)
        };
      }
    }
    if (spec.glowPools) {
      const strength = clamp01(spec.glowPools.strength * intensity);
      if (!ground.glowPools || strength > ground.glowPools.strength) {
        ground.glowPools = {
          color: parseHexColor(spec.glowPools.color),
          colorB: parseHexColor(spec.glowPools.colorB),
          strength,
          scale: spec.glowPools.scale
        };
      }
    }
    if (spec.clouds) {
      const coverage = clamp01(paramValue(resolved, params, spec.clouds.coverageParam, spec.clouds.coverage));
      if (!ground.clouds || coverage * intensity > ground.clouds.coverage) {
        ground.clouds = {
          coverage: coverage * intensity,
          darkness: spec.clouds.darkness * intensity,
          scale: spec.clouds.scale,
          speed: spec.clouds.speed
        };
      }
    }
    if (spec.haze) {
      const strength = clamp01((ground.haze?.strength ?? 0) + spec.haze.strength * intensity);
      ground.haze = { strength, color: parseHexColor(spec.haze.color) };
    }
    if (spec.tint) {
      const color = parseHexColor(spec.tint.color);
      const strength = spec.tint.strength * intensity;
      ground.tint = ground.tint
        ? {
            color: ground.tint.color.map((c, i) => c * color[i]) as Rgb,
            strength: Math.max(ground.tint.strength, strength)
          }
        : { color, strength };
    }
    if (spec.groundFog) {
      const density = clamp01(paramValue(resolved, params, spec.groundFog.densityParam, spec.groundFog.density));
      if (!ground.groundFog || density * intensity > ground.groundFog.density) {
        const color = parseHexColor(spec.groundFog.color);
        ground.groundFog = {
          color,
          colorB: spec.groundFog.colorB ? parseHexColor(spec.groundFog.colorB) : color,
          density: density * intensity,
          pockets: clamp01(spec.groundFog.pockets ?? 0),
          edge: clamp01(spec.groundFog.edge ?? 0)
        };
      }
    }
  }
  if (ground.dryRate === 0) ground.dryRate = DEFAULT_DRY_RATE;
  if (ground.meltRate === 0) ground.meltRate = DEFAULT_MELT_RATE;
  return ground;
};

const lightingTint = (spec: LightingSpec, resolved: ResolvedSlot, params: Record<string, number>): Rgb => {
  const base = parseHexColor(spec.tint);
  if (!spec.tintAlt) return base;
  return mixRgb(base, parseHexColor(spec.tintAlt), paramValue(resolved, params, spec.tintAltParam, 0));
};

const composeLighting = (
  slots: ResolvedSlot[],
  params: Record<string, number>,
  tokenDarkness: number
): ComposedLighting | null => {
  let merged: ComposedLighting | null = null;
  for (const resolved of [...slots].sort((a, b) => SLOT_RANK[a.slot] - SLOT_RANK[b.slot])) {
    const spec = resolved.preset.lighting;
    if (!spec) continue;
    const { intensity } = resolved;
    const tint = towardWhite(lightingTint(spec, resolved, params), intensity);
    const exposure = lerp(1, spec.exposure, intensity);
    const darkness = spec.darkness * intensity;
    const shafts = spec.shafts
      ? {
          count: spec.shafts.count,
          color: parseHexColor(spec.shafts.color),
          strength: spec.shafts.strength * intensity
        }
      : null;
    const aurora = spec.aurora
      ? {
          strength: spec.aurora.strength * intensity,
          hue: paramValue(resolved, params, spec.aurora.hueParam, spec.aurora.hue)
        }
      : null;
    const rimVignette = spec.rimVignette
      ? { color: parseHexColor(spec.rimVignette.color), strength: spec.rimVignette.strength * intensity }
      : null;
    const pulse = spec.pulse ? { amount: spec.pulse.amount * intensity, period: spec.pulse.period } : null;
    if (!merged) {
      merged = {
        pulse,
        tint,
        exposure,
        darkness,
        tokenDarkness,
        sunAngle: spec.sunAngle ?? null,
        shafts,
        aurora,
        rimVignette
      };
      continue;
    }
    merged.tint = merged.tint.map((c, i) => c * tint[i]) as Rgb;
    merged.exposure *= exposure;
    merged.darkness = Math.max(merged.darkness, darkness);
    merged.sunAngle = spec.sunAngle ?? merged.sunAngle;
    if (pulse && (!merged.pulse || pulse.amount > merged.pulse.amount)) merged.pulse = pulse;
    if (shafts && (!merged.shafts || shafts.strength > merged.shafts.strength)) merged.shafts = shafts;
    if (aurora && (!merged.aurora || aurora.strength > merged.aurora.strength)) merged.aurora = aurora;
    if (rimVignette && (!merged.rimVignette || rimVignette.strength > merged.rimVignette.strength)) {
      merged.rimVignette = rimVignette;
    }
  }
  return merged;
};

const composeEvents = (slots: ResolvedSlot[], params: Record<string, number>): ComposedEvent[] => {
  const byKind = new Map<AtmosphereEventKind, ComposedEvent>();
  for (const resolved of slots) {
    resolved.preset.events?.forEach((spec: EventSpec) => {
      const base = paramValue(resolved, params, spec.rateParam, spec.ratePerMin);
      const ratePerMin = base * resolved.intensity;
      if (ratePerMin <= 0) return;
      const hue = paramValue(resolved, params, spec.hueParam, spec.hue ?? 0);
      const existing = byKind.get(spec.kind);
      if (!existing) {
        byKind.set(spec.kind, {
          kind: spec.kind,
          ratePerMin,
          bolts: spec.bolts ?? [1, 1],
          hueMode: spec.hueMode ?? 'none',
          hue
        });
        return;
      }
      existing.ratePerMin += ratePerMin;
      existing.bolts = [
        Math.max(existing.bolts[0], spec.bolts?.[0] ?? 1),
        Math.max(existing.bolts[1], spec.bolts?.[1] ?? 1)
      ];
      if (existing.hueMode === 'none' && spec.hueMode) {
        existing.hueMode = spec.hueMode;
        existing.hue = hue;
      }
    });
  }
  return [...byKind.values()];
};

const composeWind = (slots: ResolvedSlot[], wind: AtmosphereWindProps | undefined, motionScale: number) => {
  const specs = slots.flatMap(({ preset }) => (preset.wind ? [preset.wind] : []));
  const strengthScale = specs.length ? Math.max(...specs.map((spec) => spec.strengthScale)) : 1;
  const gustiness = specs.length ? Math.max(...specs.map((spec) => spec.gustiness)) : 0.2;
  const turbulence = specs.length ? Math.max(...specs.map((spec) => spec.turbulence)) : 0.2;
  return {
    angle: ((wind?.angle ?? DEFAULT_WIND_ANGLE) * Math.PI) / 180,
    strength: clamp01((wind?.strength ?? DEFAULT_WIND_STRENGTH) * strengthScale),
    gustiness: clamp01(gustiness * motionScale),
    turbulence: clamp01(turbulence * motionScale)
  };
};

const composeFeatures = (composed: Omit<ComposedAtmosphere, 'features' | 'featureSignature'>) => {
  const { particles, density, ground, lighting, events, layers, tier } = composed;
  const knobs = PERFORMANCE_TIER_SETTINGS[tier];
  const features = new Set<string>();
  if (ground.wetRate > 0 || ground.puddles > 0) features.add('ground:wet');
  if (ground.ripples > 0) {
    features.add('ground:ripples');
    features.add(`taps:${knobs.atmoRippleTaps}`);
  }
  if (ground.snowRate > 0) features.add('ground:snow');
  if (ground.clouds) features.add('ground:clouds');
  if (ground.haze) features.add('ground:haze');
  if (ground.caustics > 0) features.add('ground:caustics');
  if (ground.tint) features.add('ground:tint');
  if (ground.grade) features.add('ground:grade');
  if (ground.speckle) features.add('ground:speckle');
  if (ground.glowPools) features.add('ground:pools');
  if (lighting?.aurora) features.add('ground:aurora');
  if (events.some((event) => event.kind === 'tremor')) {
    features.add('ground:tremor');
    features.add('ambience:tremor');
  }
  if (lighting && lighting.darkness > 0) features.add('ground:lighting');
  if (events.some((event) => FLASH_KINDS.includes(event.kind))) features.add('ground:flash');
  if (ground.groundFog) features.add('ambience:fog');
  if (ground.shadows) features.add('ambience:tentacles');
  if (layers.darkness) features.add('darkness');
  particles.forEach((particle) => features.add(`air:${particle.shape}`));
  if (particles.length) features.add(`depth:${Math.max(...particles.map((particle) => particle.depthLayers))}`);
  if (particles.some((particle) => particle.overTokens === false)) features.add('ambience:particles');
  if (density) {
    features.add(`air:density${density.mode}`);
    features.add(`oct:${density.octaves}`);
    if (density.overTokens > 0) features.add('air:densityOver');
    if (density.overTokens < 1) features.add('ambience:density');
  }
  if (lighting?.shafts) features.add('air:shafts');
  if (lighting?.aurora) features.add('air:aurora');
  if (lighting?.rimVignette) features.add('air:rim');
  if (layers.lightning) {
    features.add('lightning');
    if (composed.safety.hdrBolts) features.add('hdr');
  }
  return [...features].sort();
};

/**
 * Merges the three slot presets into the one description the layers render. Pure and deterministic:
 * unknown ids, ids without a preset and intensity 0 all count as None. Particle populations
 * concatenate (weather before ambience before lighting, at most 4, lowest priority dropped); density
 * keeps the stronger coverage; ground rates add with clamps; lighting multiplies tints, multiplies
 * exposure and takes the larger darkness; events of one kind sum their rates; wind takes the largest
 * strength scale. Flash safety (cap, reduce flashes, reduced motion, shake gating) is resolved here.
 */
export const composeAtmosphere = (
  weather: AtmosphereSlotProps | undefined,
  lighting: AtmosphereSlotProps | undefined,
  ambience: AtmosphereSlotProps | undefined,
  options: ComposeOptions = {}
): ComposedAtmosphere => {
  const tier = options.tier ?? 'high';
  const settings = options.settings ?? {};
  const params = settings.params ?? {};
  const reducedMotion = options.reducedMotion ?? false;
  const reduceFlashes = settings.reduceFlashes ?? false;
  const motionScale = reducedMotion ? REDUCED_MOTION_SCALE : 1;
  const knobs = PERFORMANCE_TIER_SETTINGS[tier];

  const inputs: Record<AtmosphereSlot, AtmosphereSlotProps | undefined> = { weather, lighting, ambience };
  const resolved = SLOT_ORDER.flatMap((slot) => {
    const slotState = resolveSlot(slot, inputs[slot]);
    return slotState ? [slotState] : [];
  });
  const slotSummary = Object.fromEntries(
    SLOT_ORDER.map((slot): [AtmosphereSlot, ComposedSlot] => {
      const found = resolved.find((entry) => entry.slot === slot);
      return [slot, { type: found?.type ?? 0, intensity: found?.intensity ?? 0 }];
    })
  ) as Record<AtmosphereSlot, ComposedSlot>;

  const particles = composeParticles(resolved, tier, clamp01(options.weatherOpacity ?? 1));
  const density = composeDensity(resolved, tier);
  const ground = composeGround(resolved, params, settings.accumulation ?? true);
  const composedLighting = composeLighting(resolved, params, clamp01(settings.tokenDarkness ?? DEFAULT_TOKEN_DARKNESS));
  if (composedLighting && options.maxDarkness !== undefined) {
    composedLighting.darkness = Math.min(composedLighting.darkness, clamp01(options.maxDarkness));
  }
  const events = composeEvents(resolved, params);
  const wind = composeWind(resolved, options.wind, motionScale);

  const safeFlashes = reduceFlashes || reducedMotion;
  const hasLightning = events.some((event) => LIGHTNING_LAYER_KINDS.includes(event.kind));
  const safety = {
    flashScale: clamp01(settings.flashBrightness ?? DEFAULT_FLASH_BRIGHTNESS) * (safeFlashes ? REDUCED_FLASH_SCALE : 1),
    afterimage: !reduceFlashes && !reducedMotion,
    shake: settings.shake === true && tier === 'high' && !safeFlashes,
    hdrBolts: knobs.atmoHdrBolts,
    reducedMotion
  };

  const hasDarkness = composedLighting !== null && composedLighting.darkness > 0;
  const layers = {
    ambienceGround:
      ground.groundFog !== null ||
      events.some((event) => event.kind === 'tremor') ||
      ground.shadows !== null ||
      (density !== null && density.overTokens < 1) ||
      particles.some((particle) => particle.overTokens === false),
    darkness: hasDarkness,
    air:
      particles.length > 0 ||
      density !== null ||
      composedLighting?.shafts != null ||
      composedLighting?.aurora != null ||
      composedLighting?.rimVignette != null,
    lightning: hasLightning
  };

  const rateScale = ground.instant ? INSTANT_RATE_SCALE : 1;
  const sim: AtmosphereSimParams = {
    windAngle: wind.angle,
    windStrength: wind.strength,
    gustiness: wind.gustiness,
    turbulence: wind.turbulence,
    densityMode: density?.mode ?? DensityMode.None,
    densityAmount: density?.coverage ?? 0,
    wetRate: ground.wetRate * rateScale,
    snowRate: ground.snowRate * rateScale,
    dryRate: ground.dryRate,
    meltRate: ground.meltRate
  };

  const partial = {
    active: resolved.length > 0,
    seed: (options.seed ?? 0) >>> 0,
    tier,
    slots: slotSummary,
    particles,
    density,
    ground,
    lighting: composedLighting,
    events,
    wind,
    motionScale,
    safety,
    layers,
    sim
  };
  const features = composeFeatures(partial);
  return { ...partial, features, featureSignature: features.join('|') };
};
