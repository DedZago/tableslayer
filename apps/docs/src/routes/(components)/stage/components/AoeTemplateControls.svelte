<script lang="ts">
  import { Color, Slider, Folder, List, type ListOptions } from 'svelte-tweakpane-ui';
  import { AOE_EFFECT_LABELS, AoeEffect, AoeShape, StageMode, type StageProps } from '@tableslayer/stage';

  let { props = $bindable() } = $props<{ props: StageProps }>();

  const shapeOptions: ListOptions<AoeShape> = [
    { text: 'Circle', value: AoeShape.Circle },
    { text: 'Cube', value: AoeShape.Square },
    { text: 'Cone', value: AoeShape.Cone },
    { text: 'Line', value: AoeShape.Line }
  ];

  const effectOptions: ListOptions<AoeEffect> = Object.values(AoeEffect)
    .filter((value): value is AoeEffect => typeof value === 'number')
    .map((value) => ({ text: AOE_EFFECT_LABELS[value], value }));

  const visibilityOptions: ListOptions<StageMode> = [
    { text: 'Players', value: StageMode.Player },
    { text: 'GM only', value: StageMode.DM }
  ];
</script>

{#if props.aoeTemplates}
  <Folder title="Area templates" expanded={false}>
    <List bind:value={props.aoeTemplates.tool.shape} label="Shape" options={shapeOptions} />
    <List bind:value={props.aoeTemplates.tool.effect} label="Effect" options={effectOptions} />
    <Color bind:value={props.aoeTemplates.tool.color} label="Color" />
    <Slider bind:value={props.aoeTemplates.tool.opacity} label="Opacity" min={0} max={1} step={0.05} />
    <Slider bind:value={props.aoeTemplates.tool.lineWidth} label="Line width (ft)" min={5} max={30} step={5} />
    <List bind:value={props.aoeTemplates.tool.snapToGrid} label="Snap origin" options={{ Yes: true, No: false }} />
    <List bind:value={props.aoeTemplates.tool.snapAngle} label="Snap angle" options={{ Yes: true, No: false }} />
    <List bind:value={props.aoeTemplates.tool.visibility} label="Visibility" options={visibilityOptions} />
    <List bind:value={props.aoeTemplates.showLabels} label="Labels" options={{ Yes: true, No: false }} />
  </Folder>
{/if}
