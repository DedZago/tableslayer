precision highp float;

// One program per cast archetype: SPELL_FX selects a single fx function at compile time
// (0 burst, 1 cone, 2 bolt, 3 wave, 4 zone, 5 aura, 6 summon, 7 rain, 8 beam).
// Timeline (uProgress): travel/charge 0-0.4, impact 0.4-0.6 (HDR core for bloom), settle 0.6-1.
// All geometry is in feet relative to the cast target, on the layer axes.
// Output is premultiplied: alpha below the colour makes light-like additive glow.
#ifndef SPELL_FX
#define SPELL_FX 0
#endif

uniform float uTime;
uniform float uProgress;
uniform float uSeed;
uniform float uVariant;
uniform float uProjectile;
uniform int uPerformanceTier;
uniform int uShape;
uniform float uSize;
uniform float uWidth;
uniform vec2 uDir;
uniform vec2 uOrigin;
uniform vec2 uQuadSize;
uniform vec2 uQuadCenter;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec4 uClippingPlanes[NUM_CLIPPING_PLANES];

varying vec2 vUv;
varying vec3 vWorldPosition;

const float TAU = 6.2831853;

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

// Copied from AoeTemplate.frag so the cast sits exactly on the template's shape
float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

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

float easeOut(float x) {
  float k = 1.0 - clamp(x, 0.0, 1.0);
  return 1.0 - k * k * k;
}

float easeInOut(float x) {
  x = clamp(x, 0.0, 1.0);
  return x * x * (3.0 - 2.0 * x);
}

// 1 on x = 0, falling to 0 at |x| = w
float band(float x, float w) {
  return 1.0 - smoothstep(0.0, w, abs(x));
}

float gauss(float x, float w) {
  return exp(-(x * x) / (w * w));
}

float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
  return length(pa - ba * h);
}

// Premultiplied over: lets glows (alpha ~ 0) and solids layer in any order
void over(inout vec4 dst, vec4 src) {
  dst = src + dst * (1.0 - src.a);
}

vec4 glow(vec3 color, float amount) {
  return vec4(color * amount, 0.0);
}

vec4 solid(vec3 color, float coverage) {
  return vec4(color * coverage, coverage);
}

// Drifting sparks on a jittered grid; scale = cells per foot, rise in cells
float embers(vec2 p, float scale, float rise, float seed) {
  vec2 g = p * scale;
  g.y -= rise;
  vec2 cell = floor(g);
  vec2 f = fract(g) - 0.5;
  vec2 h = hash22(cell + seed);
  float on = step(0.55, hash12(cell + seed + 3.7));
  float d = length(f - (h - 0.5) * 0.7);
  return on * (1.0 - smoothstep(0.0, 0.07 + 0.06 * h.x, d)) * (0.5 + 0.5 * h.y);
}

// Visual centre of the area, so radial effects sit inside every shape
vec2 areaCenter() {
  if (uShape == 0) return vec2(0.0);
  if (uShape == 2) return vec2(uSize * 0.6667, 0.0);
  return vec2(uSize * 0.5, 0.0);
}

float areaRadius() {
  return max(-sdShape(areaCenter()), 1.0);
}

float areaMask(vec2 q, float soft) {
  return 1.0 - smoothstep(-soft, soft, sdShape(q));
}

float flashAt(float prog) {
  return smoothstep(0.38, 0.42, prog) * (1.0 - smoothstep(0.42, 0.62, prog));
}

