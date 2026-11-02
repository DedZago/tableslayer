<script lang="ts">
  import { useTask, useThrelte } from '@threlte/core';
  import { getContext, onDestroy } from 'svelte';
  import type { CameraShake, SpellCast } from './types';
  import type { DisplayProps, PerformanceTier } from '../Stage/types';
  import type { GridLayerProps } from '../GridLayer/types';
  import { mapClippingPlaneStore } from '../../helpers/clippingPlaneStore.svelte';
  import { getGridCellSize } from '../../helpers/grid';
  import { MAX_CONCURRENT_SPELL_CASTS, SPELL_FX_LIST, writeSpellCastShake } from '../../helpers/spellCasts';
  import type { SpellCastFx } from '../../helpers/spells';
  import SpellCastMesh from './SpellCastMesh.svelte';
  import { compileSpellProgram, createSpellMaterialPool } from './SpellCastMaterial';

  interface Props {
    grid: GridLayerProps;
    display: DisplayProps;
  }

  const { grid, display }: Props = $props();

  const { renderer, camera, scene } = useThrelte();
  const stage = getContext<{
    spellCasts: SpellCast[];
    performanceTier: PerformanceTier;
    mainPassUsesComposer: boolean;
  }>('stage');
  const cameraShake = getContext<CameraShake | undefined>('cameraShake');

  const sharedTime = { value: 0 };
  const pool = createSpellMaterialPool(sharedTime, () => mapClippingPlaneStore.value);

  const ftToPx = $derived(getGridCellSize(grid, display) / (grid.worldGridSize || 5));
  const casts = $derived(stage.spellCasts.slice(-MAX_CONCURRENT_SPELL_CASTS));

  useTask(
    (delta) => {
      sharedTime.value += delta;
      if (cameraShake) {
        if (stage.performanceTier === 'high') writeSpellCastShake(casts, performance.now(), cameraShake);
        else {
          cameraShake.x = 0;
          cameraShake.y = 0;
        }
      }
    },
    { running: () => stage.spellCasts.length > 0 }
  );

  $effect(() => {
    if (casts.length > 0 || !cameraShake) return;
    cameraShake.x = 0;
    cameraShake.y = 0;
  });

  /** Links the archetypes' programs ahead of the cast so no program links mid-animation */
  export const prewarm = (fxs: SpellCastFx[] = SPELL_FX_LIST) => {
    new Set(fxs).forEach((fx) => {
      const material = pool.acquire(fx);
      compileSpellProgram(renderer, camera.current, scene, material, fx, stage.mainPassUsesComposer).finally(() =>
        pool.release(fx, material)
      );
    });
  };

  onDestroy(() => pool.dispose());
</script>

{#each casts as cast (cast.id)}
  <SpellCastMesh {cast} {ftToPx} {pool} performanceTier={stage.performanceTier} />
{/each}
