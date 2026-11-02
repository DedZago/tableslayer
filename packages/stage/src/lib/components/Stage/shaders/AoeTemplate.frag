precision highp float;

#ifndef EFFECT_TYPE
#define EFFECT_TYPE 0
#endif

uniform float uTime;
uniform float uSeed;
uniform float uSpeed;
uniform float uOpacity;
uniform float uFade;
uniform float uSize;
uniform float uWidth;
uniform float uFeather;
uniform int uShape;
uniform int uPerformanceTier;
uniform vec2 uQuadSize;
uniform vec2 uQuadCenter;
uniform vec3 uColor;
uniform vec4 uClippingPlanes[NUM_CLIPPING_PLANES];

varying vec2 vUv;
varying vec3 vWorldPosition;

float hash12(vec2 p) {
  vec3 q = fract(p.xyx * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

vec2 hash22(vec2 p) {
  vec3 q = fract(p.xyx * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
    mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  int octaves = uPerformanceTier == 0 ? 4 : (uPerformanceTier == 1 ? 3 : 2);
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    if (i >= octaves) break;
    s += a * vnoise(p);
    p = p * 2.03 + 17.0;
    a *= 0.5;
  }
  return s;
}

// Returns (F1, F2 - F1) for a jittered 3x3 Voronoi; the jitter is animated by t
vec2 voronoi(vec2 p, float t) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = 0.5 + 0.5 * sin(t + 6.2831853 * hash22(n + g));
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < d1) {
        d2 = d1;
        d1 = d;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  return vec2(sqrt(d1), sqrt(d2) - sqrt(d1));
}

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// iq's isosceles triangle, apex at the origin, base at y = q.y
float sdTriIso(vec2 p, vec2 q) {
  p.x = abs(p.x);
  vec2 a = p - q * clamp(dot(p, q) / dot(q, q), 0.0, 1.0);
  vec2 b = p - q * vec2(clamp(p.x / q.x, 0.0, 1.0), 1.0);
  float s = -sign(q.y);
  vec2 d = min(vec2(dot(a, a), s * (p.x * q.y - p.y * q.x)), vec2(dot(b, b), s * (p.y - q.y)));
  return -sqrt(d.x) * sign(d.y);
}

float sdShape(vec2 p) {
  if (uShape == 0) return length(p) - uSize;
  if (uShape == 1) return sdBox(p - vec2(uSize * 0.5, 0.0), vec2(uSize * 0.5));
  if (uShape == 2) return sdTriIso(vec2(p.y, p.x), vec2(0.5 * uSize, uSize));
  return sdBox(p - vec2(uSize * 0.5, 0.0), vec2(uSize * 0.5, uWidth * 0.5));
}

#if EFFECT_TYPE == 1 || EFFECT_TYPE == 20 || EFFECT_TYPE == 23 || EFFECT_TYPE == 24 || EFFECT_TYPE == 26
// Visual centre of the shape in feet, and its inradius there, so radial effects sit inside every shape
vec2 shapeCenter() {
  if (uShape == 0) return vec2(0.0);
  if (uShape == 2) return vec2(uSize * 0.6667, 0.0);
  return vec2(uSize * 0.5, 0.0);
}

float shapeRadius() {
  return max(-sdShape(shapeCenter()), 1.0);
}
#endif

#if EFFECT_TYPE == 1
vec3 fireRamp(float h) {
  vec3 col = mix(vec3(0.3, 0.02, 0.0), vec3(0.95, 0.2, 0.0), smoothstep(0.0, 0.4, h));
  col = mix(col, vec3(1.0, 0.58, 0.06), smoothstep(0.4, 0.78, h));
  return mix(col, vec3(1.25, 0.95, 0.35), smoothstep(0.8, 1.0, h));
}
#endif

vec4 effect(vec2 p, vec2 c, float d, float depth, float inside, float t) {
#if EFFECT_TYPE == 0
  return vec4(uColor, 0.35 * inside);

#elif EFFECT_TYPE == 1
  // Top-down flames: noise zooms outward from the shape centre in two cross-faded phases, warped once, with a soft ember lattice
  vec2 ctr = shapeCenter() / 5.0;
  float phase = t * 0.2;
  float pA = fract(phase);
  float pB = fract(phase + 0.5);
  float wA = 1.0 - abs(2.0 * pA - 1.0);
  vec2 pw = c;
  float f;
  if (uPerformanceTier == 2) {
    f = mix(vnoise(ctr + (pw - ctr) * 1.8 * exp(-pB * 1.2)), vnoise(ctr + (pw - ctr) * 1.8 * exp(-pA * 1.2)), wA);
  } else {
    vec2 warp = vec2(vnoise(c * 1.1 + vec2(0.0, t * 0.35)), vnoise(c * 1.1 + vec2(7.3, 3.1) - vec2(t * 0.3, 0.0)));
    pw = c + (warp - 0.5) * 0.9;
    vec2 zoomA = ctr + (pw - ctr) * exp(-pA * 1.2);
    vec2 zoomB = ctr + (pw - ctr) * exp(-pB * 1.2);
    float coarse = mix(vnoise(zoomB * 2.2), vnoise(zoomA * 2.2), wA);
    float fine = mix(vnoise(zoomB * 4.6 + 9.0), vnoise(zoomA * 4.6 + 9.0), wA);
    f = coarse * 0.65 + fine * 0.35;
  }
  f = clamp(0.5 + (f - 0.5) * 1.4, 0.0, 1.0);
  float h = f * (0.62 + 0.3 * depth) + 0.1 * depth - 0.08;
  float body = inside * (0.45 + 0.55 * smoothstep(0.08, 0.26, h));
  float tongue = (1.0 - inside) * (1.0 - smoothstep(0.0, 2.5, max(d, 0.0))) * smoothstep(0.5, 0.8, f);
  float ember = 0.0;
  if (uPerformanceTier < 2) {
    vec2 emberGrid = c * 3.2 + vec2(0.0, -t * 0.6);
    vec2 emberCell = floor(emberGrid);
    float emberDist = length(fract(emberGrid) - (0.2 + 0.6 * hash22(emberCell)));
    ember = step(0.88, hash12(emberCell)) * (1.0 - smoothstep(0.02, 0.1, emberDist));
  }
  vec3 col = fireRamp(clamp(h + tongue * 0.3, 0.0, 1.0)) + vec3(1.2, 0.7, 0.2) * ember;
  return vec4(col, clamp(body + tongue * 0.7 + ember * 0.8, 0.0, 1.0));

#elif EFFECT_TYPE == 2
  vec2 v = voronoi(c * 1.2, floor(t * 12.0));
  float arcs = (1.0 - smoothstep(0.0, 0.06, v.y)) * step(0.5, hash12(floor(c * 1.2) + vec2(floor(t * 12.0))));
  float flicker = 0.7 + 0.3 * hash12(vec2(floor(t * 20.0)));
  float arc = arcs * flicker;
  vec3 col = mix(vec3(0.2, 0.4, 1.0), vec3(1.2, 1.3, 1.6), arc);
  return vec4(col, max(0.25 * inside, arc));

#elif EFFECT_TYPE == 3
  vec2 v = voronoi(c * 2.0, t * 0.35);
  float facets = 0.6 + 0.4 * v.x;
  float cracks = 1.0 - smoothstep(0.0, 0.05, v.y);
  vec2 sparkleCell = floor(c * 16.0);
  float twinkle = pow(max(sin(t * 2.5 + hash12(sparkleCell) * 6.2831853), 0.0), 12.0);
  float sparkle = step(0.93, hash12(sparkleCell + 7.0)) * twinkle;
  vec3 ice = vec3(0.6, 0.9, 1.0) * facets * mix(1.0, 0.7, depth);
  vec3 col = ice + vec3(cracks * 0.6) + vec3(sparkle);
  return vec4(col, clamp(inside * 0.5 + cracks * 0.4 + sparkle, 0.0, 1.0));

#elif EFFECT_TYPE == 4 || EFFECT_TYPE == 17
#if EFFECT_TYPE == 4
  vec3 gasColor = vec3(0.35, 0.8, 0.2);
#else
  vec3 gasColor = vec3(0.7, 0.9, 0.1);
#endif
  float g = fbm(c * 0.8 + vec2(t * 0.15, t * 0.07)) * fbm(c * 1.6 - vec2(t * 0.1));
  float bubble = 0.0;
#if EFFECT_TYPE == 17
  vec2 bubbleCoord = c * 5.0 + vec2(0.0, -t * 1.2);
  vec2 bubbleCell = floor(bubbleCoord);
  float bubbleDist = length(fract(bubbleCoord) - (0.25 + 0.5 * hash22(bubbleCell)));
  bubble = step(0.65, hash12(bubbleCell)) * (1.0 - smoothstep(0.08, 0.16, bubbleDist));
#endif
  float a = smoothstep(-2.5, 0.0, -d) * (0.35 + 0.5 * g);
  return vec4(gasColor + bubble * 0.3, clamp(a + bubble * 0.3, 0.0, 1.0));

#elif EFFECT_TYPE == 5
  vec2 id = floor(c * 2.0);
  vec2 q = fract(c * 2.0) - 0.5;
  float h = hash12(id);
  float ang = atan(q.y, q.x) + 0.05 * sin(t + h * 6.0);
  float r = length(q);
  float spikeRadius = 0.35 * pow(abs(cos(ang * (3.0 + floor(h * 3.0)))), 8.0);
  float spikes = 1.0 - smoothstep(0.0, 0.02, r - spikeRadius);
  float g = fbm(c * 1.5);
  vec3 ground = mix(vec3(0.12, 0.09, 0.05), vec3(0.1, 0.18, 0.06), g);
  vec3 thorn = mix(vec3(0.45, 0.3, 0.12), vec3(0.3, 0.5, 0.2), h);
  return vec4(mix(ground, thorn, spikes), inside * 0.8);

#elif EFFECT_TYPE == 6
  float m = fbm(c * 1.3);
  float puddle = smoothstep(0.55, 0.6, m);
  float ripple = sin(length(fract(c) - 0.5) * 20.0 - t * 2.0) * 0.05;
  vec3 mud = mix(vec3(0.25, 0.16, 0.08), vec3(0.42, 0.3, 0.16), m);
  vec3 water = vec3(0.2, 0.18, 0.12) + ripple;
  vec3 col = mix(mud, water, puddle) + step(0.9, fract((c.x + c.y) * 2.0)) * 0.15;
  return vec4(col, 0.85 * inside);

#elif EFFECT_TYPE == 7
  float w = fbm(c + vec2(fbm(c * 2.0 + vec2(t * 0.2))));
  vec3 col = vec3(0.02, 0.0, 0.04) + vec3(0.25, 0.1, 0.4) * w * 0.15;
  float tendrils = (1.0 - smoothstep(0.0, 1.5, d)) * fbm(c * 3.0 + vec2(t * 0.3));
  float a = 0.92 * inside + tendrils * 0.8 * (1.0 - inside);
  return vec4(col, clamp(a, 0.0, 1.0));

#elif EFFECT_TYPE == 8
  float f1 = fbm(c * 0.7 + vec2(t * 0.05, 0.0));
  float f2 = fbm(c * 1.3 - vec2(t * 0.08));
  float dens = 0.5 * (f1 + f2);
  vec3 col = vec3(0.85, 0.87, 0.9) * (0.9 + 0.2 * dens);
  return vec4(col, 0.75 * smoothstep(-2.5, 0.0, -d) * (0.6 + 0.4 * dens));

#elif EFFECT_TYPE == 9
  vec2 v1 = voronoi(c * 1.5, 0.0);
  vec2 v2 = voronoi(c * 3.0, 0.0);
  float strands = max(1.0 - smoothstep(0.0, 0.04, v1.y), 0.6 * (1.0 - smoothstep(0.0, 0.025, v2.y)));
  return vec4(vec3(0.92), clamp(strands * 0.9 * inside + 0.05 * inside, 0.0, 1.0));

#elif EFFECT_TYPE == 10
  vec3 film = 0.5 + 0.5 * cos(6.2831853 * (fbm(c * 2.0 + vec2(t * 0.05)) * 2.0 + vec3(0.0, 0.33, 0.67)));
  vec3 col = vec3(0.12, 0.13, 0.1) + film * 0.35;
  return vec4(col, 0.7 * inside);

#elif EFFECT_TYPE == 11
  float rays = pow(0.5 + 0.5 * sin(atan(p.y, p.x) * 12.0 + t * 1.5), 6.0) * (1.0 - depth * 0.3);
  float motes = step(0.99, hash12(floor(c * 10.0 + vec2(0.0, t))));
  vec3 col = vec3(1.2, 0.95, 0.4) * (0.4 + rays) + vec3(motes * 1.5, motes * 1.4, motes);
  return vec4(col, clamp(inside * (0.25 + 0.45 * rays) + motes * inside, 0.0, 1.0));

#elif EFFECT_TYPE == 12
  float veins = 1.0 - smoothstep(0.0, 0.07, voronoi(c * 1.5, 0.0).y);
  float pulse = 0.6 + 0.4 * sin(t * 2.0 - length(p) * 0.3);
  vec3 base = vec3(0.08, 0.14, 0.07) * (0.7 + 0.3 * fbm(c));
  vec3 col = base + vec3(0.4, 1.0, 0.3) * pulse * veins;
  return vec4(col, clamp(0.75 * inside + veins * pulse * 0.5, 0.0, 1.0));

#elif EFFECT_TYPE == 13
  float u0 = c.y * 2.0;
  float u1 = (c.x * 0.8660254 + c.y * 0.5) * 2.0;
  float u2 = (-c.x * 0.8660254 + c.y * 0.5) * 2.0;
  float dl = min(min(min(fract(u0), 1.0 - fract(u0)), min(fract(u1), 1.0 - fract(u1))), min(fract(u2), 1.0 - fract(u2)));
  float lines = 1.0 - smoothstep(0.0, 0.05, dl);
  float shimmer = 0.7 + 0.3 * sin(t * 3.0 + c.x * 2.0);
  return vec4(uColor * (0.5 + lines * shimmer), clamp(inside * (0.15 + 0.6 * lines * shimmer), 0.0, 1.0));

#elif EFFECT_TYPE == 14
  float caus = pow(
    abs(sin(c.x * 3.0 + fbm(c + vec2(t * 0.2)) * 4.0) * sin(c.y * 3.0 + fbm(c - vec2(t * 0.2)) * 4.0)),
    0.5
  );
  vec3 col = mix(vec3(0.05, 0.35, 0.4), vec3(0.4, 0.95, 0.9), caus);
  return vec4(col, inside * (0.45 + 0.25 * caus));

#elif EFFECT_TYPE == 15
  vec2 sk = c + c.yx * 0.3;
  float streakId = floor(sk.x * 12.0);
  float s = fract(sk.y * 3.0 + t * 4.0 + hash12(vec2(streakId)));
  float streak = smoothstep(0.95, 1.0, s);
  vec3 col = vec3(0.8, 0.9, 1.0) * (0.6 + 0.4 * streak);
  return vec4(col, inside * (0.4 + 0.5 * streak));

#elif EFFECT_TYPE == 16
  float h = hash12(floor(c * 3.0));
  vec2 orbit = vec2(0.5) + 0.3 * vec2(cos(t * 3.0 + h * 6.0), sin(t * 4.0 + h * 9.0));
  float swarm = 1.0 - smoothstep(0.0, 0.08, length(fract(c * 3.0) - orbit));
  float haze = 0.2 * fbm(c * 2.0 + vec2(t * 0.1));
  vec3 col = vec3(0.25, 0.16, 0.06) + vec3(0.1) * swarm;
  return vec4(col, clamp(inside * (0.45 + haze) + swarm * inside * 0.6, 0.0, 1.0));

#elif EFFECT_TYPE == 18
  float phase = -d * 0.12 + t * 0.7;
  float front = pow(1.0 - abs(fract(phase) * 2.0 - 1.0), 6.0);
  float dust = vnoise(c * 2.0 - vec2(t * 0.4, 0.0));
  vec3 col = mix(uColor * 0.6, vec3(1.3, 1.35, 1.55), front) + dust * 0.1;
  return vec4(col, inside * (0.22 + 0.55 * front + 0.2 * dust));

#elif EFFECT_TYPE == 19
  vec2 cell = floor(c * 0.6);
  vec2 local = fract(c * 0.6) - 0.5;
  float h = hash12(cell);
  float life = fract(t * 0.12 + h);
  float echo = abs(length(local - (hash22(cell) - 0.5) * 0.3) - life * 0.45);
  float ripple = (1.0 - smoothstep(0.0, 0.025, echo)) * (1.0 - life);
  float hush = vnoise(c * 0.7 + vec2(t * 0.03));
  vec3 col = vec3(0.3, 0.35, 0.45) * (0.7 + 0.5 * hush) + vec3(0.35, 0.4, 0.5) * ripple;
  return vec4(col, inside * (0.4 + 0.3 * ripple));

#elif EFFECT_TYPE == 20
  vec2 q = p - shapeCenter();
  float r = length(q) / shapeRadius();
  float s = atan(q.y, q.x) * 0.4774648 + r * 1.2 - t * 0.35;
  float arm = 0.5 + 0.5 * sin(6.2831853 * s);
  vec3 hue = 0.5 + 0.5 * cos(6.2831853 * (s * 0.5 + r * 0.3 + vec3(0.0, 0.33, 0.67)));
  float glow = 0.35 + 0.65 * smoothstep(0.2, 0.9, arm);
  return vec4(hue * (0.5 + 0.7 * glow), inside * (0.3 + 0.45 * glow));

#elif EFFECT_TYPE == 21
  vec2 grid = c * 1.6;
  vec2 cell = floor(grid);
  float h = hash12(cell);
  vec2 center = 0.5 + 0.3 * sin(t * 0.5 + 6.2831853 * hash22(cell));
  float dist = length(fract(grid) - center);
  float pulse = 0.55 + 0.45 * sin(t * 2.0 + h * 6.2831853);
  float mote = exp(-dist * dist * 90.0) * pulse;
  vec3 tint = 0.5 + 0.5 * cos(6.2831853 * (h + vec3(0.0, 0.33, 0.67)));
  float halo = exp(-max(-d, 0.0) * 0.35) * (0.5 + 0.5 * sin(t * 1.3 - d * 0.4));
  vec3 col = uColor * (0.35 + 0.5 * halo) + tint * mote * 1.6;
  return vec4(col, clamp(inside * (0.18 + 0.4 * halo) + mote * inside, 0.0, 1.0));

#elif EFFECT_TYPE == 22
  float haze = vnoise(c * 0.9 + vec2(t * 0.06, -t * 0.04));
  vec2 riseCoord = c * 3.0 + vec2(sin(c.y * 2.0 + t * 0.4) * 0.3, -t * 0.25);
  vec2 riseCell = floor(riseCoord);
  float riseDist = length(fract(riseCoord) - (0.3 + 0.4 * hash22(riseCell)));
  float mote = step(0.55, hash12(riseCell)) * (1.0 - smoothstep(0.04, 0.12, riseDist));
  float breath = 0.85 + 0.15 * sin(t * 0.8);
  vec3 col = mix(vec3(0.12, 0.14, 0.4), vec3(0.4, 0.45, 0.95), haze) * breath + vec3(0.7, 0.75, 1.3) * mote;
  return vec4(col, inside * (0.45 + 0.2 * haze) + mote * inside * 0.5);

#elif EFFECT_TYPE == 23
  vec2 q = p - shapeCenter();
  float radius = shapeRadius();
  float r = length(q) / radius;
  float a = atan(q.y, q.x);
  float lane = 0.6 + 0.08 * sin(a * 3.0 + t);
  float laneOffset = (r - lane) / 0.14;
  float band = exp(-laneOffset * laneOffset);
  float ph = fract(a * 0.9549297 - t * 0.5);
  float comet = pow(ph, 5.0) * (1.0 - smoothstep(0.96, 1.0, ph));
  float turn = t * 0.3 - r * 1.2;
  vec2 swirlP = mat2(cos(turn), -sin(turn), sin(turn), cos(turn)) * (q / radius) * 3.0;
  float swirl = vnoise(swirlP + 5.0);
  vec3 col = vec3(0.8, 0.92, 1.3) * (0.4 + 1.2 * comet * band) + uColor * 0.3 * swirl;
  return vec4(col, clamp(inside * (0.2 + 0.2 * swirl) + comet * band * inside, 0.0, 1.0));

#elif EFFECT_TYPE == 24
  vec2 q = p - shapeCenter();
  float radius = shapeRadius();
  float r = length(q) / radius;
  float core = exp(-r * r * 2.5);
  float a = atan(q.y, q.x);
  float shafts = pow(0.5 + 0.5 * sin(a * 8.0 + t * 0.4 + vnoise(c) * 3.0), 5.0) * (1.0 - r * 0.5);
  float ring = (1.0 - smoothstep(0.0, 0.08, abs(fract(r * 1.5 - t * 0.15) - 0.5) - 0.42)) * (1.0 - r);
  float motes = step(0.985, hash12(floor(c * 9.0 + vec2(0.0, t * 0.8)))) * core;
  vec3 col = vec3(0.75, 0.82, 1.2) * (0.3 + core * 1.3 + shafts * 0.5) + vec3(motes * 1.5) + vec3(0.5, 0.6, 1.0) * ring * 0.3;
  return vec4(col, clamp(inside * (0.25 + 0.5 * core + 0.25 * shafts + 0.15 * ring) + motes, 0.0, 1.0));

#elif EFFECT_TYPE == 25
  vec2 grid = c * 2.6 + vec2(sin(t * 0.3 + c.y), cos(t * 0.27 + c.x)) * 0.2;
  vec2 cell = floor(grid);
  float h = hash12(cell);
  vec2 local = fract(grid) - 0.5 - (hash22(cell) - 0.5) * 0.24;
  float ang = t * (1.2 + h) + h * 6.2831853;
  vec2 blade = vec2(cos(ang) * local.x + sin(ang) * local.y, -sin(ang) * local.x + cos(ang) * local.y);
  float dagger = 1.0 - smoothstep(0.0, 0.03, sdBox(blade, vec2(0.2 * (1.0 - 0.6 * smoothstep(0.0, 0.2, blade.x)), 0.03)));
  float glint = pow(max(sin(ang * 2.0), 0.0), 16.0) * dagger;
  vec3 col = vec3(0.55, 0.62, 0.72) * (0.6 + 0.5 * h) + vec3(1.4, 1.45, 1.5) * glint;
  return vec4(col, clamp(inside * (0.14 + 0.85 * dagger), 0.0, 1.0));

#elif EFFECT_TYPE == 26
  vec2 q = p - shapeCenter();
  float radius = shapeRadius();
  float r = length(q) / radius;
  float a = atan(q.y, q.x) + 2.5 / (r + 0.35) + t * 0.25;
  vec2 starCoord = vec2(a * 5.0, r * 7.0 + t * 0.5);
  vec2 starCell = floor(starCoord);
  float starDist = length(fract(starCoord) - (0.25 + 0.5 * hash22(starCell)));
  float twinkle = 0.5 + 0.5 * sin(t * 2.5 + hash12(starCell) * 40.0);
  float star = step(0.82, hash12(starCell + 3.0)) * (1.0 - smoothstep(0.03, 0.14, starDist)) * twinkle;
  float rim = (1.0 - smoothstep(0.0, 4.5, abs(d + 1.5))) * vnoise(c * 3.0 + vec2(t * 0.25));
  vec3 col = vec3(0.02, 0.0, 0.05) + vec3(0.7, 0.9, 1.4) * star + vec3(0.35, 0.6, 1.0) * rim * 0.8;
  return vec4(col, clamp(0.9 * inside + rim * 0.5, 0.0, 1.0));

#elif EFFECT_TYPE == 27
  vec2 w = c + vec2(sin(c.y * 1.7 + t * 0.4), cos(c.x * 1.3 - t * 0.35)) * 0.45;
  float lineA = 1.0 - smoothstep(0.0, 0.22, abs(sin((w.x + w.y * 0.5) * 3.2)));
  float lineB = 1.0 - smoothstep(0.0, 0.22, abs(sin((w.y - w.x * 0.6) * 2.7 + 1.3)));
  float vines = max(lineA, lineB * 0.85);
  float leaf = step(0.93, hash12(floor(c * 6.0))) * inside;
  vec3 ground = mix(vec3(0.06, 0.12, 0.04), vec3(0.1, 0.18, 0.06), vnoise(c * 1.5));
  vec3 vine = mix(vec3(0.2, 0.42, 0.1), vec3(0.45, 0.72, 0.22), lineA * lineB + 0.3 * sin(t + w.x));
  return vec4(mix(ground, vine, vines) + vec3(0.1, 0.25, 0.05) * leaf, inside * 0.82);

#elif EFFECT_TYPE == 28
  vec2 grid = c * 2.2;
  grid.x += 0.5 * mod(floor(grid.y), 2.0);
  vec2 cell = floor(grid);
  vec2 local = fract(grid) - 0.5;
  float h = hash12(cell);
  float grow = 0.85 + 0.15 * sin(t * 1.1 + h * 6.2831853);
  float ang = atan(local.y, local.x);
  float len = (0.06 + 0.4 * pow(abs(cos(ang * 3.0)), 14.0)) * grow;
  float spikes = 1.0 - smoothstep(0.0, 0.03, length(local) - len);
  float lit = 0.5 + 0.5 * sin(ang * 3.0 + 1.0);
  vec3 ground = mix(vec3(0.16, 0.12, 0.08), vec3(0.24, 0.2, 0.12), vnoise(c * 1.6));
  vec3 shard = mix(vec3(0.35, 0.28, 0.18), vec3(0.85, 0.78, 0.55), lit * (length(local) / max(len, 0.05)));
  return vec4(mix(ground, shard, spikes), inside * 0.85);

#endif
  return vec4(uColor, 0.0);
}

void main() {
  vec4 plane;
  #pragma unroll_loop
  for (int i = 0; i < NUM_CLIPPING_PLANES; i++) {
    plane = uClippingPlanes[i];
    if (dot(-vWorldPosition, plane.xyz) > plane.w) {
      discard;
    }
  }

  vec2 p = (vUv - 0.5) * uQuadSize + uQuadCenter;
  float d = sdShape(p);
  if (d > uFeather) discard;

  float aa = max(fwidth(d), 0.0001);
  float inside = 1.0 - smoothstep(-aa, aa, d);
  float depth = clamp(-d / 5.0, 0.0, 1.0);
  float t = uTime * uSpeed + uSeed * 97.0;
  vec2 c = p / 5.0;

  vec4 col = effect(p, c, d, depth, inside, t);
  float rim = 1.0 - smoothstep(0.0, aa * 1.5, abs(d) - 0.12);
  col.rgb = mix(col.rgb, uColor, rim * 0.5);
  col.a = max(col.a, rim * 0.7 * inside + rim * 0.4);
  gl_FragColor = vec4(col.rgb, clamp(col.a, 0.0, 1.0) * uOpacity * uFade);
}
