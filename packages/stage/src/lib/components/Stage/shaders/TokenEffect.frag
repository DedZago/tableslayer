precision highp float;

// Ambient effects bound to a token: one program per kind, TOKEN_FX selects a single function at compile time
// (0 orbit, 1 glow, 2 shimmer, 3 ghosts, 4 ward, 5 chains, 6 motes, 7 haze, 8 sigil, 9 rift, 10 charm, 11 concentration,
// 12 clock, 13 streaks, 14 halo, 15 veil, 16 wind, 17 blind, 18 calm, 19 heal, 20 trance, 21 outline, 22 dread, 23 slumber).
// Geometry is in token radii around the token centre (|q| = 1 is the token's edge), on the layer axes.
// Output is premultiplied: alpha below the colour makes light-like additive glow.
#ifndef TOKEN_FX
#define TOKEN_FX 0
#endif

uniform float uTime;
uniform int uPerformanceTier;
uniform vec4 uClippingPlanes[NUM_CLIPPING_PLANES];

varying vec2 vUv;
varying vec3 vWorldPosition;
varying vec4 vTint;
varying vec4 vInfo;
varying float vPx;
// 1 while the effect belongs to a focused concentration (the quad is then drawn 1.1x larger)
varying float vHighlight;

const float TAU = 6.2831853;
const float PI = 3.1415927;

// Instance data: vTint = (colour, seed); vInfo = (start time, variant, half extent in token radii, orbit radius in token radii)
float aa = 0.01;

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
  float s = 0.0;
  float a = 0.5;
  int octaves = uPerformanceTier == 2 ? 2 : 3;
  for (int i = 0; i < 3; i++) {
    if (i >= octaves) break;
    s += a * vnoise(p);
    p = p * 2.03 + 17.0;
    a *= 0.5;
  }
  return s;
}

float gauss(float x, float w) {
  return exp(-(x * x) / (w * w));
}

// 1 on the line, falling to 0 at the half width, with the pixel's feather
float stroke(float d, float halfWidth) {
  return 1.0 - smoothstep(halfWidth - aa, halfWidth + aa, abs(d));
}

float disc(float d) {
  return 1.0 - smoothstep(-aa, aa, d);
}

float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
  return length(pa - ba * h);
}

float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

vec2 rot(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x + s * p.y, -s * p.x + c * p.y);
}

void over(inout vec4 dst, vec4 src) {
  dst = src + dst * (1.0 - src.a);
}

vec4 glow(vec3 color, float amount) {
  return vec4(color * amount, 0.0);
}

vec4 solid(vec3 color, float coverage) {
  return vec4(color * coverage, coverage);
}

// Soft round sparks on a jittered grid, drifting upward by `rise` cells
float sparks(vec2 p, float scale, float rise, float seed, float size) {
  vec2 g = p * scale;
  g.y -= rise;
  vec2 cell = floor(g);
  vec2 f = fract(g) - 0.5;
  vec2 h = hash22(cell + seed);
  float on = step(0.45, hash12(cell + seed + 3.7));
  float d = length(f - (h - 0.5) * 0.6);
  return on * (1.0 - smoothstep(0.0, size * (0.6 + 0.5 * h.x), d)) * (0.55 + 0.45 * h.y);
}


#if TOKEN_FX == 0
// ORBIT: glowing spirits circle the token inside the radius, each trailing a comet tail
vec4 fxOrbit(vec2 q, float t, vec3 C, vec3 L, float seed) {
  float R = max(vInfo.w, 2.2);
  float r = length(q);
  float ang = atan(q.y, q.x);
  vec4 col = vec4(0.0);

  float breathe = 0.8 + 0.2 * sin(t * 1.8);
  over(col, glow(C, gauss(r - 1.05, 0.45) * 0.34 * breathe));

  int count = uPerformanceTier == 2 ? 3 : 6;
  for (int i = 0; i < 6; i++) {
    if (i >= count) break;
    float fi = float(i);
    float h = hash12(vec2(fi * 7.31, seed * 13.0));
    float rad = R * (0.42 + 0.46 * fract(h * 3.7 + fi * 0.37));
    rad *= 1.0 + 0.05 * sin(t * 1.3 + fi * 2.1);
    float omega = 2.6 / max(rad, 1.5);
    float a = fi * TAU / float(count) + t * omega + 0.35 * sin(t * 0.7 + fi * 1.7);
    vec2 head = rad * vec2(cos(a), sin(a));
    float dHead = length(q - head);

    float behind = atan(sin(a - ang), cos(a - ang));
    float tailLen = clamp(behind, 0.0, 1.6);
    float tail = exp(-rad * tailLen / 1.7) * step(0.0, behind) * gauss(r - rad, 0.1 + 0.16 * exp(-tailLen * 2.0));
    over(col, glow(C, tail * 0.8));
    over(col, glow(mix(C, L, 0.6), gauss(dHead, 0.2) * 2.0));
    over(col, glow(C, gauss(dHead, 0.65) * 0.5));
  }

  if (uPerformanceTier < 2) {
    float inside = 1.0 - smoothstep(R * 0.8, R, r);
    over(col, glow(L, sparks(q, 0.55, t * 0.3, seed, 0.12) * inside * 1.6 * (0.6 + 0.4 * sin(t * 4.0 + ang * 3.0))));
  }
  return col;
}
#endif

#if TOKEN_FX == 1
// GLOW: soft light, bright inside the radius and dim out to twice it (visual only)
vec4 fxGlow(vec2 q, float t, vec3 C, vec3 L, float seed) {
  float R = max(vInfo.w, 2.0);
  float r = length(q);
  float flicker = 1.0 + 0.045 * sin(t * 3.1 + sin(t * 1.3) * 2.0) + 0.05 * (vnoise(vec2(t * 1.6, seed * 9.0)) - 0.5);
  float bright = 1.0 - smoothstep(R * 0.5, R, r);
  float dim = 1.0 - smoothstep(R, R * 2.0, r);
  vec4 col = glow(C, (bright * 0.3 + dim * 0.12) * flicker);
  over(col, glow(L, gauss(r, 1.1) * 0.55 * flicker));
  float flareA = gauss(q.x, 0.05) * gauss(q.y, 1.5);
  float flareB = gauss(q.y, 0.05) * gauss(q.x, 1.5);
  over(col, glow(L, (flareA + flareB) * 0.55 * flicker));
  return col;
}
#endif

