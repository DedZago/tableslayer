import type { SimRequest, SimResponse, SimStream } from './simProtocol';
import { createSimRunner, type SimRunner } from './simRunner';
import type { AtmosphereSimParams } from './types';
import wasmUrl from './weather_sim.wasm?url';
import { createWeatherSimFallback, type WeatherSimCore } from './weatherSimFallback';

const BUFFERS_PER_STREAM = 3;

interface WeatherSimExports {
  memory: WebAssembly.Memory;
  init: (seed: number, fieldSize: number, accumSize: number) => void;
  set_params: (...args: number[]) => void;
  step: (atmoTime: number, dt: number) => void;
  accum_step: (dt: number) => void;
  field_ptr: () => number;
  accum_ptr: () => number;
  bolt: (seed: number, x0: number, y0: number, x1: number, y1: number, detail: number) => number;
  bolt_ptr: () => number;
  add_scorch: (x: number, y: number, radius: number) => void;
}

const scope = self as unknown as {
  postMessage: (message: SimResponse, transfer: Transferable[]) => void;
  close: () => void;
  onmessage: ((event: MessageEvent<SimRequest>) => void) | null;
};

const post = (message: SimResponse, transfer: Transferable[] = []) => scope.postMessage(message, transfer);

const loadWasmExports = async (): Promise<WeatherSimExports> => {
  if (typeof WebAssembly === 'undefined') throw new Error('WebAssembly unavailable');
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`weather_sim.wasm responded ${response.status}`);
  try {
    const streamed = await WebAssembly.instantiateStreaming(response.clone(), {});
    return streamed.instance.exports as unknown as WeatherSimExports;
  } catch {
    const bytes = await response.arrayBuffer();
    if (!WebAssembly.validate(bytes)) throw new Error('weather_sim.wasm failed validation');
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return instance.exports as unknown as WeatherSimExports;
  }
};

const createWasmCore = (exports: WeatherSimExports): WeatherSimCore => {
  let fieldView = new Uint8Array(0);
  let accumView = new Uint8Array(0);
  return {
    init: (seed, fieldSize, accumSize) => {
      exports.init(seed, fieldSize, accumSize);
      const memory = exports.memory.buffer;
      fieldView = new Uint8Array(memory, exports.field_ptr(), fieldSize * fieldSize * 4);
      accumView = new Uint8Array(memory, exports.accum_ptr(), accumSize * accumSize * 4);
    },
    setParams: (p: AtmosphereSimParams) =>
      exports.set_params(
        p.windAngle,
        p.windStrength,
        p.gustiness,
        p.turbulence,
        p.densityMode,
        p.densityAmount,
        p.wetRate,
        p.snowRate,
        p.dryRate,
        p.meltRate
      ),
    step: exports.step,
    accumStep: exports.accum_step,
    field: () => fieldView,
    accum: () => accumView,
    bolt: (seed, x0, y0, x1, y1, detail) => {
      const count = exports.bolt(seed, x0, y0, x1, y1, detail);
      return new Float32Array(exports.memory.buffer, exports.bolt_ptr(), count * 4);
    },
    addScorch: exports.add_scorch
  };
};

const createCore = async (): Promise<{ core: WeatherSimCore; backend: 'wasm' | 'ts' }> => {
  try {
    return { core: createWasmCore(await loadWasmExports()), backend: 'wasm' };
  } catch (error) {
    console.warn('[atmosphere] WASM simulation unavailable, using the TypeScript fallback', error);
    return { core: createWeatherSimFallback(), backend: 'ts' };
  }
};

const createBufferPool = (byteLength: number) => {
  const free = Array.from({ length: BUFFERS_PER_STREAM }, () => new ArrayBuffer(byteLength));
  return {
    take: () => free.pop(),
    give: (buffer: ArrayBuffer) => {
      if (buffer.byteLength === byteLength && free.length < BUFFERS_PER_STREAM) free.push(buffer);
    }
  };
};

let runner: SimRunner | undefined;
let pools: Record<SimStream, ReturnType<typeof createBufferPool>> | undefined;
let queue: Promise<void> = Promise.resolve();

const handleInit = async (message: Extract<SimRequest, { type: 'init' }>) => {
  runner?.dispose();
  const { core, backend } = await createCore();
  const nextPools = {
    field: createBufferPool(message.fieldSize * message.fieldSize * 4),
    accum: createBufferPool(message.accumSize * message.accumSize * 4)
  };
  pools = nextPools;
  runner = createSimRunner({
    core,
    seed: message.seed,
    fieldSize: message.fieldSize,
    accumSize: message.accumSize,
    simHz: message.simHz,
    emitField: (data, atmoTime) => {
      const buffer = nextPools.field.take();
      if (!buffer) return;
      new Uint8Array(buffer).set(data);
      post({ type: 'field', atmoTime, buffer }, [buffer]);
    },
    emitAccum: (data) => {
      const buffer = nextPools.accum.take();
      if (!buffer) return;
      new Uint8Array(buffer).set(data);
      post({ type: 'accum', buffer }, [buffer]);
    }
  });
  post({ type: 'ready', backend });
};

const handleRequest = async (message: SimRequest) => {
  switch (message.type) {
    case 'init':
      return handleInit(message);
    case 'params':
      return runner?.setParams(message.params);
    case 'bolt': {
      const vertices = runner?.bolt(message.seed, message.x0, message.y0, message.x1, message.y1, message.detail);
      if (!vertices) return;
      const copy = vertices.slice();
      return post({ type: 'bolt', id: message.id, vertices: copy }, [copy.buffer]);
    }
    case 'scorch':
      return runner?.addScorch(message.x, message.y, message.radius);
    case 'return':
      return pools?.[message.stream].give(message.buffer);
    case 'pause':
      return runner?.pause();
    case 'resume':
      return runner?.resume();
    case 'dispose':
      runner?.dispose();
      runner = undefined;
      return scope.close();
  }
};

scope.onmessage = (event: MessageEvent<SimRequest>) => {
  queue = queue
    .then(() => handleRequest(event.data))
    .catch((error: unknown) =>
      post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
    );
};
