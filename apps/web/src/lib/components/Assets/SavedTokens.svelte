<script lang="ts">
  import { IconButton, Icon } from '@tableslayer/ui';
  import { IconChevronDown, IconPencil, IconPlus } from '@tabler/icons-svelte';
  import { MarkerVisibility } from '@tableslayer/stage';
  import { ASSET_ROLES, type AssetRole, type SelectAsset } from '$lib/db/app/schema';
  import { createAssetsQuery, useAssetMutation, type AssetListItem } from '$lib/queries/assets';
  import { generateR2Url } from '$lib/utils/generateR2Url';
  import { ASSET_DRAG_TYPE, placeAsset } from './assetPlacement';
  import AssetEditor from './AssetEditor.svelte';
  import type { AssetLibraryProps } from './types';

  let {
    client,
    sceneId,
    bucketUrl,
    visibility = MarkerVisibility.Always,
    getViewportCenter,
    snapPosition
  }: Pick<
    AssetLibraryProps,
    'client' | 'sceneId' | 'bucketUrl' | 'visibility' | 'getViewportCenter' | 'snapPosition'
  > = $props();

  const ROLE_LABELS: Record<AssetRole, string> = { hero: 'Hero', npc: 'NPC', monster: 'Monster' };
  const THUMBNAIL_SIZE = 128;

  let open = $state(true);
  let filter = $state<AssetRole | 'all'>('all');
  let editing = $state<AssetListItem | null>(null);
  let editorOpen = $state(false);
  let placing = $state(false);
  const query = createAssetsQuery(() => '');
  const mutation = useAssetMutation();
  const assets = $derived(query.data?.assets ?? []);
  const visible = $derived(filter === 'all' ? assets : assets.filter((asset) => asset.role === filter));
  const roleCounts = $derived(
    Object.fromEntries(ASSET_ROLES.map((role) => [role, assets.filter((asset) => asset.role === role).length]))
  );

  const imageOf = (asset: AssetListItem) =>
    generateR2Url(asset.tokenArtworkLocation || asset.artworkLocation, {
      width: THUMBNAIL_SIZE,
      height: THUMBNAIL_SIZE,
      fit: 'cover',
      bucketUrl
    });

  const place = (asset: AssetListItem) => {
    if (placing) return;
    return placeAsset({
      assetId: asset.id,
      quantity: 1,
      at: getViewportCenter?.() ?? { x: 0, y: 0 },
      sceneId,
      client,
      mutate: (action) => mutation.mutateAsync(action),
      snap: snapPosition,
      visibility,
      onLoadingChange: (value) => (placing = value)
    });
  };

  const startDrag = (event: DragEvent, asset: AssetListItem) => {
    const transfer = event.dataTransfer;
    if (!transfer) return;
    transfer.setData(ASSET_DRAG_TYPE, asset.id);
    transfer.effectAllowed = 'copy';
    const image = (event.currentTarget as HTMLElement).querySelector('img');
    if (image) transfer.setDragImage(image, 32, 32);
  };

  const openEditor = (asset: AssetListItem | null) => {
    editing = asset;
    editorOpen = true;
  };

  // Tokens already on this scene keep their own copy of the artwork, so refresh them with the new framing
  const refreshPlacedTokens = (saved: SelectAsset) => {
    const imageLocation = saved.tokenArtworkLocation || saved.artworkLocation;
    const markers = client?.scene(sceneId)?.markers.filter((marker) => marker.assetId === saved.id) ?? [];
    if (!client || !markers.length) return;
    client.write.transaction(() => {
      for (const marker of markers) client.write.setExistingMarkerFields(sceneId, marker.id, { imageLocation });
    });
  };

  const onSaved = (saved: SelectAsset) => {
    refreshPlacedTokens(saved);
    editorOpen = false;
    editing = null;
  };
</script>

