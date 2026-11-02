<script lang="ts">
  import { T, useThrelte } from '@threlte/core';
  import { getContext, onDestroy, untrack } from 'svelte';
  import type { PerformanceTier } from '../Stage/types';
  import { SceneLayer, SceneLayerOrder } from '../Scene/types';
  import type { TokenEffectKind } from '../../helpers/spells';
  import { isTokenFxOverMarkers, placedEffectsSignature, type PlacedTokenEffect } from '../../helpers/tokenEffects';
  import {
    compileTokenProgram,
    createTokenEffectMesh,
    isTokenProgramFailed,
    isTokenProgramReady,
    writeTokenEffectInstances,
    writeTokenPerformanceTier,
    type TokenMaterialPool
  } from './TokenEffectMaterial';

  interface Props {
    fx: TokenEffectKind;
    items: readonly PlacedTokenEffect[];
    pool: TokenMaterialPool;
    /** Epoch ms the layer clock started at */
    epochMs: number;
    reducedMotion: boolean;
  }

  const { fx, items, pool, epochMs, reducedMotion }: Props = $props();

  const { renderer, camera, scene } = useThrelte();
  const stage = getContext<{ mainPassUsesComposer: boolean; performanceTier: PerformanceTier }>('stage');

  const material = untrack(() => pool.get(fx));
  const instances = createTokenEffectMesh(material);
  const { mesh } = instances;
  mesh.layers.set(SceneLayer.Main);
  mesh.renderOrder = isTokenFxOverMarkers(untrack(() => fx))
    ? SceneLayerOrder.TokenEffectOver
    : SceneLayerOrder.TokenEffectUnder;

  // The mesh stays hidden until its program is linked; a link that ends without a verdict is retried
  let gateRun = 0;
  const revealWhenLinked = (run: number, rendersToTarget: boolean) => {
    compileTokenProgram(renderer, camera.current, scene, material, fx, rendersToTarget).then((linked) => {
      if (run !== gateRun) return;
      if (linked) material.visible = true;
      else if (!isTokenProgramFailed(fx, rendersToTarget)) revealWhenLinked(run, rendersToTarget);
    });
  };

  $effect(() => {
    const run = ++gateRun;
    const rendersToTarget = stage.mainPassUsesComposer;
    material.visible = isTokenProgramReady(fx, rendersToTarget);
    if (!material.visible) revealWhenLinked(run, rendersToTarget);
  });

  $effect(() => {
    writeTokenPerformanceTier(material, stage.performanceTier);
  });

  // Keyed on what the buffers hold, so a prop rebuild that changes no effect rewrites nothing
  const signature = $derived(`${placedEffectsSignature(items)}|${reducedMotion}`);

  $effect(() => {
    void signature;
    untrack(() => {
      const nowMs = Date.now();
      writeTokenEffectInstances(instances, items, { clockNow: (nowMs - epochMs) / 1000, nowMs, reducedMotion });
    });
  });

  onDestroy(() => {
    gateRun++;
    mesh.dispose();
    instances.geometry.dispose();
  });
</script>

<T is={mesh} />
