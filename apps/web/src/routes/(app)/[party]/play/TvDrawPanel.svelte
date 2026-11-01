<script lang="ts">
  import { IconArrowBackUp, IconCheck, IconEraser, IconPencil } from '@tabler/icons-svelte';
  import { EffectPreview } from '@tableslayer/stage';
  import { Icon } from '@tableslayer/ui';
  import { brushLabel, DRAW_BRUSH_SIZES, type DrawBrush } from './playDrawing';

  let {
    position,
    brush,
    brushSize,
    cellSize,
    canUndo,
    canErase,
    onBrushSizeChange,
    onBrushClick,
    onEraserToggle,
    onUndo,
    onDone
  }: {
    /** Where the menu was opened; the panel sits on the nearest table edge */
    position: { x: number; y: number };
    brush: DrawBrush;
    /** Grid squares */
    brushSize: number;
    /** One grid cell in screen pixels, for the size preview */
    cellSize: number;
    canUndo: boolean;
    canErase: boolean;
    onBrushSizeChange: (size: number) => void;
    onBrushClick: (point: { x: number; y: number }) => void;
    onEraserToggle: () => void;
    onUndo: () => void;
    onDone: () => void;
  } = $props();

  const EDGE_MARGIN = 16;
  // Distance from the edge to the panel's center; the bottom edge also clears the toolbar
  const EDGE_OFFSET = 56;
  const BOTTOM_EDGE_OFFSET = 128;
  const HALF_LENGTH = 260;
  const PREVIEW_MAX = 72;

  // Faces the nearest screen edge, like the radial menu it was opened from
  const placement = $derived.by(() => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const distances = [height - position.y, width - position.x, position.y, position.x];
    const edge = distances.indexOf(Math.min(...distances));
    const along = (value: number, length: number) =>
      Math.max(HALF_LENGTH + EDGE_MARGIN, Math.min(length - HALF_LENGTH - EDGE_MARGIN, value));
    switch (edge) {
      case 0:
        return { x: along(position.x, width), y: height - BOTTOM_EDGE_OFFSET, rotation: 0 };
      case 1:
        return { x: width - EDGE_OFFSET, y: along(position.y, height), rotation: -90 };
      case 2:
        return { x: along(position.x, width), y: EDGE_OFFSET, rotation: -180 };
      default:
        return { x: EDGE_OFFSET, y: along(position.y, height), rotation: -270 };
    }
  });

  const sizeIndex = $derived(
    DRAW_BRUSH_SIZES.reduce(
      (best, size, index) => (Math.abs(size - brushSize) < Math.abs(DRAW_BRUSH_SIZES[best] - brushSize) ? index : best),
      0
    )
  );
  const sizeLabel = $derived(`${String(Number(brushSize.toFixed(2))).replace(/^0\./, '.')} sq`);
  const previewDiameter = $derived(brushSize * cellSize);
  const erasing = $derived(brush.kind === 'erase');

  const centerOf = (event: MouseEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };
</script>

<div
  class="tvDrawPanel"
  role="toolbar"
  aria-label="Drawing"
  style:left="{placement.x}px"
  style:top="{placement.y}px"
  style:transform="translate(-50%, -50%) rotate({placement.rotation}deg)"
