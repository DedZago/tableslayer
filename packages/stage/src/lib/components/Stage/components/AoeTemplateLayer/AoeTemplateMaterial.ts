import chroma from 'chroma-js';
import * as THREE from 'three';
import { TEMPLATE_FEATHER_FT } from '../../helpers/aoeTemplates';
import type { PerformanceTier } from '../Stage/types';
import { AoeEffect, AoeShape } from './types';

import aoeTemplateFragmentShader from '../../shaders/AoeTemplate.frag?raw';
import aoeTemplateVertexShader from '../../shaders/AoeTemplate.vert?raw';

const NUM_CLIPPING_PLANES = 4;
const DRAFT_OPACITY_SCALE = 0.7;

const SHAPE_INDEX: Record<AoeShape, number> = {
  [AoeShape.Circle]: 0,
  [AoeShape.Square]: 1,
  [AoeShape.Cone]: 2,
  [AoeShape.Line]: 3
};

const TIER_INDEX: Record<PerformanceTier, number> = { high: 0, medium: 1, low: 2 };

// Shared unit quad: every template mesh scales and rotates this one geometry
export const aoePlaneGeometry = new THREE.PlaneGeometry(1, 1);

// Programs are shared by three.js per define set, so each (effect, composer) pair
// only needs to link once. Gate state lives at module level so a second template
// of an effect appears immediately.
const readyPrograms = new Set<string>();
const failedPrograms = new Set<string>();
const pendingPrograms = new Map<string, Promise<boolean>>();
let probeTarget: THREE.WebGLRenderTarget | null = null;

const programKey = (effect: AoeEffect, rendersToTarget: boolean) => `${effect}|${rendersToTarget ? 1 : 0}`;

export const isAoeProgramReady = (effect: AoeEffect, rendersToTarget: boolean) =>
  readyPrograms.has(programKey(effect, rendersToTarget));

export const isAoeProgramFailed = (effect: AoeEffect, rendersToTarget: boolean) =>
  failedPrograms.has(programKey(effect, rendersToTarget));

const writeVector4Planes = (target: THREE.Vector4[], planes: THREE.Plane[]) => {
  for (let i = 0; i < NUM_CLIPPING_PLANES; i++) {
    const plane = planes[i];
    target[i].set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
  }
};

export const createAoeTemplateMaterial = (
  effect: AoeEffect,
  sharedTime: { value: number },
  clippingPlanes: THREE.Plane[]
): THREE.ShaderMaterial => {
  const clipping = Array.from({ length: NUM_CLIPPING_PLANES }, () => new THREE.Vector4());
  writeVector4Planes(clipping, clippingPlanes);

  return new THREE.ShaderMaterial({
    defines: { NUM_CLIPPING_PLANES, EFFECT_TYPE: effect },
    uniforms: {
      // The shared object itself, so one task advances every template's time
      uTime: sharedTime,
      uSeed: { value: 0 },
      uSpeed: { value: 1 },
      uOpacity: { value: 1 },
      uSize: { value: 0 },
      uWidth: { value: 0 },
      uFeather: { value: TEMPLATE_FEATHER_FT },
      uShape: { value: 0 },
      uPerformanceTier: { value: 0 },
      uQuadSize: { value: new THREE.Vector2(1, 1) },
      uQuadCenter: { value: new THREE.Vector2() },
      uColor: { value: new THREE.Vector3() },
      uClippingPlanes: new THREE.Uniform(clipping)
    },
    vertexShader: aoeTemplateVertexShader,
    fragmentShader: aoeTemplateFragmentShader,
    transparent: true,
    depthWrite: false,
    toneMapped: true
  });
};

/** Switches the effect define; three.js reuses an existing program for a known define set */
export const setAoeTemplateEffect = (material: THREE.ShaderMaterial, effect: AoeEffect) => {
  if (material.defines.EFFECT_TYPE === effect) return;
  material.defines.EFFECT_TYPE = effect;
  material.needsUpdate = true;
};

