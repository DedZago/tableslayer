varying float vSide;
varying float vAlpha;
varying vec3 vTint;

void main() {
  float edge = abs(vSide);
  float aa = max(fwidth(edge), 0.02);
  float a = (1.0 - smoothstep(0.55 - aa, 1.0, edge)) * vAlpha;
  gl_FragColor = vec4(vTint * a, a);
}
