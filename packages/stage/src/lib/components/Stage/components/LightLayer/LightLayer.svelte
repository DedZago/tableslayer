<script lang="ts">
  import * as THREE from 'three';
  import { T, type Props as ThrelteProps } from '@threlte/core';
  import { LightStyle, LightPulse, type Light, LIGHT_STYLE_COLORS } from './types';
  import { getContext } from 'svelte';
  import LayerInput from '../LayerInput/LayerInput.svelte';
  import type { Callbacks } from '../Stage/types';
  import { type StageProps, StageMode } from '../Stage/types';
  import LightToken from './LightToken.svelte';
  import { getGridCellSize, snapToGrid } from '../../helpers/grid';
  import type { GridLayerProps } from '../GridLayer/types';
  import type { DisplayProps } from '../Stage/types';
  import { SceneLayer } from '../Scene/types';
  import { MapLayerType } from '../MapLayer/types';
  import { v4 as uuidv4 } from 'uuid';

  interface Props extends ThrelteProps<typeof THREE.Mesh> {
    props: StageProps;
    isActive: boolean;
    grid: GridLayerProps;
    display: DisplayProps;
    /** Display pixels per local pixel (map.zoom when anchored to the map in MapDefined mode) */
    localScale?: number;
  }

  const { props, isActive, display, grid, localScale = 1 }: Props = $props();

  const stage = getContext<{ mode: StageMode; markerClaimAt: number; selectedLightIds?: string[] }>('stage');
  const { onLightAdded, onLightMoved, onLightSelected } = getContext<Callbacks>('callbacks');

  const MARKER_CLAIM_WINDOW_MS = 100;

  // Quad used for raycasting / mouse input detection
  let inputMesh = $state.raw(new THREE.Mesh());

  // Track the currently selected light and dragging state
  let selectedLight: Light | null = $state(null);
  let isDragging = $state(false);
  let hoveredLight: Light | null = $state(null);
  // A press on an already selected light reports it on release, unless the press became a drag
  let pressedSelected: { light: Light; from: THREE.Vector2 } | null = null;
  let dragMoved = false;

  const isLightSelected = (light: Light) =>
    stage.selectedLightIds ? stage.selectedLightIds.includes(light.id) : selectedLight?.id === light.id;

  const pressLight = (light: Light) => {
    selectedLight = light;
    isDragging = true;
    dragMoved = false;
    pressedSelected = isLightSelected(light)
      ? { light, from: new THREE.Vector2(light.position.x, light.position.y) }
      : null;
    if (!pressedSelected) onLightSelected?.(light);
  };

  const ghostLight: Light = $state({
    id: uuidv4(),
    position: new THREE.Vector2(0, 0),
    radius: 2,
    color: LIGHT_STYLE_COLORS[LightStyle.Lantern],
    style: LightStyle.Lantern,
    pulse: LightPulse.Slow,
    opacity: 1
  });

  // Clear selection when layer becomes inactive
  $effect(() => {
    if (!isActive && selectedLight) {
      selectedLight = null;
      onLightSelected?.(null);
    }
  });

  const findClosestLight = (gridCoords: THREE.Vector2) => {
    let closestLight: Light | undefined;
    let minDistance = Infinity;

    props.light.lights.forEach((light) => {
      const distance = gridCoords.distanceTo(light.position);
      const lightRadius = getGridCellSize(grid, display) * light.radius;
      // Use a smaller hit area (30% of radius) for easier selection
      if (distance < minDistance && distance <= lightRadius * 0.3) {
        minDistance = distance;
        closestLight = light;
      }
    });

    return closestLight;
  };

  const onMouseDown = (e: MouseEvent | TouchEvent, coords: THREE.Vector2 | null) => {
    if (!coords) return;

    const isTouchEvent = typeof TouchEvent !== 'undefined' && e instanceof TouchEvent;
    const isMouseEvent = e instanceof MouseEvent;

    if (isMouseEvent && e.button !== 0) return;
    if (isTouchEvent && (e as TouchEvent).touches.length !== 1) return;

    // Only allow light interaction when activeLayer is None or Light
    if (props.activeLayer !== MapLayerType.None && props.activeLayer !== MapLayerType.Light) {
      return;
    }

    const gridCoords = new THREE.Vector2(coords.x - display.resolution.x / 2, coords.y - display.resolution.y / 2);

    const closestLight = findClosestLight(gridCoords);

    if (closestLight !== undefined && props.activeLayer === MapLayerType.None) {
      // Markers share this click; the marker layer stamps its claim during the same dispatch
      setTimeout(() => {
        if (performance.now() - stage.markerClaimAt < MARKER_CLAIM_WINDOW_MS) return;
        pressLight(closestLight);
      }, 0);
    } else if (closestLight !== undefined) {
      pressLight(closestLight);
    } else {
      // In player mode, clicking empty space clears selection
      if (stage.mode === StageMode.Player) {
        selectedLight = null;
        return;
      }

      // In DM mode with Light tool active, create a new light
      if (props.activeLayer === MapLayerType.Light) {
        const position = props.light.snapToGrid ? snapToGrid(gridCoords, grid, display, false, localScale) : gridCoords;
        const newLight: Light = {
          id: uuidv4(),
          position,
          radius: 2,
          color: LIGHT_STYLE_COLORS[LightStyle.Lantern],
          style: LightStyle.Lantern,
          pulse: LightPulse.Slow,
          opacity: 1
        };
        selectedLight = newLight;
        onLightAdded?.(newLight);
      } else {
        // Clear selection when clicking empty space in DM mode with other tools
        selectedLight = null;
        onLightSelected?.(null);
      }
    }
  };

  const onMouseMove = (e: Event, coords: THREE.Vector2 | null) => {
    if (!coords) {
      hoveredLight = null;
      return;
    }

    let position = new THREE.Vector2(coords.x - display.resolution.x / 2, coords.y - display.resolution.y / 2);
    const snapPosition = props.light.snapToGrid ? snapToGrid(position, grid, display, false, localScale) : position;

    ghostLight.position = snapPosition;

    // Check for hover when not dragging (DM mode only — no hover outlines on the playfield)
    if (
      !isDragging &&
      stage.mode === StageMode.DM &&
      (props.activeLayer === MapLayerType.None || props.activeLayer === MapLayerType.Light)
    ) {
      hoveredLight = findClosestLight(position) ?? null;
    } else {
      hoveredLight = null;
    }

    if (isDragging && selectedLight) {
      if (pressedSelected && !snapPosition.equals(pressedSelected.from)) dragMoved = true;
      onLightMoved?.(selectedLight, snapPosition);
    }
  };

  const onMouseUp = () => {
    if (pressedSelected && !dragMoved) onLightSelected?.(pressedSelected.light);
    pressedSelected = null;
    if (isDragging && selectedLight) {
      isDragging = false;
    }
  };

  const onMouseLeave = () => {
    hoveredLight = null;
  };

  /**
   * Called when the scene changes to clear all light interaction state.
   */
  export const onSceneChange = () => {
    selectedLight = null;
    isDragging = false;
    hoveredLight = null;
    pressedSelected = null;
  };

  /** The light under a layer-local point */
  export const hitTest = (point: { x: number; y: number }) =>
    findClosestLight(new THREE.Vector2(point.x, point.y))?.id ?? null;

  /** Lights whose center lies inside a layer-local rectangle */
  export const inRectangle = (start: { x: number; y: number }, end: { x: number; y: number }) => {
    const [minX, maxX] = [Math.min(start.x, end.x), Math.max(start.x, end.x)];
    const [minY, maxY] = [Math.min(start.y, end.y), Math.max(start.y, end.y)];
    return props.light.lights
      .filter(({ position }) => position.x >= minX && position.x <= maxX && position.y >= minY && position.y <= maxY)
      .map((light) => light.id);
  };

  // Export reactive state for hover and drag
  export const lightState = {
    get isHovering() {
      return hoveredLight !== null;
    },
    get isDragging() {
      return isDragging;
    },
    get hoveredLight() {
      return hoveredLight;
    },
    get selectedLight() {
      return selectedLight;
    }
  };
