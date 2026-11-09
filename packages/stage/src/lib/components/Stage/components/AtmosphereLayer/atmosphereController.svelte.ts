import * as THREE from 'three';
import { composeAtmosphere } from '../../helpers/atmosphereCompose';
import {
  atmoDelta,
  eventTailSec,
  eventsInWindow,
  flashEnvelope,
  flickerLevel,
  gustAt,
  hash32,
  pulseLevel,
  type AtmosphereEvent
} from '../../helpers/atmosphereEvents';
import type { AtmosphereLightUv } from '../../helpers/atmosphereLights';
import type { FramePacer } from '../../helpers/framePacing';
import type { Light } from '../LightLayer/types';
import { PERFORMANCE_TIER_SETTINGS, type PerformanceTier } from '../Stage/types';
import { ATMO_TIME_PERIOD, atmoTimeNow, type AtmosphereSim, type AtmosphereSimBackend } from './sim/types';
import type { ComposedAtmosphere } from './types';

export const MAX_ATMO_LIGHTS = 32;
export const MAX_ATMO_TREMORS = 3;

/** The shared uniform objects every atmosphere layer reads. Layers never replace these objects. */
export interface AtmosphereUniforms {
  /** Seconds, wall-clock synced, 0..3600 */
  uAtmoTime: { value: number };
  /** Unit vector in map UV space (u right, v up) */
  uWindDir: { value: THREE.Vector2 };
  /** 0..1 including the current gust */
  uWindStrength: { value: number };
  /** RGBA8: rg velocity (x FIELD_VMAX), b density, a signed curl */
  uField: { value: THREE.Texture };
  uFieldPrev: { value: THREE.Texture };
  /** 0..1 between uFieldPrev and uField */
  uFieldBlend: { value: number };
  /** RGBA8: r wetness, g puddle fill, b snow depth, a scorch */
  uAccum: { value: THREE.Texture };
  /** Multiplicative tint at full darkness */
  uAmbientTint: { value: THREE.Color };
  /** 0..1.5, already includes the afterimage dip */
  uAmbientExposure: { value: number };
  uDarkness: { value: number };
  /** Fraction of the darkness applied to tokens */
  uTokenDarkness: { value: number };
  /** 0..1.5, already safety-scaled */
  uFlash: { value: number };
  uFlashColor: { value: THREE.Color };
  /** Map UV of the strongest flash */
  uFlashOrigin: { value: THREE.Vector2 };
  /** 0 the flash lights the whole sky, 1 it lights only around `uFlashOrigin` (meteor impact) */
  uFlashFocus: { value: number };
  /** 0..1 envelope of the strongest active `pulse` event (tentacle twitch, breathing) */
  uPulse: { value: number };
  /** Active `tremor` events, newest first: xy map UV, z seconds since it began, w intensity (z < 0 = unused) */
  uTremors: { value: THREE.Vector4[] };
  uLightCount: { value: number };
  /** xy map UV, z radius in map-height units, w intensity; always MAX_ATMO_LIGHTS long */
  uLights: { value: THREE.Vector4[] };
  uLightColors: { value: THREE.Color[] };
  /** Map image px */
  uMapSize: { value: THREE.Vector2 };
  /** 0 low, 1 medium, 2 high */
  uTier: { value: number };
}

/** A lightning strike in map UV. `vertices` stays null until the simulation returns the polyline. */
export interface AtmosphereBolt {
  id: number;
  event: AtmosphereEvent;
  /** Branch seed for this bolt (strikes with several bolts offset it per bolt) */
  seed: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** atmoTime seconds when it struck */
  startedAt: number;
  /** (x, y, width, brightness) per vertex; strips are separated by a sentinel vertex with width -1 and the first strip is the trunk; null until generated, and always null on the analytic fallback */
  vertices: Float32Array | null;
}

export type LightToMapUv = (light: Pick<Light, 'position' | 'radius' | 'color' | 'opacity'>) => AtmosphereLightUv;

export interface AtmosphereControllerOptions {
  renderer: THREE.WebGLRenderer;
  tier: PerformanceTier;
  /** Lets the controller keep the stage rendering at the ambient rate while it animates */
  framePacer?: FramePacer;
}

