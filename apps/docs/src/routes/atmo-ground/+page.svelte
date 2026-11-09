<script lang="ts">
  // Throwaway visual harness for the atmosphere ground and lighting work (WS-G, WS-PG); do not ship
  // Query: w/wi weather type/intensity, l/li lighting, a/ai ambience, wind (deg) ws (strength), seed,
  // p=key:value,... params, acc=0 instant accumulation, td token darkness, fb flash brightness, tier, pp=0 no
  // composer, map (id) or mapurl, fit=0, grid=1, tokens=0, lights=1
  // Hooks: window.__atmo.{metrics, setTypes(w,l,a), setIntensity(slot,v)}
  import { onMount } from 'svelte';
  import {
    LightStyle,
    MarkerShape,
    MarkerSize,
    MarkerVisibility,
    Stage,
    eventsInWindow,
    performanceMetrics,
    type Callbacks,
    type StageExports,
    type StageProps
  } from '@tableslayer/stage';
  import { StageDefaultProps } from '../(components)/stage/defaults';

  let stageProps: StageProps | undefined = $state();
  let stage: StageExports | undefined = $state();
  let fitMap = true;

  const noop = () => {};
  const callbacks: Callbacks = {
    onAnnotationUpdate: noop,
    onFogUpdate: noop,
    onMapUpdate: (offset, zoom) => {
      if (!stageProps) return;
      stageProps.map.offset.x = offset.x;
      stageProps.map.offset.y = offset.y;
      stageProps.map.zoom = zoom;
    },
    onSceneUpdate: noop,
    onStageLoading: noop,
    onStageInitialized: () => {
      if (fitMap) [1500, 3500, 7000, 11000].forEach((delay) => setTimeout(() => stage?.map.fit(), delay));
    },
    onMarkerAdded: noop,
    onMarkerMoved: noop,
    onMarkerSelected: noop,
    onMarkerContextMenu: noop
  };

  const tokenSpots = [
    { x: -220, y: 40, color: '#c0392b' },
    { x: 60, y: -90, color: '#2e86c1' },
    { x: 240, y: 120, color: '#27ae60' }
  ];
  const lightSpots = [
    { x: -220, y: 40, color: '#ffb060' },
    { x: 330, y: -150, color: '#9fd0ff' }
  ];

  onMount(() => {
    const query = new URLSearchParams(location.search);
    const number = (key: string, fallback: number) => (query.has(key) ? Number(query.get(key)) : fallback);
    const next = structuredClone(StageDefaultProps) as StageProps;
    fitMap = query.get('fit') !== '0';
    const mapId = String(number('map', 11)).padStart(2, '0');
    next.map.url = query.get('mapurl') ?? `https://files.tableslayer.com/maps/${mapId}.jpeg`;
    next.performanceTier = (query.get('tier') as 'high' | 'medium' | 'low') ?? 'high';
    next.postProcessing.enabled = query.get('pp') !== '0';
    next.fog.enabled = false;
    next.edgeOverlay.enabled = false;
    next.grid.opacity = query.get('grid') === '1' ? 0.25 : 0;
    next.debug.enableMetrics = true;
    next.weather = {
      type: number('w', 0),
      intensity: number('wi', 1),
      lighting: { type: number('l', 0), intensity: number('li', 1) },
      ambience: { type: number('a', 0), intensity: number('ai', 1) },
      wind: { angle: number('wind', 45), strength: number('ws', 0.35) },
      seed: number('seed', 1234),
      settings: {
        accumulation: query.get('acc') !== '0',
        tokenDarkness: number('td', 0.6),
        flashBrightness: number('fb', 0.6),
        params: Object.fromEntries(
          (query.get('p') ?? '')
            .split(',')
            .filter(Boolean)
            .map((pair) => [pair.split(':')[0], Number(pair.split(':')[1])])
        )
      }
    };
    if (query.get('tokens') !== '0') {
      next.marker.markers = tokenSpots.map((spot, index) => ({
        id: `token-${index}`,
        title: `Token ${index}`,
        position: { x: spot.x, y: spot.y },
        size: MarkerSize.Small,
        shape: MarkerShape.Circle,
        shapeColor: spot.color,
        label: String.fromCharCode(65 + index),
        imageUrl: null,
        imageScale: 1,
        visibility: MarkerVisibility.Always,
        note: null
      }));
    }
    if (query.get('lights') === '1') {
      next.light.lights = lightSpots.map((spot, index) => ({
        id: `light-${index}`,
        position: { x: spot.x, y: spot.y },
        radius: 6,
        color: spot.color,
        style: LightStyle.Torch,
        pulse: 0,
        opacity: 1
      }));
    }
    stageProps = next;

    const realNow = Date.now.bind(Date);
    let frozen: number | null = null;
    Date.now = () => frozen ?? realNow();
    const windowRef = window as unknown as Record<string, unknown>;
    windowRef.__freeze = (ms: number | null) => (frozen = ms);
    windowRef.__nextEvent = (kind: 'tremor' | 'flicker' | 'pulse' | 'meteor' | 'surge', ratePerMin: number) => {
      const now = realNow() / 1000;
      const events = eventsInWindow(next.weather?.seed ?? 0, [{ kind, ratePerMin }], now % 3600, (now % 3600) + 600);
      return events.length ? { atmoTime: events[0].time, epochMs: (now - (now % 3600) + events[0].time) * 1000 } : null;
    };
    windowRef.__atmo = {
      metrics: () => $state.snapshot(performanceMetrics.value),
      setTypes: (weather: number, lighting: number, ambience: number) => {
        if (!stageProps) return;
        stageProps.weather.type = weather;
        stageProps.weather.lighting = { type: lighting, intensity: stageProps.weather.lighting?.intensity ?? 1 };
        stageProps.weather.ambience = { type: ambience, intensity: stageProps.weather.ambience?.intensity ?? 1 };
      },
      setIntensity: (key: 'weather' | 'lighting' | 'ambience', value: number) => {
        if (!stageProps) return;
        if (key === 'weather') stageProps.weather.intensity = value;
        else if (stageProps.weather[key]) stageProps.weather[key]!.intensity = value;
      }
    };
  });
</script>

<div class="atmo-ground">
  {#if stageProps}
    <Stage bind:this={stage} props={stageProps} {callbacks} />
  {/if}
</div>

<style>
  .atmo-ground {
    position: fixed;
    inset: 0;
    z-index: 9999;
    width: 1280px;
    height: 720px;
    background: #000;
  }
</style>
