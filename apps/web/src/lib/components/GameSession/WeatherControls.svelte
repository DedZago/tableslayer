<script lang="ts">
  import { type ZodIssue } from 'zod';
  import { FormControl, ColorPicker, InputSlider, type ColorUpdatePayload, RadioButton, Label } from '@tableslayer/ui';
  import {
    QUICK_SCENES,
    atmosphereEffectDefinition,
    type AtmosphereSlot,
    type QuickScene,
    type StageProps
  } from '@tableslayer/stage';
  import { IconChevronDown, IconHaze, IconSparkles, IconSun, IconCloudRain } from '@tabler/icons-svelte';
  import { to8CharHex, queuePropertyUpdate, trackChecklistItem } from '$lib/utils';
  import {
    ATMOSPHERE_SLOTS,
    ATMOSPHERE_SLOT_LABELS,
    applyQuickScene,
    hasActiveAtmosphere,
    patchAtmosphereSettings,
    readSlot,
    setSlotEffect,
    setWind
  } from '$lib/utils/atmosphereActions';
  import { atmosphereIcon } from '$lib/utils/atmosphereIcons';
  import { DEFAULT_WIND_ANGLE, DEFAULT_WIND_STRENGTH } from '$lib/utils/atmosphereSettings';
  import chroma from 'chroma-js';
  import { untrack } from 'svelte';
  import AtmosphereSlotPicker from './AtmosphereSlotPicker.svelte';
  import WindCompass from './WindCompass.svelte';

  let {
    stageProps,
    errors
  }: {
    stageProps: StageProps;
    errors: ZodIssue[] | undefined;
  } = $props();

  type AtmosphereTab = 'scenes' | AtmosphereSlot;

  const SLOT_ICONS = { weather: IconCloudRain, lighting: IconSun, ambience: IconHaze };

  let fogHex = $state(to8CharHex(stageProps.fog.color, stageProps.fog.opacity));
  // Open on the presets until the scene has an effect, then on the slot pickers
  let activeTab = $state<AtmosphereTab>(untrack(() => (hasActiveAtmosphere(stageProps) ? 'weather' : 'scenes')));

  const settings = $derived(stageProps.weather.settings ?? {});
  const wind = $derived({
    angle: stageProps.weather.wind?.angle ?? DEFAULT_WIND_ANGLE,
    strength: stageProps.weather.wind?.strength ?? DEFAULT_WIND_STRENGTH
  });
  const slotSummaries = $derived(
    ATMOSPHERE_SLOTS.map((slot) => {
      const { type } = readSlot(stageProps, slot);
      return {
        slot,
        type,
        label: atmosphereEffectDefinition(slot, type)?.label ?? 'Off',
        Icon: type === 0 ? SLOT_ICONS[slot] : atmosphereIcon(slot, type)
      };
    })
  );
  const anyActive = $derived(slotSummaries.some((summary) => summary.type !== 0));
  const isSceneActive = (scene: QuickScene) => slotSummaries.every((summary) => summary.type === scene[summary.slot]);

  const trackAtmosphereChecklist = () => {
    if (hasActiveAtmosphere(stageProps)) trackChecklistItem('weather');
  };

  const handleQuickScene = (scene: QuickScene) => {
    applyQuickScene(stageProps, scene);
    trackAtmosphereChecklist();
  };

  const clearAll = () => {
    for (const slot of ATMOSPHERE_SLOTS) setSlotEffect(stageProps, slot, 0);
  };

  const onOff = (value: boolean | undefined) => (value ? 'true' : 'false');
  const ON_OFF = [
    { label: 'on', value: 'true' },
    { label: 'off', value: 'false' }
  ];

  const handleFogColorUpdate = (cd: ColorUpdatePayload) => {
    queuePropertyUpdate(stageProps, ['fog', 'color'], chroma(cd.hex).hex('rgb'), 'control');
    queuePropertyUpdate(stageProps, ['fog', 'opacity'], cd.rgba.a, 'control');
  };
</script>

