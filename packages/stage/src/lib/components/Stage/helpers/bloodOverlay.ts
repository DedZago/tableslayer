import * as THREE from 'three';
import { MarkerShape } from '../components/MarkerLayer/types';
import bloodDripsShader from '../shaders/BloodDrips.glsl?raw';
import { advanceDrip, createDripState, dripShape, settleDrip, type DripSpec, type DripState } from './bloodDrips';
import { createCanvasTexture } from './tokenRasterCache';

/** Quad size in token units: wide enough for the longest drip plus a falling drop */
export const BLOOD_QUAD_SCALE = 2.2;
const BLOOD_CANVAS_SIZE = 640;
const BLOOD_VARIANTS = 3;

// Token units, canvas axes (y down = screen down). MarkerToken draws its shape at 0.9 of the cell.
const TOKEN_HALF = 0.45;
// Label-only tokens have no outline: drips start just under the label text instead
const LABEL_HALF = 0.16;
const RIM_WIDTH = 0.045;
const OUTLINE_WIDTH = 0.02;
const BLOOD_DARK = '#3b0306';
const BLOOD_DEEP = '#7a0a10';
const BLOOD_BRIGHT = '#c0141c';
const BLOOD_GLOSS = '#ff9696';
const MAX_DRIPS = 6;
const SETTLE_SECONDS = 40;

type OutlinePoint = { x: number; y: number; nx: number; ny: number };

const createRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const polygonOutline = (corners: Array<[number, number]>, samplesPerEdge: number): OutlinePoint[] =>
  corners.flatMap(([ax, ay], index) => {
    const [bx, by] = corners[(index + 1) % corners.length];
    const length = Math.hypot(bx - ax, by - ay);
    const nx = (by - ay) / length;
    const ny = -(bx - ax) / length;
    return Array.from({ length: samplesPerEdge }, (_, step) => {
      const t = step / samplesPerEdge;
      return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, nx, ny };
    });
  });

// Corners run clockwise on screen (y down), so the edge normal (dy, -dx) points outward
const sampleOutline = (shape: MarkerShape, h: number): OutlinePoint[] => {
  switch (shape) {
    case MarkerShape.Square:
      return polygonOutline(
        [
          [-h, -h],
          [h, -h],
          [h, h],
          [-h, h]
        ],
        24
      );
    case MarkerShape.Triangle:
      return polygonOutline(
        [
          [0, -h],
          [h, h],
          [-h, h]
        ],
        32
      );
    default:
      return Array.from({ length: 96 }, (_, step) => {
        const angle = (step / 96) * Math.PI * 2;
        const nx = Math.cos(angle);
        const ny = Math.sin(angle);
        return { x: nx * h, y: ny * h, nx, ny };
      });
  }
};

const outlinePath = (points: OutlinePoint[]) => {
  const path = new Path2D();
  points.forEach(({ x, y }, index) => (index === 0 ? path.moveTo(x, y) : path.lineTo(x, y)));
  path.closePath();
  return path;
};

// Drips start on edges that face down, and run longer the more directly the edge faces down.
// Fewer, bolder drips read cleaner at token size than many thin ones.
const pickDrips = (points: OutlinePoint[], random: () => number): DripSpec[] => {
  const candidates = points.filter((point) => point.ny > 0.45);
  const count = 4 + Math.floor(random() * (MAX_DRIPS - 3));
  const drips: DripSpec[] = [];
  for (let attempt = 0; drips.length < count && attempt < 40; attempt++) {
    const origin = candidates[Math.floor(random() * candidates.length)];
    const width = 0.03 + random() * 0.022;
    // Keep neighbours apart so trails never fuse into one smear
    if (drips.some((drip) => Math.abs(drip.x - origin.x) < (drip.width + width) * 1.3)) continue;
    drips.push({
      x: origin.x + origin.nx * 0.01,
      y: origin.y - 0.01,
      width,
      maxLength: (0.1 + random() * 0.18) * (0.5 + 0.5 * Math.min(1, origin.ny)),
      seed: Math.floor(random() * 0xffffffff)
    });
  }
  return drips;
};

