<script lang="ts">
  import * as THREE from 'three';
  import { T, useTask } from '@threlte/core';
  import { getContext, onDestroy } from 'svelte';
  import { MarkerShape, type Marker } from './types';
  import { SceneLayer, SceneLayerOrder } from '../Scene/types';
  import { getGridCellSize } from '../../helpers/grid';
  import type { GridLayerProps } from '../GridLayer/types';
  import { type DisplayProps, StageMode } from '../Stage/types';
  import MarkerConditionBadges from './MarkerConditionBadges.svelte';
  import {
    activeTurnRingMaterial,
    createCanvasTexture,
    getHighlightGeometry,
    getSkullMaterial,
    hoverRingMaterial,
    loadTokenImage,
    selectedRingMaterial,
    syncRingColors,
    TOKEN_CANVAS_SIZE,
    tokenQuadGeometry
  } from '../../helpers/tokenRasterCache';

  interface Props {
    marker: Marker;
    grid: GridLayerProps;
    display: DisplayProps;
    opacity: number;
    strokeColor: string;
    strokeWidth: number;
    shadowColor: string;
    shadowBlur: number;
    shadowOffset: {
      x: number;
      y: number;
    };
    textColor: string;
    textStroke: number;
    textStrokeColor: string;
    textSize: number;
    isSelected: boolean;
    isHovered?: boolean;
    isActiveTurn?: boolean;
    sceneRotation: number;
    /** Map rotation in degrees, inherited from the map anchor in MapDefined mode */
    mapRotation?: number;
  }

  const {
    marker,
    grid,
    display,
    opacity,
    textColor: textColorProp,
    textStroke: textStrokeProp,
    textStrokeColor: textStrokeColorProp,
    textSize: textSizeProp,
    strokeColor: strokeColorProp,
    strokeWidth: strokeWidthProp,
    shadowColor: shadowColorProp,
    shadowBlur: shadowBlurProp,
    shadowOffset: shadowOffsetProp,
    isSelected = false,
    isHovered = false,
    isActiveTurn = false,
    sceneRotation,
    mapRotation = 0
  }: Props = $props();

  const stage = getContext<{ mode: StageMode }>('stage');

  // The style props arrive as template expressions rooted at the consumer's
  // stageProps, and that root is replaced on every remote doc rebuild (e.g.
  // another editor panning). Reading them directly in the canvas effect would
  // re-fire it per rebuild — a full redraw with gaussian shadow blur plus a
  // texture upload PER MARKER, hundreds of ms per remote update. $derived
  // memoizes by value, cutting the chain when the style didn't change (same
  // guard as the marker.* deriveds below).
  const textColor = $derived(textColorProp);
  const textStroke = $derived(textStrokeProp);
  const textStrokeColor = $derived(textStrokeColorProp);
  const textSize = $derived(textSizeProp);
  const strokeColor = $derived(strokeColorProp);
  const strokeWidth = $derived(strokeWidthProp);
  const shadowColor = $derived(shadowColorProp);
  const shadowBlur = $derived(shadowBlurProp);
  const shadowOffsetX = $derived(shadowOffsetProp.x);
  const shadowOffsetY = $derived(shadowOffsetProp.y);

  // The marker object is replaced on every drag frame (new identity, same
  // visuals). Route the draw inputs through deriveds so the canvas/texture
  // effects below only re-fire when a value actually changes — re-rasterizing
  // and re-uploading the texture per pointermove stalls the render loop.
  // isSelected, isHovered and isActiveTurn are deliberately NOT draw inputs:
  // they only drive ring meshes and the group scale.
  const shape = $derived(marker.shape);
  const shapeColor = $derived(marker.shapeColor);
  const label = $derived(marker.label);
  const imageScale = $derived(marker.imageScale);
  const imageUrl = $derived(marker.imageUrl);
  const isDead = $derived(marker.conditions?.some((c) => c.id === 'dead') ?? false);
  const highlightGeometry = $derived(getHighlightGeometry(shape));

  const baseMarkerSize = $derived(getGridCellSize(grid, display) * marker.size);
  const markerSize = $derived(isHovered ? baseMarkerSize * 1.15 : baseMarkerSize);
  const sizeMultiplier = 0.9;
  const DEAD_TOKEN_OPACITY = 0.45;

  // Counter-rotate markers to keep them upright relative to the viewport.
  // The two rotations compose with opposite signs: scene rotation turns the
  // CAMERA (compensation follows it), while map rotation turns the token's
  // parent anchor (compensation opposes it) — hence the difference.
  const effectiveRotation = $derived(sceneRotation - mapRotation);
  const normalizedRotation = $derived(((effectiveRotation % 360) + 360) % 360);
  const needsFlip = $derived(
    (normalizedRotation > 85 && normalizedRotation < 95) || (normalizedRotation > 265 && normalizedRotation < 275)
  );
  const counterRotation = $derived(
    needsFlip ? -((effectiveRotation + 180) * Math.PI) / 180 : -(effectiveRotation * Math.PI) / 180
  );

  // Drawing is done in a 1024-unit design space (stroke, blur and text sizes
  // are tuned to it) and scaled down onto the TOKEN_CANVAS_SIZE raster.
  const canvasSize = 1024;
  const rasterScale = TOKEN_CANVAS_SIZE / canvasSize;

  // Extra canvas margin so the shadow's gaussian blur isn't cropped at the quad
  // edge (one grid cell); the mesh scales up by the same ratio so the shape
  // itself keeps its size
  const shadowPadding = $derived(
    Math.ceil(shadowBlur * 1.5 + Math.max(Math.abs(shadowOffsetX), Math.abs(shadowOffsetY)) + strokeWidth / 2)
  );
  const paddedCanvasSize = $derived(canvasSize + shadowPadding * 2);
  const rasterSize = $derived(Math.ceil(paddedCanvasSize * rasterScale));
  const shadowScale = $derived(paddedCanvasSize / canvasSize);

  const markerCanvas = new OffscreenCanvas(TOKEN_CANVAS_SIZE, TOKEN_CANVAS_SIZE);
  const ctx = markerCanvas.getContext('2d')!;
  ctx.globalCompositeOperation = 'source-over';

  // Created by the draw effect; recreated whenever the raster size changes, because three
  // allocates immutable GPU storage on the first upload and cannot grow it afterwards
  let markerTexture: THREE.CanvasTexture<OffscreenCanvas> | null = null;
  const markerMaterial = new THREE.MeshBasicMaterial({ transparent: true });
  let tokenImage = $state.raw<ImageBitmap | null>(null);
  let activeRingRef = $state.raw<THREE.Mesh>();

  $effect(() => {
    markerMaterial.opacity = isDead ? opacity * DEAD_TOKEN_OPACITY : opacity;
  });

  $effect(() => {
    const url = imageUrl;
    if (!url) {
      tokenImage = null;
      return;
    }
    let cancelled = false;
    loadTokenImage(url)
      .then((bitmap) => {
        if (!cancelled) tokenImage = bitmap;
      })
      .catch((err) => console.error('Error loading image:', err));
    return () => {
      cancelled = true;
    };
  });

  // Create complete marker canvas with shape, stroke, and text
  function createShape(centerX: number, centerY: number, size: number, clipOnly: boolean = false) {
    ctx.beginPath();

    switch (shape) {
      case MarkerShape.None:
        break;
      case MarkerShape.Circle:
        const radius = (size * sizeMultiplier) / 2;
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.closePath();
        break;

      case MarkerShape.Square:
        const squareSize = size * sizeMultiplier; // Adjust size to match circle's visual weight
        ctx.rect(centerX - squareSize / 2, centerY - squareSize / 2, squareSize, squareSize);
        ctx.closePath();
        break;

      case MarkerShape.Triangle:
        const height = size * sizeMultiplier;
        ctx.moveTo(centerX, centerY - height / 2); // Top
        ctx.lineTo(centerX - height / 2, centerY + height / 2); // Bottom left
        ctx.lineTo(centerX + height / 2, centerY + height / 2); // Bottom right
        ctx.closePath();
        break;
    }

    if (!clipOnly) {
      ctx.shadowColor = shadowColor;
      ctx.shadowBlur = shadowBlur * rasterScale;
      ctx.shadowOffsetX = shadowOffsetX * rasterScale;
      ctx.shadowOffsetY = shadowOffsetY * rasterScale;
      ctx.fill();
      if (strokeWidth > 0) {
        ctx.stroke();
      }
    }

    return ctx;
  }

  // Create text for the marker
  function createText(centerX: number, centerY: number) {
    if (!label) return;

    // Reset shadow settings for text
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // Set text properties
    ctx.font = `700 ${textSize}px Inter`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Add text stroke if specified
    if (textStroke && textStrokeColor) {
      ctx.strokeStyle = textStrokeColor;
      ctx.lineWidth = textStroke * (textSize / 5);
      ctx.strokeText(label, centerX, centerY);
    }

    // Fill text
    ctx.fillStyle = textColor || '#ffffff';
    ctx.fillText(label, centerX, centerY);
  }

  // Create the marker canvas
  function drawMarker() {
    const center = paddedCanvasSize / 2;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, markerCanvas.width, markerCanvas.height);
    ctx.setTransform(rasterScale, 0, 0, rasterScale, 0, 0);

    if (shape !== undefined) {
      ctx.strokeStyle = strokeColor ?? '#000000';
      ctx.lineWidth = strokeWidth;
      ctx.fillStyle = shapeColor ?? '#ffffff';

      createShape(center, center, canvasSize);

      // Draw image if available
      if (tokenImage) {
        // Save the current canvas state
        ctx.save();

        // Create a smaller shape path for clipping that accounts for stroke width
        const innerSize = canvasSize - strokeWidth; // Reduce by twice the stroke width
        createShape(center, center, innerSize, true);

        // Apply clipping to the shape
        ctx.clip();

        // Set proper compositing for image drawing
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1.0; // Ensure full opacity for the image itself

        // Draw the image (will only appear inside the clipped shape)
        ctx.drawImage(
          tokenImage,
          center - (canvasSize / 2) * imageScale * sizeMultiplier,
          center - (canvasSize / 2) * imageScale * sizeMultiplier,
          sizeMultiplier * canvasSize * imageScale,
          sizeMultiplier * canvasSize * imageScale
        );

        // Restore the canvas state (removes clipping)
        ctx.restore();
      }
    }

    if (label) {
      createText(center, center);
    }
  }

  // Redraw only when appearance values change; selection and hover never re-raster
  $effect(() => {
    let texture = markerTexture;
    if (!texture || markerCanvas.width !== rasterSize) {
      markerCanvas.width = rasterSize;
      markerCanvas.height = rasterSize;
      texture?.dispose();
      texture = markerTexture = createCanvasTexture(markerCanvas);
      markerMaterial.map = texture;
      markerMaterial.needsUpdate = true;
    }

    drawMarker();
    texture.needsUpdate = true;
  });

  // One shared task drives the pulse; it only runs while this token is the active turn
  let pulseElapsed = 0;
  useTask(
    (delta) => {
      pulseElapsed += delta;
      const wave = Math.sin(pulseElapsed * 3);
      activeTurnRingMaterial.opacity = 0.55 + 0.35 * wave;
      activeRingRef?.scale.setScalar(1.12 * (1.08 + 0.04 * wave)); // sits outside the selection ring
    },
    { running: () => isActiveTurn }
  );

  syncRingColors();

  onDestroy(() => {
    markerTexture?.dispose();
    markerMaterial.dispose();
  });
