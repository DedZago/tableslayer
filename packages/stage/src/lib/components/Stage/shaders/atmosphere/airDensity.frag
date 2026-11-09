// Airborne density (sandstorm walls, whiteout, wisps, smoke): flow-map advected noise shaped by the field's
// density channel (the sim shapes fronts, fog and plumes; without a field the coverage stands in).
// Drawn at reduced resolution into the density target, premultiplied. Defines: ATMO_OCTAVES.
uniform float uAspect;
uniform float uAtmoTime;
uniform float uScale;
uniform float uCoverage;
uniform float uSpeed;
uniform float uShare;
uniform float uMaxOcclusion;
uniform float uFieldMix;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uAmbientTint;
uniform float uAmbientExposure;
uniform float uDarkness;
uniform float uFlash;
uniform vec3 uFlashColor;

varying vec2 vUv;

const float CYCLE_SEC = 3600.0 / 257.0;
const float WIND_GAIN = 1.6;

void main() {
  vec2 aspect = vec2(uAspect, 1.0);
  vec2 windUv = mix(uWindDir * uWindStrength * 0.25, atmoWind(vUv), uFieldMix);
  vec2 flow = windUv * aspect * uSpeed * WIND_GAIN * CYCLE_SEC * uScale;
  float time = uAtmoTime / CYCLE_SEC;
  vec2 p = vUv * aspect * uScale;

  float broad = atmoFlowFbm(p * 0.45 + 7.3, flow * 0.45, time);
  float fine = atmoFlowFbm(p + 1.7, flow, time * 1.0 + 0.37);
  float shape = mix(0.35, 1.5, smoothstep(0.2, 0.85, fine)) * mix(0.5, 1.2, broad);

  float field = atmoDensity(vUv);
  float base = mix(uCoverage * (0.35 + 0.65 * broad), field, uFieldMix);

  float a = min(base * shape * uShare, uMaxOcclusion);
  vec3 lit = max(mix(vec3(1.0), uAmbientTint, uDarkness * 0.45) * mix(1.0, uAmbientExposure, 0.8) * (1.0 - 0.5 * uDarkness), 0.3);
  vec3 color = mix(uColorA, uColorB, smoothstep(0.3, 0.9, fine)) * lit + uFlash * uFlashColor * 0.45;
  gl_FragColor = vec4(color * a, a);
}
