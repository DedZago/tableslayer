<script module lang="ts">
  export type SidePanelTab = 'tokens' | 'library' | 'handout';
</script>

<script lang="ts">
  import { Icon } from '@tableslayer/ui';
  import { IconBooks, IconPhoto, IconSwords, IconUsers } from '@tabler/icons-svelte';

  let {
    selected,
    onSelect,
    handoutLive,
    combatLive,
    combatOpen,
    onCombatToggle,
    showLibrary,
    showHandout
  }: {
    selected: SidePanelTab;
    onSelect: (tab: SidePanelTab) => void;
    handoutLive: boolean;
    combatLive: boolean;
    /** The combat column sits beside the tabs; this button only shows or hides it */
    combatOpen: boolean;
    onCombatToggle: () => void;
    showLibrary: boolean;
    showHandout: boolean;
  } = $props();

  type TabItem = { id: SidePanelTab; label: string; icon: unknown; live: boolean };
  const tabs: TabItem[] = $derived([
    { id: 'tokens', label: 'Tokens', icon: IconUsers, live: false },
    ...(showLibrary ? [{ id: 'library' as const, label: 'Library', icon: IconBooks, live: false }] : []),
    ...(showHandout ? [{ id: 'handout' as const, label: 'Handout', icon: IconPhoto, live: handoutLive }] : [])
  ]);

  const onKeydown = (event: KeyboardEvent) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.id === selected);
    const next = tabs[(index + step + tabs.length) % tabs.length];
    onSelect(next.id);
    (event.currentTarget as HTMLElement).querySelector<HTMLElement>(`#sidePanelTab-${next.id}`)?.focus();
  };
</script>

<div class="sidePanelTabs">
  <div class="sidePanelTabs__list" role="tablist" aria-label="Side panel" tabindex="-1" onkeydown={onKeydown}>
    {#each tabs as tab (tab.id)}
      <button
        type="button"
        role="tab"
        id="sidePanelTab-{tab.id}"
        aria-controls="sidePanel-{tab.id}"
        aria-selected={selected === tab.id}
        tabindex={selected === tab.id ? 0 : -1}
        class={['sidePanelTabs__tab', selected === tab.id && 'sidePanelTabs__tab--isActive']}
        aria-label={tab.label}
        title={tab.label}
        onclick={() => onSelect(tab.id)}
      >
        <Icon Icon={tab.icon} size="14px" />
        <span class="sidePanelTabs__label">{tab.label}</span>
        {#if tab.live}
          <span class="sidePanelTabs__liveDot" role="img" aria-label="{tab.label} is live"></span>
        {/if}
      </button>
    {/each}
  </div>
  <button
    type="button"
    class={['sidePanelTabs__tab', 'sidePanelTabs__combat', combatOpen && 'sidePanelTabs__tab--isActive']}
    aria-label="Combat"
    aria-pressed={combatOpen}
    aria-controls="combatColumn"
    title={combatOpen ? 'Hide the initiative column' : 'Show the initiative column'}
    onclick={onCombatToggle}
  >
    <Icon Icon={IconSwords} size="14px" />
    <span class="sidePanelTabs__label">Combat</span>
    {#if combatLive}
      <span class="sidePanelTabs__liveDot" role="img" aria-label="Combat is live"></span>
    {/if}
  </button>
</div>

<style>
  .sidePanelTabs {
    display: flex;
    gap: 0.25rem;
    flex-shrink: 0;
    padding: 0.5rem 1rem;
    border-bottom: var(--borderThin);
    position: sticky;
    top: 0;
    background: var(--bg);
    z-index: 1;
    container-type: inline-size;
  }
  .sidePanelTabs__list {
    flex: 1;
    display: flex;
    gap: 0.25rem;
    min-width: 0;
  }
  .sidePanelTabs__combat {
    flex: 0 0 auto;
  }
  .sidePanelTabs__tab {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
    padding: 0.375rem 0.5rem;
    border: 2px solid transparent;
    border-radius: var(--radius-2);
    background: transparent;
    color: var(--fgMuted);
    font-size: 0.875rem;
    cursor: pointer;
    min-width: 0;
    white-space: nowrap;
  }
  .sidePanelTabs__label {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* A narrow panel keeps only the icons (names stay as tooltips) so tabs never overlap the combat toggle */
  @container (max-width: 380px) {
    .sidePanelTabs__label {
      display: none;
    }
  }
  .sidePanelTabs__tab:hover {
    background: var(--menuItemHover);
    color: var(--fg);
  }
  .sidePanelTabs__tab:focus-visible {
    outline: none;
    border-color: var(--fgPrimary);
  }
  .sidePanelTabs__tab--isActive {
    background: var(--contrastLow);
    border-bottom-color: var(--fgPrimary);
    color: var(--fg);
    font-weight: 600;
  }
  .sidePanelTabs__liveDot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--fgSuccess);
  }
</style>
