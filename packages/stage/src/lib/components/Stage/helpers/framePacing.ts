import type { PerformanceTier } from '../components/Stage/types';

// Frames per second while nothing is interacting or changing. null = uncapped.
export const IDLE_FRAME_RATE: Record<PerformanceTier, number | null> = {
  high: null,
  medium: 30,
  low: 20
};

// Frames per second while something loops on its own (an animated spell area) but nothing else changes
export const AMBIENT_FRAME_RATE: Record<PerformanceTier, number | null> = {
  high: 60,
  medium: 30,
  low: 24
};

export const ACTIVE_WINDOW_MS = 1500;
// Ambient loops re-assert themselves every frame; this only bridges a skipped frame
export const AMBIENT_WINDOW_MS = 250;
// rAF timestamps jitter by ~1 ms; without slack a 30 fps cap on a 60 Hz display would drop to 20 fps
const FRAME_SLACK_MS = 1.5;

export type FramePacer = ReturnType<typeof createFramePacer>;

export const createFramePacer = () => {
  let activeUntil = 0;
  let ambientUntil = 0;
  let lastRenderAt = Number.NEGATIVE_INFINITY;

  const markActive = (now = performance.now(), windowMs = ACTIVE_WINDOW_MS) => {
    activeUntil = Math.max(activeUntil, now + windowMs);
  };

  const markAmbient = (now = performance.now()) => {
    ambientUntil = Math.max(ambientUntil, now + AMBIENT_WINDOW_MS);
  };

  const shouldRender = (now: number, idleFps: number | null, ambientFps: number | null = idleFps) => {
    const fps = now < ambientUntil ? ambientFps : idleFps;
    const due = fps === null || now < activeUntil || now - lastRenderAt >= 1000 / fps - FRAME_SLACK_MS;
    if (due) lastRenderAt = now;
    return due;
  };

  return { markActive, markAmbient, shouldRender };
};
