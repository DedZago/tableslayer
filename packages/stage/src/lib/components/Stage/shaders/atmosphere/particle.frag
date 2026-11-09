// Procedural particle shapes, selected at compile time by PARTICLE_SHAPE (same numbering as the shape list in
// air/airMaterials.ts): 0 streak 1 drop 2 flake 3 atlasSnow 4 atlasLeaves 5 atlasAsh 6 grit 7 hail 8 mote
// 9 ember 10 petal 11 bubble 12 spore 13 wisp 14 star 15 meteor. PARTICLE_POP draws a hail impact ring.
// Output is premultiplied; additive materials keep alpha out of the target (blendSrcAlpha Zero).
#ifndef PARTICLE_SHAPE
#define PARTICLE_SHAPE 0
#endif

uniform sampler2D uAtlas;

varying vec2 vLocal;
varying vec4 vColor;
varying float vSeed;
varying float vSizePx;
varying float vAge;
varying float vDepth;
varying float vStretch;

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

float streakProfile(vec2 v, float headPower, float sharp) {
  float x01 = v.x * 0.5 + 0.5;
  float across = exp(-v.y * v.y * sharp);
  float tail = pow(clamp(x01, 0.0, 1.0), headPower);
  float cap = 1.0 - smoothstep(0.86, 1.0, x01);
  return across * tail * cap;
}

// Round head at the +x end plus a soft tail, for particles stretched along their motion
float crispCapsule(vec2 v, float tail, float headEdge, float bodyEdge) {
  vec2 q = vec2((v.x - (1.0 - 1.0 / vStretch)) * vStretch, v.y);
  float head = 1.0 - smoothstep(headEdge, 1.0, length(q));
  float body = (1.0 - smoothstep(bodyEdge, 1.0, abs(v.y))) * smoothstep(-1.0, 0.8, v.x) * tail;
  return max(head, body);
}

float blurCapsule(vec2 v, float tail) {
  return crispCapsule(v, tail, 0.45, 0.2);
}

float flakeShape(vec2 p) {
  float ang = atan(p.y, p.x);
  float sector = 1.04719755;
  ang = mod(ang + sector * 0.5, sector) - sector * 0.5;
  vec2 q = vec2(cos(ang), abs(sin(ang))) * length(p);
  float d = sdSegment(q, vec2(0.0), vec2(0.86, 0.0)) - 0.06;
  d = min(d, sdSegment(q, vec2(0.38, 0.0), vec2(0.62, 0.24)) - 0.04);
  d = min(d, sdSegment(q, vec2(0.62, 0.0), vec2(0.82, 0.2)) - 0.035);
  float aa = max(fwidth(d), 0.02);
  return 1.0 - smoothstep(-aa, aa, d);
}

