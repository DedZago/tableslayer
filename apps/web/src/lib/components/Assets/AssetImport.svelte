<script lang="ts">
  import AssetCatalogOverlay from './AssetCatalogOverlay.svelte';

  let { onClose, onPlace }: { onClose: () => void; onPlace?: (assetId: string) => void } = $props();
</script>

<AssetCatalogOverlay {onClose} {onPlace} />
