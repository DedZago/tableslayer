// Atmosphere ground chunk, spliced into the map's MeshBasicMaterial fragment shader by
// components/AtmosphereLayer/ground/groundPatch.ts. Needs noise.glsl, field.glsl and groundLight.glsl
// before it. Everything is in map UV (u right, v up); noise scales with the grid cell so features look
// the same on a 10x10 and a 30x60 map. Features are ATMO_* defines; ATMO_SHELTER is a reserved hook.

uniform float uAtmoTime;
uniform float uGroundCell; // grid cell height as a fraction of the map height
uniform float uGroundQuad; // 1 while AtmosphereDarkness is mounted and ready
uniform float uWetStrength;
uniform float uPuddleMax;
uniform float uRippleStrength;
uniform float uSnowStrength;
uniform float uCloudCoverage;
uniform float uCloudDarkness;
uniform float uCloudScale;
uniform vec2 uCloudDrift; // noise units per second along the wind, applied as -drift * uAtmoTime
uniform float uHazeStrength;
uniform vec3 uHazeColor;
uniform float uCaustics;
uniform vec3 uTintColor;
uniform float uTintStrength;
uniform float uShaftStrength;
uniform vec3 uShaftColor;
uniform float uSunAngle;
uniform vec3 uWetTint;
uniform float uWetTintStrength;
uniform vec3 uSnowColor;
uniform float uGradeSat;
uniform float uGradeContrast;
uniform vec3 uSpeckleColor;
uniform float uSpeckleStrength;
uniform float uSpeckleGlow;
uniform vec3 uPoolColor;
uniform vec3 uPoolColorB;
uniform float uPoolStrength;
uniform float uPoolScale;
uniform float uAuroraStrength;
uniform float uAuroraHue;
uniform vec4 uTremors[3]; // xy map UV, z seconds since it began (< 0 unused), w intensity

const vec3 ATMO_LUMA = vec3(0.2126, 0.7152, 0.0722);

// One octave of value noise shows lattice edges once the contrast is stretched, so the 1-octave tier blends
// two rotated taps instead
float atmoGroundNoise(vec2 p) {
#if ATMO_OCTAVES == 1
  return atmoValueNoise(p) * 0.65 + atmoValueNoise(mat2(0.8, -0.6, 0.6, 0.8) * p * 2.1 + 7.7) * 0.35;
#else
  return atmoFbm(p);
#endif
}

#ifdef ATMO_SHELTER
float atmoShelter(vec2 uv);
#else
#define atmoShelter(uv) 1.0
#endif

#ifdef ATMO_RIPPLES
// x: ring height, yz: height gradient in ripple-cell space. One droplet ring per hashed cell.
vec3 atmoRippleCell(vec2 cellId, vec2 f, float rate) {
  vec2 h = atmoHash22(cellId);
  vec2 h2 = atmoHash22(cellId + 17.3);
  if (h2.x > rate) return vec3(0.0);
  float period = mix(0.9, 2.2, h2.y);
  float cycle = uAtmoTime / (period * 1.7) + h.x * 13.0;
  float t = fract(cycle) * 1.7;
  if (t > 1.0) return vec3(0.0);
  vec2 center = mix(vec2(0.12), vec2(0.88), h);
  vec2 delta = f - center;
  float dist = length(delta);
  float reach = mix(0.3, 0.55, h2.y);
  float radius = t * reach;
  float width = 0.055 + t * 0.03;
  float u = (dist - radius) / width;
  float envelope = exp(-u * u);
  float amplitude = (1.0 - t) * (1.0 - t);
  float height = envelope * cos(u * 2.2) * amplitude;
  float slope = envelope * (-2.0 * u * cos(u * 2.2) - 2.2 * sin(u * 2.2)) * amplitude / width;
  vec2 dir = delta / max(dist, 0.0001);
  return vec3(height, dir * slope * 0.05);
}

vec3 atmoRipples(vec2 cellP, float rate) {
  vec2 base = floor(cellP);
  vec2 f = cellP - base;
  vec3 sum = vec3(0.0);
#if ATMO_RIPPLE_TAPS == 3
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 offset = vec2(float(i), float(j));
      sum += atmoRippleCell(base + offset, f - offset, rate);
    }
  }
#elif ATMO_RIPPLE_TAPS == 2
  vec2 start = floor(f + 0.5) - 1.0;
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      vec2 offset = start + vec2(float(i), float(j));
      sum += atmoRippleCell(base + offset, f - offset, rate);
    }
  }