#if TOKEN_FX == 2
// SHIMMER: heat-haze echoes ripple out from the token's edge
vec4 fxShimmer(vec2 q, float t, vec3 C, vec3 L, float seed) {
  float r = length(q);
  float ang = atan(q.y, q.x);
  float warp = (fbm(q * 1.9 + vec2(t * 0.3, -t * 0.22) + seed * 9.0) - 0.5) * 0.3;
  float rr = r + warp;
  vec4 col = vec4(0.0);

  over(col, glow(C, stroke(rr - 1.08 - 0.02 * sin(t * 1.7), 0.026) * 0.45));
  int echoes = uPerformanceTier == 2 ? 2 : 3;
  for (int i = 0; i < 3; i++) {
    if (i >= echoes) break;
    float ph = fract(t * 0.33 + float(i) / float(echoes));
    float rad = 1.04 + 0.62 * ph;
    float life = (1.0 - ph) * smoothstep(0.0, 0.12, ph);
    over(col, glow(L, stroke(rr - rad, 0.022 + 0.026 * ph) * life * 0.7));
  }
  float sweep = pow(0.5 + 0.5 * cos(ang - t * 1.5), 6.0);
  over(col, glow(L, sweep * stroke(rr - 1.12, 0.07) * 0.9));
  over(col, glow(C, gauss(rr - 0.95, 0.4) * 0.16));
  return col;
}
#endif

#if TOKEN_FX == 3
// GHOSTS: three drifting afterimages of the token
vec4 fxGhosts(vec2 q, float t, vec3 C, vec3 L, float seed) {
  vec4 col = vec4(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float a = t * 0.5 + fi * TAU / 3.0;
    vec2 c = vec2(cos(a), sin(a)) * (0.7 + 0.14 * sin(t * 1.1 + fi * 2.0));
    float d = length(q - c) - 0.92;
    float flick = 0.62 + 0.3 * sin(t * 2.3 + fi * 1.7) + 0.08 * sin(t * 7.0 + fi * 3.0);
    float blink = 1.0 - 0.5 * step(0.985, hash12(vec2(floor(t * 3.0), fi + seed * 5.0)));
    vec3 tint = mix(L, vec3(0.75, 0.9, 1.0), 0.35 * fi * 0.5);
    over(col, glow(tint, stroke(d, 0.026) * 0.62 * flick * blink));
    over(col, glow(C, disc(d) * 0.16 * flick * blink));
    over(col, glow(L, gauss(d, 0.3) * 0.16 * flick));
  }
  return col;
}
#endif

#if TOKEN_FX == 4
// WARD: a faint dome of hex plates, pulsing outward from the token
float hexEdge(vec2 p) {
  p = abs(p);
  return max(dot(p, vec2(0.5, 0.8660254)), p.x);
}

float hexLines(vec2 p) {
  vec2 s = vec2(1.0, 1.7320508);
  vec4 hc = floor(vec4(p, p - vec2(0.5, 1.0)) / s.xyxy) + 0.5;
  vec4 h = vec4(p - hc.xy * s, p - (hc.zw + 0.5) * s);
  vec2 cell = dot(h.xy, h.xy) < dot(h.zw, h.zw) ? h.xy : h.zw;
  return smoothstep(0.43, 0.5, hexEdge(cell));
}

vec4 fxWard(vec2 q, float t, vec3 C, vec3 L, float seed) {
  float R = 1.34;
  float r = length(q);
  float mask = disc(r - R);
  float fre = pow(clamp(r / R, 0.0, 1.0), 3.0);
  float pulse = gauss(r - fract(t * 0.38) * R, 0.24);
  float lines = hexLines(q * 2.7 + seed * 5.0);
  vec4 col = vec4(0.0);
  over(col, glow(C, fre * 0.34 * mask));
  over(col, glow(L, lines * (0.09 + 0.95 * pulse + 0.3 * fre) * mask));
  over(col, glow(L, stroke(r - R, 0.03) * (0.9 + 0.3 * sin(t * 2.0))));
  over(col, glow(vec3(1.0), gauss(length(q - vec2(-0.5, 0.55) * R), 0.22) * 0.38 * mask));
  return col;
}
#endif

#if TOKEN_FX == 5
// CHAINS: crossing bands of links wrap the token, tightening slowly with a glint running along them
vec4 chainBand(vec2 q, float angle, float a, float b, float t, float seed, vec3 C) {
  vec2 p = rot(q, angle);
  vec2 e = p / vec2(a, b);
  float rad = length(e);
  float phi = atan(e.y, e.x);
  vec2 grad = vec2(p.x / (a * a), p.y / (b * b)) / max(rad, 1e-3);
  float d = (rad - 1.0) / max(length(grad), 1e-3);
  float pitch = TAU * sqrt(0.5 * (a * a + b * b)) / 18.0;
  float u = phi / TAU * 18.0;
  float k = floor(u);
  float f = fract(u);
  float along = (f - 0.5) * pitch;
  float cover = 0.0;
  float edge = 0.0;
  for (int j = -1; j <= 1; j++) {
    float fj = float(j);
    float idx = k + fj;
    vec2 lp = vec2(along - fj * pitch, d);
    if (mod(idx, 2.0) < 0.5) {
      vec2 oval = vec2(max(abs(lp.x) - pitch * 0.62, 0.0), lp.y);
      float od = length(oval) - 0.085;
      cover = max(cover, 1.0 - smoothstep(0.03 - aa, 0.03 + aa, abs(od)));
      edge = max(edge, 1.0 - smoothstep(0.012 - aa, 0.012 + aa, abs(od + 0.045)));
    } else {
      float bd = sdBox(lp, vec2(pitch * 0.46, 0.034));
      cover = max(cover, disc(bd));
    }
  }
  float spec = pow(0.5 + 0.5 * cos(phi - t * 0.9 - seed * 6.0), 12.0);
  vec3 metal = mix(C * 0.5, vec3(1.0), 0.18 + 0.82 * spec * 0.9 + 0.18 * edge);
  return solid(metal, cover);
}