#if SPELL_FX == 0
// BURST: projectile or charge, then a bloom (fireball), shockwave rings (shatter) or ice spikes (variant 1)
vec4 fxBurst(vec2 p, float prog, float t) {
  float R = uShape == 0 ? max(uSize, 2.5) : max(uSize * 0.6, 2.5);
  float r = length(p);
  vec2 unit = p / max(r, 0.01);
  float tr = clamp(prog / 0.4, 0.0, 1.0);
  float ie = clamp((prog - 0.4) / 0.35, 0.0, 1.0);
  float st = clamp((prog - 0.6) / 0.4, 0.0, 1.0);
  float fade = 1.0 - smoothstep(0.6, 1.0, prog);
  float flash = flashAt(prog);
  bool frost = uVariant > 0.5 && uVariant < 1.5;
  bool fireball = !frost && uProjectile > 0.5;
  bool hasShot = uProjectile > 0.5 && length(uOrigin) > 2.0;
  float wob = 1.0 + 0.1 * (vnoise(unit * 2.6 + uSeed * 9.0 + t * 0.4) - 0.5);
  vec4 col = vec4(0.0);

  if (prog < 0.43) {
    float lead = 1.0 - smoothstep(0.38, 0.43, prog);
    float ang = atan(p.y, p.x);
    float dash = step(0.5, fract(ang * 8.0 / TAU + t * 0.12));
    over(col, glow(uColorB, band(r - R, 0.22) * mix(1.0, dash, 0.75) * 0.55 * tr * lead));

    if (hasShot) {
      vec2 dirOut = normalize(uOrigin);
      float k = tr * tr;
      vec2 head = uOrigin * (1.0 - k);
      vec2 dp = p - head;
      float d2 = dot(dp, dp);
      if (frost) {
        vec2 u = vec2(dot(dp, dirOut), dot(dp, vec2(-dirOut.y, dirOut.x)));
        float shard = 1.0 - smoothstep(0.0, 0.14, abs(u.x) / 1.7 + abs(u.y) / 0.45 - 1.0);
        over(col, glow(vec3(1.0), shard * 3.5 * lead));
      } else {
        float headDist = sqrt(d2);
        over(col, glow(vec3(1.0), gauss(headDist, 0.5) * 3.0 * lead));
        over(col, glow(uColorB, gauss(headDist, 1.1) * 4.5 * lead));
      }
      over(col, glow(uColorA, gauss(sqrt(d2), 2.6) * 1.1 * lead));

      float trailLen = clamp(length(uOrigin) * 0.55, 5.0, 22.0) * (0.35 + 0.65 * tr);
      float along = clamp(dot(p - head, dirOut) / trailLen, 0.0, 1.0);
      float side = abs(dot(p - head, vec2(-dirOut.y, dirOut.x)));
      float behind = step(0.0, dot(p - head, dirOut));
      float width = mix(0.9, 0.08, along);
      float tail = band(side, width) * pow(1.0 - along, 1.5) * behind;
      over(col, glow(mix(uColorB, uColorA, along), tail * 2.8 * lead));
      if (uPerformanceTier == 0) {
        float flick = 0.7 + 0.3 * vnoise(vec2(along * 7.0 - t * 12.0, uSeed * 31.0));
        float sparkle = embers(vec2(dot(p - head, dirOut), dot(p - head, vec2(-dirOut.y, dirOut.x))), 0.9, t * 3.0, uSeed + 6.0) * behind * (1.0 - along) * band(side, 2.2);
        over(col, glow(uColorB, (tail * (flick - 0.7) * 2.0 + sparkle * 2.2) * lead));
      }
    } else if (fireball) {
      float k = tr * tr;
      float size = mix(3.4, 1.0, k);
      over(col, glow(vec3(1.0), gauss(r, size * 0.5) * mix(0.3, 3.0, k) * lead));
      over(col, glow(uColorB, gauss(r, size) * mix(0.4, 4.5, k) * lead));
      over(col, glow(uColorA, gauss(r, size * 2.6) * 1.0 * tr * lead));
      over(col, glow(uColorA, band(r - R * (1.0 - 0.9 * k), 0.3) * 0.6 * tr * lead));
    } else {
      float gather = easeOut(tr);
      float rr = R * (1.55 - 0.55 * gather);
      over(col, glow(uColorA, band(r - rr, 0.35) * 0.9 * tr * lead));
      over(col, glow(uColorB, gauss(r, 0.5 + R * 0.05) * gather * 2.6 * lead));
      over(col, glow(uColorB, embers(p, 0.8, -t * 3.0, uSeed) * gather * 2.0 * lead * step(r, rr)));
    }
  }

  if (prog >= 0.38) {
    float core = exp(-r / (R * 0.17 + 0.5)) * flash;
    over(col, glow(mix(uColorB, vec3(1.0), 0.45), core * 2.6));
    over(col, glow(uColorA, exp(-r / (R * 0.45 + 1.0)) * flash * 1.4));

    float ringR = R * easeOut(ie) * 1.06;
    float ring = band(r / wob - ringR, 0.22 + R * 0.1 * (1.0 - ie)) * pow(1.0 - ie, 1.4);

    if (frost) {
      float ang = atan(p.y, p.x);
      float spikes = pow(abs(cos(ang * 4.5 + uSeed * 6.0)), 7.0);
      float reach = R * easeOut(ie) * (0.45 + 0.7 * spikes);
      float body = 1.0 - smoothstep(reach * 0.88, reach, r);
      float rim = smoothstep(reach * 0.55, reach * 0.96, r) * (1.0 - smoothstep(reach * 0.96, reach, r));
      float crystal = body * fade;
      over(col, solid(uColorA * (0.7 + 0.5 * spikes), crystal * 0.38));
      over(col, glow(mix(uColorB, vec3(1.0), 0.5), (rim * 1.6 + body * spikes * 0.8) * fade));
      float twinkle = 0.5 + 0.5 * sin(t * 7.0 + hash12(floor(p * 1.4)) * TAU);
      over(col, glow(vec3(1.0), embers(p, 1.4, 0.0, uSeed + 4.0) * twinkle * 3.0 * fade * step(r, R * 1.1)));
      over(col, glow(uColorB, ring * 1.8));
    } else if (fireball) {
      float grow = easeOut(clamp((prog - 0.4) / 0.3, 0.0, 1.0));
      float Rb = R * (0.3 + 0.78 * grow);
      float n = fbm(p / R * 2.4 + vec2(0.0, -t * 0.7) + uSeed * 5.0);
      float dens = smoothstep(1.0, 0.22, r / Rb + (n - 0.5) * 0.9) * fade;
      float heat = clamp(dens * (1.2 - 0.75 * r / Rb) + flash * 0.5, 0.0, 1.0);
      vec3 hot = mix(uColorA * 0.55, uColorB, heat);
      hot = mix(hot, vec3(1.0), pow(heat, 4.0) * 0.4);
      over(col, vec4(hot * dens * (0.8 + heat * 1.6), dens * 0.85));
      float smoke = smoothstep(1.25, 0.9, r / Rb + (n - 0.5) * 0.5) * smoothstep(0.7, 1.15, r / Rb + (n - 0.5) * 0.5);
      over(col, solid(uColorA * 0.12, smoke * 0.35 * fade));
      over(col, glow(uColorB, ring * 1.6));
      over(col, glow(uColorB, embers(p, 0.55, st * 5.0 + t * 0.5, uSeed) * 3.2 * (1.0 - st) * step(r, R * 1.25)));
    } else {
      float ang = atan(p.y, p.x);
      float ringTwo = band(r / wob - R * easeOut(clamp(ie * 1.25 - 0.22, 0.0, 1.0)), 0.18 + R * 0.05) * pow(1.0 - ie, 1.6);
      float ringThree = band(r / wob - R * easeOut(clamp(ie * 1.4 - 0.4, 0.0, 1.0)), 0.14 + R * 0.04) * pow(1.0 - ie, 1.9);
      float crack = pow(abs(sin(ang * 5.0 + (vnoise(unit * 4.0 + uSeed) - 0.5) * 9.0)), 40.0);
      float crackReach = 1.0 - smoothstep(ringR * 0.8, ringR, r);
      over(col, glow(uColorB, (ring * 2.4 + ringTwo * 1.5 + ringThree) * 1.0));
      over(col, glow(mix(uColorA, vec3(1.0), 0.5), crack * crackReach * (1.0 - ie) * 1.3));
      over(col, solid(uColorA * 0.5, smoothstep(R, 0.0, r) * (1.0 - ie) * 0.28 * flash));
    }
    over(col, glow(uColorA, band(r - R, 0.3) * 0.5 * fade * smoothstep(0.0, 0.2, ie)));
  }
  return col;
}
#endif

