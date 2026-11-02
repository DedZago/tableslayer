import chroma from 'chroma-js';
import * as THREE from 'three';
import { SPELL_FX_INDEX } from '../../helpers/spellCasts';
import type { SpellCastFx } from '../../helpers/spells';
import { AoeShape } from '../AoeTemplateLayer/types';
import type { PerformanceTier } from '../Stage/types';

import spellCastFragmentShader from '../../shaders/SpellCast.frag?raw';
import spellCastVertexShader from '../../shaders/SpellCast.vert?raw';

const NUM_CLIPPING_PLANES = 4;
const FALLBACK_COLOR = '#ffffff';

const SHAPE_INDEX: Record<AoeShape, number> = {
  [AoeShape.Circle]: 0,
  [AoeShape.Square]: 1,
  [AoeShape.Cone]: 2,
  [AoeShape.Line]: 3
};

const TIER_INDEX: Record<PerformanceTier, number> = { high: 0, medium: 1, low: 2 };

// Shared unit quad: every cast mesh scales this one geometry
export const spellCastPlaneGeometry = new THREE.PlaneGeometry(1, 1);

// Programs are shared by three.js per define set, so each (archetype, composer) pair
// links once. Gate state lives at module level so later casts appear immediately.
const readyPrograms = new Set<string>();
const failedPrograms = new Set<string>();
const pendingPrograms = new Map<string, Promise<boolean>>();
let probeTarget: THREE.WebGLRenderTarget | null = null;

const programKey = (fx: SpellCastFx, rendersToTarget: boolean) => `${fx}|${rendersToTarget ? 1 : 0}`;

export const isSpellProgramReady = (fx: SpellCastFx, rendersToTarget: boolean) =>
  readyPrograms.has(programKey(fx, rendersToTarget));

export const isSpellProgramFailed = (fx: SpellCastFx, rendersToTarget: boolean) =>
  failedPrograms.has(programKey(fx, rendersToTarget));

const writeVector4Planes = (target: THREE.Vector4[], planes: THREE.Plane[]) => {
  for (let i = 0; i < NUM_CLIPPING_PLANES; i++) {
    const plane = planes[i];
    target[i].set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
  }
};

export const createSpellCastMaterial = (
  fx: SpellCastFx,
  sharedTime: { value: number },
  clippingPlanes: THREE.Plane[]
): THREE.ShaderMaterial => {
  const clipping = Array.from({ length: NUM_CLIPPING_PLANES }, () => new THREE.Vector4());
  writeVector4Planes(clipping, clippingPlanes);

  return new THREE.ShaderMaterial({
    defines: { NUM_CLIPPING_PLANES, SPELL_FX: SPELL_FX_INDEX[fx] },
    uniforms: {
      // The shared object itself, so one task advances every cast's time
      uTime: sharedTime,
      uProgress: { value: 0 },
      uSeed: { value: 0 },
      uVariant: { value: 0 },
      uProjectile: { value: 0 },
      uPerformanceTier: { value: 0 },
      uShape: { value: 0 },
      uSize: { value: 5 },
      uWidth: { value: 5 },
      uDir: { value: new THREE.Vector2(1, 0) },
      uOrigin: { value: new THREE.Vector2() },
      uQuadSize: { value: new THREE.Vector2(1, 1) },
      uQuadCenter: { value: new THREE.Vector2() },
      uColorA: { value: new THREE.Vector3() },
      uColorB: { value: new THREE.Vector3() },
      uClippingPlanes: new THREE.Uniform(clipping)
    },
    vertexShader: spellCastVertexShader,
    fragmentShader: spellCastFragmentShader,
    transparent: true,
    depthWrite: false,
    // Premultiplied: the shader lowers alpha below the colour to make light-like additive glow
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    toneMapped: true
  });
};

export const writeSpellClippingPlanes = (material: THREE.ShaderMaterial, planes: THREE.Plane[]) => {
  writeVector4Planes(material.uniforms.uClippingPlanes.value, planes);
  material.uniformsNeedUpdate = true;
};

const toGlColor = (color: string) => (chroma.valid(color) ? chroma(color) : chroma(FALLBACK_COLOR)).gl();

