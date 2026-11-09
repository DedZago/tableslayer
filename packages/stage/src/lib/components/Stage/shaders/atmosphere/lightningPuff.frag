// Soft noise-edged dust puff, premultiplied, lit by the ambient grade like the particles.
uniform vec3 uDustColor;
uniform vec3 uAmbientTint;
uniform float uAmbientExposure;
uniform float uDarkness;
uniform vec4 uClippingPlanes[NUM_CLIPPING_PLANES];

varying vec2 vLocal;
varying float vAlpha;
varying float vSeed;
varying vec3 vWorldPosition;

void main() {
  for (int i = 0; i < NUM_CLIPPING_PLANES; i++) {
    vec4 plane = uClippingPlanes[i];
    if (dot(-vWorldPosition, plane.xyz) > plane.w) {
      discard;
    }
  }
  if (vAlpha <= 0.0) discard;

  float r = length(vLocal);
  float cloud = atmoValueNoise(vLocal * 2.4 + vSeed * 31.0);
  float shape = 1.0 - smoothstep(0.1, 1.0, r + (cloud - 0.5) * 0.55);
  float a = clamp(shape * vAlpha, 0.0, 1.0);
  vec3 lit = max(mix(vec3(1.0), uAmbientTint, uDarkness * 0.45) * mix(1.0, uAmbientExposure, 0.8) * (1.0 - 0.5 * uDarkness), 0.3);
  vec3 rgb = uDustColor * lit * (0.8 + 0.4 * cloud);
  gl_FragColor = vec4(rgb * a, a);
}