// A taut run of links from the token's edge to a ground stake, with a tightening pulse running along it
vec4 chainRun(vec2 q, vec2 dir, float len, float t, float seed, float heavy, vec3 C, vec3 L) {
  vec2 side = vec2(-dir.y, dir.x);
  float s = dot(q, dir);
  float v = dot(q, side);
  if (s < 0.0 || s > len || abs(v) > 0.16) return vec4(0.0);
  float pitch = 0.2 + 0.04 * heavy;
  float k = floor(s / pitch);
  float f = fract(s / pitch);
  vec2 lp = vec2((f - 0.5) * pitch, v);
  float cover;
  float edge = 0.0;
  if (mod(k, 2.0) < 0.5) {
    float od = length(vec2(max(abs(lp.x) - pitch * 0.24, 0.0), lp.y)) - (0.062 + 0.012 * heavy);
    cover = 1.0 - smoothstep(0.024 - aa, 0.024 + aa, abs(od));
    edge = 1.0 - smoothstep(0.01 - aa, 0.01 + aa, abs(od + 0.034));
  } else {
    cover = disc(sdBox(lp, vec2(pitch * 0.42, 0.03 + 0.008 * heavy)));
  }
  float pulse = gauss(s - fract(t * 0.35 + seed) * len, 0.22);
  vec3 metal = mix(C * 0.5, vec3(1.0), 0.18 + 0.18 * edge + 0.7 * pulse);
  vec4 col = solid(metal, cover);
  over(col, glow(L, pulse * gauss(v, 0.1) * 0.5));
  return col;
}

vec4 chainStake(vec2 q, vec2 pos, float t, float seed, vec3 C, vec3 L) {
  vec2 d = q - pos;
  float r = length(d);
  if (r > 0.9) return vec4(0.0);
  float a = atan(d.y, d.x);
  vec4 col = vec4(0.0);
  over(col, glow(C, gauss(r, 0.34) * (0.35 + 0.15 * sin(t * 1.6 + seed))));
  float runes = step(0.5, fract(a * 3.0 / TAU * 2.0 + t * 0.25)) * stroke(r - 0.21, 0.016);
  over(col, glow(L, runes * 0.9 + stroke(r - 0.27, 0.01) * 0.45));
  over(col, solid(vec3(0.07, 0.07, 0.09), disc(r - 0.12)));
  over(col, glow(L, stroke(r - 0.12, 0.012) * 0.8));
  return col;
}

vec4 fxChains(vec2 q, float t, vec3 C, vec3 L, float seed) {
  float r = length(q);
  float heavy = step(0.5, vInfo.y);
  float tighten = 1.0 - 0.03 * (0.5 + 0.5 * sin(t * 1.1));
  vec4 col = vec4(0.0);
  over(col, glow(C, gauss(r - 1.0, 0.5) * (0.28 + 0.14 * sin(t * 1.4))));

  int stakes = uPerformanceTier == 2 ? 3 : (heavy > 0.5 ? 4 : 3);
  for (int i = 0; i < 4; i++) {
    if (i >= stakes) break;
    float fi = float(i);
    float a = 0.65 + fi * (heavy > 0.5 ? TAU / 4.0 : TAU / 3.0) + hash12(vec2(fi, seed * 3.0)) * 0.3;
    vec2 dir = vec2(cos(a), sin(a));
    vec2 stake = dir * 2.05 * tighten;
    over(col, chainRun(q - dir * 0.96, dir, length(stake) - 0.96 - 0.12, t + fi * 0.7, seed + fi, heavy, C, L));
    over(col, chainStake(q, stake, t, seed + fi, C, L));
  }

  if (r < 1.5) {
    float squeeze = 1.0 - 0.04 * (0.5 + 0.5 * sin(t * 1.0)) - 0.012 * sin(t * 9.0);
    int bands = uPerformanceTier == 2 ? 2 : 3;
    for (int i = 0; i < 3; i++) {
      if (i >= bands) break;
      float fi = float(i);
      float angle = 0.4 + fi * 1.05 + 0.04 * sin(t * 0.5 + fi);
      over(col, chainBand(q, angle, (1.2 + 0.05 * fi) * squeeze, (0.74 + 0.07 * fi) * squeeze, t + fi * 1.3, seed + fi, C));
    }
  }
  return col;
}
#endif

#if TOKEN_FX == 6
// MOTES: golden sparks rise around the token
vec4 fxMotes(vec2 q, float t, vec3 C, vec3 L, float seed) {
  float r = length(q);
  float zone = smoothstep(1.95, 1.35, r) * smoothstep(0.35, 0.8, r);
  vec4 col = glow(C, gauss(r - 0.95, 0.6) * 0.26 * (0.8 + 0.2 * sin(t * 1.5)));
  float twinkle = 0.6 + 0.4 * sin(t * 5.0 + hash12(floor(q * 2.4 + seed)) * TAU);
  over(col, glow(L, sparks(q, 2.4, t * 0.85, seed, 0.2) * zone * twinkle * 3.0));
  if (uPerformanceTier < 2) {
    over(col, glow(C, sparks(q + 3.1, 4.2, t * 1.3, seed + 9.0, 0.22) * zone * 2.2));
    float rays = pow(abs(cos(atan(q.y, q.x) * 4.0 + t * 0.6)), 24.0) * gauss(r - 1.25, 0.35);
    over(col, glow(L, rays * 0.35));
  }
  return col;
}
#endif

#if TOKEN_FX == 7
// HAZE: a dark, slowly swirling smoke clings to the token and sheds drops
vec4 fxHaze(vec2 q, float t, vec3 C, vec3 L, float seed) {
  float r = length(q);
  float ang = atan(q.y, q.x);
  float swirl = ang + 0.9 * sin(r * 2.2 - t * 0.4) + t * 0.12;
  vec2 sp = vec2(cos(swirl), sin(swirl)) * r;
  float n = fbm(sp * 1.5 + vec2(0.0, -t * 0.25) + seed * 7.0);
  float ring = smoothstep(0.4, 0.85, r) * (1.0 - smoothstep(1.5, 2.1, r));
  float density = ring * smoothstep(0.32, 0.78, n);
  vec3 smoke = mix(vec3(0.02, 0.0, 0.06), C * 0.3, 0.45);
  vec4 col = solid(smoke, density * 0.85);
  over(col, glow(C, gauss(r - 1.2, 0.3) * n * 0.4));
  float drips = sparks(vec2(q.x, -q.y), 2.2, t * 0.7, seed + 4.0, 0.18) * ring;
  over(col, solid(vec3(0.02, 0.0, 0.05), drips * 0.7));
  return col;
}
#endif

