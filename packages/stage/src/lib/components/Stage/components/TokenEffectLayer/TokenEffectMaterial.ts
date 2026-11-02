import chroma from 'chroma-js';
import * as THREE from 'three';
import { templateSeed } from '../../helpers/aoeTemplates';
import type { TokenEffectKind } from '../../helpers/spells';
import {
  effectStartOnClock,
  MAX_TOKEN_EFFECTS_PER_KIND,
  TOKEN_FX_INDEX,
  type PlacedTokenEffect
} from '../../helpers/tokenEffects';
import type { PerformanceTier } from '../Stage/types';

import tokenEffectFragmentShader from '../../shaders/TokenEffect.frag?raw';
import tokenEffectVertexShader from '../../shaders/TokenEffect.vert?raw';

const NUM_CLIPPING_PLANES = 4;
const FALLBACK_COLOR = '#ffffff';
const TIER_INDEX: Record<PerformanceTier, number> = { high: 0, medium: 1, low: 2 };

// Programs are shared by three.js per define set, so each (kind, composer) pair links once.
// Gate state lives at module level so a later effect of the kind appears immediately.
const readyPrograms = new Set<string>();
const failedPrograms = new Set<string>();
const pendingPrograms = new Map<string, Promise<boolean>>();
let probeTarget: THREE.WebGLRenderTarget | null = null;
let probeGeometry: THREE.PlaneGeometry | null = null;

const programKey = (fx: TokenEffectKind, rendersToTarget: boolean) => `${fx}|${rendersToTarget ? 1 : 0}`;

export const isTokenProgramReady = (fx: TokenEffectKind, rendersToTarget: boolean) =>
  readyPrograms.has(programKey(fx, rendersToTarget));

export const isTokenProgramFailed = (fx: TokenEffectKind, rendersToTarget: boolean) =>
  failedPrograms.has(programKey(fx, rendersToTarget));

const writeVector4Planes = (target: THREE.Vector4[], planes: THREE.Plane[]) => {
  for (let i = 0; i < NUM_CLIPPING_PLANES; i++) {
    const plane = planes[i];
    target[i].set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
  }
};

export const createTokenEffectMaterial = (
  fx: TokenEffectKind,
  time: { value: number },
  clippingPlanes: THREE.Plane[]
): THREE.ShaderMaterial => {
  const clipping = Array.from({ length: NUM_CLIPPING_PLANES }, () => new THREE.Vector4());
  writeVector4Planes(clipping, clippingPlanes);

  return new THREE.ShaderMaterial({
    defines: { NUM_CLIPPING_PLANES, TOKEN_FX: TOKEN_FX_INDEX[fx] },
    uniforms: {
      // The shared object itself, so one task advances every kind's clock
      uTime: time,
      uPerformanceTier: { value: 0 },
      uClippingPlanes: new THREE.Uniform(clipping)
    },
    vertexShader: tokenEffectVertexShader,
    fragmentShader: tokenEffectFragmentShader,
    transparent: true,
    depthWrite: false,
    // Premultiplied: the shader lowers alpha below the colour to make light-like additive glow
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    toneMapped: true,
    visible: false
  });
};

/** One material per kind, kept for the layer's lifetime so no program is released and relinked */
export const createTokenMaterialPool = (time: { value: number }, getClippingPlanes: () => THREE.Plane[]) => {
  const materials = new Map<TokenEffectKind, THREE.ShaderMaterial>();

  const get = (fx: TokenEffectKind) => {
    let material = materials.get(fx);
    if (!material) {
      material = createTokenEffectMaterial(fx, time, getClippingPlanes());
      materials.set(fx, material);
    }
    return material;
  };

  const forEach = (callback: (material: THREE.ShaderMaterial) => void) => materials.forEach(callback);

  const dispose = () => {
    materials.forEach((material) => material.dispose());
    materials.clear();
  };

  return { get, forEach, dispose };
};

export type TokenMaterialPool = ReturnType<typeof createTokenMaterialPool>;

export const writeTokenClippingPlanes = (material: THREE.ShaderMaterial, planes: THREE.Plane[]) => {
  writeVector4Planes(material.uniforms.uClippingPlanes.value, planes);
  material.uniformsNeedUpdate = true;
};

export const writeTokenPerformanceTier = (material: THREE.ShaderMaterial, tier: PerformanceTier) => {
  material.uniforms.uPerformanceTier.value = TIER_INDEX[tier];
};

const toGlColor = (color: string) => (chroma.valid(color) ? chroma(color) : chroma(FALLBACK_COLOR)).gl();

export interface TokenEffectInstances {
  mesh: THREE.InstancedMesh;
  /** The mesh's own quad, which also carries the per-instance attributes */
  geometry: THREE.PlaneGeometry;
}