<section class="savedTokens" data-testid="savedTokens">
  {#if editorOpen}
    {#key editing?.id ?? 'new'}
      <AssetEditor
        asset={editing}
        {bucketUrl}
        backLabel="Back to tokens"
        onClose={() => {
          editorOpen = false;
          editing = null;
        }}
        {onSaved}
      />
    {/key}
  {:else}
    <div class="savedTokens__header">
      <button
        type="button"
        class="savedTokens__toggle"
        aria-expanded={open}
        aria-controls="savedTokens-body"
        onclick={() => (open = !open)}
      >
        <Icon Icon={IconChevronDown} size="1rem" class={open ? '' : 'savedTokens__chevron--closed'} />
        <span>Saved tokens</span>
        <span class="savedTokens__count">{assets.length}</span>
      </button>
      <IconButton variant="ghost" aria-label="New token" onclick={() => openEditor(null)}>
        <Icon Icon={IconPlus} size="1.125rem" />
      </IconButton>
    </div>
    {#if open}
      <div id="savedTokens-body" class="savedTokens__body">
        <div class="savedTokens__filters" role="group" aria-label="Filter by role">
          <button
            type="button"
            class={['savedTokens__filter', filter === 'all' && 'savedTokens__filter--active']}
            aria-pressed={filter === 'all'}
            onclick={() => (filter = 'all')}
          >
            All
          </button>
          {#each ASSET_ROLES as role (role)}
            <button
              type="button"
              class={['savedTokens__filter', filter === role && 'savedTokens__filter--active']}
              aria-pressed={filter === role}
              onclick={() => (filter = role)}
            >
              {ROLE_LABELS[role]}
              <span class="savedTokens__count">{roleCounts[role]}</span>
            </button>
          {/each}
        </div>
        {#if query.isPending}
          <p class="savedTokens__status">Loading tokens…</p>
        {:else if query.error}
          <p class="savedTokens__status" role="alert">{query.error.message}</p>
        {:else if !visible.length}
          <p class="savedTokens__status">
            {assets.length ? 'No tokens with this role.' : 'No saved tokens yet. Create one with the + button.'}
          </p>
        {:else}
          <ul class="savedTokens__grid">
            {#each visible as asset (asset.id)}
              <li class="savedTokens__item">
                <button
                  type="button"
                  class="savedTokens__token"
                  draggable="true"
                  title="Place {asset.name} on the map"
                  disabled={placing}
                  ondragstart={(event) => startDrag(event, asset)}
                  onclick={() => place(asset)}
                >
                  <img
                    class={['savedTokens__image', `savedTokens__image--shape${asset.shape}`]}
                    style:border-color={asset.shapeColor}
                    src={imageOf(asset)}
                    alt=""
                    draggable="false"
                    loading="lazy"
                  />
                  <span class="savedTokens__name">{asset.name}</span>
                  {#if asset.role}<span class="savedTokens__role">{ROLE_LABELS[asset.role]}</span>{/if}
                </button>
                <button
                  type="button"
                  class="savedTokens__edit"
                  aria-label="Edit {asset.name}"
                  onclick={() => openEditor(asset)}
                >
                  <Icon Icon={IconPencil} size="0.875rem" />
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
  {/if}
</section>

<style>
  .savedTokens {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    border-bottom: var(--borderThin);
    color: var(--fg);
  }
  .savedTokens__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.25rem 0.5rem 0.25rem 1rem;
  }
  .savedTokens__toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.375rem 0;
    font: inherit;
    font-weight: var(--font-weight-6);
    color: inherit;
    background: none;
    border: none;
    cursor: pointer;
  }
  :global(.savedTokens__chevron--closed) {
    transform: rotate(-90deg);
  }
  .savedTokens__count {
    font-size: 0.75rem;
    font-weight: normal;
    color: var(--fgMuted);
  }
  .savedTokens__body {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0 1rem 0.75rem;
  }
  .savedTokens__filters {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .savedTokens__filter {
    display: inline-flex;
    gap: 0.25rem;
    align-items: center;
    padding: 0.25rem 0.625rem;
    font: inherit;
    font-size: 0.8125rem;
    color: var(--fgMuted);
    background: none;
    border: var(--borderThin);
    border-radius: var(--radius-2);
    cursor: pointer;
  }
  .savedTokens__filter--active {
    color: var(--fg);
    background: var(--contrastLow);
    border-color: var(--fgPrimary);
  }
  .savedTokens__status {
    font-size: 0.875rem;
    color: var(--fgMuted);
  }
  .savedTokens__grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(4.5rem, 1fr));
    gap: 0.5rem;
    max-height: 14rem;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }
  .savedTokens__item {
    position: relative;
  }
  .savedTokens__token {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    width: 100%;
    padding: 0.25rem;
    font: inherit;
    color: inherit;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius-2);
    cursor: pointer;
  }
  .savedTokens__token:hover {
    background: var(--menuItemHover);
  }
  .savedTokens__image {
    width: 3.5rem;
    height: 3.5rem;
    object-fit: cover;
    background: var(--contrastLow);
    border: 3px solid;
    border-radius: 50%;
  }
  .savedTokens__image--shape2 {
    border-radius: var(--radius-2);
  }
  .savedTokens__name {
    max-width: 100%;
    overflow: hidden;
    font-size: 0.75rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .savedTokens__role {
    font-size: 0.6875rem;
    color: var(--fgMuted);
  }
  .savedTokens__edit {
    position: absolute;
    top: 0;
    right: 0;
    display: none;
    padding: 0.25rem;
    color: var(--fg);
    background: var(--bg);
    border: var(--borderThin);
    border-radius: var(--radius-2);
    cursor: pointer;
  }
  .savedTokens__item:hover .savedTokens__edit,
  .savedTokens__edit:focus-visible {
    display: inline-flex;
  }
  @media (hover: none) {
    .savedTokens__edit {
      display: inline-flex;
    }
  }
</style>
