import { describe, expect, it } from 'vitest';
import { ATMO_TIME_PERIOD } from '../components/AtmosphereLayer/sim/types';
import {
  EVENT_SLOT_SEC,
  EVENT_TAIL_SEC,
  eventsInWindow,
  eventTailSec,
  flashEnvelope,
  flickerLevel,
  gustAt,
  hash32,
  hashSceneSeed,
  pulseLevel,
  type AtmosphereEvent,
  type EventRateSpec
} from './atmosphereEvents';

const lightning: EventRateSpec = { kind: 'lightning', ratePerMin: 30, bolts: [1, 3], hueMode: 'random' };
const seed = hashSceneSeed('scene-1');

describe('hash32', () => {
  it('is bit-exact', () => {
    expect([hash32(0), hash32(1), hash32(0xdeadbeef)]).toEqual([0, 1753845952, 3861431939]);
    expect([hashSceneSeed(''), hashSceneSeed('scene-1')]).toEqual([1947474976, 424595284]);
  });

  it('returns unsigned 32 bit integers', () => {
    for (let i = 0; i < 1000; i++) {
      const value = hash32(i * 7919);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(2 ** 32);
    }
  });
});

describe('eventsInWindow', () => {
  it('reproduces fixed fixtures', () => {
    const events = eventsInWindow(seed, [lightning], 100, 130);
    expect(events).toHaveLength(19);
    expect(events[0]).toMatchObject({ kind: 'lightning', slot: 203, boltSeed: 2625268671, boltCount: 1 });
    expect(events[0].time).toBeCloseTo(101.71937287366018, 12);
    expect(events[0].u).toBeCloseTo(0.6109099259227514, 12);
    expect(events[0].v).toBeCloseTo(0.3375172928906977, 12);
    expect(events[0].intensity).toBeCloseTo(0.9321021998417565, 12);
    expect(events[0].hue).toBeCloseTo(156.77607698366046, 10);
    expect(events[2]).toMatchObject({ slot: 207, boltSeed: 1577778940, boltCount: 2 });
    expect(events.map((event) => event.slot).slice(0, 6)).toEqual([203, 205, 207, 208, 215, 216]);
  });

  it('is identical for equal inputs and differs across seeds', () => {
    expect(eventsInWindow(seed, [lightning], 0, 60)).toEqual(eventsInWindow(seed, [lightning], 0, 60));
    expect(eventsInWindow(seed + 1, [lightning], 0, 60)).not.toEqual(eventsInWindow(seed, [lightning], 0, 60));
  });

  it('splits cleanly across adjacent windows', () => {
    const whole = eventsInWindow(seed, [lightning], 10, 70);
    const parts = [...eventsInWindow(seed, [lightning], 10, 33.3), ...eventsInWindow(seed, [lightning], 33.3, 70)];
    expect(parts).toEqual(whole);
  });

  it('keeps events inside the window and in the hour', () => {
    for (const event of eventsInWindow(seed, [lightning], 500, 800)) {
      expect(event.time).toBeGreaterThan(500);
      expect(event.time).toBeLessThanOrEqual(800);
      expect(Math.floor(event.time / EVENT_SLOT_SEC)).toBe(event.slot);
      expect(event.u).toBeGreaterThanOrEqual(0.08);
      expect(event.u).toBeLessThanOrEqual(0.92);
      expect(event.boltCount).toBeGreaterThanOrEqual(1);
      expect(event.boltCount).toBeLessThanOrEqual(3);
    }
  });

  it('covers both ends of a window that wraps the hour', () => {
    const wrapped = eventsInWindow(seed, [{ kind: 'meteor', ratePerMin: 600 }], ATMO_TIME_PERIOD - 3, 3);
    const times = wrapped.map((event) => event.time);
    expect(times.some((time) => time > ATMO_TIME_PERIOD - 3)).toBe(true);
    expect(times.some((time) => time <= 3)).toBe(true);
  });

  it('appends to a provided array and ignores zero rates', () => {
    const out = eventsInWindow(seed, [lightning], 0, 60);
    const length = out.length;
    expect(eventsInWindow(seed, [{ kind: 'tremor', ratePerMin: 0 }], 0, 60, out)).toHaveLength(length);
  });

  it('fires at the configured rate', () => {
    const hours = [seed, seed ^ 0x1234567, seed ^ 0x7654321].map(
      (value) => eventsInWindow(value >>> 0, [{ kind: 'lightning', ratePerMin: 6 }], 0, ATMO_TIME_PERIOD).length
    );
    for (const count of hours) {
      expect(count).toBeGreaterThan(360 * 0.8);
      expect(count).toBeLessThan(360 * 1.2);
    }
  });

  it('draws kinds independently', () => {
    const lightningSlots = eventsInWindow(seed, [{ kind: 'lightning', ratePerMin: 30 }], 0, 600).map((e) => e.slot);
    const meteorSlots = eventsInWindow(seed, [{ kind: 'meteor', ratePerMin: 30 }], 0, 600).map((e) => e.slot);
    expect(lightningSlots).not.toEqual(meteorSlots);
  });
});