// Uneven blobs along the edge so the rim reads as soaked, not as a clean stroke
const addRimBlobs = (path: Path2D, points: OutlinePoint[], random: () => number) => {
  points.forEach((point, index) => {
    if (index % 2 && random() < 0.5) return;
    const offset = (random() - 0.2) * 0.02;
    const radius = 0.012 + random() * 0.02 * (point.ny > 0 ? 1.4 : 0.8);
    const cx = point.x + point.nx * offset;
    const cy = point.y + point.ny * offset;
    path.moveTo(cx + radius, cy);
    path.arc(cx, cy, radius, 0, Math.PI * 2);
  });
};

const addSplatter = (path: Path2D, points: OutlinePoint[], random: () => number) => {
  const lower = points.filter((point) => point.ny > 0);
  Array.from({ length: 5 }).forEach(() => {
    const point = lower[Math.floor(random() * lower.length)];
    const distance = 0.04 + random() * 0.08;
    const radius = 0.006 + random() * 0.012;
    const cx = point.x + point.nx * distance;
    const cy = point.y + point.ny * distance;
    path.moveTo(cx + radius, cy);
    path.arc(cx, cy, radius, 0, Math.PI * 2);
  });
};

type BloodStyle = { shape: MarkerShape; variant: number; rimWidth: number };

// Shapes without an outline (label-only tokens) bleed from where a circle would be, with no rim
const hasRim = (shape: MarkerShape) => shape !== MarkerShape.None;

// The rim is drawn as one solid silhouette first, so overlapping blobs merge without seams,
// then shaded through source-atop and given a soft dark edge as a drop shadow.
// Drips are not baked: the shader draws them from the returned layout so they can creep.
const drawBlood = (ctx: OffscreenCanvasRenderingContext2D, { shape, variant, rimWidth }: BloodStyle): DripSpec[] => {
  const random = createRandom(0x9e3779b9 ^ (shape * 7919 + variant * 104729));
  const points = sampleOutline(shape, hasRim(shape) ? TOKEN_HALF : LABEL_HALF);
  const drips = pickDrips(points, random);
  const blobs = new Path2D();
  if (hasRim(shape)) addRimBlobs(blobs, points, random);
  addSplatter(blobs, points, random);

  const layer = new OffscreenCanvas(ctx.canvas.width, ctx.canvas.height);
  const layerCtx = layer.getContext('2d')!;
  layerCtx.setTransform(ctx.getTransform());
  layerCtx.lineJoin = 'round';
  layerCtx.fillStyle = BLOOD_BRIGHT;
  layerCtx.strokeStyle = BLOOD_BRIGHT;
  if (hasRim(shape)) {
    layerCtx.lineWidth = rimWidth;
    layerCtx.stroke(outlinePath(points));
  }
  layerCtx.fill(blobs);

  layerCtx.globalCompositeOperation = 'source-atop';
  const gradient = layerCtx.createLinearGradient(0, -TOKEN_HALF, 0, TOKEN_HALF + 0.35);
  gradient.addColorStop(0, BLOOD_DEEP);
  gradient.addColorStop(0.6, BLOOD_BRIGHT);
  gradient.addColorStop(1, BLOOD_DEEP);
  layerCtx.fillStyle = gradient;
  layerCtx.fillRect(-BLOOD_QUAD_SCALE, -BLOOD_QUAD_SCALE, BLOOD_QUAD_SCALE * 2, BLOOD_QUAD_SCALE * 2);

  const pxPerUnit = ctx.getTransform().a;
  ctx.save();
  ctx.resetTransform();
  ctx.shadowColor = BLOOD_DARK;
  ctx.shadowBlur = OUTLINE_WIDTH * pxPerUnit;
  ctx.drawImage(layer, 0, 0);
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
  return drips;
};

export type BloodPattern = {
  texture: THREE.CanvasTexture<OffscreenCanvas>;
  drips: DripSpec[];
};

const bloodPatterns = new Map<string, BloodPattern>();

// Rim widths are bucketed so every stroke width the token style can take shares a few textures
const RIM_WIDTH_STEP = 0.01;
export const bloodRimWidthFor = (strokeWidth: number) =>
  Math.max(RIM_WIDTH, Math.ceil((strokeWidth / 1024 + 0.025) / RIM_WIDTH_STEP) * RIM_WIDTH_STEP);

export const bloodVariantFor = (markerId: string) =>
  [...markerId].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % BLOOD_VARIANTS;

