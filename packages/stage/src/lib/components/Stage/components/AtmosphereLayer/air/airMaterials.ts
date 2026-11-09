import chroma from 'chroma-js';
import * as THREE from 'three';
import airCompositeFragment from '../../../shaders/atmosphere/airComposite.frag?raw';
import airCompositeVertex from '../../../shaders/atmosphere/airComposite.vert?raw';
import airDensityFragment from '../../../shaders/atmosphere/airDensity.frag?raw';
import airFullscreenVertex from '../../../shaders/atmosphere/airFullscreen.vert?raw';
import airTimeChunk from '../../../shaders/atmosphere/airTime.glsl?raw';
import airWindLineFragment from '../../../shaders/atmosphere/airWindLine.frag?raw';
import airWindLineVertex from '../../../shaders/atmosphere/airWindLine.vert?raw';
import fieldChunk from '../../../shaders/atmosphere/field.glsl?raw';
import noiseChunk from '../../../shaders/atmosphere/noise.glsl?raw';
import particleFragment from '../../../shaders/atmosphere/particle.frag?raw';
import particleVertex from '../../../shaders/atmosphere/particle.vert?raw';
import ashAtlasUrl from '../../ParticleSystem/particles/atlases/ash.png';
import leavesAtlasUrl from '../../ParticleSystem/particles/atlases/leaves.png';
import snowAtlasUrl from '../../ParticleSystem/particles/atlases/snow.png';
import type { AtmosphereController } from '../atmosphereController.svelte';
import type { ComposedAtmosphere, ComposedDensity, ComposedParticleLayer, ParticleShape } from '../types';

export const PARTICLE_SHAPE_INDEX: Record<ParticleShape, number> = {
  streak: 0,
  drop: 1,
  flake: 2,
  atlasSnow: 3,
  atlasLeaves: 4,
  atlasAsh: 5,
  grit: 6,
  hail: 7,
  mote: 8,
  ember: 9,
  petal: 10,
  bubble: 11,
  spore: 12,
  wisp: 13,
  star: 14,
  meteor: 15,
  windLine: 16
};

const ALWAYS_STRETCHED = new Set<ParticleShape>(['streak', 'drop', 'grit', 'hail', 'meteor']);
const GLOW_QUAD_SCALE: Partial<Record<ParticleShape, number>> = {
  mote: 2.6,
  ember: 2.4,
  spore: 2.6,
  wisp: 1.5,
  star: 2,
  meteor: 1.6,
  hail: 1.3
};
const FLIP_AMOUNT: Partial<Record<ParticleShape, number>> = {
  flake: 0.5,
  atlasSnow: 0.6,
  atlasLeaves: 0.85,
  atlasAsh: 0.3,
  petal: 0.85
};
const ATLAS_URLS: Partial<Record<ParticleShape, string>> = {
  atlasSnow: snowAtlasUrl,
  atlasLeaves: leavesAtlasUrl,
  atlasAsh: ashAtlasUrl
};

export const MAX_WIND_LINES = 20;
export const WIND_LINE_SEGMENTS = 20;
export const POP_RATIO = 0.12;
export const MAX_POPS = 160;
const NUM_CLIPPING_PLANES = 4;
const FALLBACK_COLOR = '#ffffff';

export const isWindLine = (spec: Pick<ComposedParticleLayer, 'shape'>) => spec.shape === 'windLine';

export const isStretchedShape = (spec: Pick<ComposedParticleLayer, 'shape' | 'stretch'>) =>
  ALWAYS_STRETCHED.has(spec.shape) || spec.stretch > 1.5;

const atlasTextures = new Map<string, THREE.Texture>();
const emptyTexture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
emptyTexture.needsUpdate = true;

const loadAtlas = (url: string) => {
  let texture = atlasTextures.get(url);
  if (!texture) {
    texture = new THREE.TextureLoader().load(url);
    texture.colorSpace = THREE.NoColorSpace;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    atlasTextures.set(url, texture);
  }
  return texture;
};

export const disposeAtlasTextures = () => {
  atlasTextures.forEach((texture) => texture.dispose());
  atlasTextures.clear();
};

const toGlColor = (color: string): [number, number, number] =>
  (chroma.valid(color) ? chroma(color) : chroma(FALLBACK_COLOR)).gl().slice(0, 3) as [number, number, number];