/** A quad with room for MAX_TOKEN_EFFECTS_PER_KIND instances; frustum culling is off because instances span the map */
export const createTokenEffectMesh = (material: THREE.ShaderMaterial): TokenEffectInstances => {
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.setAttribute(
    'aTint',
    new THREE.InstancedBufferAttribute(new Float32Array(MAX_TOKEN_EFFECTS_PER_KIND * 4), 4).setUsage(
      THREE.DynamicDrawUsage
    )
  );
  geometry.setAttribute(
    'aInfo',
    new THREE.InstancedBufferAttribute(new Float32Array(MAX_TOKEN_EFFECTS_PER_KIND * 4), 4).setUsage(
      THREE.DynamicDrawUsage
    )
  );
  geometry.setAttribute(
    'aPx',
    new THREE.InstancedBufferAttribute(new Float32Array(MAX_TOKEN_EFFECTS_PER_KIND), 1).setUsage(THREE.DynamicDrawUsage)
  );
  const mesh = new THREE.InstancedMesh(geometry, material, MAX_TOKEN_EFFECTS_PER_KIND);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  return { mesh, geometry };
};

const scratchMatrix = new THREE.Matrix4();

export interface TokenInstanceClock {
  /** Seconds on the layer clock now */
  clockNow: number;
  /** Epoch ms now */
  nowMs: number;
  reducedMotion: boolean;
}

/** Writes the placed effects into the mesh's instance buffers; run when their signature changes, never per frame */
export const writeTokenEffectInstances = (
  { mesh, geometry }: TokenEffectInstances,
  placed: readonly PlacedTokenEffect[],
  clock: TokenInstanceClock
) => {
  const tint = geometry.getAttribute('aTint') as THREE.InstancedBufferAttribute;
  const info = geometry.getAttribute('aInfo') as THREE.InstancedBufferAttribute;
  const px = geometry.getAttribute('aPx') as THREE.InstancedBufferAttribute;
  const count = Math.min(placed.length, MAX_TOKEN_EFFECTS_PER_KIND);

  for (let i = 0; i < count; i++) {
    const { effect, x, y, tokenPx, extent, orbitRadii } = placed[i];
    const [r, g, b] = toGlColor(effect.color);
    const side = extent * tokenPx * 2;
    mesh.setMatrixAt(i, scratchMatrix.makeScale(side, side, 1).setPosition(x, y, 0));
    tint.setXYZW(i, r, g, b, templateSeed(effect.id));
    info.setXYZW(
      i,
      effectStartOnClock(effect.startedAt, clock.nowMs, clock.clockNow, clock.reducedMotion),
      effect.variant ?? 0,
      extent,
      orbitRadii
    );
    px.setX(i, tokenPx);
  }
  mesh.count = count;
  mesh.visible = count > 0;
  mesh.instanceMatrix.needsUpdate = true;
  tint.needsUpdate = true;
  info.needsUpdate = true;
  px.needsUpdate = true;
};

// three.js only checks the link status on a program's first use; forcing it here fills in
// `diagnostics` so a broken program can stay hidden instead of erroring every frame.
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
 * Links the kind's program off the main thread (KHR_parallel_shader_compile) and resolves with
 * whether it linked. The probe is an InstancedMesh so the program matches the one drawn later.
 */
export const compileTokenProgram = (
  renderer: THREE.WebGLRenderer,
  camera: THREE.Camera,
  scene: THREE.Scene,
  material: THREE.ShaderMaterial,
  fx: TokenEffectKind,
  rendersToTarget: boolean
): Promise<boolean> => {
  const key = programKey(fx, rendersToTarget);
  if (readyPrograms.has(key)) return Promise.resolve(true);
  if (failedPrograms.has(key)) return Promise.resolve(false);
  const pending = pendingPrograms.get(key);
  if (pending) return pending;

  probeTarget ??= new THREE.WebGLRenderTarget(1, 1);
  probeGeometry ??= new THREE.PlaneGeometry(1, 1);
  const previousTarget = renderer.getRenderTarget();
  if (rendersToTarget) renderer.setRenderTarget(probeTarget);
  const compiled = renderer
    .compileAsync(new THREE.InstancedMesh(probeGeometry, material, 1), camera, scene)
    .then(() => programLinked(renderer, material))
    .catch((error) => {
      console.error(`[TokenEffect] compiling ${fx} failed`, error);
      return false;
    })
    .then((linked) => {
      pendingPrograms.delete(key);
      if (linked === true) readyPrograms.add(key);
      if (linked === false) {
        failedPrograms.add(key);
        console.error(`[TokenEffect] ${fx} shader failed to link; effects using it stay hidden`);
      }
      return linked === true;
    });
  if (rendersToTarget) renderer.setRenderTarget(previousTarget);
  pendingPrograms.set(key, compiled);
  return compiled;
};