#if SPELL_FX == 1
// CONE: charge orb at the apex, a fan sweeps out. Variant 0 flame, 1 prismatic, 2 frost shards
vec4 fxCone(vec2 q, float prog, float t) {
  float len = max(uSize, 5.0);
  float rad = length(q) / len;
  float na = atan(q.y, max(q.x, 0.0001)) / 0.4636;
  float inCone = 1.0 - smoothstep(-0.35, 0.35, sdShape(q));
  float tr = clamp(prog / 0.4, 0.0, 1.0);
  float fade = 1.0 - smoothstep(0.62, 1.0, prog);
  float flash = flashAt(prog);
  float front = easeOut(clamp((prog - 0.36) / 0.3, 0.0, 1.0));
  float back = easeInOut(clamp((prog - 0.6) / 0.4, 0.0, 1.0)) * 0.85;
  float lead = 1.0 - smoothstep(0.4, 0.46, prog);
  vec4 col = vec4(0.0);

  float orbR = 0.8 + 1.4 * easeOut(tr);
  float orb = gauss(length(q), orbR);
  float charge = smoothstep(0.0, 0.8, tr) * (lead + flash * 0.6);
  over(col, glow(mix(uColorB, vec3(1.0), 0.4), orb * charge * 3.0));
  over(col, glow(uColorA, gauss(length(q), orbR * 2.6) * charge * 0.6));
  if (prog < 0.45) {
    float spark = embers(q + vec2(t * 0.0), 0.9, -t * 4.0, uSeed) * (1.0 - tr * 0.5);
    float draw = gauss(length(q), 3.5 + 6.0 * (1.0 - tr));
    over(col, glow(uColorB, spark * draw * 2.4 * lead));
    float guide = band(q.y, 0.18 + 0.05 * len * 0.02) * step(0.0, q.x) * (1.0 - smoothstep(0.0, len, q.x)) * tr * 0.5 * lead;
    over(col, glow(uColorA, guide));
  }

  vec4 fan = vec4(0.0);
  if (prog > 0.36) {
    float band0 = smoothstep(back, back + 0.18, rad) * (1.0 - smoothstep(front - 0.1, front, rad));
    float spread = abs(na);
    if (uVariant > 1.5) {
      float mist = fbm(vec2(rad * 5.0 - t * 1.2, na * 1.6 + uSeed * 4.0));
      float shardLine = 1.0 - abs(2.0 * fract(rad * 9.0 + na * 2.6 + uSeed) - 1.0);
      float shards = smoothstep(0.88, 1.0, shardLine) * smoothstep(0.05, 0.5, mist);
      float teeth = smoothstep(1.02, 0.78, spread + (1.0 - abs(2.0 * fract(rad * 14.0) - 1.0)) * 0.12);
      float dens = teeth * smoothstep(0.1, 0.8, mist + 0.35) * band0;
      over(fan, solid(uColorA * (0.5 + 0.5 * rad), dens * 0.34 * fade));
      over(fan, glow(mix(uColorB, vec3(1.0), 0.5), (shards * 1.7 * band0 + dens * 0.28) * fade));
      float edge = band(rad - front, 0.05) * teeth;
      over(fan, glow(uColorB, edge * 3.0 * (1.0 - smoothstep(0.6, 0.85, prog))));
    } else if (uVariant > 0.5) {
      float flow = 0.5 + 0.5 * sin(na * 6.0 + rad * 9.0 - t * 4.0 + fbm(vec2(rad * 4.0, na)) * 3.0);
      vec3 rainbow = 0.5 + 0.5 * cos(TAU * (vec3(0.0, 0.33, 0.67) + na * 0.45 + rad * 0.55 - t * 0.35));
      vec3 tint = mix(rainbow, mix(uColorA, uColorB, flow), 0.22);
      float dens = smoothstep(1.05, 0.55, spread + (fbm(vec2(rad * 3.0 - t, na)) - 0.5) * 0.4) * band0;
      over(fan, solid(tint * (0.8 + 0.8 * flow), dens * 0.55 * fade));
      over(fan, glow(tint, dens * flow * 1.6 * fade + band(rad - front, 0.05) * 2.2 * (1.0 - smoothstep(0.6, 0.85, prog)) * dens));
    } else {
      float n = fbm(vec2(rad * 4.5 - t * 2.6, na * 1.8 + uSeed * 4.0));
      float dens = smoothstep(1.05, 0.12, spread + (n - 0.5) * 0.9 + rad * 0.25) * band0;
      float heat = clamp(dens * (1.15 - rad * 0.8) + (1.0 - rad) * 0.2 * band0, 0.0, 1.0);
      vec3 hot = mix(uColorA * 0.55, uColorB, heat);
      hot = mix(hot, vec3(1.0), pow(heat, 3.0) * 0.4);
      over(fan, vec4(hot * dens * (0.8 + 1.8 * heat * (1.0 - rad * 0.4)), dens * 0.8 * fade));
      float edge = band(rad - front, 0.06) * smoothstep(1.0, 0.4, spread);
      over(fan, glow(uColorB, edge * 2.6 * (1.0 - smoothstep(0.6, 0.85, prog))));
      over(fan, glow(uColorB, embers(q, 0.7, t * 2.0, uSeed + 2.0) * 3.0 * band0 * fade * (1.0 - spread)));
    }
  }
  over(col, fan * inCone);
  return col;
}
#endif

#if SPELL_FX == 2
// BOLT: crackling charge at the caster, then a branching jagged strike along the line with restrikes and afterglow
float jag(float x, float seed, float amp) {
  float cell = x / 4.5;
  float i = floor(cell);
  float f = fract(cell);
  float a = hash12(vec2(i, seed)) - 0.5;
  float b = hash12(vec2(i + 1.0, seed)) - 0.5;
  float fine = vnoise(vec2(x * 0.9, seed * 3.1)) - 0.5;
  return (mix(a, b, f) * 2.0 + fine * 0.6) * amp;
}

