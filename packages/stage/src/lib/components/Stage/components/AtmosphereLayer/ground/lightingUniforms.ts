import type { AtmosphereUniforms } from '../atmosphereController.svelte';

/** The shared uniforms the lighting chunk (`groundLight.glsl`) reads, by name */
export const pickLightingUniforms = (uniforms: AtmosphereUniforms) => ({
  uAtmoTime: uniforms.uAtmoTime,
  uAmbientTint: uniforms.uAmbientTint,
  uAmbientExposure: uniforms.uAmbientExposure,
  uDarkness: uniforms.uDarkness,
  uTokenDarkness: uniforms.uTokenDarkness,
  uFlash: uniforms.uFlash,
  uFlashColor: uniforms.uFlashColor,
  uFlashOrigin: uniforms.uFlashOrigin,
  uFlashFocus: uniforms.uFlashFocus,
  uLightCount: uniforms.uLightCount,
  uLights: uniforms.uLights,
  uLightColors: uniforms.uLightColors,
  uMapSize: uniforms.uMapSize
});
