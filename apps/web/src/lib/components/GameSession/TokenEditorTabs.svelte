<script lang="ts">
  export type TokenEditorTab = { id: string; label: string; badge?: number };

  let {
    tabs,
    selected,
    onSelect,
    idPrefix,
    label = 'Token editor'
  }: {
    tabs: TokenEditorTab[];
    selected: string;
    onSelect: (id: string) => void;
    /** Makes element ids unique when two editors are on screen */
    idPrefix: string;
    label?: string;
  } = $props();

  const onKeydown = (event: KeyboardEvent) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = tabs.findIndex((tab) => tab.id === selected);
    const next = tabs[(index + step + tabs.length) % tabs.length];
    onSelect(next.id);
    (event.currentTarget as HTMLElement).querySelector<HTMLElement>(`#${idPrefix}Tab-${next.id}`)?.focus();
  };
</script>

<div class="tokenEditorTabs" role="tablist" aria-label={label} tabindex="-1" onkeydown={onKeydown}>
  {#each tabs as tab (tab.id)}
    <button
      type="button"
      role="tab"
      id="{idPrefix}Tab-{tab.id}"
      aria-controls="{idPrefix}Panel-{tab.id}"
      aria-selected={selected === tab.id}
      tabindex={selected === tab.id ? 0 : -1}
      class={['tokenEditorTabs__tab', selected === tab.id && 'tokenEditorTabs__tab--isActive']}
      onclick={() => onSelect(tab.id)}
    >
      <span class="tokenEditorTabs__label">{tab.label}</span>
      {#if tab.badge}
        <span class="tokenEditorTabs__badge" aria-label="{tab.badge} active">{tab.badge}</span>
      {/if}
    </button>
  {/each}
</div>

<style>
  .tokenEditorTabs {
    display: flex;
    gap: 0.25rem;
    border-bottom: var(--borderThin);
  }
  .tokenEditorTabs__tab {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.375rem;
    min-width: 0;
    padding: 0.375rem 0.5rem;
    border: 2px solid transparent;
    border-radius: var(--radius-2);
    background: transparent;
    color: var(--fgMuted);
    font-size: 0.875rem;
    cursor: pointer;
    white-space: nowrap;
  }
  .tokenEditorTabs__label {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tokenEditorTabs__tab:hover {
    background: var(--menuItemHover);
    color: var(--fg);
  }
  .tokenEditorTabs__tab:focus-visible {
    outline: none;
    border-color: var(--fgPrimary);
  }
  .tokenEditorTabs__tab--isActive {
    background: var(--contrastLow);
    border-bottom-color: var(--fgPrimary);
    color: var(--fg);
    font-weight: 600;
  }
  .tokenEditorTabs__badge {
    min-width: 1.125rem;
    padding: 0 0.25rem;
    border-radius: 0.5625rem;
    background: var(--fgPrimary);
    color: var(--bg);
    font-size: 0.6875rem;
    line-height: 1.125rem;
    text-align: center;
  }
</style>
