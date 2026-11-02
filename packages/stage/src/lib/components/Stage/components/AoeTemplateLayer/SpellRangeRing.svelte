<script lang="ts">
  import * as THREE from 'three';
  import { T } from '@threlte/core';
  import { SceneLayer, SceneLayerOrder } from '../Scene/types';

  interface Props {
    /** Layer-local px */
    center: { x: number; y: number };
    /** Layer-local px */
    radius: number;
    color: string;
  }

  const { center, radius, color }: Props = $props();

  const SEGMENTS = 96;
  const DASH_COUNT = 48;
  const OPACITY = 0.55;

  // A unit circle scaled to the radius; the dash length is in unit-circle space
  const unitRing = (() => {
    const points = Array.from({ length: SEGMENTS + 1 }, (_, i) => {
      const angle = (i / SEGMENTS) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
    });
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const distances = points.map((_, i) => (i / SEGMENTS) * Math.PI * 2);
    geometry.setAttribute('lineDistance', new THREE.Float32BufferAttribute(distances, 1));
    return geometry;
  })();

  const dashSize = (Math.PI * 2) / DASH_COUNT / 2;

  $effect(() => () => unitRing.dispose());
</script>

<T.Line
  geometry={unitRing}
  position={[center.x, center.y, 0]}
  scale={[radius, radius, 1]}
  renderOrder={SceneLayerOrder.Measurement}
  layers={[SceneLayer.Overlay]}
>
  <T.LineDashedMaterial attach="material" {color} transparent opacity={OPACITY} {dashSize} gapSize={dashSize} />
</T.Line>
