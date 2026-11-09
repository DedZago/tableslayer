<script lang="ts">
  import { List, Color, Slider, Button, Folder, type ListOptions } from 'svelte-tweakpane-ui';
  import {
    WeatherType,
    ParticleType,
    SnowPreset,
    RainPreset,
    LeavesPreset,
    AshPreset,
    DustStormPreset,
    EmbersPreset,
    BlizzardPreset,
    FirefliesPreset,
    ATMOSPHERE_EFFECTS,
    QUICK_SCENES,
    atmosphereEffectDefinition,
    type AtmosphereSlot,
    type PerformanceTier,
    type StageProps
  } from '@tableslayer/stage';
  import { KernelSize } from 'postprocessing';

  let { props = $bindable() } = $props<{ props: StageProps }>();

  const slotOptions = (slot: AtmosphereSlot, offLabel: string): ListOptions<number> => ({
    [offLabel]: 0,
    ...Object.fromEntries(ATMOSPHERE_EFFECTS[slot].map((effect) => [effect.label, effect.id]))
  });

  const weatherTypeOptions: ListOptions<number> = { ...slotOptions('weather', 'None'), Custom: WeatherType.Custom };
  const lightingOptions = slotOptions('lighting', 'None (day)');
  const ambienceOptions = slotOptions('ambience', 'None');

  const tierOptions: ListOptions<PerformanceTier> = [
    { text: 'High', value: 'high' },
    { text: 'Medium', value: 'medium' },
    { text: 'Low', value: 'low' }
  ];

  props.weather.lighting ??= { type: 0, intensity: 1 };
  props.weather.ambience ??= { type: 0, intensity: 1 };
  props.weather.wind ??= { angle: 45, strength: 0.35 };
  props.weather.settings ??= { v: 1 };

  const quickSceneOptions: ListOptions<string> = [
    { text: 'Pick a scene', value: '' },
    ...QUICK_SCENES.map((scene) => ({ text: scene.label, value: scene.id }))
  ];
  let quickScene = $state('');

  const applyQuickScene = (id: string) => {
    const scene = QUICK_SCENES.find((candidate) => candidate.id === id);
    if (!scene) return;
    props.weather.type = scene.weather;
    props.weather.lighting = { type: scene.lighting, intensity: 1 };
    props.weather.ambience = { type: scene.ambience, intensity: 1 };
  };

  const paramDefinitions = $derived(
    [
      atmosphereEffectDefinition('weather', props.weather.type),
      atmosphereEffectDefinition('lighting', props.weather.lighting?.type ?? 0),
      atmosphereEffectDefinition('ambience', props.weather.ambience?.type ?? 0)
    ].flatMap((definition) => definition?.params ?? [])
  );

  const setParam = (key: string, value: number) => {
    props.weather.settings = {
      ...props.weather.settings,
      v: 1,
      params: { ...props.weather.settings?.params, [key]: value }
    };
  };

  const particleTypeOptions: ListOptions<number> = {
    Ash: ParticleType.Ash,
    Fireflies: ParticleType.Fireflies,
    Leaves: ParticleType.Leaves,
    Rain: ParticleType.Rain,
    Snow: ParticleType.Snow
  };
</script>

