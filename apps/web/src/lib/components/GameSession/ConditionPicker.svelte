<script lang="ts">
  import { Button, Icon, IconButton, Input } from '@tableslayer/ui';
  import { IconEyeOff, IconMinus, IconPlus, IconX } from '@tabler/icons-svelte';
  import { MARKER_CONDITION_ORDER, resolveCondition, type MarkerCondition } from '@tableslayer/stage';

  let {
    active,
    mixed,
    customSuggestions = [],
    automatic = new Set<string>(),
    onToggle,
    onStepValue,
    onToggleDmOnly,
    onClear
  }: {
    active: MarkerCondition[];
    mixed: Set<string>;
    customSuggestions?: MarkerCondition[];
    automatic?: Set<string>;
    onToggle: (condition: MarkerCondition) => void;
    onStepValue: (id: string, delta: number) => void;
    onToggleDmOnly: (id: string) => void;
    onClear: () => void;
  } = $props();

  const EXHAUSTION_MAX = 6;
  const CUSTOM_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#ec4899'];
  const catalogIdsInGroup = (group: 'condition' | 'combat') =>
    MARKER_CONDITION_ORDER.filter((id) => resolveCondition({ id }).group === group);
  const conditionIds = catalogIdsInGroup('condition');
  const combatIds = catalogIdsInGroup('combat');

  let customLabel = $state('');
  let customColor = $state(CUSTOM_COLORS[0]);

  const activeById = $derived(new Map(active.map((condition) => [condition.id, condition])));
  const exhaustion = $derived(activeById.get('exhaustion'));
  // Undefined when the selected tokens are at different levels
  const exhaustionLevel = $derived(exhaustion?.value);
  const hasAnyCondition = $derived(active.length > 0 || mixed.size > 0);
  const customConditions = $derived.by(() => {
    const seen = new Set<string>();
    return [...active, ...customSuggestions].filter((condition) => {
      if (resolveCondition(condition).group !== 'custom' || seen.has(condition.id)) return false;
      seen.add(condition.id);
      return true;
    });
  });

  const addCustomCondition = () => {
    const label = customLabel.trim().slice(0, 24);
    if (!label) return;
    onToggle({ id: `custom:${crypto.randomUUID()}`, label, color: customColor });
    customLabel = '';
  };

  const handleCustomSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    addCustomCondition();
  };
</script>

