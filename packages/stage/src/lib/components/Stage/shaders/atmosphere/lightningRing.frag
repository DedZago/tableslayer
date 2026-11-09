uniform float uGain;
uniform float uHdr;
uniform vec4 uClippingPlanes[NUM_CLIPPING_PLANES];

varying vec2 vLocal;
varying vec3 vColor;
varying float vAge;
varying float vIntensity;
varying vec3 vWorldPosition;

void main() {
  for (int i = 0; i < NUM_CLIPPING_PLANES; i++) {
    vec4 plane = uClippingPlanes[i];
    if (dot(-vWorldPosition, plane.xyz) > plane.w) {
      discard;
    }
  }

  float t = clamp(vAge / 0.4, 0.0, 1.0);
  if (vAge < 0.0 || t >= 1.0) discard;
  float r = length(vLocal);
  float ringRadius = 0.12 + 0.85 * (1.0 - pow(1.0 - t, 3.0));
  float aa = max(fwidth(r), 0.01);
  float ring = (1.0 - smoothstep(0.012 - aa, 0.045 + aa, abs(r - ringRadius))) * pow(1.0 - t, 1.5);
  float flash = exp(-r * r * 30.0) * exp(-vAge * 14.0);
  float energy = (ring * 0.8 + flash * 1.4) * vIntensity * uGain * (1.0 - smoothstep(0.9, 1.0, r));
  vec3 rgb = mix(vColor, vec3(1.0), 0.6 + 0.4 * flash) * uHdr * energy;
  if (uHdr <= 1.0) rgb = min(rgb, vec3(1.0));
  gl_FragColor = vec4(rgb, clamp(energy * 0.5, 0.0, 1.0));
}
