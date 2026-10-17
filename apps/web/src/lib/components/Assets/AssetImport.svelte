<script lang="ts">
  import { v4 as uuidv4 } from 'uuid';
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

  const preview = useAssetImportPreviewMutation();
  const importer = useAssetImportMutation();
  let rows = $state<AssetImportRow[]>([]);
  let loading = $state(false);
  let filter = $state('');
  let error = $state('');
  let catalogOpen = $state(false);
  let catalogSearch = $state('');
  let debouncedSearch = $state('');
  let catalogSource = $state('');
  let catalogOffset = $state(0);
  const catalog = createAssetCatalogQuery(
    () => debouncedSearch,
    () => catalogSource,
    () => catalogOffset,
    () => catalogOpen
  );
  const refreshCatalog = useAssetCatalogRefreshMutation();
  $effect(() => {
    const value = catalogSearch;
    const timer = setTimeout(() => {
      debouncedSearch = value;
      catalogOffset = 0;
    }, 250);
    return () => clearTimeout(timer);
  });
  const previewRecords = (records: FiveToolsPreview[], selected: boolean) => {
    rows = records.map((record) => ({
      record,
      selected,
      policy: 'skip',
      targetId: record.duplicates?.[0]?.id,
      requestId: uuidv4()
    }));
    filter = '';
  };
  const addCatalogRecord = (record: FiveToolsPreview) => {
    if (rows.some((row) => row.record.identity === record.identity)) return;
    rows.push({ record, selected: true, policy: 'skip', targetId: record.duplicates?.[0]?.id, requestId: uuidv4() });
  };
  const refresh = () =>
    handleMutation({
      mutation: () => refreshCatalog.mutateAsync({ action: 'refresh' }),
      formLoadingState: (value) => (loading = value),
      toastMessages: { error: { title: 'Catalog refresh failed', body: (error) => error.message } }
    });
  const visibleRows = $derived(
    rows.filter((row) => `${row.record.name} ${row.record.source}`.toLowerCase().includes(filter.toLowerCase()))
  );

  const loadFile = async (event: Event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    error = '';
    if (file.size > 10 * 1024 * 1024) {
      error = 'Bestiary JSON exceeds the 10MB limit';
      return;
    }
    const result = await handleMutation({
      mutation: async () => preview.mutateAsync({ action: 'preview', json: await file.text() }),
      formLoadingState: (value) => (loading = value),
      toastMessages: { error: { title: 'Import preview failed', body: (error) => error.message } }
    });
    if (result) {
      previewRecords(result.records, true);
    }
  };
  const changePolicy = (row: AssetImportRow) => {
    row.requestId = uuidv4();
    row.result = undefined;
  };
  const runImport = async (retry = false) => {
    const selected = rows.filter(
      (row) => row.selected && (retry ? row.result?.status === 'failed' : !row.result || row.result.status === 'failed')
    );
    if (!selected.length) return;
    const items: FiveToolsImportItem[] = selected.slice(0, 100).map((row) => ({
      record: row.record,
      policy: row.policy,
      targetId: row.policy === 'update' ? row.targetId : undefined,
      requestId: row.requestId
    }));
    const response = await handleMutation({
      mutation: () => importer.mutateAsync({ action: 'import', items }),
      formLoadingState: (value) => (loading = value),
      toastMessages: { error: { title: 'Asset import failed', body: (error) => error.message } }
    });
    if (response)
      response.results.forEach((result: FiveToolsImportResult) => {
        const row = rows.find((row) => row.requestId === result.requestId);
        if (row) row.result = result;
      });
  };
</script>

