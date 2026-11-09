<script lang="ts">
  import {
    ATMOSPHERE_CATEGORIES,
    atmosphereEffectDefinition,
    atmosphereEffectsInCategory,
    type AtmosphereSlot,
    type StageProps
  } from '@tableslayer/stage';
  import { FormControl, InputSlider } from '@tableslayer/ui';
  import type { ZodIssue } from 'zod';
  import {
    ATMOSPHERE_SLOT_LABELS,
    readSlot,
    setAtmosphereParam,
    setSlotEffect,
    setSlotIntensity
  } from '$lib/utils/atmosphereActions';
  import { ATMOSPHERE_OFF_ICON, atmosphereIcon, atmosphereTileBackground } from '$lib/utils/atmosphereIcons';

  let {
    stageProps,
    slot,
    errors,
    onChange
  }: {
    stageProps: StageProps;
    slot: AtmosphereSlot;
    errors: ZodIssue[] | undefined;
    onChange?: () => void;
  } = $props();

  const categories = $derived(ATMOSPHERE_CATEGORIES[slot]);
  const current = $derived(readSlot(stageProps, slot));
  const currentDefinition = $derived(atmosphereEffectDefinition(slot, current.type));

  let picked = $state<{ slot: AtmosphereSlot; category: string } | null>(null);
  // The tab follows the selected effect (including remote changes) until the user browses elsewhere
  const activeCategory = $derived(
    (picked?.slot === slot ? picked.category : null) ?? currentDefinition?.category ?? categories[0].id
  );
  const effects = $derived(atmosphereEffectsInCategory(slot, activeCategory));

  const select = (type: number) => {
    setSlotEffect(stageProps, slot, type);
    onChange?.();
  };
</script>

<div class="atmosphereSlot">
  {#if categories.length > 1}
    <div class="atmosphereSlot__tabs" role="tablist" aria-label="{ATMOSPHERE_SLOT_LABELS[slot]} categories">
      {#each categories as category (category.id)}
        <button
          type="button"
          role="tab"
          class="atmosphereSlot__tab"
          class:atmosphereSlot__tab--active={category.id === activeCategory}
          class:atmosphereSlot__tab--holdsCurrent={category.id === currentDefinition?.category}
          aria-selected={category.id === activeCategory}
          title={category.description}
          onclick={() => (picked = { slot, category: category.id })}
        >
          {category.label}
        </button>
      {/each}
    </div>
  {/if}

  <div class="atmosphereSlot__grid">
    <button
      type="button"
      class="atmosphereSlot__tile atmosphereSlot__tile--off"
      class:atmosphereSlot__tile--selected={current.type === 0}
      aria-pressed={current.type === 0}
      title="Turn {ATMOSPHERE_SLOT_LABELS[slot].toLowerCase()} off"
      onclick={() => select(0)}
    >
      <ATMOSPHERE_OFF_ICON size={18} stroke={1.5} />
      <span class="atmosphereSlot__tileLabel">Off</span>
    </button>
    {#each effects as effect (effect.id)}
      {@const Icon = atmosphereIcon(slot, effect.id)}
      <button
        type="button"
        class="atmosphereSlot__tile"
        class:atmosphereSlot__tile--selected={current.type === effect.id}
        style:background={atmosphereTileBackground(slot, effect.id)}
        aria-pressed={current.type === effect.id}
        title={effect.hint}
        onclick={() => select(effect.id)}
      >
        <Icon size={18} stroke={1.5} />
        <span class="atmosphereSlot__tileLabel">{effect.label}</span>
      </button>
    {/each}
  </div>

  {#if current.type !== 0}
    <div class="atmosphereSlot__controls">
      <FormControl label="{currentDefinition?.label ?? 'Effect'} intensity" name="{slot}Intensity" {errors}>
        {#snippet input({ inputProps })}
          <InputSlider
            variant="opacity"
            {...inputProps}
            min={0}
            max={1}
            step={0.05}
            value={current.intensity}
            oninput={(e) => setSlotIntensity(stageProps, slot, Number(e.currentTarget.value))}
          />
        {/snippet}
      </FormControl>
      {#each currentDefinition?.params ?? [] as definition (definition.key)}
        <FormControl label={definition.label} name={definition.key} {errors}>
          {#snippet input({ inputProps })}
            <InputSlider
              {...inputProps}
              min={definition.min}
              max={definition.max}
              step={definition.step}
              value={stageProps.weather.settings?.params?.[definition.key] ?? definition.default}
              oninput={(e) => setAtmosphereParam(stageProps, definition.key, Number(e.currentTarget.value))}
            />
          {/snippet}
        </FormControl>
      {/each}
    </div>
  {/if}
</div>

<style>
  .atmosphereSlot {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .atmosphereSlot__tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .atmosphereSlot__tab {
    position: relative;
    padding: 0.125rem 0.5rem;
    border: var(--borderThin);
    border-radius: 999px;
    background: transparent;
    color: var(--fgMuted);
    font-size: 0.6875rem;
    cursor: pointer;
  }
  .atmosphereSlot__tab:hover {
    color: var(--fg);
  }
  .atmosphereSlot__tab--active {
    color: var(--fg);
    border-color: var(--fgPrimary);
  }
  /* A dot marks the category that holds the running effect while another is browsed */
  .atmosphereSlot__tab--holdsCurrent::after {
    content: '';
    position: absolute;
    top: -0.125rem;
    right: -0.125rem;
    width: 0.375rem;
    height: 0.375rem;
    border-radius: 50%;
    background: var(--fgPrimary);
  }
  .atmosphereSlot__grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.25rem;
  }
  .atmosphereSlot__tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.125rem;
    min-height: 3rem;
    padding: 0.25rem 0.125rem;
    border: 2px solid transparent;
    border-radius: 0.375rem;
    color: white;
    cursor: pointer;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
  }
  .atmosphereSlot__tile--off {
    background: var(--contrastLow);
    color: var(--fgMuted);
    text-shadow: none;
  }
  .atmosphereSlot__tile:hover {
    filter: brightness(1.15);
  }
  .atmosphereSlot__tile--selected {
    border-color: var(--fgPrimary);
    box-shadow: 0 0 0 1px var(--fgPrimary);
  }
  .atmosphereSlot__tileLabel {
    font-size: 0.625rem;
    line-height: 1.1;
    text-align: center;
    overflow-wrap: anywhere;
  }
  .atmosphereSlot__controls {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem 1rem;
  }
  .atmosphereSlot__controls > :global(:only-child) {
    grid-column: 1 / -1;
  }
</style>