>
  <button
    type="button"
    class="tvDrawPanel__brush"
    aria-label="Change brush, now {brushLabel(brush)}"
    onclick={(event) => onBrushClick(centerOf(event))}
  >
    {#if brush.kind === 'effect'}
      <EffectPreview effectType={brush.effect} size="3rem" />
    {:else if brush.kind === 'color'}
      <span class="tvDrawPanel__swatch" style:background-color={brush.color}></span>
    {:else}
      <span class="tvDrawPanel__swatch tvDrawPanel__swatch--eraser"><Icon Icon={IconEraser} size="1.75rem" /></span>
    {/if}
    <span class="tvDrawPanel__label">{brushLabel(brush)}</span>
  </button>

  <label class="tvDrawPanel__size">
    <span class="tvDrawPanel__label">Size {sizeLabel}</span>
    <input
      type="range"
      class="tvDrawPanel__slider"
      min="0"
      max={DRAW_BRUSH_SIZES.length - 1}
      step="1"
      value={sizeIndex}
      aria-label="Brush size in grid squares"
      aria-valuetext={sizeLabel}
      oninput={(event) => onBrushSizeChange(DRAW_BRUSH_SIZES[Number(event.currentTarget.value)])}
    />
  </label>

  <div class="tvDrawPanel__preview" aria-hidden="true">
    <span
      class={['tvDrawPanel__previewDot', previewDiameter > PREVIEW_MAX && 'tvDrawPanel__previewDot--capped']}
      style:width="{Math.max(4, Math.min(PREVIEW_MAX, previewDiameter))}px"
      style:height="{Math.max(4, Math.min(PREVIEW_MAX, previewDiameter))}px"
      style:background-color={brush.kind === 'color' ? brush.color : undefined}
    ></span>
  </div>

  <button
    type="button"
    class={['tvDrawPanel__action', erasing && 'tvDrawPanel__action--active']}
    aria-pressed={erasing}
    disabled={!erasing && !canErase}
    title={!erasing && !canErase ? 'No player drawings to erase' : undefined}
    onclick={onEraserToggle}
  >
    <Icon Icon={erasing ? IconPencil : IconEraser} size="1.75rem" />
    <span class="tvDrawPanel__label">{erasing ? 'Draw' : 'Eraser'}</span>
  </button>

  <button type="button" class="tvDrawPanel__action" disabled={!canUndo} onclick={onUndo}>
    <Icon Icon={IconArrowBackUp} size="1.75rem" />
    <span class="tvDrawPanel__label">Undo</span>
  </button>

  <button type="button" class="tvDrawPanel__action tvDrawPanel__action--done" onclick={onDone}>
    <Icon Icon={IconCheck} size="1.75rem" />
    <span class="tvDrawPanel__label">Done</span>
  </button>
</div>

<style>
  .tvDrawPanel {
    position: fixed;
    z-index: 900;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.625rem 0.875rem;
    color: var(--fg);
    background: color-mix(in srgb, var(--bg) 92%, transparent);
    border: 1px solid var(--fgMuted);
    border-radius: 1rem;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    touch-action: none;
    user-select: none;
  }

  .tvDrawPanel__brush,
  .tvDrawPanel__action {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    min-width: 3.75rem;
    padding: 0.25rem;
    color: var(--fg);
    background: transparent;
    border: none;
    border-radius: 0.75rem;
    cursor: pointer;
  }

  .tvDrawPanel__action:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .tvDrawPanel__action--active {
    color: var(--bg);
    background: var(--fg);
  }

  .tvDrawPanel__action--done {
    color: var(--fgPrimary);
  }

  .tvDrawPanel__swatch {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 3rem;
    height: 3rem;
    border: 2px solid var(--fg);
    border-radius: 50%;
  }

  .tvDrawPanel__swatch--eraser {
    border-style: dashed;
  }

  .tvDrawPanel__label {
    font-size: 0.875rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .tvDrawPanel__size {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.375rem;
  }

  .tvDrawPanel__slider {
    width: 12rem;
    height: 2.5rem;
    accent-color: var(--fgPrimary);
    cursor: pointer;
  }

  .tvDrawPanel__slider::-webkit-slider-thumb {
    width: 2rem;
    height: 2rem;
  }

  .tvDrawPanel__slider::-moz-range-thumb {
    width: 2rem;
    height: 2rem;
  }

  .tvDrawPanel__preview {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 4.5rem;
    height: 4.5rem;
  }

  .tvDrawPanel__previewDot {
    background-color: transparent;
    border: 2px solid var(--fg);
    border-radius: 50%;
  }

  .tvDrawPanel__previewDot--capped {
    border-style: dashed;
  }
</style>
