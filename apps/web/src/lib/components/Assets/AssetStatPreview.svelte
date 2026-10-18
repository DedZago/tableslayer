<script lang="ts">
  import { Button, Skeleton } from '@tableslayer/ui';
  import { StatBlockPanel } from '$lib/components/StatBlock';
  import { createCatalogStatBlockQuery } from '$lib/queries/assetImport';
  import type { FiveToolsPreview } from '$lib/server/assets/fivetools/types';

  let {
    record,
    busy = false,
    inLibrary = false,
    onAddToLibrary
  }: {
    record: FiveToolsPreview;
    busy?: boolean;
    inLibrary?: boolean;
    onAddToLibrary: () => void;
  } = $props();

  const statBlockQuery = createCatalogStatBlockQuery(() => (record.statBlock === undefined ? record.identity : null));
  const statBlock = $derived(record.statBlock ?? statBlockQuery.data ?? null);
  const meta = $derived(
    [record.cr && `CR ${record.cr}`, record.creatureType, record.source].filter(Boolean).join(' · ')
  );
</script>

<article class="assetCatalog__previewCard" aria-labelledby="asset-catalog-preview-title">
  <header class="assetCatalog__previewHeader">
    {#if record.artworkUrl ?? record.tokenUrl}
      <img class="assetCatalog__previewArt" src={record.artworkUrl ?? record.tokenUrl} alt="" loading="lazy" />
    {/if}
    <div class="assetCatalog__previewTitle">
      <h3 id="asset-catalog-preview-title">{record.name}</h3>
      <p class="assetCatalog__previewMeta">{meta}</p>
    </div>
  </header>

  <div class="assetCatalog__previewBody">
    {#if statBlockQuery.isLoading}
      <Skeleton />
    {:else if statBlockQuery.error}
      <p class="assetCatalog__error" role="alert">{statBlockQuery.error.message}</p>
    {:else if statBlock}
      <StatBlockPanel {statBlock} readonly />
    {:else}
      <p class="assetCatalog__empty">No stat block for this creature. It can still be added with its artwork.</p>
    {/if}
    {#each record.warnings as warning}
      <p class="assetCatalog__warning">{warning}</p>
    {/each}
  </div>

  <footer class="assetCatalog__previewActions">
    <Button isLoading={busy} isDisabled={busy || inLibrary} onclick={onAddToLibrary}>
      {inLibrary ? 'In library' : 'Add to library'}
    </Button>
  </footer>
</article>

<style>
  .assetCatalog__previewCard {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-height: 0;
  }
  .assetCatalog__previewHeader {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .assetCatalog__previewArt {
    width: 3.5rem;
    height: 3.5rem;
    flex-shrink: 0;
    object-fit: contain;
    border-radius: var(--radius-2);
    background: var(--contrastLow);
  }
  .assetCatalog__previewTitle h3 {
    margin: 0;
    font-size: 1.125rem;
  }
  .assetCatalog__previewMeta {
    margin: 0.125rem 0 0;
    font-size: 0.8125rem;
    color: var(--fgMuted);
  }
  .assetCatalog__previewBody {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-height: 0;
    overflow-y: auto;
  }
  .assetCatalog__previewActions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .assetCatalog__empty,
  .assetCatalog__warning {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--fgMuted);
  }
  .assetCatalog__error {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--fgDanger);
  }
</style>
