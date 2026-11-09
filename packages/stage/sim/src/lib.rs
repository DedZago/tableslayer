#![cfg_attr(not(test), no_std)]

//! Weather simulation for the stage atmosphere layer: stable-fluids wind and density field,
//! slow ground accumulation and lightning bolt geometry. Raw `extern "C"` API, no allocation.

const MAX_FIELD: usize = 128;
const MAX_ACCUM: usize = 128;
const FIELD_CELLS: usize = MAX_FIELD * MAX_FIELD;
const ACCUM_CELLS: usize = MAX_ACCUM * MAX_ACCUM;
const PSI_STRIDE: usize = MAX_FIELD + 2;
const PSI_CELLS: usize = PSI_STRIDE * PSI_STRIDE;
const BOLT_MAX_VERTS: usize = 4096;
const BOLT_MAX_BRANCHES: usize = 48;

const FIELD_VMAX: f32 = 0.25;
const CURL_MAX: f32 = 2.0;
const ATMO_PERIOD: f64 = 3600.0;

const WIND_SPEED: f32 = 0.11;
const WIND_RELAX: f32 = 0.8;
const VELOCITY_DAMPING: f32 = 0.1;
const TURBULENCE_GAIN: f32 = 0.02;
const CONFINEMENT_GAIN: f32 = 6.0;
const GUST_FREQ: f32 = 2.5;
const GUST_SECONDS_PER_CELL: f64 = 4.0;
const GUST_CELL_PERIOD: i32 = (ATMO_PERIOD / GUST_SECONDS_PER_CELL) as i32;
const NOISE_SECONDS_PER_SLICE: f64 = 12.0;
const NOISE_SLICE_PERIOD: i32 = (ATMO_PERIOD / NOISE_SECONDS_PER_SLICE) as i32;
const SCORCH_FADE_SECONDS: f32 = 60.0;

const PI: f32 = 3.1415927;
const HALF_PI: f32 = 1.5707964;
const TAU: f32 = 6.2831855;

const SEED_SALT_GUST: u32 = 0x5bd1_e995;
const SEED_SALT_TURB: u32 = 0x1b87_3593;
const SEED_SALT_DENSITY: u32 = 0x2545_f491;
const SEED_SALT_PLUME: u32 = 0x68e3_1da4;
const SEED_SALT_ACCUM: u32 = 0x7f4a_7c15;

const fn zero_params() -> Params {
  Params {
    dir_x: 0.0,
    dir_y: 0.0,
    wind_strength: 0.0,
    gustiness: 0.0,
    turbulence: 0.0,
    density_mode: 0,
    density_amount: 0.0,
    wet_rate: 0.0,
    snow_rate: 0.0,
    dry_rate: 0.0,
    melt_rate: 0.0,
  }
}

struct Params {
  dir_x: f32,
  dir_y: f32,
  wind_strength: f32,
  gustiness: f32,
  turbulence: f32,
  density_mode: u32,
  density_amount: f32,
  wet_rate: f32,
  snow_rate: f32,
  dry_rate: f32,
  melt_rate: f32,
}

struct State {
  seed: u32,
  n: usize,
  an: usize,
  params: Params,
  u: [f32; FIELD_CELLS],
  v: [f32; FIELD_CELLS],
  tu: [f32; FIELD_CELLS],
  tv: [f32; FIELD_CELLS],
  d: [f32; FIELD_CELLS],
  td: [f32; FIELD_CELLS],
  p: [f32; FIELD_CELLS],
  div: [f32; FIELD_CELLS],
  curl: [f32; FIELD_CELLS],
  psi: [f32; PSI_CELLS],
  field_out: [u8; FIELD_CELLS * 4],
  wet: [f32; ACCUM_CELLS],
  puddle: [f32; ACCUM_CELLS],
  snow: [f32; ACCUM_CELLS],
  scorch: [f32; ACCUM_CELLS],
  bias: [f32; ACCUM_CELLS],
  accum_out: [u8; ACCUM_CELLS * 4],
  bolt: [f32; BOLT_MAX_VERTS * 4],
}

impl State {
  const fn zero() -> Self {
    State {
      seed: 0,
      n: 0,
      an: 0,
      params: zero_params(),
      u: [0.0; FIELD_CELLS],
      v: [0.0; FIELD_CELLS],
      tu: [0.0; FIELD_CELLS],
      tv: [0.0; FIELD_CELLS],
      d: [0.0; FIELD_CELLS],
      td: [0.0; FIELD_CELLS],
      p: [0.0; FIELD_CELLS],
      div: [0.0; FIELD_CELLS],
      curl: [0.0; FIELD_CELLS],
      psi: [0.0; PSI_CELLS],
      field_out: [0; FIELD_CELLS * 4],
      wet: [0.0; ACCUM_CELLS],
      puddle: [0.0; ACCUM_CELLS],
      snow: [0.0; ACCUM_CELLS],
      scorch: [0.0; ACCUM_CELLS],
      bias: [0.0; ACCUM_CELLS],
      accum_out: [0; ACCUM_CELLS * 4],
      bolt: [0.0; BOLT_MAX_VERTS * 4],
    }
  }
}

