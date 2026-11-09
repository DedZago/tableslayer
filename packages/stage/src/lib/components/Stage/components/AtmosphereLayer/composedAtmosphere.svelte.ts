import { composeAtmosphere } from '../../helpers/atmosphereCompose';
import { StageMode, type PerformanceTier } from '../Stage/types';
import type { WeatherLayerProps } from '../WeatherLayer/types';

// The GM keeps reading the map under night or pitch dark
const DM_MAX_DARKNESS = 0.5;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const createReducedMotion = () => {
  let reduced = $state(false);

  $effect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    reduced = query.matches;
    const onChange = (event: MediaQueryListEvent) => (reduced = event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  });

  return {
    get value() {
      return reduced;
    }
  };
};

/**
 * Derives the composed atmosphere from the weather props. Every input is read through its own
 * `$derived` so the result is only rebuilt when a value changes, not when the props root is replaced by
 * a remote edit. Call during component init.
 */
export const createComposedAtmosphere = (
  getWeather: () => WeatherLayerProps,
  getTier: () => PerformanceTier | undefined,
  getMode: () => StageMode
) => {
  const reducedMotion = createReducedMotion();
  const weatherType = $derived(getWeather().type);
  const weatherIntensity = $derived(getWeather().intensity);
  const weatherOpacity = $derived(getWeather().opacity);
  const lightingType = $derived(getWeather().lighting?.type ?? 0);
  const lightingIntensity = $derived(getWeather().lighting?.intensity);
  const ambienceType = $derived(getWeather().ambience?.type ?? 0);
  const ambienceIntensity = $derived(getWeather().ambience?.intensity);
  const windAngle = $derived(getWeather().wind?.angle);
  const windStrength = $derived(getWeather().wind?.strength);
  const seed = $derived(getWeather().seed);
  const settingsKey = $derived(JSON.stringify(getWeather().settings ?? null));
  const tier = $derived(getTier() ?? 'high');
  const isDm = $derived(getMode() === StageMode.DM);

  const composed = $derived(
    composeAtmosphere(
      { type: weatherType, intensity: weatherIntensity },
      { type: lightingType, intensity: lightingIntensity },
      { type: ambienceType, intensity: ambienceIntensity },
      {
        seed,
        tier,
        wind: { angle: windAngle, strength: windStrength },
        settings: JSON.parse(settingsKey) ?? undefined,
        reducedMotion: reducedMotion.value,
        weatherOpacity,
        maxDarkness: isDm ? DM_MAX_DARKNESS : undefined
      }
    )
  );

  return {
    get value() {
      return composed;
    }
  };
};
