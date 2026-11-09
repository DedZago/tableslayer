// AmbienceGround fragment body. Needs noise.glsl and field.glsl before it and the defines
// AMBIENCE_FOG / AMBIENCE_DENSITY / DENSITY_MODE. Flow-map advected fbm: the field velocity pushes two
// half-period shifted copies of the noise along the wind and cross-fades them (Vlachos).
#define AMBIENCE_CYCLE 9.0

uniform float uAtmoTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform vec2 uMapSize;
uniform float uGroundCell;
uniform vec3 uFogColor;
uniform vec3 uFogColorB;
uniform float uFogDensity;
uniform float uFogPockets;
uniform float uFogEdge;
uniform vec3 uShadowColor;
uniform float uShadowStrength;
uniform float uPulse;
uniform vec4 uTremors[3]; // xy map UV, z seconds since it began (< 0 unused), w intensity
uniform vec3 uDensityColorA;
uniform vec3 uDensityColorB;
uniform float uDensityScale;
uniform float uDensityCoverage;
uniform float uDensityUnder;
uniform float uDensitySpeed;

varying vec2 vUv;

vec2 ambienceVelocity(vec2 uv) {
  return atmoWind(uv) + uWindDir * (uWindStrength * 0.03);
}

// Premultiplied src-over: layer `top` over `bottom`
vec4 ambienceOver(vec4 top, vec4 bottom) {
  return top + bottom * (1.0 - top.a);
}