static mut STATE: State = State::zero();

#[allow(static_mut_refs)]
fn state() -> &'static mut State {
  unsafe { &mut *(&raw mut STATE) }
}

#[cfg(all(not(test), target_arch = "wasm32"))]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
  core::arch::wasm32::unreachable()
}

// ---------------------------------------------------------------------------------------------
// Math without libm
// ---------------------------------------------------------------------------------------------

fn floor(x: f32) -> f32 {
  let i = x as i32 as f32;
  if i > x { i - 1.0 } else { i }
}

fn floor_f64(x: f64) -> f64 {
  let i = x as i64 as f64;
  if i > x { i - 1.0 } else { i }
}

fn clamp(x: f32, lo: f32, hi: f32) -> f32 {
  if x < lo {
    lo
  } else if x > hi {
    hi
  } else {
    x
  }
}

fn saturate(x: f32) -> f32 {
  clamp(x, 0.0, 1.0)
}

fn smoothstep(x: f32) -> f32 {
  let t = saturate(x);
  t * t * (3.0 - 2.0 * t)
}

fn sqrt(x: f32) -> f32 {
  if x <= 0.0 {
    return 0.0;
  }
  let mut y = f32::from_bits((x.to_bits() >> 1) + 0x1fbd_1df5);
  y = 0.5 * (y + x / y);
  y = 0.5 * (y + x / y);
  y
}

fn sin(x: f32) -> f32 {
  let mut a = x - TAU * floor(x / TAU + 0.5);
  if a > HALF_PI {
    a = PI - a;
  } else if a < -HALF_PI {
    a = -PI - a;
  }
  let a2 = a * a;
  a * (1.0 + a2 * (-1.0 / 6.0 + a2 * (1.0 / 120.0 + a2 * (-1.0 / 5040.0 + a2 * (1.0 / 362880.0)))))
}

fn cos(x: f32) -> f32 {
  sin(x + HALF_PI)
}

fn triangle(x: f32) -> f32 {
  let f = x - floor(x);
  (f - 0.5).abs() * 2.0
}

fn hash32(mut x: u32) -> u32 {
  x ^= x >> 16;
  x = x.wrapping_mul(0x7feb_352d);
  x ^= x >> 15;
  x = x.wrapping_mul(0x846c_a68b);
  x ^ (x >> 16)
}

fn hash01(x: u32) -> f32 {
  (hash32(x) >> 8) as f32 * (1.0 / 16_777_216.0)
}

fn hash_cell(seed: u32, x: i32, y: i32, z: i32) -> f32 {
  hash01(
    seed
      ^ (x as u32).wrapping_mul(0x9e37_79b1)
      ^ (y as u32).wrapping_mul(0x85eb_ca77)
      ^ (z as u32).wrapping_mul(0xc2b2_ae3d),
  )
}

fn value_noise(seed: u32, x: f32, y: f32, slice: i32) -> f32 {
  let fx = floor(x);
  let fy = floor(y);
  let tx = smoothstep(x - fx);
  let ty = smoothstep(y - fy);
  let ix = fx as i32;
  let iy = fy as i32;
  let a = hash_cell(seed, ix, iy, slice);
  let b = hash_cell(seed, ix + 1, iy, slice);
  let c = hash_cell(seed, ix, iy + 1, slice);
  let d = hash_cell(seed, ix + 1, iy + 1, slice);
  let top = a + (b - a) * tx;
  let bottom = c + (d - c) * tx;
  top + (bottom - top) * ty
}

fn value_noise_animated(seed: u32, x: f32, y: f32, slice: i32, blend: f32, period: i32) -> f32 {
  let a = value_noise(seed, x, y, slice.rem_euclid(period));
  let b = value_noise(seed, x, y, (slice + 1).rem_euclid(period));
  a + (b - a) * blend
}

struct Rng(u32);

impl Rng {
  fn next(&mut self) -> f32 {
    self.0 = self.0.wrapping_add(0x9e37_79b9);
    hash01(self.0)
  }
}

// ---------------------------------------------------------------------------------------------
// Fluid field
// ---------------------------------------------------------------------------------------------

#[derive(Clone, Copy)]
struct Clock {
  gust_cell: i32,
  gust_frac: f32,
  noise_slice: i32,
  noise_blend: f32,
}

impl Clock {
  fn at(atmo_time: f64) -> Self {
    let t = atmo_time - floor_f64(atmo_time / ATMO_PERIOD) * ATMO_PERIOD;
    let gust = t / GUST_SECONDS_PER_CELL;
    let gust_cell = floor_f64(gust);
    let noise = t / NOISE_SECONDS_PER_SLICE;
    let noise_slice = floor_f64(noise);
    Clock {
      gust_cell: gust_cell as i32,
      gust_frac: (gust - gust_cell) as f32,
      noise_slice: noise_slice as i32,
      noise_blend: smoothstep((noise - noise_slice) as f32),
    }
  }
}