#if TOKEN_FX == 8
// SIGIL: a hex sigil (variant 0) or a closing crosshair (variant 1) floats around the token
vec4 fxSigil(vec2 q, float t, vec3 C, vec3 L, float seed) {
  float r = length(q);
  float ang = atan(q.y, q.x);
  bool crosshair = vInfo.y > 0.5;
  vec4 col = vec4(0.0);
  if (crosshair) {
    float lock = fract(t * 0.5);
    float R = 1.4 * (1.0 + 0.32 * pow(1.0 - lock, 3.0));
    float hot = 0.75 + 0.5 * pow(lock, 6.0);
    over(col, glow(L, stroke(r - R, 0.026) * hot));
    over(col, glow(C, gauss(r - R, 0.16) * 0.45));
    float armsX = stroke(q.y, 0.022) * step(0.3 * R, abs(q.x)) * step(abs(q.x), R * 1.2);
    float armsY = stroke(q.x, 0.022) * step(0.3 * R, abs(q.y)) * step(abs(q.y), R * 1.2);
    over(col, glow(L, (armsX + armsY) * hot));
    over(col, glow(L, disc(r - 0.05) * 0.9));
    float ticks = step(0.5, fract(ang * 16.0 / TAU)) * stroke(r - R * 0.88, 0.02);
    over(col, glow(C, ticks * 0.6));
  } else {
    float spin = t * 0.28;
    float R = 1.42;
    float pulse = 0.8 + 0.2 * sin(t * 2.2);
    over(col, glow(L, stroke(r - R, 0.026) * pulse));
    over(col, glow(C, stroke(r - R * 1.1, 0.012) * 0.6));
    over(col, glow(C, gauss(r - R, 0.2) * 0.4));
    float runes = step(0.5, fract((ang + spin) * 20.0 / TAU)) * stroke(r - R * 1.1, 0.03);
    over(col, glow(L, runes * 0.75));
    vec2 sp = rot(q, -spin);
    float star = 1.0;
    for (int i = 0; i < 5; i++) {
      float a0 = TAU * float(i) / 5.0 + PI / 2.0;
      float a1 = TAU * float((i + 2) % 5) / 5.0 + PI / 2.0;
      star = min(star, segDist(sp, R * 0.84 * vec2(cos(a0), sin(a0)), R * 0.84 * vec2(cos(a1), sin(a1))));
    }
    over(col, glow(L, (1.0 - smoothstep(0.016 - aa, 0.016 + aa, star)) * pulse));
    over(col, glow(C, gauss(star, 0.07) * 0.5));
  }
  return col;
}
#endif

#if TOKEN_FX == 9
// RIFT: a ragged tear in the air, dark inside, sucking motes in
vec4 fxRift(vec2 q, float t, vec3 C, vec3 L, float seed) {
  float w = 0.42 + 0.07 * sin(t * 1.3);
  float h = 1.5;
  float e = length(vec2(q.x / w, q.y / h));
  e += (vnoise(vec2(q.y * 3.2 + seed * 9.0, t * 1.2)) - 0.5) * 0.4;
  float inside = 1.0 - smoothstep(0.86, 1.0, e);
  float rim = gauss(e - 1.0, 0.13);
  vec4 col = solid(vec3(0.02, 0.0, 0.07), inside * 0.58);
  over(col, glow(C, inside * (0.1 + 0.25 * vnoise(q * 4.0 + t * 0.6))));
  over(col, glow(L, rim * 1.5));
  over(col, glow(C, gauss(e - 1.0, 0.5) * 0.4));
  int count = uPerformanceTier == 2 ? 3 : 6;
  for (int i = 0; i < 6; i++) {
    if (i >= count) break;
    float fi = float(i);
    float life = fract(t * 0.4 + fi / float(count) + hash12(vec2(fi, seed)));
    float rad = 2.1 * (1.0 - life);
    float a = fi * 2.4 + rad * 2.2;
    vec2 pos = vec2(cos(a) * rad * 0.7, sin(a) * rad);
    over(col, glow(L, gauss(length(q - pos), 0.06 + 0.04 * life) * (1.0 - life) * 2.6));
  }
  return col;
}
#endif

#if TOKEN_FX == 10
// CHARM: rising hearts (variant 0) or a command seal that hovers over the token (variant 1)
float sdHeart(vec2 p) {
  p.x = abs(p.x);
  if (p.y + p.x > 1.0) return sqrt(dot(p - vec2(0.25, 0.75), p - vec2(0.25, 0.75))) - 0.35355339;
  vec2 d = p - 0.5 * max(p.x + p.y, 0.0);
  return sqrt(min(dot(p - vec2(0.0, 1.0), p - vec2(0.0, 1.0)), dot(d, d))) * sign(p.x - p.y);
}

vec4 fxCharm(vec2 q, float t, vec3 C, vec3 L, float seed) {
  vec4 col = vec4(0.0);
  if (vInfo.y > 0.5) {
    vec2 c = vec2(0.0, 1.28 + 0.05 * sin(t * 1.6));
    vec2 p = (q - c) / 0.52;
    float r = length(p);
    float pulse = 0.8 + 0.2 * sin(t * 3.0);
    over(col, glow(C, gauss(r, 1.3) * 0.34));
    over(col, solid(vec3(0.03, 0.02, 0.0), disc((r - 1.0) * 0.52) * 0.4));
    over(col, glow(L, stroke(r - 1.0, 0.06) * pulse * 1.2));
    over(col, glow(L, stroke(r - 0.8, 0.025) * 0.6));
    float bar = disc(sdBox(p - vec2(0.0, 0.14), vec2(0.075 - 0.02 * (0.5 - p.y), 0.27)) * 0.52);
    float dot0 = disc((length(p - vec2(0.0, -0.4)) - 0.095) * 0.52);
    over(col, glow(vec3(1.0), (bar + dot0) * 1.3 * pulse));
  } else {
    over(col, glow(C, gauss(length(q) - 1.1, 0.7) * 0.18));
    int count = uPerformanceTier == 2 ? 2 : 3;
    for (int i = 0; i < 3; i++) {
      if (i >= count) break;
      float fi = float(i);
      float ph = fract(t * 0.28 + fi / float(count));
      vec2 pos = vec2(sin(fi * 2.4 + ph * 3.0) * 0.95, 0.55 + 1.15 * ph);
      float size = 0.42 * (0.6 + 0.4 * sin(PI * ph));
      vec2 p = (q - pos) / size;
      p.y += 0.5;
      float d = sdHeart(p) * size;
      float life = sin(PI * ph);
      over(col, glow(L, disc(d) * 0.95 * life));
      over(col, glow(C, gauss(d, 0.3) * 0.5 * life));
    }
  }
  return col;
}
#endif