<div class="atmosphere">
  <div class="atmosphere__tabs" role="tablist" aria-label="Atmosphere">
    <button
      type="button"
      role="tab"
      class="atmosphere__tab"
      class:atmosphere__tab--active={activeTab === 'scenes'}
      aria-selected={activeTab === 'scenes'}
      title="One-click combinations of weather, lighting and ambience"
      onclick={() => (activeTab = 'scenes')}
    >
      <IconSparkles size={16} stroke={1.5} />
      <span class="atmosphere__tabName">Scenes</span>
      <span class="atmosphere__tabValue">Presets</span>
    </button>
    {#each slotSummaries as summary (summary.slot)}
      <button
        type="button"
        role="tab"
        class="atmosphere__tab"
        class:atmosphere__tab--active={activeTab === summary.slot}
        class:atmosphere__tab--on={summary.type !== 0}
        aria-selected={activeTab === summary.slot}
        title="{ATMOSPHERE_SLOT_LABELS[summary.slot]}: {summary.label}"
        onclick={() => (activeTab = summary.slot)}
      >
        <summary.Icon size={16} stroke={1.5} />
        <span class="atmosphere__tabName">{ATMOSPHERE_SLOT_LABELS[summary.slot]}</span>
        <span class="atmosphere__tabValue">{summary.label}</span>
      </button>
    {/each}
  </div>

  {#if activeTab === 'scenes'}
    <div class="atmosphere__scenes">
      {#each QUICK_SCENES as scene (scene.id)}
        {@const active = isSceneActive(scene)}
        <button
          type="button"
          class="atmosphere__scene"
          class:atmosphere__scene--active={active}
          aria-pressed={active}
          title={scene.hint}
          onclick={() => handleQuickScene(scene)}
        >
          <span class="atmosphere__sceneLabel">{scene.label}</span>
          <span class="atmosphere__sceneIcons">
            {#each ATMOSPHERE_SLOTS as slot (slot)}
              {#if scene[slot] !== 0}
                {@const Icon = atmosphereIcon(slot, scene[slot])}
                <Icon size={12} stroke={1.5} />
              {/if}
            {/each}
          </span>
        </button>
      {/each}
    </div>
  {:else}
    <AtmosphereSlotPicker {stageProps} slot={activeTab} {errors} onChange={trackAtmosphereChecklist} />
  {/if}

  {#if anyActive}
    <button type="button" class="atmosphere__clear" onclick={clearAll}>Turn all effects off</button>
  {/if}

  <details class="atmosphere__more">
    <summary class="atmosphere__summary">
      <span>Wind</span>
      <span class="atmosphere__summaryValue">{Math.round(wind.angle)}° · {Math.round(wind.strength * 100)}%</span>
      <IconChevronDown class="atmosphere__chevron" size={14} />
    </summary>
    <div class="atmosphere__wind">
      <WindCompass angle={wind.angle} onAngleChange={(angle) => setWind(stageProps, 'angle', angle)} />
      <div class="atmosphere__windControls">
        <FormControl label="Wind strength" name="windStrength" {errors}>
          {#snippet input({ inputProps })}
            <InputSlider
              {...inputProps}
              min={0}
              max={1}
              step={0.05}
              value={wind.strength}
              oninput={(e) => setWind(stageProps, 'strength', Number(e.currentTarget.value))}
            />
          {/snippet}
        </FormControl>
        <span class="atmosphere__hint">Drag the dial to aim it. Direction follows the map.</span>
      </div>
    </div>
  </details>

  <details class="atmosphere__more">
    <summary class="atmosphere__summary">
      <span>Display and safety</span>
      <IconChevronDown class="atmosphere__chevron" size={14} />
    </summary>
    <div class="atmosphere__moreBody">
      <div class="atmosphere__sliders">
        <FormControl label="Weather opacity" name="weatherOpacity" {errors}>
          {#snippet input({ inputProps })}
            <InputSlider
              variant="opacity"
              {...inputProps}
              min={0}
              max={1}
              step={0.05}
              value={stageProps.weather.opacity}
              oninput={(e) =>
                queuePropertyUpdate(stageProps, ['weather', 'opacity'], Number(e.currentTarget.value), 'control')}
            />
          {/snippet}
        </FormControl>
        <FormControl label="Token darkness" name="tokenDarkness" {errors}>
          {#snippet input({ inputProps })}
            <InputSlider
              {...inputProps}
              min={0}
              max={1}
              step={0.05}
              value={settings.tokenDarkness ?? 0.6}
              oninput={(e) => patchAtmosphereSettings(stageProps, { tokenDarkness: Number(e.currentTarget.value) })}
            />
          {/snippet}
        </FormControl>
        <FormControl label="Flash brightness" name="flashBrightness" {errors}>
          {#snippet input({ inputProps })}
            <InputSlider
              {...inputProps}
              min={0}
              max={1}
              step={0.05}
              value={settings.flashBrightness ?? 0.6}
              oninput={(e) => patchAtmosphereSettings(stageProps, { flashBrightness: Number(e.currentTarget.value) })}
            />
          {/snippet}
        </FormControl>
      </div>
      <div class="atmosphere__toggles">
        <Label class="atmosphere__toggleLabel">Reduce flashes</Label>
        <RadioButton
          selected={onOff(settings.reduceFlashes ?? false)}
          options={ON_OFF}
          onSelectedChange={(value) => patchAtmosphereSettings(stageProps, { reduceFlashes: value === 'true' })}
        />
        <Label class="atmosphere__toggleLabel">Screen shake</Label>
        <RadioButton
          selected={onOff(settings.shake ?? false)}
          options={ON_OFF}
          onSelectedChange={(value) => patchAtmosphereSettings(stageProps, { shake: value === 'true' })}
        />
        <Label class="atmosphere__toggleLabel">Build up wet and snow</Label>
        <RadioButton
          selected={onOff(settings.accumulation ?? true)}
          options={ON_OFF}
          onSelectedChange={(value) => patchAtmosphereSettings(stageProps, { accumulation: value === 'true' })}
        />
        <Label class="atmosphere__toggleLabel">Ground fog</Label>
        <RadioButton
          selected={onOff(stageProps.fog.enabled)}
          options={ON_OFF}
          onSelectedChange={(value) => queuePropertyUpdate(stageProps, ['fog', 'enabled'], value === 'true', 'control')}
        />
      </div>
      {#if stageProps.fog.enabled}
        <FormControl label="Ground fog color" name="fogColor" {errors}>
          {#snippet input({ inputProps })}
            <ColorPicker {...inputProps} bind:hex={fogHex} onUpdate={handleFogColorUpdate} />
          {/snippet}
        </FormControl>
      {/if}
      <span class="atmosphere__hint">Flashes and shake are also reduced for players who prefer reduced motion.</span>
    </div>
  </details>
</div>

<style>
  .atmosphere {
    width: 18rem;
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
  }
  .atmosphere__tabs {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.25rem;
    padding: 0.25rem;
    border-radius: 0.5rem;
    background: var(--contrastLowest);
  }
  .atmosphere__tab {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.0625rem;
    min-width: 0;
    padding: 0.375rem 0.125rem;
    border: 1px solid transparent;
    border-radius: 0.375rem;
    background: transparent;
    color: var(--fgMuted);
    cursor: pointer;
  }
  .atmosphere__tab:hover {
    color: var(--fg);
  }
  .atmosphere__tab--on {
    color: var(--fg);
  }
  .atmosphere__tab--active {
    border-color: var(--fgPrimary);
    background: var(--contrastLow);
    color: var(--fg);
  }
  .atmosphere__tabName {
    font-size: 0.6875rem;
    font-weight: 600;
  }
  .atmosphere__tabValue {
    max-width: 100%;
    overflow: hidden;
    font-size: 0.625rem;
    color: var(--fgMuted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .atmosphere__tab--on .atmosphere__tabValue {
    color: var(--fgPrimary);
  }
  .atmosphere__scenes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.25rem;
  }
  .atmosphere__scene {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.25rem;
    padding: 0.375rem 0.5rem;
    border: var(--borderThin);
    border-radius: 0.375rem;
    background: var(--contrastLowest);
    color: var(--fg);
    font-size: 0.75rem;
    text-align: left;
    cursor: pointer;
  }
  .atmosphere__scene:hover {
    border-color: var(--fgMuted);
  }
  .atmosphere__scene--active {
    border-color: var(--fgPrimary);
    color: var(--fgPrimary);
  }
  .atmosphere__sceneLabel {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .atmosphere__sceneIcons {
    display: flex;
    flex-shrink: 0;
    color: var(--fgMuted);
  }
  .atmosphere__clear {
    align-self: flex-start;
    padding: 0;
    border: none;
    background: none;
    color: var(--fgMuted);
    font-size: 0.75rem;
    text-decoration: underline;
    cursor: pointer;
  }
  .atmosphere__clear:hover {
    color: var(--fg);
  }
  .atmosphere__more {
    border-top: var(--borderThin);
  }
  .atmosphere__summary {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0 0;
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
    list-style: none;
  }
  .atmosphere__summary::-webkit-details-marker {
    display: none;
  }
  .atmosphere__summaryValue {
    margin-left: auto;
    font-size: 0.75rem;
    font-weight: 400;
    color: var(--fgMuted);
  }
  .atmosphere__summary > :global(.atmosphere__chevron) {
    margin-left: auto;
    transition: transform 0.15s;
  }
  .atmosphere__summaryValue + :global(.atmosphere__chevron) {
    margin-left: 0;
  }
  .atmosphere__more[open] :global(.atmosphere__chevron) {
    transform: rotate(180deg);
  }
  .atmosphere__wind,
  .atmosphere__moreBody {
    padding-top: 0.5rem;
  }
  .atmosphere__wind {
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  .atmosphere__windControls {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .atmosphere__moreBody {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .atmosphere__sliders {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem 1rem;
  }
  .atmosphere__hint {
    font-size: 0.75rem;
    color: var(--fgMuted);
  }
  .atmosphere__toggles {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 0.25rem 1rem;
  }
  :global(.atmosphere__toggleLabel) {
    line-height: 2rem;
  }
</style>
