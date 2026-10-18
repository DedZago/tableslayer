<script lang="ts">
  import { onMount } from 'svelte';
  import { v4 as uuidv4 } from 'uuid';
  import { Icon, IconButton } from '@tableslayer/ui';
  import { IconX } from '@tabler/icons-svelte';
  import { handleMutation } from '$lib/factories';
  import {
    createAssetCatalogQuery,
    useAssetCatalogRefreshMutation,
    useAssetImportMutation,
    useAssetImportPreviewMutation
  } from '$lib/queries/assetImport';
  import type {
    FiveToolsImportItem,
    FiveToolsImportResult,
    FiveToolsPreview
  } from '$lib/server/assets/fivetools/types';
  import type { AssetImportRow } from './types';
  import AssetCatalogBrowser, { type CatalogFilters } from './AssetCatalogBrowser.svelte';
  import AssetCatalogResults from './AssetCatalogResults.svelte';
  import AssetImportFooter, { importBatchSize, type DuplicatePolicy } from './AssetImportFooter.svelte';
  import AssetStatPreview from './AssetStatPreview.svelte';

  const maxUploadBytes = 10 * 1024 * 1024;
  const focusableSelector =
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]';

  let { onClose, onPlace }: { onClose: () => void; onPlace?: (assetId: string) => void } = $props();

  const preview = useAssetImportPreviewMutation();
  const importer = useAssetImportMutation();
  const refreshCatalog = useAssetCatalogRefreshMutation();

  let dialog = $state<HTMLElement>();
  let browser = $state<ReturnType<typeof AssetCatalogBrowser>>();
  let searchElement = $state<HTMLInputElement>();
  let filters = $state<CatalogFilters>({ search: '', source: '', crRange: '', creatureType: '', offset: 0 });
  let activeIndex = $state(0);
  let previewRecord = $state<FiveToolsPreview | null>(null);
  let rows = $state<AssetImportRow[]>([]);
  let duplicatePolicy = $state<DuplicatePolicy>('skip');
  let busy = $state(false);
  let summary = $state('');
  let uploadError = $state('');

  const catalog = createAssetCatalogQuery(
    () => filters.search,
    () => filters.source,
    () => filters.offset,
    () => true,
    () => ({ crRange: filters.crRange, creatureType: filters.creatureType })
  );
  const uploadedRecords = $derived(rows.filter((row) => row.uploaded).map((row) => row.record));
  const uploadedIdentities = $derived(new Set(uploadedRecords.map((record) => record.identity)));
  const records = $derived((catalog.data?.records ?? []).filter((record) => !uploadedIdentities.has(record.identity)));
  const sources = $derived(catalog.data?.sources ?? []);
  const activeRecord = $derived(records[Math.min(activeIndex, records.length - 1)]);
  const selectedRows = $derived(rows.filter((row) => row.selected));
  const pendingRows = $derived(selectedRows.filter((row) => !row.result || row.result.status === 'failed'));
  const failedRows = $derived(selectedRows.filter((row) => row.result?.status === 'failed'));

  $effect(() => {
    searchElement?.focus();
  });

  onMount(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => previous?.focus();
  });

  const updateFilters = (patch: Partial<CatalogFilters>) => {
    Object.assign(filters, patch);
    activeIndex = 0;
  };

  const findRow = (identity: string) => rows.find((row) => row.record.identity === identity);
  const isSelected = (identity: string) => findRow(identity)?.selected ?? false;
  const resultFor = (identity: string): FiveToolsImportResult | undefined => findRow(identity)?.result;

  const newRow = (record: FiveToolsPreview, uploaded: boolean): AssetImportRow => ({
    record,
    selected: true,
    uploaded,
    policy: 'skip',
    targetId: record.duplicates?.[0]?.id,
    requestId: uuidv4()
  });

  const selectRecord = (record: FiveToolsPreview, selected: boolean) => {
    const row = findRow(record.identity);
    if (row) row.selected = selected;
    else rows.push(newRow(record, false));
  };

  const addUploadedRecord = (record: FiveToolsPreview) => {
    const row = findRow(record.identity);
    if (row) Object.assign(row, newRow(record, true));
    else rows.push(newRow(record, true));
  };

  const toggleRecord = (record: FiveToolsPreview) => selectRecord(record, !isSelected(record.identity));

  const changePolicy = (policy: DuplicatePolicy) => {
    duplicatePolicy = policy;
    rows.forEach((row) => {
      if (!row.record.duplicates?.length || !row.result) return;
      row.requestId = uuidv4();
      row.result = undefined;
    });
  };

  const toItem = (row: AssetImportRow): FiveToolsImportItem => ({
    record: row.record,
    requestId: row.requestId,
    policy: row.policy,
    targetId: row.policy === 'update' ? row.targetId : undefined
  });

  const summarize = (results: FiveToolsImportResult[]) => {
    const count = (status: FiveToolsImportResult['status']) =>
      results.filter((result) => result.status === status).length;
    return `${count('created') + count('updated')} added, ${count('skipped')} skipped, ${count('failed')} failed`;
  };

  const importRows = async (batch: AssetImportRow[]) => {
    batch.forEach((row) => {
      row.policy = row.record.duplicates?.length ? duplicatePolicy : 'skip';
    });
    const response = await handleMutation({
      mutation: () => importer.mutateAsync({ action: 'import', items: batch.map(toItem) }),
      formLoadingState: (value) => (busy = value),
      toastMessages: { error: { title: 'Asset import failed', body: (error) => error.message } }
    });
    response?.results.forEach((result) => {
      const row = batch.find((item) => item.requestId === result.requestId);
      if (row) row.result = result;
    });
    return response?.results;
  };

  const importPending = async () => {
    const batch = pendingRows.slice(0, importBatchSize);
    if (!batch.length) return;
    const results = await importRows(batch);
    if (results) summary = summarize(results);
  };

  const retryFailed = async () => {
    const batch = failedRows.slice(0, importBatchSize);
    if (!batch.length) return;
    const results = await importRows(batch);
    if (results) summary = summarize(results);
  };

  const addRecord = async (record: FiveToolsPreview) => {
    selectRecord(record, true);
    const row = findRow(record.identity);
    if (!row) return undefined;
    if (row.result?.status === 'created' || row.result?.status === 'updated') return row.result;
    return (await importRows([row]))?.[0];
  };

  const addToLibrary = async () => {
    if (!previewRecord) return;
    const result = await addRecord(previewRecord);
    if (result) summary = summarize([result]);
  };

  const addAndPlace = async () => {
    if (!previewRecord) return;
    const result = await addRecord(previewRecord);
    if (!result || result.status === 'failed') return;
    const assetId = result.assetId ?? previewRecord.duplicates?.[0]?.id;
    if (!assetId) return;
    onPlace?.(assetId);
    onClose();
  };

  const uploadFile = async (file: File) => {
    uploadError = '';
    if (file.size > maxUploadBytes) {
      uploadError = 'Bestiary JSON exceeds the 10MB limit';
      return;
    }
    const response = await handleMutation({
      mutation: async () => preview.mutateAsync({ action: 'preview', json: await file.text() }),
      formLoadingState: (value) => (busy = value),
      toastMessages: { error: { title: 'Import preview failed', body: (error) => error.message } }
    });
    response?.records.forEach(addUploadedRecord);
    if (response)
      summary = `${response.records.length} uploaded ${response.records.length === 1 ? 'creature' : 'creatures'} selected`;
  };

  const refresh = () => {
    if (!window.confirm('Refresh the 5etools catalog from upstream? Every source file is downloaded again.')) return;
    handleMutation({
      mutation: () => refreshCatalog.mutateAsync({ action: 'refresh' }),
      formLoadingState: (value) => (busy = value),
      toastMessages: { error: { title: 'Catalog refresh failed', body: (error) => error.message } }
    });
  };

  const moveActive = (step: number) => {
    if (!records.length) return;
    activeIndex = Math.min(Math.max(activeIndex + step, 0), records.length - 1);
  };

  const trapFocus = (event: KeyboardEvent) => {
    const focusable = [...(dialog?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])].filter(
      (element) => element.offsetParent !== null
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    const outside = !dialog?.contains(document.activeElement);
    if (event.shiftKey && (document.activeElement === first || outside)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || outside)) {
      event.preventDefault();
      first.focus();
    }
  };

  const isListKeyTarget = (target: EventTarget | null) =>
    target === searchElement || target === dialog || target === document.body;

  const closeOpenSelect = (target: EventTarget | null) => {
    const button = dialog?.querySelector<HTMLElement>('[aria-haspopup="listbox"][aria-expanded="true"]');
    if (!button) return false;
    const owner = button.parentElement;
    if (!(target instanceof Node && owner?.contains(target))) button.click();
    return true;
  };

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (closeOpenSelect(event.target) || browser?.closeMenus()) return;
      onClose();
      return;
    }
    if (event.key === 'Tab') {
      trapFocus(event);
      return;
    }
    if (!isListKeyTarget(event.target)) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter' && activeRecord) {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) toggleRecord(activeRecord);
      else previewRecord = activeRecord;
    }
  };
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="assetCatalog">
  <button type="button" class="assetCatalog__scrim" tabindex="-1" aria-label="Close" onclick={onClose}></button>
  <div
    class="assetCatalog__dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="asset-catalog-title"
    bind:this={dialog}
  >
    <header class="assetCatalog__header">
      <h2 id="asset-catalog-title" class="assetCatalog__title">Add creatures from 5etools</h2>
      <IconButton variant="ghost" size="md" aria-label="Close" onclick={onClose}>
        <Icon Icon={IconX} size="1.25rem" />
      </IconButton>
    </header>

    <AssetCatalogBrowser
      bind:this={browser}
      bind:searchElement
      {filters}
      {sources}
      {busy}
      onFiltersChange={updateFilters}
      onUploadFile={uploadFile}
      onRefresh={refresh}
    />

    <div class="assetCatalog__layout">
      <AssetCatalogResults
        catalog={catalog.data}
        {records}
        uploaded={uploadedRecords}
        error={catalog.error?.message}
        offset={filters.offset}
        {activeIndex}
        previewIdentity={previewRecord?.identity}
        {isSelected}
        {resultFor}
        onToggle={toggleRecord}
        onPreview={(record) => (previewRecord = record)}
        onPageChange={(offset) => updateFilters({ offset })}
      />
      <div class="assetCatalog__preview">
        {#if previewRecord}
          <AssetStatPreview record={previewRecord} {busy} onAddToLibrary={addToLibrary} onAddAndPlace={addAndPlace} />
        {:else}
          <p class="assetCatalog__empty">Select a creature to see its stat block.</p>
        {/if}
      </div>
    </div>

    {#if uploadError}
      <p class="assetCatalog__error" role="alert">{uploadError}</p>
    {/if}
    <AssetImportFooter
      selectedCount={selectedRows.length}
      pendingCount={pendingRows.length}
      failedCount={failedRows.length}
      policy={duplicatePolicy}
      {busy}
      {summary}
      onPolicyChange={changePolicy}
      onImport={importPending}
      onRetry={retryFailed}
    />
  </div>
</div>

<style>
  .assetCatalog {
    position: fixed;
    inset: 3rem;
    z-index: 50;
    display: flex;
  }
  .assetCatalog__scrim {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--bg) 60%, transparent);
    border: none;
    cursor: default;
  }
  .assetCatalog__dialog {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: 100%;
    min-height: 0;
    padding: 1rem;
    background: var(--bg);
    border: var(--borderThin);
    border-radius: var(--radius-3);
    box-shadow: var(--shadow-3);
    overflow: hidden;
    container-type: inline-size;
  }
  .assetCatalog__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .assetCatalog__title {
    margin: 0;
    font-size: 1.125rem;
  }
  .assetCatalog__layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(18rem, 24rem);
    grid-template-rows: minmax(0, 1fr);
    gap: 1rem;
    flex: 1;
    min-height: 0;
  }
  .assetCatalog__preview {
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding-left: 1rem;
    border-left: var(--borderThin);
    overflow: hidden;
  }
  .assetCatalog__empty {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--fgMuted);
  }
  .assetCatalog__error {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--fgDanger);
  }
  @container (max-width: 48rem) {
    .assetCatalog__layout {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) minmax(0, 45%);
    }
    .assetCatalog__preview {
      padding: 1rem 0 0;
      border-left: none;
      border-top: var(--borderThin);
    }
  }
  @media (max-width: 767px) {
    .assetCatalog {
      inset: 0;
    }
  }
</style>
