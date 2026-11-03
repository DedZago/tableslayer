<script lang="ts">
  import { Button, Checkbox, Color, Folder, List, Slider, type ListOptions } from 'svelte-tweakpane-ui';
  import {
    DEFAULT_RULESET,
    MarkerShape,
    MarkerSize,
    MarkerVisibility,
    SPELLS,
    TOKEN_FX_LIST,
    getGridCellSize,
    resolveSpell,
    type TokenEffectKind,
    type PerformanceTier,
    type SpellCast,
    type StageExports,
    type StageProps
  } from '@tableslayer/stage';

  let {
    props = $bindable(),
    stage,
    onCast,
    highlight = $bindable(false)
  } = $props<{
    props: StageProps;
    stage?: StageExports;
    onCast: (cast: SpellCast) => void;
    /** Lights every area, token effect and token like a focused concentration (`spellHighlight`) */
    highlight?: boolean;
  }>();

  const spellOptions: ListOptions<string> = Object.keys(SPELLS)
    .filter((id) => resolveSpell(id, DEFAULT_RULESET))
    .map((id) => ({ text: `${SPELLS[id].name} (${resolveSpell(id, DEFAULT_RULESET)?.resolved.cast.fx})`, value: id }));

  const tierOptions: ListOptions<PerformanceTier> = [
    { text: 'High', value: 'high' },
    { text: 'Medium', value: 'medium' },
    { text: 'Low', value: 'low' }
  ];

  let spellId = $state(spellOptions[0].value);
  let counter = 0;

  $effect(() => {
    const fx = resolveSpell(spellId, DEFAULT_RULESET)?.resolved.cast.fx;
    if (fx) stage?.spells.prewarm([fx]);
  });

  const buildCast = (fromLeftEdge: boolean): SpellCast | null => {
    const spell = resolveSpell(spellId, DEFAULT_RULESET);
    if (!spell) return null;
    const { cast, area, origin } = spell.resolved;
    const cellPx = getGridCellSize(props.grid, props.display);
    const edge = { x: -Math.min((props.display.resolution.x / 2) * 0.7, cellPx * 12), y: 0 };
    const center = { x: 0, y: 0 };
    const casterOrigin = origin === 'caster';
    const from = fromLeftEdge ? edge : center;
    return {
      id: `docs-${Date.now()}-${counter++}`,
      spellId,
      fx: cast.fx,
      variant: cast.variant ?? 0,
      palette: cast.palette,
      projectile: cast.projectile,
      area: area ? { ...area, angle: 0 } : undefined,
      origin: from,
      target: casterOrigin ? from : center,
      durationMs: cast.durationMs,
      startedAt: performance.now()
    };
  };

  const tokenFxOptions: ListOptions<TokenEffectKind> = TOKEN_FX_LIST.map((fx) => ({ text: fx, value: fx }));
  const SAMPLE_MARKER_ID = 'docs-effect-token';

  let tokenFx = $state<TokenEffectKind>('chains');
  let tokenFxColor = $state('#aab4c8');
  let tokenFxVariant = $state(0);
  let tokenFxRadius = $state(15);

  $effect(() => {
    stage?.spells.prewarm([], [tokenFx]);
  });

  const sampleMarkerId = () => {
    const existing = props.marker.markers[0];
    if (existing) return existing.id;
    props.marker.markers = [
      {
        id: SAMPLE_MARKER_ID,
        title: 'Sample token',
        position: { x: 0, y: 0 },
        size: MarkerSize.Medium,
        shape: MarkerShape.Circle,
        shapeColor: '#8a6a42',
        label: 'S',
        imageUrl: null,
        imageScale: 1,
        visibility: MarkerVisibility.Always,
        note: null
      }
    ];
    return SAMPLE_MARKER_ID;
  };

  const addTokenEffect = () => {
    props.tokenEffects = [
      ...(props.tokenEffects ?? []),
      {
        id: `docs-fx-${Date.now()}-${counter++}`,
        markerId: sampleMarkerId(),
        fx: tokenFx,
        color: tokenFxColor,
        variant: tokenFxVariant,
        radius: tokenFxRadius,
        startedAt: Date.now()
      }
    ];
  };

  const toggleConcentration = () => {
    const markerId = sampleMarkerId();
    const id = `concentration:${markerId}`;
    const current = props.tokenEffects ?? [];
    props.tokenEffects = current.some((effect: { id: string }) => effect.id === id)
      ? current.filter((effect: { id: string }) => effect.id !== id)
      : [...current, { id, markerId, fx: 'concentration', color: tokenFxColor, startedAt: Date.now() }];
  };

  const cast = (fromLeftEdge: boolean) => {
    const next = buildCast(fromLeftEdge);
    if (next) onCast(next);
  };
</script>

<Folder title="Spells" expanded={false}>
  <List bind:value={spellId} label="Spell" options={spellOptions} />
  <List bind:value={props.performanceTier} label="Tier" options={tierOptions} />
  <Button title="Cast at centre" on:click={() => cast(false)} />
  <Button title="Cast from left edge to centre" on:click={() => cast(true)} />
</Folder>

<Folder title="Token effects" expanded={false}>
  <List bind:value={tokenFx} label="Effect" options={tokenFxOptions} />
  <Color bind:value={tokenFxColor} label="Color" />
  <Slider bind:value={tokenFxVariant} label="Variant" min={0} max={1} step={1} />
  <Slider bind:value={tokenFxRadius} label="Radius (ft)" min={5} max={40} step={5} />
  <Button title="Add to first token" on:click={addTokenEffect} />
  <Button title="Toggle concentration ring" on:click={toggleConcentration} />
  <Button title="Clear effects" on:click={() => (props.tokenEffects = [])} />
  <Checkbox bind:value={highlight} label="Concentration focus" />
</Folder>
