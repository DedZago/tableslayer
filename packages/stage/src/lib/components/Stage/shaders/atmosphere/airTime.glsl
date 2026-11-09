// Seamless hourly clock helpers. uAtmoTime wraps from 3600 to 0, so anything periodic in it must repeat an
// integer number of times per hour or it pops at the wrap.
#define ATMO_PERIOD 3600.0

// Angular frequency (rad/s) of the nearest whole number of cycles per hour to `hz`
float atmoOmega(float hz) {
  return 6.2831853 * floor(hz * ATMO_PERIOD + 0.5) / ATMO_PERIOD;
}

// A life in seconds nudged so ATMO_PERIOD is a whole number of them (the cycle count is returned in `cycles`)
float atmoWholeLife(float life, out float cycles) {
  cycles = max(1.0, floor(ATMO_PERIOD / life + 0.5));
  return ATMO_PERIOD / cycles;
}

vec3 atmoHueRotate(vec3 c, float angle) {
  vec3 k = vec3(0.57735026);
  float ca = cos(angle);
  float sa = sin(angle);
  return c * ca + cross(k, c) * sa + k * dot(k, c) * (1.0 - ca);
}

vec3 atmoHueToRgb(float hueDeg) {
  vec3 p = abs(fract(vec3(hueDeg / 360.0) + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return clamp(p - 1.0, 0.0, 1.0);
}
