// One instance per effect: instanceMatrix places and sizes the quad, the attributes describe the effect.
attribute vec4 aTint;
attribute vec4 aInfo;
attribute float aPx;
attribute float aHighlight;

varying vec2 vUv;
varying vec3 vWorldPosition;
varying vec4 vTint;
varying vec4 vInfo;
varying float vPx;
varying float vHighlight;

void main() {
  vUv = uv;
  vTint = aTint;
  vInfo = aInfo;
  vPx = aPx;
  vHighlight = aHighlight;
  vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorldPosition = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
