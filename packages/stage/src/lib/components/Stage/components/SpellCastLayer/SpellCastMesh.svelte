<script lang="ts">
  import * as THREE from 'three';
  import { T, useTask, useThrelte } from '@threlte/core';
  import { getContext, onDestroy, untrack } from 'svelte';
  import type { SpellCast } from './types';
  import type { PerformanceTier } from '../Stage/types';
  import { SceneLayer, SceneLayerOrder } from '../Scene/types';
  import { mapClippingPlaneStore } from '../../helpers/clippingPlaneStore.svelte';
  import { templateSeed } from '../../helpers/aoeTemplates';
  import { getSpellCastBounds, spellCastArea, spellCastProgress } from '../../helpers/spellCasts';
  import type { FramePacer } from '../../helpers/framePacing';
  import {
    compileSpellProgram,
    isSpellProgramFailed,
    isSpellProgramReady,
    spellCastPlaneGeometry,
    writeSpellCastUniforms,
    writeSpellClippingPlanes,
    type SpellMaterialPool
  } from './SpellCastMaterial';

  interface Props {
    cast: SpellCast;
    /** Layer px per foot */
    ftToPx: number;
    pool: SpellMaterialPool;
    performanceTier: PerformanceTier;
  }

  const { cast, ftToPx, pool, performanceTier }: Props = $props();

  const { renderer, camera, scene } = useThrelte();
  const stage = getContext<{ mainPassUsesComposer: boolean }>('stage');
  const framePacer = getContext<FramePacer | undefined>('framePacer');

  const fx = untrack(() => cast.fx);
  const material = pool.acquire(fx);
  let ready = false;
  // The timeline starts when the program is linked, never before; a cast that links at once keeps its own start
  let startedAt = untrack(() => cast.startedAt);
  let gateRun = 0;
  let mesh = $state.raw<THREE.Mesh>();

  const bounds = $derived(getSpellCastBounds(cast, ftToPx));
  const area = $derived(spellCastArea(cast));

  const revealWhenLinked = (run: number, rendersToTarget: boolean) => {
    compileSpellProgram(renderer, camera.current, scene, material, fx, rendersToTarget).then((linked) => {
      if (run !== gateRun) return;
      if (linked) {
        startedAt = Math.max(startedAt, performance.now());
        ready = true;
      } else if (!isSpellProgramFailed(fx, rendersToTarget)) revealWhenLinked(run, rendersToTarget);
    });
  };

  $effect(() => {
    const run = ++gateRun;
    const rendersToTarget = stage.mainPassUsesComposer;
    ready = isSpellProgramReady(fx, rendersToTarget);
    if (!ready) revealWhenLinked(run, rendersToTarget);
  });

  $effect(() => {
    writeSpellCastUniforms(material, {
      seed: templateSeed(cast.id),
      variant: cast.variant,
      projectile: cast.projectile ?? false,
      performanceTier,
      shape: area.shape,
      size: area.size,
      width: area.width ?? 5,
      angle: (area.angle * Math.PI) / 180,
      palette: cast.palette,
      origin: { x: (cast.origin.x - cast.target.x) / ftToPx, y: (cast.origin.y - cast.target.y) / ftToPx },
      quadSize: { x: bounds.width, y: bounds.height },
      quadCenter: { x: bounds.centerX, y: bounds.centerY }
    });
  });

  $effect(() => {
    writeSpellClippingPlanes(material, mapClippingPlaneStore.value);
  });

  useTask(() => {
    const now = performance.now();
    const progress = ready ? spellCastProgress({ startedAt, durationMs: cast.durationMs }, now, performanceTier) : 0;
    material.uniforms.uProgress.value = progress;
    material.visible = ready && progress < 1;
    const waitingForProgram = !ready && !isSpellProgramFailed(fx, stage.mainPassUsesComposer);
    if (waitingForProgram || material.visible) framePacer?.markActive();
  });

  onDestroy(() => {
    gateRun++;
    pool.release(fx, material);
  });
</script>

<T.Mesh
  bind:ref={mesh}
  geometry={spellCastPlaneGeometry}
  position={[cast.target.x + bounds.centerX * ftToPx, cast.target.y + bounds.centerY * ftToPx, 0]}
  scale={[bounds.width * ftToPx, bounds.height * ftToPx, 1]}
  renderOrder={SceneLayerOrder.SpellCast}
  layers={[SceneLayer.Main]}
>
  <T.ShaderMaterial is={material} attach="material" />
</T.Mesh>