const withNoise = (source: string) => `${noiseChunk}\n${fieldChunk}\n${airTimeChunk}\n${source}`;

export interface AirSharedUniforms {
  uAtmoTime: { value: number };
  uWindDir: { value: THREE.Vector2 };
  uWindStrength: { value: number };
  uField: { value: THREE.Texture };
  uFieldPrev: { value: THREE.Texture };
  uFieldBlend: { value: number };
  uAccum: { value: THREE.Texture };
  uAmbientTint: { value: THREE.Color };
  uAmbientExposure: { value: number };
  uDarkness: { value: number };
  uFlash: { value: number };
  uFlashColor: { value: THREE.Color };
  uAspect: { value: number };
  uRtHeight: { value: number };
  uMotion: { value: number };
  uFieldMix: { value: number };
}

export const createAirSharedUniforms = (controller: AtmosphereController): AirSharedUniforms => {
  const shared = controller.uniforms;
  return {
    uAtmoTime: shared.uAtmoTime,
    uWindDir: shared.uWindDir,
    uWindStrength: shared.uWindStrength,
    uField: shared.uField,
    uFieldPrev: shared.uFieldPrev,
    uFieldBlend: shared.uFieldBlend,
    uAccum: shared.uAccum,
    uAmbientTint: shared.uAmbientTint,
    uAmbientExposure: shared.uAmbientExposure,
    uDarkness: shared.uDarkness,
    uFlash: shared.uFlash,
    uFlashColor: shared.uFlashColor,
    uAspect: { value: 1 },
    uRtHeight: { value: 512 },
    uMotion: { value: 1 },
    uFieldMix: { value: 0 }
  };
};

export const particleDefines = (spec: ComposedParticleLayer, pop: boolean) => {
  const defines: Record<string, number | string> = {
    DEPTH_LAYERS: spec.depthLayers,
    QUAD_SCALE: (GLOW_QUAD_SCALE[spec.shape] ?? 1).toFixed(2),
    STRETCHED: !pop && isStretchedShape(spec) ? 1 : 0,
    FLIP_AMOUNT: (FLIP_AMOUNT[spec.shape] ?? 0).toFixed(2),
    PARTICLE_SHAPE: pop ? 99 : PARTICLE_SHAPE_INDEX[spec.shape],
    ATMO_OCTAVES: 2,
    NUM_CLIPPING_PLANES
  };
  if (spec.blend === 'additive') defines.ADDITIVE = 1;
  if (pop) defines.PARTICLE_POP = 1;
  return defines;
};

const applyBlending = (material: THREE.ShaderMaterial, blend: 'normal' | 'additive') => {
  material.blending = THREE.CustomBlending;
  material.blendEquation = THREE.AddEquation;
  material.blendSrc = THREE.OneFactor;
  if (blend === 'additive') {
    material.blendDst = THREE.OneFactor;
    material.blendSrcAlpha = THREE.ZeroFactor;
    material.blendDstAlpha = THREE.OneFactor;
  } else {
    material.blendDst = THREE.OneMinusSrcAlphaFactor;
    material.blendSrcAlpha = THREE.OneFactor;
    material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  }
};

const baseMaterialState = (material: THREE.ShaderMaterial) => {
  material.transparent = true;
  material.depthTest = false;
  material.depthWrite = false;
  material.toneMapped = false;
  material.visible = false;
};

export const createParticleMaterial = (spec: ComposedParticleLayer, shared: AirSharedUniforms, pop = false) => {
  const material = new THREE.ShaderMaterial({
    defines: particleDefines(spec, pop),
    uniforms: {
      ...shared,
      uAtlas: { value: (ATLAS_URLS[spec.shape] && loadAtlas(ATLAS_URLS[spec.shape]!)) || emptyTexture },
      uSize: { value: new THREE.Vector2() },
      uLife: { value: new THREE.Vector2() },
      uFall: { value: 0 },
      uWindInfluence: { value: 0 },
      uStretch: { value: 1 },
      uFlicker: { value: 0 },
      uTumble: { value: 0 },
      uWander: { value: 0 },
      uJitter: { value: 0 },
      uHueSpread: { value: 0 },
      uAlpha: { value: 1 },
      uColorA: { value: new THREE.Vector3() },
      uColorB: { value: new THREE.Vector3() }
    },
    vertexShader: withNoise(particleVertex),
    fragmentShader: withNoise(particleFragment)
  });
  baseMaterialState(material);
  applyBlending(material, spec.blend);
  return material;
};