</script>

<T.Group
  position={[marker.position.x, marker.position.y, 0]}
  scale={[markerSize, markerSize, 1]}
  rotation={[0, 0, counterRotation]}
>
  <!-- Combined shape, stroke and text -->
  <T.Mesh
    geometry={tokenQuadGeometry}
    renderOrder={SceneLayerOrder.Marker}
    layers={[SceneLayer.Main]}
    scale={[shadowScale, shadowScale, 1]}
  >
    <T.MeshBasicMaterial is={markerMaterial} />
  </T.Mesh>

  <!-- Selection and hover ring: separate mesh so highlight changes never re-raster the token -->
  <T.Mesh
    geometry={highlightGeometry}
    material={isSelected ? selectedRingMaterial : hoverRingMaterial}
    visible={isSelected || isHovered}
    renderOrder={SceneLayerOrder.Marker + 1}
    layers={[SceneLayer.Main]}
  />

  <!-- Active turn ring, pulsed by the task above -->
  <T.Mesh
    bind:ref={activeRingRef}
    geometry={highlightGeometry}
    material={activeTurnRingMaterial}
    visible={isActiveTurn}
    renderOrder={SceneLayerOrder.Marker + 1}
    layers={[SceneLayer.Main]}
  />

  {#if isDead}
    <T.Mesh
      geometry={tokenQuadGeometry}
      material={getSkullMaterial()}
      scale={[shadowScale, shadowScale, 1]}
      renderOrder={SceneLayerOrder.Marker + 0.25}
      layers={[SceneLayer.Main]}
    />
  {/if}

  {#if marker.conditions?.length}
    <MarkerConditionBadges conditions={marker.conditions} mode={stage.mode} />
  {/if}
</T.Group>
