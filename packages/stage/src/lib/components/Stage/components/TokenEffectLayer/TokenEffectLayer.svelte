<script lang="ts">
  import { useTask, useThrelte } from '@threlte/core';
  import { getContext, onDestroy } from 'svelte';
  import type { TokenEffect } from './types';
  import type { Marker } from '../MarkerLayer/types';
  import type { DisplayProps, PerformanceTier, StageMode } from '../Stage/types';
  import type { GridLayerProps } from '../GridLayer/types';
  import { mapClippingPlaneStore } from '../../helpers/clippingPlaneStore.svelte';
  import type { FramePacer } from '../../helpers/framePacing';
  import { getGridCellSize } from '../../helpers/grid';
  import type { TokenEffectKind } from '../../helpers/spells';
  import { groupPlacedByKind, placeTokenEffects, tokenEffectClock } from '../../helpers/tokenEffects';
  import TokenEffectKindMesh from './TokenEffectKindMesh.svelte';
  import {
    compileTokenProgram,
    createTokenMaterialPool,
    writeTokenClippingPlanes,
    writeTokenPerformanceTier
  } from './TokenEffectMaterial';

  interface Props {
    effects: readonly TokenEffect[];
    /** Live token positions: effects follow their token, including mid-drag */
    markers: readonly Marker[];
    mode: StageMode;
    /** False while the marker layer is hidden */
    tokensVisible: boolean;
    grid: GridLayerProps;
    display: DisplayProps;
  }

  const { effects, markers, mode, tokensVisible, grid, display }: Props = $props();

  const { renderer, camera, scene } = useThrelte();
  const stage = getContext<{
    performanceTier: PerformanceTier;
    mainPassUsesComposer: boolean;
    spellHighlight?: { templateIds: string[]; markerIds: string[] };
  }>('stage');
  const framePacer = getContext<FramePacer | undefined>('framePacer');

  const epochMs = Date.now();
  const time = { value: 0 };
  const pool = createTokenMaterialPool(time, () => mapClippingPlaneStore.value);

  let reducedMotion = $state(false);
  $effect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => (reducedMotion = query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  });

  const cellPx = $derived(getGridCellSize(grid, display));
  const ftToPx = $derived(cellPx / (grid.worldGridSize || 5));
  // Keyed on the ids, so a consumer rebuilding the same highlight changes nothing
  const highlightKey = $derived(
    `${stage.spellHighlight?.templateIds.join('|') ?? ''}#${stage.spellHighlight?.markerIds.join('|') ?? ''}`
  );
  const highlight = $derived.by(() => {
    const [templateIds, markerIds] = highlightKey.split('#');
    return {
      templateIds: new Set(templateIds ? templateIds.split('|') : []),
      markerIds: new Set(markerIds ? markerIds.split('|') : [])
    };
  });
  const placed = $derived(placeTokenEffects(effects, markers, { cellPx, ftToPx, mode, tokensVisible, highlight }));
  const hasHighlight = $derived(placed.some((item) => item.highlighted));
  const groups = $derived(groupPlacedByKind(placed));
  const kinds = $derived([...groups.keys()]);

  // Ambient loops never wake the frame pacer: they animate at whatever rate the stage already renders.
  // A focused concentration pulses, so it holds the stage at the ambient rate while it lasts
  useTask(
    () => {
      if (hasHighlight) framePacer?.markAmbient();
      time.value = tokenEffectClock((Date.now() - epochMs) / 1000, stage.performanceTier === 'low', reducedMotion);
    },
    { running: () => placed.length > 0 }
  );

  $effect(() => {
    const planes = mapClippingPlaneStore.value;
    pool.forEach((material) => writeTokenClippingPlanes(material, planes));
  });

  /** Links the kinds' programs ahead of time so an effect never waits on one when it appears */
  export const prewarm = (fxs: TokenEffectKind[]) => {
    new Set(fxs).forEach((fx) => {
      const material = pool.get(fx);
      writeTokenPerformanceTier(material, stage.performanceTier);
      compileTokenProgram(renderer, camera.current, scene, material, fx, stage.mainPassUsesComposer);
    });
  };

  onDestroy(() => pool.dispose());
</script>

{#each kinds as fx (fx)}
  <TokenEffectKindMesh {fx} items={groups.get(fx) ?? []} {pool} {epochMs} {reducedMotion} />
{/each}
