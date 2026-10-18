precision highp float;

#ifndef EFFECT_TYPE
#define EFFECT_TYPE 0
#endif

uniform float uTime;
uniform float uSeed;
uniform float uSpeed;
uniform float uOpacity;
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

#if EFFECT_TYPE == 1
vec3 fireRamp(float h) {
  vec3 black = vec3(0.1, 0.0, 0.0);
  vec3 darkRed = vec3(0.5, 0.05, 0.0);
  vec3 red = vec3(0.9, 0.15, 0.0);
  vec3 orange = vec3(1.0, 0.4, 0.05);
  vec3 yellow = vec3(1.1, 0.85, 0.2);
  vec3 white = vec3(1.4, 1.2, 0.9);
  if (h < 0.15) return mix(black, darkRed, h / 0.15);
  if (h < 0.3) return mix(darkRed, red, (h - 0.15) / 0.15);
  if (h < 0.5) return mix(red, orange, (h - 0.3) / 0.2);
  if (h < 0.75) return mix(orange, yellow, (h - 0.5) / 0.25);
  return mix(yellow, white, (h - 0.75) / 0.25);
}
#endif

vec4 effect(vec2 p, vec2 c, float d, float depth, float inside, float t) {
#if EFFECT_TYPE == 0
  return vec4(uColor, 0.35 * inside);

#elif EFFECT_TYPE == 1
  float n = fbm(c * 1.5 + vec2(0.0, -t * 0.8) + fbm(c * 3.0 + vec2(t)) * 0.6);
  float h = n * (0.6 + 0.4 * depth) + 0.15 * sin(t * 9.0 + hash12(floor(c * 4.0)) * 6.0);
  vec3 col = fireRamp(clamp(h, 0.0, 1.0));
  float a = inside * smoothstep(0.15, 0.35, h) + exp(-max(d, 0.0) * 0.6) * 0.4;
  return vec4(col, clamp(a, 0.0, 1.0));

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
  gl_FragColor = vec4(col.rgb, clamp(col.a, 0.0, 1.0) * uOpacity);
}
