<script module lang="ts">
  export type SidePanelTab = 'tokens' | 'library' | 'handout' | 'combat';
</script>

<script lang="ts">
  import { Icon } from '@tableslayer/ui';
  import { IconBooks, IconPhoto, IconSwords, IconUsers } from '@tabler/icons-svelte';

  let {
    selected,
    onSelect,
    handoutLive,
    combatLive,
    showLibrary,
    showHandout
  }: {
    selected: SidePanelTab;
    onSelect: (tab: SidePanelTab) => void;
    handoutLive: boolean;
    combatLive: boolean;
    showLibrary: boolean;
    showHandout: boolean;
  } = $props();

  type TabItem = { id: SidePanelTab; label: string; icon: unknown; live: boolean };
  const tabs: TabItem[] = $derived([
    { id: 'tokens', label: 'Tokens', icon: IconUsers, live: false },
    ...(showLibrary ? [{ id: 'library' as const, label: 'Library', icon: IconBooks, live: false }] : []),
    ...(showHandout ? [{ id: 'handout' as const, label: 'Handout', icon: IconPhoto, live: handoutLive }] : []),
    { id: 'combat' as const, label: 'Combat', icon: IconSwords, live: combatLive }
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

{#if tabs.length > 1}
  <div class="sidePanelTabs" role="tablist" aria-label="Side panel" tabindex="-1" onkeydown={onKeydown}>
    {#each tabs as tab (tab.id)}
      <button
        type="button"
        role="tab"
        id="sidePanelTab-{tab.id}"
        aria-controls="sidePanel-{tab.id}"
        aria-selected={selected === tab.id}
        tabindex={selected === tab.id ? 0 : -1}
        class={['sidePanelTabs__tab', selected === tab.id && 'sidePanelTabs__tab--isActive']}
        onclick={() => onSelect(tab.id)}
      >
        <Icon Icon={tab.icon} size="14px" />
        <span>{tab.label}</span>
        {#if tab.live}
          <span class="sidePanelTabs__liveDot" role="img" aria-label="{tab.label} is live"></span>
        {/if}
      </button>
    {/each}
  </div>
{/if}

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
