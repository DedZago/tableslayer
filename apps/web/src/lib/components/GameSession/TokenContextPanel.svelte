<script lang="ts">
  import { Hr, RadioButton } from '@tableslayer/ui';
  import { IconCheck } from '@tabler/icons-svelte';
  import { MarkerVisibility } from '@tableslayer/stage';
  import type { ComponentProps } from 'svelte';
  import ConditionPicker from './ConditionPicker.svelte';

  type CombatAction = 'start' | 'add' | 'remove';

  let {
    name,
    targetCount,
    position,
    conditions,
    visibility,
    onVisibilityChange,
    pinned = false,
    onPinToggle,
    onShowAsHandout,
    onSaveToLibrary,
    combatState,
    targetsInCombat,
    onCombatAction,
    onDelete,
    onClose
  }: {
    name: string;
    targetCount: number;
    position: { x: number; y: number };
    conditions: ComponentProps<typeof ConditionPicker>;
    visibility?: MarkerVisibility;
    onVisibilityChange?: (visibility: MarkerVisibility) => void;
    pinned?: boolean;
    onPinToggle?: (pinned: boolean) => void;
    onShowAsHandout?: () => void;
    onSaveToLibrary?: () => void;
    combatState: 'none' | 'running';
    targetsInCombat: number;
    onCombatAction?: (action: CombatAction) => void;
    onDelete: () => void;
    onClose: () => void;
  } = $props();

  const VIEWPORT_MARGIN = 8;
  const visibilityOptions = [
    { label: 'DM', value: MarkerVisibility.DM.toString() },
    { label: 'Everyone', value: MarkerVisibility.Always.toString() },
    { label: 'On hover', value: MarkerVisibility.Hover.toString() }
  ];

  let panelElement = $state<HTMLElement>();
  let placement = $state({ left: 0, top: 0, ready: false });

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
  class="tokenContextPanel"
  role="dialog"
  aria-label="Token actions"
  style:left={`${placement.left}px`}
  style:top={`${placement.top}px`}
  style:visibility={placement.ready ? 'visible' : 'hidden'}
>
  <div class="tokenContextPanel__header">
    <span class="tokenContextPanel__title">{targetCount === 1 ? name : `${targetCount} tokens`}</span>
  </div>

  <div class="tokenContextPanel__body">
    <ConditionPicker {...conditions} />

    <Hr />

    <div class="tokenContextPanel__actions">
      {#if onVisibilityChange}
        <div class="tokenContextPanel__section">
          <span class="tokenContextPanel__label">Visibility</span>
          <RadioButton
            selected={visibility === undefined ? '' : visibility.toString()}
            options={visibilityOptions}
            onSelectedChange={(value) => onVisibilityChange(Number(value) as MarkerVisibility)}
          />
        </div>
      {/if}

      {#if onPinToggle}
        <button
          type="button"
          class="tokenContextPanel__action"
          aria-pressed={pinned}
          onclick={() => onPinToggle(!pinned)}
        >
          Pin tooltip for players
          {#if pinned}<IconCheck size="1rem" />{/if}
        </button>
      {/if}

      {#if onShowAsHandout}
        <button type="button" class="tokenContextPanel__action" onclick={onShowAsHandout}>Show as handout</button>
      {/if}

      {#if onSaveToLibrary}
        <button type="button" class="tokenContextPanel__action" onclick={onSaveToLibrary}>Save to library</button>
      {/if}

      {#if onCombatAction}
        <Hr />
        {#if combatState === 'none'}
          <button type="button" class="tokenContextPanel__action" onclick={() => onCombatAction('start')}>
            Start combat ({targetCount})
          </button>
        {:else}
          {#if targetsInCombat < targetCount}
            <button type="button" class="tokenContextPanel__action" onclick={() => onCombatAction('add')}>
              Add to combat ({targetCount - targetsInCombat})
            </button>
          {/if}
          {#if targetsInCombat > 0}
            <button type="button" class="tokenContextPanel__action" onclick={() => onCombatAction('remove')}>
              Remove from combat
            </button>
          {/if}
        {/if}
      {/if}

      <Hr />
      <button type="button" class="tokenContextPanel__action tokenContextPanel__action--danger" onclick={handleDelete}>
        Delete marker
      </button>
    </div>
  </div>
</div>

<style>
  .tokenContextPanel {
    position: fixed;
    z-index: 1000;
    width: 22rem;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--fg);
    border: var(--borderThin);
    border-radius: var(--radius-2);
    box-shadow: var(--shadow-2);
    font-size: 0.875rem;
  }

  .tokenContextPanel__header {
    padding: 0.75rem 1rem 0.5rem;
    border-bottom: var(--borderThin);
  }

  .tokenContextPanel__title {
    font-weight: var(--font-weight-6);
  }

  .tokenContextPanel__body {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    overflow-y: auto;
    min-height: 0;
  }

  .tokenContextPanel__actions {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .tokenContextPanel__section {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.25rem 0.5rem;
  }

  .tokenContextPanel__label {
    font-size: 0.75rem;
    color: var(--fgMuted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .tokenContextPanel__action {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    width: 100%;
    padding: 0.375rem 0.5rem;
    font: inherit;
    text-align: left;
    color: var(--fg);
    background: none;
    border: none;
    border-radius: var(--radius-2);
    cursor: pointer;
  }

  .tokenContextPanel__action:hover {
    background: var(--menuItemHover);
  }

  .tokenContextPanel__action--danger {
    color: var(--fgDanger);
  }
</style>
