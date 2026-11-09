// Impact flash at a strike point: one instanced quad per active bolt.
// aStrike = (x, y in map px, strike atmoTime), aColor = flash colour, aIntensity = event intensity
attribute vec3 aStrike;
attribute vec3 aColor;
attribute float aIntensity;

uniform float uAtmoTime;
uniform float uRadius;

varying vec2 vLocal;
varying vec3 vColor;
varying float vAge;
varying float vIntensity;
varying vec3 vWorldPosition;

void main() {
  float age = uAtmoTime - aStrike.z;
  if (age < -1800.0) age += 3600.0;
  if (age > 1800.0) age -= 3600.0;
  vAge = age;
  vColor = aColor;
  vIntensity = aIntensity;
  vLocal = position.xy * 2.0;
  vec2 local = aStrike.xy + position.xy * uRadius * 2.0;
  vWorldPosition = (modelMatrix * vec4(local, 0.0, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(local, 0.0, 1.0);
}