#if TOKEN_FX == 11
// CONCENTRATION: a scalloped wax seal frames the token in the caster's colour; it never covers the token's own art
vec4 fxConcentration(vec2 q, float t, vec3 C, vec3 L, float seed) {
  float r = length(q);
  if (r < 0.97 || r > 1.7) return vec4(0.0);
  float ang = atan(q.y, q.x);
  float rim = 1.15 + 0.06 * cos(14.0 * ang + t * 0.1);
  float d = r - rim;
  float band = (1.0 - smoothstep(-aa, aa, d)) * smoothstep(0.97, 0.99, r);
  float glowPulse = 0.75 + 0.25 * sin(t * 1.1);

  vec4 col = glow(C, gauss(max(d, 0.0), 0.16) * 0.55 * glowPulse * (1.0 - band));
  over(col, solid(mix(C * 0.55, C, smoothstep(0.98, rim, r)), band * 0.86));
  over(col, glow(L, stroke(d + 0.03, 0.014) * 0.9));
  over(col, glow(L, stroke(r - 1.055, 0.008) * 0.4));
  return col;
}
#endif

#if TOKEN_FX == 12
// CLOCK: a dial frames the token, its hand crawling round with a fading trail while time ripples close in
vec4 fxClock(vec2 q, float t, vec3 C, vec3 L, float seed) {
  float r = length(q);
  if (r < 0.97 || r > 1.7) return vec4(0.0);
  float ang = atan(q.y, q.x);
  float beat = 0.85 + 0.15 * pow(1.0 - fract(t), 6.0);
  vec4 col = glow(C, gauss(r - 1.22, 0.18) * 0.25 * beat);
  over(col, solid(C * 0.3, stroke(r - 1.22, 0.1) * 0.5));
  over(col, glow(L, (stroke(r - 1.12, 0.012) + stroke(r - 1.32, 0.012)) * 0.8));

  float sector = TAU / 12.0;
  float a = mod(ang + sector * 0.5, sector) - sector * 0.5;
  over(col, glow(L, stroke(a * r, 0.018) * stroke(r - 1.22, 0.07) * 1.1 * beat));

  float behind = mod(ang + t * 0.35 + seed * 6.0, TAU);
  float onDial = stroke(r - 1.22, 0.09);
  over(col, glow(C, exp(-behind * 1.8) * onDial * 0.9));
  over(col, glow(vec3(1.0), stroke(behind * r, 0.035) * onDial * 1.2));

  float ph = fract(t * 0.18);
  over(col, glow(L, stroke(r - (1.65 - 0.6 * ph), 0.014) * ph * (1.0 - ph) * 2.4));
  return col;
}
#endif

#if TOKEN_FX == 13
// STREAKS: speed lines whip round the token with crackling sparks
vec4 fxStreaks(vec2 q, float t, vec3 C, vec3 L, float seed) {
  float r = length(q);
  float ang = atan(q.y, q.x);
  vec4 col = glow(C, gauss(r - 1.0, 0.35) * 0.28 * (0.85 + 0.15 * sin(t * 9.0)));
  int lanes = uPerformanceTier == 2 ? 3 : 5;
  for (int i = 0; i < 5; i++) {
    if (i >= lanes) break;
    float fi = float(i);
    float h = hash12(vec2(fi, seed * 7.0));
    float behind = mod(t * (3.2 + 1.8 * h) + fi * 2.3 - ang, TAU);
    float tail = exp(-behind * 1.6);
    float lane = r - (1.1 + 0.55 * h);
    over(col, glow(C, gauss(lane, 0.12) * tail * 0.5));
    over(col, glow(vec3(1.0), gauss(lane, 0.035 + 0.02 * behind) * tail * 1.8));
  }
  float crackle = sparks(q, 2.6, 0.0, floor(t * 8.0) + seed * 13.0, 0.2) * gauss(r - 1.2, 0.35);
  over(col, glow(L, crackle * 2.2));
  return col;
}
#endif

#if TOKEN_FX == 14
// HALO: a radiant sunburst with rising crosses (variant 0, aid) or brave flames licking the edge (variant 1, heroism)
vec4 fxHalo(vec2 q, float t, vec3 C, vec3 L, float seed) {
  float r = length(q);
  float ang = atan(q.y, q.x);
  vec4 col = vec4(0.0);
  if (vInfo.y > 0.5) {
    float n = vnoise(vec2(ang * 3.0 + seed * 9.0, r * 2.5 - t * 2.2));
    float n2 = vnoise(vec2(ang * 7.0 - seed * 3.0, r * 5.0 - t * 3.4));
    float f = clamp(1.0 - (r - 0.95) / (0.35 + 0.45 * n + 0.2 * n2), 0.0, 1.0) * step(0.9, r);
    over(col, glow(C, gauss(r - 1.0, 0.6) * 0.18));
    over(col, glow(C, f * f * 1.1));
    over(col, glow(L, smoothstep(0.6, 0.95, f) * 0.6));
    float embers = sparks(q, 3.2, t * 1.4, seed * 11.0, 0.12);
    over(col, glow(L, embers * smoothstep(0.95, 1.2, r) * (1.0 - smoothstep(1.6, 2.2, r)) * 0.9));
    return col;
  }
  float rays = pow(0.5 + 0.5 * cos(ang * 12.0 + t * 0.4), 8.0);
  over(col, glow(C, rays * gauss(r - 1.35, 0.35) * smoothstep(0.95, 1.05, r) * 0.6));
  over(col, glow(C, gauss(r - 1.1, 0.25) * 0.3));
  over(col, glow(L, stroke(r - 1.12, 0.02) * (0.85 + 0.15 * sin(t * 1.7))));
  over(col, glow(L, stroke(r - 1.22, 0.01) * 0.6));
  int count = uPerformanceTier == 2 ? 2 : 4;
  for (int i = 0; i < 4; i++) {
    if (i >= count) break;
    float fi = float(i);
    float ph = fract(t * 0.22 + fi / float(count));
    float a = fi * 1.9 + seed * 6.0;
    vec2 p = (q - vec2(cos(a), sin(a)) * (1.25 + 0.6 * ph)) / 0.16;
    float plus = min(sdBox(p, vec2(1.0, 0.3)), sdBox(p, vec2(0.3, 1.0))) * 0.16;
    over(col, glow(L, disc(plus) * sin(PI * ph) * 1.1));
  }
  return col;
}
#endif