</script>

<LayerInput
  id="light"
  isActive={isActive || stage.mode === StageMode.Player}
  target={inputMesh}
  layerSize={{ width: display.resolution.x, height: display.resolution.y }}
  {onMouseDown}
  {onMouseMove}
  {onMouseUp}
  {onMouseLeave}
/>

<!-- This quad is used for raycasting / mouse input detection. It is invisible -->
<T.Mesh bind:ref={inputMesh} scale={[display.resolution.x, display.resolution.y, 1]} layers={[SceneLayer.Input]}>
  <T.MeshBasicMaterial visible={false} />
  <T.PlaneGeometry />
</T.Mesh>

<!-- This group contains all the lights -->
<T.Group name="lightLayer" position={[-0.5, -0.5, 0]}>
  {#each props.light.lights as light (light.id)}
    <LightToken
      {light}
      {grid}
      {display}
      opacity={1.0}
      isSelected={isLightSelected(light)}
      isHovered={hoveredLight?.id === light.id}
    />
  {/each}

  <!-- Only show the ghost light when the light layer is active -->
  {#if isActive && stage.mode === StageMode.DM && props.activeLayer === MapLayerType.Light}
    <LightToken light={ghostLight} {grid} {display} opacity={0.3} isSelected={false} isHovered={false} />
  {/if}
</T.Group>