void main() {
  vec2 aspect = vec2(uMapSize.x / max(uMapSize.y, 1.0), 1.0);
  vec2 uv = vUv;
  vec2 velocity = ambienceVelocity(uv);
  float time = uAtmoTime / AMBIENCE_CYCLE;
  vec4 result = vec4(0.0);

#ifdef AMBIENCE_DENSITY
  {
    float frequency = uDensityScale;
    vec2 p = uv * aspect * frequency;
    vec2 flow = velocity * aspect * frequency * (AMBIENCE_CYCLE * uDensitySpeed);
    float n = atmoFlowFbm(p, flow, time * uDensitySpeed);
    float field = atmoDensity(uv);
    float shaped = smoothstep(0.3, 0.7, n);
#if DENSITY_MODE == 3
    float body = shaped * 0.78 + field * 0.5;
#elif DENSITY_MODE == 1
    float body = shaped * 0.55 + field * 0.7;
#else
    float body = shaped * 0.7 + field * 0.4;
#endif
    float threshold = 0.78 - uDensityCoverage * 0.75;
    float a = smoothstep(threshold, threshold + 0.4, body) * uDensityUnder;
    a = a * (0.5 + 0.5 * shaped);
    vec3 color = mix(uDensityColorA, uDensityColorB, smoothstep(0.25, 0.8, n));
#ifdef DENSITY_NEBULA
    float n2 = atmoFbm(p * 0.7 + vec2(7.0, 3.0) - velocity * aspect * uAtmoTime * 2.0);
    color = mix(color, color.zxy * 1.15, smoothstep(0.3, 0.95, n2));
    a *= 0.7 + 0.4 * n2;
    vec4 layer = vec4(color * a * 0.9, a * 0.25);
#else
    vec4 layer = vec4(color * a, a);
#endif
#if DENSITY_MODE == 3
    float ember = field * field * smoothstep(0.35, 0.8, atmoValueNoise(p * 2.3 + vec2(0.0, uAtmoTime * 1.6)));
    layer.rgb += vec3(1.0, 0.42, 0.1) * ember * 0.9 * uDensityUnder;
#endif
    result = ambienceOver(layer, result);
  }
#endif

#ifdef AMBIENCE_FOG
  {
    float size = clamp(uGroundCell * 7.0, 0.12, 0.4);
    vec2 p = uv * aspect / size;
    vec2 flow = velocity * aspect / size * AMBIENCE_CYCLE * 1.5;
    float n = atmoFlowFbm(p, flow, time * 1.5);
    float bank = atmoValueNoise(p * 0.32 + vec2(3.0, 1.0) + uWindDir * uAtmoTime * 0.004);
    float body = smoothstep(0.34, 0.66, n) * 0.55 + smoothstep(0.3, 0.7, bank) * 0.6 + atmoDensity(uv) * 0.2;
    float a = smoothstep(0.35, 0.95, body) * uFogDensity;
    float pocket = smoothstep(0.38, 0.72, atmoValueNoise(p * 0.55 + vec2(11.0, 4.0) + uWindDir * uAtmoTime * 0.006));
    a *= mix(1.0, 0.12 + 1.25 * pocket, uFogPockets);
    float rim = length((uv - 0.5) * 1.3) + 0.14 * (atmoValueNoise(p * 0.35 + vec2(2.0, uAtmoTime * 0.02)) - 0.5);
    float creep = smoothstep(0.3, 0.62, rim) * (0.55 + 0.7 * n) * uFogDensity;
    a = clamp(mix(a, a * 0.2 + creep, uFogEdge), 0.0, 1.0);
    vec3 color = mix(uFogColor, uFogColorB, smoothstep(0.3, 0.7, n)) * (0.92 + 0.16 * n);
    result = ambienceOver(vec4(color * a, a), result);
  }
#endif

#ifdef AMBIENCE_TENTACLES
  {
    const float TAU = 6.28318530718;
    float t = uAtmoTime;
    float twitch = 1.0 + 1.6 * uPulse;
    vec2 p = uv * aspect;
    vec2 mid = aspect * 0.5;
    float reach = length(mid) * 1.02;
    float shadow = 0.0;
    float spots = 0.0;
    for (int i = 0; i < 4; i++) {
      float h = atmoHash11(float(i) * 7.13 + 3.0);
      float angle = (float(i) + h * 0.7) * TAU * 0.25 + t * 0.006;
      vec2 outward = vec2(cos(angle), sin(angle));
      vec2 base = mid + outward * reach;
      float tilt = (h - 0.5) * 0.9 + 0.35 * sin(t * 0.05 + h * 9.0);
      vec2 dir = -vec2(cos(angle + tilt), sin(angle + tilt));
      vec2 side = vec2(-dir.y, dir.x);
      float length_ = 1.15 + 0.4 * h;
      vec2 v = p - base;
      float s = dot(v, dir);
      float w = dot(v, side);
      float tt = s / length_;
      if (tt < -0.05 || tt > 1.05) continue;
      float phase = t * 0.16 * (1.0 + 1.5 * uPulse) + h * 30.0;
      float amp = (0.05 + 0.09 * tt) * twitch;
      float spine = amp * sin(tt * 6.5 - phase) + 0.45 * amp * sin(tt * 13.0 + phase * 1.7) + 0.12 * tt * tt * tt * sin(phase * 0.8 + tt * 4.0);
      float slope = amp * 6.5 / length_ * cos(tt * 6.5 - phase) + 0.45 * amp * 13.0 / length_ * cos(tt * 13.0 + phase * 1.7);
      float taper = pow(clamp(1.0 - tt, 0.0, 1.0), 0.8);
      float radius = (0.012 + 0.07 * taper) * (1.0 + 0.07 * sin(s * 80.0));
      float dist = abs(w - spine) / sqrt(1.0 + slope * slope);
      float sdf = dist - radius;
      float body = 1.0 - smoothstep(-0.004, 0.012 + 0.018 * taper, sdf);
      shadow = max(shadow, body * smoothstep(1.05, 0.9, tt));
      vec2 cell = vec2(fract(s * 20.0) - 0.5, (w - spine) / max(radius, 0.001));
      spots = max(spots, body * (1.0 - smoothstep(0.1, 0.22, length(vec2(cell.x * 0.9, cell.y * 0.9 - 0.5 * sign(cell.y)))) ) * step(radius, 0.1) * taper);
    }
    float a = clamp(shadow * (1.0 - 0.22 * spots), 0.0, 1.0) * uShadowStrength;
    result = ambienceOver(vec4(uShadowColor * a, a), result);
  }
#endif

#ifdef AMBIENCE_TREMOR
  {
    float dust = 0.0;
    for (int i = 0; i < 3; i++) {
      vec4 tr = uTremors[i];
      if (tr.z < 0.0 || tr.z > 6.0) continue;
      float d = length((uv - tr.xy) * aspect);
      float radius = 0.05 + tr.z * 0.06;
      float n = atmoValueNoise(uv * aspect * 16.0 + float(i) * 7.0 + tr.z * 0.5);
      float disc = 1.0 - smoothstep(radius * 0.25, radius * (1.0 + 0.6 * (n - 0.5)), d);
      dust += disc * smoothstep(0.0, 0.3, tr.z) * exp(-tr.z * 0.45) * tr.w;
    }
    float a = clamp(dust, 0.0, 1.0) * 0.85;
    result = ambienceOver(vec4(vec3(0.78, 0.62, 0.42) * a, a), result);
  }
#endif

  gl_FragColor = vec4(result.rgb / max(result.a, 0.0001), 1.0);
  #include <colorspace_fragment>
  gl_FragColor = vec4(gl_FragColor.rgb * result.a, result.a);
}
