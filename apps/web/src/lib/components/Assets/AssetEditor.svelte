<script lang="ts">
  import {
    addToast,
    Button,
    ColorPicker,
    ColorPickerSwatch,
    ConfirmActionButton,
    FormControl,
    Icon,
    Input,
    InputSlider,
    Link,
    Popover,
    RadioButton
  } from '@tableslayer/ui';
  import {
    IconArrowBack,
    IconCircle,
    IconLocationPin,
    IconPhotoPlus,
    IconSquare,
    IconTriangle
  } from '@tabler/icons-svelte';
  import { handleMutation } from '$lib/factories';
  import { useAssetMutation } from '$lib/queries/assets';
  import { useUploadFileMutation } from '$lib/queries/file';
  import { generateR2Url } from '$lib/utils/generateR2Url';
  import { hasFileDrop, hasWebsiteImageDrop, WEBSITE_IMAGE_DROP_MESSAGE } from '$lib/utils/imageDrop';
  import { validateMediaUpload } from '$lib/utils/mediaUpload';
  import { untrack } from 'svelte';
  import type { AssetEditorProps } from './types';

  let { asset = null, bucketUrl, onClose, onSaved }: AssetEditorProps = $props();
  const mutation = useAssetMutation();
  const upload = useUploadFileMutation();
  const sizeNames: Record<string, string> = {
    T: 'Tiny',
    S: 'Small',
    M: 'Medium',
    L: 'Large',
    H: 'Huge',
    G: 'Gargantuan'
  };
  const initial = untrack(() => asset);
  let loading = $state(false);
  let dragging = $state(false);
  let name = $state(initial?.name ?? '');
  let artworkLocation = $state<string | null>(initial?.artworkLocation ?? null);
  let tokenArtworkLocation = $state<string | null>(initial?.tokenArtworkLocation ?? null);
  let shape = $state(initial?.shape ?? 1);
  let shapeColor = $state(initial?.shapeColor ?? '#ffffff');
  let size = $state(initial?.size ?? 1);
  let imageScale = $state(initial?.imageScale ?? 1);
  let initiativeBonus = $state<number | null>(initial?.initiativeBonus ?? null);
  const statSummary = $derived(asset?.statSummary ?? null);
  const statLine = $derived.by(() => {
    if (!statSummary) return null;
    const { cr, size, type } = statSummary;
    const kind = [size && (sizeNames[size] ?? size), type].filter(Boolean).join(' ');
    return [cr && `CR ${cr}`, kind, 'stats attached'].filter(Boolean).join(' · ');
  });

  const runAction = (action: Parameters<typeof mutation.mutateAsync>[0]) =>
    handleMutation({
      mutation: () => mutation.mutateAsync(action),
      formLoadingState: (value) => (loading = value),
      toastMessages: { error: { title: 'Asset action failed', body: (error) => error.message } }
    });

  const uploadArtwork = async (file: File) => {
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

  const pickArtwork = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void uploadArtwork(file);
  };

  const handleArtworkDrop = (event: DragEvent) => {
    event.preventDefault();
    dragging = false;
    if (hasFileDrop(event.dataTransfer)) {
      const files = event.dataTransfer?.files ?? [];
      if (files.length === 1) void uploadArtwork(files[0]);
      else if (files.length > 1) addToast({ data: { title: 'Drop one image file', type: 'info' } });
    } else if (hasWebsiteImageDrop(event.dataTransfer)) {
      addToast({ data: { title: WEBSITE_IMAGE_DROP_MESSAGE, type: 'info' } });
    }
  };

  const save = async () => {
    const fields = {
      id: asset?.id,
      name: name.trim(),
      artworkLocation,
      tokenArtworkLocation,
      shape,
      shapeColor,
      size,
      imageScale,
      initiativeBonus
    };
    const result = await runAction({ action: 'save', fields });
    if (result?.asset) onSaved(result.asset);
  };

  const deleteAsset = async () => {
    const assetId = asset?.id;
    if (!assetId) return;
    const result = await runAction({ action: 'delete', id: assetId });
    if (result) onClose();
  };
</script>

