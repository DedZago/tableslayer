import * as THREE from 'three';
import { getGridCellSize } from '../../../helpers/grid';
import { getMapGridCellSize } from '../../../helpers/mapSpace';
import fieldChunk from '../../../shaders/atmosphere/field.glsl?raw';
import groundChunk from '../../../shaders/atmosphere/ground.glsl?raw';
import lightChunk from '../../../shaders/atmosphere/groundLight.glsl?raw';
import noiseChunk from '../../../shaders/atmosphere/noise.glsl?raw';
import type { GridLayerProps } from '../../GridLayer/types';
import { PERFORMANCE_TIER_SETTINGS, type DisplayProps } from '../../Stage/types';
import type { AtmosphereController } from '../atmosphereController.svelte';
import type { ComposedAtmosphere } from '../types';
import { getGroundShared } from './groundShared';
import { pickLightingUniforms } from './lightingUniforms';

const FEATURE_DEFINES: Record<string, string> = {
  'ground:wet': 'ATMO_WET',
  'ground:ripples': 'ATMO_RIPPLES',
  'ground:snow': 'ATMO_SNOW',
  'ground:clouds': 'ATMO_CLOUDS',
  'ground:haze': 'ATMO_HAZE',
  'ground:caustics': 'ATMO_CAUSTICS',
  'ground:tint': 'ATMO_TINT',
  'ground:grade': 'ATMO_GRADE',
  'ground:speckle': 'ATMO_SPECKLE',
  'ground:pools': 'ATMO_POOLS',
  'ground:aurora': 'ATMO_AURORA',
  'ground:tremor': 'ATMO_TREMOR',
  'out:srgb': 'ATMO_SRGB_OUTPUT',
  'ground:lighting': 'ATMO_LIGHTING',
  'ground:flash': 'ATMO_FLASH'
};

const GROUND_SHAFT_GAIN = 1;
/** Cloud noise units per second at speed 1; the offset is `-drift * atmoTime` so every client agrees */
const CLOUD_DRIFT_RATE = 0.04;

const MAP_FRAGMENT = /* glsl */ `
#ifdef USE_MAP
  vec2 atmoUv = vMapUv;
  vec2 atmoQ = atmoUv * atmoAspect();
  vec2 atmoPixel = max(abs(dFdx(atmoUv)) + abs(dFdy(atmoUv)), vec2(0.000001));
  vec3 atmoRipple = vec3(0.0);
  vec2 atmoOffset = atmoDistortion(atmoUv, atmoPixel, atmoQ);
  #ifdef ATMO_RIPPLES
    atmoRipple = atmoRipples(atmoQ / (uGroundCell * 0.4), 0.12 + 0.5 * uRippleStrength);
    atmoOffset += atmoRipple.yz * (0.4 * uRippleStrength) * atmoPixel * 22.0;
  #endif
  vec4 atmoBase = atmoMapFetch(atmoUv);
  float atmoLuma = dot(atmoBase.rgb, ATMO_LUMA);
  float atmoLumaX = atmoLuma;
  float atmoLumaY = atmoLuma;
  #if defined(ATMO_WET) || defined(ATMO_SNOW)
    atmoLumaX = dot(atmoMapFetch(atmoUv + vec2(atmoPixel.x, 0.0)).rgb, ATMO_LUMA);
    atmoLumaY = dot(atmoMapFetch(atmoUv + vec2(0.0, atmoPixel.y)).rgb, ATMO_LUMA);
  #endif
  vec4 atmoSampled = atmoBase;
  if (dot(atmoOffset, atmoOffset) > 0.0) atmoSampled = atmoMapFetch(atmoUv + atmoOffset);
  vec4 atmoAccumSample = vec4(0.0);
  #if defined(ATMO_WET) || defined(ATMO_SNOW) || defined(ATMO_FLASH)
    atmoAccumSample = atmoAccum(atmoUv);
  #endif
  #ifdef ATMO_FLASH
    float atmoFlash = atmoFlashAmount(atmoUv);
  #else
    float atmoFlash = 0.0;
  #endif
  vec3 atmoColor = atmoGround(atmoSampled.rgb, atmoUv, atmoQ, atmoLumaX, atmoLumaY, atmoLuma, atmoAccumSample, atmoRipple, atmoFlash);
  #ifdef ATMO_LIGHTING
    vec4 atmoSun = atmoSunPools(atmoQ);
    vec3 atmoLitMapValue = atmoLitMap(atmoUv, atmoFlash) * atmoSun.a + atmoSun.rgb + atmoExtraLight(atmoUv, atmoQ);
    vec3 atmoLitTokenValue = mix(vec3(1.0), atmoLitToken(atmoUv, atmoFlash), uGroundQuad);
    atmoColor = atmoApplyLight(atmoColor, atmoLitMapValue, atmoLitTokenValue);
  #else
    atmoColor *= vec3(1.0) + atmoExtraLight(atmoUv, atmoQ) * 0.6;
    #ifdef ATMO_FLASH
      atmoColor = atmoColor * (1.0 + atmoFlash * 0.5) + uFlashColor * atmoFlash * 0.2 * (0.4 + atmoLuma);
    #endif
  #endif
  diffuseColor *= vec4(atmoColor, atmoSampled.a);
#else
  #include <map_fragment>
#endif
`;

