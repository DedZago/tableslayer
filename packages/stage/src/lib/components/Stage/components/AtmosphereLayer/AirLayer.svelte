<script lang="ts">
  import * as THREE from 'three';
  import { T, useThrelte } from '@threlte/core';
  import { getContext, onDestroy, untrack } from 'svelte';
  import { mapClippingPlaneStore } from '../../helpers/clippingPlaneStore.svelte';
  import { SceneLayer, SceneLayerOrder, type PreRenderRegistry } from '../Scene/types';
  import {
    compositeFeatures,
    compositeKey,
    programLinked,
    writeClippingPlanes,
    writeCompositeUniforms
  } from './air/airMaterials';
  import { createAirRenderer } from './air/airRenderer';
  import type { AtmosphereSubLayerProps } from './types';

  /**
   * Airborne particles and density at SceneLayerOrder.AirWeather (38.5), over tokens and under fog of war.
   * Particles, wind lines, hail pops and the density pass render into offscreen targets from the 'preRender'
   * registry; a map-sized premultiplied quad composites them and adds the map-space lighting effects (shafts,
   * aurora, rim vignette). Programs link through compileAsync before anything becomes visible; a change in the
   * composite features builds a new material and swaps it in once linked.
   */
  const props: AtmosphereSubLayerProps = $props();

  const { renderer, camera, scene } = useThrelte();
  const stage = getContext<{ mainPassUsesComposer: boolean }>('stage');
  const preRender = getContext<PreRenderRegistry | undefined>('preRender');

  const air = untrack(() => createAirRenderer(renderer, props.controller));
  const compositeGeometry = new THREE.PlaneGeometry(1, 1);
  let compositeMaterial = $state.raw<THREE.ShaderMaterial | null>(null);
  let probeTarget: THREE.WebGLRenderTarget | null = null;
  let compileRun = 0;

  const mapWidth = $derived(props.mapSize.width);
  const mapHeight = $derived(props.mapSize.height);
  const rendersToTarget = $derived(stage.mainPassUsesComposer);
  const tier = $derived(props.composed.tier);
  const screenScale = $derived(props.screenScale);
  const compositeSignature = $derived(compositeKey(compositeFeatures(props.composed)));

  $effect(() => {
    const nextTier = tier;
    const width = mapWidth;
    const height = mapHeight;
    const scale = screenScale;
    untrack(() => air.resize(nextTier, { width, height }, scale));
  });

  $effect(() => {
    const next = props.composed;
    untrack(() => {
      air.sync(next);
      if (compositeMaterial) writeCompositeUniforms(compositeMaterial, next.lighting);
    });
  });

  $effect(() => {
    void compositeSignature;
    const toTarget = rendersToTarget;
    const run = ++compileRun;
    untrack(() => {
      const next = air.createComposite(compositeFeatures(props.composed));
      writeCompositeUniforms(next, props.composed.lighting);
      probeTarget ??= new THREE.WebGLRenderTarget(1, 1);
      const previous = renderer.getRenderTarget();
      if (toTarget) renderer.setRenderTarget(probeTarget);
      const compiled = renderer.compileAsync(new THREE.Mesh(compositeGeometry, next), camera.current, scene);
      renderer.setRenderTarget(previous);
      compiled
        .then(() => programLinked(renderer, next))
        .catch((error) => {
          console.error('[atmosphere] compiling the air composite failed', error);
          return false;
        })
        .then((linked) => {
          if (run !== compileRun) {
            next.dispose();
            return;
          }
          if (linked === false) {
            console.error('[atmosphere] the air composite failed to link; the layer keeps its previous composite');
            next.dispose();
            return;
          }
          const old = compositeMaterial;
          writeCompositeUniforms(next, props.composed.lighting);
          writeClippingPlanes(next, mapClippingPlaneStore.value);
          air.bindComposite(next);
          air.setCompositeLinked(true);
          compositeMaterial = next;
          old?.dispose();
        });
    });
  });

  $effect(() => {
    if (compositeMaterial) writeClippingPlanes(compositeMaterial, mapClippingPlaneStore.value);
  });

  $effect(() => {
    if (!preRender) return;
    return preRender.register(air.render);
  });

  onDestroy(() => {
    compileRun++;
    air.dispose();
    compositeMaterial?.dispose();
    compositeGeometry.dispose();
    probeTarget?.dispose();
  });
</script>

{#if compositeMaterial}
  <T.Mesh
    geometry={compositeGeometry}
    scale={[mapWidth, mapHeight, 1]}
    renderOrder={SceneLayerOrder.AirWeather}
    layers={[SceneLayer.Main]}
    frustumCulled={false}
  >
    <T.ShaderMaterial is={compositeMaterial} attach="material" />
  </T.Mesh>
{/if}