fn idx(n: usize, i: isize, j: isize) -> usize {
  let ci = if i < 0 { 0 } else if i >= n as isize { n - 1 } else { i as usize };
  let cj = if j < 0 { 0 } else if j >= n as isize { n - 1 } else { j as usize };
  cj * n + ci
}

fn sample(src: &[f32], n: usize, gx: f32, gy: f32) -> f32 {
  let x = clamp(gx, 0.0, (n - 1) as f32);
  let y = clamp(gy, 0.0, (n - 1) as f32);
  let x0 = x as usize;
  let y0 = y as usize;
  let x1 = if x0 + 1 < n { x0 + 1 } else { x0 };
  let y1 = if y0 + 1 < n { y0 + 1 } else { y0 };
  let tx = x - x0 as f32;
  let ty = y - y0 as f32;
  let a = src[y0 * n + x0];
  let b = src[y0 * n + x1];
  let c = src[y1 * n + x0];
  let d = src[y1 * n + x1];
  let top = a + (b - a) * tx;
  let bottom = c + (d - c) * tx;
  top + (bottom - top) * ty
}

fn advect(dst: &mut [f32], src: &[f32], u: &[f32], v: &[f32], n: usize, dt: f32) {
  let nf = n as f32;
  let scale = dt * nf;
  for j in 0..n {
    for i in 0..n {
      let k = j * n + i;
      dst[k] = sample(src, n, i as f32 - u[k] * scale, j as f32 - v[k] * scale);
    }
  }
}

fn compute_curl(curl: &mut [f32], u: &[f32], v: &[f32], n: usize) {
  let half_n = 0.5 * n as f32;
  for j in 0..n as isize {
    for i in 0..n as isize {
      let dvdx = v[idx(n, i + 1, j)] - v[idx(n, i - 1, j)];
      let dudy = u[idx(n, i, j + 1)] - u[idx(n, i, j - 1)];
      curl[idx(n, i, j)] = (dvdx - dudy) * half_n;
    }
  }
}

fn confine_vorticity(s: &mut State, dt: f32) {
  let n = s.n;
  let eps = s.params.turbulence * CONFINEMENT_GAIN;
  if eps <= 0.0 {
    return;
  }
  let h = 1.0 / n as f32;
  compute_curl(&mut s.curl, &s.u, &s.v, n);
  for j in 1..n as isize - 1 {
    for i in 1..n as isize - 1 {
      let gx = s.curl[idx(n, i + 1, j)].abs() - s.curl[idx(n, i - 1, j)].abs();
      let gy = s.curl[idx(n, i, j + 1)].abs() - s.curl[idx(n, i, j - 1)].abs();
      let len = sqrt(gx * gx + gy * gy) + 1e-5;
      let k = idx(n, i, j);
      let w = s.curl[k];
      let scale = dt * eps * h / len;
      s.u[k] += scale * gy * w;
      s.v[k] -= scale * gx * w;
    }
  }
}

fn divergence_at(s: &State, i: isize, j: isize) -> f32 {
  let n = s.n;
  let du = s.u[idx(n, i + 1, j)] - s.u[idx(n, i - 1, j)];
  let dv = s.v[idx(n, i, j + 1)] - s.v[idx(n, i, j - 1)];
  0.5 * n as f32 * (du + dv)
}

fn project(s: &mut State) {
  let n = s.n;
  let h = 1.0 / n as f32;
  for j in 0..n as isize {
    for i in 0..n as isize {
      s.div[idx(n, i, j)] = divergence_at(s, i, j);
    }
  }
  let iterations = if n <= 64 { 12 } else { 16 };
  let h2 = h * h;
  for _ in 0..iterations {
    for j in 0..n {
      for i in 0..n {
        let left = if i > 0 { s.p[j * n + i - 1] } else { 0.0 };
        let right = if i + 1 < n { s.p[j * n + i + 1] } else { 0.0 };
        let down = if j > 0 { s.p[(j - 1) * n + i] } else { 0.0 };
        let up = if j + 1 < n { s.p[(j + 1) * n + i] } else { 0.0 };
        s.tu[j * n + i] = 0.25 * (left + right + down + up - h2 * s.div[j * n + i]);
      }
    }
    s.p[..n * n].copy_from_slice(&s.tu[..n * n]);
  }
  let half_n = 0.5 * n as f32;
  for j in 0..n {
    for i in 0..n {
      let left = if i > 0 { s.p[j * n + i - 1] } else { 0.0 };
      let right = if i + 1 < n { s.p[j * n + i + 1] } else { 0.0 };
      let down = if j > 0 { s.p[(j - 1) * n + i] } else { 0.0 };
      let up = if j + 1 < n { s.p[(j + 1) * n + i] } else { 0.0 };
      s.u[j * n + i] -= half_n * (right - left);
      s.v[j * n + i] -= half_n * (up - down);
    }
  }
}