const MAP_LIGHT = /* glsl */ `
#ifdef USE_MAP
// The darkness quad multiplies what is already drawn. On the canvas that product is taken on sRGB-encoded
// values, so the map pre-divides in encoded space to land exactly on litMap; in linear targets it is a ratio
vec3 atmoApplyLight(vec3 color, vec3 litMap, vec3 litToken) {
  #ifdef ATMO_SRGB_OUTPUT
    vec3 wanted = sRGBTransferOETF(vec4(max(color * litMap, vec3(0.0)), 1.0)).rgb;
    vec3 factor = sRGBTransferOETF(vec4(litToken, 1.0)).rgb;
    return sRGBTransferEOTF(vec4(min(wanted / max(factor, vec3(0.02)), vec3(1.0)), 1.0)).rgb;
  #else
    return color * litMap / max(litToken, vec3(0.03));
  #endif
}
#endif
`;

const MAP_FETCH = /* glsl */ `
#ifdef USE_MAP
vec4 atmoMapFetch(vec2 uv) {
  vec4 sampled = texture2D(map, uv);
  #ifdef DECODE_VIDEO_TEXTURE
    sampled = sRGBTransferEOTF(sampled);
  #endif
  return sampled;
}
#endif
`;

const buildDefines = (signature: string) =>
  signature
    .split('|')
    .map((token) => {
      if (token.startsWith('oct:')) return `#define ATMO_OCTAVES ${token.slice(4)}`;
      if (token.startsWith('taps:')) return `#define ATMO_RIPPLE_TAPS ${token.slice(5)}`;
      return FEATURE_DEFINES[token] ? `#define ${FEATURE_DEFINES[token]}` : '';
    })
    .filter(Boolean)
    .join('\n');

/**
 * The part of the feature signature that selects the map program: the `ground:*` features plus the tier's
 * octave and ripple tap counts. '' when no ground feature is on, which leaves the material unpatched.
 */
export const getGroundSignature = (composed: ComposedAtmosphere) => {
  const features = composed.features.filter((feature) => feature.startsWith('ground:'));
  if (!features.length) return '';
  const knobs = PERFORMANCE_TIER_SETTINGS[composed.tier];
  return [...features, `oct:${knobs.atmoNoiseOctaves}`, `taps:${knobs.atmoRippleTaps}`].join('|');
};

export const createGroundUniforms = (controller: AtmosphereController) => {
  const shared = getGroundShared(controller);
  return {
    ...pickLightingUniforms(controller.uniforms),
    uTremors: controller.uniforms.uTremors,
    uAccum: controller.uniforms.uAccum,
    uField: controller.uniforms.uField,
    uFieldPrev: controller.uniforms.uFieldPrev,
    uFieldBlend: controller.uniforms.uFieldBlend,
    uWindDir: controller.uniforms.uWindDir,
    uWindStrength: controller.uniforms.uWindStrength,
    uGroundQuad: shared.quad,
    uGroundCell: shared.cell,
    uPuddleMax: { value: 0 },
    uRippleStrength: { value: 0 },
    uSnowStrength: { value: 1 },
    uWetStrength: { value: 1 },
    uCloudCoverage: { value: 0 },
    uCloudDarkness: { value: 0 },
    uCloudScale: { value: 14 },
    uCloudSpeed: { value: 0.5 },
    uCloudDrift: { value: new THREE.Vector2() },
    uHazeStrength: { value: 0 },
    uHazeColor: { value: new THREE.Color(1, 1, 1) },
    uCaustics: { value: 0 },
    uTintColor: { value: new THREE.Color(1, 1, 1) },
    uTintStrength: { value: 0 },
    uShaftStrength: { value: 0 },
    uShaftColor: { value: new THREE.Color(1, 1, 1) },
    uSunAngle: { value: 60 },
    uWetTint: { value: new THREE.Color(1, 1, 1) },
    uWetTintStrength: { value: 0 },
    uSnowColor: { value: new THREE.Color(0.93, 0.96, 1) },
    uGradeSat: { value: 1 },
    uGradeContrast: { value: 1 },
    uSpeckleColor: { value: new THREE.Color(1, 1, 1) },
    uSpeckleStrength: { value: 0 },
    uSpeckleGlow: { value: 0 },
    uPoolColor: { value: new THREE.Color(1, 1, 1) },
    uPoolColorB: { value: new THREE.Color(1, 1, 1) },
    uPoolStrength: { value: 0 },
    uPoolScale: { value: 5 },
    uAuroraStrength: { value: 0 },
    uAuroraHue: { value: 140 }
  };
};

