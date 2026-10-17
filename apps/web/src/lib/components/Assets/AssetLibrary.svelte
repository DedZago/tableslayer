<script lang="ts">
  import { createAssetsQuery, useAssetMutation } from '$lib/queries/assets';
  import { useUploadFileMutation } from '$lib/queries/file';
  import { handleMutation } from '$lib/factories';
  import { validateMediaUpload } from '$lib/utils/mediaUpload';
  import { generateR2Url } from '$lib/utils/generateR2Url';
  import type { SelectAsset } from '$lib/db/app/schema';
  import type { AssetLibraryProps } from './types';
  import AssetImport from './AssetImport.svelte';

  let { client, sceneId, selectedMarkerId, bucketUrl, onPreviewArtwork }: AssetLibraryProps = $props();
  let search = $state('');
  let name = $state('');
  let artworkLocation = $state<string | null>(null);
  let tokenArtworkLocation = $state<string | null>(null);
  let editingId = $state<string | undefined>();
  let shape = $state(1);
  let shapeColor = $state('#ffffff');
  let size = $state(1);
  let imageScale = $state(1);
  let quantity = $state(1);
  let loading = $state(false);
  const query = createAssetsQuery(() => search);
  const mutation = useAssetMutation();
  const upload = useUploadFileMutation();

  const editAsset = (asset?: SelectAsset) => {
    editingId = asset?.id;
    name = asset?.name ?? '';
    artworkLocation = asset?.artworkLocation ?? null;
    tokenArtworkLocation = asset?.tokenArtworkLocation ?? null;
    shape = asset?.shape ?? 1;
    shapeColor = asset?.shapeColor ?? '#ffffff';
    size = asset?.size ?? 1;
    imageScale = asset?.imageScale ?? 1;
  };

  const runAction = (action: Parameters<typeof mutation.mutateAsync>[0]) =>
    handleMutation({
      mutation: () => mutation.mutateAsync(action),
      formLoadingState: (value) => (loading = value),
      toastMessages: { error: { title: 'Asset action failed', body: (error) => error.message } }
    });

  const saveSelectedMarker = async () => {
    const marker = client?.scene(sceneId)?.markers.find((row) => row.id === selectedMarkerId);
    if (!marker) return;
    await runAction({
      action: 'saveMarker',
      sceneId,
      markerId: marker.id,
      snapshot: {
        name: marker.title,
        artworkLocation: marker.imageLocation,
        shape: marker.shape,
        shapeColor: marker.shapeColor,
        size: marker.size,
        imageScale: marker.imageScale
      }
    });
  };

  const save = async () => {
    const result = await runAction({
      action: 'save',
      fields: { id: editingId, name, artworkLocation, tokenArtworkLocation, shape, shapeColor, size, imageScale }
    });
    if (result?.asset) editAsset(result.asset);
  };

  const pickArtwork = async (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const result = await handleMutation({
      mutation: () => {
        validateMediaUpload(file, true);
        return upload.mutateAsync({ file, folder: 'asset' });
      },
      formLoadingState: (value) => (loading = value),
      toastMessages: { error: { title: 'Artwork upload failed', body: (error) => error.message } }
    });
    if (result) {
      artworkLocation = result.location;
      tokenArtworkLocation = null;
    }
  };

  const place = async (id: string) => {
    const destination = sceneId;
    const destinationClient = client;
    if (!destinationClient?.scene(destination)) return;
    const result = await runAction({ action: 'place', id, sceneId: destination, quantity, x: 0, y: 0 });
    if (!result?.markers || !destinationClient.scene(destination)) return;
    const settings = destinationClient.scene(destination)!.settings;
    const columns = Math.ceil(Math.sqrt(result.markers.length));
    const displayCell = (settings.gridSpacing * settings.displayResolutionX) / settings.displaySizeX;
    const spacing = settings.gridMode === 1 && settings.mapZoom > 0 ? displayCell / settings.mapZoom : displayCell;
    destinationClient.stopCapturing();
    destinationClient.write.transaction(() => {
      result.markers!.forEach((marker, index) =>
        destinationClient.write.upsertMarker(destination, {
          ...marker,
          positionX: (index % columns) * spacing,
          positionY: -Math.floor(index / columns) * spacing
        })
      );
    });
    destinationClient.stopCapturing();
  };
