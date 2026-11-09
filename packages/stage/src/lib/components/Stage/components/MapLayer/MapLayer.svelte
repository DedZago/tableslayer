<script lang="ts">
  import * as THREE from 'three';
  import { T, useThrelte } from '@threlte/core';
  import { MapLayerType } from './types';
  import type { Size } from '../../types';
  import FogOfWarLayer from '../FogOfWarLayer/FogOfWarLayer.svelte';
  import type { FogOfWarExports } from '../FogOfWarLayer/types';
  import type { Callbacks, StageProps } from '../Stage/types';
  import { getContext, onDestroy, untrack } from 'svelte';
  import { GridMode } from '../GridLayer/types';
  import type { AtmosphereController } from '../AtmosphereLayer/atmosphereController.svelte';
  import {
    applyGroundValues,
    createGroundUniforms,
    getGroundCellFraction,
    getGroundSignature
  } from '../AtmosphereLayer/ground/groundPatch';
  import { createGroundProgramSwitcher } from '../AtmosphereLayer/ground/groundProgram';
  import { SceneLayer, SceneLayerOrder } from '../Scene/types';
  import FogLayer from '../FogLayer/FogLayer.svelte';
  import { createDataSource, type IMapDataSource } from './dataSources';

  interface Props {
    props: StageProps;
    onMapLoading: () => void;
    onMapLoaded: (mapUrl: string, mapSize: Size) => void;
  }

  const { props, onMapLoading, onMapLoaded }: Props = $props();

  const callbacks = getContext<Callbacks>('callbacks');
  const onMapUpdate = callbacks.onMapUpdate;

  let currentMapUrl: string | null = $state(null);
  let dataSource: IMapDataSource | null = null;
  let mapImageMaterial = new THREE.MeshBasicMaterial();
  let fogOfWarLayer: FogOfWarExports;

  const atmosphere = getContext<AtmosphereController | undefined>('atmosphere');
  const stage = getContext<{ mainPassUsesComposer: boolean }>('stage');
  const { renderer, scene, camera } = useThrelte();
  const groundUniforms = atmosphere ? createGroundUniforms(atmosphere) : null;
  const groundSwitcher =
    atmosphere && groundUniforms
      ? createGroundProgramSwitcher({
          renderer,
          getScene: () => scene,
          getCamera: () => camera.current,
          material: mapImageMaterial,
          uniforms: groundUniforms
        })
      : null;

  // The size of the map image
  let mapSize: Size | null = $state(null);

  // Track if the material needs a full update
  let materialUpdateKey = $state(0);

  $effect(() => {
    if (!props.map.url) {
      currentMapUrl = props.map.url;
      // Dispose of data source when URL is null; detach the texture first so the
      // still-mounted mesh never re-uploads a closed ImageBitmap
      if (mapImageMaterial.map) {
        mapImageMaterial.map = null;
        mapImageMaterial.needsUpdate = true;
      }
      if (dataSource) {
        dataSource.dispose();
        dataSource = null;
      }
      return;
    }

    // Check if the URL is changing (including query params for cache busting)
    // For video files, we need to check the full URL including query params
    const newMapUrlWithoutParams = getUrlWithoutParams(props.map.url);
    const currentMapUrlWithoutParams = getUrlWithoutParams(currentMapUrl);

    // Check if this is a video file
    const isVideo = props.map.url.match(/\.(mp4|webm|mov|avi)/i);

    // For videos, compare full URLs (including query params) to ensure cache busting
    // For images, compare without params to avoid unnecessary reloads
    if (isVideo) {
      if (currentMapUrl === props.map.url) {
        return;
      }
    } else {
      if (currentMapUrlWithoutParams === newMapUrlWithoutParams) {
        return;
      }
    }

    // Update the current URL immediately
    currentMapUrl = props.map.url;

    onMapLoading();

    // Dispose of previous data source
    if (dataSource) {
      dataSource.dispose();
      dataSource = null;
    }

    // Dispose of previous material map
    if (mapImageMaterial.map) {
      mapImageMaterial.map.dispose();
      mapImageMaterial.map = null;
      mapImageMaterial.needsUpdate = true;
    }

    // Create new data source based on file type
    dataSource = createDataSource(props.map.url);

    // Load the new data source
    dataSource
      .load(props.map.url)
      .then(() => {
        const texture = dataSource?.getTexture();
        const size = dataSource?.getSize();

        if (texture && size) {
          mapImageMaterial.map = texture;
          mapImageMaterial.needsUpdate = true;
          mapSize = size;
          // Force material key update to trigger re-render
          materialUpdateKey++;
          onMapLoaded(props.map.url, mapSize);
        }
      })
      .catch((reason) => {
        console.error('Failed to load map:', reason);
      });
  });

  const groundSignature = $derived.by(() => {
    const signature = atmosphere ? getGroundSignature(atmosphere.composed) : '';
    return signature && !stage.mainPassUsesComposer ? `${signature}|out:srgb` : signature;
  });
  const groundRendersToTarget = $derived(groundSignature !== '' && stage.mainPassUsesComposer);
  const groundCellFraction = $derived(
    mapSize
      ? getGroundCellFraction({
          isMapDefined: props.grid.gridMode === GridMode.MapDefined,
          grid: props.grid,
          mapSize,
          display: props.display,
          mapZoom: props.map.zoom
        })
      : 0.05
  );

  $effect(() => {
    const signature = groundSignature;
    const rendersToTarget = groundRendersToTarget;
    void materialUpdateKey;
    untrack(() => groundSwitcher?.request(signature, rendersToTarget));
  });

  $effect(() => {
    if (!atmosphere || !groundUniforms) return;
    const composed = atmosphere.composed;
    untrack(() => applyGroundValues(groundUniforms, composed));
  });

  $effect(() => {
    const cell = groundCellFraction;
    if (groundUniforms) groundUniforms.uGroundCell.value = cell;
  });

  onDestroy(() => groundSwitcher?.dispose());

  function getUrlWithoutParams(url: string | null): string {
    if (!url) return '';
    return url.split('?')[0];
  }

  export function getCompositeMapTexture(): THREE.Texture | null {
    return mapImageMaterial.map;
  }

  export function fill() {
    if (!mapSize) return;

    const imageAspectRatio = mapSize.width / mapSize.height;
    const sceneAspectRatio = props.display.resolution.x / props.display.resolution.y;

    let newZoom: number;
    if (imageAspectRatio > sceneAspectRatio) {
      newZoom = props.display.resolution.y / mapSize.height;
    } else {
      newZoom = props.display.resolution.x / mapSize.width;
    }

    onMapUpdate({ x: 0, y: 0 }, newZoom);
  }

  export function fit() {
    if (!mapSize) return;

    const imageAspectRatio = mapSize.width / mapSize.height;
    const sceneAspectRatio = props.display.resolution.x / props.display.resolution.y;

    let newZoom: number;
    if (imageAspectRatio > sceneAspectRatio) {
      newZoom = props.display.resolution.x / mapSize.width;
    } else {
      newZoom = props.display.resolution.y / mapSize.height;
    }

    onMapUpdate({ x: 0, y: 0 }, newZoom);
  }

  // Export the map size for external components
  export { mapSize };

  // References to the layer doesn't exist until the component is mounted,
  // so we need create these wrapper functions
  export const fogOfWar = {
    clear: () => fogOfWarLayer.clearFog(),
    reset: () => fogOfWarLayer.resetFog(),
    toPng: () => fogOfWarLayer.toPng(),
    toRLE: () => fogOfWarLayer.toRLE(),
    fromRLE: (rleData: Uint8Array, width: number, height: number) => fogOfWarLayer.fromRLE(rleData, width, height),
    isDrawing: () => fogOfWarLayer?.isDrawing() ?? false,
    commitPolygon: () => fogOfWarLayer?.commitPolygon(),
    cancelPolygon: () => fogOfWarLayer?.cancelPolygon(),
    polygonPointCount: () => fogOfWarLayer?.polygonPointCount() ?? 0,
    deleteRoomAtCursor: () => fogOfWarLayer?.deleteRoomAtCursor()
  };
