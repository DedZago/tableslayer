// Sparse wind ribbons: each instance traces a centreline along the wind field from a seeded start and fades
// at both ends. position.x is the position along the strip (0..1), position.y the side (-1 or 1).
#define WIND_LINE_SEGMENTS 20

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
uniform float uStretch;
uniform float uAlpha;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uAmbientTint;
uniform float uAmbientExposure;
uniform float uDarkness;
uniform float uFlash;
uniform vec3 uFlashColor;

varying float vSide;
varying float vAlpha;
varying vec3 vTint;

const float TAU = 6.2831853;

vec2 windAt(vec2 p, vec2 aspect) {
  vec2 uv = clamp(p / aspect, 0.0, 1.0);
  vec2 field = atmoWind(uv) * aspect;
  vec2 analytic = uWindDir * uWindStrength * 0.25 * aspect;
  vec2 w = mix(analytic, field, uFieldMix);
  return length(w) > 1e-4 ? normalize(w) : normalize(uWindDir * aspect);
}

void main() {
  float s = aSeed;
  float h0 = atmoHash11(s * 91.7 + 0.13);
  float h1 = atmoHash11(s * 37.1 + 1.71);
  float h2 = atmoHash11(s * 13.9 + 2.93);
  float h3 = atmoHash11(s * 71.3 + 5.11);
  float cycles;
  float life = atmoWholeLife(mix(uLife.x, uLife.y, h0) * 2.4, cycles);
  float t = uAtmoTime + h1 * life;
  float cycleRaw = floor(t / life);
  float cycle = mod(cycleRaw, cycles);
  float u = (t - cycleRaw * life) / life;
  vec2 r = atmoHash22(vec2(s * 113.0 + 0.5, cycle * 0.731 + 1.0));

  vec2 aspect = vec2(uAspect, 1.0);
  float stepLen = (0.012 + 0.03 * uWindStrength) * uStretch / 120.0 * mix(0.45, 0.85, h3);
  float along = position.x * float(WIND_LINE_SEGMENTS);

  vec2 p = r * aspect;
  vec2 tangent = windAt(p, aspect);
  for (int i = 0; i < WIND_LINE_SEGMENTS; i++) {
    if (float(i) >= along) break;
    tangent = windAt(p, aspect);
    p += tangent * stepLen;
  }
  vec2 normal = vec2(-tangent.y, tangent.x);

  float swirl = 0.03 * sin(position.x * 5.0 + h2 * TAU + uAtmoTime * atmoOmega(0.127)) * sin(position.x * 3.14159);
  p += normal * swirl;

  float taper = pow(sin(position.x * 3.14159), 0.8);
  float w = mix(uSize.x, uSize.y, h3);
  float cover = clamp(w * uRtHeight / 1.4, 0.0, 1.0);
  w = max(w, 1.4 / uRtHeight);
  p += normal * position.y * w * 1.1 * taper;

  float head = clamp(u * 1.7, 0.0, 1.0);
  float tail = clamp(u * 1.7 - 0.55, 0.0, 1.0);
  float window = smoothstep(tail, tail + 0.2, position.x) * (1.0 - smoothstep(head - 0.2, head, position.x));
  float envelope = smoothstep(0.0, 0.12, u) * (1.0 - smoothstep(0.88, 1.0, u));
  vAlpha = uAlpha * taper * window * envelope * cover * mix(0.45, 1.0, smoothstep(tail, head, position.x));
  vSide = position.y;

  vec3 lit = max(mix(vec3(1.0), uAmbientTint, uDarkness * 0.45) * mix(1.0, uAmbientExposure, 0.8) * (1.0 - 0.5 * uDarkness), 0.3);
  vTint = mix(uColorA, uColorB, h2) * lit + uFlash * uFlashColor * 0.55;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 0.0, 1.0);
}
