<script lang="ts">
  import * as THREE from 'three';
  import { getContext, onDestroy } from 'svelte';
  import { T } from '@threlte/core';
  import { type AnnotationLayerData, type AnnotationsLayerProps, AnnotationEffect } from './types';
  import { StageMode, type Callbacks, type DisplayProps } from '../Stage/types';
  import LayerInput from '../LayerInput/LayerInput.svelte';
  import { SceneLayer, SceneLayerOrder } from '../Scene/types';
  import AnnotationMaterial from './AnnotationMaterial.svelte';
  import { LazyBrushManager } from '../../helpers/lazyBrush';
  import { DrawMode, ToolType } from '../DrawingLayer/types';
  import type { GridLayerProps } from '../GridLayer/types';
  import { getGridCellSize } from '../../helpers/grid';
  import type { MapTransform } from '../../helpers/mapSpace';
  import toolOutlineVertexShader from '../../shaders/default.vert?raw';
  import toolOutlineFragmentShader from '../../shaders/ToolOutline.frag?raw';

  interface Props {
    props: AnnotationsLayerProps;
    mode: StageMode;
    isActive: boolean;
    display: DisplayProps;
    grid: GridLayerProps;
    sceneZoom: number;
    /** Display pixels per local pixel (map.zoom when anchored to the map in MapDefined mode) */
    localScale?: number;
    /** Legacy display-space mask conversion config, set in MapDefined mode */
    conversion?: { realDisplay: DisplayProps; map: MapTransform };
  }

  const { props, mode, isActive, display, grid, sceneZoom, localScale = 1, conversion }: Props = $props();

  const onAnnotationUpdate = getContext<Callbacks>('callbacks').onAnnotationUpdate;

  // Outline styling (same as fog of war)
  const OUTLINE_COLOR = '#FFFFFF';
  const OUTLINE_OPACITY = 1;
  const OUTLINE_THICKNESS = 2;

  // Pre-allocated vector for display center offset to avoid GC pressure
  const displayCenterOffset = new THREE.Vector2();

  // Convert lineWidth (grid units, line width/diameter) to texture pixels; the
  // annotation texture is display-resolution sized, so one texture pixel = one
  // display pixel. The shaders treat uBrushSize as a radius, so halve it.
  const cellSizePixels = $derived(getGridCellSize(grid, display));
  const lineWidthPixels = $derived(Math.max(1, Math.round(((props.lineWidth ?? 0.5) * cellSizePixels) / 2)));

  // Use $state.raw() for Three.js objects to prevent proxy interference with internal properties
  let mesh: THREE.Mesh = $state.raw(new THREE.Mesh());
  let outlineMesh: THREE.Mesh = $state.raw(new THREE.Mesh());
  let drawing = false;

  // Export drawing state so parent can check it
  export function isDrawing() {
    return drawing;
  }

  // If mouse leaves the drawing area, we need to reset the start position
  // when it re-enters the drawing area to prevent the drawing from "jumping"
  // to the new point
  let lastPos: THREE.Vector2 | null = null;

  // Track the last screen position for the persist button
  let lastScreenPos: { x: number; y: number } | null = null;

  // Track if cursors are hidden to avoid redundant resets
  let cursorsHidden = false;

  // Initialize lazy brush for smooth drawing
  // Base values for zoom level 1.0
  const BASE_RADIUS = 20;
  const BASE_FRICTION = 0.05;

  // Smoothing disabled by default for more responsive drawing
  const smoothingEnabled = $derived(props.smoothingEnabled ?? false);

  const lazyBrush = new LazyBrushManager({
    radius: BASE_RADIUS,
    enabled: smoothingEnabled,
    friction: BASE_FRICTION
  });

  // Outline material for brush cursor (same as fog of war)
  const outlineMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uStart: { value: new THREE.Vector2(Infinity, Infinity) },
      uEnd: { value: new THREE.Vector2(Infinity, Infinity) },
      uBrushSize: { value: lineWidthPixels },
      uTextureSize: { value: new THREE.Vector2(display.resolution.x, display.resolution.y) },
      uShapeType: { value: ToolType.Brush },
      uOutlineColor: { value: new THREE.Color(OUTLINE_COLOR) },
      uOutlineOpacity: { value: OUTLINE_OPACITY },
      uOutlineThickness: { value: OUTLINE_THICKNESS }
    },
    vertexShader: toolOutlineVertexShader,
    fragmentShader: toolOutlineFragmentShader,
    transparent: true,
    depthTest: false
  });

  onDestroy(() => {
    outlineMaterial.dispose();
  });

  // Adjust lazy brush settings based on zoom level and smoothing toggle
  $effect(() => {
    // Scale radius inversely with zoom - less smoothing when zoomed in
    // At zoom 2x, radius is 25 (half)
    // At zoom 0.5x, radius is 100 (double)
    // localScale converts the screen-space radius into local (map) pixels
    const adjustedRadius = BASE_RADIUS / (sceneZoom * localScale);

    // Adjust friction based on zoom - more responsive when zoomed in
    // At high zoom (>2), reduce friction for more immediate response
    // At low zoom (<0.5), increase friction for smoother lines
    const adjustedFriction =
      sceneZoom > 2 ? BASE_FRICTION * 0.5 : sceneZoom < 0.5 ? BASE_FRICTION * 1.5 : BASE_FRICTION;

    lazyBrush.updateConfig({
      radius: Math.max(5, Math.min(100, adjustedRadius)), // Clamp between 5 and 100
      friction: adjustedFriction,
      enabled: smoothingEnabled
    });
  });

  // Update outline material uniforms and center offset when props change
  $effect(() => {
    // Use .set() to avoid allocating new objects
    outlineMaterial.uniforms.uTextureSize.value.set(display.resolution.x, display.resolution.y);
    outlineMaterial.uniforms.uBrushSize.value = lineWidthPixels;
    // Outline thickness is a screen-space style; convert to local pixels
    outlineMaterial.uniforms.uOutlineThickness.value = OUTLINE_THICKNESS / localScale;
    displayCenterOffset.set(display.resolution.x / 2, display.resolution.y / 2);
  });

  const erasing = $derived(props.tool === 'erase');

  // Hide outline when tool is not active
  $effect(() => {
    if (!isActive || targetIds.length === 0) {
      outlineMesh.visible = false;
      outlineMaterial.uniforms.uStart.value.set(Infinity, Infinity);
      outlineMaterial.uniforms.uEnd.value.set(Infinity, Infinity);
    }
  });

  // Reference to the child layers
  let layers: AnnotationMaterial[] = $state([]);

  // Get the currently active layer
  let activeLayer = $derived(
    layers.find((layer) => {
      if (!layer) return false;
      return layer.getId() === props.activeLayer;
    })
  );

  // The layers a stroke paints on: the active layer, or every erasable layer while erasing
  const targetIds = $derived.by(() => {
    if (erasing && props.eraseLayerIds) {
      const visible = new Set(props.layers.filter(isVisible).map((layer) => layer.id));
      return props.eraseLayerIds.filter((id) => visible.has(id));
    }
    return props.activeLayer ? [props.activeLayer] : [];
  });
  const targetLayers = $derived(layers.filter((layer) => layer && targetIds.includes(layer.getId())));

  const drawOnTargets = (start: THREE.Vector2, last: THREE.Vector2, persist: boolean) => {
    for (const layer of targetLayers) layer.drawPath(start, last, persist);
  };

  // Whenever the tool type changes, we need to reset the drawing state
  $effect(() => {
    if (!isActive) {
      lastPos = null;
      drawing = false;
      lazyBrush.reset();
      // Reset cursor for all layers to ensure no ghosting
      if (!cursorsHidden) {
        layers.forEach((layer) => {
          if (layer) {
            layer.revertChanges();
            layer.resetCursor();
          }
        });
        cursorsHidden = true;
      }
    } else {
      // Tool is active again
      cursorsHidden = false;
    }
  });

  // Also reset cursor when there is nothing to draw on
  $effect(() => {
    if (targetIds.length === 0 && layers.length > 0) {
      // No active layer selected, reset all cursors and revert changes
      lastPos = null; // Reset last position to prevent cursor from appearing
      if (!cursorsHidden) {
        layers.forEach((layer) => {
          if (layer) {
            layer.revertChanges();
            layer.resetCursor();
          }
        });
        cursorsHidden = true;
      }
    } else if (targetIds.length > 0) {
      // Active layer selected again
      cursorsHidden = false;
    }
  });

  function onMouseDown(e: Event, p: THREE.Vector2 | null) {
    e.preventDefault();
    lastPos = p;
    drawing = true;

    // Track screen position for persist button
    if (e instanceof MouseEvent) {
      lastScreenPos = { x: e.clientX, y: e.clientY };
    } else if (e instanceof TouchEvent && e.touches[0]) {
      lastScreenPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }

    // Start a new stroke with lazy brush
    if (p) {
      // Need to adjust for display offset before starting stroke
      const adjustedP = p.clone();
      adjustedP.add(displayCenterOffset);
      lazyBrush.startStroke(adjustedP);
    }

    draw(e, p);
  }

  function onMouseUp() {
    // If we have just finished drawing, save every layer the stroke touched
    if (drawing) {
      for (const layer of targetLayers) {
        onAnnotationUpdate(layer.getId(), () => layer.toPng(), lastScreenPos || undefined);
      }
    }

    // Reset the drawing state
    drawing = false;
    lazyBrush.endStroke();
    // Don't reset lastPos here to prevent cursor jumping
  }

  function onMouseLeave() {
    lastPos = null;
    drawing = false;
    lazyBrush.reset();

    // Revert changes and hide cursor
    if (!cursorsHidden) {
      for (const layer of targetLayers) {
        layer.revertChanges();
        layer.resetCursor();
      }
    }

    // Hide outline
    outlineMesh.visible = false;
    outlineMaterial.uniforms.uStart.value.set(Infinity, Infinity);
    outlineMaterial.uniforms.uEnd.value.set(Infinity, Infinity);
  }

  function draw(e: Event, p: THREE.Vector2 | null) {
    // Track screen position during drawing for persist button
    if (drawing) {
      if (e instanceof MouseEvent) {
        lastScreenPos = { x: e.clientX, y: e.clientY };
      } else if (e instanceof TouchEvent && e.touches[0]) {
        lastScreenPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    }

    // If the mouse is not within the drawing area, hide cursor and outline
    if (!p) {
      // Reset cursor for all layers when mouse leaves (only if not already hidden)
      if (!cursorsHidden) {
        layers.forEach((layer) => {
          if (layer) {
            layer.resetCursor();
          }
        });
      }
      // Hide outline
      outlineMesh.visible = false;
      outlineMaterial.uniforms.uStart.value.set(Infinity, Infinity);
      outlineMaterial.uniforms.uEnd.value.set(Infinity, Infinity);
      return;
    }

    // Only process if we have an active layer and the annotation tool is active
    if (targetLayers.length === 0 || !isActive) {
      // Make sure all cursors are hidden when not active (only if not already hidden)
      if (!cursorsHidden) {
        layers.forEach((layer) => {
          if (layer) {
            layer.resetCursor();
          }
        });
        cursorsHidden = true;
      }
      // Hide outline
      outlineMesh.visible = false;
      outlineMaterial.uniforms.uStart.value.set(Infinity, Infinity);
      outlineMaterial.uniforms.uEnd.value.set(Infinity, Infinity);
      return;
    }

    // Tool is active and we have a valid position
    cursorsHidden = false;

    p.add(displayCenterOffset);

    // Show outline at cursor position
    outlineMesh.visible = true;
    outlineMaterial.uniforms.uStart.value.copy(p);
    outlineMaterial.uniforms.uEnd.value.copy(p);

    // Use lazy brush for smooth drawing when drawing is active
    if (drawing && lazyBrush.enabled) {
      // Update lazy brush and get smoothed points
      const segments = lazyBrush.updateStroke(p);

      // Draw each segment (segments come as pairs: [lastPoint, newPoint])
      for (let i = 0; i < segments.length; i += 2) {
        if (segments[i] && segments[i + 1]) {
          // Draw from last point to new point
          drawOnTargets(segments[i + 1], segments[i], true);
        }
      }

      // Update cursor to show brush position
      const brushPos = lazyBrush.getBrushPosition();
      if (brushPos) {
        drawOnTargets(brushPos, brushPos, false);
        // Update outline to follow lazy brush position
        outlineMaterial.uniforms.uStart.value.copy(brushPos);
        outlineMaterial.uniforms.uEnd.value.copy(brushPos);
      } else {
        // Show cursor at actual position if no brush position
        drawOnTargets(p, p, false);
      }
    } else if (drawing && !lazyBrush.enabled) {
      // Drawing but lazy brush is disabled
      if (!lastPos) {
        lastPos = p.clone();
      }
      drawOnTargets(p, lastPos, true);
      lastPos = p.clone();
    } else {
      // Just hovering, show cursor (erasing previews nothing: the outline shows the brush)
      if (!erasing) drawOnTargets(p, p, false);
    }
  }

  function isVisible(layer: AnnotationLayerData) {
    // Don't show DM layers to players
    return !(mode === StageMode.Player && layer.visibility === StageMode.DM);
  }

  function hasEffect(layer: AnnotationLayerData) {
    // Check if the layer has an effect (not None)
    return layer.effect?.type !== undefined && layer.effect.type !== AnnotationEffect.None;
  }

  /**
   * Clears the annotation layer
   */
  export function clear(layerId: string) {
    if (layerId) {
      const layer = layers.find((layer) => layer.getId() === layerId);
      if (layer) {
        layer.clear();
        onAnnotationUpdate(layerId, toPng);
      }
    }
  }

  const layerById = (layerId?: string) =>
    layerId ? layers.find((layer) => layer && layer.getId() === layerId) : activeLayer;

  /**
   * Serializes an annotation layer (the active one by default) to PNG
   */
  export async function toPng(layerId?: string): Promise<Blob> {
    return (await layerById(layerId)?.toPng()) ?? new Blob();
  }

  /**
   * Exports an annotation layer's mask (the active one by default) as RLE-encoded data
   */
  export async function toRLE(layerId?: string): Promise<Uint8Array> {
    return (await layerById(layerId)?.toRLE()) ?? new Uint8Array();
  }

  /**
   * Loads RLE-encoded data into the active annotation layer
   * @param rleData RLE encoded data
   * @param width Image width
   * @param height Image height
   */
  export async function fromRLE(rleData: Uint8Array, width: number, height: number) {
    return activeLayer?.fromRLE(rleData, width, height);
  }

  /**
   * Loads RLE-encoded data into a specific annotation layer by ID
   * @param layerId The ID of the annotation layer
   * @param rleData RLE encoded data
   */
  export async function loadMask(layerId: string, rleData: Uint8Array) {
    // Filter out null entries that may exist before components are rendered
    const layer = layers.find((layer) => layer && layer.getId() === layerId);
    if (layer) {
      return layer.fromRLE(rleData, 1024, 1024);
    }
  }
</script>

<LayerInput
  id="annotation"
  {isActive}
  layerSize={{ width: 1, height: 1 }}
  target={mesh}
  {onMouseDown}
  onMouseMove={draw}
  {onMouseUp}
  {onMouseLeave}
/>

<!--
Invisible mesh used for input detection.
The plane geometry is larger than the map size to allow cursor
events to be detected outside of the fog of war layer.
-->
<T.Mesh bind:ref={mesh} name="annotationInput" layers={[SceneLayer.Input]}>
  <T.MeshBasicMaterial visible={false} />
  <T.PlaneGeometry args={[2 * display.resolution.x, 2 * display.resolution.y]} />
</T.Mesh>

<!-- Brush outline for annotation tool -->
<T.Mesh
  bind:ref={outlineMesh}
  name="annotationToolOutline"
  layers={[SceneLayer.Overlay]}
  scale={[display.resolution.x, display.resolution.y, 1]}
  renderOrder={SceneLayerOrder.Cursor}
>
  <T is={outlineMaterial} transparent={true} depthTest={false} />
  <T.PlaneGeometry />
</T.Mesh>

<!--
Color annotations render on the Overlay layer (over fog, no post-processing).
Effect annotations render in the Main pass so they sit under fog of war, lights,
and markers - the trade-off is they receive post-processing (bloom etc.) there.
-->
<T.Mesh name="annotationLayer" scale={[display.resolution.x, display.resolution.y, 1]}>
  {#each props.layers as layer, index (layer.id)}
    <T.Mesh
      name={layer.id}
      visible={isVisible(layer)}
      position.z={(props.layers.length - index) * 0.001}
      layers={hasEffect(layer) ? [SceneLayer.Main] : [SceneLayer.Overlay]}
      renderOrder={hasEffect(layer) ? SceneLayerOrder.EffectAnnotation : SceneLayerOrder.Annotation}
    >
      <AnnotationMaterial
        bind:this={layers[index]}
        props={layer}
        {display}
        {lineWidthPixels}
        {cellSizePixels}
        drawMode={erasing && targetIds.includes(layer.id) ? DrawMode.Erase : DrawMode.Draw}
        {conversion}
        isDrawingThisLayer={() => drawing && targetIds.includes(layer.id)}
        onMaskConverted={() => {
          const converted = layers.find((l) => l && l.getId() === layer.id);
          if (converted) onAnnotationUpdate(layer.id, () => converted.toPng());
        }}
      />
      <T.PlaneGeometry />
    </T.Mesh>
  {/each}
</T.Mesh>