fn gust_at(seed: u32, clock: &Clock, dir: (f32, f32), px: f32, py: f32) -> f32 {
  let x = px - 0.5;
  let y = py - 0.5;
  let along = x * dir.0 + y * dir.1;
  let across = y * dir.0 - x * dir.1;
  let q = along * GUST_FREQ + 0.35 * triangle(across * 4.0) - clock.gust_frac;
  let fl = floor(q);
  let local = q - fl;
  let cell = (fl as i32 - clock.gust_cell).rem_euclid(GUST_CELL_PERIOD);
  let bump = 4.0 * local * (1.0 - local);
  bump * bump * hash01(seed ^ SEED_SALT_GUST ^ (cell as u32).wrapping_mul(0x9e37_79b1))
}

fn fill_turbulence_potential(s: &mut State, clock: &Clock) {
  let n = s.n;
  let seed = s.seed ^ SEED_SALT_TURB;
  let stride = n + 2;
  let nf = n as f32;
  for j in 0..stride {
    let py = (j as f32 - 0.5) / nf;
    for i in 0..stride {
      let px = (i as f32 - 0.5) / nf;
      let coarse = value_noise_animated(seed, px * 4.0, py * 4.0, clock.noise_slice, clock.noise_blend, NOISE_SLICE_PERIOD);
      let fine = value_noise_animated(seed ^ 0x55, px * 8.0, py * 8.0, clock.noise_slice, clock.noise_blend, NOISE_SLICE_PERIOD);
      s.psi[j * PSI_STRIDE + i] = 0.65 * coarse + 0.35 * fine;
    }
  }
}

fn relax_toward_wind(s: &mut State, clock: &Clock, dt: f32) {
  let n = s.n;
  let nf = n as f32;
  let p = &s.params;
  let dir = (p.dir_x, p.dir_y);
  let relax = dt * WIND_RELAX / (1.0 + dt * WIND_RELAX);
  let damping = 1.0 / (1.0 + dt * VELOCITY_DAMPING);
  let turbulent = p.turbulence > 0.0;
  if turbulent {
    fill_turbulence_potential(s, clock);
  }
  let p = &s.params;
  let half_n = 0.5 * nf;
  for j in 0..n {
    let py = (j as f32 + 0.5) / nf;
    for i in 0..n {
      let px = (i as f32 + 0.5) / nf;
      let gust = gust_at(s.seed, clock, dir, px, py);
      let mult = clamp(1.0 + p.gustiness * (1.8 * gust - 0.5), 0.1, 2.0);
      let speed = p.wind_strength * WIND_SPEED * mult;
      let mut tx = dir.0 * speed;
      let mut ty = dir.1 * speed;
      if turbulent {
        let c = (j + 1) * PSI_STRIDE + i + 1;
        let dpdx = (s.psi[c + 1] - s.psi[c - 1]) * half_n;
        let dpdy = (s.psi[c + PSI_STRIDE] - s.psi[c - PSI_STRIDE]) * half_n;
        tx += p.turbulence * TURBULENCE_GAIN * dpdy;
        ty -= p.turbulence * TURBULENCE_GAIN * dpdx;
      }
      let k = j * n + i;
      s.u[k] = (s.u[k] + (tx - s.u[k]) * relax) * damping;
      s.v[k] = (s.v[k] + (ty - s.v[k]) * relax) * damping;
    }
  }
}

fn clamp_velocity(s: &mut State) {
  let cells = s.n * s.n;
  for k in 0..cells {
    s.u[k] = clamp(s.u[k], -FIELD_VMAX, FIELD_VMAX);
    s.v[k] = clamp(s.v[k], -FIELD_VMAX, FIELD_VMAX);
  }
}

fn update_density(s: &mut State, clock: &Clock, dt: f32) {
  let n = s.n;
  let nf = n as f32;
  advect(&mut s.td, &s.d, &s.u, &s.v, n, dt);
  let p = &s.params;
  let dir = (p.dir_x, p.dir_y);
  let amount = p.density_amount;
  let mode = p.density_mode;
  let smax = 0.5 * (dir.0.abs() + dir.1.abs());
  let density_seed = s.seed ^ SEED_SALT_DENSITY;
  let plume_seed = s.seed ^ SEED_SALT_PLUME;
  let fade = 1.0 / (1.0 + dt * if mode == 0 { 0.6 } else { 0.04 });
  for j in 0..n {
    let py = (j as f32 + 0.5) / nf;
    for i in 0..n {
      let px = (i as f32 + 0.5) / nf;
      let k = j * n + i;
      let mut value = s.td[k];
      let (target, rate) = match mode {
        1 => {
          let upwind = -((px - 0.5) * dir.0 + (py - 0.5) * dir.1) / smax.max(1e-4);
          let edge = saturate((upwind - 0.85) / 0.15);
          let front = 0.25 + 0.75 * gust_at(s.seed, clock, dir, px, py);
          (amount * front, 2.5 * edge)
        }
        2 => {
          let noise = value_noise_animated(density_seed, px * 3.0, py * 3.0, clock.noise_slice, clock.noise_blend, NOISE_SLICE_PERIOD);
          (amount * (0.35 + 0.65 * noise), 0.4)
        }
        3 => {
          let mut influence = 0.0f32;
          for plume in 0..4u32 {
            let cx = 0.15 + 0.7 * hash01(plume_seed ^ plume.wrapping_mul(0x9e37_79b1));
            let cy = 0.15 + 0.7 * hash01(plume_seed ^ plume.wrapping_mul(0x85eb_ca77) ^ 0x33);
            let r2 = (px - cx) * (px - cx) + (py - cy) * (py - cy);
            let w = saturate(1.0 - r2 / 0.0064);
            influence = influence.max(w * w);
          }
          (amount, 3.0 * influence)
        }
        _ => (0.0, 0.0),
      };
      value += (target - value) * (dt * rate / (1.0 + dt * rate));
      s.d[k] = saturate(value * fade);
    }
  }
}

