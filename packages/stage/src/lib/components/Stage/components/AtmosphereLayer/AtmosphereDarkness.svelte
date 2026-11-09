<script lang="ts">
  import * as THREE from 'three';
  import { T, useThrelte } from '@threlte/core';
  import { getContext, onDestroy, onMount, untrack } from 'svelte';
  import { SceneLayer, SceneLayerOrder } from '../Scene/types';
  import { getGroundShared } from './ground/groundShared';
  import { darknessFragmentShader, darknessVertexShader } from './ground/darknessShader';
  import { pickLightingUniforms } from './ground/lightingUniforms';
  import { compileShaderMaterial } from './ground/shaderCompile';
  import type { AtmosphereSubLayerProps } from './types';

  /**
   * Multiplies everything under it (map, ground fog, tokens) by the token lighting, so the map material,
   * which divides by the same value, ends at the full scene lighting while tokens keep only
   * `tokenDarkness` of it. Placed lights cut through. Overlay layers are never darkened.
   */
  const { mapSize, controller: controllerProp }: AtmosphereSubLayerProps = $props();
  const controller = untrack(() => controllerProp);

  const { renderer, scene, camera } = useThrelte();
  const stage = getContext<{ mainPassUsesComposer: boolean }>('stage');
  const handshake = getGroundShared(controller).quad;

  const material = new THREE.ShaderMaterial({
    uniforms: pickLightingUniforms(controller.uniforms),
    vertexShader: darknessVertexShader,
    fragmentShader: darknessFragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.ZeroFactor,
    blendDst: THREE.SrcColorFactor
  });
  const geometry = new THREE.PlaneGeometry();
  const probeTarget = new THREE.WebGLRenderTarget(1, 1);
  let ready = $state(false);
  let destroyed = false;

  onMount(() => {
    compileShaderMaterial(
      renderer,
      scene,
      camera.current,
      material,
      geometry,
      probeTarget,
      stage.mainPassUsesComposer
    ).then(() => {
      if (destroyed) return;
      ready = true;
      handshake.value = 1;
    });
  });

  onDestroy(() => {
    destroyed = true;
    handshake.value = 0;
    material.dispose();
    geometry.dispose();
    probeTarget.dispose();
  });
</script>

<T.Mesh
  name="atmosphereDarkness"
  layers={[SceneLayer.Main]}
  renderOrder={SceneLayerOrder.AtmosphereDarkness}
  visible={ready}
  frustumCulled={false}
  scale={[mapSize.width, mapSize.height, 1]}
>
  <T.ShaderMaterial is={material} />
  <T.PlaneGeometry is={geometry} />
</T.Mesh>