#if TOKEN_FX == 15
// VEIL: drifting mist turns the token see-through, its outline breaking up and catching the light
vec4 fxVeil(vec2 q, float t, vec3 C, vec3 L, float seed) {
  float r = length(q);
  if (r > 1.45) return vec4(0.0);
  float n = vnoise(q * 2.4 + vec2(t * 0.35, -t * 0.27) + seed * 9.0);
  float n2 = uPerformanceTier == 2 ? 0.5 : vnoise(q * 5.1 - vec2(t * 0.5, t * 0.2) + seed * 3.0);
  float m = n * 0.65 + n2 * 0.35;
  float inside = 1.0 - smoothstep(0.95, 1.08, r + (m - 0.5) * 0.12);
  vec4 col = solid(mix(C, vec3(0.92, 0.94, 1.0), 0.6) * 0.75, inside * (0.42 + 0.3 * smoothstep(0.35, 0.75, m)));
  over(col, glow(L, stroke(r - 1.04 - (m - 0.5) * 0.1, 0.02) * smoothstep(0.4, 0.6, n)));
  float sweep = pow(0.5 + 0.5 * cos(atan(q.y, q.x) + t * 0.9), 10.0);
  over(col, glow(vec3(1.0), sweep * stroke(r - 1.04, 0.05) * 0.5));
  over(col, glow(L, sparks(q, 4.0, t * 0.6, seed * 5.0, 0.09) * inside * 0.6));
  return col;
}
#endif

#if TOKEN_FX == 16
// WIND: the token hovers over its own shadow while gusts spiral round it
vec4 fxWind(vec2 q, float t, vec3 C, vec3 L, float seed) {
  float shadow = length(q - vec2(0.22, -0.32 - 0.04 * sin(t * 1.6))) - 0.95;
  vec4 col = solid(vec3(0.0), (1.0 - smoothstep(-0.1, 0.12, shadow)) * 0.38);
  float r = length(q);
  float ang = atan(q.y, q.x);
  over(col, glow(C, gauss(r - 1.05, 0.3) * 0.15));
  int gusts = uPerformanceTier == 2 ? 2 : 3;
  for (int i = 0; i < 3; i++) {
    if (i >= gusts) break;
    float fi = float(i);
    float behind = mod(t * (1.6 + 0.3 * fi) + fi * TAU / 3.0 + seed * 4.0 - ang, TAU);
    float tail = (1.0 - smoothstep(0.0, 2.2, behind)) * smoothstep(0.0, 0.25, behind);
    float rad = 1.15 + 0.12 * fi + 0.08 * behind;
    over(col, glow(vec3(1.0), gauss(r - rad, 0.03 + 0.015 * behind) * tail * 1.5));
    over(col, glow(C, gauss(r - rad, 0.12) * tail * 0.45));
  }
  return col;
}
#endif

#if TOKEN_FX == 17
// BLIND: smoke creeps over the token's rim under a struck-through eye
vec4 fxBlind(vec2 q, float t, vec3 C, vec3 L, float seed) {
  float r = length(q);
  float n = vnoise(vec2(atan(q.y, q.x) * 2.5 + seed * 7.0, r * 3.0 - t * 0.6));
  float smoke = smoothstep(0.78 + 0.2 * n, 1.05, r) * (1.0 - smoothstep(1.1, 1.5 + 0.25 * n, r));
  vec4 col = solid(C * 0.25, smoke * 0.7);
  over(col, glow(C, gauss(r - 1.2, 0.2) * 0.25));

  float s = 0.55;
  vec2 p = (q - vec2(0.0, 1.4 + 0.04 * sin(t * 1.3))) / s;
  float lid = max(length(p - vec2(0.0, -0.6)) - 0.9, length(p - vec2(0.0, 0.6)) - 0.9);
  float slash = segDist(p, vec2(-0.75, -0.55), vec2(0.75, 0.55));
  float pulse = 0.8 + 0.2 * sin(t * 2.0);
  over(col, solid(vec3(0.02), disc((length(p) - 0.95) * s) * 0.55));
  over(col, glow(L, stroke(lid * s, 0.022) * 1.2 * pulse));
  over(col, glow(L, disc((length(p) - 0.2) * s) * 0.9 * pulse));
  over(col, solid(vec3(0.02), stroke(slash * s, 0.05)));
  over(col, glow(vec3(1.0), stroke(slash * s, 0.022) * 1.3));
  return col;
}
#endif

#if TOKEN_FX == 18
// CALM: soft ripples spread out from the token while a slow breath of light swells and ebbs
vec4 fxCalm(vec2 q, float t, vec3 C, vec3 L, float seed) {
  float r = length(q);
  float breath = 0.5 + 0.5 * sin(t * 0.9);
  float rr = r + (vnoise(q * 2.2 + vec2(t * 0.15, -t * 0.12) + seed * 9.0) - 0.5) * 0.07;
  vec4 col = glow(C, gauss(r - 1.1, 0.55) * (0.22 + 0.2 * breath));
  over(col, glow(L, gauss(r - 1.02, 0.12) * (0.2 + 0.35 * breath)));
  int rings = uPerformanceTier == 2 ? 2 : 3;
  for (int i = 0; i < 3; i++) {
    if (i >= rings) break;
    float ph = fract(t * 0.2 + float(i) / float(rings));
    float life = (1.0 - ph) * smoothstep(0.0, 0.15, ph);
    float rad = 1.0 + 0.95 * ph;
    over(col, glow(C, gauss(rr - rad, 0.1 + 0.08 * ph) * life * 0.55));
    over(col, glow(L, stroke(rr - rad, 0.016 + 0.014 * ph) * life * 1.1));
  }
  if (uPerformanceTier < 2) {
    over(col, glow(L, sparks(q, 2.4, t * 0.25, seed * 5.0, 0.14) * gauss(r - 1.35, 0.5) * 0.9));
  }
  return col;
}
#endif

