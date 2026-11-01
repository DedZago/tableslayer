<script lang="ts">
  import { Popover, Icon, IconButton } from '@tableslayer/ui';
  import {
    IconBoxMultiple,
    IconBoxMultiple1,
    IconBoxMultiple2,
    IconBoxMultiple3,
    IconBoxMultiple4,
    IconBoxMultiple5,
    IconBoxMultiple6,
    IconBoxMultiple7,
    IconBoxMultiple8,
    IconBoxMultiple9,
    IconEraser
  } from '@tabler/icons-svelte';
  import type { ComponentType } from 'svelte';
  import { AnnotationEffect } from '../Stage/components/AnnotationLayer/types';
  import EffectPreview from '../RadialMenu/EffectPreview.svelte';
  import {
    ANNOTATION_EFFECT_CATEGORIES,
    annotationEffectDefinition,
    annotationEffectsInCategory,
    type AnnotationEffectCategory
  } from '../Stage/helpers/annotationEffects';

  // Color palette - 8 colors (pink and turquoise gave up their slots to effects)
  const COLORS = [
    '#d73e2e', // red
    '#ffa500', // orange
    '#ffd93d', // yellow
    '#6bcf7f', // green
    '#2e86ab', // blue
    '#b197fc', // purple
    '#ffffff', // white
    '#2a2a2a' // dark
  ];

  const effectColor = (effect: AnnotationEffect) => annotationEffectDefinition(effect)?.color ?? '#ffffff';

  interface Props {
    opacity: number;
    brushSize: number;
    color: string;
    activeLayerIndex: number;
    currentEffect?: AnnotationEffect;
    /** Eraser on: strokes remove paint from the active layer */
    erasing?: boolean;
    onOpacityChange: (value: number) => void;
    onBrushSizeChange: (value: number) => void;
    onColorChange: (color: string, opacity: number) => void;
    onEffectChange?: (effect: AnnotationEffect) => void;
    onEraserToggle?: () => void;
    onLayersClick: () => void;
  }

  let {
    opacity,
    brushSize,
    color,
    activeLayerIndex,
    currentEffect = AnnotationEffect.None,
    erasing = false,
    onOpacityChange,
    onBrushSizeChange,
    onColorChange,
    onEffectChange,
    onEraserToggle,
    onLayersClick
  }: Props = $props();

  // One category of animated previews at a time: each preview is a WebGL context and browsers keep about 16
  let effectCategory = $state<AnnotationEffectCategory>('elements');
  const openPalette = () => {
    effectCategory = annotationEffectDefinition(currentEffect)?.category ?? effectCategory;
  };

  // Select the appropriate icon based on layer count
  const layerIcons: ComponentType[] = [
    IconBoxMultiple1,
    IconBoxMultiple2,
    IconBoxMultiple3,
    IconBoxMultiple4,
    IconBoxMultiple5,
    IconBoxMultiple6,
    IconBoxMultiple7,
    IconBoxMultiple8,
    IconBoxMultiple9
  ];

  const layerIcon = $derived.by(() => {
    // activeLayerIndex is 1-based (1st layer, 2nd layer, etc.)
    return activeLayerIndex <= 9 && activeLayerIndex > 0 ? layerIcons[activeLayerIndex - 1] : IconBoxMultiple;
  });

  // Check if current selection is an effect
  const hasEffect = $derived(currentEffect !== AnnotationEffect.None);

  // Brush size is stored in grid units (number of grid squares the line width
  // spans on the display): quarter-square steps up to one square, then whole squares.
  // The slider operates on indices into this list since the steps are non-uniform.
  const BRUSH_SIZES = [0.25, 0.5, 0.75, 1, 2, 3, 4, 5];

  const brushSliderIndex = $derived(
    BRUSH_SIZES.reduce(
      (best, size, i) => (Math.abs(size - brushSize) < Math.abs(BRUSH_SIZES[best] - brushSize) ? i : best),
      0
    )
  );

  const handleBrushSliderChange = (index: number) => {
    onBrushSizeChange(BRUSH_SIZES[Math.max(0, Math.min(BRUSH_SIZES.length - 1, Math.round(index)))]);
  };

  const handleColorSelect = (selectedColor: string, close?: () => void) => {
    // Picking a color or effect goes back to drawing
    if (erasing) onEraserToggle?.();
    onColorChange(selectedColor, opacity);
    // Clear any active effect when selecting a color
    onEffectChange?.(AnnotationEffect.None);
    close?.();
  };

  const handleEffectSelect = (effect: AnnotationEffect, close?: () => void) => {
    if (erasing) onEraserToggle?.();
    // Set color to match the effect for the opacity slider gradient
    onColorChange(effectColor(effect), opacity);
    onEffectChange?.(effect);
    close?.();
  };

  // Touch event handlers for better mobile support
  const handleTouchStart = (e: TouchEvent) => {
    // Prevent default to avoid conflicts with other touch interactions
    e.stopPropagation();
  };

  const handleTouchMove = (e: TouchEvent) => {
    // Prevent scrolling while adjusting sliders
    e.preventDefault();
    e.stopPropagation();
  };