</script>

<!-- Map: offset/rotation/zoom live on the parent mapAnchor node in Scene.svelte;
     this node only scales the unit plane to the map image size -->
<T.Object3D name="mapLayer" scale={[mapSize?.width ?? 0, mapSize?.height ?? 0, 1]}>
  <!-- Map image -->
  {#key materialUpdateKey}
    <T.Mesh name="mapImage" layers={[SceneLayer.Main]} renderOrder={SceneLayerOrder.Map} visible={true}>
      <T.MeshBasicMaterial is={mapImageMaterial} />
      <T.PlaneGeometry />
    </T.Mesh>
  {/key}

  <FogLayer
    props={props.fog}
    {mapSize}
    layers={[SceneLayer.Main]}
    renderOrder={SceneLayerOrder.Fog}
    visible={props.fog.enabled}
  />

  <FogOfWarLayer
    bind:this={fogOfWarLayer}
    props={props.fogOfWar}
    isActive={props.activeLayer === MapLayerType.FogOfWar}
    {mapSize}
    grid={props.grid}
    display={props.display}
    mapZoom={props.map.zoom}
    sceneZoom={props.scene.zoom}
    layers={[SceneLayer.Main]}
    renderOrder={SceneLayerOrder.FogOfWar}
  />
</T.Object3D>
