<script lang="ts">
  import { Icon, IconButton } from '@tableslayer/ui';
  import { IconCheck, IconPlus } from '@tabler/icons-svelte';
  import { createAssetCatalogQuery } from '$lib/queries/assetImport';
  import type { FiveToolsPreview } from '$lib/server/assets/fivetools/types';

  let {
    search,
    addingIdentity = null,
    addedIdentities,
    onSelect,
    onAdd
  }: {
    search: string;
    addingIdentity?: string | null;
    addedIdentities: Set<string>;
    onSelect: (record: FiveToolsPreview) => void;
    onAdd: (record: FiveToolsPreview) => void;
  } = $props();

  const maxRows = 30;
  const catalog = createAssetCatalogQuery(
    () => search,
    () => '',
    () => 0,
    () => search.trim().length > 0,
    () => ({ crRange: '', creatureType: '' })
  );
  const records = $derived((catalog.data?.records ?? []).slice(0, maxRows));
  const isLoadingCatalog = $derived(catalog.isPending || catalog.data?.status.state === 'loading');
  const isInLibrary = (record: FiveToolsPreview) =>
    Boolean(record.duplicates?.length) || addedIdentities.has(record.identity);
  const metaOf = (record: FiveToolsPreview) =>
    [record.cr && `CR ${record.cr}`, record.creatureType, record.source].filter(Boolean).join(' · ');
</script>

<section class="catalogInline" aria-label="5etools results">
  <p class="catalogInline__heading">Not in your library. Results from 5etools</p>
  {#if catalog.error}
    <p class="catalogInline__error" role="alert">{catalog.error.message}</p>
  {:else if isLoadingCatalog && records.length === 0}
    <p class="catalogInline__status" role="status">
      {catalog.data?.status.state === 'loading'
        ? `Loading catalog (${catalog.data.status.completed}/${catalog.data.status.total})…`
        : 'Searching 5etools…'}
    </p>
  {:else if records.length === 0}
    <p class="catalogInline__status">No creatures match "{search.trim()}".</p>
  {:else}
    <ul class="catalogInline__list">
      {#each records as record (record.identity)}
        {@const inLibrary = isInLibrary(record)}
        <li class="catalogInline__row">
          <button type="button" class="catalogInline__body" onclick={() => onSelect(record)}>
            {#if record.tokenUrl}
              <img class="catalogInline__thumb" src={record.tokenUrl} alt="" loading="lazy" />
            {:else}
              <span class="catalogInline__thumb catalogInline__thumb--empty" aria-hidden="true"></span>
            {/if}
            <span class="catalogInline__text">
              <span class="catalogInline__name">{record.name}</span>
              <span class="catalogInline__meta">{metaOf(record)}</span>
            </span>
          </button>
          {#if inLibrary}
            <span class="catalogInline__owned" title="In library">
              <Icon Icon={IconCheck} size="1rem" />
            </span>
          {:else}
            <IconButton
              variant="ghost"
              size="sm"
              aria-label="Add {record.name} to library"
              title="Add to library"
              disabled={addingIdentity !== null}
              onclick={() => onAdd(record)}
            >
              <Icon Icon={IconPlus} size="1rem" />
            </IconButton>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .catalogInline {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .catalogInline__heading,
  .catalogInline__status,
  .catalogInline__error {
    margin: 0;
    padding: 0.5rem 1rem;
    font-size: 0.75rem;
    color: var(--fgMuted);
  }
  .catalogInline__error {
    color: var(--fgDanger);
  }
  .catalogInline__list {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 0 0.5rem;
    list-style: none;
    overflow-y: auto;
  }
  .catalogInline__row {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    border-radius: var(--radius-2);
  }
  .catalogInline__row:hover {
    background: var(--contrastLow);
  }
  .catalogInline__body {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    padding: 0.25rem 0.5rem;
    border: none;
    background: none;
    color: var(--fg);
    text-align: left;
    cursor: pointer;
  }
  .catalogInline__thumb {
    width: 2rem;
    height: 2rem;
    flex-shrink: 0;
    object-fit: contain;
    border-radius: var(--radius-2);
    background: var(--contrastLow);
  }
  .catalogInline__text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .catalogInline__name,
  .catalogInline__meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .catalogInline__name {
    font-size: 0.8125rem;
  }
  .catalogInline__meta {
    font-size: 0.6875rem;
    color: var(--fgMuted);
  }
  .catalogInline__owned {
    display: flex;
    padding: 0.25rem;
    color: var(--fgPrimary);
  }
</style>
