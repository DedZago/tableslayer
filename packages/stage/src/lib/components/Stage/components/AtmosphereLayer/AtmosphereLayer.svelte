<script lang="ts">
  import { untrack } from 'svelte';
  import { createLightToMapUv } from '../../helpers/atmosphereLights';
  import type { GridLayerProps } from '../GridLayer/types';
  import type { Light } from '../LightLayer/types';
  import type { MapLayerProps } from '../MapLayer/types';
  import type { DisplayProps } from '../Stage/types';
  import AirLayer from './AirLayer.svelte';
  import AmbienceGround from './AmbienceGround.svelte';
  import AtmosphereDarkness from './AtmosphereDarkness.svelte';
  import LightningLayer from './LightningLayer.svelte';
  import type { AtmosphereController } from './atmosphereController.svelte';
  import type { ComposedAtmosphere } from './types';

  /**
   * Mount point for the atmosphere sub-layers. Mounted inside the map anchor, only while the map size is
   * known and some slot is active. It mounts each sub-layer by the composed layer flags, keeps the
   * controller's map size current, and feeds it the placed lights (converted to map UV) for the darkness.
   */
  interface Props {
    composed: ComposedAtmosphere;
    mapSize: { width: number; height: number };
    controller: AtmosphereController;
    /** Display px per map px (scene zoom times map zoom) */
    screenScale: number;
    lights: Light[];
    isMapDefined: boolean;
    map: MapLayerProps;
    grid: GridLayerProps;
    display: DisplayProps;
  }

  const { composed, mapSize, controller, screenScale, lights, isMapDefined, map, grid, display }: Props = $props();

  const mapWidth = $derived(mapSize.width);
  const mapHeight = $derived(mapSize.height);
  const showAmbienceGround = $derived(composed.layers.ambienceGround);
  const showDarkness = $derived(composed.layers.darkness);
  const showAir = $derived(composed.layers.air);
  const showLightning = $derived(composed.layers.lightning);

  $effect(() => {
    controller.setMapSize(mapWidth, mapHeight);
  });

  const lightsKey = $derived.by(() => {
    if (!showDarkness) return '';
    const toMapUv = createLightToMapUv({
      isMapDefined,
      map,
      mapSize: { width: mapWidth, height: mapHeight },
      grid,
      display
    });
    return lights
      .map((light) => {
        const uv = toMapUv(light);
        return `${uv.u.toFixed(4)},${uv.v.toFixed(4)},${uv.radius.toFixed(4)},${uv.color},${uv.intensity}`;
      })
      .join(';');
  });

  $effect(() => {
    void lightsKey;
    untrack(() => {
      const toMapUv = createLightToMapUv({
        isMapDefined,
        map,
        mapSize: { width: mapWidth, height: mapHeight },
        grid,
        display
      });
      controller.setLights(showDarkness ? lights : [], toMapUv);
    });
  });
</script>

{#if showAmbienceGround}
  <AmbienceGround {composed} {mapSize} {controller} {screenScale} />
{/if}

{#if showDarkness}
  <AtmosphereDarkness {composed} {mapSize} {controller} {screenScale} />
{/if}

{#if showAir}
  <AirLayer {composed} {mapSize} {controller} {screenScale} />
{/if}

{#if showLightning}
  <LightningLayer {composed} {mapSize} {controller} {screenScale} />
{/if}
