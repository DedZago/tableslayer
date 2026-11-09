import { ATMO_TIME_PERIOD } from '../components/AtmosphereLayer/sim/types';
import type { AtmosphereEventKind } from '../components/AtmosphereLayer/types';

/**
 * Deterministic atmosphere events (lightning, meteors, gusts). Everything here is a pure function of
 * (seed, atmoTime) built on an integer hash, so every client derives the same events with no network
 * traffic. THREE-free; apps/web shares `hashSceneSeed`.
 */

export const EVENT_SLOT_SEC = 0.5;
export const GUST_PERIOD_SEC = 6;
/** An event's flash and afterimage are over this long after its time */
export const EVENT_TAIL_SEC = 2;

const FLASH_ATTACK_SEC = 0.016;
const GOLDEN = 0x9e3779b9;
const U32 = 4294967296;

export interface EventRateSpec {
  kind: AtmosphereEventKind;
  ratePerMin: number;
  bolts?: [number, number];
  hueMode?: 'none' | 'fixed' | 'random';
  /** Degrees 0..360 */
  hue?: number;
}

export interface AtmosphereEvent {
  kind: AtmosphereEventKind;
  /** Seconds on the atmoTime clock (0..3600) */
  time: number;
  /** Slot index the event was drawn from */
  slot: number;
  /** Map UV, v up */
  u: number;
  v: number;
  /** 0.55..1 */
  intensity: number;
  /** Degrees 0..360, -1 when the spec has no hue */
  hue: number;
  /** Seeds bolt geometry and flash strokes; unique per event */
  boltSeed: number;
  boltCount: number;
}

export interface FlashSample {
  /** 0..1, before the safety scale */
  flash: number;
  /** 0..1 afterimage dip of the ambient exposure */
  dip: number;
}

const KIND_SALTS: Record<AtmosphereEventKind, number> = {
  lightning: 0x4c1a9e37,
  meteor: 0x2f6b0d15,
  surge: 0x7d3c5a21,
  flicker: 0x1b8e47c3,
  tremor: 0x6a09e667,
  pulse: 0x3c6ef372
};

/** lowbias32 integer hash: bit-identical on every platform */
export const hash32 = (value: number): number => {
  let x = value | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
};

/** Stable uint32 seed from a scene id (FNV-1a, finalised with lowbias32) */
export const hashSceneSeed = (text: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return hash32(h);
};

const nextHash = (h: number) => hash32((h + GOLDEN) | 0);
const unit = (h: number) => h / U32;
const wrapTime = (t: number) => ((t % ATMO_TIME_PERIOD) + ATMO_TIME_PERIOD) % ATMO_TIME_PERIOD;

/** Signed difference a - b on the wrapping atmoTime clock */
export const atmoDelta = (a: number, b: number) => {
  const half = ATMO_TIME_PERIOD / 2;
  return wrapTime(a - b + half) - half;
};

const SLOTS_PER_PERIOD = ATMO_TIME_PERIOD / EVENT_SLOT_SEC;

const slotHash = (seed: number, slot: number, kind: AtmosphereEventKind) =>
  hash32((seed ^ Math.imul(slot % SLOTS_PER_PERIOD, GOLDEN) ^ KIND_SALTS[kind]) | 0);

const buildEvent = (slot: number, spec: EventRateSpec, h0: number, time: number): AtmosphereEvent => {
  const h2 = nextHash(nextHash(h0));
  const h3 = nextHash(h2);
  const h4 = nextHash(h3);
  const h5 = nextHash(h4);
  const h6 = nextHash(h5);
  const h7 = nextHash(h6);
  const [minBolts, maxBolts] = spec.bolts ?? [1, 1];
  const hueMode = spec.hueMode ?? 'none';
  const hue = hueMode === 'random' ? unit(h5) * 360 : hueMode === 'fixed' ? (spec.hue ?? 0) : -1;
  return {
    kind: spec.kind,
    time: wrapTime(time),
    slot,
    u: 0.08 + unit(h2) * 0.84,
    v: 0.08 + unit(h3) * 0.84,
    intensity: 0.55 + unit(h4) * 0.45,
    hue,
    boltSeed: h6,
    boltCount: minBolts + Math.floor(unit(h7) * (maxBolts - minBolts + 1))
  };
};

const collectWindow = (
  specs: readonly EventRateSpec[],
  seed: number,
  t0: number,
  t1: number,
  out: AtmosphereEvent[]
) => {
  const firstSlot = Math.floor(t0 / EVENT_SLOT_SEC);
  const lastSlot = Math.floor(t1 / EVENT_SLOT_SEC);
  for (let slot = firstSlot; slot <= lastSlot; slot++) {
    for (const spec of specs) {
      const probability = Math.min(1, (spec.ratePerMin / 60) * EVENT_SLOT_SEC);
      if (probability <= 0) continue;
      const h0 = slotHash(seed, slot, spec.kind);
      if (unit(h0) >= probability) continue;
      const time = (slot + unit(nextHash(h0))) * EVENT_SLOT_SEC;
      if (time > t0 && time <= t1) out.push(buildEvent(slot, spec, h0, time));
    }
  }
};

/**
 * Events whose time falls in (t0, t1], in atmoTime seconds. A window that wraps past the end of the
 * hour (t1 < t0) covers both ends. Pass `out` to reuse an array; it is appended to.
 */