{#snippet circle()}
  <Icon Icon={IconCircle} size="1.25rem" />
{/snippet}
{#snippet square()}
  <Icon Icon={IconSquare} size="1.25rem" />
{/snippet}
{#snippet triangle()}
  <Icon Icon={IconTriangle} size="1.25rem" />
{/snippet}
{#snippet pin()}
  <Icon Icon={IconLocationPin} size="1.25rem" />
{/snippet}

<div class="assetEditor">
  <div class="assetEditor__header">
    <Link onclick={onClose}>
      <Icon Icon={IconArrowBack} size="1rem" />
      Back to library
    </Link>
  </div>
  <form
    class="assetEditor__form"
    onsubmit={(event) => {
      event.preventDefault();
      void save();
    }}
  >
    <label
      class={['assetEditor__artwork', dragging && 'assetEditor__artwork--dragging']}
      ondragover={(event) => {
        event.preventDefault();
        dragging = true;
      }}
      ondragleave={() => (dragging = false)}
      ondrop={handleArtworkDrop}
    >
      <input
        class="assetEditor__fileInput"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif,image/gif,image/tiff"
        aria-label="Artwork file"
        disabled={loading}
        onchange={pickArtwork}
      />
      {#if artworkLocation}
        <img
          class="assetEditor__artworkImage"
          src={generateR2Url(artworkLocation, { width: 300, fit: 'contain', bucketUrl })}
          alt={name || 'Asset artwork'}
        />
      {:else}
        <Icon Icon={IconPhotoPlus} size="1.5rem" />
        <span>Drop an image or click to upload</span>
      {/if}
    </label>

    <FormControl label="Asset name" name="name">
      {#snippet input({ inputProps })}
        <Input {...inputProps} required maxlength={200} bind:value={name} />
      {/snippet}
    </FormControl>

    <div class="assetEditor__formGrid">
      <FormControl label="Shape" name="shape">
        {#snippet input({ inputProps })}
          <RadioButton
            {...inputProps}
            selected={shape.toString()}
            options={[
              { label: 'None', value: '0' },
              { label: circle, value: '1' },
              { label: square, value: '2' },
              { label: triangle, value: '3' },
              { label: pin, value: '4' }
            ]}
            onSelectedChange={(value) => (shape = Number(value))}
          />
        {/snippet}
      </FormControl>

      <FormControl label="Size" name="size">
        {#snippet input({ inputProps })}
          <RadioButton
            {...inputProps}
            selected={size.toString()}
            options={[
              { label: 'S', value: '1' },
              { label: 'M', value: '2' },
              { label: 'L', value: '3' }
            ]}
            onSelectedChange={(value) => (size = Number(value))}
          />
        {/snippet}
      </FormControl>

      <FormControl label="Color" name="shapeColor">
        {#snippet start()}
          <Popover portal="body">
            {#snippet trigger()}
              <ColorPickerSwatch color={shapeColor} />
            {/snippet}
            {#snippet content()}
              <ColorPicker
                showOpacity={false}
                hex={shapeColor}
                onUpdate={(colorData) => (shapeColor = colorData.hex)}
              />
            {/snippet}
          </Popover>
        {/snippet}
        {#snippet input({ inputProps })}
          <Input {...inputProps} bind:value={shapeColor} />
        {/snippet}
      </FormControl>

      <FormControl label="Image scale" name="imageScale">
        {#snippet input({ inputProps })}
          <InputSlider
            {...inputProps}
            min={0.1}
            max={10}
            step={0.1}
            value={imageScale}
            oninput={(event) => (imageScale = Number(event.currentTarget.value))}
          />
        {/snippet}
        {#snippet end()}
          <span class="assetEditor__scaleValue">{imageScale.toFixed(1)}×</span>
        {/snippet}
      </FormControl>

      <div class="assetEditor__bonus">
        <FormControl label="Initiative bonus" name="initiativeBonus">
          {#snippet input({ inputProps })}
            <Input
              {...inputProps}
              type="number"
              min={-20}
              max={30}
              step={1}
              placeholder="Automatic"
              bind:value={initiativeBonus}
            />
          {/snippet}
        </FormControl>
        <p class="assetEditor__hint">Empty uses the stat block, or 0.</p>
      </div>
    </div>

    {#if statLine}
      <p class="assetEditor__stats">{statLine}</p>
    {/if}

    <div class="assetEditor__footer">
      <Button variant="primary" type="submit" isLoading={loading} isDisabled={loading}>
        {asset ? 'Save asset' : 'Create asset'}
      </Button>
      {#if asset}
        <ConfirmActionButton action={deleteAsset} actionButtonText="Delete" portal="body">
          {#snippet trigger({ triggerProps })}
            <Button variant="danger" type="button" isDisabled={loading} {...triggerProps}>Delete</Button>
          {/snippet}
          {#snippet actionMessage()}
            Delete {asset?.name}?
          {/snippet}
        </ConfirmActionButton>
      {/if}
    </div>
  </form>
</div>

<style>
  .assetEditor {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
    color: var(--fg);
  }
  .assetEditor__header {
    display: flex;
    font-size: 0.875rem;
  }
  .assetEditor__form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .assetEditor__artwork {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    min-height: 8rem;
    padding: 1rem;
    border: 2px dashed var(--contrastMedium);
    border-radius: var(--radius-2);
    color: var(--fgMuted);
    font-size: 0.875rem;
    text-align: center;
    cursor: pointer;
  }
  .assetEditor__artwork--dragging,
  .assetEditor__artwork:hover {
    border-color: var(--fgPrimary);
    color: var(--fg);
  }
  .assetEditor__artworkImage {
    max-height: 10rem;
    max-width: 100%;
    object-fit: contain;
  }
  .assetEditor__fileInput {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    overflow: hidden;
  }
  .assetEditor__formGrid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }
  .assetEditor__bonus {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .assetEditor__hint {
    font-size: 0.75rem;
    color: var(--fgMuted);
  }
  .assetEditor__scaleValue {
    min-width: 3rem;
    text-align: right;
    font-size: 0.875rem;
    color: var(--fgMuted);
  }
  .assetEditor__stats {
    font-size: 0.875rem;
    color: var(--fgMuted);
  }
  .assetEditor__footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    padding-top: 0.5rem;
    border-top: var(--borderThin);
  }
  @container (max-width: 420px) {
    .assetEditor__formGrid {
      grid-template-columns: 1fr;
    }
  }
</style>