</script>

<div class="drawingSliders">
  <div class="drawingSliders__slider">
    <Popover
      portal="body"
      positioning={{ placement: 'left', gutter: 12 }}
      onIsOpenChange={(open) => open && openPalette()}
    >
      {#snippet trigger()}
        <button class="drawingSliders__colorSwatch" aria-label="Change annotation color or effect">
          {#if hasEffect}
            <EffectPreview effectType={currentEffect} size="2rem" shape="rounded" />
          {:else}
            <span class="drawingSliders__colorSwatchInner" style:background-color={color} style:opacity></span>
          {/if}
        </button>
      {/snippet}
      {#snippet content({ contentProps })}
        <div class="drawingSliders__swatchGrid">
          {#each COLORS as swatchColor}
            <button
              class="drawingSliders__gridItem"
              onclick={() => handleColorSelect(swatchColor, contentProps.close)}
              aria-label="Select color {swatchColor}"
            >
              <span class="drawingSliders__gridSwatch" style:background-color={swatchColor}></span>
            </button>
          {/each}
        </div>
        <div class="drawingSliders__tabs" role="tablist" aria-label="Effect categories">
          {#each ANNOTATION_EFFECT_CATEGORIES as category (category.id)}
            <button
              role="tab"
              aria-selected={effectCategory === category.id}
              class={['drawingSliders__tab', effectCategory === category.id && 'drawingSliders__tab--active']}
              title={category.description}
              onclick={() => (effectCategory = category.id)}
            >
              {category.label}
            </button>
          {/each}
        </div>
        <div class="drawingSliders__swatchGrid" role="tabpanel">
          {#each annotationEffectsInCategory(effectCategory) as definition (definition.effect)}
            <button
              class={[
                'drawingSliders__gridItem',
                currentEffect === definition.effect && 'drawingSliders__gridItem--active'
              ]}
              onclick={() => handleEffectSelect(definition.effect, contentProps.close)}
              aria-label="Select effect {definition.label}"
              title="{definition.label}: {definition.hint}"
            >
              <EffectPreview effectType={definition.effect} size="2rem" shape="rounded" />
            </button>
          {/each}
        </div>
      {/snippet}
    </Popover>
    <input
      id="opacity-slider"
      type="range"
      class="drawingSliders__input drawingSliders__input--opacity"
      style="--slider-color: {color}"
      min="0"
      max="1"
      step="0.01"
      value={opacity}
      oninput={(e) => onOpacityChange(Number(e.currentTarget.value))}
      ontouchstart={handleTouchStart}
      ontouchmove={handleTouchMove}
    />
    <div class="drawingSliders__value">{Math.round(opacity * 100)}%</div>
  </div>

  <div class="drawingSliders__slider">
    <input
      id="brush-size-slider"
      type="range"
      class="drawingSliders__input"
      min="0"
      max={BRUSH_SIZES.length - 1}
      step="1"
      value={brushSliderIndex}
      oninput={(e) => handleBrushSliderChange(Number(e.currentTarget.value))}
      ontouchstart={handleTouchStart}
      ontouchmove={handleTouchMove}
      title="Brush size in grid squares"
    />
    <div class="drawingSliders__value">{String(Number(brushSize.toFixed(2))).replace(/^0\./, '.')} sq</div>
  </div>

  {#if onEraserToggle}
    <IconButton
      variant={erasing ? 'primary' : 'ghost'}
      onclick={onEraserToggle}
      aria-label={erasing ? 'Stop erasing' : 'Eraser'}
      aria-pressed={erasing}
      title={erasing ? 'Stop erasing' : 'Erase from the active layer'}
    >
      <Icon Icon={IconEraser} size="1.25rem" />
    </IconButton>
  {/if}

  <IconButton
    variant="ghost"
    onclick={onLayersClick}
    aria-label="Toggle annotation layers panel"
    title="Manage drawing layers"
  >
    <Icon Icon={layerIcon} size="1.25rem" />
  </IconButton>
</div>

<style>
  .drawingSliders {
    position: absolute;
    top: 50%;
    right: 1rem;
    transform: translateY(-50%);
    display: flex;
    flex-direction: column;
    gap: 1rem;
    z-index: 10;
    pointer-events: auto;
    background-color: var(--bg);
    border: var(--borderThin);
    border-radius: var(--radius-2);
    padding: 0.5rem 0rem;
    align-items: center;
  }

  .drawingSliders__slider {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
  }

  .drawingSliders__input {
    writing-mode: vertical-lr;
    direction: rtl;
    width: 32px;
    height: 120px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--contrastLow);
    border-radius: var(--radius-1);
    cursor: pointer;
    touch-action: none; /* Prevent default touch behaviors */
    outline: none;
  }

  .drawingSliders__input--opacity {
    background: linear-gradient(to top, transparent, var(--slider-color));
  }

  /* Webkit browsers (Chrome, Safari, Edge) */
  .drawingSliders__input::-webkit-slider-track {
    width: 32px;
    height: 120px;
    background: transparent;
    border: none;
  }

  .drawingSliders__input::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 32px;
    height: 14px;
    background: var(--contrastHigh);
    border: none;
    border-radius: var(--radius-1);
    cursor: grab;
    box-shadow: 0 0px 2px rgba(0, 0, 0, 0.2);
  }

  .drawingSliders__input::-webkit-slider-thumb:active {
    cursor: grabbing;
  }

  /* Firefox */
  .drawingSliders__input::-moz-range-track {
    width: 32px;
    height: 120px;
    background: var(--contrastLow);
    border-radius: var(--radius-2);
  }

  .drawingSliders__input--opacity::-moz-range-track {
    background: linear-gradient(to top, transparent, var(--slider-color));
  }

  .drawingSliders__input::-moz-range-thumb {
    width: 32px;
    height: 14px;
    background: var(--contrastHigh);
    border: none;
    border-radius: var(--radius-2);
    cursor: grab;
    box-shadow: 0 0px 2px rgba(0, 0, 0, 0.2);
  }

  .drawingSliders__input::-moz-range-thumb:active {
    cursor: grabbing;
  }

  .drawingSliders__value {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--fg);
    min-width: 3rem;
    text-align: center;
  }

  .drawingSliders__colorSwatch {
    width: 2rem;
    height: 2rem;
    border-radius: var(--radius-2);
    cursor: pointer;
    transition: border-color 0.2s;
    padding: 0;
    border: none;
    background: transparent;
    overflow: hidden;
  }

  .drawingSliders__colorSwatchInner {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: var(--radius-2);
  }

  .drawingSliders__swatchGrid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.5rem;
    background-color: var(--bg);
    border-radius: var(--radius-2);
  }

  .drawingSliders__gridItem {
    width: 2rem;
    height: 2rem;
    border-radius: var(--radius-2);
    cursor: pointer;
    border: none;
    padding: 0;
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .drawingSliders__gridItem--active {
    box-shadow: 0 0 0 2px var(--fg);
  }

  .drawingSliders__tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    max-width: 9.5rem;
    margin: 0.75rem 0 0.5rem;
  }

  .drawingSliders__tab {
    padding: 0.125rem 0.375rem;
    font-size: 0.75rem;
    color: var(--fgMuted);
    background: transparent;
    border: var(--borderThin);
    border-radius: var(--radius-1);
    cursor: pointer;
  }

  .drawingSliders__tab--active {
    color: var(--fg);
    border-color: var(--fg);
  }

  .drawingSliders__gridSwatch {
    width: 2rem;
    height: 2rem;
    border-radius: var(--radius-1);
  }
</style>