fn encode_field(s: &mut State) {
  let n = s.n;
  compute_curl(&mut s.curl, &s.u, &s.v, n);
  for k in 0..n * n {
    let o = k * 4;
    s.field_out[o] = encode_signed(s.u[k] / FIELD_VMAX);
    s.field_out[o + 1] = encode_signed(s.v[k] / FIELD_VMAX);
    s.field_out[o + 2] = encode_unsigned(s.d[k]);
    s.field_out[o + 3] = encode_signed(s.curl[k] / CURL_MAX);
  }
}

fn encode_signed(x: f32) -> u8 {
  encode_unsigned(clamp(x, -1.0, 1.0) * 0.5 + 0.5)
}

fn encode_unsigned(x: f32) -> u8 {
  (saturate(x) * 255.0 + 0.5) as u8
}

fn step_field(s: &mut State, atmo_time: f64, dt: f32) {
  let dt = clamp(dt, 0.0, 0.1);
  let clock = Clock::at(atmo_time);
  let n = s.n;
  relax_toward_wind(s, &clock, dt);
  confine_vorticity(s, dt);
  clamp_velocity(s);
  advect(&mut s.tu, &s.u, &s.u, &s.v, n, dt);
  advect(&mut s.tv, &s.v, &s.u, &s.v, n, dt);
  s.u[..n * n].copy_from_slice(&s.tu[..n * n]);
  s.v[..n * n].copy_from_slice(&s.tv[..n * n]);
  project(s);
  clamp_velocity(s);
  update_density(s, &clock, dt);
  encode_field(s);
}

// ---------------------------------------------------------------------------------------------
// Accumulation
// ---------------------------------------------------------------------------------------------

fn fill_accum_bias(s: &mut State) {
  let an = s.an;
  let seed = s.seed ^ SEED_SALT_ACCUM;
  for j in 0..an {
    for i in 0..an {
      let x = (i as f32 + 0.5) / an as f32;
      let y = (j as f32 + 0.5) / an as f32;
      s.bias[j * an + i] = 0.65 * value_noise(seed, x * 5.0, y * 5.0, 0) + 0.35 * value_noise(seed, x * 11.0, y * 11.0, 1);
    }
  }
}