export const eventsInWindow = (
  seed: number,
  specs: readonly EventRateSpec[],
  t0: number,
  t1: number,
  out: AtmosphereEvent[] = []
): AtmosphereEvent[] => {
  if (specs.length === 0) return out;
  if (t1 < t0) {
    collectWindow(specs, seed, t0, ATMO_TIME_PERIOD, out);
    collectWindow(specs, seed, 0, t1, out);
    return out;
  }
  collectWindow(specs, seed, t0, t1, out);
  return out;
};

const smoothstep = (x: number) => x * x * (3 - 2 * x);

const gustValue = (seed: number, index: number) => {
  const count = ATMO_TIME_PERIOD / GUST_PERIOD_SEC;
  return unit(hash32((seed ^ Math.imul(((index % count) + count) % count, GOLDEN) ^ 0x51ed270b) | 0));
};

/**
 * Wind strength multiplier at atmoTime `t`: a smoothstep blend between hashed values of consecutive
 * 6 s steps, mapped to `1 + gustiness * (-0.4 .. 0.8)`. Clamp the product with the base strength.
 */
export const gustAt = (seed: number, t: number, gustiness: number) => {
  const position = wrapTime(t) / GUST_PERIOD_SEC;
  const index = Math.floor(position);
  const blend = smoothstep(position - index);
  const raw = gustValue(seed, index) * (1 - blend) + gustValue(seed, index + 1) * blend;
  return 1 + gustiness * (raw * 1.2 - 0.4);
};

/**
 * Flash of one event at atmoTime `t`: 2 to 4 sub-strokes (16 ms attack, 60 to 120 ms decay) over about
 * 0.15 to 0.4 s, then a 0.5 to 1 s afterimage dip. Pure in (event, t); `flash` is 0 after
 * `EVENT_TAIL_SEC`.
 */
export const flashEnvelope = (event: AtmosphereEvent, t: number): FlashSample => {
  const elapsed = atmoDelta(t, event.time);
  if (elapsed < 0 || elapsed > EVENT_TAIL_SEC) return { flash: 0, dip: 0 };

  let h = event.boltSeed;
  h = nextHash(h);
  const strokes = 2 + (h % 3);
  h = nextHash(h);
  const tau = 0.06 + unit(h) * 0.06;
  h = nextHash(h);
  const dipDuration = 0.5 + unit(h) * 0.5;
  h = nextHash(h);
  const dipDepth = 0.5 + unit(h) * 0.5;

  let flash = 0;
  let start = 0;
  for (let i = 0; i < strokes; i++) {
    if (i > 0) {
      h = nextHash(h);
      start += 0.04 + unit(h) * 0.07;
    }
    h = nextHash(h);
    const amplitude = i === 0 ? 1 : 0.55 + unit(h) * 0.4;
    const age = elapsed - start;
    if (age < 0) continue;
    const level = age < FLASH_ATTACK_SEC ? age / FLASH_ATTACK_SEC : Math.exp(-(age - FLASH_ATTACK_SEC) / tau);
    flash = Math.max(flash, amplitude * level);
  }

  const dipStart = start + FLASH_ATTACK_SEC + tau * 3;
  const dipProgress = (elapsed - dipStart) / dipDuration;
  const dip =
    dipProgress <= 0 || dipProgress >= 1
      ? 0
      : dipDepth * (1 - dipProgress) ** 2 * smoothstep(Math.min(1, dipProgress / 0.15));

  return { flash: flash * event.intensity, dip };
};

const EVENT_TAILS: Record<AtmosphereEventKind, number> = {
  lightning: EVENT_TAIL_SEC,
  meteor: EVENT_TAIL_SEC,
  surge: EVENT_TAIL_SEC,
  flicker: 1,
  pulse: 5,
  tremor: 8
};

/** Seconds after its time that an event still has a visible effect */
export const eventTailSec = (kind: AtmosphereEventKind) => EVENT_TAILS[kind];

/**
 * Fire flicker of one event at `t`: a flare, a dip and a smaller flare (60 ms attack-free decay) within
 * about 0.4 s. Signed, about -0.6..1, times the event intensity. Pure in (event, t).
 */
export const flickerLevel = (event: AtmosphereEvent, t: number): number => {
  const elapsed = atmoDelta(t, event.time);
  if (elapsed < 0 || elapsed > EVENT_TAILS.flicker) return 0;
  let h = nextHash(event.boltSeed);
  let level = 0;
  let start = 0;
  const signs = [1, -0.6, 0.7];
  for (let i = 0; i < signs.length; i++) {
    h = nextHash(h);
    if (i > 0) start += 0.07 + unit(h) * 0.09;
    const age = elapsed - start;
    if (age >= 0) level += signs[i] * Math.exp(-age / 0.08);
  }
  return level * event.intensity;
};

/** Slow breathing bump of one event: 0 -> 1 -> 0 over 4 s (sin squared). Pure in (event, t) */
export const pulseLevel = (event: AtmosphereEvent, t: number): number => {
  const elapsed = atmoDelta(t, event.time);
  const duration = 4;
  if (elapsed < 0 || elapsed > duration) return 0;
  const s = Math.sin((Math.PI * elapsed) / duration);
  return s * s * event.intensity;
};
