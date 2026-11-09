import * as THREE from 'three';
import { hash32 } from '../../../helpers/atmosphereEvents';
import { PERFORMANCE_TIER_SETTINGS } from '../../Stage/types';
import type { AtmosphereController } from '../atmosphereController.svelte';
import type { ComposedAtmosphere, ComposedParticleLayer } from '../types';
import {
  MAX_POPS,
  MAX_WIND_LINES,
  POP_RATIO,
  WIND_LINE_SEGMENTS,
  compositeFeatures,
  createAirSharedUniforms,
  createCompositeMaterial,
  createDensityMaterial,
  createParticleMaterial,
  createWindLineMaterial,
  densityKey,
  isStretchedShape,
  isWindLine,
  programLinked,
  writeDensityUniforms,
  writeParticleUniforms,
  writeWindLineUniforms,
  type CompositeFeatures
} from './airMaterials';
import { airTargetSize } from './airTargetSize';

type EntryKind = 'particles' | 'windLine' | 'pop' | 'density';

interface AirEntry {
  key: string;
  kind: EntryKind;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  geometry: THREE.BufferGeometry | null;
  scene: THREE.Scene;
  target: THREE.WebGLRenderTarget;
  ready: boolean;
  failed: boolean;
  disposed: boolean;
}

export interface AirRenderer {
  readonly airTexture: THREE.Texture;
  readonly densityTexture: THREE.Texture;
  /** Something is linked and visible, so the composite has content */
  readonly hasContent: boolean;
  /** Hands over the composite material so the renderer can swap its density input and hide it when empty; rebinding replaces the previous one */
  bindComposite: (material: THREE.ShaderMaterial) => void;
  /** Builds a composite material for the given lighting features, wired to the target textures and shared clock */
  createComposite: (features: CompositeFeatures) => THREE.ShaderMaterial;
  /** The composite program linked: it may become visible */
  setCompositeLinked: (linked: boolean) => void;
  /** Follows the composed atmosphere; allocates only when a population is new or its structure changed */
  sync: (composed: ComposedAtmosphere) => void;
  /** Sizes the targets to the map's on-screen footprint; only reallocates when the snapped size changes */
  resize: (tier: ComposedAtmosphere['tier'], mapSize: { width: number; height: number }, screenScale: number) => void;
  /** Draws the density and air targets; call from the 'preRender' registry */
  render: () => void;
  dispose: () => void;
}

const GOLDEN = 0x9e3779b9;
const MAX_ASPECT_EXTRA = 4;
const EMPTY_DENSITY_SIZE = 1;

const createTarget = (width: number, height: number) =>
  new THREE.WebGLRenderTarget(width, height, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false
  });

const createQuadGeometry = () => new THREE.PlaneGeometry(1, 1);