vec4 fxBolt(vec2 q, float prog, float t) {
  float len = max(uSize, 10.0);
  float amp = max(uWidth, 5.0) * 0.7 + 1.0;
  float tr = clamp(prog / 0.4, 0.0, 1.0);
  float flash = flashAt(prog);
  float lead = 1.0 - smoothstep(0.4, 0.45, prog);
  float fade = 1.0 - smoothstep(0.6, 1.0, prog);
  float px = max(fwidth(q.x), 0.02);
  vec4 col = vec4(0.0);

  float r0 = length(q);
  over(col, glow(mix(uColorB, vec3(1.0), 0.3), gauss(r0, 0.7 + 1.2 * tr) * tr * lead * 3.0));
  over(col, glow(uColorA, gauss(r0, 3.5) * tr * lead * 0.8));
  if (prog < 0.45) {
    for (int i = 0; i < 3; i++) {
      float s = uSeed * 17.0 + float(i) * 5.3 + floor(prog * 22.0);
      float reach = 3.0 + 7.0 * tr;
      float ang = hash12(vec2(s, 1.0)) * TAU;
      vec2 dir = vec2(cos(ang), sin(ang));
      float along = clamp(dot(q, dir) / reach, 0.0, 1.0);
      vec2 perpDir = vec2(-dir.y, dir.x);
      float off = (vnoise(vec2(along * 6.0, s)) - 0.5) * 1.6 * along;
      float dist = abs(dot(q, perpDir) - off);
      float arc = band(dist, max(0.12, px)) * (1.0 - along) * step(0.0, dot(q, dir)) * step(along, 0.999);
      over(col, glow(mix(uColorB, vec3(1.0), 0.5), arc * 2.4 * tr * lead));
    }
    float guide = band(q.y, 0.15) * step(0.0, q.x) * step(q.x, len) * tr * 0.35 * lead * (0.5 + 0.5 * sin(q.x * 1.4 - t * 10.0));
    over(col, glow(uColorA, guide));
  }

  if (prog > 0.38) {
    float strike = clamp((prog - 0.4) / 0.07, 0.0, 1.0);
    float reveal = len * easeOut(strike);
    float restrike = floor(clamp((prog - 0.4) / 0.2, 0.0, 0.999) * 3.0);
    float bright = (1.0 - smoothstep(0.4, 0.62, prog)) * (0.7 + 0.3 * mod(restrike, 2.0)) ;
    float seed = uSeed * 13.0 + restrike * 7.7;
    float x = clamp(q.x, 0.0, len);
    float y0 = jag(x, seed, amp) * smoothstep(0.0, 5.0, x);
    float yE = jag(x + 0.6, seed, amp) * smoothstep(0.0, 5.0, x + 0.6);
    float slope = clamp((yE - y0) / 0.6, -2.0, 2.0);
    float dist = abs(q.y - y0) / sqrt(1.0 + slope * slope);
    float inside = step(0.0, q.x) * (1.0 - smoothstep(reveal - 1.5, reveal, q.x));
    float coreW = max(0.22, px * 1.1);
    float beam = band(dist, coreW) * inside;
    float halo = gauss(dist, 0.9 + amp * 0.28) * inside;
    over(col, glow(mix(uColorB, vec3(1.0), 0.7), beam * 6.0 * bright));
    over(col, glow(uColorA, halo * 1.8 * bright));

    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float bx = len * (0.16 + 0.22 * fi + 0.1 * hash12(vec2(fi, seed)));
      float side = hash12(vec2(fi + 3.0, seed)) > 0.5 ? 1.0 : -1.0;
      float blen = len * (0.07 + 0.06 * hash12(vec2(fi, seed + 1.0)));
      float u = (q.x - bx) / blen;
      float by = jag(bx, seed, amp) * smoothstep(0.0, 5.0, bx) + side * (q.x - bx) * (0.7 + hash12(vec2(fi, seed + 2.0)));
      by += (vnoise(vec2(q.x * 1.3, fi * 9.0 + seed)) - 0.5) * 1.8 * clamp(u, 0.0, 1.0);
      float bd = abs(q.y - by) / 1.2;
      float on = step(0.0, u) * step(u, 1.0) * (1.0 - smoothstep(reveal - 1.0, reveal, q.x)) * step(bx, reveal);
      float limb = band(bd, max(0.2, px)) * (1.0 - u) * on;
      over(col, glow(mix(uColorB, vec3(1.0), 0.4), limb * 4.5 * bright));
      over(col, glow(uColorA, gauss(bd, 0.7) * (1.0 - u) * on * 0.6 * bright));
    }

    float after = gauss(q.y - y0, 1.4 + amp * 0.35) * step(0.0, q.x) * step(q.x, len);
    over(col, glow(uColorA, after * 0.7 * smoothstep(0.45, 0.6, prog) * fade));
    float impactGlow = gauss(length(q - vec2(reveal, jag(len, seed, amp))), 2.5);
    over(col, glow(vec3(1.0), impactGlow * flash * 2.0 * step(0.97, strike)));
  }
  return col;
}
#endif

#if SPELL_FX == 3
// WAVE: a pressure front pushes out from the caster across the cube or emanation, trailing ripples behind it
vec4 fxWave(vec2 q, float prog, float t) {
  float maxR = uShape == 0 ? max(uSize, 5.0) : max(uSize, 5.0) * 1.12;
  float r = length(q);
  vec2 unit = q / max(r, 0.01);
  float tr = clamp(prog / 0.4, 0.0, 1.0);
  float lead = 1.0 - smoothstep(0.38, 0.45, prog);
  float fade = 1.0 - smoothstep(0.6, 1.0, prog);
  float flash = flashAt(prog);
  float sweep = easeOut(clamp((prog - 0.38) / 0.4, 0.0, 1.0));
  float front = maxR * sweep;
  float wob = 1.0 + 0.09 * (vnoise(unit * 3.2 + t * 0.5 + uSeed * 7.0) - 0.5);
  float inside = areaMask(q, 0.8);
  float near = 1.0 - smoothstep(0.0, 5.0, max(sdShape(q), 0.0));
  float mask = inside + (1.0 - inside) * near * 0.3;
  vec4 col = vec4(0.0);

  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float cycle = fract(tr * 1.4 + fi / 3.0);
    float rr = mix(maxR * 0.5, 0.5, cycle);
    over(col, glow(uColorB, band(r - rr, 0.3) * sin(cycle * 3.14159) * 0.9 * lead * tr));
  }
  over(col, glow(mix(uColorB, vec3(1.0), 0.5), gauss(r, 0.6 + 0.5 * tr) * tr * 1.6 * lead));

  if (prog > 0.36) {
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float spacing = maxR * (0.1 + 0.02 * fi);
      float rr = front - fi * spacing;
      float amp = pow(0.55, fi) * (1.0 - sweep * 0.55);
      float w = 0.5 + maxR * 0.045 * (1.0 + fi * 0.4);
      float ring = band(r / wob - rr, w) * step(0.0, rr);
      over(col, glow(mix(uColorB, vec3(1.0), 0.35 * (1.0 - fi * 0.3)), ring * amp * 2.0 * mask * fade));
      over(col, solid(uColorA * 0.6, ring * amp * 0.22 * mask * fade));
    }
    float body = (1.0 - smoothstep(front * 0.4, front, r)) * smoothstep(0.0, 0.4 * maxR, front - r + 0.001);
    float streak = pow(abs(sin(atan(q.y, q.x) * 14.0 + t * 2.0)), 12.0) * band(r - front * 0.75, front * 0.28);
    over(col, glow(uColorB, streak * 1.4 * mask * fade * sweep));
    over(col, glow(uColorA, gauss(r - front, maxR * 0.14) * 0.4 * mask * fade));
    over(col, glow(uColorB, body * 0.1 * mask * fade));
    over(col, glow(vec3(1.0), gauss(r, 0.8 + maxR * 0.04) * flash * 1.6));
  }
  return col;
}
#endif

