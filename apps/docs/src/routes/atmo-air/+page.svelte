<script lang="ts">
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import {
    Stage,
    StageMode,
    eventsInWindow,
    type Callbacks,
    type PerformanceTier,
    type StageProps
  } from '@tableslayer/stage';
  import { StageDefaultProps } from '../(components)/stage/defaults';

  const query = page.url.searchParams;
  const number = (name: string, fallback: number) => {
    const value = query.get(name);
    return value === null || value === '' ? fallback : Number(value);
  };

  const mapUrl = query.get('map');
  const stageProps: StageProps = $state({
    ...StageDefaultProps,
    mode: StageMode.Player,
    performanceTier: (query.get('tier') ?? 'high') as PerformanceTier,
    fog: { ...StageDefaultProps.fog, enabled: false },
    fogOfWar: { ...StageDefaultProps.fogOfWar, opacity: { dm: 0, player: 0 } },
    edgeOverlay: { ...StageDefaultProps.edgeOverlay, enabled: false },
    grid: { ...StageDefaultProps.grid, opacity: 0.12 },
    map: { ...StageDefaultProps.map, zoom: number('mz', 1), ...(mapUrl ? { url: mapUrl } : {}) },
    postProcessing: { ...StageDefaultProps.postProcessing, enabled: query.get('post') === '1' },
    weather: {
      type: number('w', 0),
      intensity: number('wi', 1),
      opacity: 1,
      seed: number('seed', 1234567),
      lighting: { type: number('l', 0), intensity: 1 },
      ambience: { type: number('a', 0), intensity: 1 },
      wind: { angle: number('wind', 45), strength: number('ws', 0.35) },
      settings: {
        flashBrightness: 0.6,
        shake: query.get('shake') === '1',
        accumulation: true,
        params: Object.fromEntries(
          [...query.entries()]
            .filter(([key]) => key.startsWith('p_'))
            .map(([key, value]) => [key.slice(2), Number(value)])
        )
      }
    }
  });
  const callbacks = {
    onSceneUpdate: () => {},
    onStageLoading: () => {},
    onStageInitialized: () => {}
  } as unknown as Callbacks;

  const strikeRate = number('strikeRate', 4.5);

  // Test hook: `window.__strikeAt(offsetSec)` freezes the wall clock at the next lightning strike plus the offset
  onMount(() => {
    const realNow = Date.now.bind(Date);
    let frozen: number | null = null;
    Date.now = () => frozen ?? realNow();
    const w = window as unknown as Record<string, unknown>;
    w.__freeze = (ms: number | null) => (frozen = ms);
    w.__weather = (patch: Record<string, unknown>) => Object.assign(stageProps.weather, patch);
    w.__tier = (value: PerformanceTier) => (stageProps.performanceTier = value);
    w.__nextEvent = (kind: 'lightning' | 'meteor' | 'surge' | 'tremor', rate: number) => {
      const now = realNow() / 1000;
      const specs = [{ kind, ratePerMin: rate, bolts: [1, 2] as [number, number] }];
      const events = eventsInWindow(stageProps.weather.seed ?? 0, specs, now % 3600, (now % 3600) + 600);
      return events.length ? { atmoTime: events[0].time, epochMs: (now - (now % 3600) + events[0].time) * 1000 } : null;
    };
    w.__nextStrike = () => {
      const now = realNow() / 1000;
      const specs = [{ kind: 'lightning' as const, ratePerMin: strikeRate, bolts: [1, 2] as [number, number] }];
      const events = eventsInWindow(stageProps.weather.seed ?? 0, specs, now % 3600, (now % 3600) + 600);
      return events.length ? { atmoTime: events[0].time, epochMs: (now - (now % 3600) + events[0].time) * 1000 } : null;
    };
  });
</script>

<div class="atmoAir">
  <Stage props={stageProps} {callbacks} />
</div>

<style>
  .atmoAir {
    position: fixed;
    inset: 0;
    background: #000;
  }
</style>