const createRibbonGeometry = () => {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array((WIND_LINE_SEGMENTS + 1) * 2 * 3);
  const indices: number[] = [];
  for (let i = 0; i <= WIND_LINE_SEGMENTS; i++) {
    const t = i / WIND_LINE_SEGMENTS;
    positions.set([t, -1, 0, t, 1, 0], i * 6);
    if (i < WIND_LINE_SEGMENTS) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
};

const createInstancedGeometry = (base: THREE.BufferGeometry, maxCount: number, seed: number, salt: number) => {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = base.index;
  geometry.setAttribute('position', base.getAttribute('position'));
  if (base.getAttribute('uv')) geometry.setAttribute('uv', base.getAttribute('uv'));
  const seeds = new Float32Array(maxCount);
  for (let i = 0; i < maxCount; i++) {
    seeds[i] = hash32((seed ^ Math.imul(i + 1, GOLDEN) ^ salt) | 0) / 4294967296;
  }
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  geometry.instanceCount = 0;
  return geometry;
};

const specKey = (spec: ComposedParticleLayer, label: string, count: number) =>
  `${label}|${spec.shape}|${spec.blend}|${count}|${spec.depthLayers}|${isStretchedShape(spec) ? 1 : 0}`;

export const createAirRenderer = (renderer: THREE.WebGLRenderer, controller: AtmosphereController): AirRenderer => {
  const shared = createAirSharedUniforms(controller);
  const airScene = new THREE.Scene();
  const airCamera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  const densityScene = new THREE.Scene();
  const densityCamera = new THREE.Camera();
  const quadGeometry = createQuadGeometry();
  const ribbonGeometry = createRibbonGeometry();
  const densityGeometry = createQuadGeometry();
  const emptyDensity = new THREE.DataTexture(new Uint8Array(4), EMPTY_DENSITY_SIZE, EMPTY_DENSITY_SIZE);
  emptyDensity.needsUpdate = true;

  let airTarget = createTarget(64, 64);
  let densityTarget = createTarget(32, 32);
  let entries: AirEntry[] = [];
  let retired: AirEntry[] = [];
  let densityEntry: AirEntry | null = null;
  let retiredDensity: AirEntry | null = null;
  let densityShown = false;
  let disposed = false;
  let sizeKey = '';
  let tier: ComposedAtmosphere['tier'] = 'high';
  let hasContent = false;
  let currentSeed = 0;
  let composite: THREE.ShaderMaterial | null = null;
  let compositeLinked = false;
  let hasEffects = false;
  let airCleared = false;
  let maxOcclusion = 0.85;
  const clearColor = new THREE.Color();
  const bufferSize = new THREE.Vector2();

  const releaseEntry = (entry: AirEntry) => {
    entry.disposed = true;
    entry.scene.remove(entry.mesh);
    entry.material.dispose();
    entry.geometry?.dispose();
  };

  const flushRetired = () => {
    if (entries.every((entry) => entry.ready || entry.failed)) {
      retired.forEach(releaseEntry);
      retired = [];
    }
    if (retiredDensity && (!densityEntry || densityEntry.ready || densityEntry.failed)) {
      releaseEntry(retiredDensity);
      retiredDensity = null;
    }
  };

  const updateVisibility = (entry: AirEntry) => {
    const instanced = entry.geometry as THREE.InstancedBufferGeometry | null;
    entry.mesh.visible = entry.ready && (instanced === null || instanced.instanceCount > 0);
    entry.material.visible = true;
  };

  const compileEntry = (entry: AirEntry) => {
    const camera = entry.kind === 'density' ? densityCamera : airCamera;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(entry.target);
    const compiled = renderer.compileAsync(entry.mesh, camera, entry.scene);
    renderer.setRenderTarget(previous);
    compiled
      .then(() => programLinked(renderer, entry.material))
      .catch((error) => {
        console.error('[atmosphere] compiling an air program failed', error);
        return false;
      })
      .then((linked) => {
        if (entry.disposed || disposed) return;
        if (linked === false) {
          entry.failed = true;
          console.error('[atmosphere] an air shader failed to link; the population stays hidden');
        } else {
          // null: the program was not built yet; it compiles on the first draw instead of staying hidden forever
          entry.ready = true;
          updateVisibility(entry);
        }
        flushRetired();
      });
  };

  const addEntry = (
    kind: EntryKind,
    key: string,
    mesh: THREE.Mesh,
    material: THREE.ShaderMaterial,
    geometry: THREE.BufferGeometry | null,
    scene: THREE.Scene,
    target: THREE.WebGLRenderTarget
  ) => {
    mesh.frustumCulled = false;
    scene.add(mesh);
    const entry: AirEntry = {
      key,
      kind,
      mesh,
      material,
      geometry,
      scene,
      target,
      ready: false,
      failed: false,
      disposed: false
    };
    compileEntry(entry);
    return entry;
  };

  const createParticleEntry = (spec: ComposedParticleLayer, key: string, salt: number, pop: boolean) => {
    const count = pop ? Math.min(MAX_POPS, Math.max(1, Math.ceil(spec.maxCount * POP_RATIO))) : spec.maxCount;
    const geometry = createInstancedGeometry(quadGeometry, count, currentSeed, salt);
    const material = createParticleMaterial(spec, shared, pop);
    return addEntry(
      pop ? 'pop' : 'particles',
      key,
      new THREE.Mesh(geometry, material),
      material,
      geometry,
      airScene,
      airTarget
    );
  };

  const createWindLineEntry = (spec: ComposedParticleLayer, key: string, salt: number) => {
    const count = Math.min(MAX_WIND_LINES, spec.maxCount);
    const geometry = createInstancedGeometry(ribbonGeometry, count, currentSeed, salt);
    const material = createWindLineMaterial(spec, shared);
    return addEntry('windLine', key, new THREE.Mesh(geometry, material), material, geometry, airScene, airTarget);
  };

  const writeEntry = (entry: AirEntry, spec: ComposedParticleLayer, order: number) => {
    const geometry = entry.geometry as THREE.InstancedBufferGeometry;
    const capacity = (geometry.getAttribute('aSeed') as THREE.BufferAttribute).count;
    let count = Math.min(capacity, spec.activeCount);
    if (entry.kind === 'windLine') writeWindLineUniforms(entry.material, spec);
    else {
      writeParticleUniforms(entry.material, spec, entry.kind === 'pop');
      if (entry.kind === 'pop') count = Math.min(capacity, Math.round(spec.activeCount * POP_RATIO));
    }
    geometry.instanceCount = count;
    entry.mesh.renderOrder = order;
    updateVisibility(entry);
  };

  const syncParticles = (composed: ComposedAtmosphere) => {
    const available = [...entries];
    const next: AirEntry[] = [];
    const specs: { spec: ComposedParticleLayer; entry: AirEntry }[] = [];
    const perSlot = new Map<string, number>();
    let order = 0;
    for (const spec of composed.particles) {
      if (spec.overTokens === false) continue;
      const index = perSlot.get(spec.slot) ?? 0;
      perSlot.set(spec.slot, index + 1);
      const label = `${spec.slot}${index}`;
      const salt = hash32(label.length * 31 + label.charCodeAt(0) * 7 + index);
      const wantsWindLine = isWindLine(spec);
      const kinds: { kind: EntryKind; key: string }[] = [
        wantsWindLine
          ? { kind: 'windLine', key: specKey(spec, `w:${label}`, Math.min(MAX_WIND_LINES, spec.maxCount)) }
          : { kind: 'particles', key: specKey(spec, `p:${label}`, spec.maxCount) }
      ];
      if (spec.shape === 'hail') kinds.push({ kind: 'pop', key: specKey(spec, `pop:${label}`, spec.maxCount) });
      for (const { kind, key } of kinds) {
        const foundIndex = available.findIndex((entry) => entry.key === key);
        let entry: AirEntry;
        if (foundIndex >= 0) entry = available.splice(foundIndex, 1)[0];
        else if (kind === 'windLine') entry = createWindLineEntry(spec, key, salt);
        else entry = createParticleEntry(spec, key, salt ^ (kind === 'pop' ? 0x5bd1e995 : 0), kind === 'pop');
        next.push(entry);
        specs.push({ spec, entry });
      }
    }
    available.forEach((entry) => {
      if (entry.ready) retired.push(entry);
      else releaseEntry(entry);
    });
    entries = next;
    specs.forEach(({ spec, entry }) => writeEntry(entry, spec, order++));
    flushRetired();
  };

  const syncDensity = (composed: ComposedAtmosphere) => {
    const density = composed.density;
    const share = density ? density.overTokens : 0;
    if (!density || share <= 0) {
      if (densityEntry) {
        if (densityEntry.ready) retiredDensity = densityEntry;
        else releaseEntry(densityEntry);
        densityEntry = null;
      }
      densityShown = false;
      return;
    }
    const key = densityKey(density);
    if (!densityEntry || densityEntry.key !== key) {
      const old = densityEntry;
      const material = createDensityMaterial(density, shared);
      densityEntry = addEntry(
        'density',
        key,
        new THREE.Mesh(densityGeometry, material),
        material,
        null,
        densityScene,
        densityTarget
      );
      if (old) {
        if (old.ready) {
          if (retiredDensity) releaseEntry(retiredDensity);
          retiredDensity = old;
        } else releaseEntry(old);
      }
    }
    writeDensityUniforms(densityEntry.material, density);
    densityShown = true;
  };

  const resizeTargets = (width: number, height: number, mapWidth: number, mapHeight: number) => {
    const knobs = PERFORMANCE_TIER_SETTINGS[tier];
    const densityWidth = Math.max(8, Math.round(width * knobs.atmoDensityScale));
    const densityHeight = Math.max(8, Math.round(height * knobs.atmoDensityScale));
    const key = `${width}x${height}|${densityWidth}x${densityHeight}`;
    airCamera.right = mapWidth / mapHeight;
    airCamera.updateProjectionMatrix();
    shared.uAspect.value = mapWidth / mapHeight;
    shared.uRtHeight.value = height;
    if (key === sizeKey) return;
    sizeKey = key;
    airTarget.setSize(width, height);
    densityTarget.setSize(densityWidth, densityHeight);
  };

  const resize: AirRenderer['resize'] = (nextTier, mapSize, screenScale) => {
    if (disposed) return;
    tier = nextTier;
    renderer.getDrawingBufferSize(bufferSize);
    const size = airTargetSize({
      mapWidth: mapSize.width,
      mapHeight: mapSize.height,
      screenScale,
      pixelRatio: renderer.getPixelRatio(),
      bufferWidth: bufferSize.x,
      bufferHeight: bufferSize.y,
      resolutionScale: PERFORMANCE_TIER_SETTINGS[tier].weatherResolutionScale
    });
    resizeTargets(Math.min(size.width, size.height * MAX_ASPECT_EXTRA), size.height, mapSize.width, mapSize.height);
  };

  const sync: AirRenderer['sync'] = (composed) => {
    if (disposed) return;
    currentSeed = composed.seed;
    maxOcclusion = composed.density?.maxOcclusion ?? 0.85;
    const features = compositeFeatures(composed);
    hasEffects = features.shafts || features.aurora || features.rim;
    shared.uMotion.value = composed.motionScale;
    syncParticles(composed);
    syncDensity(composed);
  };

  const clearTargets = () => {
    const previousTarget = renderer.getRenderTarget();
    const previousAlpha = renderer.getClearAlpha();
    renderer.getClearColor(clearColor);
    renderer.setClearColor(0x000000, 0);
    [airTarget, densityTarget].forEach((target) => {
      renderer.setRenderTarget(target);
      renderer.clear();
    });
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(clearColor, previousAlpha);
  };

  const render = () => {
    if (disposed) return;
    const backend = controller.backend;
    shared.uFieldMix.value = backend === 'wasm' || backend === 'ts' ? 1 : 0;

    const drawDensity = densityShown && densityEntry?.ready === true;
    const drawAir = airScene.children.some((child) => child.visible);
    hasContent = drawDensity || drawAir || hasEffects;
    if (composite) {
      composite.visible = compositeLinked && hasContent;
      composite.uniforms.uDensity.value = drawDensity ? densityTarget.texture : emptyDensity;
      composite.uniforms.uMaxOcclusion.value = maxOcclusion;
    }
    if (!hasContent) return;
    if (!drawDensity && !drawAir) {
      if (!airCleared) clearTargets();
      airCleared = true;
      return;
    }
    airCleared = false;

    const previousTarget = renderer.getRenderTarget();
    const previousAlpha = renderer.getClearAlpha();
    renderer.getClearColor(clearColor);
    renderer.setClearColor(0x000000, 0);

    if (drawDensity) {
      renderer.setRenderTarget(densityTarget);
      renderer.clear();
      renderer.render(densityScene, densityCamera);
    }
    renderer.setRenderTarget(airTarget);
    renderer.clear();
    if (drawAir) renderer.render(airScene, airCamera);

    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(clearColor, previousAlpha);
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    [...entries, ...retired, densityEntry, retiredDensity].forEach((entry) => entry && releaseEntry(entry));
    entries = [];
    retired = [];
    airTarget.dispose();
    densityTarget.dispose();
    quadGeometry.dispose();
    ribbonGeometry.dispose();
    densityGeometry.dispose();
    emptyDensity.dispose();
  };

  return {
    airTexture: airTarget.texture,
    densityTexture: densityTarget.texture,
    get hasContent() {
      return hasContent;
    },
    createComposite: (features) => createCompositeMaterial(airTarget.texture, densityTarget.texture, shared, features),
    bindComposite: (material) => {
      composite = material;
    },
    setCompositeLinked: (linked) => {
      compositeLinked = linked;
    },
    sync,
    resize,
    render,
    dispose
  };
};
