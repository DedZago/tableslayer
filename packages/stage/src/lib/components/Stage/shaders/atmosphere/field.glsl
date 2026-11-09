// Atmosphere field chunk (spec 3.4). The uniforms are the shared objects of the 'atmosphere' controller.
// FIELD_VMAX must match sim/types.ts. Everything is in map UV space (u right, v up).
#ifndef ATMO_CURL_MAX
#define ATMO_CURL_MAX 2.0
#endif
#ifndef ATMO_FIELD_VMAX
#define ATMO_FIELD_VMAX 0.25
#endif

uniform sampler2D uField;
uniform sampler2D uFieldPrev;
uniform float uFieldBlend;
uniform sampler2D uAccum;

vec4 atmoFieldSample(vec2 uv) {
  return mix(texture2D(uFieldPrev, uv), texture2D(uField, uv), uFieldBlend);
}

// Velocity in map UV units per second
vec2 atmoWind(vec2 uv) {
  return (atmoFieldSample(uv).rg * 2.0 - 1.0) * ATMO_FIELD_VMAX;
}

// 0..1 dust, snow whiteout, smoke or fog density
float atmoDensity(vec2 uv) {
  return atmoFieldSample(uv).b;
}

// Curl normalised to -1..1 (the field stores it as (byte/255*2-1) * CURL_MAX = 2.0 per second).
// Multiply by ATMO_CURL_MAX for 1/s. Drives tumble and wisp curl
float atmoCurl(vec2 uv) {
  return atmoFieldSample(uv).a * 2.0 - 1.0;
}

// r wetness, g puddle fill, b snow depth, a scorch
vec4 atmoAccum(vec2 uv) {
  return texture2D(uAccum, uv);
}
