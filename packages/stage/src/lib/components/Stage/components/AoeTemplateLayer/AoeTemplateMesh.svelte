<script lang="ts">
  import * as THREE from 'three';
  import { T, useThrelte } from '@threlte/core';
  import { getContext, onDestroy, untrack } from 'svelte';
  import type { AoeEffect, AoeTemplate } from './types';
  import type { PerformanceTier } from '../Stage/types';
  import { SceneLayer, SceneLayerOrder } from '../Scene/types';
  import { mapClippingPlaneStore } from '../../helpers/clippingPlaneStore.svelte';
  import { getTemplateLocalBounds, templateSeed } from '../../helpers/aoeTemplates';
  import {
    aoePlaneGeometry,
    compileAoeProgram,
    createAoeTemplateMaterial,
    isAoeProgramFailed,
    isAoeProgramReady,
    setAoeTemplateEffect,
    writeAoeClippingPlanes,
    writeAoeTemplateUniforms
  } from './AoeTemplateMaterial';

  interface Props {
    template: AoeTemplate;
    /** Layer px per foot */
    ftToPx: number;
    sharedTime: { value: number };
    isDraft?: boolean;
    performanceTier: PerformanceTier;
  }

  const { template, ftToPx, sharedTime, isDraft = false, performanceTier }: Props = $props();

  const { renderer, camera, scene } = useThrelte();
  const stage = getContext<{ mainPassUsesComposer: boolean }>('stage');

  const material = createAoeTemplateMaterial(
    untrack(() => template.effect),
    untrack(() => sharedTime),
    mapClippingPlaneStore.value
  );

  const posX = $derived(template.position.x);
  const posY = $derived(template.position.y);
  const angleRad = $derived((template.angle * Math.PI) / 180);
  const templateEffect = $derived(template.effect);
  const shape = $derived(template.shape);
  const size = $derived(template.size);
  const width = $derived(template.width);
  const color = $derived(template.color);
  const opacity = $derived(template.opacity);
  const seed = $derived(templateSeed(template.id));
  const bounds = $derived(getTemplateLocalBounds(template));
  const quadCenterX = $derived((bounds.minX + bounds.maxX) / 2);
  const quadCenterY = $derived((bounds.minY + bounds.maxY) / 2);
  const quadWidth = $derived(bounds.maxX - bounds.minX);
  const quadHeight = $derived(bounds.maxY - bounds.minY);

  // Advances the material's effect define and gates visibility on its program
  // being linked. The define is only touched when the effect changes.
  let gateRun = 0;
  const revealWhenLinked = (run: number, effect: AoeEffect, rendersToTarget: boolean) => {
    compileAoeProgram(renderer, camera.current, scene, material, effect, rendersToTarget).then((linked) => {
      if (run !== gateRun) return;
      if (linked) material.visible = true;
      // A shared compile can end without a verdict when the material that started it was disposed
      else if (!isAoeProgramFailed(effect, rendersToTarget)) revealWhenLinked(run, effect, rendersToTarget);
    });
  };

  $effect(() => {
    const run = ++gateRun;
    setAoeTemplateEffect(material, templateEffect);
    const rendersToTarget = stage.mainPassUsesComposer;
    material.visible = isAoeProgramReady(templateEffect, rendersToTarget);
    if (!material.visible) revealWhenLinked(run, templateEffect, rendersToTarget);
  });

  $effect(() => {
    writeAoeTemplateUniforms(material, {
      seed,
      opacity,
      size,
      width,
      shape,
      color,
      performanceTier,
      quadSize: { x: quadWidth, y: quadHeight },
      quadCenter: { x: quadCenterX, y: quadCenterY },
      isDraft
    });
  });

  $effect(() => {
    writeAoeClippingPlanes(material, mapClippingPlaneStore.value);
  });

  onDestroy(() => {
    gateRun++;
    material.dispose();
  });
</script>

<T.Group position={[posX, posY, 0]} rotation={[0, 0, angleRad]}>
  <T.Mesh
    geometry={aoePlaneGeometry}
    position={[quadCenterX * ftToPx, quadCenterY * ftToPx, 0]}
    scale={[quadWidth * ftToPx, quadHeight * ftToPx, 1]}
    renderOrder={SceneLayerOrder.AoeTemplate}
    layers={[SceneLayer.Main]}
  >
    <T.ShaderMaterial is={material} attach="material" />
  </T.Mesh>
</T.Group>
