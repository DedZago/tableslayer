import type { KernelSize } from 'postprocessing';
import type { ParticleSystemProps } from '../ParticleSystem/types';

export enum WeatherType {
  None = 0,
  Rain = 1,
  Snow = 2,
  Leaves = 3,
  Ash = 4,
  DustStorm = 5,
  Embers = 6,
  Blizzard = 7,
  Fireflies = 8,
  Drizzle = 9,
  HeavyRain = 10,
  Thunderstorm = 11,
  Hail = 12,
  Sandstorm = 13,
  Gale = 14,
  AcidRain = 15,
  BloodRain = 16,
  CherryBlossoms = 17,
  VolcanicAshfall = 18,
  MeteorShower = 19,
  ArcaneStorm = 20,
  SporeDrift = 21,
  Sleet = 22,
  /** Legacy particle-system path, driven by `WeatherLayerProps.custom` (docs playground only) */
  Custom = 99
}

export enum LightingType {
  None = 0,
  Dawn = 1,
  Dusk = 2,
  Night = 3,
  Overcast = 4,
  Sunbeams = 5,
  Eclipse = 6,
  PitchDark = 7,
  AuroraNight = 8
}

export enum AmbienceType {
  None = 0,
  GroundFog = 1,
  CloudShadows = 2,
  HeatHaze = 3,
  WildfireSmoke = 4,
  Underwater = 5,
  SwampMiasma = 6,
  FeywildLights = 7,
  GhostWisps = 8,
  DivineRadiance = 9,
  ShadowfellGloom = 10,
  InfernalHellfire = 11,
  AstralStarfield = 12,
  AbyssalTentacles = 13,
  FreezingMist = 14,
  SandwormTremors = 15
}

/**
 * Per-scene atmosphere options, persisted as JSON (`weather_settings`).
 * Every field is optional; consumers read with the defaults noted here.
 */
export interface AtmosphereSettings {
  v?: 1;
  /** Flash brightness cap, 0..1. Default 0.6 */
  flashBrightness?: number;
  /** Cuts flashes to 30%, drops the afterimage dip and the shake. Default false */
  reduceFlashes?: boolean;
  /** Camera shake on thunder, high tier only. Default false */
  shake?: boolean;
  /** Fraction of the lighting darkness applied to tokens, 0..1. Default 0.6 */
  tokenDarkness?: number;
  /** Wetness, puddles and snow build slowly and dry or melt afterwards. Default true */
  accumulation?: boolean;
  /** Per-effect extras keyed by the param keys of `ATMOSPHERE_EFFECTS` */
  params?: Record<string, number>;
}

export interface AtmosphereSlotProps {
  type: number;
  /** 0..1, default 1. 0 hides the slot */
  intensity?: number;
}

export interface AtmosphereWindProps {
  /** Degrees in map space: 0 = toward the map right, 90 = toward the map top. Default 45 */
  angle?: number;
  /** 0..1. Default 0.35 */
  strength?: number;
}

export interface DepthOfFieldConfig {
  enabled: boolean;
  focus: number;
  focalLength: number;
  bokehScale: number;
  kernelSize: KernelSize;
}

export interface WeatherLayerPreset {
  fov: number;
  intensity: number;
  opacity: number;
  depthOfField: DepthOfFieldConfig;
  particles: ParticleSystemProps;
  /**
   * Optional second particle system rendered alongside the primary one,
   * e.g. a soft fog bank billowing behind dust storm grit
   */
  secondaryParticles?: ParticleSystemProps;
}

export interface WeatherLayerProps {
  /** The weather slot. Unknown ids render as None; `WeatherType.Custom` uses `custom` */
  type: WeatherType;
  /** Only used by `WeatherType.Custom` */
  fov?: number;
  /** Weather slot intensity, 0..1 (0 hides it) */
  intensity?: number;
  /** Weather particle opacity, 0..1 */
  opacity?: number;
  custom?: WeatherLayerPreset;
  /** Lighting slot (time of day, darkness) */
  lighting?: AtmosphereSlotProps;
  /** Ambience slot (fog, haze, magic) */
  ambience?: AtmosphereSlotProps;
  wind?: AtmosphereWindProps;
  /** uint32 shared by every client so seeded events (lightning, gusts) line up. See `hashSceneSeed` */
  seed?: number;
  settings?: AtmosphereSettings;
}
