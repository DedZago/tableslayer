<script lang="ts">
  import { IconAlertTriangle, IconCircleCheck } from '@tabler/icons-svelte';
  import { Icon, ToolTip } from '@tableslayer/ui';
  import type { FiveToolsImportResult, FiveToolsPreview } from '$lib/server/assets/fivetools/types';

  let {
    record,
    selected,
    previewing,
    active,
    owned,
    result,
    onToggle,
    onPreview
  }: {
    record: FiveToolsPreview;
    selected: boolean;
    previewing: boolean;
    active: boolean;
    owned: boolean;
    result?: FiveToolsImportResult;
    onToggle: () => void;
    onPreview: () => void;
  } = $props();

  const meta = $derived([record.creatureType, record.source].filter(Boolean).join(' · '));
  const resultLabel = $derived(result ? `${result.status}: ${result.message ?? record.name}` : '');
</script>

<li
  class="assetCatalog__row"
  class:assetCatalog__row--previewing={previewing}
  data-active={active}
  data-testid="asset-catalog-row"
>
  <input
    class="assetCatalog__rowCheck"
    type="checkbox"
    checked={selected}
    aria-label={`Select ${record.name}`}
    onchange={onToggle}
  />
  <button type="button" class="assetCatalog__rowBody" aria-pressed={previewing} onclick={onPreview}>
    {#if record.tokenUrl}
      <img class="assetCatalog__rowThumb" src={record.tokenUrl} alt="" loading="lazy" />
    {:else}
      <span class="assetCatalog__rowThumb assetCatalog__rowThumb--empty" aria-hidden="true"></span>
    {/if}
    <span class="assetCatalog__rowText">
      <span class="assetCatalog__rowName">{record.name}</span>
      <span class="assetCatalog__rowMeta">{meta}</span>
    </span>
  </button>
  <span class="assetCatalog__rowBadges">
    {#if owned}<span class="assetCatalog__badge assetCatalog__badge--owned">In library</span>{/if}
    {#if record.cr}<span class="assetCatalog__badge assetCatalog__badge--cr">CR {record.cr}</span>{/if}
    {#if record.size}<span class="assetCatalog__badge">{record.size}</span>{/if}
  </span>
  {#if result}
    <ToolTip positioning={{ placement: 'left' }}>
      {#snippet children()}
        <span
          class="assetCatalog__result"
          class:assetCatalog__result--failed={result.status === 'failed'}
          role="img"
          aria-label={resultLabel}
        >
          <Icon Icon={result.status === 'failed' ? IconAlertTriangle : IconCircleCheck} size="1.125rem" />
        </span>
      {/snippet}
      {#snippet toolTipContent()}
        {resultLabel}
      {/snippet}
    </ToolTip>
  {/if}
</li>

<style>
  .assetCatalog__row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0.5rem;
    border-radius: var(--radius-2);
    border: var(--borderThin);
    border-color: transparent;
  }
  .assetCatalog__row[data-active='true'] {
    border-color: var(--fgMuted);
  }
  .assetCatalog__row--previewing {
    background: var(--contrastLow);
  }
  .assetCatalog__rowCheck {
    width: 1rem;
    height: 1rem;
    accent-color: var(--fgPrimary);
    cursor: pointer;
  }
  .assetCatalog__rowBody {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    min-width: 0;
    padding: 0;
    background: none;
    border: none;
    color: var(--fg);
    text-align: left;
    cursor: pointer;
  }
  .assetCatalog__rowBody:focus-visible {
    outline: 2px solid var(--fgPrimary);
    outline-offset: 2px;
    border-radius: var(--radius-2);
  }
  .assetCatalog__rowThumb {
    width: 2.5rem;
    height: 2.5rem;
    flex-shrink: 0;
    object-fit: contain;
    border-radius: var(--radius-2);
    background: var(--contrastLow);
  }
  .assetCatalog__rowText {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .assetCatalog__rowName {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .assetCatalog__rowMeta {
    font-size: 0.75rem;
    color: var(--fgMuted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .assetCatalog__rowBadges {
    display: flex;
    gap: 0.25rem;
    align-items: center;
  }
  .assetCatalog__badge {
    font-size: 0.6875rem;
    padding: 0.125rem 0.375rem;
    border-radius: 999px;
    border: var(--borderThin);
    color: var(--fgMuted);
    white-space: nowrap;
  }
  .assetCatalog__badge--cr {
    color: var(--fg);
  }
  .assetCatalog__badge--owned {
    font-style: italic;
  }
  .assetCatalog__result {
    display: inline-flex;
    color: var(--fgSuccess);
  }
  .assetCatalog__result--failed {
    color: var(--fgDanger);
  }
</style>
