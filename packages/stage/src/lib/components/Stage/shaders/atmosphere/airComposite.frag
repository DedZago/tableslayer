// Composites the air target (particles, wind lines) over the density target onto the map-sized quad, then
// adds the lighting effects that live in map space: god-ray shafts with dust sparkle (AIR_SHAFTS), aurora
// curtains (AIR_AURORA) and a coloured rim vignette (AIR_RIM). Premultiplied; occlusion is capped so tokens
// stay readable. Clipping mirrors the SpellCast layers. All animation derives from uAtmoTime through
// atmoOmega, so it is seamless across the hourly wrap.
uniform sampler2D uAir;
uniform sampler2D uDensity;
uniform float uMaxOcclusion;
uniform vec4 uClippingPlanes[NUM_CLIPPING_PLANES];
uniform float uAtmoTime;
uniform float uAspect;
uniform vec2 uSunDir;
uniform vec3 uShaftColor;
uniform float uShaftStrength;
uniform float uShaftCount;
uniform float uAuroraStrength;
uniform float uAuroraHue;
uniform vec3 uRimColor;
uniform float uRimStrength;

varying vec2 vUv;
varying vec3 vWorldPosition;

const float TAU = 6.2831853;

#ifdef AIR_SHAFTS
vec4 airShafts(vec2 uv) {
  vec2 p = uv * vec2(uAspect, 1.0);
  vec2 d = uSunDir;
  vec2 n = vec2(-d.y, d.x);
  float across = dot(p, n);
  float along = dot(p, d);
  float a0 = 0.0;
  float a1 = uAspect * n.x;
  float a2 = n.y;
  float a3 = a1 + a2;
  float lo = min(min(a0, a1), min(a2, a3));
  float hi = max(max(a0, a1), max(a2, a3));
  float l1 = uAspect * d.x;
  float l2 = d.y;
  float alongLo = min(min(0.0, l1), min(l2, l1 + l2));
  float alongHi = max(max(0.0, l1), max(l2, l1 + l2));
  float travel = smoothstep(alongLo, alongHi, along);

  float t = uAtmoTime;
  float acc = 0.0;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= uShaftCount) break;
    float fi = float(i);
    float h = atmoHash11(fi * 7.31 + 1.7);
    float h2 = atmoHash11(fi * 3.17 + 9.1);
    float centre = mix(lo, hi, 0.06 + 0.88 * h) + 0.025 * sin(t * atmoOmega(0.02 + 0.015 * h2) + h * TAU);
    float width = mix(0.035, 0.1, h2) * (1.0 + 0.25 * sin(t * atmoOmega(0.04) + h2 * TAU));
    float x = (across - centre) / width;
    float band = exp(-x * x);
    float patchy = smoothstep(0.1, 0.55, atmoValueNoise(vec2(along * 1.7 + fi * 4.7, fi * 2.3 + 0.7 * sin(t * atmoOmega(0.03) + h * TAU))));
    float breath = 0.75 + 0.25 * sin(t * atmoOmega(0.05) + h * TAU);
    acc += band * patchy * breath * mix(1.0, 0.45, travel);
  }

  vec2 g = p * 85.0;
  vec2 cell = floor(g);
  vec2 f = fract(g) - 0.5;
  float hc = atmoHash21(cell);
  vec2 off = 0.3 * vec2(sin(t * atmoOmega(0.21) + hc * TAU), cos(t * atmoOmega(0.17) + hc * 19.0));
  float mote = (1.0 - smoothstep(0.0, 0.11, length(f - off))) * step(0.8, hc);
  mote *= 0.5 + 0.5 * sin(t * atmoOmega(0.5 + hc) + hc * 40.0);
  float sparkle = mote * smoothstep(0.08, 0.5, acc);

  float s = min(acc, 1.6) * 0.95 * uShaftStrength;
  return vec4(uShaftColor * (s + sparkle * uShaftStrength * 1.6), s * 0.22);
}
#endif

#ifdef AIR_AURORA
vec4 airAurora(vec2 uv) {
  vec2 p = uv * vec2(uAspect, 1.0);
  float t = uAtmoTime;
  vec3 rgb = vec3(0.0);
  float sum = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float yc = 0.22 + 0.27 * fi
      + 0.09 * sin(p.x * 2.3 + fi * 2.1 + t * atmoOmega(0.035 + 0.01 * fi))
      + 0.04 * sin(p.x * 5.3 - fi * 3.7 - t * atmoOmega(0.06));
    float w = 0.085 + 0.035 * sin(p.x * 1.7 + fi * 3.0 + t * atmoOmega(0.02));
    float d = (uv.y - yc) / w;
    float body = smoothstep(-1.0, 0.0, d) * exp(-max(d, 0.0) * 1.5);
    float rays = 0.5 + 0.5 * atmoValueNoise(vec2(p.x * 30.0 + fi * 9.0, fi * 3.1 + 0.8 * sin(t * atmoOmega(0.07) + fi)));
    float strength = body * rays * (0.65 + 0.35 * sin(t * atmoOmega(0.045) + fi * 2.0 + p.x * 3.0));
    vec3 tone = atmoHueToRgb(uAuroraHue + (fi - 1.0) * 28.0 + 60.0 * smoothstep(0.0, 2.5, max(d, 0.0)));
    rgb += tone * strength;
    sum += strength;
  }
  return vec4(rgb * uAuroraStrength * 0.8, min(sum, 1.0) * uAuroraStrength * 0.14);
}
#endif

#ifdef AIR_RIM
vec4 airRim(vec2 uv) {
  float edge = length((uv - 0.5) * 2.0);
  float rim = pow(smoothstep(0.25, 1.15, edge), 1.3);
  float pulse = 0.88 + 0.12 * sin(uAtmoTime * atmoOmega(0.02));
  float s = min(rim * uRimStrength * pulse * 1.7, 1.0);
  return vec4(uRimColor * s * 1.1, s * 0.8);
}
#endif

void main() {
  for (int i = 0; i < NUM_CLIPPING_PLANES; i++) {
    vec4 plane = uClippingPlanes[i];
    if (dot(-vWorldPosition, plane.xyz) > plane.w) {
      discard;
    }
  }

  vec4 air = texture2D(uAir, vUv);
  vec4 density = texture2D(uDensity, vUv);
  vec4 color = air + density * (1.0 - air.a);
  if (color.a > uMaxOcclusion) color *= uMaxOcclusion / color.a;

  #ifdef AIR_AURORA
  vec4 aurora = airAurora(vUv);
  color = aurora + color * (1.0 - aurora.a);
  #endif
  #ifdef AIR_SHAFTS
  vec4 shafts = airShafts(vUv);
  color = shafts + color * (1.0 - shafts.a);
  #endif
  #ifdef AIR_RIM
  vec4 rim = airRim(vUv);
  color = rim + color * (1.0 - rim.a);
  #endif
  gl_FragColor = color;
}
