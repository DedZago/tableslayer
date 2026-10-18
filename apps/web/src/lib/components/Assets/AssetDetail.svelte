<script lang="ts">
  import { Button, Icon, IconButton, Skeleton } from '@tableslayer/ui';
  import { IconArrowLeft, IconPencil, IconPlus, IconPresentation } from '@tabler/icons-svelte';
  import { StatBlockPanel } from '$lib/components/StatBlock';
  import { createAssetDetailQuery, type AssetListItem } from '$lib/queries/assets';
  import { generateR2Url } from '$lib/utils/generateR2Url';

  let {
    asset,
    bucketUrl,
    busy = false,
    onBack,
    onPlace,
    onEdit,
    onShowHandout
  }: {
    asset: AssetListItem;
    bucketUrl: string;
    busy?: boolean;
    onBack: () => void;
    onPlace: () => void;
    onEdit: () => void;
    onShowHandout?: () => void;
  } = $props();

  const detail = createAssetDetailQuery(() => (asset.statSummary ? asset.id : null));
  const artwork = $derived(asset.artworkLocation || asset.tokenArtworkLocation);
  const meta = $derived(
    [asset.statSummary?.cr && `CR ${asset.statSummary.cr}`, asset.statSummary?.type].filter(Boolean).join(' · ')
  );
</script>

<article class="assetDetail">
  <header class="assetDetail__header">
    <IconButton variant="ghost" size="sm" aria-label="Back to library" onclick={onBack}>
      <Icon Icon={IconArrowLeft} size="1.125rem" />
    </IconButton>
    {#if artwork}
      <img
        class="assetDetail__art"
        src={generateR2Url(artwork, { width: 96, height: 96, fit: 'contain', bucketUrl })}
        alt=""
      />
    {/if}
    <div class="assetDetail__title">
      <h3>{asset.name}</h3>
      {#if meta}<p>{meta}</p>{/if}
    </div>
    <div class="assetDetail__actions">
      {#if onShowHandout}
        <IconButton
          variant="ghost"
          size="sm"
          aria-label="Show as handout"
          title="Show as handout"
          onclick={onShowHandout}
        >
          <Icon Icon={IconPresentation} size="1.125rem" />
        </IconButton>
      {/if}
      <IconButton variant="ghost" size="sm" aria-label="Edit" title="Edit" onclick={onEdit}>
        <Icon Icon={IconPencil} size="1.125rem" />
      </IconButton>
      <Button size="sm" isDisabled={busy} onclick={onPlace}>
        <Icon Icon={IconPlus} size="1rem" />
        Place
      </Button>
    </div>
  </header>

  <div class="assetDetail__body">
    {#if detail.isLoading}
      <Skeleton />
    {:else if detail.error}
      <p class="assetDetail__error" role="alert">{detail.error.message}</p>
    {:else if detail.data?.statBlock}
      <StatBlockPanel statBlock={detail.data.statBlock} readonly />
    {:else}
      <p class="assetDetail__empty">No stat block. Use Edit to add one.</p>
    {/if}
  </div>
</article>

<style>
  .assetDetail {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .assetDetail__header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
    padding: 0.5rem 0.75rem;
    border-bottom: var(--borderThin);
  }
  .assetDetail__art {
    width: 2rem;
    height: 2rem;
    flex-shrink: 0;
    object-fit: contain;
    border-radius: var(--radius-2);
    background: var(--contrastLow);
  }
  .assetDetail__title {
    flex: 1;
    min-width: 0;
  }
  .assetDetail__title h3,
  .assetDetail__title p {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .assetDetail__title h3 {
    font-size: 0.9375rem;
  }
  .assetDetail__title p {
    font-size: 0.75rem;
    color: var(--fgMuted);
  }
  .assetDetail__actions {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-shrink: 0;
  }
  .assetDetail__body {
    flex: 1;
    min-height: 0;
    padding: 0.75rem;
    overflow-y: auto;
  }
  .assetDetail__empty,
  .assetDetail__error {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--fgMuted);
  }
  .assetDetail__error {
    color: var(--fgDanger);
  }
</style>
