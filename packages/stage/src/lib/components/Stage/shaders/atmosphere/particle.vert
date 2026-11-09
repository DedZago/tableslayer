// Stateless airborne particles (spec 3.7): position is a pure function of (seed, atmoTime).
// Space: map height units, x in 0..uAspect, y in 0..1 (the air target's orthographic camera).
// Defines: DEPTH_LAYERS 1..3, QUAD_SCALE, STRETCHED, ADDITIVE, FLIP_AMOUNT, PARTICLE_POP.
#ifndef DEPTH_LAYERS
#define DEPTH_LAYERS 1
#endif
#ifndef QUAD_SCALE
#define QUAD_SCALE 1.0
#endif
#ifndef FLIP_AMOUNT
#define FLIP_AMOUNT 0.0
#endif

attribute float aSeed;

uniform float uAspect;
uniform float uRtHeight;
uniform float uMotion;
uniform float uFieldMix;
uniform float uAtmoTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform vec2 uSize;
uniform vec2 uLife;
uniform float uFall;
uniform float uWindInfluence;
uniform float uStretch;
uniform float uFlicker;
uniform float uTumble;
uniform float uWander;
uniform float uJitter;
uniform float uHueSpread;
uniform float uAlpha;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uAmbientTint;
uniform float uAmbientExposure;
uniform float uDarkness;
uniform float uFlash;
uniform vec3 uFlashColor;

varying vec2 vLocal;
varying vec4 vColor;
varying float vSeed;
varying float vSizePx;
varying float vAge;
varying float vDepth;
varying float vStretch;

const float TAU = 6.2831853;
const float WIND_GAIN = 5.0;
const float MARGIN = 0.08;

