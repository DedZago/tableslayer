<script lang="ts">
  import { fade } from 'svelte/transition';
  import type { HandoutOverlayProps } from './types';
  import HandoutImage from './HandoutImage.svelte';
  let { handout, bucketUrl }: HandoutOverlayProps = $props();
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
</script>

<section
  class="handout-overlay"
  aria-label="Shared handout"
  data-testid="handoutOverlay"
  data-presentation-id={handout.presentationId}
  transition:fade={{ duration: reduceMotion ? 0 : 150 }}
>
  {#key handout.presentationId}<HandoutImage
      artworkLocation={handout.artworkLocation}
      title={handout.title}
      {bucketUrl}
    />{/key}
</section>

<style>
  .handout-overlay {
    position: fixed;
    inset: 0;
    z-index: 2147483000;
    padding: 1rem;
    background: color-mix(in srgb, var(--bg) 92%, transparent);
    color: var(--fg);
    touch-action: none;
    overflow: hidden;
  }
  .handout-overlay :global(.handout-image__original) {
    box-shadow: var(--shadow-2);
  }
</style>
