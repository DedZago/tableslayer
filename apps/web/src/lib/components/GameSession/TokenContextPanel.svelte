<script lang="ts">
  import { Icon, RadioButton } from '@tableslayer/ui';
  import { IconBooks, IconPin, IconPinFilled, IconPresentation, IconX } from '@tabler/icons-svelte';
  import { MarkerVisibility } from '@tableslayer/stage';
  import type { ComponentProps } from 'svelte';
  import ConditionPicker from './ConditionPicker.svelte';
  import TokenEditorTabs from './TokenEditorTabs.svelte';

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

  type PanelTab = 'conditions' | 'combat';
  let selectedTab = $state<PanelTab>('conditions');
  const tabs = $derived([
    { id: 'conditions', label: 'Conditions', badge: conditions.active.length },
    ...(onCombatAction ? [{ id: 'combat', label: 'Combat' }] : [])
  ]);
  const currentTab = $derived(tabs.some((tab) => tab.id === selectedTab) ? selectedTab : 'conditions');

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
    <button type="button" class="tokenContextPanel__iconButton" aria-label="Close" title="Close" onclick={onClose}>
      <Icon Icon={IconX} size="1rem" />
    </button>
  </div>

  {#if onVisibilityChange || onPinToggle || onShowAsHandout || onSaveToLibrary}
    <div class="tokenContextPanel__quick">
      {#if onVisibilityChange}
        <RadioButton
          selected={visibility === undefined ? '' : visibility.toString()}
          options={visibilityOptions}
          onSelectedChange={(value) => onVisibilityChange(Number(value) as MarkerVisibility)}
        />
      {/if}
      <div class="tokenContextPanel__quickButtons">
        {#if onPinToggle}
          <button
            type="button"
            class={['tokenContextPanel__iconButton', pinned && 'tokenContextPanel__iconButton--isActive']}
            aria-pressed={pinned}
            aria-label="Pin tooltip for players"
            title="Pin tooltip for players"
            onclick={() => onPinToggle(!pinned)}
          >
            <Icon Icon={pinned ? IconPinFilled : IconPin} size="1.125rem" />
          </button>
        {/if}
        {#if onShowAsHandout}
          <button
            type="button"
            class="tokenContextPanel__iconButton"
            aria-label="Show as handout"
            title="Show as handout"
            onclick={onShowAsHandout}
          >
            <Icon Icon={IconPresentation} size="1.125rem" />
          </button>
        {/if}
        {#if onSaveToLibrary}
          <button
            type="button"
            class="tokenContextPanel__iconButton"
            aria-label="Save to library"
            title="Save to library"
            onclick={onSaveToLibrary}
          >
            <Icon Icon={IconBooks} size="1.125rem" />
          </button>
        {/if}
      </div>
    </div>
  {/if}

  {#if tabs.length > 1}
    <TokenEditorTabs
      {tabs}
      selected={currentTab}
      onSelect={(id) => (selectedTab = id as PanelTab)}
      idPrefix="tokenContext"
      label="Token actions"
    />
  {/if}

  <div
    class="tokenContextPanel__body"
    role={tabs.length > 1 ? 'tabpanel' : undefined}
    id="tokenContextPanel-{currentTab}"
    aria-labelledby={tabs.length > 1 ? `tokenContextTab-${currentTab}` : undefined}
  >
    {#if currentTab === 'conditions'}
      <ConditionPicker {...conditions} />
    {:else if onCombatAction}
      <div class="tokenContextPanel__actions">
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
      </div>
    {/if}
  </div>

  <div class="tokenContextPanel__footer">
    <button type="button" class="tokenContextPanel__action tokenContextPanel__action--danger" onclick={handleDelete}>
      Delete marker
    </button>
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
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.5rem 0.5rem 0.5rem 1rem;
    border-bottom: var(--borderThin);
  }

  .tokenContextPanel__title {
    min-width: 0;
    overflow: hidden;
    font-weight: var(--font-weight-6);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tokenContextPanel__quick {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
  }

  .tokenContextPanel__quickButtons {
    display: flex;
    gap: 0.25rem;
  }

  .tokenContextPanel__iconButton {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    flex-shrink: 0;
    color: var(--fgMuted);
    background: none;
    border: none;
    border-radius: var(--radius-2);
    cursor: pointer;
  }

  .tokenContextPanel__iconButton:hover {
    background: var(--menuItemHover);
    color: var(--fg);
  }

  .tokenContextPanel__iconButton--isActive {
    color: var(--fgPrimary);
  }

  .tokenContextPanel__body {
    padding: 0.75rem 1rem;
    overflow-y: auto;
    min-height: 0;
  }

  .tokenContextPanel__actions {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .tokenContextPanel__footer {
    padding: 0.25rem 0.5rem;
    border-top: var(--borderThin);
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
