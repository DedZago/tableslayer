import type { PerformanceTier } from '../Stage/types';
import type { AtmosphereController } from './atmosphereController.svelte';
import type { AtmosphereSimParams, DensityMode } from './sim/types';

export type AtmosphereSlot = 'weather' | 'lighting' | 'ambience';

export type ParticleShape =
  | 'streak'
  | 'drop'
  | 'flake'
  | 'atlasSnow'
  | 'atlasLeaves'
  | 'atlasAsh'
  | 'grit'
  | 'hail'
  | 'mote'
  | 'ember'
  | 'petal'
  | 'bubble'
  | 'spore'
  | 'wisp'
  | 'star'
  | 'meteor'
  /** Sparse ribbons traced along the wind field (gale, blizzard) */
  | 'windLine';

/**
 * One instanced particle population. Units are map-relative so a preset looks the same on any map size:
 * lengths are fractions of the map height, speeds are map heights per second.
 */
export interface ParticleLayerSpec {
  shape: ParticleShape;
  /** Instances at slot intensity 1 on the high tier (also the buffer size allocated once) */
  count: number;
  depthLayers: 1 | 2 | 3;
  /** Apparent speed at the nearest depth layer, away from the vanishing point; negative rises (embers, bubbles) */
  fall: number;
  /** 0..1, how strongly the wind field advects it */
  windInfluence: number;
  /** Diameter range as a fraction of the map height */
  size: [number, number];
  /** Streak length multiplier along the screen velocity (1 = as long as the particle is wide) */
  stretch: number;
  colorA: string;
  colorB: string;
  alpha: number;
  blend: 'normal' | 'additive';
  /** Seconds a particle takes to cross its cycle */
  lifetime: [number, number];
  /** 0..1 brightness flicker amplitude */
  flicker?: number;
  /** Spin speed in turns per second, scaled by the field curl */
  tumble?: number;
  /** Random sideways drift amplitude in map heights */
  wander?: number;
  /** Fast erratic buzz amplitude in map heights (insects) */
  jitter?: number;
  /** Degrees the base colour's hue spreads by per particle (multicolour lights) */
  hueSpread?: number;
  /** Cut order when more than 4 populations compose; higher survives. Default 0 */
  priority?: number;
  /** Default true. False renders the population into the ground pass instead of over tokens */
  overTokens?: boolean;
}

export interface DensitySpec {
  mode: DensityMode;
  colorA: string;
  colorB: string;
  /** Noise features per map height */
  scale: number;
  octaves: 1 | 2 | 3;
  /** 0..1 */
  coverage: number;
  /** 0..1 share of the density drawn over tokens */
  overTokens: number;
  /** Advection speed multiplier along the wind, default 1 */
  speed?: number;
  /** Draws the under-token density as an additive glow whose colour ramp a second noise layer varies (astral nebula) */
  nebula?: boolean;
}

export interface GroundSpec {
  /** Wetness rise per second (about 1/45 s) */
  wetRate?: number;
  dryRate?: number;
  /** 0..1 maximum puddle fill */
  puddles?: number;
  /** 0..1 raindrop ripple strength */
  ripples?: number;
  snowRate?: number;
  meltRate?: number;
  clouds?: { coverage: number; darkness: number; scale: number; speed: number; coverageParam?: string };
  haze?: { strength: number; color: string };
  /** 0..1 */
  caustics?: number;
  tint?: { color: string; strength: number };
  /** `pockets` 0..1 breaks the fog into dense pockets, `edge` 0..1 makes it creep in from the map edges */
  groundFog?: {
    color: string;
    density: number;
    densityParam?: string;
    colorB?: string;
    pockets?: number;
    edge?: number;
  };
  shadows?: 'tentacles' | null;
  /** Shadow colour and 0..1 opacity of `shadows` (default near-black violet, 0.7) */
  shadowColor?: string;
  shadowStrength?: number;
  /** Tints wet ground and, more strongly, puddles (acid green, blood red) */
  wetTint?: { color: string; strength: number };
  /** 0..1 maximum snow cover (thin sleet snow, a petal carpet), default 1 */
  snowStrength?: number;
  /** Colour of the cover `snowRate` builds (ash grey, petal pink, frost blue), default snow white */
  snowColor?: string;
  /** Saturation 1 = unchanged, below 1 drains colour, above 1 boosts it; contrast likewise */
  grade?: { saturation?: number; contrast?: number };
  /** High-frequency pits over the ground: corrosion, scorch, with an optional animated `glow` 0..1 */
  speckle?: { color: string; strength: number; glow?: number };
  /** Soft drifting pools of coloured light on the ground (Feywild, divine), `scale` pools per map height */
  glowPools?: { color: string; colorB: string; strength: number; scale: number };
}