#if TOKEN_FX == 19
// HEAL: a green burst ring blooms out from the token, then sparkles keep rising round it
vec4 fxHeal(vec2 q, float t, vec3 C, vec3 L, float seed) {
  float r = length(q);
  float age = uTime - vInfo.x;
  float ph = clamp(age / 1.1, 0.0, 1.0);
  float ease = 1.0 - (1.0 - ph) * (1.0 - ph);
  float flash = exp(-age * 3.0);
  float rad = 0.9 + 1.0 * ease;
  float fade = 1.0 - ph;
  vec4 col = glow(C, gauss(r - 1.05, 0.5) * (0.2 + 0.15 * sin(t * 2.0)));
  over(col, glow(C, gauss(r - rad, 0.22) * fade * 0.9));
  over(col, glow(vec3(1.0), stroke(r - rad, 0.04 + 0.03 * fade) * fade * 1.5));
  over(col, glow(L, gauss(r, 1.0) * flash * 1.1));

  int layers = uPerformanceTier == 2 ? 1 : 2;
  for (int i = 0; i < 2; i++) {
    if (i >= layers) break;
    float fi = float(i);
    float rise = t * (0.9 + 0.5 * fi);
    float spark = sparks(q, 2.1 + fi * 0.9, rise, seed * 7.0 + fi * 3.1, 0.26);
    float band = smoothstep(0.7, 1.0, r) * (1.0 - smoothstep(1.5, 2.1, r));
    over(col, glow(mix(C, L, 0.5), spark * band * 1.5));
  }
  float plusPh = fract(t * 0.35);
  vec2 pp = (q - vec2(sin(seed * 20.0) * 0.5, 0.6 + 1.1 * plusPh)) / 0.2;
  float plus = min(sdBox(pp, vec2(1.0, 0.3)), sdBox(pp, vec2(0.3, 1.0))) * 0.2;
  over(col, glow(L, disc(plus) * sin(PI * plusPh) * 1.4));
  return col;
}
#endif

#if TOKEN_FX == 20
// TRANCE: a spiral of cycling colours turns round the token, tightening and loosening as it spins
vec4 fxTrance(vec2 q, float t, vec3 C, vec3 L, float seed) {
  float r = length(q);
  float ang = atan(q.y, q.x);
  float mask = smoothstep(0.8, 1.0, r) * (1.0 - smoothstep(1.4, 1.85, r));
  float phase = ang * 4.0 + r * (5.0 + 0.8 * sin(t * 0.5)) - t * 2.2;
  float arm = smoothstep(0.55, 0.95, 0.5 + 0.5 * cos(phase));
  float hue = r * 0.55 + ang / TAU + t * 0.12 + seed;
  vec3 rainbow = 0.55 + 0.45 * cos(TAU * (hue + vec3(0.0, 0.33, 0.67)));
  vec3 tint = mix(rainbow, C, 0.25);
  vec4 col = glow(tint, gauss(r - 1.15, 0.55) * 0.2);
  over(col, solid(tint * 0.7, arm * mask * 0.55));
  over(col, glow(tint, arm * mask * 0.55));
  float eye = gauss(r - 0.95, 0.06) * (0.6 + 0.4 * sin(t * 3.0));
  over(col, glow(rainbow, eye * 0.8));
  return col;
}
#endif

#if TOKEN_FX == 21
// OUTLINE: a flickering glowing outline hugs the token's rim, shedding sparks; the art stays uncovered
vec4 fxOutline(vec2 q, float t, vec3 C, vec3 L, float seed) {
  float r = length(q);
  if (r < 0.96 || r > 1.6) return vec4(0.0);
  float ang = atan(q.y, q.x);
  float edge = smoothstep(0.96, 0.99, r);
  float flick = vnoise(vec2(ang * 5.0 + seed * 9.0, t * 3.2));
  float breath = 0.8 + 0.2 * sin(t * 4.1 + flick * 4.0);
  float d = r - 1.0;
  vec4 col = glow(C, gauss(max(d, 0.0), 0.1 + 0.07 * flick) * 0.8 * breath * edge);
  over(col, glow(L, gauss(max(d - 0.02, 0.0), 0.04) * 0.9 * breath * edge));
  over(col, glow(L, stroke(d - 0.025, 0.014) * (0.5 + 0.5 * flick) * edge));
  float drift = sparks(q, 4.5, t * 0.7, seed * 3.0, 0.16);
  over(col, glow(L, drift * gauss(r - 1.12, 0.14) * 2.2 * edge));
  return col;
}
#endif

#if TOKEN_FX == 22
// DREAD: dark claws creep in from the edge toward the token as a shiver runs through them
float wrapAngle(float a) {
  return atan(sin(a), cos(a));
}

vec4 fxDread(vec2 q, float t, vec3 C, vec3 L, float seed) {
  q += 0.014 * vec2(sin(t * 38.0), cos(t * 33.0)) * (0.5 + 0.5 * sin(t * 1.7));
  float r = length(q);
  float ang = atan(q.y, q.x);
  vec4 col = vec4(0.0);
  float n = vnoise(vec2(ang * 2.5 + seed * 9.0, r * 3.0 - t * 0.6));
  float smoke = smoothstep(0.92, 1.1, r) * (1.0 - smoothstep(1.2, 1.9 + 0.2 * n, r));
  over(col, solid(vec3(0.02, 0.0, 0.03), smoke * (0.25 + 0.4 * n)));

  int claws = uPerformanceTier == 2 ? 4 : 6;
  for (int i = 0; i < 6; i++) {
    if (i >= claws) break;
    float fi = float(i);
    float a0 = fi * TAU / float(claws) + seed * 6.0 + 0.4 * sin(t * 0.3 + fi);
    float reach = 0.98 + 0.5 * (0.5 + 0.5 * sin(t * 0.9 + fi * 2.3));
    float along = r - reach;
    float bend = 0.18 * sin(r * 4.0 - t * 2.4 + fi * 1.7);
    float lateral = wrapAngle(ang - a0) * r - bend;
    float halfW = 0.28 * smoothstep(0.0, 0.8, along);
    float body = (1.0 - smoothstep(halfW - 0.015, halfW + 0.015, abs(lateral))) * step(0.0, along);
    float rim = stroke(abs(lateral) - halfW, 0.022) * step(0.0, along);
    float tail = 1.0 - smoothstep(1.5, 1.95, r);
    body *= tail;
    rim *= tail;
    over(col, solid(vec3(0.03, 0.0, 0.05), body * 0.92));
    over(col, glow(C, rim * 1.3));
    over(col, glow(L, gauss(lateral, 0.03) * gauss(along - 0.02, 0.05) * 1.4));
  }
  return col;
}
#endif

