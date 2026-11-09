// fwidth-feathered white-hot core with a soft coloured glow. Output is premultiplied: alpha stays below the
// colour so the glow adds light. uGain carries the flash safety scale; uHdr lifts the core above 1 for bloom.
uniform float uGain;
uniform float uHdr;
uniform float uGlowScale;
uniform vec4 uClippingPlanes[NUM_CLIPPING_PLANES];

varying vec3 vVert;
varying vec3 vColor;
varying float vEnergy;
varying float vReveal;
varying vec3 vWorldPosition;

void main() {
  for (int i = 0; i < NUM_CLIPPING_PLANES; i++) {
    vec4 plane = uClippingPlanes[i];
    if (dot(-vWorldPosition, plane.xyz) > plane.w) {
      discard;
    }
  }

  float c = abs(vVert.x);
  float aa = max(fwidth(c), 0.015);
  float coreEdge = 1.0 / uGlowScale;
  float core = 1.0 - smoothstep(coreEdge - aa, coreEdge + aa, c);
  float glow = exp(-c * c * 7.0) * (1.0 - smoothstep(0.8, 1.0, c));
  float energy = vEnergy * uGain * vReveal;
  vec3 coreColor = mix(vColor, vec3(1.0), 0.75) * uHdr;
  vec3 rgb = (coreColor * core + vColor * glow * 0.8) * energy;
  if (uHdr <= 1.0) rgb = min(rgb, vec3(1.0));
  float alpha = clamp((core + glow * 0.4) * energy, 0.0, 1.0);
  gl_FragColor = vec4(rgb, alpha);
}
