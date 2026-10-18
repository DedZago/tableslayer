<script lang="ts" module>
  import * as THREE from 'three';

  const LABEL_FONT_PX = 24;
  const LABEL_PIXEL_RATIO = 2;
  const LABEL_BOX_COLOR = '#14110f';
  const LABEL_TEXT_COLOR = '#ffffff';
  const LABEL_SCALE = 0.75;

  const sharedLabelGeometry = new THREE.PlaneGeometry(1, 1);

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
  import { SceneLayer, SceneLayerOrder } from '../Scene/types';

  interface Props {
    text: string;
    /** Layer position of the label centre */
    x: number;
    y: number;
    sceneZoom: number;
    localScale: number;
    sceneRotation: number;
    mapRotation: number;
    /** Distance above the anchor, in layer px */
    lift?: number;
  }

  const { text, x, y, sceneZoom, localScale, sceneRotation, mapRotation, lift = 0 }: Props = $props();

  const scale = $derived(LABEL_SCALE / (sceneZoom * localScale));
  const rotation = $derived(((sceneRotation - mapRotation) * Math.PI) / 180);
  // Lift follows the screen "up" direction so it stays above the anchor whatever the rotation
  const liftOffset = $derived({ x: -Math.sin(rotation) * lift, y: Math.cos(rotation) * lift });

  let label = $state.raw<{ texture: THREE.CanvasTexture; width: number; height: number } | null>(null);

  $effect(() => {
    const { canvas, width, height } = createLabelCanvas(text);
    const texture = new THREE.CanvasTexture(canvas);
    label = { texture, width, height };
    return () => texture.dispose();
  });
</script>

{#if label}
  <T.Group position={[x + liftOffset.x, y + liftOffset.y, 0]} rotation={[0, 0, rotation]} scale={[scale, scale, 1]}>
    <T.Mesh
      geometry={sharedLabelGeometry}
      scale={[label.width, label.height, 1]}
      renderOrder={SceneLayerOrder.Cursor - 1}
      layers={[SceneLayer.Overlay]}
    >
      <T.MeshBasicMaterial attach="material" map={label.texture} transparent depthWrite={false} />
    </T.Mesh>
  </T.Group>
{/if}
