<script lang="ts">
  import AssetCatalogOverlay from './AssetCatalogOverlay.svelte';

  let { onClose }: { onClose: () => void } = $props();
</script>

<AssetCatalogOverlay {onClose} />
