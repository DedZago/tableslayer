<script lang="ts">
  import { Button, Icon } from '@tableslayer/ui';
  import { IconZoomIn, IconZoomOut } from '@tabler/icons-svelte';
  import {
    clampCrop,
    cropSourceRect,
    DEFAULT_TOKEN_CROP,
    MAX_CROP_ZOOM,
    MIN_CROP_ZOOM,
    panCrop,
    zoomCrop,
    type TokenCrop
  } from '$lib/utils/tokenCrop';

  let {
    src,
    crop = $bindable(DEFAULT_TOKEN_CROP),
    image = $bindable(null),
    crossOrigin = false,
    onChange,
    onError
  }: {
    src: string;
    crop: TokenCrop;
    image?: HTMLImageElement | null;
    /** Required to read pixels back from a remote image */
    crossOrigin?: boolean;
    onChange?: () => void;
    onError?: () => void;
  } = $props();

  const WHEEL_ZOOM_STEP = 0.0015;
  let viewportSize = $state(0);
  let natural = $state<{ width: number; height: number } | null>(null);
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchDistance = 0;

  const update = (next: TokenCrop) => {
    crop = next;
    onChange?.();
  };

  const onLoad = (event: Event) => {
    const element = event.currentTarget as HTMLImageElement;
    image = element;
    natural = { width: element.naturalWidth, height: element.naturalHeight };
    crop = clampCrop(crop, natural);
  };

  const frame = $derived.by(() => {
    if (!natural || !viewportSize) return null;
    const { sx, sy, side } = cropSourceRect(crop, natural);
    const scale = viewportSize / side;
    return { width: natural.width * scale, height: natural.height * scale, left: -sx * scale, top: -sy * scale };
  });

  const pointerDistance = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const onPointerDown = (event: PointerEvent) => {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) pinchDistance = pointerDistance();
  };

  const onPointerMove = (event: PointerEvent) => {
    const previous = pointers.get(event.pointerId);
    if (!previous || !natural) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const distance = pointerDistance();
      if (pinchDistance > 0) update(zoomCrop(crop, natural, crop.zoom * (distance / pinchDistance)));
      pinchDistance = distance;
      return;
    }
    update(panCrop(crop, natural, event.clientX - previous.x, event.clientY - previous.y, viewportSize));
  };

  const onPointerUp = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    pinchDistance = 0;
  };

  const onWheel = (event: WheelEvent) => {
    if (!natural) return;
    event.preventDefault();
    update(zoomCrop(crop, natural, crop.zoom * Math.exp(-event.deltaY * WHEEL_ZOOM_STEP)));
  };

  const setZoom = (zoom: number) => {
    if (natural) update(zoomCrop(crop, natural, zoom));
  };

  const reset = () => {
    if (natural) update(clampCrop(DEFAULT_TOKEN_CROP, natural));
  };

  const onKeydown = (event: KeyboardEvent) => {
    if (!natural) return;
    const step = viewportSize / 10;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step]
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      update(panCrop(crop, natural, move[0], move[1], viewportSize));
    } else if (event.key === '+' || event.key === '=') {
      setZoom(crop.zoom * 1.15);
    } else if (event.key === '-') {
      setZoom(crop.zoom / 1.15);
    }
  };
</script>

<div class="tokenCropper">
  <div
    class="tokenCropper__viewport"
    role="slider"
    aria-label="Token image framing. Drag to move, scroll or pinch to zoom, arrow keys to nudge"
    aria-valuemin={MIN_CROP_ZOOM}
    aria-valuemax={MAX_CROP_ZOOM}
    aria-valuenow={crop.zoom}
    tabindex="0"
    bind:clientWidth={viewportSize}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    onwheel={onWheel}
    onkeydown={onKeydown}
  >
    <img
      class="tokenCropper__image"
      {src}
      alt=""
      draggable="false"
      crossorigin={crossOrigin ? 'anonymous' : undefined}
      onload={onLoad}
      onerror={() => onError?.()}
      style:width={frame ? `${frame.width}px` : undefined}
      style:height={frame ? `${frame.height}px` : undefined}
      style:left={frame ? `${frame.left}px` : undefined}
      style:top={frame ? `${frame.top}px` : undefined}
      style:visibility={frame ? 'visible' : 'hidden'}
    />
    <div class="tokenCropper__mask"></div>
  </div>
  <div class="tokenCropper__controls">
    <Icon Icon={IconZoomOut} size="1.25rem" />
    <input
      class="tokenCropper__zoom"
      type="range"
      aria-label="Zoom"
      min={MIN_CROP_ZOOM}
      max={MAX_CROP_ZOOM}
      step={0.01}
      value={crop.zoom}
      oninput={(event) => setZoom(Number(event.currentTarget.value))}
    />
    <Icon Icon={IconZoomIn} size="1.25rem" />
    <Button variant="ghost" type="button" onclick={reset}>Reset</Button>
  </div>
</div>

<style>
  .tokenCropper {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    align-items: center;
  }
  .tokenCropper__viewport {
    position: relative;
    width: min(100%, 18rem);
    aspect-ratio: 1;
    overflow: hidden;
    background: var(--contrastLow);
    border-radius: var(--radius-2);
    cursor: grab;
    touch-action: none;
    user-select: none;
  }
  .tokenCropper__viewport:active {
    cursor: grabbing;
  }
  .tokenCropper__viewport:focus-visible {
    outline: 2px solid var(--fgPrimary);
    outline-offset: 2px;
  }
  .tokenCropper__image {
    position: absolute;
    max-width: none;
    max-height: none;
    pointer-events: none;
  }
  .tokenCropper__mask {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: radial-gradient(circle closest-side, transparent 99%, rgb(0 0 0 / 0.6) 100%);
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.15);
  }
  .tokenCropper__controls {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: min(100%, 18rem);
    color: var(--fgMuted);
  }
  .tokenCropper__zoom {
    flex: 1;
    min-width: 0;
  }
</style>
