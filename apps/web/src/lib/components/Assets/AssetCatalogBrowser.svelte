<script module lang="ts">
  export type CatalogFilters = {
    search: string;
    source: string;
    crRange: string;
    creatureType: string;
    offset: number;
  };
  export type CatalogSource = { source: string; count: number };
</script>

<script lang="ts">
  import { Icon, IconButton, Input, Popover, Select } from '@tableslayer/ui';
  import { IconDots } from '@tabler/icons-svelte';
  import type { SelectOption } from '@tableslayer/ui';

  const topSourceCount = 6;
  const crOptions: SelectOption[] = [
    { value: '', label: 'Any CR' },
    { value: '0-0.5', label: '0 to 1/2' },
    { value: '1-4', label: '1 to 4' },
    { value: '5-10', label: '5 to 10' },
    { value: '11-16', label: '11 to 16' },
    { value: '17-99', label: '17+' }
  ];
  const creatureTypes = [
    'aberration',
    'beast',
    'celestial',
    'construct',
    'dragon',
    'elemental',
    'fey',
    'fiend',
    'giant',
    'humanoid',
    'monstrosity',
    'ooze',
    'plant',
    'undead'
  ];
  const typeOptions: SelectOption[] = [
    { value: '', label: 'Any type' },
    ...creatureTypes.map((type) => ({ value: type, label: type.charAt(0).toUpperCase() + type.slice(1) }))
  ];

  let {
    searchElement = $bindable(),
    filters,
    sources,
    busy = false,
    onFiltersChange,
    onUploadFile,
    onRefresh
  }: {
    searchElement?: HTMLInputElement;
    filters: CatalogFilters;
    sources: CatalogSource[];
    busy?: boolean;
    onFiltersChange: (patch: Partial<CatalogFilters>) => void;
    onUploadFile: (file: File) => void;
    onRefresh: () => void;
  } = $props();

  let searchText = $state('');
  let menuOpen = $state(false);
  let moreOpen = $state(false);
  let fileInput = $state<HTMLInputElement>();

  $effect(() => {
    const value = searchText;
    const timer = setTimeout(() => {
      if (value !== filters.search) onFiltersChange({ search: value, offset: 0 });
    }, 200);
    return () => clearTimeout(timer);
  });

  const rankedSources = $derived([...sources].sort((a, b) => b.count - a.count || a.source.localeCompare(b.source)));
  const topSources = $derived(rankedSources.slice(0, topSourceCount));
  const restSources = $derived(rankedSources.slice(topSourceCount));
  const restSourceActive = $derived(restSources.some((item) => item.source === filters.source));

  export const closeMenus = () => {
    const wasOpen = menuOpen || moreOpen;
    menuOpen = false;
    moreOpen = false;
    return wasOpen;
  };

  const pickSource = (source: string) => {
    moreOpen = false;
    onFiltersChange({ source, offset: 0 });
  };

  const handleFile = (event: Event & { currentTarget: HTMLInputElement }) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) onUploadFile(file);
  };
</script>

