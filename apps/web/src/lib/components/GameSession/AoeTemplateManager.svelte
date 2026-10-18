<script lang="ts">
  import {
    Button,
    ColorPicker,
    ColorPickerSwatch,
    ConfirmActionButton,
    FormControl,
    Icon,
    Input,
    Link,
    Popover,
    RadioButton,
    Spacer,
    Text
  } from '@tableslayer/ui';
  import {
    AOE_EFFECT_DEFAULT_COLORS,
    AOE_EFFECT_LABELS,
    AoeEffect,
    AoeShape,
    StageMode,
    normalizeTemplateAngle,
    type AoeTemplate
  } from '@tableslayer/stage';
  import { IconArrowBack, IconCone2, IconLocationPin } from '@tabler/icons-svelte';
  import { AOE_EFFECT_ORDER, AOE_EFFECT_SWATCHES } from '$lib/utils/aoeEffectSwatches';
  import chroma from 'chroma-js';

  let {
    templates,
    selectedId,
    onSelect,
    onUpdate,
    onDelete,
    onActivateTool,
    isToolActive
  }: {
    templates: AoeTemplate[];
    selectedId: string | null;
    onSelect: (id: string | null) => void;
    onUpdate: (id: string, patch: Partial<Omit<AoeTemplate, 'id'>>) => void;
    onDelete: (id: string) => void;
    onActivateTool: () => void;
    isToolActive: boolean;
  } = $props();

  const shapeLabels: Record<AoeShape, string> = {
    [AoeShape.Circle]: 'Circle',
    [AoeShape.Square]: 'Cube',
    [AoeShape.Cone]: 'Cone',
    [AoeShape.Line]: 'Line'
  };

  const visibilityOptions = [
    { label: 'Players', value: String(StageMode.Player) },
    { label: 'GM only', value: String(StageMode.DM) }
  ];

  const selected = $derived(templates.find((template) => template.id === selectedId));

  const updateSelected = (fields: Partial<Omit<AoeTemplate, 'id'>>) => {
    if (selected) onUpdate(selected.id, fields);
  };

  const handleEffectChange = (effect: AoeEffect) => {
    updateSelected({ effect, color: AOE_EFFECT_DEFAULT_COLORS[effect] });
  };

  const handleSizeInput = (value: number) => {
    if (value > 0) updateSelected({ size: value });
  };

  const handleWidthInput = (value: number) => {
    if (value > 0) updateSelected({ width: value });
  };

  const handleAngleInput = (value: number) => {
    if (Number.isFinite(value) && selected) updateSelected({ angle: normalizeTemplateAngle(selected.shape, value) });
  };

  // Partial hex values typed mid-edit would reach every client's shader
  const handleColorInput = (value: string) => {
    if (chroma.valid(value)) updateSelected({ color: value });
  };

  const handleOpacityInput = (value: number) => {
    updateSelected({ opacity: value });
  };

  const handleVisibilityChange = (value: string) => {
    updateSelected({ visibility: Number(value) as StageMode });
  };

  const handleLabelInput = (value: string) => {
    updateSelected({ label: value.trim() || null });
  };

  const handleDelete = (id: string) => {
    onDelete(id);
    onSelect(null);
  };
</script>

