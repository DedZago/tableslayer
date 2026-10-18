<script lang="ts">
  import { generateR2Url } from '$lib/utils/generateR2Url';
  import type { HandoutImageProps } from './types';
  let { artworkLocation, title, bucketUrl }: HandoutImageProps = $props();
  let loading = $state(true);
  let failed = $state(false);
</script>

<figure class="handout-image">
  <img
    class="handout-image__original"
    src={generateR2Url(artworkLocation, { bucketUrl })}
    alt={title || 'Shared handout'}
    onload={() => (loading = false)}
    onerror={() => {
      loading = false;
      failed = true;
    }}
  />
  {#if loading}<p class="handout-image__message" role="status">Loading handout…</p>{/if}
  {#if failed}<p class="handout-image__message handout-image__message--error" role="alert">
      Handout image could not be loaded
    </p>{/if}
  {#if title}<figcaption class="handout-image__title">{title}</figcaption>{/if}
</figure>

<style>
  .handout-image {
    width: 100%;
    height: 100%;
    margin: 0;
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    align-items: center;
    justify-content: center;
    color: var(--fg);
    background: var(--bg);
  }
  .handout-image__original {
    display: block;
    flex: 1;
    min-height: 0;
    max-height: 100%;
    width: 100%;
    object-fit: contain;
  }
  .handout-image__message {
    position: absolute;
    padding: 1rem;
    background: var(--bg);
    color: var(--fg);
  }
  .handout-image__message--error {
    color: var(--fgDanger);
  }
  .handout-image__title {
    flex-shrink: 0;
    text-align: center;
    font-weight: 700;
    padding: 0.25rem 1rem;
  }
</style>