void main() {
  float s = aSeed;
  float h0 = atmoHash11(s * 91.7 + 0.13);
  float h1 = atmoHash11(s * 37.1 + 1.71);
  float h2 = atmoHash11(s * 13.9 + 2.93);
  float h3 = atmoHash11(s * 71.3 + 5.11);
  float h4 = atmoHash11(s * 29.3 + 7.7);
  float pick = floor(atmoHash11(s * 5.3 + 4.1) * float(DEPTH_LAYERS));
  #if DEPTH_LAYERS > 1
  float z = pick / float(DEPTH_LAYERS - 1);
  #else
  float z = 0.5;
  #endif

  float cycles;
  float life = atmoWholeLife(mix(uLife.x, uLife.y, h0), cycles);
  float t = uAtmoTime + h1 * life;
  float cycleRaw = floor(t / life);
  float cycle = mod(cycleRaw, cycles);
  float age = t - cycleRaw * life;
  float u = age / life;
  vec2 r = atmoHash22(vec2(s * 113.0 + 0.5, cycle * 0.731 + 1.0));

  vec2 aspect = vec2(uAspect, 1.0);
  vec2 lo = vec2(-MARGIN);
  vec2 ext = aspect + 2.0 * MARGIN;

  #ifdef PARTICLE_POP
  vec2 pos = r * aspect;
  float fade = u < 0.12 ? u / 0.12 : pow(1.0 - (u - 0.12) / 0.88, 2.0);
  float curl = 0.0;
  vec2 vel = vec2(0.0, -1.0);
  float depthSpeed = 1.0;
  #else
  vec2 mid = lo + r * ext;
  vec2 midUv = clamp(mid / aspect, 0.0, 1.0);
  vec2 windUv = mix(uWindDir * uWindStrength * 0.25, atmoWind(midUv), uFieldMix);
  float curl = atmoCurl(midUv) * uFieldMix;
  vec2 wind = windUv * aspect * WIND_GAIN * uWindInfluence;

  vec2 windH = normalize(uWindDir * aspect + 1e-5);
  vec2 vanish = 0.5 * aspect - windH * mix(0.25, 3.0, uWindStrength);
  vec2 radial = normalize(mid - vanish);
  float depthSpeed = mix(0.55, 1.3, z);
  vec2 vel = (radial * uFall * depthSpeed + wind) * uMotion;

  float wanderPhase = h2 * TAU;
  vec2 wander = uWander * mix(0.6, 1.2, z) * vec2(sin(uAtmoTime * atmoOmega(0.111) + wanderPhase), cos(uAtmoTime * atmoOmega(0.084) + wanderPhase * 1.7));
  vec2 jitter = uJitter * vec2(
    sin(uAtmoTime * atmoOmega(5.3) + h2 * TAU) + 0.6 * sin(uAtmoTime * atmoOmega(11.7) + h3 * TAU),
    sin(uAtmoTime * atmoOmega(4.7) + h4 * TAU) + 0.6 * sin(uAtmoTime * atmoOmega(9.1) + h0 * TAU));
  vec2 pos = mid + (age - 0.5 * life) * vel + (wander + jitter) * uMotion;
  pos = lo + mod(pos - lo, ext);
  float fade = smoothstep(0.0, 0.15, u) * (1.0 - smoothstep(0.85, 1.0, u));
  #if PARTICLE_SHAPE == 15
  // A shooting star: one quick crossing at the start of each long cycle
  fade = smoothstep(0.0, 0.006, u) * (1.0 - smoothstep(0.04, 0.065, u));
  pos = mid + (age - 0.0525 * life) * vel * uMotion;
  #endif
  #endif

  float w = mix(uSize.x, uSize.y, h3) * mix(0.75, 1.3, z);
  #ifdef PARTICLE_POP
  w = uSize.y * 2.6 * (0.45 + 1.1 * u);
  #endif
  float minPx = mix(1.0, 1.6, smoothstep(300.0, 540.0, uRtHeight));
  float cover = clamp(w * uRtHeight / minPx, 0.0, 1.0);
  w = max(w, minPx / uRtHeight);

  float a = uAlpha * fade * cover * mix(1.0, 0.72, z);
  a *= 1.0 - uFlicker * (0.5 + 0.5 * sin(uAtmoTime * atmoOmega(0.4 + h0 * 1.6) + h1 * TAU));

  vec2 offset;
  #if STRETCHED
  float speed = length(vel);
  vec2 axis = speed > 1e-5 ? vel / speed : vec2(0.0, -1.0);
  float len = w * uStretch * QUAD_SCALE * mix(0.8, 1.4, z);
  offset = axis * (position.x * len) + vec2(-axis.y, axis.x) * (position.y * w * QUAD_SCALE);
  vLocal = position.xy * 2.0;
  #else
  float spin = TAU * (h2 + uTumble * age * (0.6 + abs(curl)) * (h4 > 0.5 ? 1.0 : -1.0) * uMotion);
  vec2 q = position.xy * w * QUAD_SCALE;
  float flip = mix(1.0, max(0.18, abs(cos(spin * 0.7 + h3 * TAU))), FLIP_AMOUNT);
  q.x *= flip;
  float c = cos(spin);
  float sn = sin(spin);
  offset = vec2(c * q.x - sn * q.y, sn * q.x + c * q.y);
  vLocal = position.xy * 2.0;
  #endif

  vec3 base = mix(uColorA, uColorB, h4);
  if (uHueSpread > 0.0) base = atmoHueRotate(base, (h0 - 0.5) * uHueSpread * 0.0174533);
  #ifdef ADDITIVE
  vec3 tint = base;
  #else
  vec3 lit = max(mix(vec3(1.0), uAmbientTint, uDarkness * 0.45) * mix(1.0, uAmbientExposure, 0.8) * (1.0 - 0.5 * uDarkness), 0.3);
  vec3 tint = base * lit + uFlash * uFlashColor * 0.55;
  #endif

  vColor = vec4(tint, a);
  vSeed = h3;
  vSizePx = w * uRtHeight;
  vAge = u;
  vDepth = z;
  #if STRETCHED
  vStretch = max(uStretch * mix(0.8, 1.4, z), 1.0);
  #else
  vStretch = 1.0;
  #endif
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos + offset, 0.0, 1.0);
}