#if TOKEN_FX == 23
// SLUMBER: a dim haze settles over the token while Zs float up and away
float zGlyph(vec2 p) {
  float top = segDist(p, vec2(-0.6, 0.8), vec2(0.6, 0.8));
  float diag = segDist(p, vec2(0.6, 0.8), vec2(-0.6, -0.8));
  float bottom = segDist(p, vec2(-0.6, -0.8), vec2(0.6, -0.8));
  return min(min(top, diag), bottom) - 0.15;
}

vec4 fxSlumber(vec2 q, float t, vec3 C, vec3 L, float seed) {
  float r = length(q);
  float n = vnoise(q * 2.0 + vec2(t * 0.12, -t * 0.09) + seed * 9.0);
  float haze = (1.0 - smoothstep(0.85, 1.55, r + (n - 0.5) * 0.3));
  vec4 col = solid(vec3(0.03, 0.04, 0.12) + C * 0.12, haze * (0.2 + 0.12 * n));
  over(col, glow(C, gauss(r - 1.08, 0.4) * 0.3 * (0.75 + 0.25 * sin(t * 0.8))));

  int count = uPerformanceTier == 2 ? 2 : 3;
  for (int i = 0; i < 3; i++) {
    if (i >= count) break;
    float fi = float(i);
    float ph = fract(t * 0.2 + fi / float(count));
    float size = 0.22 + 0.22 * ph;
    vec2 pos = vec2(0.35 + 0.8 * ph + 0.1 * sin(ph * 6.0 + fi * 2.0), 0.6 + 0.95 * ph);
    vec2 p = rot((q - pos) / size, -0.15);
    float d = zGlyph(p) * size;
    float life = sin(PI * ph);
    over(col, glow(C, gauss(d, 0.09) * 1.0 * life));
    over(col, solid(mix(L, vec3(1.0), 0.35), disc(d) * 0.95 * life));
  }
  return col;
}
#endif

void main() {
  vec4 plane;
  #pragma unroll_loop
  for (int i = 0; i < NUM_CLIPPING_PLANES; i++) {
    plane = uClippingPlanes[i];
    if (dot(-vWorldPosition, plane.xyz) > plane.w) {
      discard;
    }
  }

  float seed = vTint.a;
  float age = uTime - vInfo.x;
  float enter = smoothstep(0.0, 0.7, age);
  if (enter <= 0.0) discard;

  aa = 1.4 / max(vPx, 1.0);
  vec2 q = (vUv - 0.5) * 2.0 * vInfo.z / mix(0.88, 1.0, enter);
  float t = uTime + seed * 97.0;
  vec3 C = vTint.rgb;
  vec3 L = mix(C, vec3(1.0), 0.55);

  vec4 col = vec4(0.0);
  #if TOKEN_FX == 0
  col = fxOrbit(q, t, C, L, seed);
  #elif TOKEN_FX == 1
  col = fxGlow(q, t, C, L, seed);
  #elif TOKEN_FX == 2
  col = fxShimmer(q, t, C, L, seed);
  #elif TOKEN_FX == 3
  col = fxGhosts(q, t, C, L, seed);
  #elif TOKEN_FX == 4
  col = fxWard(q, t, C, L, seed);
  #elif TOKEN_FX == 5
  col = fxChains(q, t, C, L, seed);
  #elif TOKEN_FX == 6
  col = fxMotes(q, t, C, L, seed);
  #elif TOKEN_FX == 7
  col = fxHaze(q, t, C, L, seed);
  #elif TOKEN_FX == 8
  col = fxSigil(q, t, C, L, seed);
  #elif TOKEN_FX == 9
  col = fxRift(q, t, C, L, seed);
  #elif TOKEN_FX == 10
  col = fxCharm(q, t, C, L, seed);
  #elif TOKEN_FX == 11
  col = fxConcentration(q, t, C, L, seed);
  #elif TOKEN_FX == 12
  col = fxClock(q, t, C, L, seed);
  #elif TOKEN_FX == 13
  col = fxStreaks(q, t, C, L, seed);
  #elif TOKEN_FX == 14
  col = fxHalo(q, t, C, L, seed);
  #elif TOKEN_FX == 15
  col = fxVeil(q, t, C, L, seed);
  #elif TOKEN_FX == 16
  col = fxWind(q, t, C, L, seed);
  #elif TOKEN_FX == 17
  col = fxBlind(q, t, C, L, seed);
  #elif TOKEN_FX == 18
  col = fxCalm(q, t, C, L, seed);
  #elif TOKEN_FX == 19
  col = fxHeal(q, t, C, L, seed);
  #elif TOKEN_FX == 20
  col = fxTrance(q, t, C, L, seed);
  #elif TOKEN_FX == 21
  col = fxOutline(q, t, C, L, seed);
  #elif TOKEN_FX == 22
  col = fxDread(q, t, C, L, seed);
  #elif TOKEN_FX == 23
  col = fxSlumber(q, t, C, L, seed);
  #endif

  if (vHighlight > 0.5) {
    float pulse = 0.5 + 0.5 * sin(uTime * 2.4);
    col.rgb *= 1.35 + 0.3 * pulse;
    col.a = min(1.0, col.a * (1.1 + 0.15 * pulse));
  }

  vec2 edge = abs(vUv - 0.5) * 2.0;
  col *= (1.0 - smoothstep(0.88, 1.0, max(edge.x, edge.y))) * enter;
  gl_FragColor = vec4(max(col.rgb, 0.0), clamp(col.a, 0.0, 1.0));
}
