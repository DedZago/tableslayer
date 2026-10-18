<script module lang="ts">
  import type { SelectOption } from '@tableslayer/ui';
  import type { FiveToolsImportItem } from '$lib/server/assets/fivetools/types';

  export type DuplicatePolicy = FiveToolsImportItem['policy'];
  export const importBatchSize = 100;
  const policies: DuplicatePolicy[] = ['skip', 'update', 'another'];
  export const duplicatePolicyOptions: SelectOption[] = [
    { value: 'skip', label: 'Skip' },
    { value: 'update', label: 'Update artwork' },
    { value: 'another', label: 'Add another' }
  ];
  export const toDuplicatePolicy = (value?: string): DuplicatePolicy =>
    policies.find((policy) => policy === value) ?? 'skip';
</script>

<script lang="ts">
  import { Button, Select } from '@tableslayer/ui';

  let {
    selectedCount,
    pendingCount,
    failedCount,
    policy,
    busy = false,
    summary = '',
    onPolicyChange,
    onImport,
    onRetry
  }: {
    selectedCount: number;
    pendingCount: number;
    failedCount: number;
    policy: DuplicatePolicy;
    busy?: boolean;
    summary?: string;
    onPolicyChange: (policy: DuplicatePolicy) => void;
    onImport: () => void;
    onRetry: () => void;
  } = $props();

  const batchCount = $derived(Math.min(pendingCount, importBatchSize));
</script>

<footer class="assetCatalog__footer">
  <p class="assetCatalog__footerStatus" role="status">
    {selectedCount} selected{summary ? ` · ${summary}` : ''}
  </p>
  <div class="assetCatalog__footerActions">
    <div class="assetCatalog__policy">
      <span>If already in library</span>
      <Select
        aria-label="If already in library"
        selected={[policy]}
        options={duplicatePolicyOptions}
        onSelectedChange={(value) => onPolicyChange(toDuplicatePolicy(value[0]))}
      />
    </div>
    {#if failedCount}
      <Button variant="link" size="sm" isDisabled={busy} onclick={onRetry}>Retry {failedCount} failed</Button>
    {/if}
    <Button isLoading={busy} isDisabled={busy || batchCount === 0} onclick={onImport}>
      Add {batchCount} to library
    </Button>
  </div>
</footer>

<style>
  .assetCatalog__footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    border-top: var(--borderThin);
  }
  .assetCatalog__footerStatus {
    margin: 0;
    font-size: 0.875rem;
  }
  .assetCatalog__footerActions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
  }
  .assetCatalog__policy {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8125rem;
    color: var(--fgMuted);
  }
</style>
