<script lang="ts">
  import { Button, ContextMenu, type ContextMenuItem, Icon, IconButton, Input, ToolTip } from '@tableslayer/ui';
  import { v4 as uuidv4 } from 'uuid';
  import {
    IconBookmarkPlus,
    IconArrowLeft,
    IconDots,
    IconDownload,
    IconEye,
    IconEyeOff,
    IconPlus,
    IconPresentation,
    IconSearch
  } from '@tabler/icons-svelte';
  import { MarkerVisibility } from '@tableslayer/stage';
  import { handleMutation } from '$lib/factories';
  import { createAssetsQuery, useAssetMutation } from '$lib/queries/assets';
  import { generateR2Url } from '$lib/utils/generateR2Url';
  import type { SelectAsset } from '$lib/db/app/schema';
  import type { AssetListItem } from '$lib/queries/assets';
  import { ASSET_DRAG_TYPE, markerAssetSnapshot, placeAsset, MAX_PLACEMENT_QUANTITY } from './assetPlacement';
  import { useAssetImportMutation } from '$lib/queries/assetImport';
  import type { FiveToolsPreview } from '$lib/server/assets/fivetools/types';
  import AssetEditor from './AssetEditor.svelte';
  import AssetDetail from './AssetDetail.svelte';
  import AssetCatalogInline from './AssetCatalogInline.svelte';
  import AssetStatPreview from './AssetStatPreview.svelte';
  import type { AssetLibraryProps } from './types';

  let {
    client,
    sceneId,
    selectedMarkerId,
    bucketUrl,
    onPreviewArtwork,
    onOpenCatalog,
    quantity = $bindable(1),
    visibility = $bindable(MarkerVisibility.Always),
    getViewportCenter,
    snapPosition
  }: AssetLibraryProps = $props();

  let search = $state('');
  let debouncedSearch = $state('');
  let view = $state<'grid' | 'edit' | 'detail' | 'catalog'>('grid');
  let editing = $state<AssetListItem | null>(null);
  let detailAsset = $state<AssetListItem | null>(null);
  let catalogRecord = $state<FiveToolsPreview | null>(null);
  let addingIdentity = $state<string | null>(null);
  let addedIdentities = $state(new Set<string>());
  let loading = $state(false);
  let menuAsset = $state<AssetListItem | null>(null);
  let armedDeleteId = $state<string | null>(null);
  let contextMenu = $state<{ open: (event: MouseEvent) => Promise<void> } | undefined>();
  const query = createAssetsQuery(() => search);
  const mutation = useAssetMutation();
  const importer = useAssetImportMutation();
  const assets = $derived(query.data?.assets ?? []);
  const showCatalog = $derived(
    !!search.trim() && !query.isPending && assets.length === 0 && debouncedSearch === search.trim()
  );

  $effect(() => {
    const value = search.trim();
    const timer = setTimeout(() => (debouncedSearch = value), 200);
    return () => clearTimeout(timer);
  });

  const addToLibrary = async (record: FiveToolsPreview) => {
    if (addingIdentity) return;
    addingIdentity = record.identity;
    const response = await handleMutation({
      mutation: () =>
        importer.mutateAsync({
          action: 'import',
          items: [{ record, requestId: uuidv4(), policy: 'skip' }]
        }),
      formLoadingState: () => {},
      toastMessages: { error: { title: 'Could not add to library', body: (error) => error.message } }
    });
    addingIdentity = null;
    const status = response?.results[0]?.status;
    if (status && status !== 'failed') addedIdentities = new Set([...addedIdentities, record.identity]);
  };

  const runAction = (action: Parameters<typeof mutation.mutateAsync>[0]) =>
    handleMutation({
      mutation: () => mutation.mutateAsync(action),
      formLoadingState: (value) => (loading = value),
      toastMessages: { error: { title: 'Asset action failed', body: (error) => error.message } }
    });

  const artworkOf = (asset: AssetListItem) => asset.artworkLocation || asset.tokenArtworkLocation;
  const canShowHandout = (asset: AssetListItem) => !!onPreviewArtwork && !!artworkOf(asset);
  const badgeOf = ({ statSummary }: AssetListItem) =>
    statSummary ? (statSummary.cr ? `CR ${statSummary.cr}` : 'Stats') : null;

  const place = (assetId: string) => {
    if (loading) return;
    return placeAsset({
      assetId,
      quantity: quantity ?? 1,
      at: getViewportCenter?.() ?? { x: 0, y: 0 },
      sceneId,
      client,
      mutate: (action) => mutation.mutateAsync(action),
      snap: snapPosition,
      visibility,
      onLoadingChange: (value) => (loading = value)
    });
  };

  const isGmOnly = $derived(visibility === MarkerVisibility.DM);
  const toggleVisibility = () => (visibility = isGmOnly ? MarkerVisibility.Always : MarkerVisibility.DM);

  const openDetail = (asset: AssetListItem) => {
    detailAsset = asset;
    view = 'detail';
  };

  const openDetailFromKeyboard = (event: KeyboardEvent, asset: AssetListItem) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    openDetail(asset);
  };

  const openCatalogRecord = (record: FiveToolsPreview) => {
    catalogRecord = record;
    view = 'catalog';
  };

  const closeDetail = () => {
    detailAsset = null;
    catalogRecord = null;
    view = 'grid';
  };

  const saveSelectedMarker = async () => {
    const marker = client?.scene(sceneId)?.markers.find((row) => row.id === selectedMarkerId);
    if (!marker) return;
    await runAction({
      action: 'saveMarker',
      sceneId,
      markerId: marker.id,
      snapshot: markerAssetSnapshot(marker)
    });
  };

  const openEditor = (asset: AssetListItem | null) => {
    editing = asset;
    view = 'edit';
  };

  const catalogRecordInLibrary = $derived(
    !!catalogRecord && (Boolean(catalogRecord.duplicates?.length) || addedIdentities.has(catalogRecord.identity))
  );

  const showSaved = ({ statBlock, ...saved }: SelectAsset) => {
    editing = {
      ...saved,
      statSummary: statBlock
        ? { cr: statBlock.cr.display, type: statBlock.type, size: statBlock.size[0] ?? null }
        : null
    };
  };

  const closeEditor = () => {
    editing = null;
    view = detailAsset ? 'detail' : 'grid';
  };

  const confirmDelete = async (asset: AssetListItem) => {
    const result = await runAction({ action: 'delete', id: asset.id });
    if (result) armedDeleteId = null;
    if (result && detailAsset?.id === asset.id) closeDetail();
  };

  const assetMenuItems = (asset: AssetListItem): ContextMenuItem[] => [
    { label: 'Edit', onclick: () => openEditor(asset) },
    ...(canShowHandout(asset) ? [{ label: 'Show as handout', onclick: () => onPreviewArtwork?.(asset) }] : []),
    { type: 'divider' },
    { label: 'Delete', variant: 'danger', onclick: () => (armedDeleteId = asset.id) }
  ];
  const menuItems = $derived(menuAsset ? assetMenuItems(menuAsset) : []);

  const openMenu = (event: MouseEvent, asset: AssetListItem) => {
    menuAsset = asset;
    void contextMenu?.open(event);
  };

  const startDrag = (event: DragEvent, asset: AssetListItem) => {
    const transfer = event.dataTransfer;
    if (!transfer) return;
    transfer.setData(ASSET_DRAG_TYPE, asset.id);
    transfer.effectAllowed = 'copy';
    const image = (event.currentTarget as HTMLElement).querySelector('img');
    if (image) transfer.setDragImage(image, 32, 32);
  };
