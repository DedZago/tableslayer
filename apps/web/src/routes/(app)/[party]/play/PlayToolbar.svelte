<script lang="ts">
  import { Icon } from '@tableslayer/ui';
  import { AOE_EFFECT_LABELS, AoeShape, type AoeEffect } from '@tableslayer/stage';
  import {
    IconCircle,
    IconCone2,
    IconRectangleVertical,
    IconArrowBackUp,
    IconArrowForwardUp,
    IconArrowsMaximize,
    IconRuler2,
    IconSelectAll,
    IconSquare,
    IconTrash
  } from '@tabler/icons-svelte';
  import { AOE_EFFECT_ORDER, AOE_EFFECT_SWATCHES } from '$lib/utils/aoeEffectSwatches';
  import type { PlayTools } from './usePlayTools.svelte';

  let {
    tools,
    templates = [],
    showFit = false,
    onFit
  }: {
    tools: PlayTools;
    templates?: Array<{ id: string; effect: AoeEffect }>;
    showFit?: boolean;
    onFit?: () => void;
  } = $props();

  const shapes = [
    { value: AoeShape.Circle, label: 'Circle', icon: IconCircle },
    { value: AoeShape.Square, label: 'Cube', icon: IconSquare },
    { value: AoeShape.Cone, label: 'Cone', icon: IconCone2 },
    { value: AoeShape.Line, label: 'Line', icon: IconRectangleVertical }
  ];

  const swatchEffect = $derived(tools.aoeSwatchEffect(templates));
  const aoeIcon = $derived(shapes.find((shape) => shape.value === tools.aoeTool.shape)?.icon ?? IconCone2);
</script>

<div class="playToolbar" data-testid="playToolbar">
  {#if tools.isAoeActive}
    <div class="playToolbar__row">
      {#each shapes as shape (shape.value)}
        <button
          type="button"
          class={['playToolbar__button', tools.aoeTool.shape === shape.value && 'playToolbar__button--active']}
          aria-label={shape.label}
          aria-pressed={tools.aoeTool.shape === shape.value}
          onclick={() => tools.setAoeShape(shape.value)}
        >
          <Icon Icon={shape.icon} size="1.75rem" />
        </button>
      {/each}
      <span class="playToolbar__divider"></span>
      <div class="playToolbar__effects">
        {#each AOE_EFFECT_ORDER as effect (effect)}
          <button
            type="button"
            class={['playToolbar__swatch', swatchEffect === effect && 'playToolbar__swatch--active']}
            style:background={AOE_EFFECT_SWATCHES[effect]}
            aria-label={AOE_EFFECT_LABELS[effect]}
            aria-pressed={swatchEffect === effect}
            onclick={() => tools.setAoeEffect(effect)}
          ></button>
        {/each}
      </div>
      {#if tools.aoeSelectedIds.length}
        <span class="playToolbar__divider"></span>
        <button
          type="button"
          class="playToolbar__button playToolbar__button--danger"
          aria-label="Delete selected shapes"
          onclick={() => tools.deleteSelectedAoeTemplates()}
        >
          <Icon Icon={IconTrash} size="1.75rem" />
        </button>
      {/if}
    </div>
  {/if}
  <div class="playToolbar__row">
    <button
      type="button"
      class={['playToolbar__button', tools.groupSelect && 'playToolbar__button--active']}
      aria-label="Group select"
      aria-pressed={tools.groupSelect}
      onclick={() => tools.toggleGroupSelect()}
    >
      <Icon Icon={IconSelectAll} size="1.75rem" />
      <span class="playToolbar__text">
        {tools.groupSelect ? `${tools.selectedMarkerIds.length} selected` : 'Select'}
      </span>
    </button>
    <button
      type="button"
      class={['playToolbar__button', tools.distanceMode && 'playToolbar__button--active']}
      aria-label="Measure distance"
      aria-pressed={tools.distanceMode}
      onclick={() => tools.toggleDistanceMode()}
    >
      <Icon Icon={IconRuler2} size="1.75rem" />
      <span class="playToolbar__text">
        {tools.distanceMode && !tools.selectedMarkerIds.length ? 'Tap a token' : 'Distance'}
      </span>
    </button>
    <button
      type="button"
      class={['playToolbar__button', tools.isAoeActive && 'playToolbar__button--active']}
      aria-label="Area of effect"
      aria-pressed={tools.isAoeActive}
      onclick={() => tools.toggleAoe()}
    >
      <Icon Icon={aoeIcon} size="1.75rem" />
      <span class="playToolbar__text">AoE</span>
    </button>
    <button
      type="button"
      class="playToolbar__button"
      aria-label="Undo"
      disabled={!tools.canUndo}
      onclick={() => tools.undo()}
    >
      <Icon Icon={IconArrowBackUp} size="1.75rem" />
      <span class="playToolbar__text">Undo</span>
    </button>
    <button
      type="button"
      class="playToolbar__button"
      aria-label="Redo"
      disabled={!tools.canRedo}
      onclick={() => tools.redo()}
    >
      <Icon Icon={IconArrowForwardUp} size="1.75rem" />
      <span class="playToolbar__text">Redo</span>
    </button>
    {#if showFit}
      <button type="button" class="playToolbar__button" aria-label="Fit view" onclick={() => onFit?.()}>
        <Icon Icon={IconArrowsMaximize} size="1.75rem" />
        <span class="playToolbar__text">Fit</span>
      </button>
    {/if}
  </div>
</div>

<style>
  .playToolbar {
    position: fixed;
    left: 50%;
    bottom: calc(1rem + env(safe-area-inset-bottom));
    z-index: 5;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    max-width: calc(100vw - 2rem);
    transform: translateX(-50%);
    touch-action: manipulation;
  }

  .playToolbar__row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    max-width: 100%;
    padding: 0.5rem;
    background: var(--surfaceBg);
    border: var(--borderThin);
    border-radius: var(--radius-4);
    box-shadow: var(--shadow-1);
  }

  .playToolbar__button:disabled {
    opacity: 0.35;
    pointer-events: none;
  }

  .playToolbar__button {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.125rem;
    min-width: 3.5rem;
    min-height: 3.5rem;
    padding: 0.25rem 0.75rem;
    font: inherit;
    font-size: 0.75rem;
    color: var(--fg);
    background: transparent;
    border: 0;
    border-radius: var(--radius-3);
    cursor: pointer;
  }

  .playToolbar__button:hover {
    background: var(--menuItemHover);
  }

  .playToolbar__button--active {
    color: var(--fgPrimary);
    background: var(--contrastLow);
  }

  .playToolbar__button--danger {
    color: var(--fgDanger);
  }

  .playToolbar__text {
    white-space: nowrap;
  }

  .playToolbar__divider {
    align-self: stretch;
    width: 1px;
    background: var(--contrastLow);
  }

  .playToolbar__effects {
    display: flex;
    gap: 0.5rem;
    max-width: 24rem;
    overflow-x: auto;
    padding: 0.25rem;
  }

  .playToolbar__swatch {
    flex: none;
    width: 2.75rem;
    height: 2.75rem;
    padding: 0;
    border: 2px solid transparent;
    border-radius: 50%;
    cursor: pointer;
  }

  .playToolbar__swatch--active {
    border-color: var(--fg);
  }
</style>
