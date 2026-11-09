// Atmosphere noise chunk, shared by the map patch and the atmosphere layers (include as a string).
// Define ATMO_OCTAVES (1..3) before this chunk; loop bounds are literal so ANGLE can unroll them.
#ifndef ATMO_OCTAVES
#define ATMO_OCTAVES 3
#endif

float atmoHash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float atmoHash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 atmoHash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float atmoValueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = atmoHash21(i);
  float b = atmoHash21(i + vec2(1.0, 0.0));
  float c = atmoHash21(i + vec2(0.0, 1.0));
  float d = atmoHash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// 0..1, ATMO_OCTAVES octaves. The quintic fade keeps the lattice invisible at one octave and the fixed
// rotation turns the remaining axis-aligned grid off the map axes, so the 1-octave tier costs the same
float atmoFbm(vec2 p) {
  p = mat2(0.8, -0.6, 0.6, 0.8) * p;
  float sum = 0.0;
  float amplitude = 0.5;
  float norm = 0.0;
  for (int i = 0; i < ATMO_OCTAVES; i++) {
    sum += amplitude * atmoValueNoise(p);
    norm += amplitude;
    p = p * 2.03 + vec2(17.3, 9.1);
    amplitude *= 0.5;
  }
  return sum / norm;
}

// Divergence-free 2D vector from the noise gradient, magnitude about 0..1
vec2 atmoCurlNoise(vec2 p) {
  const float e = 0.01;
  float dx = atmoValueNoise(p + vec2(e, 0.0)) - atmoValueNoise(p - vec2(e, 0.0));
  float dy = atmoValueNoise(p + vec2(0.0, e)) - atmoValueNoise(p - vec2(0.0, e));
  return vec2(dy, -dx) / (2.0 * e) * 0.35;
}

// Two-phase flow-map advection: sample a pattern with coordinates pushed along `flow` by two
// half-period-shifted phases and cross-fade them so the pattern never visibly resets.
// Usage: atmoFlowFbm(uv * scale, flow * speed, time)
float atmoFlowFbm(vec2 p, vec2 flow, float time) {
  float phase0 = fract(time);
  float phase1 = fract(time + 0.5);
  float a = atmoFbm(p - flow * phase0);
  float b = atmoFbm(p - flow * phase1 + vec2(5.2, 1.3));
  float blend = abs(phase0 * 2.0 - 1.0);
  return mix(a, b, blend);
}
