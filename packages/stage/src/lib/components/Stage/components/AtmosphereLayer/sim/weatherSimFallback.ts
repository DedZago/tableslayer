// TypeScript port of packages/stage/sim (Rust). Same API, same texture encoding; the numerics are
// not bit-identical to the WASM build. Used when WASM or the worker is unavailable.
import { ATMO_TIME_PERIOD, type AtmosphereSimParams, FIELD_VMAX } from './types';

export interface WeatherSimCore {
  init: (seed: number, fieldSize: number, accumSize: number) => void;
  setParams: (params: AtmosphereSimParams) => void;
  step: (atmoTime: number, dt: number) => void;
  accumStep: (dt: number) => void;
  // Views stay valid until the next call that mutates the same data
  field: () => Uint8Array;
  accum: () => Uint8Array;
  bolt: (seed: number, x0: number, y0: number, x1: number, y1: number, detail: number) => Float32Array;
  addScorch: (x: number, y: number, radius: number) => void;
}

const CURL_MAX = 2;
const WIND_SPEED = 0.11;
const WIND_RELAX = 0.8;
const VELOCITY_DAMPING = 0.1;
const TURBULENCE_GAIN = 0.02;
const CONFINEMENT_GAIN = 6;
const GUST_FREQ = 2.5;
const GUST_SECONDS_PER_CELL = 4;
const GUST_CELL_PERIOD = ATMO_TIME_PERIOD / GUST_SECONDS_PER_CELL;
const NOISE_SECONDS_PER_SLICE = 12;
const NOISE_SLICE_PERIOD = ATMO_TIME_PERIOD / NOISE_SECONDS_PER_SLICE;
const SCORCH_FADE_SECONDS = 60;
const BOLT_MAX_VERTS = 4096;
const BOLT_MAX_BRANCHES = 48;

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const saturate = (x: number) => clamp(x, 0, 1);
const smoothstep = (x: number) => {
  const t = saturate(x);
  return t * t * (3 - 2 * t);
};
const triangle = (x: number) => Math.abs(x - Math.floor(x) - 0.5) * 2;
const mod = (a: number, m: number) => ((a % m) + m) % m;

const hash32 = (value: number) => {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
};
const hash01 = (x: number) => (hash32(x) >>> 8) / 16777216;
const hashCell = (seed: number, x: number, y: number, z: number) =>
  hash01(seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77) ^ Math.imul(z, 0xc2b2ae3d));

const valueNoise = (seed: number, x: number, y: number, slice: number) => {
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  const tx = smoothstep(x - fx);
  const ty = smoothstep(y - fy);
  const a = hashCell(seed, fx, fy, slice);
  const b = hashCell(seed, fx + 1, fy, slice);
  const c = hashCell(seed, fx, fy + 1, slice);
  const d = hashCell(seed, fx + 1, fy + 1, slice);
  const top = a + (b - a) * tx;
  return top + (c + (d - c) * tx - top) * ty;
};

const valueNoiseAnimated = (seed: number, x: number, y: number, slice: number, blend: number) => {
  const a = valueNoise(seed, x, y, mod(slice, NOISE_SLICE_PERIOD));
  const b = valueNoise(seed, x, y, mod(slice + 1, NOISE_SLICE_PERIOD));
  return a + (b - a) * blend;
};

const encodeUnsigned = (x: number) => Math.floor(saturate(x) * 255 + 0.5);
const encodeSigned = (x: number) => encodeUnsigned(clamp(x, -1, 1) * 0.5 + 0.5);

interface Clock {
  gustCell: number;
  gustFrac: number;
  noiseSlice: number;
  noiseBlend: number;
}

const clockAt = (atmoTime: number): Clock => {
  const t = mod(atmoTime, ATMO_TIME_PERIOD);
  const gust = t / GUST_SECONDS_PER_CELL;
  const noise = t / NOISE_SECONDS_PER_SLICE;
  return {
    gustCell: Math.floor(gust),
    gustFrac: gust - Math.floor(gust),
    noiseSlice: Math.floor(noise),
    noiseBlend: smoothstep(noise - Math.floor(noise))
  };
};

const emptyParams: AtmosphereSimParams = {
  windAngle: 0,
  windStrength: 0,
  gustiness: 0,
  turbulence: 0,
  densityMode: 0,
  densityAmount: 0,
  wetRate: 0,
  snowRate: 0,
  dryRate: 0,
  meltRate: 0
};

