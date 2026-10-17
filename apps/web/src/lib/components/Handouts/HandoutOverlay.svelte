<script lang="ts">
  import type { HandoutOverlayProps } from './types';
  import HandoutImage from './HandoutImage.svelte';
  let { handout, bucketUrl }: HandoutOverlayProps = $props();
</script>

<section
  class="handout-overlay"
  aria-label="Shared handout"
  data-testid="handoutOverlay"
  data-presentation-id={handout.presentationId}
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
    background: var(--bg);
    color: var(--fg);
    touch-action: none;
    overflow: hidden;
  }
</style>
