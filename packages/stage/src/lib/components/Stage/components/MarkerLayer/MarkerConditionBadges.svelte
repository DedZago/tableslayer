<script lang="ts">
  import * as THREE from 'three';
  import { T } from '@threlte/core';
  import { onDestroy, untrack } from 'svelte';
  import type { MarkerCondition } from './types';
  import { SceneLayer, SceneLayerOrder } from '../Scene/types';
  import { StageMode } from '../Stage/types';
  import { conditionsKey, resolveCondition } from '../../helpers/markerConditions';
  import { createCanvasTexture, tokenQuadGeometry } from '../../helpers/tokenRasterCache';

  interface Props {
    conditions: MarkerCondition[];
    mode: StageMode;
  }

  const { conditions, mode }: Props = $props();

  // Sizes are in token units so the quad always leaves room for the outermost pip
  const CANVAS_SIZE = 512;
  const BADGE_QUAD_SCALE = 1.5;
  const PX_PER_TOKEN = CANVAS_SIZE / BADGE_QUAD_SCALE;
  const PIP_ARC_CENTER_DEG = -90;
  const PIP_ARC_SPAN_DEG = 120;
  const PIP_RING_RADIUS = 0.61 * PX_PER_TOKEN;
  const PIP_RADIUS = 0.1 * PX_PER_TOKEN;
  const PIP_FONT_SIZE = Math.round(0.095 * PX_PER_TOKEN);
  const PIP_STROKE_WIDTH = 0.008 * PX_PER_TOKEN;
  // Drawn on the token itself instead of as a pip
  const OVERLAY_CONDITIONS = ['dead', 'bloodied'];
  const MAX_PIPS = 8;
  const OVERFLOW_PIP_COLOR = '#4b5563';

  const visibleConditions = $derived(mode === StageMode.Player ? conditions.filter((c) => !c.dmOnly) : conditions);
  const key = $derived(conditionsKey(visibleConditions));

  type Pip = { text: string; color: string };

  const toPips = (list: MarkerCondition[]): Pip[] => {
    const pips = list
      .filter((c) => !OVERLAY_CONDITIONS.includes(c.id))
      .map((c) => {
        const { abbr, color } = resolveCondition(c);
        return { text: c.id === 'exhaustion' && c.value ? String(c.value) : abbr, color };
      });
    if (pips.length <= MAX_PIPS) return pips;
    return [...pips.slice(0, MAX_PIPS - 1), { text: `+${pips.length - (MAX_PIPS - 1)}`, color: OVERFLOW_PIP_COLOR }];
  };

  const pipCenter = (index: number, count: number) => {
    const spanDeg = count > 1 ? (PIP_ARC_SPAN_DEG * index) / (count - 1) : PIP_ARC_SPAN_DEG / 2;
    const angle = ((PIP_ARC_CENTER_DEG - PIP_ARC_SPAN_DEG / 2 + spanDeg) * Math.PI) / 180;
    return {
      x: CANVAS_SIZE / 2 + PIP_RING_RADIUS * Math.cos(angle),
      y: CANVAS_SIZE / 2 + PIP_RING_RADIUS * Math.sin(angle)
    };
  };

  const canvas = new OffscreenCanvas(CANVAS_SIZE, CANVAS_SIZE);
  const ctx = canvas.getContext('2d')!;
  const texture = createCanvasTexture(canvas);
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false });

  const drawPip = (pip: Pip, x: number, y: number) => {
    ctx.beginPath();
    ctx.arc(x, y, PIP_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = pip.color;
    ctx.fill();
    ctx.lineWidth = PIP_STROKE_WIDTH;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(pip.text, x, y);
  };

  const drawBadges = (list: MarkerCondition[]) => {
    const pips = toPips(list);
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.font = `bold ${PIP_FONT_SIZE}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    pips.forEach((pip, index) => {
      const { x, y } = pipCenter(index, pips.length);
      drawPip(pip, x, y);
    });
    texture.needsUpdate = true;
  };

  // Redraw only when the visible condition set changes (key), never on conditions identity
  $effect(() => {
    void key;
    drawBadges(untrack(() => visibleConditions));
  });

  onDestroy(() => {
    texture.dispose();
    material.dispose();
  });
</script>

<T.Mesh
  geometry={tokenQuadGeometry}
  scale={[BADGE_QUAD_SCALE, BADGE_QUAD_SCALE, 1]}
  renderOrder={SceneLayerOrder.Marker + 0.5}
  layers={[SceneLayer.Main]}
>
  <T.MeshBasicMaterial is={material} />
</T.Mesh>