describe('gustAt', () => {
  it('is deterministic and bounded', () => {
    expect(gustAt(seed, 12.3, 0.5)).toBe(gustAt(seed, 12.3, 0.5));
    for (let t = 0; t < 600; t += 0.7) {
      const gust = gustAt(seed, t, 1);
      expect(gust).toBeGreaterThanOrEqual(0.6);
      expect(gust).toBeLessThanOrEqual(1.8);
    }
  });

  it('is exactly 1 without gustiness and continuous across the hour', () => {
    expect(gustAt(seed, 42, 0)).toBe(1);
    expect(Math.abs(gustAt(seed, ATMO_TIME_PERIOD - 0.001, 1) - gustAt(seed, 0, 1))).toBeLessThan(0.01);
  });

  it('is smooth within a step', () => {
    for (let t = 0; t < 30; t += 0.05) {
      expect(Math.abs(gustAt(seed, t + 0.05, 1) - gustAt(seed, t, 1))).toBeLessThan(0.1);
    }
  });
});

describe('flashEnvelope', () => {
  const event: AtmosphereEvent = eventsInWindow(seed, [lightning], 100, 130)[0];

  it('is dark before the event and after its tail', () => {
    expect(flashEnvelope(event, event.time - 0.1)).toEqual({ flash: 0, dip: 0 });
    expect(flashEnvelope(event, event.time + EVENT_TAIL_SEC + 0.01)).toEqual({ flash: 0, dip: 0 });
  });

  it('attacks over 16 ms and then decays', () => {
    const half = flashEnvelope(event, event.time + 0.008).flash;
    const peak = flashEnvelope(event, event.time + 0.016).flash;
    expect(half).toBeCloseTo(peak / 2, 6);
    expect(peak).toBeCloseTo(event.intensity, 6);
    expect(flashEnvelope(event, event.time + 0.1).flash).toBeLessThan(peak);
  });

  it('never exceeds the event intensity and shows an afterimage dip', () => {
    let maxFlash = 0;
    let maxDip = 0;
    for (let dt = 0; dt < EVENT_TAIL_SEC; dt += 0.004) {
      const sample = flashEnvelope(event, event.time + dt);
      maxFlash = Math.max(maxFlash, sample.flash);
      maxDip = Math.max(maxDip, sample.dip);
    }
    expect(maxFlash).toBeLessThanOrEqual(event.intensity + 1e-9);
    expect(maxDip).toBeGreaterThan(0.1);
    expect(maxDip).toBeLessThanOrEqual(1);
  });

  it('is pure', () => {
    expect(flashEnvelope(event, event.time + 0.2)).toEqual(flashEnvelope(event, event.time + 0.2));
  });
});

describe('ambient event envelopes', () => {
  const event = (kind: 'flicker' | 'pulse'): AtmosphereEvent => ({
    kind,
    time: 100,
    slot: 0,
    u: 0.5,
    v: 0.5,
    intensity: 1,
    hue: -1,
    boltSeed: 1234,
    boltCount: 1
  });

  it('is zero outside the event tail', () => {
    expect(flickerLevel(event('flicker'), 99)).toBe(0);
    expect(flickerLevel(event('flicker'), 102)).toBe(0);
    expect(pulseLevel(event('pulse'), 100 + eventTailSec('pulse') + 1)).toBe(0);
  });

  it('flares at the start of a flicker and peaks mid pulse', () => {
    expect(flickerLevel(event('flicker'), 100.01)).toBeGreaterThan(0.5);
    expect(pulseLevel(event('pulse'), 102)).toBeCloseTo(1, 6);
    expect(pulseLevel(event('pulse'), 100)).toBeCloseTo(0, 6);
  });
});