export interface AtmosphereController {
  readonly uniforms: AtmosphereUniforms;
  /** The current composition; reactive. An inactive composition has an empty feature signature */
  readonly composed: ComposedAtmosphere;
  /** Any slot is active and the tab is visible: the stage should keep animating */
  readonly isAnimating: boolean;
  readonly backend: AtmosphereSimBackend;
  /** Bolts that struck in the last `BOLT_LIFETIME_SEC`; the array is stable and mutated in place */
  readonly activeBolts: readonly AtmosphereBolt[];
  update: (composed: ComposedAtmosphere) => void;
  setMapSize: (width: number, height: number) => void;
  setLights: (lights: readonly Light[], toMapUv: LightToMapUv) => void;
  /** Call once per frame before rendering; `nowMs` is `performance.now()` */
  tick: (nowMs: number) => void;
  /** Fires when a lightning strike's bolts are requested. Returns the unsubscribe function */
  onBolt: (callback: (bolts: readonly AtmosphereBolt[]) => void) => () => void;
  /** Fires for every event as it happens (lightning, meteor, tremor, ...) */
  onEvent: (callback: (event: AtmosphereEvent) => void) => () => void;
  addScorch: (u: number, v: number, radius: number) => void;
  dispose: () => void;
}

export const BOLT_LIFETIME_SEC = 0.6;
const FLASH_KINDS = new Set(['lightning', 'surge', 'meteor']);
const AMBIENT_KINDS = new Set(['flicker', 'pulse', 'tremor']);
const METEOR_FLASH_SCALE = 0.25;
const FLICKER_GAIN = 0.5;
const PULSE_EVENT_GAIN = 0.25;
const MAX_FLASH = 1.5;
const AFTERIMAGE_EXPOSURE_DROP = 0.25;
const STRIKE_ACTIVE_MS = 600;
const BOLT_DETAIL: Record<PerformanceTier, number> = { high: 6, medium: 5, low: 4 };
const TIER_UNIFORM: Record<PerformanceTier, number> = { low: 0, medium: 1, high: 2 };
const NEUTRAL_VELOCITY_BYTE = 128;
const FLASH_COLOR_NEUTRAL: [number, number, number] = [0.8, 0.88, 1];
const FALLBACK_ACCUM_STEP_MS = 500;

const createDataTexture = (size: number, fill: (data: Uint8Array) => void) => {
  const data = new Uint8Array(size * size * 4);
  fill(data);
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
};

const fillNeutralField = (data: Uint8Array) => {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = NEUTRAL_VELOCITY_BYTE;
    data[i + 1] = NEUTRAL_VELOCITY_BYTE;
    data[i + 2] = 0;
    data[i + 3] = NEUTRAL_VELOCITY_BYTE;
  }
};

const unitHash = (value: number) => hash32(value) / 4294967296;

/**
 * Owns the shared atmosphere uniforms, the field and accumulation textures and the simulation
 * lifecycle for one Scene. Textures are allocated once per tier; simulation frames are copied into them.
 */