<div class="aoeManager" data-testid="aoeManager">
  <div class="aoeManager__content">
    {#if selected}
      <Link onclick={() => onSelect(null)} class="aoeManager__backButton" data-testid="aoeBackButton">
        All templates
        <Icon Icon={IconArrowBack} size="1rem" />
      </Link>
      <div class="aoeManager__form" data-testid="aoeEditView">
        <FormControl label="Effect" name="effect">
          {#snippet input()}
            <div class="aoeManager__effectGrid">
              {#each AOE_EFFECT_ORDER as effect (effect)}
                <button
                  type="button"
                  class="aoeManager__effectSwatch {selected.effect === effect
                    ? 'aoeManager__effectSwatch--selected'
                    : ''}"
                  style:background={AOE_EFFECT_SWATCHES[effect]}
                  title={AOE_EFFECT_LABELS[effect]}
                  aria-label={AOE_EFFECT_LABELS[effect]}
                  onclick={() => handleEffectChange(effect)}
                ></button>
              {/each}
            </div>
          {/snippet}
        </FormControl>

        <FormControl label="Color" name="color">
          {#snippet start()}
            <Popover>
              {#snippet trigger()}
                <ColorPickerSwatch color={selected.color} />
              {/snippet}
              {#snippet content()}
                <ColorPicker
                  showOpacity={false}
                  hex={selected.color}
                  onUpdate={(colorData) => updateSelected({ color: colorData.hex })}
                />
              {/snippet}
            </Popover>
          {/snippet}
          {#snippet input(inputProps)}
            <Input {...inputProps} value={selected.color} oninput={(e) => handleColorInput(e.currentTarget.value)} />
          {/snippet}
        </FormControl>

        <FormControl label="Opacity" name="opacity">
          {#snippet input(inputProps)}
            <div class="aoeManager__slider">
              <input
                {...inputProps}
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={selected.opacity}
                oninput={(e) => handleOpacityInput(parseFloat(e.currentTarget.value))}
              />
              <span class="aoeManager__sliderValue">{selected.opacity.toFixed(1)}</span>
            </div>
          {/snippet}
        </FormControl>

        <div class="aoeManager__formGrid">
          <FormControl label="Size (ft)" name="size">
            {#snippet input(inputProps)}
              <Input
                {...inputProps}
                type="number"
                value={selected.size}
                min={5}
                step={5}
                oninput={(e) => handleSizeInput(Number(e.currentTarget.value))}
              />
            {/snippet}
          </FormControl>

          <FormControl label="Angle (degrees)" name="angle">
            {#snippet input(inputProps)}
              <Input
                {...inputProps}
                type="number"
                value={selected.angle}
                step={selected.shape === AoeShape.Square ? 90 : 15}
                oninput={(e) => handleAngleInput(Number(e.currentTarget.value))}
              />
            {/snippet}
          </FormControl>

          {#if selected.shape === AoeShape.Line}
            <FormControl label="Line width (ft)" name="width">
              {#snippet input(inputProps)}
                <Input
                  {...inputProps}
                  type="number"
                  value={selected.width}
                  min={5}
                  step={5}
                  oninput={(e) => handleWidthInput(Number(e.currentTarget.value))}
                />
              {/snippet}
            </FormControl>
          {/if}
        </div>

        <FormControl label="Spell name" name="spellName">
          {#snippet input(inputProps)}
            <Input
              {...inputProps}
              value={selected.label ?? ''}
              placeholder="e.g. Fireball"
              oninput={(e) => handleLabelInput(e.currentTarget.value)}
            />
          {/snippet}
        </FormControl>

        <FormControl label="Visibility" name="visibility">
          {#snippet input(inputProps)}
            <RadioButton
              {...inputProps}
              selected={String(selected.visibility)}
              options={visibilityOptions}
              onSelectedChange={handleVisibilityChange}
            />
          {/snippet}
        </FormControl>

        <Spacer />

        <ConfirmActionButton action={() => handleDelete(selected.id)} actionButtonText="Confirm delete">
          {#snippet trigger({ triggerProps })}
            <Button as="div" variant="danger" {...triggerProps}>Delete template</Button>
          {/snippet}
          {#snippet actionMessage()}
            Delete this template?
          {/snippet}
        </ConfirmActionButton>
      </div>
    {:else}
      <div class="aoeManager__list" data-testid="aoeList">
        {#each templates as template (template.id)}
          <button class="aoeManager__item" onclick={() => onSelect(template.id)}>
            <span class="aoeManager__itemSwatch" style:background={AOE_EFFECT_SWATCHES[template.effect]}></span>
            <span class="aoeManager__itemText">
              <span class="aoeManager__itemTitle">
                {template.label ? `${template.label} · ` : ''}{shapeLabels[template.shape]} · {template.size} ft
              </span>
              <span class="aoeManager__itemMeta">
                {AOE_EFFECT_LABELS[template.effect]}{template.visibility === StageMode.DM ? ' · GM only' : ''}
              </span>
            </span>
          </button>
        {:else}
          <div>
            <Text weight={700}>No templates in this scene</Text>
            <Spacer size="0.5rem" />
            <Text color="var(--fgMuted)">Area templates show spell reach on the map, with live distances in feet.</Text>
            <Spacer />
            {#if isToolActive}
              <div class="aoeManager__hint">
                <Icon Icon={IconLocationPin} size="2rem" />
                Click on the map to place a template
              </div>
            {:else}
              <Button onclick={onActivateTool}>
                {#snippet start()}
                  <Icon Icon={IconCone2} size="1.25rem" />
                {/snippet}
                Place a template
              </Button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .aoeManager {
    height: 100%;
    display: flex;
    flex-direction: column;
    container-type: inline-size;
  }

  .aoeManager__content {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    flex-grow: 1;
    overflow-y: auto;
  }

  .aoeManager__list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 2rem;
  }

  .aoeManager__item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem;
    border-radius: var(--radius-1);
    text-align: left;
    cursor: pointer;
  }

  .aoeManager__item:hover {
    background: var(--contrastLow);
  }

  .aoeManager__itemSwatch {
    flex-shrink: 0;
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
  }

  .aoeManager__itemText {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .aoeManager__itemTitle {
    font-size: 0.875rem;
    font-weight: 600;
  }

  .aoeManager__itemMeta {
    font-size: 0.75rem;
    color: var(--fgMuted);
  }

  .aoeManager__form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem 2rem;
  }

  .aoeManager__formGrid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  @container (max-width: 420px) {
    .aoeManager__formGrid {
      grid-template-columns: 1fr;
    }
  }

  .aoeManager__effectGrid {
    display: grid;
    grid-template-columns: repeat(6, 28px);
    gap: 0.25rem;
  }

  .aoeManager__effectSwatch {
    width: 28px;
    height: 28px;
    border-radius: var(--radius-1);
    border: 2px solid transparent;
    cursor: pointer;
  }

  .aoeManager__effectSwatch:hover,
  .aoeManager__effectSwatch--selected {
    border-color: var(--fg);
  }

  .aoeManager__slider {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .aoeManager__slider input[type='range'] {
    flex: 1;
    height: 0.5rem;
    appearance: none;
    background: var(--contrastLow);
    border-radius: var(--radius-1);
    cursor: pointer;
  }

  .aoeManager__slider input[type='range']::-webkit-slider-thumb {
    appearance: none;
    width: 1rem;
    height: 1rem;
    background: var(--fg);
    border-radius: 50%;
    cursor: grab;
  }

  .aoeManager__slider input[type='range']::-moz-range-thumb {
    width: 1rem;
    height: 1rem;
    background: var(--fg);
    border: none;
    border-radius: 50%;
    cursor: grab;
  }

  .aoeManager__sliderValue {
    min-width: 2.5rem;
    text-align: right;
    font-size: 0.875rem;
    font-weight: 600;
  }

  .aoeManager__hint {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 2rem;
    border-radius: 0.25rem;
    background-color: var(--contrastLow);
    color: var(--fgDanger);
  }

  :global {
    .aoeManager__backButton {
      display: block;
      padding: 1rem 2rem;
      border-bottom: var(--borderThin);
    }
  }
</style>