fn step_accum(s: &mut State, dt: f32) {
  let dt = clamp(dt, 0.0, 2.0);
  let an = s.an;
  let n = s.n;
  let p = &s.params;
  let (wet_rate, snow_rate, dry_rate, melt_rate) = (p.wet_rate, p.snow_rate, p.dry_rate, p.melt_rate);
  let scorch_fade = dt / SCORCH_FADE_SECONDS;
  for j in 0..an {
    let fj = (j * n / an) as isize;
    for i in 0..an {
      let k = j * an + i;
      let bias = s.bias[k];
      let fi = (i * n / an) as isize;

      if wet_rate > 0.0 {
        s.wet[k] += wet_rate * dt * (0.8 + 0.4 * bias);
      } else {
        s.wet[k] -= dry_rate * dt;
      }
      s.wet[k] = saturate(s.wet[k]);

      if wet_rate > 0.0 && s.wet[k] > 0.5 {
        s.puddle[k] += wet_rate * 0.6 * dt * (0.15 + 1.4 * bias * bias);
      } else if wet_rate <= 0.0 {
        s.puddle[k] -= dry_rate * 0.4 * dt;
      }
      s.puddle[k] = saturate(s.puddle[k]);

      if snow_rate > 0.0 {
        let convergence = -divergence_at(s, fi, fj);
        let drift = clamp(1.0 + 2.5 * convergence, 0.4, 1.8) * (0.8 + 0.4 * bias);
        s.snow[k] += snow_rate * dt * drift;
      } else {
        s.snow[k] -= melt_rate * dt;
      }
      s.snow[k] = saturate(s.snow[k]);

      s.scorch[k] = saturate(s.scorch[k] - scorch_fade);

      let o = k * 4;
      s.accum_out[o] = encode_unsigned(s.wet[k]);
      s.accum_out[o + 1] = encode_unsigned(s.puddle[k]);
      s.accum_out[o + 2] = encode_unsigned(s.snow[k]);
      s.accum_out[o + 3] = encode_unsigned(s.scorch[k]);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Lightning
// ---------------------------------------------------------------------------------------------

#[derive(Clone, Copy)]
struct Branch {
  x0: f32,
  y0: f32,
  x1: f32,
  y1: f32,
  depth: u32,
  level: u32,
  width: f32,
  brightness: f32,
}

const NO_BRANCH: Branch = Branch { x0: 0.0, y0: 0.0, x1: 0.0, y1: 0.0, depth: 0, level: 0, width: 0.0, brightness: 0.0 };

fn push_vertex(s: &mut State, count: usize, x: f32, y: f32, width: f32, brightness: f32) -> usize {
  let o = count * 4;
  s.bolt[o] = x;
  s.bolt[o + 1] = y;
  s.bolt[o + 2] = width;
  s.bolt[o + 3] = brightness;
  count + 1
}

fn build_bolt(s: &mut State, seed: u32, x0: f32, y0: f32, x1: f32, y1: f32, detail: u32) -> u32 {
  let mut rng = Rng(hash32(seed ^ 0xb01_7a11));
  let mut queue = [NO_BRANCH; BOLT_MAX_BRANCHES];
  let mut queued = 1;
  let mut head = 0;
  let mut count = 0usize;
  queue[0] = Branch { x0, y0, x1, y1, depth: detail.clamp(2, 7), level: 0, width: 1.0, brightness: 1.0 };

  while head < queued {
    let b = queue[head];
    head += 1;
    let segs = 1usize << b.depth;
    if count + segs + 2 > BOLT_MAX_VERTS {
      continue;
    }
    let dx = b.x1 - b.x0;
    let dy = b.y1 - b.y0;
    let len = sqrt(dx * dx + dy * dy);
    let (ux, uy) = if len > 1e-6 { (dx / len, dy / len) } else { (0.0, 1.0) };
    let (nx, ny) = (-uy, ux);

    let mut pts = [(0.0f32, 0.0f32); 129];
    pts[0] = (b.x0, b.y0);
    pts[segs] = (b.x1, b.y1);
    let mut step = segs;
    let mut amp = len * 0.2;
    while step > 1 {
      let half = step / 2;
      for a in (0..segs).step_by(step) {
        let (ax, ay) = pts[a];
        let (bx, by) = pts[a + step];
        let off = (rng.next() - 0.5) * 2.0 * amp;
        pts[a + half] = (0.5 * (ax + bx) + nx * off, 0.5 * (ay + by) + ny * off);
      }
      step = half;
      amp *= 0.55;
    }

    let taper = if b.level == 0 { 0.2 } else { 0.7 };
    let branch_chance = if b.level == 0 { 0.07 } else { 0.03 };
    for (k, &(x, y)) in pts.iter().enumerate().take(segs + 1) {
      let t = k as f32 / segs as f32;
      count = push_vertex(s, count, x, y, b.width * (1.0 - taper * t), b.brightness * (1.0 - 0.25 * t));
      if k > 0 && k < segs && b.level < 2 && queued < BOLT_MAX_BRANCHES && rng.next() < branch_chance {
        let side = if rng.next() < 0.5 { -1.0 } else { 1.0 };
        let angle = side * (0.25 + 0.55 * rng.next());
        let (c, sn) = (cos(angle), sin(angle));
        let (bx, by) = (ux * c - uy * sn, ux * sn + uy * c);
        let blen = len * (0.2 + 0.25 * rng.next()) * if b.level == 0 { 1.0 } else { 0.6 };
        queue[queued] = Branch {
          x0: x,
          y0: y,
          x1: x + bx * blen,
          y1: y + by * blen,
          depth: b.depth.saturating_sub(2).max(2),
          level: b.level + 1,
          width: b.width * 0.55,
          brightness: b.brightness * 0.6,
        };
        queued += 1;
      }
    }
    count = push_vertex(s, count, 0.0, 0.0, -1.0, 0.0);
  }
  count as u32
}

fn burn_scorch(s: &mut State, x: f32, y: f32, radius: f32) {
  let an = s.an;
  let anf = an as f32;
  if radius <= 0.0 {
    return;
  }
  let j0 = floor((y - radius) * anf).max(0.0) as usize;
  let j1 = (floor((y + radius) * anf) as i32 + 1).clamp(0, an as i32) as usize;
  let i0 = floor((x - radius) * anf).max(0.0) as usize;
  let i1 = (floor((x + radius) * anf) as i32 + 1).clamp(0, an as i32) as usize;
  for j in j0..j1 {
    for i in i0..i1 {
      let dx = (i as f32 + 0.5) / anf - x;
      let dy = (j as f32 + 0.5) / anf - y;
      let falloff = saturate(1.0 - sqrt(dx * dx + dy * dy) / radius);
      let k = j * an + i;
      s.scorch[k] = s.scorch[k].max(smoothstep(falloff * 1.5));
      s.accum_out[k * 4 + 3] = encode_unsigned(s.scorch[k]);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------------------------

fn reset(s: &mut State, seed: u32, field_size: u32, accum_size: u32) {
  s.seed = seed;
  s.n = (field_size as usize).clamp(8, MAX_FIELD);
  s.an = (accum_size as usize).clamp(8, MAX_ACCUM);
  s.params = zero_params();
  s.params.dir_x = 1.0;
  for k in 0..FIELD_CELLS {
    s.u[k] = 0.0;
    s.v[k] = 0.0;
    s.tu[k] = 0.0;
    s.tv[k] = 0.0;
    s.d[k] = 0.0;
    s.td[k] = 0.0;
    s.p[k] = 0.0;
    s.div[k] = 0.0;
    s.curl[k] = 0.0;
  }
  for k in 0..ACCUM_CELLS {
    s.wet[k] = 0.0;
    s.puddle[k] = 0.0;
    s.snow[k] = 0.0;
    s.scorch[k] = 0.0;
  }
  fill_accum_bias(s);
  encode_field(s);
  step_accum(s, 0.0);
}

#[unsafe(no_mangle)]
pub extern "C" fn init(seed: u32, field_size: u32, accum_size: u32) {
  reset(state(), seed, field_size, accum_size);
}

#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn set_params(
  wind_angle_rad: f32,
  wind_strength: f32,
  gustiness: f32,
  turbulence: f32,
  density_mode: u32,
  density_amount: f32,
  wet_rate: f32,
  snow_rate: f32,
  dry_rate: f32,
  melt_rate: f32,
) {
  let p = &mut state().params;
  p.dir_x = cos(wind_angle_rad);
  p.dir_y = sin(wind_angle_rad);
  p.wind_strength = saturate(wind_strength);
  p.gustiness = saturate(gustiness);
  p.turbulence = saturate(turbulence);
  p.density_mode = density_mode;
  p.density_amount = saturate(density_amount);
  p.wet_rate = wet_rate.max(0.0);
  p.snow_rate = snow_rate.max(0.0);
  p.dry_rate = dry_rate.max(0.0);
  p.melt_rate = melt_rate.max(0.0);
}

#[unsafe(no_mangle)]
pub extern "C" fn step(atmo_time: f64, dt: f32) {
  step_field(state(), atmo_time, dt);
}

#[unsafe(no_mangle)]
pub extern "C" fn accum_step(dt: f32) {
  step_accum(state(), dt);
}

#[unsafe(no_mangle)]
pub extern "C" fn field_ptr() -> *const u8 {
  state().field_out.as_ptr()
}

#[unsafe(no_mangle)]
pub extern "C" fn accum_ptr() -> *const u8 {
  state().accum_out.as_ptr()
}

/// Writes strips of (x, y, width, brightness) vertices, each terminated by a vertex with width -1.
/// The first strip is the trunk from (x0, y0) to (x1, y1); the rest are branches. Returns the vertex count.
#[unsafe(no_mangle)]
pub extern "C" fn bolt(seed: u32, x0: f32, y0: f32, x1: f32, y1: f32, detail: u32) -> u32 {
  build_bolt(state(), seed, x0, y0, x1, y1, detail)
}

#[unsafe(no_mangle)]
pub extern "C" fn bolt_ptr() -> *const f32 {
  state().bolt.as_ptr()
}

#[unsafe(no_mangle)]
pub extern "C" fn add_scorch(x: f32, y: f32, radius: f32) {
  burn_scorch(state(), x, y, radius);
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::sync::Mutex;

  static LOCK: Mutex<()> = Mutex::new(());

  fn configure_storm() {
    set_params(0.6, 0.8, 0.7, 0.8, 2, 0.7, 0.02, 0.015, 0.005, 0.004);
  }

  fn run(seed: u32, size: u32, steps: usize) -> (Vec<u8>, Vec<u8>) {
    init(seed, size, 64);
    configure_storm();
    for k in 0..steps {
      step(100.0 + k as f64 / 30.0, 1.0 / 30.0);
    }
    for _ in 0..40 {
      accum_step(0.5);
    }
    let field = state().field_out[..(size * size * 4) as usize].to_vec();
    let accum = state().accum_out[..64 * 64 * 4].to_vec();
    (field, accum)
  }

  #[test]
  fn values_stay_bounded() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    init(7, 64, 64);
    set_params(1.0, 1.0, 1.0, 1.0, 3, 1.0, 1.0, 1.0, 0.0, 0.0);
    for k in 0..600 {
      step(k as f64 * 0.033, 0.033);
    }
    for _ in 0..200 {
      accum_step(1.0);
    }
    let s = state();
    for k in 0..64 * 64 {
      assert!(s.u[k].is_finite() && s.u[k].abs() <= FIELD_VMAX + 1e-6);
      assert!(s.v[k].is_finite() && s.v[k].abs() <= FIELD_VMAX + 1e-6);
      assert!((0.0..=1.0).contains(&s.d[k]));
      assert!((0.0..=1.0).contains(&s.wet[k]));
      assert!((0.0..=1.0).contains(&s.puddle[k]));
      assert!((0.0..=1.0).contains(&s.snow[k]));
    }
    assert!(s.wet[0] > 0.99 && s.snow[0] > 0.5);
  }

  #[test]
  fn mean_wind_follows_angle() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    init(3, 64, 64);
    set_params(HALF_PI, 1.0, 0.0, 0.0, 0, 0.0, 0.0, 0.0, 0.0, 0.0);
    for k in 0..300 {
      step(k as f64 * 0.033, 0.033);
    }
    let s = state();
    let mid = 32 * 64 + 32;
    assert!(s.v[mid] > 0.05 && s.u[mid].abs() < 0.01);
  }

  #[test]
  fn projection_reduces_divergence() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    init(1, 64, 64);
    let s = state();
    let n = s.n;
    for j in 0..n {
      for i in 0..n {
        let x = (i as f32 + 0.5) / n as f32;
        let y = (j as f32 + 0.5) / n as f32;
        s.u[j * n + i] = 0.1 * sin(TAU * 6.0 * x);
        s.v[j * n + i] = 0.1 * cos(TAU * 5.0 * y);
      }
    }
    let rms = |s: &State| {
      let mut sum = 0.0;
      for j in 2..n as isize - 2 {
        for i in 2..n as isize - 2 {
          let d = divergence_at(s, i, j);
          sum += d * d;
        }
      }
      sqrt(sum / ((n - 4) * (n - 4)) as f32)
    };
    let before = rms(s);
    for _ in 0..5 {
      project(s);
    }
    let after = rms(s);
    assert!(after < 0.35 * before, "before {before} after {after}");
  }

  #[test]
  fn deterministic_for_equal_seed_and_time() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let a = run(42, 64, 120);
    let b = run(42, 64, 120);
    let c = run(43, 64, 120);
    assert_eq!(a, b);
    assert_ne!(a.0, c.0);
  }

  #[test]
  fn time_wraps_without_jump_in_forcing() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let a = Clock::at(10.0);
    let b = Clock::at(10.0 + ATMO_PERIOD);
    assert_eq!(a.gust_cell, b.gust_cell);
    assert_eq!(a.noise_slice, b.noise_slice);
  }

  #[test]
  fn trig_matches_reference() {
    for k in -400..400 {
      let x = k as f32 * 0.05;
      assert!((sin(x) - x.sin()).abs() < 2e-4);
      assert!((cos(x) - x.cos()).abs() < 2e-4);
    }
  }

  #[test]
  fn bolt_endpoints_and_branches() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    init(1, 64, 64);
    let count = bolt(99, 0.2, 0.9, 0.7, 0.1, 6) as usize;
    assert!(count > 0 && count <= BOLT_MAX_VERTS);
    let s = state();
    assert_eq!((s.bolt[0], s.bolt[1]), (0.2, 0.9));
    let trunk_end = (0..count).find(|&k| s.bolt[k * 4 + 2] < 0.0).unwrap();
    assert_eq!(trunk_end, 65);
    assert_eq!((s.bolt[(trunk_end - 1) * 4], s.bolt[(trunk_end - 1) * 4 + 1]), (0.7, 0.1));
    assert_eq!(s.bolt[(count - 1) * 4 + 2], -1.0);
    for k in 0..count {
      assert!(s.bolt[k * 4..k * 4 + 4].iter().all(|v| v.is_finite()));
    }
    let again = s.bolt[..count * 4].to_vec();
    assert_eq!(bolt(99, 0.2, 0.9, 0.7, 0.1, 6) as usize, count);
    assert_eq!(again, state().bolt[..count * 4].to_vec());
  }

  #[test]
  fn scorch_burns_then_fades() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    init(1, 64, 64);
    add_scorch(0.5, 0.5, 0.1);
    let center = (32 * 64 + 32) * 4 + 3;
    assert!(state().accum_out[center] > 200);
    for _ in 0..70 {
      accum_step(1.0);
    }
    assert_eq!(state().accum_out[center], 0);
  }

  #[test]
  fn step_time_report() {
    let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    for size in [64u32, 96, 128] {
      init(5, size, 128);
      set_params(0.5, 0.8, 0.6, 0.8, 1, 0.8, 0.02, 0.02, 0.0, 0.0);
      let start = std::time::Instant::now();
      for k in 0..60 {
        step(k as f64 / 30.0, 1.0 / 30.0);
      }
      let field_ms = start.elapsed().as_secs_f64() * 1000.0 / 60.0;
      let start = std::time::Instant::now();
      for _ in 0..20 {
        accum_step(0.5);
      }
      println!("size {size}: step {field_ms:.3} ms (host, debug), accum {:.3} ms", start.elapsed().as_secs_f64() * 1000.0 / 20.0);
    }
  }
}