#if SPELL_FX == 4
// ZONE: the outline draws itself, a ripple floods the area, then it settles into the template.
// Variants: 0 ripple, 1 drifting motes (sleep), 2 descending pillar (moonbeam), 3 sleet (sleet storm),
// 4 webbing strands, 5 billowing cloud, 6 collapsing void
vec4 fxZone(vec2 q, float prog, float t) {
  vec2 ctr = areaCenter();
  float R = areaRadius();
  float d = sdShape(q);
  float rr = length(q - ctr);
  vec2 unit = (q - ctr) / max(rr, 0.01);
  float tr = clamp(prog / 0.4, 0.0, 1.0);
  float im = clamp((prog - 0.4) / 0.2, 0.0, 1.0);
  float lead = 1.0 - smoothstep(0.38, 0.46, prog);
  float fade = 1.0 - smoothstep(0.62, 1.0, prog);
  float flash = flashAt(prog);
  float inside = 1.0 - smoothstep(-0.5, 0.5, d);
  float px = max(fwidth(q.x), 0.02);
  float ang = atan(q.y - ctr.y, q.x - ctr.x);
  vec4 col = vec4(0.0);
  bool pillar = uVariant > 1.5 && uVariant < 2.5;

  float draw = step(ang / TAU + 0.5, easeOut(tr * 1.25));
  float outline = band(d, max(0.35, px * 1.2)) * draw;
  over(col, glow(uColorB, outline * (lead * 0.9 + (1.0 - lead) * 0.5 * fade)));

  if (pillar) {
    float desc = easeInOut(clamp(prog / 0.42, 0.0, 1.0));
    float beamR = R * (1.0 + 2.2 * (1.0 - desc));
    over(col, glow(uColorB, band(rr - beamR, 0.35) * 0.8 * lead * tr));
    float shaft = pow(abs(sin(ang * 9.0 + t * 0.6 + fbm(unit * 2.0 + t * 0.3) * 2.0)), 6.0);
    float cone = inside * (1.0 - smoothstep(0.0, R * 1.15, rr));
    float ray = smoothstep(0.35, 1.0, shaft) * (1.0 - smoothstep(0.2 * R, 1.4 * R, rr));
    over(col, glow(uColorB, ray * (0.6 * desc * lead + 1.0 * flash) * smoothstep(0.0, 0.2, tr)));
    over(col, solid(uColorA * (0.8 + 0.4 * (1.0 - rr / R)), cone * desc * 0.22 * (lead + (1.0 - lead) * fade)));
    over(col, glow(vec3(1.0), gauss(rr, R * 0.5) * desc * 0.35 * lead));
    over(col, glow(vec3(1.0), gauss(rr, R * 0.5) * flash * 1.6));
    over(col, glow(uColorB, embers(q, 0.8, t * 3.0, uSeed) * inside * (desc * lead + (1.0 - lead) * fade) * 2.6));
  } else {
    float rg = R * 1.25 * easeOut(im);
    float flood = smoothstep(rg, rg - 0.35 * R - 0.5, rr) * inside * step(0.4, prog);
    float rim = band(rr - rg, 0.3 + 0.1 * R) * inside * (1.0 - im) * step(0.4, prog);
    float n = fbm(q * 0.5 / max(R * 0.18, 1.0) + vec2(t * 0.4, -t * 0.25) + uSeed * 9.0);
    over(col, solid(mix(uColorA, uColorB, n) * 0.85, flood * (0.3 + 0.35 * n) * fade));
    over(col, glow(uColorB, rim * 2.6));
    over(col, glow(vec3(1.0), gauss(rr, R * 0.25) * flash * 1.3 * inside));
    float ripple = band(rr - R * 1.2 * easeOut(tr), 0.4 + 0.1 * R) * inside * lead * tr * 0.7;
    over(col, glow(uColorB, ripple));

    if (uVariant > 0.5 && uVariant < 1.5) {
      float field = inside * (smoothstep(0.1, 0.5, tr) * lead + (1.0 - lead) * fade);
      float fall = embers(q, 0.55, t * 1.6, uSeed) + embers(q * 1.9, 0.55, t * 2.4, uSeed + 8.0);
      float zig = 0.5 + 0.5 * sin(t * 3.0 + hash12(floor(q * 0.55)) * TAU);
      over(col, glow(mix(uColorB, vec3(1.0), 0.4), fall * zig * 2.8 * field));
      over(col, glow(uColorA, gauss(rr, R * 0.7) * field * 0.35 * (0.6 + 0.4 * sin(t * 2.0))));
    } else if (uVariant > 2.5 && uVariant < 3.5) {
      vec2 sleetP = vec2(q.x * 0.96 + q.y * 0.28, q.y * 0.96 - q.x * 0.28);
      float cw = 1.5;
      float cx = floor(sleetP.x / cw);
      float h = hash12(vec2(cx, uSeed * 40.0));
      float yy = mod(sleetP.y + t * (18.0 + 10.0 * h) + h * 50.0, 22.0);
      float streak = band(sleetP.x - (cx + 0.5) * cw, 0.12) * smoothstep(3.2, 0.0, yy) * step(0.0, yy);
      float field = inside * (smoothstep(0.0, 0.3, tr) * lead + (1.0 - lead) * fade);
      over(col, glow(mix(uColorB, vec3(1.0), 0.3), streak * 1.8 * field * step(0.35, h)));
      over(col, glow(uColorA, gauss(rr, R * 0.9) * field * 0.25));
    } else if (uVariant > 3.5 && uVariant < 4.5) {
      float field = inside * (smoothstep(0.0, 0.35, tr) * lead + (1.0 - lead) * fade);
      float grown = 1.0 - smoothstep(R * 1.05 * easeOut(clamp((prog - 0.03) / 0.4, 0.0, 1.0)), R * 1.1 * easeOut(clamp((prog - 0.03) / 0.4, 0.0, 1.0)) + 0.5, rr);
      float spokes = pow(abs(cos(ang * 7.0 + uSeed * 6.0)), 30.0) * (1.0 - smoothstep(0.0, R * 1.1, rr) * 0.5);
      float rings = 1.0 - smoothstep(0.0, 0.07, abs(fract(rr * (1.0 + 0.07 * cos(ang * 14.0)) / (R * 0.24) + 0.5) - 0.5));
      over(col, glow(mix(uColorB, vec3(1.0), 0.35), (spokes * 1.1 + rings * 0.8) * grown * field * 1.5));
      over(col, glow(vec3(1.0), embers(q, 0.7, 0.0, uSeed + 3.0) * grown * field * 2.2));
    } else if (uVariant > 4.5 && uVariant < 5.5) {
      float grow = easeOut(clamp((prog - 0.04) / 0.45, 0.0, 1.0));
      float puff = fbm(q / max(R, 1.0) * 2.0 + vec2(t * 0.25, -t * 0.18) + uSeed * 7.0);
      float cloud = smoothstep(R * 1.2 * grow, R * 0.35 * grow, rr + (puff - 0.5) * R * 0.7) * inside;
      float life = smoothstep(0.0, 0.3, tr) * lead + (1.0 - lead) * fade;
      over(col, solid(mix(uColorA, uColorB, puff) * 0.75, cloud * 0.5 * life));
      over(col, glow(uColorB, band(rr - R * 1.15 * grow, 0.4 + 0.1 * R) * inside * lead * 0.8));
    } else if (uVariant > 5.5) {
      float life = smoothstep(0.0, 0.3, tr) * lead + (1.0 - lead) * fade;
      float arms = pow(0.5 + 0.5 * sin(ang * 3.0 - t * 1.2 + rr / R * 6.0), 4.0);
      float hole = inside * smoothstep(R * 0.95, R * 0.15, rr) * life;
      over(col, solid(uColorA * 0.12, hole * 0.55));
      over(col, glow(uColorB, arms * hole * 0.9));
      over(col, glow(uColorB, band(rr - R * (1.5 - 1.2 * easeOut(tr)), 0.35) * inside * lead * 1.2));
    } else {
      over(col, glow(uColorB, embers(q, 0.5, -t * 2.5, uSeed + 1.0) * inside * (flood + lead * tr * 0.5) * 2.4 * fade));
    }
  }
  return col;
}
#endif

