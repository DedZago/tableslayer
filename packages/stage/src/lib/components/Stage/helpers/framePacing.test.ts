import { describe, expect, it } from 'vitest';
import {
  ACTIVE_WINDOW_MS,
  AMBIENT_FRAME_RATE,
  AMBIENT_WINDOW_MS,
  createFramePacer,
  IDLE_FRAME_RATE
} from './framePacing';

const simulate = (frameIntervalMs: number, frames: number, idleFps: number | null, activeAt: number[] = []) => {
  const pacer = createFramePacer();
  const rendered: number[] = [];
  for (let i = 0; i < frames; i++) {
    const now = i * frameIntervalMs;
    if (activeAt.includes(i)) pacer.markActive(now);
    if (pacer.shouldRender(now, idleFps)) rendered.push(i);
  }
  return rendered;
};

const gaps = (frames: number[]) => frames.slice(1).map((frame, index) => frame - frames[index]);

describe('createFramePacer', () => {
  it('renders every frame when uncapped', () => {
    expect(simulate(16.667, 60, null)).toHaveLength(60);
  });

  it('renders every frame while active, then falls back to the idle cap', () => {
    const activeFrames = Math.ceil(ACTIVE_WINDOW_MS / 16.667);
    const rendered = simulate(16.667, activeFrames + 60, 30, [0]);
    const idleRendered = rendered.filter((frame) => frame >= activeFrames);

    expect(rendered.slice(0, activeFrames)).toEqual(Array.from({ length: activeFrames }, (_, i) => i));
    expect(gaps(idleRendered).every((gap) => gap === 2)).toBe(true);
  });

  it('renders every 2nd frame of a 60 Hz loop at 30 fps', () => {
    const rendered = simulate(16.667, 120, 30);
    expect(gaps(rendered).every((gap) => gap === 2)).toBe(true);
  });

  it('renders every 3rd frame of a 60 Hz loop at 20 fps', () => {
    const rendered = simulate(16.667, 120, 20);
    expect(gaps(rendered).every((gap) => gap === 3)).toBe(true);
  });

  it('renders every 4th frame of a 120 Hz loop at 30 fps', () => {
    const rendered = simulate(8.333, 240, 30);
    expect(gaps(rendered).every((gap) => gap === 4)).toBe(true);
  });

  it('does not shorten the idle cap when markActive is called again', () => {
    const pacer = createFramePacer();
    pacer.markActive(0, 0);
    expect(pacer.shouldRender(0, 30)).toBe(true);
    expect(pacer.shouldRender(16.667, 30)).toBe(false);
  });
});

describe('ambient pacing', () => {
  const frames = (idleFps: number | null, ambientFps: number | null, ambientEvery: boolean, count = 120) => {
    const pacer = createFramePacer();
    const rendered: number[] = [];
    for (let i = 0; i < count; i++) {
      const now = i * 16.667;
      if (ambientEvery) pacer.markAmbient(now);
      if (pacer.shouldRender(now, idleFps, ambientFps)) rendered.push(i);
    }
    return rendered;
  };

  it('renders an ambient loop at the ambient rate instead of uncapped', () => {
    const rendered = frames(20, 30, true);
    expect(gaps(rendered).every((gap) => gap === 2)).toBe(true);
    expect(rendered.length).toBeLessThan(70);
  });

  it('falls back to the idle rate once nothing loops', () => {
    const pacer = createFramePacer();
    pacer.markAmbient(0);
    expect(pacer.shouldRender(AMBIENT_WINDOW_MS + 100, 20, 60)).toBe(true);
    expect(pacer.shouldRender(AMBIENT_WINDOW_MS + 100 + 16.667, 20, 60)).toBe(false);
  });

  it('lets activity override the ambient cap', () => {
    const pacer = createFramePacer();
    pacer.markAmbient(0);
    pacer.markActive(0);
    expect([0, 16.667, 33.333].map((now) => pacer.shouldRender(now, 20, 24))).toEqual([true, true, true]);
  });

  it('keeps the ambient rate within the tier limits', () => {
    expect(AMBIENT_FRAME_RATE).toEqual({ high: 60, medium: 30, low: 24 });
    expect(AMBIENT_FRAME_RATE.low).toBeGreaterThan(IDLE_FRAME_RATE.low ?? 0);
  });
});