export const writeAoeClippingPlanes = (material: THREE.ShaderMaterial, planes: THREE.Plane[]) => {
  const clipping: THREE.Vector4[] = material.uniforms.uClippingPlanes.value;
  writeVector4Planes(clipping, planes);
  material.uniformsNeedUpdate = true;
};

const FALLBACK_COLOR = '#ffffff';

const toGlColor = (color: string) => (chroma.valid(color) ? chroma(color) : chroma(FALLBACK_COLOR)).gl();

export interface AoeTemplateUniformValues {
  seed: number;
  opacity: number;
  size: number;
  width: number;
  shape: AoeShape;
  color: string;
  performanceTier: PerformanceTier;
  quadSize: { x: number; y: number };
  quadCenter: { x: number; y: number };
  isDraft: boolean;
}

export const writeAoeTemplateUniforms = (material: THREE.ShaderMaterial, values: AoeTemplateUniformValues) => {
  const { uniforms } = material;
  const [r, g, b] = toGlColor(values.color);
  uniforms.uSeed.value = values.seed;
  uniforms.uOpacity.value = values.isDraft ? values.opacity * DRAFT_OPACITY_SCALE : values.opacity;
  uniforms.uSize.value = values.size;
  uniforms.uWidth.value = values.width;
  uniforms.uShape.value = SHAPE_INDEX[values.shape];
  uniforms.uPerformanceTier.value = TIER_INDEX[values.performanceTier];
  uniforms.uColor.value.set(r, g, b);
  uniforms.uQuadSize.value.set(values.quadSize.x, values.quadSize.y);
  uniforms.uQuadCenter.value.set(values.quadCenter.x, values.quadCenter.y);
  material.uniformsNeedUpdate = true;
};

// three.js only checks the link status on a program's first use; forcing it here
// fills in `diagnostics` so a broken effect can stay hidden instead of erroring every frame.
// Null when the material was disposed mid-compile (nothing is known about the program).
const programLinked = (renderer: THREE.WebGLRenderer, material: THREE.ShaderMaterial): boolean | null => {
  const { currentProgram } = renderer.properties.get(material) as {
    currentProgram?: THREE.WebGLProgram & { diagnostics?: { runnable: boolean } };
  };
  if (!currentProgram) return null;
  currentProgram.getUniforms();
  return currentProgram.diagnostics?.runnable !== false;
};

/**
 * Links the program off the main thread (KHR_parallel_shader_compile) and resolves
 * with whether it linked. Callers keep the material hidden until it resolves true,
 * so a slow driver compile never stalls the frame loop and a failed one never renders.
 */
export const compileAoeProgram = (
  renderer: THREE.WebGLRenderer,
  camera: THREE.Camera,
  scene: THREE.Scene,
  material: THREE.ShaderMaterial,
  effect: AoeEffect,
  rendersToTarget: boolean
): Promise<boolean> => {
  const key = programKey(effect, rendersToTarget);
  if (readyPrograms.has(key)) return Promise.resolve(true);
  if (failedPrograms.has(key)) return Promise.resolve(false);
  const pending = pendingPrograms.get(key);
  if (pending) return pending;

  probeTarget ??= new THREE.WebGLRenderTarget(1, 1);
  const previousTarget = renderer.getRenderTarget();
  if (rendersToTarget) renderer.setRenderTarget(probeTarget);
  const compiled = renderer
    .compileAsync(new THREE.Mesh(aoePlaneGeometry, material), camera, scene)
    .then(() => programLinked(renderer, material))
    .catch((error) => {
      console.error(`[AoeTemplate] compiling effect ${effect} failed`, error);
      return false;
    })
    .then((linked) => {
      pendingPrograms.delete(key);
      if (linked === true) readyPrograms.add(key);
      if (linked === false) {
        failedPrograms.add(key);
        console.error(`[AoeTemplate] effect ${effect} shader failed to link; templates using it stay hidden`);
      }
      return linked === true;
    });
  if (rendersToTarget) renderer.setRenderTarget(previousTarget);
  pendingPrograms.set(key, compiled);
  return compiled;
};