<div class="assetCatalog__toolbar">
  <Input
    class="assetCatalog__search"
    type="search"
    aria-label="Search creatures"
    placeholder="Search creatures…"
    hideAutocomplete
    bind:element={searchElement}
    bind:value={searchText}
  />
  <Popover bind:isOpen={menuOpen} positioning={{ placement: 'bottom-end', gutter: 8 }}>
    {#snippet trigger()}
      <IconButton
        variant="ghost"
        size="md"
        aria-label="More catalog actions"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <Icon Icon={IconDots} size="1.25rem" />
      </IconButton>
    {/snippet}
    {#snippet content({ contentProps })}
      <div class="assetCatalog__menu" role="menu">
        <button
          type="button"
          role="menuitem"
          class="assetCatalog__menuItem"
          disabled={busy}
          onclick={() => {
            contentProps.close();
            fileInput?.click();
          }}
        >
          Upload bestiary JSON
        </button>
        <button
          type="button"
          role="menuitem"
          class="assetCatalog__menuItem"
          disabled={busy}
          onclick={() => {
            contentProps.close();
            onRefresh();
          }}
        >
          Refresh catalog
        </button>
      </div>
    {/snippet}
  </Popover>
  <input
    bind:this={fileInput}
    class="assetCatalog__fileInput"
    type="file"
    accept="application/json,.json"
    aria-label="Bestiary JSON"
    disabled={busy}
    onchange={handleFile}
  />
</div>

<div class="assetCatalog__chips" role="group" aria-label="Filter by source">
  <button
    type="button"
    class="assetCatalog__chip"
    class:assetCatalog__chip--active={!filters.source}
    aria-pressed={!filters.source}
    onclick={() => pickSource('')}
  >
    All
  </button>
  {#each topSources as item (item.source)}
    <button
      type="button"
      class="assetCatalog__chip"
      class:assetCatalog__chip--active={filters.source === item.source}
      aria-pressed={filters.source === item.source}
      onclick={() => pickSource(item.source)}
    >
      {item.source}
    </button>
  {/each}
  {#if restSources.length}
    <Popover bind:isOpen={moreOpen} positioning={{ placement: 'bottom-start', gutter: 8 }}>
      {#snippet trigger()}
        <button
          type="button"
          class="assetCatalog__chip"
          class:assetCatalog__chip--active={restSourceActive}
          aria-expanded={moreOpen}
        >
          More ▾
        </button>
      {/snippet}
      {#snippet content()}
        <div class="assetCatalog__menu assetCatalog__menu--sources" role="menu" aria-label="More sources">
          {#each restSources as item (item.source)}
            <button
              type="button"
              role="menuitemradio"
              aria-checked={filters.source === item.source}
              class="assetCatalog__menuItem"
              onclick={() => pickSource(item.source)}
            >
              <span>{item.source}</span>
              <span class="assetCatalog__menuCount">{item.count.toLocaleString()}</span>
            </button>
          {/each}
        </div>
      {/snippet}
    </Popover>
  {/if}
</div>

<div class="assetCatalog__filters">
  <Select
    aria-label="Challenge rating"
    selected={[filters.crRange]}
    options={crOptions}
    onSelectedChange={(value) => onFiltersChange({ crRange: value[0] ?? '', offset: 0 })}
  />
  <Select
    aria-label="Creature type"
    selected={[filters.creatureType]}
    options={typeOptions}
    onSelectedChange={(value) => onFiltersChange({ creatureType: value[0] ?? '', offset: 0 })}
  />
</div>

<style>
  .assetCatalog__toolbar {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .assetCatalog__toolbar :global(.assetCatalog__search) {
    flex: 1;
    min-width: 0;
  }
  .assetCatalog__fileInput {
    display: none;
  }
  .assetCatalog__chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }
  .assetCatalog__chip {
    height: 1.75rem;
    padding: 0 0.625rem;
    font-size: 0.8125rem;
    color: var(--fg);
    background: transparent;
    border: var(--borderThin);
    border-radius: 999px;
    cursor: pointer;
  }
  .assetCatalog__chip:hover {
    border-color: var(--fgPrimary);
  }
  .assetCatalog__chip:focus-visible {
    outline: 2px solid var(--fgPrimary);
    outline-offset: 2px;
  }
  .assetCatalog__chip--active {
    border-color: var(--fgPrimary);
    background: var(--contrastLow);
    font-weight: 600;
  }
  .assetCatalog__filters {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
  }
  .assetCatalog__menu {
    display: flex;
    flex-direction: column;
    min-width: 12rem;
    max-height: 20rem;
    overflow-y: auto;
    padding: 0.25rem;
    background: var(--popoverBg);
    border: var(--borderThin);
    border-radius: var(--radius-2);
    box-shadow: var(--shadow-3);
  }
  .assetCatalog__menuItem {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    text-align: left;
    color: var(--fg);
    background: none;
    border: none;
    border-radius: var(--radius-2);
    cursor: pointer;
  }
  .assetCatalog__menuItem:hover:not(:disabled),
  .assetCatalog__menuItem:focus-visible {
    background: var(--menuItemHover);
    outline: none;
  }
  .assetCatalog__menuItem:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .assetCatalog__menuCount {
    color: var(--fgMuted);
    font-size: 0.8125rem;
  }
</style>
