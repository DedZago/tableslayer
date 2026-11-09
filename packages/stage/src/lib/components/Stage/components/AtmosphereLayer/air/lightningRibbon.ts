import { hash32 } from '../../../helpers/atmosphereEvents';

/** Input vertices (all bolts together) the ribbon buffers hold; each becomes two ribbon vertices */
export const MAX_BOLT_VERTS = 4096;
const MAX_MITER = 2.5;
const FALLBACK_SEGMENTS = 24;

export interface RibbonBuffers {
  /** Polyline point in map px */
  position: Float32Array;
  /** Unit normal times the miter factor */
  perp: Float32Array;
  /** side -1..1, width factor, brightness */
  vert: Float32Array;
  /** strike atmoTime, seed, intensity */
  bolt: Float32Array;
  color: Float32Array;
  index: Uint16Array;
}

export interface RibbonCursor {
  vertices: number;
  indices: number;
}

export interface BoltRibbonSource {
  /** (x, y, width, brightness) per vertex in map UV; width -1 separates strips */
  vertices: Float32Array;
  startedAt: number;
  seed: number;
  intensity: number;
  color: [number, number, number];
}

export const createRibbonBuffers = (): RibbonBuffers => ({
  position: new Float32Array(MAX_BOLT_VERTS * 2 * 3),
  perp: new Float32Array(MAX_BOLT_VERTS * 2 * 2),
  vert: new Float32Array(MAX_BOLT_VERTS * 2 * 3),
  bolt: new Float32Array(MAX_BOLT_VERTS * 2 * 3),
  color: new Float32Array(MAX_BOLT_VERTS * 2 * 3),
  index: new Uint16Array(MAX_BOLT_VERTS * 6)
});

const unitSeed = (value: number) => hash32(value | 0) / 4294967296;

/**
 * Appends one bolt's strips to the buffers as a triangle list with mitred normals. Points convert from map
 * UV to map px centred on the map. Stops quietly when the buffers are full.
 */
export const appendBoltRibbon = (
  buffers: RibbonBuffers,
  cursor: RibbonCursor,
  source: BoltRibbonSource,
  mapWidth: number,
  mapHeight: number
) => {
  const { vertices } = source;
  const total = Math.floor(vertices.length / 4);
  let stripStart = 0;
  for (let i = 0; i <= total; i++) {
    const isBreak = i === total || vertices[i * 4 + 2] < 0;
    if (!isBreak) continue;
    const count = i - stripStart;
    if (count >= 2 && cursor.vertices + count * 2 <= MAX_BOLT_VERTS * 2)
      writeStrip(buffers, cursor, source, stripStart, count, mapWidth, mapHeight);
    stripStart = i + 1;
  }
};

const writeStrip = (
  buffers: RibbonBuffers,
  cursor: RibbonCursor,
  source: BoltRibbonSource,
  start: number,
  count: number,
  mapWidth: number,
  mapHeight: number
) => {
  const { vertices } = source;
  const firstVertex = cursor.vertices;
  for (let k = 0; k < count; k++) {
    const at = (start + k) * 4;
    const x = (vertices[at] - 0.5) * mapWidth;
    const y = (vertices[at + 1] - 0.5) * mapHeight;
    const prev = (start + Math.max(0, k - 1)) * 4;
    const next = (start + Math.min(count - 1, k + 1)) * 4;
    let inX = (vertices[at] - vertices[prev]) * mapWidth;
    let inY = (vertices[at + 1] - vertices[prev + 1]) * mapHeight;
    let outX = (vertices[next] - vertices[at]) * mapWidth;
    let outY = (vertices[next + 1] - vertices[at + 1]) * mapHeight;
    const inLength = Math.hypot(inX, inY);
    const outLength = Math.hypot(outX, outY);
    if (inLength < 1e-6) [inX, inY] = outLength < 1e-6 ? [0, -1] : [outX / outLength, outY / outLength];
    else [inX, inY] = [inX / inLength, inY / inLength];
    if (outLength < 1e-6) [outX, outY] = [inX, inY];
    else [outX, outY] = [outX / outLength, outY / outLength];
    let nx = -inY - outY;
    let ny = inX + outX;
    const nLength = Math.hypot(nx, ny);
    if (nLength < 1e-6) [nx, ny] = [-outY, outX];
    else [nx, ny] = [nx / nLength, ny / nLength];
    const alignment = Math.max(1 / MAX_MITER, nx * -outY + ny * outX);
    const miter = 1 / alignment;
    for (let side = -1; side <= 1; side += 2) {
      const v = cursor.vertices++;
      buffers.position.set([x, y, 0], v * 3);
      buffers.perp.set([nx * miter, ny * miter], v * 2);
      buffers.vert.set([side, vertices[at + 2], vertices[at + 3]], v * 3);
      buffers.bolt.set([source.startedAt, unitSeed(source.seed), source.intensity], v * 3);
      buffers.color.set(source.color, v * 3);
    }
  }
  for (let k = 0; k < count - 1; k++) {
    const a = firstVertex + k * 2;
    buffers.index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], cursor.indices);
    cursor.indices += 6;
  }
};

/** A jagged straight bolt for when the simulation cannot answer (analytic fallback) */
export const writeFallbackBolt = (
  target: Float32Array,
  seed: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
) => {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  for (let i = 0; i <= FALLBACK_SEGMENTS; i++) {
    const t = i / FALLBACK_SEGMENTS;
    const edge = Math.min(1, Math.min(t, 1 - t) * 6);
    const jitter = (unitSeed(seed + i * 977) - 0.5) * 0.06 * edge;
    target.set([x0 + dx * t + nx * jitter, y0 + dy * t + ny * jitter, 1 - 0.7 * t, 1 - 0.25 * t], i * 4);
  }
  target.set([0, 0, -1, 0], (FALLBACK_SEGMENTS + 1) * 4);
  return target.subarray(0, (FALLBACK_SEGMENTS + 2) * 4);
};

export const FALLBACK_BOLT_FLOATS = (FALLBACK_SEGMENTS + 2) * 4;
