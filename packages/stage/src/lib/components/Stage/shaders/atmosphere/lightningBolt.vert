// Lightning ribbon (triangle list). Per vertex: position = polyline point in map px, aPerp = unit normal times
// the miter factor, aVert = (side -1..1, width factor, brightness), aBolt = (strike atmoTime, seed, intensity),
// aColor = flash colour. The ribbon is expanded here so its on-screen width follows the zoom.
attribute vec2 aPerp;
attribute vec3 aVert;
attribute vec3 aBolt;
attribute vec3 aColor;

uniform float uAtmoTime;
uniform float uCoreHalfWidth;
uniform float uGlowScale;
uniform float uMapHeight;

varying vec3 vVert;
varying vec3 vColor;
varying float vEnergy;
varying float vReveal;
varying vec3 vWorldPosition;

const float HOLD_SEC = 0.15;
const float FALL_SEC = 0.45;

float boltAge() {
  float age = uAtmoTime - aBolt.x;
  if (age < -1800.0) age += 3600.0;
  if (age > 1800.0) age -= 3600.0;
  return age;
}

void main() {
  float age = boltAge();
  float envelope = age < 0.0 ? 0.0 : (age < HOLD_SEC ? 1.0 : pow(clamp(1.0 - (age - HOLD_SEC) / FALL_SEC, 0.0, 1.0), 1.6));
  float bin = floor(age * 40.0 + aBolt.y * 61.0);
  float flicker = mix(0.6, 1.0, fract(sin(bin * 12.9898 + aBolt.y * 78.233) * 43758.5453));
  envelope *= mix(1.0, flicker, smoothstep(0.03, 0.12, age));

  float headY = mix(1.12, -0.05, clamp(age / 0.05, 0.0, 1.0));
  float uvY = position.y / uMapHeight + 0.5;
  vReveal = smoothstep(headY, headY + 0.05, uvY);

  vVert = aVert;
  vColor = aColor;
  vEnergy = envelope * aVert.z * aBolt.z;
  vec2 local = position.xy + aPerp * aVert.x * aVert.y * uCoreHalfWidth * uGlowScale;
  vWorldPosition = (modelMatrix * vec4(local, 0.0, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(local, 0.0, 1.0);
}
