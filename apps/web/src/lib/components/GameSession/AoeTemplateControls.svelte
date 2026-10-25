<script lang="ts">
  import { Icon, IconButton, Popover, SelectorMenu, ToolTip } from '@tableslayer/ui';
  import {
    AOE_EFFECT_DEFAULT_COLORS,
    AOE_EFFECT_LABELS,
    AoeEffect,
    AoeShape,
    StageMode,
    type AoeToolSettings
  } from '@tableslayer/stage';
  import { IconCircle, IconCone2, IconEye, IconEyeOff, IconRectangleVertical, IconSquare } from '@tabler/icons-svelte';
  import { AOE_EFFECT_ORDER, AOE_EFFECT_SWATCHES } from '$lib/utils/aoeEffectSwatches';

  let {
    tool,
    isActive,
    onToggle,
    onActivate,
    onToolChange,
    selectionCount = 0,
    selectionEffect,
    onSelectionEffectChange
  }: {
    tool: AoeToolSettings;
    isActive: boolean;
    onToggle: () => void;
    onActivate: () => void;
    onToolChange: (patch: Partial<AoeToolSettings>) => void;
    /** With templates selected the effect picker recolors them and leaves the tool alone */
    selectionCount?: number;
    /** The selection's shared effect, undefined when mixed */
    selectionEffect?: AoeEffect;
    onSelectionEffectChange?: (effect: AoeEffect) => void;
  } = $props();

  const editsSelection = $derived(selectionCount > 0 && onSelectionEffectChange !== undefined);
  const shownEffect = $derived(editsSelection ? selectionEffect : tool.effect);

  const shapeOptions = [
    { label: 'Circle', value: AoeShape.Circle, icon: IconCircle },
    { label: 'Cube', value: AoeShape.Square, icon: IconSquare },
    { label: 'Cone', value: AoeShape.Cone, icon: IconCone2 },
    { label: 'Line', value: AoeShape.Line, icon: IconRectangleVertical }
  ];

  let effectPickerOpen = $state(false);

  const toolIcon = $derived(shapeOptions.find((option) => option.value === tool.shape)?.icon ?? IconCone2);

  const changeTool = (patch: Partial<AoeToolSettings>) => {
    onToolChange(patch);
    if (!isActive) onActivate();
  };

  const handleShapeChange = (value: string) => changeTool({ shape: value as AoeShape });

  const handleEffectChange = (effect: AoeEffect) => {
    effectPickerOpen = false;
    if (editsSelection) onSelectionEffectChange?.(effect);
    else changeTool({ effect, color: AOE_EFFECT_DEFAULT_COLORS[effect] });
  };

  const toggleVisibility = () =>
    changeTool({ visibility: tool.visibility === StageMode.DM ? StageMode.Player : StageMode.DM });

  const isGmOnly = $derived(tool.visibility === StageMode.DM);

  const effectLabel = $derived.by(() => {
    if (!editsSelection) return `Effect: ${AOE_EFFECT_LABELS[tool.effect]}`;
    const target = selectionCount === 1 ? 'selected AoE' : `${selectionCount} selected AoEs`;
    return shownEffect === undefined
      ? `Effect of ${target}: mixed`
      : `Effect of ${target}: ${AOE_EFFECT_LABELS[shownEffect]}`;
  });
</script>