export interface LightingSpec {
  /** Multiplicative colour at full darkness */
  tint: string;
  /** Blended into `tint` by the `tintAltParam` value (0..1), e.g. the moon tint of Night */
  tintAlt?: string;
  tintAltParam?: string;
  exposure: number;
  /** 0..1 */
  darkness: number;
  /** Degrees in map space, direction the light travels toward */
  sunAngle?: number;
  shafts?: { count: number; color: string; strength: number };
  aurora?: { strength: number; hue: number; hueParam?: string };
  rimVignette?: { color: string; strength: number };
  /** Slow breathing of the exposure: `amount` 0..1 around 1, one cycle per `period` seconds */
  pulse?: { amount: number; period: number };
}

export type AtmosphereEventKind = 'lightning' | 'meteor' | 'surge' | 'flicker' | 'tremor' | 'pulse';

export interface EventSpec {
  kind: AtmosphereEventKind;
  ratePerMin: number;
  /** Replaces `ratePerMin` when the scene sets this param */
  rateParam?: string;
  /** Simultaneous bolts per strike, inclusive range. Default [1, 1] */
  bolts?: [number, number];
  /** 'none' = white-blue, 'fixed' = `hue`, 'random' = a hashed hue per event. Default 'none' */
  hueMode?: 'none' | 'fixed' | 'random';
  /** Degrees 0..360 */
  hue?: number;
  hueParam?: string;
}

export interface WindSpec {
  /** Multiplies the scene wind strength */
  strengthScale: number;
  /** 0..1 */
  gustiness: number;
  /** 0..1 */
  turbulence: number;
}

export interface AtmospherePreset {
  particles?: ParticleLayerSpec[];
  density?: DensitySpec;
  ground?: GroundSpec;
  lighting?: LightingSpec;
  events?: EventSpec[];
  wind?: WindSpec;
}

export interface ComposedParticleLayer extends ParticleLayerSpec {
  slot: AtmosphereSlot;
  /** Slot intensity */
  intensity: number;
  /** Buffer size to allocate once (spec count scaled by the tier) */
  maxCount: number;
  /** Instances to draw now: `maxCount * intensity` */
  activeCount: number;
  /** Clamped to the tier */
  depthLayers: 1 | 2 | 3;
}

export interface ComposedDensity {
  mode: DensityMode;
  colorA: string;
  colorB: string;
  scale: number;
  /** Clamped to the tier */
  octaves: 1 | 2 | 3;
  coverage: number;
  overTokens: number;
  speed: number;
  nebula: boolean;
  /** Visibility occlusion cap over tokens */
  maxOcclusion: number;
}

export type Rgb = [number, number, number];