#if SPELL_FX == 5
// AURA: spirits spiral out of the caster and settle into an orbiting emanation
vec4 fxAura(vec2 q, float prog, float t) {
  float R = max(uSize, 5.0);
  float r = length(q);
  float tr = clamp(prog / 0.4, 0.0, 1.0);
  float im = clamp((prog - 0.4) / 0.2, 0.0, 1.0);
  float fade = 1.0 - smoothstep(0.7, 1.0, prog);
  float flash = flashAt(prog);
  float lead = 1.0 - smoothstep(0.4, 0.5, prog);
  vec4 col = vec4(0.0);
  if (r > R * 1.3) return col;

  over(col, glow(mix(uColorB, vec3(1.0), 0.4), gauss(r, 0.7 + 0.8 * tr) * tr * lead * 1.8));
  over(col, glow(uColorA, gauss(r, R * 0.45) * (tr * lead * 0.5 + flash * 0.45)));
  float ring = band(r - R * 1.05 * easeOut(clamp((prog - 0.3) / 0.45, 0.0, 1.0)), 0.3 + R * 0.06);
  over(col, glow(uColorB, ring * (1.0 - clamp((prog - 0.3) / 0.45, 0.0, 1.0)) * 1.8 * step(0.3, prog)));
  float inner = smoothstep(R * 1.02, R * 0.75, r) * smoothstep(0.25, 0.55, prog);
  float sa = t * 0.35;
  vec2 sq = mat2(cos(sa), -sin(sa), sin(sa), cos(sa)) * q;
  float swirl = fbm(sq * 0.22 + uSeed * 6.0);
  over(col, glow(uColorA, inner * swirl * 0.55 * fade));

  int taps = uPerformanceTier == 0 ? 3 : 1;
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    float delay = 0.12 + 0.035 * fi;
    vec3 tint = mod(fi, 2.0) < 0.5 ? uColorA : uColorB;
    for (int j = 0; j < 3; j++) {
      if (j >= taps) break;
      float tau = clamp((prog - delay - float(j) * 0.025) / 0.58, 0.0, 1.0);
      if (tau <= 0.0) continue;
      float radius = R * mix(0.1, 0.92, easeOut(tau)) * (0.82 + 0.18 * hash12(vec2(fi, uSeed)));
      float ang = fi * 0.7853982 + tau * (4.2 + hash12(vec2(fi, 3.0)) * 1.6) + uSeed * 6.0;
      vec2 pos = radius * vec2(cos(ang), sin(ang));
      float d = length(q - pos);
      float size = (0.55 + 0.25 * hash12(vec2(fi, 9.0))) * (1.0 - float(j) * 0.25);
      float life = smoothstep(0.0, 0.12, tau) * (1.0 - smoothstep(0.7, 1.0, prog));
      float body = gauss(d, size) * (j == 0 ? 3.0 : 1.2 / (1.0 + float(j)));
      over(col, glow(mix(tint, vec3(1.0), j == 0 ? 0.5 : 0.1), body * life));
      over(col, glow(tint, gauss(d, size * 2.8) * 0.4 * life));
    }
  }
  return col;
}
#endif