export interface SpellCastUniformValues {
  seed: number;
  variant: number;
  projectile: boolean;
  performanceTier: PerformanceTier;
  shape: AoeShape;
  size: number;
  width: number;
  /** Radians, CCW from +x */
  angle: number;
  palette: [string, string];
  /** Feet relative to the target */
  origin: { x: number; y: number };
  quadSize: { x: number; y: number };
  quadCenter: { x: number; y: number };
}

/** Everything that is constant for the lifetime of a cast; progress is written per frame */
export const writeSpellCastUniforms = (material: THREE.ShaderMaterial, values: SpellCastUniformValues) => {
  const { uniforms } = material;
  const [ar, ag, ab] = toGlColor(values.palette[0]);
  const [br, bg, bb] = toGlColor(values.palette[1]);
  uniforms.uSeed.value = values.seed;
  uniforms.uVariant.value = values.variant;
  uniforms.uProjectile.value = values.projectile ? 1 : 0;
  uniforms.uPerformanceTier.value = TIER_INDEX[values.performanceTier];
  uniforms.uShape.value = SHAPE_INDEX[values.shape];
  uniforms.uSize.value = values.size;
  uniforms.uWidth.value = values.width;
  uniforms.uDir.value.set(Math.cos(values.angle), Math.sin(values.angle));
  uniforms.uOrigin.value.set(values.origin.x, values.origin.y);
  uniforms.uQuadSize.value.set(values.quadSize.x, values.quadSize.y);
  uniforms.uQuadCenter.value.set(values.quadCenter.x, values.quadCenter.y);
  uniforms.uColorA.value.set(ar, ag, ab);
  uniforms.uColorB.value.set(br, bg, bb);
  material.uniformsNeedUpdate = true;
};

/** One material per concurrent cast, recycled per archetype so a cast never builds one mid-gesture twice */
export const createSpellMaterialPool = (sharedTime: { value: number }, getClippingPlanes: () => THREE.Plane[]) => {
  const free = new Map<SpellCastFx, THREE.ShaderMaterial[]>();
  const all = new Set<THREE.ShaderMaterial>();

  const acquire = (fx: SpellCastFx) => {
    const material = free.get(fx)?.pop() ?? createSpellCastMaterial(fx, sharedTime, getClippingPlanes());
    all.add(material);
    return material;
  };

  const release = (fx: SpellCastFx, material: THREE.ShaderMaterial) => {
    material.visible = false;
    const list = free.get(fx) ?? [];
    list.push(material);
    free.set(fx, list);
  };

  const dispose = () => {
    all.forEach((material) => material.dispose());
    all.clear();
    free.clear();
  };

  return { acquire, release, dispose };
};

export type SpellMaterialPool = ReturnType<typeof createSpellMaterialPool>;

// three.js only checks the link status on a program's first use; forcing it here
// fills in `diagnostics` so a broken program can stay hidden instead of erroring every frame.
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
 * Links the archetype's program off the main thread (KHR_parallel_shader_compile) and resolves
 * with whether it linked. Callers keep the material hidden until it resolves true.
 */
export const compileSpellProgram = (
  renderer: THREE.WebGLRenderer,
  camera: THREE.Camera,
  scene: THREE.Scene,
  material: THREE.ShaderMaterial,
  fx: SpellCastFx,
  rendersToTarget: boolean
): Promise<boolean> => {
  const key = programKey(fx, rendersToTarget);
  if (readyPrograms.has(key)) return Promise.resolve(true);
  if (failedPrograms.has(key)) return Promise.resolve(false);
  const pending = pendingPrograms.get(key);
  if (pending) return pending;

  probeTarget ??= new THREE.WebGLRenderTarget(1, 1);
  const previousTarget = renderer.getRenderTarget();
  if (rendersToTarget) renderer.setRenderTarget(probeTarget);
  const compiled = renderer
    .compileAsync(new THREE.Mesh(spellCastPlaneGeometry, material), camera, scene)
    .then(() => programLinked(renderer, material))
    .catch((error) => {
      console.error(`[SpellCast] compiling ${fx} failed`, error);
      return false;
    })
    .then((linked) => {
      pendingPrograms.delete(key);
      if (linked === true) readyPrograms.add(key);
      if (linked === false) {
        failedPrograms.add(key);
        console.error(`[SpellCast] ${fx} shader failed to link; casts using it stay hidden`);
      }
      return linked === true;
    });
  if (rendersToTarget) renderer.setRenderTarget(previousTarget);
  pendingPrograms.set(key, compiled);
  return compiled;
};