export const createAtmosphereController = ({
  renderer,
  tier: initialTier,
  framePacer
}: AtmosphereControllerOptions): AtmosphereController => {
  let tier = initialTier;
  let composed = $state.raw<ComposedAtmosphere>(composeAtmosphere(undefined, undefined, undefined, { tier }));
  let animating = false;
  let disposed = false;

  let fieldCurrent = createDataTexture(PERFORMANCE_TIER_SETTINGS[tier].atmoFieldSize, fillNeutralField);
  let fieldPrevious = createDataTexture(PERFORMANCE_TIER_SETTINGS[tier].atmoFieldSize, fillNeutralField);
  let accum = createDataTexture(PERFORMANCE_TIER_SETTINGS[tier].atmoAccumSize, () => {});
  [fieldCurrent, fieldPrevious, accum].forEach((texture) => renderer.initTexture(texture));

  const uniforms: AtmosphereUniforms = {
    uAtmoTime: { value: atmoTimeNow() },
    uWindDir: { value: new THREE.Vector2(1, 0) },
    uWindStrength: { value: 0 },
    uField: { value: fieldCurrent },
    uFieldPrev: { value: fieldPrevious },
    uFieldBlend: { value: 1 },
    uAccum: { value: accum },
    uAmbientTint: { value: new THREE.Color(1, 1, 1) },
    uAmbientExposure: { value: 1 },
    uDarkness: { value: 0 },
    uTokenDarkness: { value: 0 },
    uFlash: { value: 0 },
    uFlashColor: { value: new THREE.Color(...FLASH_COLOR_NEUTRAL) },
    uFlashOrigin: { value: new THREE.Vector2(0.5, 0.5) },
    uFlashFocus: { value: 0 },
    uPulse: { value: 0 },
    uTremors: { value: Array.from({ length: MAX_ATMO_TREMORS }, () => new THREE.Vector4(0, 0, -1, 0)) },
    uLightCount: { value: 0 },
    uLights: { value: Array.from({ length: MAX_ATMO_LIGHTS }, () => new THREE.Vector4()) },
    uLightColors: { value: Array.from({ length: MAX_ATMO_LIGHTS }, () => new THREE.Color()) },
    uMapSize: { value: new THREE.Vector2(1, 1) },
    uTier: { value: TIER_UNIFORM[tier] }
  };

  let sim: AtmosphereSim | null = null;
  let simKey = '';
  let simGeneration = 0;
  let simFailed = false;
  let hasFieldData = false;
  let fieldArrivedAt = 0;
  let fieldInterval = 1000 / PERFORMANCE_TIER_SETTINGS[tier].atmoSimHz;

  let lastEventTime: number | null = null;
  let baseExposure = 1;
  let ambientScale = 1;
  const ambientScratch: AtmosphereEvent[] = [];
  let nextBoltId = 1;
  const recentEvents: AtmosphereEvent[] = [];
  const firedScratch: AtmosphereEvent[] = [];
  const activeBolts: AtmosphereBolt[] = [];
  const boltsById = new Map<number, AtmosphereBolt>();
  const boltListeners = new Set<(bolts: readonly AtmosphereBolt[]) => void>();
  const eventListeners = new Set<(event: AtmosphereEvent) => void>();

  let fallbackWet = 0;
  let fallbackSnow = 0;
  let fallbackAccumAt = 0;

  const resetAccum = () => {
    (accum.image.data as Uint8Array).fill(0);
    accum.needsUpdate = true;
    fallbackWet = 0;
    fallbackSnow = 0;
  };

  const resetField = () => {
    for (const texture of [fieldCurrent, fieldPrevious]) {
      fillNeutralField(texture.image.data as Uint8Array);
      texture.needsUpdate = true;
    }
    hasFieldData = false;
    uniforms.uFieldBlend.value = 1;
  };

  const rebuildTextures = () => {
    const knobs = PERFORMANCE_TIER_SETTINGS[tier];
    const old = [fieldCurrent, fieldPrevious, accum];
    fieldCurrent = createDataTexture(knobs.atmoFieldSize, fillNeutralField);
    fieldPrevious = createDataTexture(knobs.atmoFieldSize, fillNeutralField);
    accum = createDataTexture(knobs.atmoAccumSize, () => {});
    [fieldCurrent, fieldPrevious, accum].forEach((texture) => renderer.initTexture(texture));
    uniforms.uField.value = fieldCurrent;
    uniforms.uFieldPrev.value = fieldPrevious;
    uniforms.uAccum.value = accum;
    uniforms.uTier.value = TIER_UNIFORM[tier];
    old.forEach((texture) => texture.dispose());
    hasFieldData = false;
    fieldInterval = 1000 / knobs.atmoSimHz;
  };

  const receiveField = (data: Uint8Array) => {
    if (disposed || data.length !== (fieldCurrent.image.data as Uint8Array).length) return;
    const now = performance.now();
    const target = hasFieldData ? fieldPrevious : fieldCurrent;
    (target.image.data as Uint8Array).set(data);
    target.needsUpdate = true;
    if (!hasFieldData) {
      (fieldPrevious.image.data as Uint8Array).set(data);
      fieldPrevious.needsUpdate = true;
      hasFieldData = true;
    } else {
      fieldPrevious = fieldCurrent;
      fieldCurrent = target;
      fieldInterval = Math.min(500, Math.max(16, fieldInterval + (now - fieldArrivedAt - fieldInterval) * 0.3));
    }
    fieldArrivedAt = now;
    uniforms.uField.value = fieldCurrent;
    uniforms.uFieldPrev.value = fieldPrevious;
    uniforms.uFieldBlend.value = 0;
  };

  const receiveAccum = (data: Uint8Array) => {
    if (disposed || data.length !== (accum.image.data as Uint8Array).length) return;
    (accum.image.data as Uint8Array).set(data);
    accum.needsUpdate = true;
  };

  const receiveBolt = (id: number, vertices: Float32Array) => {
    const bolt = boltsById.get(id);
    if (bolt) bolt.vertices = vertices;
  };

  const disposeSim = () => {
    simGeneration++;
    sim?.dispose();
    sim = null;
    simKey = '';
  };

  const ensureSim = async (next: ComposedAtmosphere) => {
    const knobs = PERFORMANCE_TIER_SETTINGS[next.tier];
    const key = `${next.seed}:${next.tier}`;
    if (sim && simKey === key) {
      sim.setParams(next.sim);
      if (!document.hidden) sim.resume();
      return;
    }
    disposeSim();
    if (simFailed) return;
    const generation = simGeneration;
    try {
      const { createAtmosphereSim } = await import('./sim/atmosphereSim');
      const created = await createAtmosphereSim({
        seed: next.seed,
        fieldSize: knobs.atmoFieldSize,
        accumSize: knobs.atmoAccumSize,
        simHz: knobs.atmoSimHz
      });
      if (disposed || generation !== simGeneration) {
        created.dispose();
        return;
      }
      created.onField(receiveField);
      created.onAccum(receiveAccum);
      created.onBolt(receiveBolt);
      created.setParams(composed.sim);
      if (document.hidden) created.pause();
      sim = created;
      simKey = key;
    } catch (error) {
      simFailed = true;
      console.warn('[atmosphere] simulation unavailable, using analytic wind', error);
    }
  };

  const applyLighting = (next: ComposedAtmosphere) => {
    const lighting = next.lighting;
    uniforms.uAmbientTint.value.setRGB(...(lighting?.tint ?? [1, 1, 1]));
    baseExposure = lighting?.exposure ?? 1;
    uniforms.uAmbientExposure.value = baseExposure;
    uniforms.uDarkness.value = lighting?.darkness ?? 0;
    uniforms.uTokenDarkness.value = lighting?.tokenDarkness ?? 0;
  };

  const clearEvents = () => {
    recentEvents.length = 0;
    activeBolts.length = 0;
    boltsById.clear();
    lastEventTime = null;
    uniforms.uFlash.value = 0;
    uniforms.uPulse.value = 0;
    uniforms.uTremors.value.forEach((tremor) => tremor.set(0, 0, -1, 0));
    ambientScale = 1;
  };

  const update = (next: ComposedAtmosphere) => {
    if (disposed) return;
    const wasActive = composed.active;
    const tierChanged = next.tier !== tier;
    composed = next;
    if (tierChanged) {
      tier = next.tier;
      rebuildTextures();
    }
    applyLighting(next);
    if (next.active) {
      if (!wasActive || tierChanged) lastEventTime = null;
      void ensureSim(next);
    } else if (wasActive) {
      sim?.pause();
      resetAccum();
      resetField();
      clearEvents();
    }
    animating = next.active && !document.hidden;
  };

  const handleVisibility = () => {
    if (document.hidden) sim?.pause();
    else if (composed.active) sim?.resume();
    animating = composed.active && !document.hidden;
    lastEventTime = null;
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', handleVisibility);

  const requestBolts = (event: AtmosphereEvent) => {
    const bolts: AtmosphereBolt[] = [];
    for (let i = 0; i < event.boltCount; i++) {
      const seed = (event.boltSeed + Math.imul(i, 0x9e3779b9)) >>> 0;
      const bolt: AtmosphereBolt = {
        id: nextBoltId++,
        event,
        seed,
        x0: Math.min(1.1, Math.max(-0.1, event.u + (unitHash(seed ^ 0x2545f491) - 0.5) * 0.3)),
        y0: 1.08,
        x1: Math.min(1, Math.max(0, event.u + (i === 0 ? 0 : (unitHash(seed ^ 0x6a09e667) - 0.5) * 0.12))),
        y1: event.v,
        startedAt: event.time,
        vertices: null
      };
      bolts.push(bolt);
      activeBolts.push(bolt);
      boltsById.set(bolt.id, bolt);
      sim?.requestBolt(bolt.id, seed, bolt.x0, bolt.y0, bolt.x1, bolt.y1, BOLT_DETAIL[tier]);
    }
    sim?.addScorch(event.u, event.v, 0.012);
    boltListeners.forEach((listener) => listener(bolts));
  };

  const fireEvents = (t: number, nowMs: number) => {
    if (lastEventTime === null || Math.abs(atmoDelta(t, lastEventTime)) > 1) {
      lastEventTime = t;
      return;
    }
    firedScratch.length = 0;
    eventsInWindow(composed.seed, composed.events, lastEventTime, t, firedScratch);
    lastEventTime = t;
    for (const event of firedScratch) {
      if (FLASH_KINDS.has(event.kind)) recentEvents.push(event);
      if (event.kind === 'lightning' || event.kind === 'surge') requestBolts(event);
      eventListeners.forEach((listener) => listener(event));
      if (FLASH_KINDS.has(event.kind)) framePacer?.markActive(nowMs, STRIKE_ACTIVE_MS);
    }
  };

  const applyAmbientEvents = (t: number) => {
    let flicker = 0;
    let pulse = 0;
    let tremorCount = 0;
    const specs = composed.events.filter((spec) => AMBIENT_KINDS.has(spec.kind));
    ambientScratch.length = 0;
    if (specs.length) {
      const longest = Math.max(...specs.map((spec) => eventTailSec(spec.kind)));
      const start = (t - longest + ATMO_TIME_PERIOD) % ATMO_TIME_PERIOD;
      eventsInWindow(composed.seed, specs, start, t, ambientScratch);
    }
    ambientScratch.sort((a, b) => atmoDelta(b.time, a.time));
    for (const event of ambientScratch) {
      if (event.kind === 'flicker') flicker += flickerLevel(event, t);
      else if (event.kind === 'pulse') pulse = Math.max(pulse, pulseLevel(event, t));
      else if (event.kind === 'tremor' && tremorCount < MAX_ATMO_TREMORS) {
        const age = atmoDelta(t, event.time);
        if (age >= 0 && age <= eventTailSec('tremor')) {
          uniforms.uTremors.value[tremorCount++].set(event.u, event.v, age, event.intensity);
        }
      }
    }
    for (let i = tremorCount; i < MAX_ATMO_TREMORS; i++) uniforms.uTremors.value[i].set(0, 0, -1, 0);
    uniforms.uPulse.value = pulse;
    const lightingPulse = composed.lighting?.pulse;
    const breathing = lightingPulse
      ? 1 + lightingPulse.amount * Math.sin((t / Math.max(lightingPulse.period, 0.1)) * Math.PI * 2)
      : 1;
    const reduced = composed.safety.reducedMotion ? 0.4 : 1;
    ambientScale = (1 + FLICKER_GAIN * flicker * reduced) * (1 + PULSE_EVENT_GAIN * pulse) * breathing;
    if (flicker !== 0 || pulse > 0 || tremorCount > 0) framePacer?.markAmbient(performance.now());
  };

  const applyFlash = (t: number, nowMs: number) => {
    for (let i = recentEvents.length - 1; i >= 0; i--) {
      if (atmoDelta(t, recentEvents[i].time) > eventTailSec(recentEvents[i].kind)) recentEvents.splice(i, 1);
    }
    for (let i = activeBolts.length - 1; i >= 0; i--) {
      if (atmoDelta(t, activeBolts[i].startedAt) > BOLT_LIFETIME_SEC) {
        boltsById.delete(activeBolts[i].id);
        activeBolts.splice(i, 1);
      }
    }
    let flash = 0;
    let dip = 0;
    let strongest: AtmosphereEvent | null = null;
    for (const event of recentEvents) {
      if (!FLASH_KINDS.has(event.kind)) continue;
      const sample = flashEnvelope(event, t);
      const weight = event.kind === 'meteor' ? METEOR_FLASH_SCALE : 1;
      dip = Math.max(dip, sample.dip * weight);
      if (sample.flash * weight > flash) {
        flash = sample.flash * weight;
        strongest = event;
      }
    }
    const { safety } = composed;
    uniforms.uFlash.value = Math.min(MAX_FLASH, flash * safety.flashScale * MAX_FLASH);
    uniforms.uAmbientExposure.value =
      baseExposure * ambientScale * (1 - (safety.afterimage ? dip * AFTERIMAGE_EXPOSURE_DROP : 0));
    if (strongest) {
      uniforms.uFlashOrigin.value.set(strongest.u, strongest.v);
      uniforms.uFlashFocus.value = strongest.kind === 'meteor' ? 1 : 0;
      if (strongest.hue >= 0) uniforms.uFlashColor.value.setHSL(strongest.hue / 360, 0.9, 0.72);
      else uniforms.uFlashColor.value.setRGB(...FLASH_COLOR_NEUTRAL);
    }
    if (flash > 0 || dip > 0) framePacer?.markActive(nowMs, STRIKE_ACTIVE_MS);
  };

  const stepFallbackAccum = (nowMs: number) => {
    if (nowMs - fallbackAccumAt < FALLBACK_ACCUM_STEP_MS) return;
    const dt = Math.min(2, (nowMs - fallbackAccumAt) / 1000);
    fallbackAccumAt = nowMs;
    const { ground } = composed;
    fallbackWet = Math.min(1, Math.max(0, fallbackWet + (ground.wetRate > 0 ? ground.wetRate : -ground.dryRate) * dt));
    fallbackSnow = Math.min(
      1,
      Math.max(0, fallbackSnow + (ground.snowRate > 0 ? ground.snowRate : -ground.meltRate) * dt)
    );
    const data = accum.image.data as Uint8Array;
    const r = Math.round(fallbackWet * 255);
    const g = Math.round(fallbackWet * ground.puddles * 255);
    const b = Math.round(fallbackSnow * 255);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
    accum.needsUpdate = true;
  };

  const tick = (nowMs: number) => {
    if (disposed || !composed.active || document.hidden) return;
    const t = atmoTimeNow();
    uniforms.uAtmoTime.value = t;

    const { wind } = composed;
    uniforms.uWindDir.value.set(Math.cos(wind.angle), Math.sin(wind.angle));
    uniforms.uWindStrength.value = Math.min(1, Math.max(0, wind.strength * gustAt(composed.seed, t, wind.gustiness)));

    uniforms.uFieldBlend.value = hasFieldData ? Math.min(1, (nowMs - fieldArrivedAt) / fieldInterval) : 1;
    if (!sim || sim.backend === 'analytic') stepFallbackAccum(nowMs);

    fireEvents(t, nowMs);
    applyAmbientEvents(t);
    applyFlash(t, nowMs);

    if (animating) framePacer?.markAmbient(nowMs);
  };

  const setLights = (lights: readonly Light[], toMapUv: LightToMapUv) => {
    const converted = lights.map(toMapUv);
    const nearest =
      converted.length > MAX_ATMO_LIGHTS
        ? [...converted]
            .sort((a, b) => Math.hypot(a.u - 0.5, a.v - 0.5) - Math.hypot(b.u - 0.5, b.v - 0.5))
            .slice(0, MAX_ATMO_LIGHTS)
        : converted;
    nearest.forEach((light, index) => {
      uniforms.uLights.value[index].set(light.u, light.v, light.radius, light.intensity);
      uniforms.uLightColors.value[index].set(light.color);
    });
    uniforms.uLightCount.value = nearest.length;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    document.removeEventListener('visibilitychange', handleVisibility);
    disposeSim();
    [fieldCurrent, fieldPrevious, accum].forEach((texture) => texture.dispose());
    boltListeners.clear();
    eventListeners.clear();
  };

  return {
    uniforms,
    get composed() {
      return composed;
    },
    get isAnimating() {
      return animating;
    },
    get backend() {
      return sim?.backend ?? (simFailed ? 'analytic' : 'pending');
    },
    activeBolts,
    update,
    setMapSize: (width, height) => uniforms.uMapSize.value.set(width, height),
    setLights,
    tick,
    onBolt: (callback) => {
      boltListeners.add(callback);
      return () => boltListeners.delete(callback);
    },
    onEvent: (callback) => {
      eventListeners.add(callback);
      return () => eventListeners.delete(callback);
    },
    addScorch: (u, v, radius) => sim?.addScorch(u, v, radius),
    dispose
  };
};