</script>

<div class="assetLibrary">
  {#if view === 'edit'}
    {#key editing?.id ?? 'new'}
      <AssetEditor asset={editing} {bucketUrl} onClose={closeEditor} onSaved={showSaved} />
    {/key}
  {:else if view === 'detail' && detailAsset}
    {#key detailAsset.id}
      <AssetDetail
        asset={detailAsset}
        {bucketUrl}
        busy={loading}
        onBack={closeDetail}
        onPlace={() => place(detailAsset!.id)}
        onEdit={() => openEditor(detailAsset)}
        onShowHandout={canShowHandout(detailAsset) ? () => onPreviewArtwork?.(detailAsset!) : undefined}
      />
    {/key}
  {:else if view === 'catalog' && catalogRecord}
    <div class="assetLibrary__catalogDetail">
      <div class="assetLibrary__backBar">
        <IconButton variant="ghost" size="sm" aria-label="Back to search" onclick={closeDetail}>
          <Icon Icon={IconArrowLeft} size="1.125rem" />
        </IconButton>
      </div>
      <div class="assetLibrary__catalogBody">
        <AssetStatPreview
          record={catalogRecord}
          busy={addingIdentity === catalogRecord.identity}
          inLibrary={catalogRecordInLibrary}
          onAddToLibrary={() => addToLibrary(catalogRecord!)}
        />
      </div>
    </div>
  {:else}
    <div class="assetLibrary__toolbar">
      <div class="assetLibrary__search">
        <span class="assetLibrary__searchIcon" aria-hidden="true">
          <Icon Icon={IconSearch} size="1rem" />
        </span>
        <Input type="search" aria-label="Search assets" placeholder="Search assets…" bind:value={search} />
      </div>
      <label class="assetLibrary__quantity">
        <span aria-hidden="true">×</span>
        <Input type="number" aria-label="Quantity" min={1} max={MAX_PLACEMENT_QUANTITY} bind:value={quantity} />
      </label>
      <ToolTip positioning={{ placement: 'bottom' }} openDelay={500} closeOnPointerDown disableHoverableContent>
        {#snippet children()}
          <IconButton
            variant="ghost"
            aria-label={isGmOnly ? 'Placed tokens are hidden from players' : 'Placed tokens are visible to players'}
            aria-pressed={isGmOnly}
            onclick={toggleVisibility}
          >
            <Icon Icon={isGmOnly ? IconEyeOff : IconEye} size="1.125rem" />
          </IconButton>
        {/snippet}
        {#snippet toolTipContent()}
          {isGmOnly
            ? 'Placed tokens: GM only. Click to show to players.'
            : 'Placed tokens: visible to players. Click to hide.'}
        {/snippet}
      </ToolTip>
      <ToolTip positioning={{ placement: 'bottom' }} openDelay={500} closeOnPointerDown disableHoverableContent>
        {#snippet children()}
          <IconButton variant="ghost" aria-label="New asset" onclick={() => openEditor(null)}>
            <Icon Icon={IconPlus} size="1.125rem" />
          </IconButton>
        {/snippet}
        {#snippet toolTipContent()}New asset{/snippet}
      </ToolTip>
      {#if onOpenCatalog}
        <ToolTip positioning={{ placement: 'bottom' }} openDelay={500} closeOnPointerDown disableHoverableContent>
          {#snippet children()}
            <IconButton variant="ghost" aria-label="Add from 5etools" onclick={onOpenCatalog}>
              <Icon Icon={IconDownload} size="1.125rem" />
            </IconButton>
          {/snippet}
          {#snippet toolTipContent()}Add from 5etools{/snippet}
        </ToolTip>
      {/if}
      {#if selectedMarkerId}
        <ToolTip positioning={{ placement: 'bottom' }} openDelay={500} closeOnPointerDown disableHoverableContent>
          {#snippet children()}
            <IconButton
              variant="ghost"
              aria-label="Save selected token"
              disabled={loading}
              onclick={saveSelectedMarker}
            >
              <Icon Icon={IconBookmarkPlus} size="1.125rem" />
            </IconButton>
          {/snippet}
          {#snippet toolTipContent()}Save selected token to library{/snippet}
        </ToolTip>
      {/if}
    </div>

    {#if query.error}<p class="assetLibrary__error" role="alert">{query.error.message}</p>{/if}

    {#if query.isPending}
      <p class="assetLibrary__status">Loading assets…</p>
    {:else if showCatalog}
      <AssetCatalogInline
        search={debouncedSearch}
        {addingIdentity}
        {addedIdentities}
        onSelect={openCatalogRecord}
        onAdd={addToLibrary}
      />
    {:else if assets.length === 0}
      <div class="assetLibrary__empty">
        {#if search.trim()}
          <p>Searching…</p>
        {:else}
          <p>No assets yet. Add one from 5etools or save a token from the map.</p>
          <div class="assetLibrary__emptyActions">
            {#if onOpenCatalog}
              <Button variant="ghost" size="sm" onclick={onOpenCatalog}>Add from 5etools</Button>
            {/if}
            <Button variant="ghost" size="sm" onclick={() => openEditor(null)}>New asset</Button>
          </div>
        {/if}
      </div>
    {:else}
      <div class="assetLibrary__list">
        {#each assets as asset (asset.id)}
          {@const artwork = artworkOf(asset)}
          {@const badge = badgeOf(asset)}
          <div class="assetLibrary__item">
            <div class="assetLibrary__tileWrap">
              <div
                role="button"
                tabindex="0"
                class="assetLibrary__tile"
                draggable="true"
                aria-label="Show {asset.name}"
                onclick={() => openDetail(asset)}
                onkeydown={(event) => openDetailFromKeyboard(event, asset)}
                oncontextmenu={(event) => openMenu(event, asset)}
                ondragstart={(event) => startDrag(event, asset)}
              >
                {#if artwork}
                  <img
                    class="assetLibrary__tileImage"
                    src={generateR2Url(artwork, { width: 128, height: 128, fit: 'contain', bucketUrl })}
                    alt=""
                    loading="lazy"
                    draggable="false"
                  />
                {:else}
                  <span class="assetLibrary__tilePlaceholder" aria-hidden="true">{asset.name.slice(0, 2)}</span>
                {/if}
                {#if badge}<span class="assetLibrary__badge">{badge}</span>{/if}
              </div>
              <span class="assetLibrary__place">
                <IconButton
                  variant="primary"
                  size="sm"
                  aria-label="Place {asset.name} on the map"
                  title="Place on the map"
                  disabled={loading}
                  onclick={() => place(asset.id)}
                >
                  <Icon Icon={IconPlus} size="1rem" />
                </IconButton>
              </span>
              <div class="assetLibrary__tileActions">
                {#if canShowHandout(asset)}
                  <IconButton
                    variant="ghost"
                    size="sm"
                    aria-label="Show as handout"
                    title="Show as handout"
                    onclick={() => onPreviewArtwork?.(asset)}
                  >
                    <Icon Icon={IconPresentation} size="1rem" />
                  </IconButton>
                {/if}
                <IconButton
                  variant="ghost"
                  size="sm"
                  aria-label="More actions for {asset.name}"
                  title="More"
                  onclick={(event: MouseEvent) => openMenu(event, asset)}
                >
                  <Icon Icon={IconDots} size="1rem" />
                </IconButton>
              </div>
            </div>
            {#if armedDeleteId === asset.id}
              <div class="assetLibrary__confirm">
                <span>Delete {asset.name}?</span>
                <div class="assetLibrary__confirmActions">
                  <Button variant="danger" size="sm" isDisabled={loading} onclick={() => confirmDelete(asset)}>
                    Delete
                  </Button>
                  <Button variant="ghost" size="sm" onclick={() => (armedDeleteId = null)}>Cancel</Button>
                </div>
              </div>
            {:else}
              <span class="assetLibrary__tileName">{asset.name}</span>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    <p class="assetLibrary__hint">Click for details · + to place · drag onto the map</p>
  {/if}

  <ContextMenu bind:this={contextMenu} items={menuItems} />
</div>

<style>
  .assetLibrary {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    color: var(--fg);
  }
  .assetLibrary__toolbar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
    padding: 0.75rem 1rem;
    border-bottom: var(--borderThin);
  }
  .assetLibrary__search {
    position: relative;
    flex: 1;
    min-width: 0;
  }
  .assetLibrary__search :global(.input) {
    padding-left: 2rem;
  }
  .assetLibrary__searchIcon {
    position: absolute;
    top: 50%;
    left: 0.6rem;
    transform: translateY(-50%);
    display: flex;
    color: var(--fgMuted);
    pointer-events: none;
  }
  .assetLibrary__quantity {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    width: 5rem;
    color: var(--fgMuted);
  }
  .assetLibrary__list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(5.5rem, 1fr));
    align-content: start;
    gap: 0.75rem;
    flex: 1;
    min-height: 0;
    padding: 1rem;
    overflow-y: auto;
  }
  .assetLibrary__item {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }
  .assetLibrary__tileWrap {
    position: relative;
    aspect-ratio: 1;
  }
  .assetLibrary__tile {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    padding: 0;
    overflow: hidden;
    border: var(--borderThin);
    border-radius: var(--radius-2);
    background: var(--contrastLow);
    cursor: grab;
  }
  .assetLibrary__tile:hover,
  .assetLibrary__tile:focus-visible {
    border-color: var(--fgPrimary);
    outline: none;
  }
  .assetLibrary__tileImage {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .assetLibrary__tilePlaceholder {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--fgMuted);
  }
  .assetLibrary__badge {
    position: absolute;
    top: 0.25rem;
    left: 0.25rem;
    padding: 0.0625rem 0.375rem;
    border-radius: 999px;
    font-size: 0.625rem;
    color: var(--fg);
    background: color-mix(in srgb, var(--bg) 80%, transparent);
  }
  .assetLibrary__place {
    position: absolute;
    top: 0.25rem;
    right: 0.25rem;
    z-index: 1;
    display: flex;
  }
  .assetLibrary__catalogDetail {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .assetLibrary__backBar {
    flex-shrink: 0;
    padding: 0.5rem 0.75rem;
    border-bottom: var(--borderThin);
  }
  .assetLibrary__catalogBody {
    flex: 1;
    min-height: 0;
    padding: 0.75rem;
    overflow-y: auto;
  }
  .assetLibrary__tileActions {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    display: flex;
    justify-content: center;
    gap: 0.25rem;
    padding: 0.25rem;
    background: color-mix(in srgb, var(--bg) 85%, transparent);
    opacity: 0;
    transition: opacity 120ms ease;
  }
  .assetLibrary__tileWrap:hover .assetLibrary__tileActions,
  .assetLibrary__tileWrap:focus-within .assetLibrary__tileActions {
    opacity: 1;
  }
  @media (hover: none) {
    .assetLibrary__tileActions {
      opacity: 1;
    }
  }
  .assetLibrary__tileName {
    overflow: hidden;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.75rem;
    color: var(--fgMuted);
  }
  .assetLibrary__confirm {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    text-align: center;
  }
  .assetLibrary__confirmActions {
    display: flex;
    gap: 0.25rem;
  }
  .assetLibrary__empty {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 1.5rem 1rem;
    font-size: 0.875rem;
    color: var(--fgMuted);
  }
  .assetLibrary__emptyActions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .assetLibrary__status {
    padding: 1rem;
    font-size: 0.875rem;
    color: var(--fgMuted);
  }
  .assetLibrary__error {
    padding: 0.5rem 1rem 0;
    font-size: 0.875rem;
    color: var(--fgDanger);
  }
  .assetLibrary__hint {
    flex-shrink: 0;
    padding: 0.5rem 1rem;
    border-top: var(--borderThin);
    font-size: 0.75rem;
    color: var(--fgMuted);
  }
</style>