#if SPELL_FX == 6
// SUMMON: an orb twirls from the caster to the spot, then a conjuration ring flashes
vec4 fxSummon(vec2 q, float prog, float t) {
  float R = max(uSize, 4.0) * 0.9;
  float r = length(q);
  float tr = clamp(prog / 0.4, 0.0, 1.0);
  float ie = clamp((prog - 0.4) / 0.3, 0.0, 1.0);
  float fade = 1.0 - smoothstep(0.65, 1.0, prog);
  float flash = flashAt(prog);
  float lead = 1.0 - smoothstep(0.38, 0.43, prog);
  float ang = atan(q.y, q.x);
  vec4 col = vec4(0.0);

  float circleIn = smoothstep(0.0, 0.5, tr) * lead + (1.0 - lead) * fade;
  float runes = step(0.5, fract(ang * 6.0 / TAU + t * 0.2)) * 0.5 + 0.5;
  over(col, glow(uColorB, band(r - R, 0.2) * runes * circleIn * 0.9));
  over(col, glow(uColorA, band(r - R * 0.62, 0.14) * circleIn * 0.5 * step(0.5, fract(ang * 12.0 / TAU - t * 0.3))));
  float blades = step(0.5, uVariant);
  float star = pow(abs(cos(ang * mix(3.0, 2.0, blades) + t * mix(0.5, 2.5, blades))), 24.0) * band(r - R * 0.8, R * 0.2);
  over(col, glow(uColorB, star * circleIn * 0.9));

  bool travelling = length(uOrigin) > 2.0;
  vec2 from = travelling ? uOrigin : vec2(0.0, R * 2.4);
  vec2 dirTravel = normalize(-from);
  vec2 sideTravel = vec2(-dirTravel.y, dirTravel.x);
  float span = length(from);
  int taps = uPerformanceTier == 0 ? 8 : (uPerformanceTier == 1 ? 3 : 1);

  if (prog < 0.44) {
    for (int i = 0; i < 8; i++) {
      if (i >= taps) break;
      float lag = float(i) * 0.04;
      float k = clamp(tr - lag, 0.0, 1.0);
      if (k <= 0.0) continue;
      float e = easeInOut(k);
      float turn = k * TAU * 2.5;
      float swirl = (1.0 - e * 0.85) * min(span * 0.28, 3.2);
      vec2 pos = from * (1.0 - e) + sideTravel * sin(turn) * swirl;
      float depth = 0.75 + 0.25 * cos(turn);
      float size = (0.6 + 0.25 * depth) * (i == 0 ? 1.0 : 1.0 - float(i) * 0.1);
      float d = length(q - pos);
      float amount = (i == 0 ? 4.0 : 1.4 / (1.0 + float(i) * 0.5)) * lead;
      over(col, glow(mix(uColorB, vec3(1.0), i == 0 ? 0.55 : 0.1), gauss(d, size) * amount));
      if (i == 0) over(col, glow(uColorA, gauss(d, size * 3.2) * 0.7 * lead));
    }
  }

  if (prog > 0.38) {
    float expand = easeOut(ie);
    over(col, glow(mix(uColorB, vec3(1.0), 0.7), gauss(r, R * 0.25) * flash * 2.4));
    float flashRing = band(r - R * (0.5 + 0.9 * expand), 0.25 + 0.2 * R * (1.0 - ie)) * (1.0 - ie);
    over(col, glow(uColorB, flashRing * 3.4));
    over(col, glow(uColorA, gauss(r, R * 0.9) * (1.0 - ie) * 0.8));
    float burstAngle = hash12(floor(vec2(ang * 8.0 / TAU, 4.0))) ;
    float spokes = pow(abs(cos(ang * 4.0 + 0.4)), 18.0);
    over(col, glow(uColorB, spokes * band(r - R * 1.3 * expand, R * 0.5) * (1.0 - ie) * 1.5));
    over(col, glow(uColorB, embers(q, 0.9, t * 3.0, uSeed + 5.0) * step(r, R * 1.4) * 2.8 * (1.0 - smoothstep(0.55, 1.0, prog)) * burstAngle));
  }
  return col;
}
#endif

#if SPELL_FX == 7
// RAIN: hail streaks fall through the area, bursting where they land
vec4 fxRain(vec2 q, float prog, float t) {
  float R = max(uSize, 5.0);
  float r = length(q);
  float fade = 1.0 - smoothstep(0.78, 1.0, prog);
  float tr = clamp(prog / 0.4, 0.0, 1.0);
  float lead = 1.0 - smoothstep(0.3, 0.46, prog);
  float inside = 1.0 - smoothstep(-0.5, 0.5, r - R);
  vec4 col = vec4(0.0);

  float outline = band(r - R, 0.35) * smoothstep(0.0, 0.5, tr) * (0.5 + 0.5 * fade);
  over(col, glow(uColorB, outline * 0.8));
  float cloud = fbm(q / R * 2.2 + vec2(t * 0.25, 0.0) + uSeed * 8.0);
  over(col, glow(uColorA, inside * cloud * 0.26 * smoothstep(0.0, 0.3, prog) * fade));

  float cw = max(R / 11.0, 1.4);
  float cx = floor(q.x / cw);
  int layers = uPerformanceTier == 0 ? 3 : (uPerformanceTier == 1 ? 2 : 1);
  float fall = 15.0 + R * 0.5;
  for (int i = 0; i < 3; i++) {
    if (i >= layers) break;
    float fi = float(i);
    vec2 h = hash22(vec2(cx + fi * 17.0, uSeed * 31.0 + fi));
    float xc = (cx + 0.5 + (h.x - 0.5) * 0.5) * cw;
    float chord = sqrt(max(R * R - xc * xc, 0.0)) * 0.92;
    float yg = (h.y * 2.0 - 1.0) * chord;
    float start = (0.04 + 0.5 * hash12(vec2(cx, fi + 5.0 + uSeed))) + fi * 0.06;
    float tau = (prog - start) / 0.16;
    if (tau > -0.02 && tau < 1.0) {
      float k = clamp(tau, 0.0, 1.0);
      float y = yg + fall * (1.0 - k * k);
      float along = clamp((q.y - y) / 3.6, 0.0, 1.0);
      float streak = band(q.x - xc, 0.2 * (1.0 - along * 0.6) + 0.04) * step(0.0, q.y - y) * (1.0 - along);
      float headGlow = gauss(length(vec2(q.x - xc, q.y - y)), 0.5);
      float vis = step(abs(xc), R * 0.98) * smoothstep(-0.02, 0.05, tau);
      over(col, glow(uColorA, streak * 1.5 * vis));
      over(col, glow(mix(uColorB, vec3(1.0), 0.6), headGlow * 3.2 * vis));
    }
    float since = tau - 1.0;
    if (since >= 0.0 && since < 1.6) {
      vec2 hit = vec2(xc, yg);
      float s = since / 1.6;
      float d = length(q - hit);
      float splash = band(d - (0.2 + cw * 0.4 * easeOut(s)), 0.14) * (1.0 - s);
      over(col, glow(mix(uColorB, vec3(1.0), 0.4), (splash * 2.0 + gauss(d, 0.45) * (1.0 - s) * (1.0 - s) * 2.4) * step(abs(xc), R * 0.98)));
    }
  }
  float frozen = embers(q, 0.7, 0.0, uSeed + 11.0) * smoothstep(0.55, 0.8, prog) * fade;
  float twinkle = 0.5 + 0.5 * sin(t * 6.0 + hash12(floor(q * 0.7)) * TAU);
  over(col, glow(vec3(1.0), frozen * twinkle * 2.4 * inside));
  over(col, glow(uColorB, inside * flashAt(prog) * 0.35 * lead));
  return col;
}
#endif