void main() {
  vec2 v = vLocal;
  float r = length(v);
  float a = 0.0;
  vec3 tint = vColor.rgb;

  #ifdef PARTICLE_POP
  float ringR = 0.25 + 0.7 * (1.0 - pow(1.0 - vAge, 3.0));
  float ring = exp(-pow((r - ringR) * 9.0, 2.0)) * (1.0 - vAge);
  float flash = exp(-r * r * 26.0) * pow(1.0 - vAge, 4.0);
  a = (ring * 0.7 + flash) * (1.0 - smoothstep(0.85, 1.0, r));
  tint = mix(tint, vec3(1.0), flash);
  #elif PARTICLE_SHAPE == 0
  a = streakProfile(v, 1.3, 3.2);
  tint += 0.3 * smoothstep(0.65, 1.0, v.x * 0.5 + 0.5);
  #elif PARTICLE_SHAPE == 1
  vec2 p = vec2(v.x * 0.85, v.y * 1.25);
  a = 1.0 - smoothstep(0.7, 1.0, length(p));
  tint += 0.35 * exp(-length(v - vec2(0.25, 0.25)) * 5.0);
  #elif PARTICLE_SHAPE == 2
  #if STRETCHED
  a = crispCapsule(v, 0.7, 0.62, 0.42);
  a *= 1.0 + 0.5 * smoothstep(0.7, 1.0, v.x * 0.5 + 0.5);
  #else
  float defocus = vDepth * vDepth * vDepth;
  float disc = 1.0 - smoothstep(mix(0.62, 0.2, defocus), mix(0.9, 1.0, defocus), r);
  a = mix(disc, flakeShape(v), smoothstep(7.0, 14.0, vSizePx) * (1.0 - vDepth));
  a *= mix(1.0, 0.75, defocus);
  #endif
  #elif PARTICLE_SHAPE == 3 || PARTICLE_SHAPE == 4 || PARTICLE_SHAPE == 5
  float cellIndex = floor(vSeed * 9.0);
  vec2 cell = vec2(mod(cellIndex, 3.0), floor(cellIndex / 3.0));
  vec2 local = clamp(v * 0.5 + 0.5, 0.0, 1.0);
  vec4 tex = texture2D(uAtlas, (cell + 0.02 + local * 0.96) / 3.0);
  a = tex.a * (1.0 - smoothstep(0.96, 1.0, max(abs(v.x), abs(v.y))));
  #if PARTICLE_SHAPE == 4
  tint = mix(tex.rgb, tex.rgb * tint * 2.2, 0.55);
  #elif PARTICLE_SHAPE == 3
  tint = mix(tex.rgb, tint, 0.5);
  #else
  tint = tex.rgb * tint * 1.7;
  #endif
  #elif PARTICLE_SHAPE == 6
  float grain = atmoValueNoise(v * vec2(2.5, 3.0) + vSeed * 41.0);
  a = streakProfile(v, 0.9, 2.4) * (0.55 + 0.6 * grain);
  tint *= 0.8 + 0.4 * grain;
  #elif PARTICLE_SHAPE == 7
  a = blurCapsule(v, 0.3);
  tint += 0.6 * exp(-length(vec2((v.x - (1.0 - 1.0 / vStretch)) * vStretch, v.y) - vec2(-0.3, 0.35)) * 3.0);
  #elif PARTICLE_SHAPE == 8
  a = pow(1.0 - clamp(r, 0.0, 1.0), 2.4);
  #elif PARTICLE_SHAPE == 9
  float glow = pow(1.0 - clamp(r, 0.0, 1.0), 2.0) * 0.55;
  float core = 1.0 - smoothstep(0.1, 0.3, r);
  a = glow + core;
  tint = mix(tint, vec3(1.0, 0.86, 0.5), core * 0.85);
  #elif PARTICLE_SHAPE == 10
  float d = length(vec2(v.x, v.y / 0.58)) - 1.0;
  d = max(d, -(length(v - vec2(1.05, 0.0)) - 0.34));
  float aa = max(fwidth(d), 0.02);
  a = 1.0 - smoothstep(-aa, aa, d);
  tint *= 0.8 + 0.3 * (v.x * 0.5 + 0.5) - 0.18 * exp(-abs(v.y) * 14.0);
  #elif PARTICLE_SHAPE == 11
  float rim = smoothstep(0.7, 0.9, r) * (1.0 - smoothstep(0.92, 1.0, r));
  float spec = exp(-length(v - vec2(-0.38, 0.4)) * 9.0);
  a = (rim * 0.9 + 0.07 * (1.0 - smoothstep(0.9, 1.0, r)) + spec * 0.8) * (1.0 - smoothstep(0.97, 1.0, r));
  tint += spec;
  #elif PARTICLE_SHAPE == 12
  a = pow(1.0 - clamp(r, 0.0, 1.0), 2.0) * 0.7 + (1.0 - smoothstep(0.08, 0.22, r));
  tint = mix(tint, vec3(1.0), (1.0 - smoothstep(0.0, 0.2, r)) * 0.6);
  #elif PARTICLE_SHAPE == 13
  float cloud = atmoValueNoise(v * 2.2 + vSeed * 53.0);
  vec2 sv = v * vec2(0.7, 1.0);
  a = (1.0 - smoothstep(0.0, 1.0, length(sv) + (cloud - 0.5) * 0.7)) * (0.5 + cloud);
  #elif PARTICLE_SHAPE == 14
  float sx = exp(-abs(v.x) * 16.0) * (1.0 - abs(v.y));
  float sy = exp(-abs(v.y) * 16.0) * (1.0 - abs(v.x));
  a = clamp(max(sx, sy) + exp(-r * r * 40.0), 0.0, 1.0) * (1.0 - smoothstep(0.9, 1.0, r));
  tint = mix(tint, vec3(1.0), exp(-r * r * 40.0));
  #elif PARTICLE_SHAPE == 15
  float x01 = v.x * 0.5 + 0.5;
  float across = exp(-v.y * v.y * 14.0);
  a = across * exp(-(1.0 - x01) * 5.0) * (1.0 - smoothstep(0.93, 1.0, x01));
  float head = exp(-length(vec2((v.x - 0.88) * 0.35, v.y)) * 8.0);
  a = clamp(a + head, 0.0, 1.0);
  tint = mix(tint, vec3(1.0), head);
  #endif

  a = clamp(a * vColor.a, 0.0, 1.0);
  gl_FragColor = vec4(tint * a, a);
}
