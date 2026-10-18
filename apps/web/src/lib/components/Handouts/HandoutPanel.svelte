<script lang="ts">
  import { addToast, Button, Icon, IconButton, Input } from '@tableslayer/ui';
  import { IconPhotoPlus, IconX } from '@tabler/icons-svelte';
  import { handleMutation } from '$lib/factories';
  import { useHandoutMutation, useHandoutUploadMutation } from '$lib/queries/handouts';
  import { hasFileDrop, hasWebsiteImageDrop, WEBSITE_IMAGE_DROP_MESSAGE } from '$lib/utils/imageDrop';
  import HandoutImage from './HandoutImage.svelte';
  import { hideHandout, showHandout, type HandoutActionContext } from './handoutActions';
  import type { HandoutPanelProps, HandoutPreview } from './types';

  let { partyId, client, bucketUrl, preview, onPreviewChange }: HandoutPanelProps = $props();
  const mutation = useHandoutMutation();
  const upload = useHandoutUploadMutation();
  let fileInput = $state<HTMLInputElement>();
  let loading = $state(false);
  let dragging = $state(false);
  let title = $state('');
  let published = $state.raw<{ preview: HandoutPreview; presentationId: string } | null>(null);
  const active = $derived(client?.ready ? (client.partyState().activeHandout ?? null) : null);
  const shown = $derived(preview ?? active);
  const isLive = $derived(
    !!active && (!preview || (published?.preview === preview && published.presentationId === active.presentationId))
  );

  $effect(() => {
    title = preview?.title ?? '';
  });

  const actionContext = (): HandoutActionContext => {
    const destinationClient = client;
    const destinationParty = partyId;
    return {
      mutation,
      client: destinationClient,
      partyId: destinationParty,
      isCurrent: () => destinationClient === client && destinationParty === partyId,
      setLoading: (value) => (loading = value)
    };
  };

  const publish = async () => {
    const selected = preview;
    if (!selected) return;
    const handout = await showHandout(actionContext(), selected.source, title.trim() || null);
    if (handout) published = { preview: selected, presentationId: handout.presentationId };
  };

  const hide = () => hideHandout(actionContext());

  const uploadFile = async (file: File) => {
    const destinationParty = partyId;
    const result = await handleMutation({
      mutation: () => upload.mutateAsync({ partyId: destinationParty, file }),
      formLoadingState: (value) => (loading = value),
      toastMessages: { error: { title: 'Handout upload failed', body: (error) => error.message } }
    });
    if (result && partyId === destinationParty)
      onPreviewChange({
        source: { type: 'upload', location: result.location },
        artworkLocation: result.location,
        title: file.name.replace(/\.[^.]+$/, '').slice(0, 200)
      });
  };

  const pick = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void uploadFile(file);
  };

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    dragging = false;
    if (hasFileDrop(event.dataTransfer)) {
      const files = event.dataTransfer?.files ?? [];
      if (files.length === 1) void uploadFile(files[0]);
      else if (files.length > 1) addToast({ data: { title: 'Drop one image file', type: 'info' } });
    } else if (hasWebsiteImageDrop(event.dataTransfer)) {
      addToast({ data: { title: WEBSITE_IMAGE_DROP_MESSAGE, type: 'info' } });
    }
  };

  const openPicker = () => fileInput?.click();
</script>

<div class="handoutPanel">
  <input
    bind:this={fileInput}
    class="handoutPanel__fileInput"
    type="file"
    accept="image/jpeg,image/png,image/webp,image/avif,image/gif,image/tiff"
    aria-label="Upload handout image"
    disabled={loading || !client?.ready}
    onchange={pick}
  />

  {#if shown}
    <div class="handoutPanel__preview" data-testid="handoutPreview">
      {#key shown.artworkLocation}
        <HandoutImage artworkLocation={shown.artworkLocation} title={preview ? title : active?.title} {bucketUrl} />
      {/key}
      {#if isLive}
        <span class="handoutPanel__badge">Live</span>
      {:else}
        <div class="handoutPanel__dismissWrap">
          <IconButton variant="ghost" size="sm" aria-label="Close preview" onclick={() => onPreviewChange(null)}>
            <Icon Icon={IconX} size="1rem" />
          </IconButton>
        </div>
      {/if}
    </div>

    {#if preview}
      <Input
        variant="transparent"
        aria-label="Handout title"
        placeholder="Title (optional)"
        maxlength={200}
        bind:value={title}
      />
    {/if}

    <div class="handoutPanel__actions">
      {#if isLive}
        <Button variant="primary" isDisabled={loading || !client?.ready} onclick={hide}>Hide handout</Button>
      {:else}
        <Button variant="primary" isDisabled={loading || !client?.ready} onclick={publish}>Show to players</Button>
        {#if active}
          <Button variant="ghost" isDisabled={loading || !client?.ready} onclick={hide}>Hide handout</Button>
        {/if}
      {/if}
      <Button variant="ghost" isDisabled={loading} onclick={openPicker}>Replace image</Button>
    </div>
  {:else}
    <button
      type="button"
      class={['handoutPanel__dropzone', dragging && 'handoutPanel__dropzone--dragging']}
      disabled={loading || !client?.ready}
      onclick={openPicker}
      ondragover={(event) => {
        event.preventDefault();
        dragging = true;
      }}
      ondragleave={() => (dragging = false)}
      ondrop={handleDrop}
    >
      <Icon Icon={IconPhotoPlus} size="1.5rem" />
      <span>Drop an image here or click to upload</span>
      <span class="handoutPanel__dropHint">Or right-click a token, then Show as handout</span>
    </button>
  {/if}

  <p class="handoutPanel__srOnly" role="status">
    {active ? `Showing ${active.title || 'a handout'} to players` : ''}
  </p>
  {#if active && client?.partyState().isPaused}
    <p class="handoutPanel__note">The handout will appear when the game resumes.</p>
  {/if}
</div>

<style>
  .handoutPanel {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    height: 100%;
    min-height: 0;
    padding: 1rem;
    overflow-y: auto;
    color: var(--fg);
  }
  .handoutPanel__fileInput {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    overflow: hidden;
    pointer-events: none;
  }
  .handoutPanel__dropzone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 2rem;
    border: 2px dashed var(--contrastMedium);
    border-radius: var(--radius-2);
    background: transparent;
    color: var(--fg);
    font: inherit;
    text-align: center;
    cursor: pointer;
  }
  .handoutPanel__dropzone:hover:not(:disabled),
  .handoutPanel__dropzone--dragging {
    border-color: var(--fgPrimary);
  }
  .handoutPanel__dropzone:disabled {
    cursor: wait;
    opacity: 0.5;
  }
  .handoutPanel__dropHint {
    font-size: 0.75rem;
    color: var(--fgMuted);
  }
  .handoutPanel__preview {
    position: relative;
    flex-shrink: 0;
    aspect-ratio: 4 / 3;
    overflow: hidden;
    background: var(--contrastEmpty);
    border: var(--borderThin);
    border-radius: var(--radius-2);
  }
  .handoutPanel__badge {
    position: absolute;
    top: 0.5rem;
    left: 0.5rem;
    z-index: 1;
    padding: 0.125rem 0.5rem;
    border-radius: var(--radius-2);
    background: var(--fgPrimary);
    color: var(--bg);
    font-size: 0.625rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .handoutPanel__dismissWrap {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    z-index: 1;
  }
  .handoutPanel__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .handoutPanel__note {
    font-size: 0.875rem;
    color: var(--fgMuted);
  }
  .handoutPanel__srOnly {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
</style>