const POP_LIFE: [number, number] = [0.28, 0.5];

export const writeParticleUniforms = (material: THREE.ShaderMaterial, spec: ComposedParticleLayer, pop = false) => {
  const { uniforms } = material;
  const [colorA, colorB] = [toGlColor(spec.colorA), toGlColor(spec.colorB)];
  uniforms.uSize.value.set(spec.size[0], spec.size[1]);
  uniforms.uLife.value.set(...(pop ? POP_LIFE : spec.lifetime));
  uniforms.uFall.value = spec.fall;
  uniforms.uWindInfluence.value = spec.windInfluence;
  uniforms.uStretch.value = spec.stretch;
  uniforms.uFlicker.value = spec.flicker ?? 0;
  uniforms.uTumble.value = spec.tumble ?? 0;
  uniforms.uWander.value = spec.wander ?? 0;
  uniforms.uJitter.value = spec.jitter ?? 0;
  uniforms.uHueSpread.value = spec.hueSpread ?? 0;
  const thinning = Math.min(1.6, (spec.count / Math.max(1, spec.maxCount)) ** 0.4);
  uniforms.uAlpha.value = pop ? spec.alpha * 0.9 : spec.alpha * thinning;
  uniforms.uColorA.value.set(...colorA);
  uniforms.uColorB.value.set(...colorB);
};

export const createWindLineMaterial = (spec: ComposedParticleLayer, shared: AirSharedUniforms) => {
  const material = new THREE.ShaderMaterial({
    defines: { ATMO_OCTAVES: 2, NUM_CLIPPING_PLANES },
    uniforms: {
      ...shared,
      uSize: { value: new THREE.Vector2() },
      uLife: { value: new THREE.Vector2() },
      uStretch: { value: 1 },
      uAlpha: { value: 1 },
      uColorA: { value: new THREE.Vector3() },
      uColorB: { value: new THREE.Vector3() }
    },
    vertexShader: withNoise(airWindLineVertex),
    fragmentShader: withNoise(airWindLineFragment),
    side: THREE.DoubleSide
  });
  baseMaterialState(material);
  applyBlending(material, spec.blend);
  return material;
};

export const writeWindLineUniforms = (material: THREE.ShaderMaterial, spec: ComposedParticleLayer) => {
  const { uniforms } = material;
  uniforms.uSize.value.set(spec.size[0], spec.size[1]);
  uniforms.uLife.value.set(...spec.lifetime);
  uniforms.uStretch.value = spec.stretch;
  uniforms.uAlpha.value = spec.alpha;
  uniforms.uColorA.value.set(...toGlColor(spec.colorA));
  uniforms.uColorB.value.set(...toGlColor(spec.colorB));
};

export const createDensityMaterial = (density: ComposedDensity, shared: AirSharedUniforms) => {
  const material = new THREE.ShaderMaterial({
    defines: { ATMO_OCTAVES: density.octaves },
    uniforms: {
      ...shared,
      uScale: { value: 2 },
      uCoverage: { value: 0 },
      uSpeed: { value: 1 },
      uShare: { value: 1 },
      uMaxOcclusion: { value: 0.7 },
      uColorA: { value: new THREE.Vector3() },
      uColorB: { value: new THREE.Vector3() }
    },
    vertexShader: airFullscreenVertex,
    fragmentShader: withNoise(airDensityFragment),
    transparent: false,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    toneMapped: false
  });
  material.visible = false;
  return material;
};

export const writeDensityUniforms = (material: THREE.ShaderMaterial, density: ComposedDensity) => {
  const { uniforms } = material;
  uniforms.uScale.value = density.scale;
  uniforms.uCoverage.value = density.coverage;
  uniforms.uSpeed.value = density.speed;
  uniforms.uShare.value = density.overTokens;
  uniforms.uMaxOcclusion.value = density.maxOcclusion;
  uniforms.uColorA.value.set(...toGlColor(density.colorA));
  uniforms.uColorB.value.set(...toGlColor(density.colorB));
};

export const densityKey = (density: ComposedDensity) => `octaves${density.octaves}`;

export interface CompositeFeatures {
  shafts: boolean;
  aurora: boolean;
  rim: boolean;
}