/** Pins mark places, not creatures, so they never bleed */
export const canBleed = (shape: MarkerShape) => shape !== MarkerShape.Pin;

export const getBloodPattern = (style: BloodStyle): BloodPattern => {
  const key = `${style.shape}:${style.variant}:${style.rimWidth.toFixed(3)}`;
  const cached = bloodPatterns.get(key);
  if (cached) return cached;
  const canvas = new OffscreenCanvas(BLOOD_CANVAS_SIZE, BLOOD_CANVAS_SIZE);
  const ctx = canvas.getContext('2d')!;
  const scale = BLOOD_CANVAS_SIZE / BLOOD_QUAD_SCALE;
  ctx.setTransform(scale, 0, 0, scale, BLOOD_CANVAS_SIZE / 2, BLOOD_CANVAS_SIZE / 2);
  const pattern = { drips: drawBlood(ctx, style), texture: createCanvasTexture(canvas) };
  bloodPatterns.set(key, pattern);
  return pattern;
};

const reducedMotion = typeof window === 'undefined' ? null : window.matchMedia('(prefers-reduced-motion: reduce)');

const bloodColors = {
  uBloodDeep: { value: new THREE.Color(BLOOD_DEEP) },
  uBloodBright: { value: new THREE.Color(BLOOD_BRIGHT) },
  uBloodDark: { value: new THREE.Color(BLOOD_DARK) },
  uBloodGloss: { value: new THREE.Color(BLOOD_GLOSS) }
};

const vectorSlots = () => Array.from({ length: MAX_DRIPS }, () => new THREE.Vector4());

/**
 * Per token (so it follows the token's opacity and runs its own drips); every instance shares one
 * compiled program. The simulation advances in onBeforeRender, so it costs nothing while the token
 * is culled or not bloodied, adds no frames of its own, and steps once per drawn frame.
 */
export const createBloodMaterial = () => {
  const dripUniform = { value: vectorSlots() };
  const flowUniform = { value: vectorSlots() };
  const dropUniform = { value: vectorSlots() };
  let specs: DripSpec[] = [];
  let states: DripState[] = [];
  let lastStepAt: number | null = null;

  const writeUniforms = () => {
    specs.forEach((spec, index) => {
      const shape = dripShape(states[index], spec);
      dripUniform.value[index].set(spec.x, spec.y, spec.width, shape.length);
      flowUniform.value[index].set(shape.headRadius, shape.surgePosition, shape.surgeRadius, (spec.seed % 628) / 100);
      dropUniform.value[index].set(shape.dropOffset, shape.dropRadius, shape.dropAlpha, shape.dropStretch);
    });
  };

  const material = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false });
  material.customProgramCacheKey = () => 'blood-drips';
  material.onBeforeRender = () => {
    if (reducedMotion?.matches) return;
    const now = performance.now();
    // Several passes in one frame step once
    if (lastStepAt !== null && now - lastStepAt < 1) return;
    const dt = lastStepAt === null ? 0 : (now - lastStepAt) / 1000;
    lastStepAt = now;
    specs.forEach((spec, index) => advanceDrip(states[index], spec, dt));
    writeUniforms();
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, bloodColors, {
      uBloodDrip: dripUniform,
      uBloodFlow: flowUniform,
      uBloodDrop: dropUniform
    });
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\n#define BLOOD_QUAD_SCALE ${BLOOD_QUAD_SCALE.toFixed(4)}\n${bloodDripsShader}`
      )
      .replace(
        '#include <map_fragment>',
        '#include <map_fragment>\ndiffuseColor = bloodDrips(diffuseColor, vMapUv, opacity);'
      );
  };

  /** Starts the drips over: they run down from the rim again */
  const setPattern = (pattern: BloodPattern) => {
    specs = pattern.drips;
    states = specs.map(createDripState);
    if (reducedMotion?.matches) states.forEach((state, index) => settleDrip(state, specs[index], SETTLE_SECONDS));
    lastStepAt = null;
    dripUniform.value.forEach((slot) => slot.set(0, 0, 0, 0));
    writeUniforms();
    if (material.map !== pattern.texture) {
      material.map = pattern.texture;
      material.needsUpdate = true;
    }
  };
  return { material, setPattern };
};
