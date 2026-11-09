import { ATMO_TIME_PERIOD, atmoTimeNow, type AtmosphereSimParams } from './types';
import type { WeatherSimCore } from './weatherSimFallback';

const MAX_CATCH_UP_STEPS = 3;
const WARM_UP_SECONDS = 2;
const ACCUM_INTERVAL_MS = 500;
const MAX_ELAPSED_MS = 1000;

export interface SimRunnerOptions {
  core: WeatherSimCore;
  seed: number;
  fieldSize: number;
  accumSize: number;
  simHz: number;
  // Views point into simulation memory and are only valid during the call
  emitField: (data: Uint8Array, atmoTime: number) => void;
  emitAccum: (data: Uint8Array) => void;
}

export interface SimRunner {
  setParams: (params: AtmosphereSimParams) => void;
  bolt: (seed: number, x0: number, y0: number, x1: number, y1: number, detail: number) => Float32Array;
  addScorch: (x: number, y: number, radius: number) => void;
  pause: () => void;
  resume: () => void;
  dispose: () => void;
}

// Fixed-step pacing shared by the worker and the main-thread fallback
export const createSimRunner = (options: SimRunnerOptions): SimRunner => {
  const { core, simHz, emitField, emitAccum } = options;
  const stepSeconds = 1 / simHz;
  const stepMs = 1000 * stepSeconds;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let disposed = false;
  let lastMs = 0;
  let stepDebtMs = 0;
  let accumDebtMs = 0;

  core.init(options.seed, options.fieldSize, options.accumSize);

  const warmUp = () => {
    const steps = Math.ceil(WARM_UP_SECONDS * simHz);
    const now = atmoTimeNow();
    for (let k = 0; k < steps; k++) {
      const t = (((now - (steps - 1 - k) * stepSeconds) % ATMO_TIME_PERIOD) + ATMO_TIME_PERIOD) % ATMO_TIME_PERIOD;
      core.step(t, stepSeconds);
    }
    core.accumStep(0);
  };

  const tick = () => {
    if (!running) return;
    const nowMs = performance.now();
    const elapsed = Math.min(nowMs - lastMs, MAX_ELAPSED_MS);
    lastMs = nowMs;
    stepDebtMs += elapsed;
    accumDebtMs += elapsed;

    let steps = 0;
    while (stepDebtMs >= stepMs && steps < MAX_CATCH_UP_STEPS) {
      core.step(atmoTimeNow(), stepSeconds);
      stepDebtMs -= stepMs;
      steps++;
    }
    if (stepDebtMs >= stepMs) stepDebtMs = 0;
    if (steps > 0) emitField(core.field(), atmoTimeNow());

    if (accumDebtMs >= ACCUM_INTERVAL_MS) {
      core.accumStep(accumDebtMs / 1000);
      accumDebtMs = 0;
      emitAccum(core.accum());
    }
    timer = setTimeout(tick, Math.max(1, stepMs - stepDebtMs));
  };

  const resume = () => {
    if (running || disposed) return;
    running = true;
    warmUp();
    emitField(core.field(), atmoTimeNow());
    emitAccum(core.accum());
    lastMs = performance.now();
    stepDebtMs = 0;
    accumDebtMs = 0;
    timer = setTimeout(tick, stepMs);
  };

  const pause = () => {
    running = false;
    clearTimeout(timer);
  };

  return {
    setParams: core.setParams,
    bolt: core.bolt,
    addScorch: core.addScorch,
    pause,
    resume,
    dispose: () => {
      pause();
      disposed = true;
    }
  };
};
