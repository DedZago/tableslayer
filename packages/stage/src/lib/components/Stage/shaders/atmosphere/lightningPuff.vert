// Dust kicked up by a tremor: a burst of soft puffs flung outward from the event point. aStrike = (x, y in map
// px, atmoTime), aSeed = per-puff random. Everything is a function of uAtmoTime.
attribute vec3 aStrike;
attribute float aSeed;

uniform float uAtmoTime;
uniform float uMapHeight;

varying vec2 vLocal;
varying float vAlpha;
varying float vSeed;
varying vec3 vWorldPosition;

const float LIFE_SEC = 2.2;
const float TAU = 6.2831853;

void main() {
  float age = uAtmoTime - aStrike.z;
  if (age < -1800.0) age += 3600.0;
  if (age > 1800.0) age -= 3600.0;
  float u = clamp(age / LIFE_SEC, 0.0, 1.0);
  float h0 = fract(sin(aSeed * 91.7) * 43758.5453);
  float h1 = fract(sin(aSeed * 37.1 + 1.7) * 24634.6345);
  float h2 = fract(sin(aSeed * 13.9 + 2.9) * 35461.1232);

  float angle = h0 * TAU;
  float reach = mix(0.02, 0.075, h1) * uMapHeight;
  float spread = 1.0 - exp(-max(age, 0.0) * 2.4);
  vec2 centre = aStrike.xy + vec2(cos(angle), sin(angle)) * reach * spread + vec2(0.0, 0.012 * uMapHeight * u);
  float size = mix(0.022, 0.05, h2) * uMapHeight * (0.45 + 0.9 * sqrt(u));

  vAlpha = age < 0.0 ? 0.0 : smoothstep(0.0, 0.06, u) * pow(1.0 - u, 1.4) * mix(0.55, 0.9, h1);
  vSeed = h2;
  vLocal = position.xy * 2.0;
  vec2 local = centre + position.xy * size * 2.0;
  vWorldPosition = (modelMatrix * vec4(local, 0.0, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(local, 0.0, 1.0);
}