<details class="asset-import">
  <summary>Import 5etools assets</summary>
  <div class="asset-import__body">
    <details class="asset-import__catalog" ontoggle={(event) => (catalogOpen = event.currentTarget.open)}>
      <summary>Search 5etools catalog</summary>
      <div class="asset-import__body">
        <label>
          Search names <input
            class="asset-import__input"
            type="search"
            bind:value={catalogSearch}
            placeholder="Search all sources"
          />
        </label>
        <label>
          Source <select
            aria-label="Catalog source"
            class="asset-import__input"
            bind:value={catalogSource}
            onchange={() => (catalogOffset = 0)}
          >
            <option value="">All sources</option>
            {#each catalog.data?.sources ?? [] as source}<option value={source}>{source}</option>{/each}
          </select>
        </label>
        {#if catalog.error}<p class="asset-import__error" role="alert">{catalog.error.message}</p>{/if}
        {#if catalog.data?.status.state === 'loading'}
          <p role="status">
            Loading all sources: {catalog.data.status.completed} of {catalog.data.status.total || '…'} files. Downloaded catalog
            data is saved for later searches.
          </p>
        {:else if catalog.data?.status.state === 'error'}
          <p class="asset-import__error" role="alert">{catalog.data.status.error}</p>
        {:else if catalog.data?.status.state === 'ready'}
          <p role="status">{catalog.data.totalMatches} matches across {catalog.data.sources.length} sources.</p>
          <button
            class="asset-import__button"
            disabled={loading}
            onclick={() => catalog.data?.records.forEach(addCatalogRecord)}
          >
            Add visible results to import preview
          </button>
          <div class="asset-import__list">
            {#each catalog.data.records as record (record.identity)}
              <div class="asset-import__item">
                <span>{record.name} ({record.source})</span>
                <button
                  class="asset-import__button"
                  disabled={loading || rows.some((row) => row.record.identity === record.identity)}
                  onclick={() => addCatalogRecord(record)}
                >
                  Add to import preview
                </button>
              </div>
            {/each}
          </div>
          <div class="asset-import__actions">
            <button
              class="asset-import__button"
              disabled={catalogOffset === 0}
              onclick={() => (catalogOffset = Math.max(0, catalogOffset - 100))}
            >
              Previous results
            </button>
            <button
              class="asset-import__button"
              disabled={catalogOffset + 100 >= catalog.data.totalMatches}
              onclick={() => (catalogOffset += 100)}
            >
              Next results
            </button>
          </div>
        {/if}
        {#if catalog.data?.status.warnings.length}
          <details>
            <summary>Some catalog files could not be loaded ({catalog.data.status.warnings.length})</summary>
            {#each catalog.data.status.warnings as warning}<p class="asset-import__warning">{warning}</p>{/each}
          </details>
        {/if}
        <button
          class="asset-import__button"
          disabled={loading || catalog.data?.status.state === 'loading'}
          onclick={refresh}
        >
          Refresh catalog from upstream
        </button>
      </div>
    </details>
    <p>Choose bestiary JSON. Names and artwork are imported; statblocks are omitted.</p>
    <input
      aria-label="Bestiary JSON"
      type="file"
      accept="application/json,.json"
      disabled={loading}
      onchange={loadFile}
    />
    {#if error}<p class="asset-import__error" role="alert">{error}</p>{/if}
    {#if rows.length}
      <button class="asset-import__button" disabled={loading} onclick={() => (rows = [])}>Clear import preview</button>
      <input
        class="asset-import__input"
        aria-label="Filter import preview"
        type="search"
        bind:value={filter}
        placeholder="Filter names or sources"
      />
      <div class="asset-import__actions">
        <button
          class="asset-import__button"
          disabled={loading}
          onclick={() => visibleRows.forEach((row) => (row.selected = true))}
        >
          Select visible
        </button>
        <button
          class="asset-import__button"
          disabled={loading}
          onclick={() => rows.forEach((row) => (row.selected = false))}
        >
          Clear selection
        </button>
      </div>
      <div class="asset-import__list">
        {#each visibleRows as row (row.record.identity)}
          <div class="asset-import__item">
            <label>
              <input type="checkbox" bind:checked={row.selected} disabled={loading} />
              {row.record.name} ({row.record.source})
            </label>
            <p>
              {row.record.artworkUrl ? 'Portrait available' : 'No portrait'} · {row.record.tokenUrl
                ? 'Token artwork available'
                : 'No token artwork'}
            </p>
            {#each row.record.warnings as warning}<p class="asset-import__warning">{warning}</p>{/each}
            {#if row.record.duplicates?.length}
              <p>Already imported: {row.record.duplicates.map((asset) => asset.name).join(', ')}</p>
              <label>
                Duplicate action
                <select
                  class="asset-import__input"
                  bind:value={row.policy}
                  disabled={loading}
                  onchange={() => changePolicy(row)}
                >
                  <option value="skip">Skip</option>
                  <option value="update">Update artwork and provenance</option>
                  <option value="another">Create another asset</option>
                </select>
              </label>
              {#if row.policy === 'update'}
                <label>
                  Asset to update
                  <select
                    class="asset-import__input"
                    bind:value={row.targetId}
                    disabled={loading}
                    onchange={() => changePolicy(row)}
                  >
                    {#each row.record.duplicates as asset}<option value={asset.id}>{asset.name}</option>{/each}
                  </select>
                </label>
                <p>Edited names and appearance are preserved. Missing replacement artwork keeps the existing image.</p>
              {/if}
            {/if}
            {#if row.result}<p class:asset-import__error={row.result.status === 'failed'} role="status">
                {row.result.status}: {row.result.message ?? row.record.name}
              </p>{/if}
          </div>
        {/each}
      </div>
      <p>
        {rows.filter((row) => row.selected).length} selected. Each batch imports up to 100; remaining items stay ready for
        the next batch.
      </p>
      <div class="asset-import__actions">
        <button class="asset-import__button" disabled={loading} onclick={() => runImport()}>Import selected</button>
        <button
          class="asset-import__button"
          disabled={loading || !rows.some((row) => row.selected && row.result?.status === 'failed')}
          onclick={() => runImport(true)}
        >
          Retry failed items
        </button>
      </div>
    {/if}
  </div>
</details>

<style>
  .asset-import__body {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-top: 0.75rem;
  }
  .asset-import__list {
    max-height: 24rem;
    overflow: auto;
  }
  .asset-import__item {
    padding: 0.75rem 0;
    border-bottom: 1px solid var(--fgMuted);
  }
  .asset-import__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .asset-import__input,
  .asset-import__button {
    padding: 0.5rem;
    background: var(--bg);
    color: var(--fg);
    border: 1px solid var(--fgMuted);
    border-radius: 0.25rem;
  }
  .asset-import__error {
    color: var(--fgDanger);
  }
  .asset-import__warning {
    color: var(--fgMuted);
  }
</style>
