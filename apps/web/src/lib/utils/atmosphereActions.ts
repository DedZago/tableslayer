import type { AtmosphereSettings, AtmosphereSlot, QuickScene, StageProps } from '@tableslayer/stage';
import { queuePropertyUpdate } from './propertyUpdateBroadcaster';

export const ATMOSPHERE_SLOTS: AtmosphereSlot[] = ['weather', 'lighting', 'ambience'];
export const ATMOSPHERE_SLOT_LABELS: Record<AtmosphereSlot, string> = {
  weather: 'Weather',
  lighting: 'Lighting',
  ambience: 'Ambience'
};
export const INTENSITY_STEP = 0.25;

export type SlotState = { type: number; intensity: number };

const slotPath = (slot: AtmosphereSlot, field: 'type' | 'intensity') =>
  slot === 'weather' ? ['weather', field] : ['weather', slot, field];

export const readSlot = (stageProps: StageProps, slot: AtmosphereSlot): SlotState => {
  const { weather } = stageProps;
  if (slot === 'weather') return { type: weather.type, intensity: weather.intensity ?? 1 };
  const source = weather[slot];
  return { type: source?.type ?? 0, intensity: source?.intensity ?? 1 };
};

const writeIfChanged = (stageProps: StageProps, slot: AtmosphereSlot, field: 'type' | 'intensity', value: number) => {
  if (readSlot(stageProps, slot)[field] === value) return false;
  queuePropertyUpdate(stageProps, slotPath(slot, field), value, 'control');
  return true;
};

/** Picking an effect on a muted slot unmutes it, so the choice is visible */
export const setSlotEffect = (stageProps: StageProps, slot: AtmosphereSlot, type: number) => {
  writeIfChanged(stageProps, slot, 'type', type);
  if (type !== 0 && readSlot(stageProps, slot).intensity === 0) writeIfChanged(stageProps, slot, 'intensity', 1);
};

export const setSlotIntensity = (stageProps: StageProps, slot: AtmosphereSlot, intensity: number) =>
  writeIfChanged(stageProps, slot, 'intensity', Math.min(1, Math.max(0, intensity)));

export const nudgeSlotIntensity = (stageProps: StageProps, slot: AtmosphereSlot, delta: number) => {
  const next = Math.round((readSlot(stageProps, slot).intensity + delta) * 100) / 100;
  return setSlotIntensity(stageProps, slot, next);
};

export const applyQuickScene = (stageProps: StageProps, scene: QuickScene) => {
  setSlotEffect(stageProps, 'weather', scene.weather);
  setSlotEffect(stageProps, 'lighting', scene.lighting);
  setSlotEffect(stageProps, 'ambience', scene.ambience);
};

export const setWind = (stageProps: StageProps, field: 'angle' | 'strength', value: number) =>
  queuePropertyUpdate(stageProps, ['weather', 'wind', field], value, 'control');

export const patchAtmosphereSettings = (stageProps: StageProps, patch: Partial<AtmosphereSettings>) =>
  queuePropertyUpdate(
    stageProps,
    ['weather', 'settings'],
    { ...stageProps.weather.settings, ...patch, v: 1 },
    'control'
  );

export const setAtmosphereParam = (stageProps: StageProps, key: string, value: number) =>
  patchAtmosphereSettings(stageProps, { params: { ...stageProps.weather.settings?.params, [key]: value } });

export const hasActiveAtmosphere = (stageProps: StageProps) =>
  ATMOSPHERE_SLOTS.some((slot) => readSlot(stageProps, slot).type !== 0);