</script>

<details class="assets">
  <summary class="assets__heading">Personal asset library</summary>
  <div class="assets__body">
    <AssetImport />
    <label class="assets__field">
      Search assets <input class="assets__input" type="search" bind:value={search} />
    </label>
    {#if query.error}<p class="assets__error" role="alert">{query.error.message}</p>{/if}
    <label class="assets__field">
      Quantity <input class="assets__input" type="number" min="1" max="100" bind:value={quantity} />
    </label>
    {#if selectedMarkerId}
      <button class="assets__button" disabled={loading} onclick={saveSelectedMarker}>
        Save selected token as asset
      </button>
    {/if}
    {#each query.data?.assets ?? [] as asset (asset.id)}
      <div class="assets__item">
        {#if asset.artworkLocation || asset.tokenArtworkLocation}
          <img
            class="assets__thumbnail"
            src={generateR2Url(asset.artworkLocation || asset.tokenArtworkLocation, {
              width: 64,
              height: 64,
              fit: 'contain',
              bucketUrl
            })}
            alt={asset.name}
          />
        {/if}
        <span>{asset.name}</span>
        {#if onPreviewArtwork && (asset.artworkLocation || asset.tokenArtworkLocation)}<button
            class="assets__button"
            onclick={() => onPreviewArtwork?.(asset)}
          >
            Preview handout
          </button>{/if}
        <button class="assets__button" disabled={loading} onclick={() => place(asset.id)}>Place</button>
        <button class="assets__button" disabled={loading} onclick={() => editAsset(asset)}>Edit</button>
        <button
          class="assets__button assets__button--danger"
          disabled={loading}
          onclick={() => runAction({ action: 'delete', id: asset.id })}
        >
          Delete
        </button>
      </div>
    {/each}
    <button class="assets__button" disabled={loading} onclick={() => editAsset()}>New asset</button>
    <form
      class="assets__form"
      onsubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <label class="assets__field">
        Asset name <input class="assets__input" required maxlength="200" bind:value={name} />
      </label>
      <label class="assets__field">
        Artwork <input
          class="assets__input"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif,image/gif,image/tiff"
          disabled={loading}
          onchange={pickArtwork}
        />
      </label>
      {#if artworkLocation}<img
          class="assets__preview"
          src={generateR2Url(artworkLocation, { width: 300, fit: 'contain', bucketUrl })}
          alt={name || 'Asset artwork'}
        />{/if}
      <label class="assets__field">
        Shape <select class="assets__input" bind:value={shape}>
          <option value={0}>None</option>
          <option value={1}>Circle</option>
          <option value={2}>Square</option>
          <option value={3}>Triangle</option>
          <option value={4}>Pin</option>
        </select>
      </label>
      <label class="assets__field">
        Shape color <input class="assets__input" type="color" bind:value={shapeColor} />
      </label>
      <label class="assets__field">
        Size <select class="assets__input" bind:value={size}>
          <option value={1}>Small</option>
          <option value={2}>Medium</option>
          <option value={3}>Large</option>
        </select>
      </label>
      <label class="assets__field">
        Image scale <input class="assets__input" type="number" min="0.1" max="10" step="0.1" bind:value={imageScale} />
      </label>
      <button class="assets__button" type="submit" disabled={loading}>
        {editingId ? 'Save asset' : 'Create asset'}
      </button>
    </form>
  </div>
</details>

<style>
  .assets {
    padding: 1rem;
    border-bottom: 1px solid var(--fgMuted);
    color: var(--fg);
  }
  .assets__heading {
    cursor: pointer;
  }
  .assets__body,
  .assets__form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-top: 0.75rem;
  }
  .assets__field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .assets__input,
  .assets__button {
    padding: 0.5rem;
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--fgMuted);
    border-radius: 0.25rem;
  }
  .assets__button {
    cursor: pointer;
  }
  .assets__button:disabled {
    opacity: 0.5;
    cursor: wait;
  }
  .assets__item {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }
  .assets__thumbnail {
    width: 3rem;
    height: 3rem;
    object-fit: contain;
  }
  .assets__preview {
    width: 100%;
    max-height: 15rem;
    object-fit: contain;
  }
  .assets__error,
  .assets__button--danger {
    color: var(--fgDanger);
  }
</style>
