<script lang="ts">
  import { handleMutation } from '$lib/factories';
  import { useHandoutMutation, useHandoutUploadMutation } from '$lib/queries/handouts';
  import HandoutImage from './HandoutImage.svelte';
  import type { HandoutControlsProps } from './types';

  let { partyId, client, bucketUrl, preview, onPreviewChange }: HandoutControlsProps = $props();
  const mutation = useHandoutMutation();
  const upload = useHandoutUploadMutation();
  let loading = $state(false);
  let title = $state('');
  const active = $derived(client?.ready ? (client.partyState().activeHandout ?? null) : null);
  $effect(() => {
    title = preview?.title ?? active?.title ?? '';
  });

  const publish = async () => {
    const destinationClient = client;
    const destinationParty = partyId;
    const selected = preview;
    if (!selected || !destinationClient?.ready) return;
    const result = await handleMutation({
      mutation: () =>
        mutation.mutateAsync({
          action: 'prepare',
          partyId: destinationParty,
          source: selected.source,
          title: title.trim() || null
        }),
      formLoadingState: (value) => (loading = value),
      toastMessages: { error: { title: 'Handout could not be shown', body: (error) => error.message } }
    });
    if (result?.handout && destinationClient === client && destinationParty === partyId)
      destinationClient.party.setHandout(result.handout);
  };
  const hide = async () => {
    const destinationClient = client;
    const destinationParty = partyId;
    if (!destinationClient?.ready) return;
    const result = await handleMutation({
      mutation: () => mutation.mutateAsync({ action: 'authorize', partyId: destinationParty }),
      formLoadingState: (value) => (loading = value),
      toastMessages: { error: { title: 'Handout could not be hidden', body: (error) => error.message } }
    });
    if (result?.success && destinationClient === client && destinationParty === partyId)
      destinationClient.party.setHandout(null);
  };
  const pick = async (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
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
</script>

<details class="handout-controls" open={!!preview || !!active}>
  <summary>Player handout</summary>
  <div class="handout-controls__body">
    <label>
      Upload handout image <input
        aria-label="Upload handout image"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif,image/gif,image/tiff"
        disabled={loading || !client?.ready}
        onchange={pick}
      />
    </label>
    {#if preview || active}
      <div class="handout-controls__preview" data-testid="handoutPreview">
        {#key preview?.artworkLocation ?? active?.artworkLocation}<HandoutImage
            artworkLocation={(preview?.artworkLocation ?? active?.artworkLocation)!}
            title={preview ? title : active?.title}
            {bucketUrl}
          />{/key}
      </div>
    {/if}
    {#if preview}
      <label>
        Handout title (optional) <input
          class="handout-controls__input"
          aria-label="Handout title"
          maxlength="200"
          bind:value={title}
        />
      </label>
      <div class="handout-controls__actions">
        <button class="handout-controls__button" disabled={loading || !client?.ready} onclick={publish}>
          Show to players
        </button>
        <button class="handout-controls__button" disabled={loading} onclick={() => onPreviewChange(null)}>
          Close preview
        </button>
      </div>
    {/if}
    {#if active}
      <p role="status">Showing {active.title || 'a handout'} to players</p>
      {#if client?.partyState().isPaused}<p>The handout will appear when the game resumes.</p>{/if}
      <button class="handout-controls__button" disabled={loading || !client?.ready} onclick={hide}>Hide handout</button>
    {/if}
  </div>
</details>

<style>
  .handout-controls {
    flex-shrink: 0;
    padding: 1rem;
    border-bottom: 1px solid var(--fgMuted);
    color: var(--fg);
    background: var(--bg);
  }
  .handout-controls__body {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding-top: 0.75rem;
    max-height: 50dvh;
    overflow-y: auto;
  }
  .handout-controls__preview {
    height: 12rem;
    flex-shrink: 0;
  }
  .handout-controls__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .handout-controls__input,
  .handout-controls__button {
    padding: 0.5rem;
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--fgMuted);
    border-radius: 0.25rem;
  }
</style>
