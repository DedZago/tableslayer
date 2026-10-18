<script lang="ts">
  import { Hr, RadioButton } from '@tableslayer/ui';
  import { AOE_EFFECT_LABELS, StageMode, type AoeEffect } from '@tableslayer/stage';
  import { AOE_EFFECT_ORDER, AOE_EFFECT_SWATCHES } from '$lib/utils/aoeEffectSwatches';

  let {
    targetCount,
    position,
    currentEffect,
    opacity,
    visibility,
    onEffectChange,
    onOpacityChange,
    onVisibilityChange,
    onDelete,
    onClose
  }: {
    targetCount: number;
    position: { x: number; y: number };
    currentEffect?: AoeEffect;
    opacity?: number;
    visibility?: StageMode;
    onEffectChange: (effect: AoeEffect) => void;
    onOpacityChange: (opacity: number) => void;
    onVisibilityChange?: (visibility: StageMode) => void;
    onDelete: () => void;
    onClose: () => void;
  } = $props();

  const VIEWPORT_MARGIN = 8;
  const OPACITY_STEPS = [
    { label: 'Light', value: 0.3 },
    { label: 'Medium', value: 0.6 },
    { label: 'Solid', value: 0.9 }
  ];
  const visibilityOptions = [
    { label: 'DM only', value: StageMode.DM.toString() },
    { label: 'Everyone', value: StageMode.Player.toString() }
  ];

  let panelElement = $state<HTMLElement>();
  let placement = $state({ left: 0, top: 0, ready: false });

  const title = $derived(
    targetCount > 1 ? `${targetCount} shapes` : currentEffect === undefined ? 'Shape' : AOE_EFFECT_LABELS[currentEffect]
  );

  $effect(() => {
    if (!panelElement) return;
    const { width, height } = panelElement.getBoundingClientRect();
    placement = {
      left: Math.max(VIEWPORT_MARGIN, Math.min(position.x, window.innerWidth - width - VIEWPORT_MARGIN)),
      top: Math.max(VIEWPORT_MARGIN, Math.min(position.y, window.innerHeight - height - VIEWPORT_MARGIN)),
      ready: true
    };
  });

  const portal = (node: HTMLElement) => {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  };

  const isOutsidePanel = (target: EventTarget | null) => !panelElement?.contains(target as Node);

  const handlePointerDown = (event: PointerEvent) => {
    if (isOutsidePanel(event.target)) onClose();
  };

  const handleWheel = (event: WheelEvent) => {
    if (isOutsidePanel(event.target)) onClose();
  };

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') onClose();
  };

  const handleDelete = () => {
    onDelete();
    onClose();
  };
</script>

<svelte:window onpointerdown={handlePointerDown} onwheel={handleWheel} onkeydown={handleKeydown} />

<div
  bind:this={panelElement}
  use:portal
  class="aoeContextPanel"
  role="dialog"
  aria-label="Area of effect actions"
  style:left={`${placement.left}px`}
  style:top={`${placement.top}px`}
  style:visibility={placement.ready ? 'visible' : 'hidden'}
>
  <div class="aoeContextPanel__header">
    <span class="aoeContextPanel__title">{title}</span>
  </div>

  <div class="aoeContextPanel__body">
    <div class="aoeContextPanel__section">
      <span class="aoeContextPanel__label">Effect</span>
      <div class="aoeContextPanel__effects">
        {#each AOE_EFFECT_ORDER as option (option)}
          <button
            type="button"
            class={['aoeContextPanel__swatch', currentEffect === option && 'aoeContextPanel__swatch--active']}
            style:background={AOE_EFFECT_SWATCHES[option]}
            aria-label={AOE_EFFECT_LABELS[option]}
            aria-pressed={currentEffect === option}
            title={AOE_EFFECT_LABELS[option]}
            onclick={() => onEffectChange(option)}
          ></button>
        {/each}
      </div>
    </div>

    <div class="aoeContextPanel__section">
      <span class="aoeContextPanel__label">Strength</span>
      <div class="aoeContextPanel__steps">
        {#each OPACITY_STEPS as step (step.value)}
          <button
            type="button"
            class={[
              'aoeContextPanel__step',
              opacity !== undefined && Math.abs(opacity - step.value) < 0.15 && 'aoeContextPanel__step--active'
            ]}
            onclick={() => onOpacityChange(step.value)}
          >
            {step.label}
          </button>
        {/each}
      </div>
    </div>

    {#if onVisibilityChange}
      <div class="aoeContextPanel__section">
        <span class="aoeContextPanel__label">Visibility</span>
        <RadioButton
          selected={visibility === undefined ? '' : visibility.toString()}
          options={visibilityOptions}
          onSelectedChange={(value) => onVisibilityChange(Number(value) as StageMode)}
        />
      </div>
    {/if}

    <Hr />
    <button type="button" class="aoeContextPanel__action aoeContextPanel__action--danger" onclick={handleDelete}>
      {targetCount > 1 ? 'Delete shapes' : 'Delete shape'}
    </button>
  </div>
</div>

<style>
  .aoeContextPanel {
    position: fixed;
    z-index: 1000;
    width: 22rem;
    max-width: calc(100vw - 1rem);
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--fg);
    border: var(--borderThin);
    border-radius: var(--radius-2);
    box-shadow: var(--shadow-2);
    font-size: 0.875rem;
    touch-action: manipulation;
  }

  .aoeContextPanel__header {
    padding: 0.75rem 1rem 0.5rem;
    border-bottom: var(--borderThin);
  }

  .aoeContextPanel__title {
    font-weight: var(--font-weight-6);
  }

  .aoeContextPanel__body {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    overflow-y: auto;
    min-height: 0;
  }

  .aoeContextPanel__section {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .aoeContextPanel__label {
    font-size: 0.75rem;
    color: var(--fgMuted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .aoeContextPanel__effects {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 0.375rem;
  }

  .aoeContextPanel__swatch {
    aspect-ratio: 1;
    min-height: 2.5rem;
    border: 2px solid transparent;
    border-radius: var(--radius-2);
    cursor: pointer;
    outline: none;
  }

  .aoeContextPanel__swatch--active {
    border-color: var(--fg);
    box-shadow: 0 0 0 2px var(--bg) inset;
  }

  .aoeContextPanel__steps {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.375rem;
  }

  .aoeContextPanel__step {
    min-height: 2.5rem;
    font: inherit;
    color: var(--fg);
    background: var(--contrastLow);
    border: var(--borderThin);
    border-radius: var(--radius-2);
    cursor: pointer;
  }

  .aoeContextPanel__step--active {
    border-color: var(--fg);
    background: var(--contrastMedium);
  }

  .aoeContextPanel__action {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 2.75rem;
    padding: 0.375rem 0.5rem;
    font: inherit;
    color: var(--fg);
    background: none;
    border: none;
    border-radius: var(--radius-2);
    cursor: pointer;
  }

  .aoeContextPanel__action:hover {
    background: var(--menuItemHover);
  }

  .aoeContextPanel__action--danger {
    color: var(--fgDanger);
  }
</style>
