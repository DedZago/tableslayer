import type { SimRequest, SimResponse, SimStream } from './simProtocol';
import { createSimRunner, type SimRunner } from './simRunner';
import type { AtmosphereSim, AtmosphereSimBackend, AtmosphereSimOptions, AtmosphereSimParams } from './types';
import { createWeatherSimFallback } from './weatherSimFallback';

const WORKER_READY_TIMEOUT_MS = 10000;
const MAIN_THREAD_MIN_HZ = 6;

let warned = false;
const warnOnce = (message: string, detail?: unknown) => {
  if (warned) return;
  warned = true;
  console.warn(`[atmosphere] ${message}`, detail ?? '');
};

type FieldCallback = (data: Uint8Array, atmoTime: number) => void;
type AccumCallback = (data: Uint8Array) => void;
type BoltCallback = (id: number, vertices: Float32Array) => void;

// Creates the weather simulation. The worker (WASM, else TypeScript) is preferred; if it cannot start the
// same TypeScript core runs on the main thread at a reduced rate; if that fails the backend is 'analytic'
// and no data is emitted, so the consumer must drive everything from uniforms.
export const createAtmosphereSim = (options: AtmosphereSimOptions): AtmosphereSim => {
  let backend: AtmosphereSimBackend = 'pending';
  let worker: Worker | undefined;
  let mainRunner: SimRunner | undefined;
  let readyTimer: ReturnType<typeof setTimeout> | undefined;
  let lastParams: AtmosphereSimParams | undefined;
  let userPaused = false;
  let hidden = false;
  let disposed = false;
  let fieldCallback: FieldCallback | undefined;
  let accumCallback: AccumCallback | undefined;
  let boltCallback: BoltCallback | undefined;
  const mainThreadBolts: Array<() => void> = [];

  const send = (message: SimRequest, transfer: Transferable[] = []) => worker?.postMessage(message, transfer);
  const returnBuffer = (stream: SimStream, buffer: ArrayBuffer) => send({ type: 'return', stream, buffer }, [buffer]);

  const applyPause = () => {
    const paused = userPaused || hidden;
    if (worker) send({ type: paused ? 'pause' : 'resume' });
    if (mainRunner) paused ? mainRunner.pause() : mainRunner.resume();
  };

  const startMainThread = (reason: unknown) => {
    if (disposed || mainRunner) return;
    stopWorker();
    warnOnce('Simulation worker unavailable, running on the main thread', reason);
    try {
      mainRunner = createSimRunner({
        core: createWeatherSimFallback(),
        seed: options.seed,
        fieldSize: options.fieldSize,
        accumSize: options.accumSize,
        simHz: Math.max(MAIN_THREAD_MIN_HZ, Math.floor(options.simHz / 2)),
        emitField: (data, atmoTime) => fieldCallback?.(data, atmoTime),
        emitAccum: (data) => accumCallback?.(data)
      });
      backend = 'ts';
      if (lastParams) mainRunner.setParams(lastParams);
      mainThreadBolts.splice(0).forEach((run) => run());
      if (!userPaused && !hidden) mainRunner.resume();
    } catch (error) {
      backend = 'analytic';
      warnOnce('Simulation unavailable, using analytic wind only', error);
    }
  };

  const stopWorker = () => {
    clearTimeout(readyTimer);
    worker?.terminate();
    worker = undefined;
  };

  const handleResponse = (message: SimResponse) => {
    switch (message.type) {
      case 'ready':
        clearTimeout(readyTimer);
        backend = message.backend;
        break;
      case 'field':
        fieldCallback?.(new Uint8Array(message.buffer), message.atmoTime);
        returnBuffer('field', message.buffer);
        break;
      case 'accum':
        accumCallback?.(new Uint8Array(message.buffer));
        returnBuffer('accum', message.buffer);
        break;
      case 'bolt':
        boltCallback?.(message.id, message.vertices);
        break;
      case 'error':
        warnOnce('Simulation worker error', message.message);
        break;
    }
  };

  const startWorker = () => {
    if (typeof Worker === 'undefined' || typeof window === 'undefined') {
      startMainThread('Worker API unavailable');
      return;
    }
    try {
      worker = new Worker(new URL('./atmosphere.worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<SimResponse>) => handleResponse(event.data);
      worker.onerror = (event) => startMainThread(event.message || 'worker error');
      worker.onmessageerror = () => startMainThread('worker message error');
      readyTimer = setTimeout(() => startMainThread('worker start timed out'), WORKER_READY_TIMEOUT_MS);
      send({
        type: 'init',
        seed: options.seed,
        fieldSize: options.fieldSize,
        accumSize: options.accumSize,
        simHz: options.simHz
      });
      queueMicrotask(() => {
        if (!userPaused && !hidden) send({ type: 'resume' });
      });
    } catch (error) {
      startMainThread(error);
    }
  };

  const handleVisibilityChange = () => {
    hidden = document.hidden;
    applyPause();
  };

  if (typeof document !== 'undefined') {
    hidden = document.hidden;
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }
  startWorker();

  return {
    get backend() {
      return backend;
    },
    setParams: (params) => {
      lastParams = params;
      send({ type: 'params', params });
      mainRunner?.setParams(params);
    },
    requestBolt: (id, seed, x0, y0, x1, y1, detail) => {
      if (worker) return send({ type: 'bolt', id, seed, x0, y0, x1, y1, detail });
      const run = () => {
        const vertices = mainRunner?.bolt(seed, x0, y0, x1, y1, detail).slice();
        if (vertices) boltCallback?.(id, vertices);
      };
      if (mainRunner) run();
      else if (backend === 'pending') mainThreadBolts.push(run);
    },
    addScorch: (x, y, radius) => {
      send({ type: 'scorch', x, y, radius });
      mainRunner?.addScorch(x, y, radius);
    },
    onField: (cb) => {
      fieldCallback = cb;
    },
    onAccum: (cb) => {
      accumCallback = cb;
    },
    onBolt: (cb) => {
      boltCallback = cb;
    },
    pause: () => {
      userPaused = true;
      applyPause();
    },
    resume: () => {
      userPaused = false;
      applyPause();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', handleVisibilityChange);
      send({ type: 'dispose' });
      stopWorker();
      mainRunner?.dispose();
      mainRunner = undefined;
      fieldCallback = accumCallback = boltCallback = undefined;
    }
  };
};
