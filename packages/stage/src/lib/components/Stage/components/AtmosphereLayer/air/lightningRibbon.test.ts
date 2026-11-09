import { describe, expect, it } from 'vitest';
import { appendBoltRibbon, createRibbonBuffers, writeFallbackBolt, type RibbonCursor } from './lightningRibbon';

const source = (vertices: number[]) => ({
  vertices: new Float32Array(vertices),
  startedAt: 10,
  seed: 5,
  intensity: 0.8,
  color: [1, 1, 1] as [number, number, number]
});

describe('appendBoltRibbon', () => {
  it('emits two vertices per point and two triangles per segment', () => {
    const buffers = createRibbonBuffers();
    const cursor: RibbonCursor = { vertices: 0, indices: 0 };
    appendBoltRibbon(buffers, cursor, source([0.5, 1, 1, 1, 0.5, 0.5, 0.8, 1, 0.6, 0, 0.5, 0.9]), 100, 100);
    expect(cursor.vertices).toBe(6);
    expect(cursor.indices).toBe(12);
  });

  it('splits strips at width -1 sentinels and skips one-point strips', () => {
    const buffers = createRibbonBuffers();
    const cursor: RibbonCursor = { vertices: 0, indices: 0 };
    appendBoltRibbon(
      buffers,
      cursor,
      source([
        0.5, 1, 1, 1, 0.5, 0.5, 1, 1, 0, 0, -1, 0, 0.2, 0.2, 0.5, 1, 0.3, 0.1, 0.5, 1, 0, 0, -1, 0, 0.9, 0.9, 1, 1
      ]),
      100,
      100
    );
    expect(cursor.vertices).toBe(8);
    expect(cursor.indices).toBe(12);
  });

  it('centres positions on the map and keeps normals finite on degenerate segments', () => {
    const buffers = createRibbonBuffers();
    const cursor: RibbonCursor = { vertices: 0, indices: 0 };
    appendBoltRibbon(buffers, cursor, source([0.5, 0.5, 1, 1, 0.5, 0.5, 1, 1]), 200, 100);
    expect(buffers.position[0]).toBeCloseTo(0);
    expect(buffers.position[1]).toBeCloseTo(0);
    expect(Number.isFinite(buffers.perp[0])).toBe(true);
    expect(Number.isFinite(buffers.perp[1])).toBe(true);
  });
});

describe('writeFallbackBolt', () => {
  it('writes a strip ending in a sentinel from start to end', () => {
    const target = new Float32Array(26 * 4);
    const vertices = writeFallbackBolt(target, 3, 0.5, 1, 0.5, 0.2);
    expect(vertices.length % 4).toBe(0);
    expect(vertices[0]).toBeCloseTo(0.5);
    expect(vertices[vertices.length - 2]).toBe(-1);
  });
});