<div class="aoeControls">
  <ToolTip positioning={{ placement: 'bottom' }} openDelay={500} closeOnPointerDown disableHoverableContent>
    {#snippet children()}
      <button
        type="button"
        data-testid="aoeToolButton"
        class="aoeControls__tool {isActive ? 'aoeControls__tool--isActive' : ''}"
        onclick={onToggle}
      >
        <Icon Icon={toolIcon} size="1.5rem" stroke={2} />
        <span class="aoeControls__text">AoE</span>
      </button>
    {/snippet}
    {#snippet toolTipContent()}
      Place spell area templates on the map. Press A to toggle.
    {/snippet}
  </ToolTip>

  <ToolTip positioning={{ placement: 'bottom' }} openDelay={500} closeOnPointerDown disableHoverableContent>
    {#snippet children()}
      <SelectorMenu
        selected={tool.shape}
        options={shapeOptions}
        positioning={{ placement: 'bottom', offset: 8 }}
        onSelectedChange={handleShapeChange}
      />
    {/snippet}
    {#snippet toolTipContent()}
      Change the template shape. Shift + A cycles shapes.
    {/snippet}
  </ToolTip>

  <Popover
    positioning={{ placement: 'bottom', gutter: 8 }}
    isOpen={effectPickerOpen}
    onIsOpenChange={(open) => (effectPickerOpen = open)}
  >
    {#snippet trigger()}
      <ToolTip positioning={{ placement: 'bottom' }} openDelay={500} closeOnPointerDown disableHoverableContent>
        {#snippet children()}
          <span
            class={['aoeControls__swatch', editsSelection && 'aoeControls__swatch--selection']}
            style:background={shownEffect === undefined ? 'var(--contrastMedium)' : AOE_EFFECT_SWATCHES[shownEffect]}
            aria-label={effectLabel}
          ></span>
        {/snippet}
        {#snippet toolTipContent()}
          {effectLabel}
        {/snippet}
      </ToolTip>
    {/snippet}
    {#snippet content()}
      <div class="aoeControls__effectGrid">
        {#each AOE_EFFECT_ORDER as effect (effect)}
          <button
            type="button"
            class="aoeControls__effectSwatch {shownEffect === effect ? 'aoeControls__effectSwatch--selected' : ''}"
            style:background={AOE_EFFECT_SWATCHES[effect]}
            title={AOE_EFFECT_LABELS[effect]}
            aria-label={AOE_EFFECT_LABELS[effect]}
            onclick={() => handleEffectChange(effect)}
          ></button>
        {/each}
      </div>
    {/snippet}
  </Popover>

  <ToolTip positioning={{ placement: 'bottom' }} openDelay={500} closeOnPointerDown disableHoverableContent>
    {#snippet children()}
      <IconButton
        variant="ghost"
        data-testid="aoeVisibilityButton"
        aria-label={isGmOnly ? 'Hidden from players' : 'Visible to players'}
        onclick={toggleVisibility}
      >
        <Icon Icon={isGmOnly ? IconEyeOff : IconEye} size="1.25rem" />
      </IconButton>
    {/snippet}
    {#snippet toolTipContent()}
      {isGmOnly
        ? 'Only the GM sees new templates. Click to show them to players.'
        : 'Players see new templates. Click to hide them from players.'}
    {/snippet}
  </ToolTip>
</div>

<style>
  .aoeControls {
    display: flex;
    align-items: center;
    gap: 0.125rem;
    font-size: 0.85rem;
    font-weight: 700;
  }

  .aoeControls__tool {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.125rem 0.5rem;
    border-radius: var(--radius-2);
    border: var(--sceneControlItemBorder);
    background: transparent;
    color: inherit;
    cursor: pointer;
    white-space: nowrap;
  }

  .aoeControls__tool:hover:not(.aoeControls__tool--isActive) {
    background: var(--sceneControlItemBgHover);
    border: var(--sceneControlItemBorderHover);
  }

  .aoeControls__tool--isActive {
    background: var(--fgPrimary);
  }

  .aoeControls__swatch {
    display: block;
    width: 1.25rem;
    height: 1.25rem;
    border-radius: 50%;
    border: var(--sceneControlItemBorder);
    cursor: pointer;
  }

  .aoeControls__swatch--selection {
    outline: 2px solid var(--fgPrimary);
    outline-offset: 1px;
  }

  .aoeControls__effectGrid {
    display: grid;
    grid-template-columns: repeat(4, 28px);
    gap: 0.25rem;
    padding: 0.5rem;
  }

  .aoeControls__effectSwatch {
    width: 28px;
    height: 28px;
    border-radius: var(--radius-1);
    border: 2px solid transparent;
    cursor: pointer;
  }

  .aoeControls__effectSwatch:hover,
  .aoeControls__effectSwatch--selected {
    border-color: var(--fg);
  }

  @container stageWrapper (max-width: 1120px) {
    .aoeControls__text {
      display: none;
    }
  }
</style>