export const compositeFeatures = (composed: Pick<ComposedAtmosphere, 'features'>): CompositeFeatures => ({
  shafts: composed.features.includes('air:shafts'),
  aurora: composed.features.includes('air:aurora'),
  rim: composed.features.includes('air:rim')
});

export const compositeKey = ({ shafts, aurora, rim }: CompositeFeatures) =>
  `${shafts ? 's' : ''}${aurora ? 'a' : ''}${rim ? 'r' : ''}`;

export const createCompositeMaterial = (
  airTexture: THREE.Texture,
  densityTexture: THREE.Texture,
  shared: AirSharedUniforms,
  features: CompositeFeatures
) => {
  const clipping = Array.from({ length: NUM_CLIPPING_PLANES }, () => new THREE.Vector4());
  const defines: Record<string, number> = { NUM_CLIPPING_PLANES, ATMO_OCTAVES: 2 };
  if (features.shafts) defines.AIR_SHAFTS = 1;
  if (features.aurora) defines.AIR_AURORA = 1;
  if (features.rim) defines.AIR_RIM = 1;
  const material = new THREE.ShaderMaterial({
    defines,
    uniforms: {
      uAir: { value: airTexture },
      uDensity: { value: densityTexture },
      uMaxOcclusion: { value: 0.7 },
      uClippingPlanes: new THREE.Uniform(clipping),
      uAtmoTime: shared.uAtmoTime,
      uAspect: shared.uAspect,
      uSunDir: { value: new THREE.Vector2(0.5, 0.87) },
      uShaftColor: { value: new THREE.Vector3(1, 0.94, 0.75) },
      uShaftStrength: { value: 0 },
      uShaftCount: { value: 0 },
      uAuroraStrength: { value: 0 },
      uAuroraHue: { value: 140 },
      uRimColor: { value: new THREE.Vector3(0.8, 0.1, 0.05) },
      uRimStrength: { value: 0 }
    },
    vertexShader: airCompositeVertex,
    fragmentShader: `${noiseChunk}\n${airTimeChunk}\n${airCompositeFragment}`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    toneMapped: false
  });
  material.visible = false;
  return material;
};

const DEFAULT_SUN_ANGLE = 60;
const MAX_SHAFTS = 8;

export const writeCompositeUniforms = (material: THREE.ShaderMaterial, lighting: ComposedAtmosphere['lighting']) => {
  const { uniforms } = material;
  const angle = ((lighting?.sunAngle ?? DEFAULT_SUN_ANGLE) * Math.PI) / 180;
  uniforms.uSunDir.value.set(Math.cos(angle), Math.sin(angle));
  uniforms.uShaftColor.value.set(...(lighting?.shafts?.color ?? [1, 1, 1]));
  uniforms.uShaftStrength.value = lighting?.shafts?.strength ?? 0;
  uniforms.uShaftCount.value = Math.min(MAX_SHAFTS, lighting?.shafts?.count ?? 0);
  uniforms.uAuroraStrength.value = lighting?.aurora?.strength ?? 0;
  uniforms.uAuroraHue.value = lighting?.aurora?.hue ?? 140;
  uniforms.uRimColor.value.set(...(lighting?.rimVignette?.color ?? [1, 0, 0]));
  uniforms.uRimStrength.value = lighting?.rimVignette?.strength ?? 0;
};

export const writeClippingPlanes = (material: THREE.ShaderMaterial, planes: THREE.Plane[]) => {
  const target = material.uniforms.uClippingPlanes.value as THREE.Vector4[];
  for (let i = 0; i < NUM_CLIPPING_PLANES; i++) {
    const plane = planes[i];
    if (plane) target[i].set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
  }
  material.uniformsNeedUpdate = true;
};

/** Forces the link status check three.js otherwise defers to first use; null when disposed mid-compile */
export const programLinked = (renderer: THREE.WebGLRenderer, material: THREE.ShaderMaterial): boolean | null => {
  const { currentProgram } = renderer.properties.get(material) as {
    currentProgram?: THREE.WebGLProgram & { diagnostics?: { runnable: boolean } };
  };
  if (!currentProgram) return null;
  currentProgram.getUniforms();
  return currentProgram.diagnostics?.runnable !== false;
};

export { emptyTexture as emptyAirTexture };