export type GroundUniforms = ReturnType<typeof createGroundUniforms>;

/** Writes the composed ground and lighting values into the uniforms in place */
export const applyGroundValues = (uniforms: GroundUniforms, composed: ComposedAtmosphere) => {
  const { ground, lighting } = composed;
  uniforms.uPuddleMax.value = ground.puddles;
  uniforms.uRippleStrength.value = ground.ripples;
  uniforms.uCloudCoverage.value = ground.clouds?.coverage ?? 0;
  uniforms.uCloudDarkness.value = ground.clouds?.darkness ?? 0;
  uniforms.uCloudScale.value = ground.clouds?.scale ?? 14;
  uniforms.uCloudSpeed.value = ground.clouds?.speed ?? 0.5;
  const cloudRate = (0.35 + 0.65 * composed.wind.strength) * uniforms.uCloudSpeed.value * CLOUD_DRIFT_RATE;
  uniforms.uCloudDrift.value.set(Math.cos(composed.wind.angle) * cloudRate, Math.sin(composed.wind.angle) * cloudRate);
  uniforms.uHazeStrength.value = ground.haze?.strength ?? 0;
  uniforms.uCaustics.value = ground.caustics;
  uniforms.uTintStrength.value = ground.tint?.strength ?? 0;
  if (ground.haze) uniforms.uHazeColor.value.setRGB(...ground.haze.color);
  if (ground.tint) uniforms.uTintColor.value.setRGB(...ground.tint.color);
  uniforms.uShaftStrength.value = lighting?.shafts ? lighting.shafts.strength * GROUND_SHAFT_GAIN : 0;
  if (lighting?.shafts) uniforms.uShaftColor.value.setRGB(...lighting.shafts.color, THREE.SRGBColorSpace);
  uniforms.uSunAngle.value = lighting?.sunAngle ?? 60;
  uniforms.uSnowStrength.value = ground.snowStrength || 1;
  uniforms.uSnowColor.value.setRGB(...ground.snowColor, THREE.SRGBColorSpace);
  uniforms.uWetTintStrength.value = ground.wetTint?.strength ?? 0;
  if (ground.wetTint) uniforms.uWetTint.value.setRGB(...ground.wetTint.color, THREE.SRGBColorSpace);
  uniforms.uGradeSat.value = ground.grade?.saturation ?? 1;
  uniforms.uGradeContrast.value = ground.grade?.contrast ?? 1;
  uniforms.uSpeckleStrength.value = ground.speckle?.strength ?? 0;
  uniforms.uSpeckleGlow.value = ground.speckle?.glow ?? 0;
  if (ground.speckle) uniforms.uSpeckleColor.value.setRGB(...ground.speckle.color, THREE.SRGBColorSpace);
  uniforms.uPoolStrength.value = ground.glowPools?.strength ?? 0;
  uniforms.uPoolScale.value = ground.glowPools?.scale ?? 5;
  if (ground.glowPools) {
    uniforms.uPoolColor.value.setRGB(...ground.glowPools.color, THREE.SRGBColorSpace);
    uniforms.uPoolColorB.value.setRGB(...ground.glowPools.colorB, THREE.SRGBColorSpace);
  }
  uniforms.uAuroraStrength.value = lighting?.aurora?.strength ?? 0;
  uniforms.uAuroraHue.value = lighting?.aurora?.hue ?? 140;
};

interface GroundCellOptions {
  isMapDefined: boolean;
  grid: GridLayerProps;
  mapSize: { width: number; height: number };
  display: DisplayProps;
  mapZoom: number;
}

/** One grid cell as a fraction of the map height, clamped so tiny and huge grids still read */
export const getGroundCellFraction = ({ isMapDefined, grid, mapSize, display, mapZoom }: GroundCellOptions) => {
  const cell = isMapDefined ? getMapGridCellSize(grid, mapSize) : getGridCellSize(grid, display) / mapZoom;
  return Math.min(0.25, Math.max(0.005, cell / mapSize.height));
};

/**
 * Patches a MeshBasicMaterial with the ground features of `signature`. The program cache key is the
 * signature, so two materials patched with the same signature share one program.
 */
export const patchMapMaterial = (material: THREE.Material, signature: string, uniforms: GroundUniforms) => {
  material.customProgramCacheKey = () => signature;
  material.onBeforeCompile = (shader) => {
    if (!signature) return;
    Object.assign(shader.uniforms, uniforms);
    const chunks = [noiseChunk, fieldChunk, lightChunk, groundChunk, MAP_FETCH, MAP_LIGHT].join('\n');
    shader.fragmentShader =
      buildDefines(signature) +
      '\n' +
      shader.fragmentShader
        .replace('void main() {', () => `${chunks}\nvoid main() {`)
        .replace('#include <map_fragment>', () => MAP_FRAGMENT);
  };
};