<Folder title="Atmosphere" expanded={true}>
  <List
    bind:value={quickScene}
    label="Quick scene"
    options={quickSceneOptions}
    on:change={(e) => applyQuickScene(String(e.detail.value))}
  />
  <List bind:value={props.weather.type} label="Weather" options={weatherTypeOptions} />
  <Slider bind:value={props.weather.intensity} label="Weather intensity" min={0} max={1} step={0.01} />
  <List bind:value={props.weather.lighting!.type} label="Lighting" options={lightingOptions} />
  <Slider bind:value={props.weather.lighting!.intensity} label="Lighting intensity" min={0} max={1} step={0.01} />
  <List bind:value={props.weather.ambience!.type} label="Ambience" options={ambienceOptions} />
  <Slider bind:value={props.weather.ambience!.intensity} label="Ambience intensity" min={0} max={1} step={0.01} />
  <Folder title="Wind" expanded={true}>
    <Slider bind:value={props.weather.wind!.angle} label="Angle" min={0} max={360} step={1} />
    <Slider bind:value={props.weather.wind!.strength} label="Strength" min={0} max={1} step={0.01} />
  </Folder>
  <Folder title="Settings" expanded={false}>
    <Slider
      value={props.weather.settings?.flashBrightness ?? 0.6}
      label="Flash brightness"
      min={0}
      max={1}
      step={0.01}
      on:change={(e) => (props.weather.settings = { ...props.weather.settings, v: 1, flashBrightness: e.detail.value })}
    />
    <Slider
      value={props.weather.settings?.tokenDarkness ?? 0.6}
      label="Token darkness"
      min={0}
      max={1}
      step={0.01}
      on:change={(e) => (props.weather.settings = { ...props.weather.settings, v: 1, tokenDarkness: e.detail.value })}
    />
    <List
      value={props.weather.settings?.reduceFlashes ?? false}
      label="Reduce flashes"
      options={{ No: false, Yes: true }}
      on:change={(e) => (props.weather.settings = { ...props.weather.settings, v: 1, reduceFlashes: e.detail.value })}
    />
    <List
      value={props.weather.settings?.shake ?? false}
      label="Screen shake"
      options={{ No: false, Yes: true }}
      on:change={(e) => (props.weather.settings = { ...props.weather.settings, v: 1, shake: e.detail.value })}
    />
    <List
      value={props.weather.settings?.accumulation ?? true}
      label="Accumulation"
      options={{ Yes: true, No: false }}
      on:change={(e) => (props.weather.settings = { ...props.weather.settings, v: 1, accumulation: e.detail.value })}
    />
  </Folder>
  {#if paramDefinitions.length > 0}
    <Folder title="Effect params" expanded={true}>
      {#each paramDefinitions as definition (definition.key)}
        <Slider
          value={props.weather.settings?.params?.[definition.key] ?? definition.default}
          label={definition.label}
          min={definition.min}
          max={definition.max}
          step={definition.step}
          on:change={(e) => setParam(definition.key, e.detail.value)}
        />
      {/each}
    </Folder>
  {/if}
  <List bind:value={props.performanceTier} label="Performance tier" options={tierOptions} />

  <Button
    title="Customize"
    on:click={() => {
      // Copy current preset data to custom
      let preset;
      switch (props.weather.type) {
        case WeatherType.Snow:
          preset = { ...SnowPreset };
          break;
        case WeatherType.Rain:
          preset = { ...RainPreset };
          break;
        case WeatherType.Leaves:
          preset = { ...LeavesPreset };
          break;
        case WeatherType.Ash:
          preset = { ...AshPreset };
          break;
        case WeatherType.DustStorm:
          preset = { ...DustStormPreset };
          break;
        case WeatherType.Embers:
          preset = { ...EmbersPreset };
          break;
        case WeatherType.Blizzard:
          preset = { ...BlizzardPreset };
          break;
        case WeatherType.Fireflies:
          preset = { ...FirefliesPreset };
          break;
        default:
          preset = { ...RainPreset };
      }
      props.weather.custom = preset;
      props.weather.type = WeatherType.Custom;
    }}
  />

  {#if props.weather.type === WeatherType.Custom && props.weather.custom}
    <Folder title="Custom" expanded={true}>
      <Slider bind:value={props.weather.custom.fov} label="FOV" min={10} max={120} step={1} />
      <Slider bind:value={props.weather.custom.intensity} label="Intensity" min={0} max={1} step={0.01} />
      <Slider bind:value={props.weather.custom.opacity} label="Opacity" min={0} max={1} step={0.01} />

      <Folder title="Depth of Field" expanded={false}>
        <List
          bind:value={props.weather.custom.depthOfField.enabled}
          label="Enabled"
          options={{ Yes: true, No: false }}
        />
        <Slider bind:value={props.weather.custom.depthOfField.focus} label="Focus" min={0} max={1} />
        <Slider bind:value={props.weather.custom.depthOfField.focalLength} label="Focal Length" min={0} max={10} />
        <Slider bind:value={props.weather.custom.depthOfField.bokehScale} label="Bokeh Scale" min={1} max={500} />
        <List
          bind:value={props.weather.custom.depthOfField.kernelSize}
          label="Kernel Size"
          options={{
            VERY_LARGE: KernelSize.VERY_LARGE,
            LARGE: KernelSize.LARGE,
            MEDIUM: KernelSize.MEDIUM,
            SMALL: KernelSize.SMALL,
            VERY_SMALL: KernelSize.VERY_SMALL
          }}
        />
      </Folder>

      <Folder title="Particles" expanded={false}>
        <List bind:value={props.weather.custom.particles.type} label="Type" options={particleTypeOptions} />
        <Slider
          bind:value={props.weather.custom.particles.maxParticleCount}
          label="Max ParticleCount"
          min={1}
          max={10000}
          step={1}
        />
        <Color bind:value={props.weather.custom.particles.color} label="Color" />
        <Slider bind:value={props.weather.custom.particles.lifetime} label="Lifetime" min={1} max={30} />

        <Slider
          bind:value={props.weather.custom.particles.fadeInTime}
          label="Fade In (s)"
          min={0}
          max={30}
          step={0.01}
        />
        <Slider
          bind:value={props.weather.custom.particles.fadeOutTime}
          label="Fade Out (s)"
          min={0}
          max={30}
          step={0.01}
        />

        <Folder title="Force" expanded={false}>
          <Folder title="Linear" expanded={false}>
            <Slider bind:value={props.weather.custom.particles.force.linear.x} label="Amplitude X" min={0} max={0.1} />
            <Slider bind:value={props.weather.custom.particles.force.linear.y} label="Amplitude Y" min={0} max={0.1} />
            <Slider bind:value={props.weather.custom.particles.force.linear.z} label="Amplitude Z" min={0} max={0.1} />
          </Folder>

          <Folder title="Exponential" expanded={false}>
            <Slider
              bind:value={props.weather.custom.particles.force.exponential.x}
              label="Amplitude X"
              min={0}
              max={0.1}
            />
            <Slider
              bind:value={props.weather.custom.particles.force.exponential.y}
              label="Amplitude Y"
              min={0}
              max={0.1}
            />
            <Slider
              bind:value={props.weather.custom.particles.force.exponential.z}
              label="Amplitude Z"
              min={0}
              max={0.1}
            />
          </Folder>

          <Folder title="Sinusoidal" expanded={false}>
            <Slider
              bind:value={props.weather.custom.particles.force.sinusoidal.amplitude.x}
              label="Amplitude X"
              min={0}
              max={0.05}
            />
            <Slider
              bind:value={props.weather.custom.particles.force.sinusoidal.amplitude.y}
              label="Amplitude Y"
              min={0}
              max={0.05}
            />
            <Slider
              bind:value={props.weather.custom.particles.force.sinusoidal.frequency.x}
              label="Frequency X"
              min={0}
              max={10}
            />
            <Slider
              bind:value={props.weather.custom.particles.force.sinusoidal.frequency.y}
              label="Frequency Y"
              min={0}
              max={10}
            />
          </Folder>
        </Folder>
      </Folder>
    </Folder>
  {/if}
</Folder>
