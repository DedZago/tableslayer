import { describe, expect, it } from 'vitest';
import { decodeRLE, encodeRLE } from './rle';

/**
 * Verbatim copy of the pre-optimization encoder. The optimized encodeRLE must produce identical bytes
 * because persisted masks are decoded by decodeRLE.
 */
function legacyEncode(data: Uint8Array): Uint8Array {
  if (data.length === 0) return new Uint8Array(0);

  const runs: number[] = [];
  let currentValue = data[0];
  let runLength = 1;

  runs.push(currentValue === 0 ? 0 : 1);

  for (let i = 1; i < data.length; i++) {
    if (data[i] === currentValue) {
      runLength++;
    } else {
      pushVarint(runs, runLength);
      currentValue = data[i];
      runLength = 1;
    }
  }

  pushVarint(runs, runLength);

  return new Uint8Array(runs);
}

function pushVarint(array: number[], value: number): void {
  while (value > 127) {
    array.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  array.push(value & 0x7f);
}

const seededMask = (length: number, seed: number): Uint8Array => {
  const data = new Uint8Array(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    data[i] = state >>> 31 ? 255 : 0;
  }
  return data;
};

const filled = (length: number, value: number): Uint8Array => new Uint8Array(length).fill(value);

const alternating = (length: number): Uint8Array => Uint8Array.from({ length }, (_, i) => (i % 2 ? 255 : 0));

const longRun = (): Uint8Array => {
  const data = new Uint8Array(300_001).fill(255);
  data[300_000] = 0;
  return data;
};

const cases: [string, () => Uint8Array][] = [
  ['empty', () => new Uint8Array(0)],
  ['all zeros', () => filled(1000, 0)],
  ['all 255', () => filled(1000, 255)],
  ['alternating 0/255', () => alternating(1001)],
  ['seeded random 0/255', () => seededMask(100_000, 42)],
  ['run of 300000', longRun]
];

describe('encodeRLE', () => {
  it.each(cases)('matches legacy encoder bytes for %s', (_name, build) => {
    const data = build();
    expect(encodeRLE(data)).toEqual(legacyEncode(data));
  });

  it.each(cases)('round-trips through decodeRLE for %s', (_name, build) => {
    const data = build();
    expect(decodeRLE(encodeRLE(data), data.length)).toEqual(data);
  });
});
