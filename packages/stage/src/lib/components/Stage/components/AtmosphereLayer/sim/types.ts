// Contract between the AtmosphereController (main thread) and the simulation worker.
// See spec/atmospheric-effects.md §3.4–3.5.

export const FIELD_VMAX = 0.25;

export enum DensityMode {
  None = 0,
  EdgeInflow = 1,
  Everywhere = 2,
  Plumes = 3
}

export interface AtmosphereSimParams {
  // Radians, map UV space: 0 = toward map right (+u), PI/2 = toward map top (+v)
  windAngle: number;
  windStrength: number; // 0..1
  gustiness: number; // 0..1
  turbulence: number; // 0..1
  densityMode: DensityMode;
  densityAmount: number; // 0..1
  wetRate: number; // per second, 0 = no wetting
  snowRate: number;
  dryRate: number;
  meltRate: number;
}

export interface AtmosphereSimOptions {
  seed: number; // uint32
  fieldSize: number; // 64 | 96 | 128
  accumSize: number; // 64 | 128
  simHz: number; // 12 | 20 | 30
}

export type AtmosphereSimBackend = 'pending' | 'wasm' | 'ts' | 'analytic';

export interface AtmosphereSim {
  readonly backend: AtmosphereSimBackend;
  setParams: (params: AtmosphereSimParams) => void;
  // Bolt polyline in map UV; result arrives through onBolt as (x, y, width, brightness) quads
  requestBolt: (id: number, seed: number, x0: number, y0: number, x1: number, y1: number, detail: number) => void;
  // Burn mark written into accum alpha (map UV, radius in map-height units)
  addScorch: (x: number, y: number, radius: number) => void;
  // RGBA8 fieldSize² bytes; the array is only valid during the callback
  onField: (cb: (data: Uint8Array, atmoTime: number) => void) => void;
  // RGBA8 accumSize² bytes; only valid during the callback
  onAccum: (cb: (data: Uint8Array) => void) => void;
  onBolt: (cb: (id: number, vertices: Float32Array) => void) => void;
  pause: () => void;
  resume: () => void;
  dispose: () => void;
}

// Wall-clock synced atmosphere time in seconds, identical on every client
export const ATMO_TIME_PERIOD = 3600;
export const atmoTimeNow = (nowMs = Date.now()) => (nowMs / 1000) % ATMO_TIME_PERIOD;