{#snippet chip(condition: MarkerCondition)}
  {@const info = resolveCondition(condition)}
  {@const isAutomatic = !activeById.has(condition.id) && automatic.has(condition.id)}
  {@const isActive = activeById.has(condition.id) || isAutomatic}
  {@const dmOnly = activeById.get(condition.id)?.dmOnly === true}
  <div class="conditionPicker__chipWrap">
    <button
      type="button"
      class={[
        'conditionPicker__chip',
        isActive && 'conditionPicker__chip--active',
        !isActive && mixed.has(condition.id) && 'conditionPicker__chip--mixed',
        dmOnly && 'conditionPicker__chip--dmOnly'
      ]}
      style:--conditionColor={info.color}
      aria-pressed={isActive}
      disabled={isAutomatic}
      title={isAutomatic ? `${info.description} Set automatically from hit points.` : info.description}
      onclick={() => onToggle(condition)}
    >
      <span class="conditionPicker__swatch"></span>
      <span class="conditionPicker__label">{info.label}</span>
      {#if isActive && info.group === 'custom'}
        <Icon Icon={IconX} size="0.75rem" />
      {/if}
    </button>
    {#if isActive && !isAutomatic}
      <button
        type="button"
        class={['conditionPicker__dmToggle', dmOnly && 'conditionPicker__dmToggle--visible']}
        aria-label={dmOnly ? `Show ${info.label} to players` : `Hide ${info.label} from players`}
        title={dmOnly ? 'Visible to players' : 'Hidden from players'}
        onclick={() => onToggleDmOnly(condition.id)}
      >
        <Icon Icon={IconEyeOff} size="0.75rem" />
      </button>
    {/if}
  </div>
{/snippet}

<div class="conditionPicker">
  <div class="conditionPicker__header">
    <span class="conditionPicker__title">Conditions</span>
    <Button variant="ghost" size="sm" isDisabled={!hasAnyCondition} onclick={onClear}>Clear</Button>
  </div>

  <div class="conditionPicker__chips">
    {#each conditionIds as id (id)}
      {@render chip({ id })}
    {/each}
  </div>

  {#if exhaustion}
    <div class="conditionPicker__exhaustion">
      <span class="conditionPicker__groupTitle">Exhaustion</span>
      <IconButton
        variant="ghost"
        size="sm"
        aria-label="Decrease exhaustion"
        onclick={() => onStepValue('exhaustion', -1)}
      >
        <Icon Icon={IconMinus} size="0.875rem" />
      </IconButton>
      <span class="conditionPicker__level">{exhaustionLevel ?? 'Mixed'}</span>
      <IconButton
        variant="ghost"
        size="sm"
        aria-label="Increase exhaustion"
        disabled={exhaustionLevel !== undefined && exhaustionLevel >= EXHAUSTION_MAX}
        onclick={() => onStepValue('exhaustion', 1)}
      >
        <Icon Icon={IconPlus} size="0.875rem" />
      </IconButton>
    </div>
  {/if}

  <div class="conditionPicker__groupTitle">Combat</div>
  <div class="conditionPicker__chips">
    {#each combatIds as id (id)}
      {@render chip({ id })}
    {/each}
  </div>

  <div class="conditionPicker__groupTitle">Custom</div>
  <div class="conditionPicker__chips">
    {#each customConditions as condition (condition.id)}
      {@render chip(condition)}
    {/each}
  </div>

  <form class="conditionPicker__custom" onsubmit={handleCustomSubmit}>
    <div class="conditionPicker__customName">
      <Input maxlength={24} placeholder="Name" aria-label="Custom condition name" bind:value={customLabel} />
    </div>
    <div class="conditionPicker__customColor" role="radiogroup" aria-label="Custom condition color">
      {#each CUSTOM_COLORS as color}
        <button
          type="button"
          role="radio"
          aria-checked={customColor === color}
          aria-label={color}
          class={['conditionPicker__swatchButton', customColor === color && 'conditionPicker__swatchButton--selected']}
          style:background-color={color}
          onclick={() => (customColor = color)}
        ></button>
      {/each}
    </div>
    <Button type="submit" size="sm" variant="ghost" isDisabled={!customLabel.trim()}>Add</Button>
  </form>
</div>

<style>
  .conditionPicker {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    font-size: 0.875rem;
    color: var(--fg);
  }

  .conditionPicker__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .conditionPicker__title {
    font-weight: var(--font-weight-6);
  }

  .conditionPicker__groupTitle {
    font-size: 0.75rem;
    color: var(--fgMuted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .conditionPicker__chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .conditionPicker__chipWrap {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  .conditionPicker__chip {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.125rem 0.5rem;
    font: inherit;
    font-size: 0.75rem;
    color: var(--fg);
    background: var(--inputBg);
    border: var(--borderThin);
    border-radius: var(--radius-2);
    cursor: pointer;
  }

  .conditionPicker__chip:hover {
    background: var(--menuItemHover);
  }

  .conditionPicker__chip--active {
    background: color-mix(in srgb, var(--conditionColor) 25%, transparent);
    border-color: var(--conditionColor);
  }

  .conditionPicker__chip:disabled {
    cursor: default;
    background: color-mix(in srgb, var(--conditionColor) 25%, transparent);
  }

  .conditionPicker__chip--mixed {
    border-style: dashed;
    border-color: var(--conditionColor);
  }

  .conditionPicker__chip--dmOnly .conditionPicker__label {
    font-style: italic;
  }

  .conditionPicker__swatch {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--conditionColor);
    flex-shrink: 0;
  }

  .conditionPicker__dmToggle {
    position: absolute;
    top: -0.375rem;
    right: -0.375rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.125rem;
    height: 1.125rem;
    padding: 0;
    color: var(--fg);
    background: var(--bg);
    border: var(--borderThin);
    border-radius: 50%;
    cursor: pointer;
    opacity: 0;
  }

  .conditionPicker__chipWrap:hover .conditionPicker__dmToggle,
  .conditionPicker__dmToggle:focus-visible,
  .conditionPicker__dmToggle--visible {
    opacity: 1;
  }

  .conditionPicker__exhaustion {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .conditionPicker__level {
    min-width: 1.5rem;
    text-align: center;
    font-weight: var(--font-weight-6);
  }

  .conditionPicker__custom {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .conditionPicker__customName {
    flex: 1 1 8rem;
  }

  .conditionPicker__customColor {
    display: flex;
    gap: 0.25rem;
  }

  .conditionPicker__swatchButton {
    width: 1rem;
    height: 1rem;
    padding: 0;
    border-radius: 50%;
    border: var(--borderThin);
    cursor: pointer;
  }

  .conditionPicker__swatchButton--selected {
    outline: 2px solid var(--fg);
    outline-offset: 1px;
  }
</style>