export const createWeatherSimFallback = (): WeatherSimCore => {
  let seed = 0;
  let n = 0;
  let an = 0;
  let params = { ...emptyParams };
  let dirX = 1;
  let dirY = 0;

  let u = new Float32Array(0);
  let v = new Float32Array(0);
  let tu = new Float32Array(0);
  let tv = new Float32Array(0);
  let d = new Float32Array(0);
  let td = new Float32Array(0);
  let p = new Float32Array(0);
  let div = new Float32Array(0);
  let curl = new Float32Array(0);
  let psi = new Float32Array(0);
  let fieldOut = new Uint8Array(0);
  let wet = new Float32Array(0);
  let puddle = new Float32Array(0);
  let snow = new Float32Array(0);
  let scorch = new Float32Array(0);
  let bias = new Float32Array(0);
  let accumOut = new Uint8Array(0);
  const boltBuffer = new Float32Array(BOLT_MAX_VERTS * 4);

  const at = (i: number, j: number) => clamp(j, 0, n - 1) * n + clamp(i, 0, n - 1);

  const sample = (src: Float32Array, gx: number, gy: number) => {
    const x = clamp(gx, 0, n - 1);
    const y = clamp(gy, 0, n - 1);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, n - 1);
    const y1 = Math.min(y0 + 1, n - 1);
    const tx = x - x0;
    const ty = y - y0;
    const top = src[y0 * n + x0] + (src[y0 * n + x1] - src[y0 * n + x0]) * tx;
    const bottom = src[y1 * n + x0] + (src[y1 * n + x1] - src[y1 * n + x0]) * tx;
    return top + (bottom - top) * ty;
  };

  const advect = (dst: Float32Array, src: Float32Array, dt: number) => {
    const scale = dt * n;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        dst[k] = sample(src, i - u[k] * scale, j - v[k] * scale);
      }
    }
  };

  const computeCurl = () => {
    const halfN = 0.5 * n;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        curl[j * n + i] = (v[at(i + 1, j)] - v[at(i - 1, j)] - (u[at(i, j + 1)] - u[at(i, j - 1)])) * halfN;
      }
    }
  };

  const confineVorticity = (dt: number) => {
    const eps = params.turbulence * CONFINEMENT_GAIN;
    if (eps <= 0) return;
    computeCurl();
    const h = 1 / n;
    for (let j = 1; j < n - 1; j++) {
      for (let i = 1; i < n - 1; i++) {
        const gx = Math.abs(curl[j * n + i + 1]) - Math.abs(curl[j * n + i - 1]);
        const gy = Math.abs(curl[(j + 1) * n + i]) - Math.abs(curl[(j - 1) * n + i]);
        const scale = (dt * eps * h) / (Math.hypot(gx, gy) + 1e-5);
        const k = j * n + i;
        u[k] += scale * gy * curl[k];
        v[k] -= scale * gx * curl[k];
      }
    }
  };

  const divergenceAt = (i: number, j: number) =>
    0.5 * n * (u[at(i + 1, j)] - u[at(i - 1, j)] + v[at(i, j + 1)] - v[at(i, j - 1)]);

  const project = () => {
    const h2 = 1 / (n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) div[j * n + i] = divergenceAt(i, j);
    const iterations = n <= 64 ? 12 : 16;
    for (let it = 0; it < iterations; it++) {
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const left = i > 0 ? p[j * n + i - 1] : 0;
          const right = i + 1 < n ? p[j * n + i + 1] : 0;
          const down = j > 0 ? p[(j - 1) * n + i] : 0;
          const up = j + 1 < n ? p[(j + 1) * n + i] : 0;
          tu[j * n + i] = 0.25 * (left + right + down + up - h2 * div[j * n + i]);
        }
      }
      p.set(tu.subarray(0, n * n));
    }
    const halfN = 0.5 * n;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const left = i > 0 ? p[j * n + i - 1] : 0;
        const right = i + 1 < n ? p[j * n + i + 1] : 0;
        const down = j > 0 ? p[(j - 1) * n + i] : 0;
        const up = j + 1 < n ? p[(j + 1) * n + i] : 0;
        u[j * n + i] -= halfN * (right - left);
        v[j * n + i] -= halfN * (up - down);
      }
    }
  };

  const gustAt = (clock: Clock, px: number, py: number) => {
    const x = px - 0.5;
    const y = py - 0.5;
    const along = x * dirX + y * dirY;
    const across = y * dirX - x * dirY;
    const q = along * GUST_FREQ + 0.35 * triangle(across * 4) - clock.gustFrac;
    const fl = Math.floor(q);
    const local = q - fl;
    const cell = mod(fl - clock.gustCell, GUST_CELL_PERIOD);
    const bump = 4 * local * (1 - local);
    return bump * bump * hash01((seed ^ 0x5bd1e995 ^ Math.imul(cell, 0x9e3779b1)) >>> 0);
  };

  const fillTurbulencePotential = (clock: Clock) => {
    const stride = n + 2;
    const turbSeed = (seed ^ 0x1b873593) >>> 0;
    for (let j = 0; j < stride; j++) {
      const py = (j - 0.5) / n;
      for (let i = 0; i < stride; i++) {
        const px = (i - 0.5) / n;
        const coarse = valueNoiseAnimated(turbSeed, px * 4, py * 4, clock.noiseSlice, clock.noiseBlend);
        const fine = valueNoiseAnimated(turbSeed ^ 0x55, px * 8, py * 8, clock.noiseSlice, clock.noiseBlend);
        psi[j * stride + i] = 0.65 * coarse + 0.35 * fine;
      }
    }
  };

  const relaxTowardWind = (clock: Clock, dt: number) => {
    const relax = (dt * WIND_RELAX) / (1 + dt * WIND_RELAX);
    const damping = 1 / (1 + dt * VELOCITY_DAMPING);
    const turbulent = params.turbulence > 0;
    if (turbulent) fillTurbulencePotential(clock);
    const stride = n + 2;
    const halfN = 0.5 * n;
    for (let j = 0; j < n; j++) {
      const py = (j + 0.5) / n;
      for (let i = 0; i < n; i++) {
        const px = (i + 0.5) / n;
        const gust = gustAt(clock, px, py);
        const mult = clamp(1 + params.gustiness * (1.8 * gust - 0.5), 0.1, 2);
        const speed = params.windStrength * WIND_SPEED * mult;
        let tx = dirX * speed;
        let ty = dirY * speed;
        if (turbulent) {
          const c = (j + 1) * stride + i + 1;
          tx += params.turbulence * TURBULENCE_GAIN * (psi[c + stride] - psi[c - stride]) * halfN;
          ty -= params.turbulence * TURBULENCE_GAIN * (psi[c + 1] - psi[c - 1]) * halfN;
        }
        const k = j * n + i;
        u[k] = (u[k] + (tx - u[k]) * relax) * damping;
        v[k] = (v[k] + (ty - v[k]) * relax) * damping;
      }
    }
  };

  const clampVelocity = () => {
    for (let k = 0; k < n * n; k++) {
      u[k] = clamp(u[k], -FIELD_VMAX, FIELD_VMAX);
      v[k] = clamp(v[k], -FIELD_VMAX, FIELD_VMAX);
    }
  };

  const updateDensity = (clock: Clock, dt: number) => {
    advect(td, d, dt);
    const { densityMode: mode, densityAmount: amount } = params;
    const smax = Math.max(0.5 * (Math.abs(dirX) + Math.abs(dirY)), 1e-4);
    const densitySeed = (seed ^ 0x2545f491) >>> 0;
    const plumeSeed = (seed ^ 0x68e31da4) >>> 0;
    const fade = 1 / (1 + dt * (mode === 0 ? 0.6 : 0.04));
    for (let j = 0; j < n; j++) {
      const py = (j + 0.5) / n;
      for (let i = 0; i < n; i++) {
        const px = (i + 0.5) / n;
        const k = j * n + i;
        let target = 0;
        let rate = 0;
        if (mode === 1) {
          const upwind = -((px - 0.5) * dirX + (py - 0.5) * dirY) / smax;
          target = amount * (0.25 + 0.75 * gustAt(clock, px, py));
          rate = 2.5 * saturate((upwind - 0.85) / 0.15);
        } else if (mode === 2) {
          const noise = valueNoiseAnimated(densitySeed, px * 3, py * 3, clock.noiseSlice, clock.noiseBlend);
          target = amount * (0.35 + 0.65 * noise);
          rate = 0.4;
        } else if (mode === 3) {
          let influence = 0;
          for (let plume = 0; plume < 4; plume++) {
            const cx = 0.15 + 0.7 * hash01((plumeSeed ^ Math.imul(plume, 0x9e3779b1)) >>> 0);
            const cy = 0.15 + 0.7 * hash01((plumeSeed ^ Math.imul(plume, 0x85ebca77) ^ 0x33) >>> 0);
            const w = saturate(1 - ((px - cx) ** 2 + (py - cy) ** 2) / 0.0064);
            influence = Math.max(influence, w * w);
          }
          target = amount;
          rate = 3 * influence;
        }
        const value = td[k] + (target - td[k]) * ((dt * rate) / (1 + dt * rate));
        d[k] = saturate(value * fade);
      }
    }
  };

  const encodeField = () => {
    computeCurl();
    for (let k = 0; k < n * n; k++) {
      const o = k * 4;
      fieldOut[o] = encodeSigned(u[k] / FIELD_VMAX);
      fieldOut[o + 1] = encodeSigned(v[k] / FIELD_VMAX);
      fieldOut[o + 2] = encodeUnsigned(d[k]);
      fieldOut[o + 3] = encodeSigned(curl[k] / CURL_MAX);
    }
  };

  const fillAccumBias = () => {
    const accumSeed = (seed ^ 0x7f4a7c15) >>> 0;
    for (let j = 0; j < an; j++) {
      for (let i = 0; i < an; i++) {
        const x = (i + 0.5) / an;
        const y = (j + 0.5) / an;
        bias[j * an + i] =
          0.65 * valueNoise(accumSeed, x * 5, y * 5, 0) + 0.35 * valueNoise(accumSeed, x * 11, y * 11, 1);
      }
    }
  };

  const accumStep = (rawDt: number) => {
    const dt = clamp(rawDt, 0, 2);
    const { wetRate, snowRate, dryRate, meltRate } = params;
    const scorchFade = dt / SCORCH_FADE_SECONDS;
    for (let j = 0; j < an; j++) {
      const fj = Math.floor((j * n) / an);
      for (let i = 0; i < an; i++) {
        const k = j * an + i;
        const b = bias[k];
        const fi = Math.floor((i * n) / an);

        wet[k] = saturate(wetRate > 0 ? wet[k] + wetRate * dt * (0.8 + 0.4 * b) : wet[k] - dryRate * dt);

        if (wetRate > 0 && wet[k] > 0.5) puddle[k] += wetRate * 0.6 * dt * (0.15 + 1.4 * b * b);
        else if (wetRate <= 0) puddle[k] -= dryRate * 0.4 * dt;
        puddle[k] = saturate(puddle[k]);

        if (snowRate > 0) {
          const drift = clamp(1 - 2.5 * divergenceAt(fi, fj), 0.4, 1.8) * (0.8 + 0.4 * b);
          snow[k] += snowRate * dt * drift;
        } else {
          snow[k] -= meltRate * dt;
        }
        snow[k] = saturate(snow[k]);

        scorch[k] = saturate(scorch[k] - scorchFade);

        const o = k * 4;
        accumOut[o] = encodeUnsigned(wet[k]);
        accumOut[o + 1] = encodeUnsigned(puddle[k]);
        accumOut[o + 2] = encodeUnsigned(snow[k]);
        accumOut[o + 3] = encodeUnsigned(scorch[k]);
      }
    }
  };

  const init = (nextSeed: number, fieldSize: number, accumSize: number) => {
    seed = nextSeed >>> 0;
    n = clamp(Math.floor(fieldSize), 8, 128);
    an = clamp(Math.floor(accumSize), 8, 128);
    params = { ...emptyParams };
    dirX = 1;
    dirY = 0;
    const cells = n * n;
    const accumCells = an * an;
    [u, v, tu, tv, d, td, p, div, curl] = Array.from({ length: 9 }, () => new Float32Array(cells));
    psi = new Float32Array((n + 2) * (n + 2));
    fieldOut = new Uint8Array(cells * 4);
    [wet, puddle, snow, scorch, bias] = Array.from({ length: 5 }, () => new Float32Array(accumCells));
    accumOut = new Uint8Array(accumCells * 4);
    fillAccumBias();
    encodeField();
    accumStep(0);
  };

  const setParams = (next: AtmosphereSimParams) => {
    params = {
      ...next,
      windStrength: saturate(next.windStrength),
      gustiness: saturate(next.gustiness),
      turbulence: saturate(next.turbulence),
      densityAmount: saturate(next.densityAmount),
      wetRate: Math.max(0, next.wetRate),
      snowRate: Math.max(0, next.snowRate),
      dryRate: Math.max(0, next.dryRate),
      meltRate: Math.max(0, next.meltRate)
    };
    dirX = Math.cos(next.windAngle);
    dirY = Math.sin(next.windAngle);
  };

  const step = (atmoTime: number, rawDt: number) => {
    const dt = clamp(rawDt, 0, 0.1);
    const clock = clockAt(atmoTime);
    relaxTowardWind(clock, dt);
    confineVorticity(dt);
    clampVelocity();
    advect(tu, u, dt);
    advect(tv, v, dt);
    u.set(tu.subarray(0, n * n));
    v.set(tv.subarray(0, n * n));
    project();
    clampVelocity();
    updateDensity(clock, dt);
    encodeField();
  };

  const bolt = (boltSeed: number, x0: number, y0: number, x1: number, y1: number, detail: number) => {
    let rngState = hash32((boltSeed ^ 0x0b017a11) >>> 0);
    const rng = () => {
      rngState = (rngState + 0x9e3779b9) >>> 0;
      return hash01(rngState);
    };
    interface Branch {
      x0: number;
      y0: number;
      x1: number;
      y1: number;
      depth: number;
      level: number;
      width: number;
      brightness: number;
    }
    const queue: Branch[] = [
      { x0, y0, x1, y1, depth: clamp(Math.floor(detail), 2, 7), level: 0, width: 1, brightness: 1 }
    ];
    let count = 0;
    const push = (x: number, y: number, width: number, brightness: number) => {
      boltBuffer.set([x, y, width, brightness], count * 4);
      count++;
    };

    for (let head = 0; head < queue.length; head++) {
      const b = queue[head];
      const segs = 1 << b.depth;
      if (count + segs + 2 > BOLT_MAX_VERTS) continue;
      const dx = b.x1 - b.x0;
      const dy = b.y1 - b.y0;
      const len = Math.hypot(dx, dy);
      const ux = len > 1e-6 ? dx / len : 0;
      const uy = len > 1e-6 ? dy / len : 1;
      const pts = new Float32Array((segs + 1) * 2);
      pts[0] = b.x0;
      pts[1] = b.y0;
      pts[segs * 2] = b.x1;
      pts[segs * 2 + 1] = b.y1;
      let amp = len * 0.2;
      for (let step = segs; step > 1; step >>= 1) {
        const half = step >> 1;
        for (let a = 0; a < segs; a += step) {
          const off = (rng() - 0.5) * 2 * amp;
          pts[(a + half) * 2] = 0.5 * (pts[a * 2] + pts[(a + step) * 2]) - uy * off;
          pts[(a + half) * 2 + 1] = 0.5 * (pts[a * 2 + 1] + pts[(a + step) * 2 + 1]) + ux * off;
        }
        amp *= 0.55;
      }
      const taper = b.level === 0 ? 0.2 : 0.7;
      const branchChance = b.level === 0 ? 0.07 : 0.03;
      for (let k = 0; k <= segs; k++) {
        const t = k / segs;
        const x = pts[k * 2];
        const y = pts[k * 2 + 1];
        push(x, y, b.width * (1 - taper * t), b.brightness * (1 - 0.25 * t));
        if (k > 0 && k < segs && b.level < 2 && queue.length < BOLT_MAX_BRANCHES && rng() < branchChance) {
          const angle = (rng() < 0.5 ? -1 : 1) * (0.25 + 0.55 * rng());
          const bx = ux * Math.cos(angle) - uy * Math.sin(angle);
          const by = ux * Math.sin(angle) + uy * Math.cos(angle);
          const blen = len * (0.2 + 0.25 * rng()) * (b.level === 0 ? 1 : 0.6);
          queue.push({
            x0: x,
            y0: y,
            x1: x + bx * blen,
            y1: y + by * blen,
            depth: Math.max(b.depth - 2, 2),
            level: b.level + 1,
            width: b.width * 0.55,
            brightness: b.brightness * 0.6
          });
        }
      }
      push(0, 0, -1, 0);
    }
    return boltBuffer.subarray(0, count * 4);
  };

  const addScorch = (x: number, y: number, radius: number) => {
    if (radius <= 0) return;
    const i0 = Math.max(0, Math.floor((x - radius) * an));
    const i1 = Math.min(an, Math.floor((x + radius) * an) + 1);
    const j0 = Math.max(0, Math.floor((y - radius) * an));
    const j1 = Math.min(an, Math.floor((y + radius) * an) + 1);
    for (let j = j0; j < j1; j++) {
      for (let i = i0; i < i1; i++) {
        const falloff = saturate(1 - Math.hypot((i + 0.5) / an - x, (j + 0.5) / an - y) / radius);
        const k = j * an + i;
        scorch[k] = Math.max(scorch[k], smoothstep(falloff * 1.5));
        accumOut[k * 4 + 3] = encodeUnsigned(scorch[k]);
      }
    }
  };

  return {
    init,
    setParams,
    step,
    accumStep,
    field: () => fieldOut,
    accum: () => accumOut,
    bolt,
    addScorch
  };
};
