import type { AtmosphereSimParams } from './types';

export type SimStream = 'field' | 'accum';

export type SimRequest =
  | { type: 'init'; seed: number; fieldSize: number; accumSize: number; simHz: number }
  | { type: 'params'; params: AtmosphereSimParams }
  | { type: 'bolt'; id: number; seed: number; x0: number; y0: number; x1: number; y1: number; detail: number }
  | { type: 'scorch'; x: number; y: number; radius: number }
  | { type: 'return'; stream: SimStream; buffer: ArrayBuffer }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'dispose' };

export type SimResponse =
  | { type: 'ready'; backend: 'wasm' | 'ts' }
  | { type: 'field'; atmoTime: number; buffer: ArrayBuffer }
  | { type: 'accum'; buffer: ArrayBuffer }
  | { type: 'bolt'; id: number; vertices: Float32Array }
  | { type: 'error'; message: string };
