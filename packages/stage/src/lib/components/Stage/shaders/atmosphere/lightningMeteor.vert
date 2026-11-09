// A meteor streaking toward its impact point: one instanced quad per meteor, placed at the head and trailing
// behind it. aStrike = (path centre x, y in map px, launch atmoTime), aMeteor = (travel angle in radians, travel
// seconds, intensity), aColor = trail colour. Everything is a function of uAtmoTime.
attribute vec3 aStrike;
attribute vec3 aMeteor;
attribute vec3 aColor;

uniform float uAtmoTime;
uniform float uMapHeight;
uniform float uWidth;

varying vec2 vLocal;
varying vec3 vColor;
varying float vFade;
varying float vTrailShare;
varying float vRatio;
varying float vIntensity;
varying vec3 vWorldPosition;

const float TRAIL = 0.4;
const float LINGER_SEC = 0.3;

void main() {
  float age = uAtmoTime - aStrike.z;
  if (age < -1800.0) age += 3600.0;
  if (age > 1800.0) age -= 3600.0;
  float travel = aMeteor.y;
  float tr = clamp(age / travel, 0.0, 1.0);
  float after = max(age - travel, 0.0) / LINGER_SEC;
  vFade = age < 0.0 ? 0.0 : (1.0 - smoothstep(0.0, 1.0, after));

  vec2 dir = vec2(cos(aMeteor.x), sin(aMeteor.x));
  vec2 normal = vec2(-dir.y, dir.x);
  float run = 1.1 * uMapHeight;
  vec2 head = aStrike.xy + dir * run * (pow(tr, 1.25) - 0.5);
  float trailLen = TRAIL * uMapHeight * smoothstep(0.0, 0.12, tr) * (1.0 - smoothstep(0.0, 1.0, after));
  float pad = 0.6 * uWidth;
  float length = trailLen + pad;

  float along = mix(-trailLen, pad, position.x + 0.5);
  vec2 local = head + dir * along + normal * position.y * uWidth;
  vLocal = vec2(position.x + 0.5, position.y * 2.0);
  vTrailShare = trailLen / length;
  vRatio = length / uWidth;
  vColor = aColor;
  vIntensity = aMeteor.z;
  vWorldPosition = (modelMatrix * vec4(local, 0.0, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(local, 0.0, 1.0);
}
