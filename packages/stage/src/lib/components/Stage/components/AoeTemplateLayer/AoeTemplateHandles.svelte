<script lang="ts" module>
  import * as THREE from 'three';

  const LABEL_FONT_PX = 24;
  const LABEL_PIXEL_RATIO = 2;
  const LABEL_BOX_COLOR = '#14110f';
  const LABEL_TEXT_COLOR = '#ffffff';

  // Shared by every template's handles for the app's lifetime, so never disposed
  const sharedDiscGeometry = new THREE.CircleGeometry(1, 24);
  const sharedLabelGeometry = new THREE.PlaneGeometry(1, 1);

  // Canvas sized to the text (in label px) so long spell names are never clipped
  const createLabelCanvas = (text: string) => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    const font = `600 ${LABEL_FONT_PX}px Inter`;
    const padding = LABEL_FONT_PX * 0.3;
    context.font = font;
    const width = Math.ceil(context.measureText(text).width + padding * 2);
    const height = Math.ceil(LABEL_FONT_PX + padding);
    canvas.width = width * LABEL_PIXEL_RATIO;
    canvas.height = height * LABEL_PIXEL_RATIO;
    // Resizing resets the context state
    context.scale(LABEL_PIXEL_RATIO, LABEL_PIXEL_RATIO);
    context.fillStyle = LABEL_BOX_COLOR;
    context.fillRect(0, 0, width, height);
    context.font = font;
    context.fillStyle = LABEL_TEXT_COLOR;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, width / 2, height / 2);
    return { canvas, width, height };
  };
</script>

<script lang="ts">
  import { T } from '@threlte/core';
  import type { AoeTemplate } from './types';
  import { SceneLayer, SceneLayerOrder } from '../Scene/types';
  import {
    formatTemplateLabel,
    getTemplateHandlePoints,
    getTemplateLocalBounds,
    getTemplateOutline,
    templateLocalToLayer
  } from '../../helpers/aoeTemplates';

  interface Props {
    template: AoeTemplate;
    /** Layer px per foot */
    ftToPx: number;
    /** Radius of the origin and end discs in layer px */
    handleRadius: number;
    sceneZoom: number;
    localScale: number;
    sceneRotation: number;
    mapRotation: number;
    isSelected: boolean;
    isDraft: boolean;
    showLabel: boolean;
  }

  const {
    template,
    ftToPx,
    handleRadius,
    sceneZoom,
    localScale,
    sceneRotation,
    mapRotation,
    isSelected,
    isDraft,
    showLabel
  }: Props = $props();

  const LABEL_SCALE = 0.75;

  const ftPerPx = $derived(1 / ftToPx);
  const handles = $derived(getTemplateHandlePoints(template, ftPerPx));
  const outlinePoints = $derived(
    getTemplateOutline(template).map((point) => {
      const layer = templateLocalToLayer(template, point, ftPerPx);
      return new THREE.Vector3(layer.x, layer.y, 0);
    })
  );
  const labelPoint = $derived.by(() => {
    const bounds = getTemplateLocalBounds(template, 0);
    return templateLocalToLayer(
      template,
      { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 },
      ftPerPx
    );
  });
  const showDimensions = $derived(isSelected || isDraft);
  const labelText = $derived(showLabel || showDimensions ? formatTemplateLabel(template, showDimensions) : '');
  const labelScale = $derived(LABEL_SCALE / (sceneZoom * localScale));
  const labelRotation = $derived(((sceneRotation - mapRotation) * Math.PI) / 180);
  const dashSize = $derived(handleRadius * 0.6);

  // Closed polyline; dash distances are computed here because only LineDashedMaterial reads them
  const outlineGeometry = $derived.by(() => {
    const path = [...outlinePoints, outlinePoints[0]];
    const geometry = new THREE.BufferGeometry().setFromPoints(path);
    if (isDraft) {
      const distances = [0];
      for (let i = 1; i < path.length; i++) {
        distances.push(distances[i - 1] + path[i].distanceTo(path[i - 1]));
      }
      geometry.setAttribute('lineDistance', new THREE.Float32BufferAttribute(distances, 1));
    }
    return geometry;
  });

  $effect(() => {
    const geometry = outlineGeometry;
    return () => geometry.dispose();
  });

  let label = $state.raw<{ texture: THREE.CanvasTexture; width: number; height: number } | null>(null);

  // Rebuilt only when the label text changes, never on move or resize
  $effect(() => {
    const text = labelText;
    if (!text) return;
    const { canvas, width, height } = createLabelCanvas(text);
    const texture = new THREE.CanvasTexture(canvas);
    label = { texture, width, height };
    return () => texture.dispose();
  });

  const outlineColor = $derived(template.color);
</script>

<T.Line geometry={outlineGeometry} renderOrder={SceneLayerOrder.Measurement} layers={[SceneLayer.Overlay]}>
  {#if isDraft}
    <T.LineDashedMaterial
      attach="material"
      color={outlineColor}
      transparent
      opacity={0.4}
      {dashSize}
      gapSize={dashSize}
    />
  {:else}
    <T.LineBasicMaterial attach="material" color={outlineColor} transparent opacity={isSelected ? 0.9 : 0.6} />
  {/if}
</T.Line>

{#if isSelected}
  <T.Mesh
    geometry={sharedDiscGeometry}
    position={[handles.origin.x, handles.origin.y, 0]}
    scale={[handleRadius, handleRadius, 1]}
    renderOrder={SceneLayerOrder.Measurement}
    layers={[SceneLayer.Overlay]}
  >
    <T.MeshBasicMaterial attach="material" color="#ffffff" transparent opacity={0.9} />
  </T.Mesh>
  <T.Mesh
    geometry={sharedDiscGeometry}
    position={[handles.end.x, handles.end.y, 0]}
    scale={[handleRadius, handleRadius, 1]}
    renderOrder={SceneLayerOrder.Measurement}
    layers={[SceneLayer.Overlay]}
  >
    <T.MeshBasicMaterial attach="material" color="#ffffff" transparent opacity={0.9} />
  </T.Mesh>
{/if}

{#if labelText && label}
  <T.Group
    position={[labelPoint.x, labelPoint.y, 0]}
    rotation={[0, 0, labelRotation]}
    scale={[labelScale, labelScale, 1]}
  >
    <T.Mesh
      geometry={sharedLabelGeometry}
      scale={[label.width, label.height, 1]}
      renderOrder={SceneLayerOrder.Measurement}
      layers={[SceneLayer.Overlay]}
    >
      <T.MeshBasicMaterial attach="material" map={label.texture} transparent depthWrite={false} />
    </T.Mesh>
  </T.Group>
{/if}
