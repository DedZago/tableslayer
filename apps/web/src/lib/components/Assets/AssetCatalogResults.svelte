<script lang="ts">
  import { Button, Icon } from '@tableslayer/ui';
  import { IconChevronLeft, IconChevronRight } from '@tabler/icons-svelte';
  import type {
    FiveToolsCatalogResult,
    FiveToolsImportResult,
    FiveToolsPreview
  } from '$lib/server/assets/fivetools/types';
  import AssetCatalogRow from './AssetCatalogRow.svelte';

  const pageSize = 100;

  let {
    catalog,
    records,
    uploaded,
    error,
    offset,
    activeIndex,
    previewIdentity,
    isSelected,
    resultFor,
    onToggle,
    onPreview,
    onPageChange
  }: {
    catalog?: FiveToolsCatalogResult;
    records: FiveToolsPreview[];
    uploaded: FiveToolsPreview[];
    error?: string;
    offset: number;
    activeIndex: number;
    previewIdentity?: string | null;
    isSelected: (identity: string) => boolean;
    resultFor: (identity: string) => FiveToolsImportResult | undefined;
    onToggle: (record: FiveToolsPreview) => void;
    onPreview: (record: FiveToolsPreview) => void;
    onPageChange: (offset: number) => void;
  } = $props();

  const total = $derived(catalog?.totalMatches ?? 0);
  const status = $derived(catalog?.status);
  const rangeEnd = $derived(Math.min(offset + pageSize, total));
  const progress = $derived(status && status.total ? Math.round((status.completed / status.total) * 100) : 0);
</script>

{#snippet row(record: FiveToolsPreview, active: boolean)}
  <AssetCatalogRow
    {record}
    selected={isSelected(record.identity)}
    previewing={previewIdentity === record.identity}
    {active}
    owned={Boolean(record.duplicates?.length)}
    result={resultFor(record.identity)}
    onToggle={() => onToggle(record)}
    onPreview={() => onPreview(record)}
  />
{/snippet}

<section class="assetCatalog__results" aria-label="Search results">
  {#if uploaded.length}
    <h3 class="assetCatalog__groupTitle" id="asset-catalog-uploaded">Uploaded creatures</h3>
    <ul class="assetCatalog__list assetCatalog__list--uploaded" aria-labelledby="asset-catalog-uploaded">
      {#each uploaded as record (record.identity)}
        {@render row(record, false)}
      {/each}
    </ul>
  {/if}
  {#if error}
    <p class="assetCatalog__error" role="alert">{error}</p>
  {/if}
  {#if status?.state === 'loading'}
    <div class="assetCatalog__loading">
      <div
        class="assetCatalog__progress"
        role="progressbar"
        aria-label="Catalog loading"
        aria-valuemin="0"
        aria-valuemax={status.total}
        aria-valuenow={status.completed}
      >
        <span style:width="{progress}%"></span>
      </div>
      <p class="assetCatalog__status" role="status">
        Loading all sources: {status.completed} of {status.total || '…'} files. Downloaded catalog data is saved for later
        searches.
      </p>
    </div>
  {:else if status?.state === 'error'}
    <p class="assetCatalog__error" role="alert">{status.error}</p>
  {:else if !catalog && !error}
    <p class="assetCatalog__status" role="status">Loading creatures…</p>
  {:else if catalog}
    <p class="assetCatalog__status" role="status">
      {total.toLocaleString()}
      {total === 1 ? 'match' : 'matches'}
    </p>
    {#if status?.warnings.length}
      <details class="assetCatalog__warnings">
        <summary>{status.warnings.length} files skipped</summary>
        {#each status.warnings as warning}<p>{warning}</p>{/each}
      </details>
    {/if}
    {#if records.length}
      <ul class="assetCatalog__list">
        {#each records as record, index (record.identity)}
          {@render row(record, index === activeIndex)}
        {/each}
      </ul>
    {:else}
      <p class="assetCatalog__empty">No creatures match these filters.</p>
    {/if}
    {#if total > pageSize}
      <div class="assetCatalog__pager">
        <Button variant="ghost" size="sm" isDisabled={offset === 0} onclick={() => onPageChange(offset - pageSize)}>
          {#snippet start()}<Icon Icon={IconChevronLeft} size="1rem" />{/snippet}
          Previous
        </Button>
        <span class="assetCatalog__status">
          {(offset + 1).toLocaleString()}–{rangeEnd.toLocaleString()} of {total.toLocaleString()}
        </span>
        <Button
          variant="ghost"
          size="sm"
          isDisabled={offset + pageSize >= total}
          onclick={() => onPageChange(offset + pageSize)}
        >
          Next
          {#snippet end()}<Icon Icon={IconChevronRight} size="1rem" />{/snippet}
        </Button>
      </div>
    {/if}
  {/if}
</section>

<style>
  .assetCatalog__results {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-height: 0;
    overflow: hidden;
  }
  .assetCatalog__list {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    margin: 0;
    padding: 0;
    list-style: none;
    overflow-y: auto;
    min-height: 0;
  }
  .assetCatalog__list--uploaded {
    flex-shrink: 0;
    max-height: 40%;
  }
  .assetCatalog__groupTitle {
    margin: 0;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--fgMuted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .assetCatalog__status,
  .assetCatalog__empty {
    font-size: 0.8125rem;
    color: var(--fgMuted);
    margin: 0;
  }
  .assetCatalog__error {
    font-size: 0.8125rem;
    color: var(--fgDanger);
    margin: 0;
  }
  .assetCatalog__warnings summary {
    display: inline;
    cursor: pointer;
    text-decoration: underline;
  }
  .assetCatalog__warnings p {
    margin: 0.25rem 0 0;
  }
  .assetCatalog__loading {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .assetCatalog__progress {
    height: 0.375rem;
    border-radius: 999px;
    background: var(--contrastLow);
    overflow: hidden;
  }
  .assetCatalog__progress span {
    display: block;
    height: 100%;
    background: var(--fgPrimary);
    transition: width 300ms ease;
  }
  .assetCatalog__pager {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
</style>
