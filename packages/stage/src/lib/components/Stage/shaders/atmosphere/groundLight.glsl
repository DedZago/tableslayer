// Atmosphere lighting chunk shared by the map material patch and AtmosphereDarkness, so both compute
// bit-identical masks. The map ends at atmoLitMap (it divides by atmoLitToken, which the darkness quad
// multiplies back in). Uniforms are the shared objects of the 'atmosphere' controller.
#define ATMO_MAX_LIGHTS 32

uniform vec3 uAmbientTint;
uniform float uAmbientExposure;
uniform float uDarkness;
uniform float uTokenDarkness;
uniform float uFlash;
uniform vec3 uFlashColor;
uniform vec2 uFlashOrigin;
uniform float uFlashFocus;
uniform float uLightCount;
uniform vec4 uLights[ATMO_MAX_LIGHTS];
uniform vec3 uLightColors[ATMO_MAX_LIGHTS];
uniform vec2 uMapSize;

vec2 atmoAspect() {
  return vec2(uMapSize.x / max(uMapSize.y, 1.0), 1.0);
}

// The tint is authored as a perceptual colour: the mix happens in display-like space and is squared into
// linear light, so darkness 0.8 reads as a dim evening, not a faint dimming
vec3 atmoAmbient() {
  vec3 perceptual = mix(vec3(1.0), uAmbientTint * uAmbientExposure, uDarkness);
  return perceptual * perceptual;
}

// Placed lights cut through the darkness: whitened colour times a smooth radial falloff
vec3 atmoLightPool(vec2 uv) {
  vec2 aspect = atmoAspect();
  vec3 pool = vec3(0.0);
  for (int i = 0; i < ATMO_MAX_LIGHTS; i++) {
    if (float(i) >= uLightCount) break;
    vec4 light = uLights[i];
    float d = length((uv - light.xy) * aspect) / max(light.z, 0.0001);
    float falloff = 1.0 - smoothstep(0.12, 1.0, d);
    falloff *= falloff;
    pool = max(pool, mix(vec3(1.0), uLightColors[i], 0.45) * (falloff * light.w));
  }
  return pool;
}

// 0..~1.5 flash strength at this point: the whole sky lights up, a little stronger near the strike
float atmoFlashAmount(vec2 uv) {
  float d = length((uv - uFlashOrigin) * atmoAspect());
  float wide = mix(0.55, 1.0, exp(-d * d * 1.6));
  float local = exp(-d * d * 18.0);
  return uFlash * mix(wide, local, uFlashFocus);
}

vec3 atmoLitMapBase(vec2 uv) {
  return max(atmoAmbient(), atmoLightPool(uv));
}

// What the map is lit by: base lighting, lifted by the flash colour (added, so a flash reads even when the
// ambient light is already bright)
vec3 atmoLitMap(vec2 uv, float flash) {
  vec3 base = atmoLitMapBase(uv);
  return max(base, uFlashColor * (flash * 0.9)) + uFlashColor * (flash * 0.35);
}

// What the darkness quad multiplies everything under it by (tokens included)
vec3 atmoLitToken(vec2 uv, float flash) {
  vec3 lit = mix(vec3(1.0), atmoLitMapBase(uv), uTokenDarkness);
  return clamp(mix(lit, vec3(1.0), clamp(flash, 0.0, 1.0)), 0.0, 1.0);
}