#else
  sum = atmoRippleCell(base, f, rate);
#endif
  return sum;
}
#endif

#ifdef ATMO_CAUSTICS
float atmoCaustic(vec2 uv, float t) {
  const float TAU = 6.28318530718;
  vec2 p = mod(uv * TAU, TAU) - 250.0;
  vec2 i = p;
  float c = 1.0;
  const float inten = 0.005;
#if ATMO_RIPPLE_TAPS == 1
  const int steps = 3;
#else
  const int steps = 4;
#endif
  for (int n = 0; n < steps; n++) {
    float tt = t * (1.0 - 3.5 / float(n + 1));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= float(steps);
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}
#endif

#ifdef ATMO_TREMOR
// x: signed ring height (-1..1) summed over the active tremors, yz: unit direction away from the strongest
vec3 atmoTremor(vec2 uv) {
  vec2 aspect = atmoAspect();
  float height = 0.0;
  vec2 push = vec2(0.0);
  for (int i = 0; i < 3; i++) {
    vec4 tr = uTremors[i];
    if (tr.z < 0.0) continue;
    vec2 d = (uv - tr.xy) * aspect;
    float dist = length(d);
    float radius = 0.02 + tr.z * 0.11;
    float u = (dist - radius) / (0.035 + tr.z * 0.012);
    float env = exp(-u * u) * exp(-tr.z * 0.45) * tr.w * smoothstep(0.0, 0.25, tr.z);
    float h = env * cos(u * 3.2);
    height += h;
    push += d / max(dist, 0.0001) / aspect * h;
  }
  return vec3(height, push);
}
#endif

// Sub-pixel offset in map UV applied before the map fetch: haze shimmer and caustic wobble (0.5 to 2 px)
vec2 atmoDistortion(vec2 uv, vec2 pixel, vec2 q) {
  vec2 offset = vec2(0.0);
#ifdef ATMO_HAZE
  {
    vec2 p = q / (uGroundCell * 2.2);
    float t = uAtmoTime;
    vec2 wob = vec2(atmoValueNoise(p + vec2(0.0, t * 0.9)), atmoValueNoise(p * 1.1 + vec2(11.7, t * 0.75))) - 0.5;
    offset += wob * (2.6 * uHazeStrength) * pixel;
  }
#endif
#ifdef ATMO_CAUSTICS
  {
    vec2 p = q / (uGroundCell * 3.0);
    float t = uAtmoTime * 0.6;
    vec2 wob = vec2(sin(p.y * 5.0 + t * 1.7), cos(p.x * 4.3 - t * 1.3));
    offset += wob * (0.9 * uCaustics) * pixel;
  }
#endif
#ifdef ATMO_TREMOR
  offset += atmoTremor(uv).yz * pixel * 30.0;
#endif
  return offset;
}

// Applies every enabled ground feature to the sampled map colour. `uv` is the undistorted map UV.
vec3 atmoGround(vec3 color, vec2 uv, vec2 q, float lumaX, float lumaY, float luma, vec4 accum, vec3 ripple, float flash) {
  float shelter = atmoShelter(uv);
  vec3 sky = mix(vec3(0.62, 0.7, 0.8), uAmbientTint, uDarkness * 0.7);
  sky = max(sky * uAmbientExposure, uFlashColor * flash) ;

#if defined(ATMO_WET) || defined(ATMO_SNOW)
  vec2 gradient = vec2(lumaX - luma, lumaY - luma);
  float edgeness = clamp(length(gradient) * 12.0, 0.0, 1.0);
#endif

#ifdef ATMO_WET
  float wet = accum.r * uWetStrength * shelter;
  float puddleFill = clamp(accum.g * uPuddleMax * 1.2 * shelter, 0.0, 1.0);
  float noiseLow = atmoGroundNoise(q / (uGroundCell * 5.0) + vec2(3.1, 8.7));
  float puddleBias = (0.5 - luma) * 0.35 + (0.5 - edgeness) * 0.12;
  float field = (noiseLow - 0.5) * 3.0 + puddleBias;
  float threshold = mix(0.95, 0.2, puddleFill);
  float puddle = smoothstep(threshold - 0.07, threshold + 0.07, field) * step(0.001, puddleFill);
  float puddleRim = smoothstep(threshold - 0.16, threshold, field) * (1.0 - smoothstep(threshold, threshold + 0.14, field));

  vec3 wetColor = color * mix(1.0, mix(0.78, 0.66, wet), clamp(1.0 - luma * 0.45, 0.0, 1.0));
  wetColor = mix(vec3(dot(wetColor, ATMO_LUMA)), wetColor, 1.0 + 0.1 * wet);
  color = mix(color, wetColor, clamp(wet * 1.4, 0.0, 1.0));

  vec3 wetTintMul = mix(vec3(1.0), uWetTint, uWetTintStrength);
  color *= mix(vec3(1.0), wetTintMul, clamp(wet * 1.4, 0.0, 1.0));
  sky *= mix(vec3(1.0), uWetTint * 1.6, uWetTintStrength);

  vec3 normal = normalize(vec3(-gradient * 3.5, 1.0));
  vec3 halfway = normalize(vec3(-0.25, 0.35, 0.9) + vec3(0.0, 0.0, 1.0));
  float broadSpec = pow(max(dot(normal, halfway), 0.0), 18.0);
  color += sky * broadSpec * wet * 0.1;

  color *= 1.0 - puddleRim * 0.22 * wet;
  vec3 puddleColor = color * 0.55 * mix(vec3(1.0), uWetTint * 1.4, uWetTintStrength * 0.8);
  float reflectAmount = puddle * (0.34 + 0.2 * (1.0 - luma));
  puddleColor = mix(puddleColor, sky * 0.5, reflectAmount);
  color = mix(color, puddleColor, puddle);
#else
  float puddle = 0.0;
#endif

#ifdef ATMO_RIPPLES
  {
    vec2 cellP = q / (uGroundCell * 0.4);
    float cellPixels = 1.0 / max(length(fwidth(cellP)), 0.0001);
    float lod = smoothstep(2.0, 7.0, cellPixels);
    float strength = uRippleStrength * lod * shelter;
    vec3 r = ripple;
    float onPuddle = max(puddle, 0.25);
    float spec = max(r.x, 0.0) * 0.5 + abs(r.y + r.z) * 3.0;
    color += sky * spec * strength * onPuddle * 0.3;
    color *= 1.0 - max(-r.x, 0.0) * 0.12 * strength * onPuddle;
  }
#endif

#ifdef ATMO_SNOW
  {
    float noiseSnow = atmoGroundNoise(q / (uGroundCell * 2.5) + vec2(21.0, 4.0));
    float x = accum.b * uSnowStrength * 0.78 * shelter + (noiseSnow - 0.5) * 0.7 - edgeness * 0.55 - smoothstep(0.35, 0.0, luma) * 0.35;
    float cover = smoothstep(0.35, 0.62, x);
    float shade = 0.8 + (luma - 0.5) * 0.45;
    vec3 snow = uSnowColor * shade;
    snow = mix(snow, uSnowColor * vec3(0.72, 0.82, 1.0), clamp((0.6 - luma) * 0.9, 0.0, 0.55));
    snow *= 0.9 + 0.2 * noiseSnow;
    color = mix(color, snow, cover * 0.92);
  }
#endif

  float scorch = accum.a;
  if (scorch > 0.003) {
    float glow = scorch * scorch * scorch;
    color = mix(color, color * vec3(0.18, 0.15, 0.13), scorch * 0.85);
    color += vec3(1.0, 0.4, 0.08) * glow * 0.35;
  }

#ifdef ATMO_CLOUDS
  {
    float size = clamp(uGroundCell * uCloudScale * 0.55, 0.1, 0.32);
    float n = atmoGroundNoise(q / size - uCloudDrift * uAtmoTime);
    float threshold = mix(0.68, 0.4, uCloudCoverage);
    float cloud = smoothstep(threshold - 0.1, threshold + 0.1, n);
    color *= mix(vec3(1.0), vec3(0.86, 0.9, 1.0) * (1.0 - uCloudDarkness), cloud);
  }
#endif

#ifdef ATMO_CAUSTICS
  {
    float c = atmoCaustic(q / (uGroundCell * 3.0), uAtmoTime * 0.5);
    float c2 = atmoCaustic(q / (uGroundCell * 5.1) + 0.37, uAtmoTime * 0.35 + 3.0);
    color += vec3(0.28, 0.9, 0.85) * (c * 0.7 + c2 * 0.5) * uCaustics * 0.4 * (1.0 - clamp(luma, 0.0, 1.0) * 0.5);
  }
#endif

#ifdef ATMO_HAZE
  {
    float glint = atmoValueNoise(q / (uGroundCell * 1.6) + vec2(0.0, uAtmoTime * 1.4));
    color *= 1.0 + (glint - 0.5) * 0.07 * uHazeStrength;
    color = mix(color, color * uHazeColor * 1.12, 0.3 * uHazeStrength);
  }
#endif

#ifdef ATMO_SPECKLE
  {
    vec2 cellP = q / (uGroundCell * 0.22);
    vec2 id = floor(cellP);
    vec2 f = fract(cellP);
    vec3 h = vec3(atmoHash21(id), atmoHash21(id + 31.7), atmoHash21(id + 83.1));
    vec2 center = mix(vec2(0.25), vec2(0.75), h.xy);
    float present = step(1.0 - uSpeckleStrength * 0.42, h.z);
    float blob = (1.0 - smoothstep(0.1, 0.24 + 0.1 * h.x, length(f - center))) * present;
    float cellPixels = 1.0 / max(length(fwidth(cellP)), 0.0001);
    blob *= smoothstep(1.5, 4.0, cellPixels);
    color = mix(color, color * 0.35 + uSpeckleColor * 0.1, blob * 0.8);
    float ember = 0.5 + 0.5 * sin(uAtmoTime * (0.8 + 2.4 * h.y) + h.x * 40.0);
    color += uSpeckleColor * blob * uSpeckleGlow * (0.3 + 0.9 * ember * ember);
  }
#endif

#ifdef ATMO_TREMOR
  color *= 1.0 - atmoTremor(uv).x * 0.5;
#endif

#ifdef ATMO_TINT
  color *= mix(vec3(1.0), uTintColor, uTintStrength);
#endif

#ifdef ATMO_GRADE
  {
    float gl = dot(color, ATMO_LUMA);
    color = mix(vec3(gl), color, uGradeSat);
    color = max(mix(vec3(0.18), color, uGradeContrast), vec3(0.0));
  }
#endif

  return color;
}

vec3 atmoHueColor(float hue) {
  return clamp(abs(mod(hue / 60.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
}

// Coloured light the aurora, glow pools and any other additive source add on top of the base lighting
vec3 atmoExtraLight(vec2 uv, vec2 q) {
  vec3 light = vec3(0.0);
#ifdef ATMO_AURORA
  {
    float t = uAtmoTime;
    vec2 p = vec2(uv.x * 2.4 + t * 0.035, uv.y * 1.1 + 0.35 * sin(uv.x * 3.1 + t * 0.12));
    float curtain = smoothstep(0.28, 0.78, atmoValueNoise(p + vec2(3.7, 1.9)));
    float mixer = atmoValueNoise(vec2(uv.x * 1.3 - t * 0.02, uv.y * 0.9 + 5.0));
    vec3 aurora = mix(atmoHueColor(uAuroraHue), atmoHueColor(uAuroraHue + 120.0), mixer);
    light += aurora * curtain * uAuroraStrength * 0.55;
  }
#endif
#ifdef ATMO_POOLS
  {
    float t = uAtmoTime;
    vec2 p = q * uPoolScale;
    float n = atmoValueNoise(p + vec2(t * 0.05, -t * 0.04) + vec2(13.0, 2.0));
    float pool = smoothstep(0.42, 0.78, n);
    vec3 c = mix(uPoolColor, uPoolColorB, atmoValueNoise(p * 0.6 + vec2(9.0, -t * 0.03)));
    float breathe = 0.82 + 0.18 * sin(t * 0.7 + n * 7.0);
    light += c * pool * breathe * uPoolStrength * 1.2;
  }
#endif
  return light;
}

#ifdef ATMO_LIGHTING
// Light shafts as pools of sun on the ground: dappled warm patches stretched along the sun direction with
// soft shade between. rgb is light added to the base lighting, a multiplies the base (the shade).
vec4 atmoSunPools(vec2 q) {
  if (uShaftStrength <= 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
  float a = radians(uSunAngle);
  vec2 dir = vec2(cos(a), sin(a));
  vec2 perp = vec2(-dir.y, dir.x);
  vec2 p = vec2(dot(q, dir), dot(q, perp)) / (uGroundCell * 3.2);
  float drift = uAtmoTime * 0.02;
  float n = atmoGroundNoise(vec2(p.x * 0.5 + drift, p.y * 1.35) + vec2(4.3, 1.7));
  float core = smoothstep(0.46, 0.58, n);
  float halo = smoothstep(0.3, 0.55, n);
  vec3 light = uShaftColor * (core * 0.85 + halo * 0.25) * uShaftStrength;
  float shade = 1.0 - 0.28 * min(uShaftStrength, 1.0) * (1.0 - halo);
  return vec4(light, shade);
}
#endif
