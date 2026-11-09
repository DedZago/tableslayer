<script lang="ts">
  import * as THREE from 'three';
  import { T, useThrelte } from '@threlte/core';
  import { getContext, onDestroy, untrack } from 'svelte';
  import { SceneLayer, SceneLayerOrder } from '../Scene/types';
  import {
    ambienceVertexShader,
    buildAmbienceFragmentShader,
    getAmbienceFeatures,
    getAmbienceSignature
  } from './ground/ambienceShader';
  import { getGroundShared } from './ground/groundShared';
  import { compileShaderMaterial } from './ground/shaderCompile';
  import type { AtmosphereSubLayerProps } from './types';

  /**
   * Under-token ground fog, smoke plumes and mist: flow-map advected fbm driven by the wind field, drawn
   * premultiplied at SceneLayerOrder.AmbienceGround. A new feature set links on a fresh material first and
   * replaces the visible one only when ready.
   */
  const { composed, mapSize, controller: controllerProp }: AtmosphereSubLayerProps = $props();
  const controller = untrack(() => controllerProp);

  const { renderer, scene, camera } = useThrelte();
  const stage = getContext<{ mainPassUsesComposer: boolean }>('stage');
  const shared = controller.uniforms;

  const uniforms = {
    uAtmoTime: shared.uAtmoTime,
    uWindDir: shared.uWindDir,
    uWindStrength: shared.uWindStrength,
    uField: shared.uField,
    uFieldPrev: shared.uFieldPrev,
    uFieldBlend: shared.uFieldBlend,
    uMapSize: shared.uMapSize,
    uGroundCell: getGroundShared(controller).cell,
    uTremors: shared.uTremors,
    uPulse: shared.uPulse,
    uFogColor: { value: new THREE.Color() },
    uFogColorB: { value: new THREE.Color() },
    uFogDensity: { value: 0 },
    uFogPockets: { value: 0 },
    uFogEdge: { value: 0 },
    uShadowColor: { value: new THREE.Color() },
    uShadowStrength: { value: 0 },
    uDensityColorA: { value: new THREE.Color() },
    uDensityColorB: { value: new THREE.Color() },
    uDensityScale: { value: 2 },
    uDensityCoverage: { value: 0 },
    uDensityUnder: { value: 0 },
    uDensitySpeed: { value: 1 }
  };

  const geometry = new THREE.PlaneGeometry();
  const probeTarget = new THREE.WebGLRenderTarget(1, 1);
  let material = $state.raw<THREE.ShaderMaterial | null>(null);
  // Linked materials stay alive by signature so returning to an earlier effect never links again
  const materialCache = new Map<string, THREE.ShaderMaterial>();
  let generation = 0;
  let destroyed = false;

  const features = $derived(getAmbienceFeatures(composed));
  const signature = $derived(getAmbienceSignature(features));

  const createMaterial = (next: ReturnType<typeof getAmbienceFeatures>) =>
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: ambienceVertexShader,
      fragmentShader: buildAmbienceFragmentShader(next),
      transparent: true,
      premultipliedAlpha: true,
      depthTest: false,
      depthWrite: false
    });

  $effect(() => {
    const nextSignature = signature;
    const nextFeatures = untrack(() => features);
    const rendersToTarget = stage.mainPassUsesComposer;
    const current = ++generation;
    if (!nextSignature) {
      material = null;
      return;
    }
    const cached = materialCache.get(nextSignature);
    if (cached) {
      material = cached;
      return;
    }
    const candidate = createMaterial(nextFeatures);
    compileShaderMaterial(renderer, scene, camera.current, candidate, geometry, probeTarget, rendersToTarget).then(
      () => {
        if (destroyed || current !== generation) {
          candidate.dispose();
          return;
        }
        materialCache.set(nextSignature, candidate);
        material = candidate;
      }
    );
  });

  $effect(() => {
    const { groundFog } = composed.ground;
    const { density } = composed;
    if (groundFog) {
      uniforms.uFogColor.value.setRGB(...groundFog.color, THREE.SRGBColorSpace);
      uniforms.uFogColorB.value.setRGB(...groundFog.colorB, THREE.SRGBColorSpace);
      uniforms.uFogDensity.value = groundFog.density;
      uniforms.uFogPockets.value = groundFog.pockets;
      uniforms.uFogEdge.value = groundFog.edge;
    } else {
      uniforms.uFogDensity.value = 0;
    }
    uniforms.uShadowColor.value.setRGB(...composed.ground.shadowColor, THREE.SRGBColorSpace);
    uniforms.uShadowStrength.value = composed.ground.shadows ? composed.ground.shadowStrength : 0;
    if (density) {
      uniforms.uDensityColorA.value.set(density.colorA);
      uniforms.uDensityColorB.value.set(density.colorB);
      uniforms.uDensityScale.value = density.scale;
      uniforms.uDensityCoverage.value = density.coverage;
      uniforms.uDensityUnder.value = 1 - density.overTokens;
      uniforms.uDensitySpeed.value = density.speed;
    } else {
      uniforms.uDensityUnder.value = 0;
    }
  });

  onDestroy(() => {
    destroyed = true;
    materialCache.forEach((cached) => cached.dispose());
    materialCache.clear();
    geometry.dispose();
    probeTarget.dispose();
  });
</script>

{#if material}
  <T.Mesh
    name="ambienceGround"
    layers={[SceneLayer.Main]}
    renderOrder={SceneLayerOrder.AmbienceGround}
    frustumCulled={false}
    scale={[mapSize.width, mapSize.height, 1]}
  >
    <T.ShaderMaterial is={material} />
    <T.PlaneGeometry is={geometry} />
  </T.Mesh>
{/if}
