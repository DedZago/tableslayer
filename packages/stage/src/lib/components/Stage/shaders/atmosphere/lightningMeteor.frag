// Glowing head, tapering amber trail with a white-hot core. Premultiplied, alpha below colour so it adds light.
uniform float uGain;
uniform float uHdr;
uniform vec4 uClippingPlanes[NUM_CLIPPING_PLANES];

varying vec2 vLocal;
varying vec3 vColor;
varying float vFade;
varying float vTrailShare;
varying float vRatio;
varying float vIntensity;
varying vec3 vWorldPosition;

void main() {
  for (int i = 0; i < NUM_CLIPPING_PLANES; i++) {
    vec4 plane = uClippingPlanes[i];
    if (dot(-vWorldPosition, plane.xyz) > plane.w) {
      discard;
    }
  }
  if (vFade <= 0.0) discard;

  float x = clamp(vLocal.x / max(vTrailShare, 1e-3), 0.0, 1.0);
  float inTrail = 1.0 - step(1.0, vLocal.x / max(vTrailShare, 1e-3));
  float y = vLocal.y;
  float across = exp(-y * y * 3.0);
  float trail = pow(x, 2.4) * across * inTrail;
  float core = pow(x, 4.0) * exp(-y * y * 55.0) * inTrail;
  vec2 hp = vec2((vLocal.x - vTrailShare) * vRatio, y * 0.5) * 2.0;
  float head = exp(-dot(hp, hp) * 1.6);

  vec3 tail = mix(vec3(1.0, 0.28, 0.06), vColor, smoothstep(0.0, 0.7, x));
  vec3 rgb = tail * trail * 1.8 + vec3(1.0, 0.93, 0.78) * (core * 1.3 + head * 1.5);
  float energy = vFade * vIntensity * uGain;
  rgb *= energy * uHdr;
  if (uHdr <= 1.0) rgb = min(rgb, vec3(1.0));
  gl_FragColor = vec4(rgb, clamp((trail * 0.45 + head * 0.9) * energy, 0.0, 1.0));
}