export interface ComposedGround {
  wetRate: number;
  dryRate: number;
  puddles: number;
  ripples: number;
  snowRate: number;
  meltRate: number;
  /** Accumulation off: wetness and snow are at full strength at once */
  instant: boolean;
  clouds: { coverage: number; darkness: number; scale: number; speed: number } | null;
  haze: { strength: number; color: Rgb } | null;
  caustics: number;
  tint: { color: Rgb; strength: number } | null;
  groundFog: { color: Rgb; colorB: Rgb; density: number; pockets: number; edge: number } | null;
  shadows: 'tentacles' | null;
  shadowColor: Rgb;
  shadowStrength: number;
  wetTint: { color: Rgb; strength: number } | null;
  snowStrength: number;
  snowColor: Rgb;
  grade: { saturation: number; contrast: number } | null;
  speckle: { color: Rgb; strength: number; glow: number } | null;
  glowPools: { color: Rgb; colorB: Rgb; strength: number; scale: number } | null;
}

export interface ComposedLighting {
  tint: Rgb;
  exposure: number;
  darkness: number;
  /** Fraction of the darkness applied to tokens */
  tokenDarkness: number;
  sunAngle: number | null;
  shafts: { count: number; color: Rgb; strength: number } | null;
  aurora: { strength: number; hue: number } | null;
  rimVignette: { color: Rgb; strength: number } | null;
  pulse: { amount: number; period: number } | null;
}

export interface ComposedEvent {
  kind: AtmosphereEventKind;
  /** Scaled by the slot intensity */
  ratePerMin: number;
  bolts: [number, number];
  hueMode: 'none' | 'fixed' | 'random';
  hue: number;
}

export interface ComposedSafety {
  /** Multiplies the flash envelope: brightness cap times 0.3 under reduce flashes or reduced motion */
  flashScale: number;
  /** Dip in exposure after a flash */
  afterimage: boolean;
  /** Camera shake allowed: settings.shake, high tier, no reduced motion, no reduce flashes */
  shake: boolean;
  hdrBolts: boolean;
  reducedMotion: boolean;
}

export interface ComposedSlot {
  /** 0 when the id has no preset or the intensity is 0 */
  type: number;
  intensity: number;
}

export interface ComposedLayerFlags {
  /** AmbienceGround mounts (ground fog, tentacle shadows) */
  ambienceGround: boolean;
  /** AtmosphereDarkness mounts (darkness or tint above tokens) */
  darkness: boolean;
  /** AirLayer mounts (particles, density, shafts, aurora) */
  air: boolean;
  /** LightningLayer mounts */
  lightning: boolean;
}

/**
 * The only atmosphere description the layers see. Moving a slider changes values here but never
 * `featureSignature`, which lists the shader features (defines) the composition needs, as sorted
 * `|`-joined tokens such as `air:streak|depth:2|ground:ripples|ground:wet|oct:3|taps:3`.
 */
export interface ComposedAtmosphere {
  active: boolean;
  seed: number;
  tier: PerformanceTier;
  slots: Record<AtmosphereSlot, ComposedSlot>;
  particles: ComposedParticleLayer[];
  density: ComposedDensity | null;
  ground: ComposedGround;
  lighting: ComposedLighting | null;
  events: ComposedEvent[];
  wind: { angle: number; strength: number; gustiness: number; turbulence: number };
  /** 1, or 0.4 under reduced motion; scale particle speed and wobble by it */
  motionScale: number;
  safety: ComposedSafety;
  layers: ComposedLayerFlags;
  sim: AtmosphereSimParams;
  features: string[];
  featureSignature: string;
}

/**
 * Props every atmosphere sub-layer (AmbienceGround, AtmosphereDarkness, AirLayer, LightningLayer) takes.
 * Sub-layers render at their own `SceneLayerOrder` entry inside the map anchor, so map UV space is
 * their local plane (the unit plane scaled by `mapSize`). Read `controller.uniforms` for shared state.
 */
export interface AtmosphereSubLayerProps {
  composed: ComposedAtmosphere;
  /** Map image size in px, always known when a sub-layer mounts */
  mapSize: { width: number; height: number };
  controller: AtmosphereController;
  /** Display px per map px (scene zoom times map zoom), for sizing screen-space targets */
  screenScale: number;
}