#if SPELL_FX == 8
// BEAM: a twisting ribbon streaks from the caster to the target and blooms on the token (no caster: bloom only)
vec4 fxBeam(vec2 p, float prog, float t) {
  float R = max(uSize * 0.6, 2.2);
  float r = length(p);
  float tr = clamp(prog / 0.4, 0.0, 1.0);
  float ie = clamp((prog - 0.4) / 0.4, 0.0, 1.0);
  float fade = 1.0 - smoothstep(0.6, 1.0, prog);
  float flash = flashAt(prog);
  bool travelling = length(uOrigin) > 2.0;
  vec4 col = vec4(0.0);

  if (travelling) {
    float run = tr * tr * (3.0 - 2.0 * tr);
    float tailRun = clamp(run - 0.55 + max(prog - 0.4, 0.0) * 5.5, 0.0, 1.0);
    vec2 head = mix(uOrigin, vec2(0.0), run);
    vec2 tail = mix(uOrigin, vec2(0.0), tailRun);
    vec2 axis = head - tail;
    float len = max(length(axis), 0.001);
    vec2 dir = axis / len;
    vec2 side = vec2(-dir.y, dir.x);
    float s = dot(p - tail, dir);
    float v = dot(p - tail, side);
    float along = clamp(s / len, 0.0, 1.0);
    float inside = step(0.0, s) * step(s, len) * step(0.4, length(axis));
    float life = 1.0 - smoothstep(0.42, 0.56, prog);
    float taper = along * along;

    float core = gauss(v, 0.2 + 0.1 * (1.0 - along)) * taper * inside;
    if (uVariant > 0.5 && uVariant < 1.5) core *= mix(1.0, step(0.5, fract(s * 1.4 - t * 2.0)), 0.8);
    over(col, glow(mix(uColorB, vec3(1.0), 0.6), core * 2.6 * life));
    over(col, glow(uColorA, gauss(v, 0.9) * taper * inside * 0.55 * life));

    if (uPerformanceTier < 2) {
      float curse = step(1.5, uVariant);
      float amp = (0.55 + 0.6 * curse) * (1.0 - along * 0.4);
      float wave = s * (1.1 - 0.5 * curse) - t * (16.0 - 11.0 * curse);
      float strandA = band(v - amp * sin(wave), 0.2) * taper * inside;
      float strandB = band(v + amp * sin(wave), 0.2) * taper * inside;
      over(col, glow(uColorB, (strandA + strandB) * 1.5 * life));
    }

    float headDist = length(p - head);
    over(col, glow(uColorB, gauss(headDist, 0.5) * 4.0 * life));
    over(col, glow(uColorA, gauss(headDist, 1.6) * 0.9 * life));
    if (uPerformanceTier == 0) {
      float sparks = embers(vec2(s, v), 0.8, t * 2.0, uSeed + 2.0) * inside * band(v, 1.6);
      over(col, glow(uColorB, sparks * 2.2 * life));
    }
  }

  float charge = smoothstep(0.0, 0.4, prog) * (1.0 - smoothstep(0.4, 0.46, prog));
  over(col, glow(uColorA, gauss(r, R * 0.9) * charge * 0.45));

  if (prog > 0.38) {
    float expand = easeOut(ie);
    over(col, glow(mix(uColorB, vec3(1.0), 0.7), gauss(r, R * 0.45) * flash * 3.2));
    float clamped = step(0.5, uVariant) * step(uVariant, 1.5);
    float ring = band(r - R * mix(0.35 + 1.15 * expand, 1.5 - 1.15 * expand, clamped), 0.18 + 0.2 * R * (1.0 - ie)) * (1.0 - ie);
    over(col, glow(uColorB, ring * 3.0));
    over(col, glow(uColorA, gauss(r, R * 1.3) * (1.0 - ie) * (1.0 - ie) * 1.1));
    float ang = atan(p.y, p.x);
    float spokes = pow(abs(cos(ang * 3.0 + uSeed * 6.0)), 20.0);
    over(col, glow(uColorB, spokes * band(r - R * 1.4 * expand, R * 0.45) * (1.0 - ie) * 1.6));
    if (uPerformanceTier < 2) {
      float motes = embers(p, 1.1, t * 1.6, uSeed + 7.0) * step(r, R * 1.7) * fade;
      over(col, glow(uColorB, motes * 2.4));
    }
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

  if (uProgress >= 1.0) discard;

  vec2 p = (vUv - 0.5) * uQuadSize + uQuadCenter;
  vec2 q = vec2(dot(p, uDir), dot(p, vec2(-uDir.y, uDir.x)));
  float prog = clamp(uProgress, 0.0, 1.0);
  float t = uTime + uSeed * 97.0;

  vec4 col = vec4(0.0);
  #if SPELL_FX == 0
  col = fxBurst(p, prog, t);
  #elif SPELL_FX == 1
  col = fxCone(q, prog, t);
  #elif SPELL_FX == 2
  col = fxBolt(q, prog, t);
  #elif SPELL_FX == 3
  col = fxWave(q, prog, t);
  #elif SPELL_FX == 4
  col = fxZone(q, prog, t);
  #elif SPELL_FX == 5
  col = fxAura(q, prog, t);
  #elif SPELL_FX == 6
  col = fxSummon(p, prog, t);
  #elif SPELL_FX == 7
  col = fxRain(p, prog, t);
  #elif SPELL_FX == 8
  col = fxBeam(p, prog, t);
  #endif

  vec2 edge = abs(vUv - 0.5) * 2.0;
  col *= 1.0 - smoothstep(0.9, 1.0, max(edge.x, edge.y));
  gl_FragColor = vec4(max(col.rgb, 0.0), clamp(col.a, 0.0, 1.0));
}
