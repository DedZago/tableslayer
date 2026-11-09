import type { AtmosphereSettings } from '@tableslayer/stage';

export const DEFAULT_WIND_ANGLE = 45;
export const DEFAULT_WIND_STRENGTH = 0.35;

const finiteNumber = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Reads the persisted `weatherSettings` JSON; corrupt or unknown data falls back to the stage defaults */
export const parseAtmosphereSettings = (raw: unknown): AtmosphereSettings => {
  let source: unknown = raw;
  if (typeof raw === 'string') {
    try {
      source = JSON.parse(raw);
    } catch {
      return { v: 1 };
    }
  }
  if (!source || typeof source !== 'object') return { v: 1 };

  const input = source as Record<string, unknown>;
  const settings: AtmosphereSettings = { v: 1 };
  const flashBrightness = finiteNumber(input.flashBrightness);
  const tokenDarkness = finiteNumber(input.tokenDarkness);
  if (flashBrightness !== undefined) settings.flashBrightness = clamp01(flashBrightness);
  if (tokenDarkness !== undefined) settings.tokenDarkness = clamp01(tokenDarkness);
  if (typeof input.reduceFlashes === 'boolean') settings.reduceFlashes = input.reduceFlashes;
  if (typeof input.shake === 'boolean') settings.shake = input.shake;
  if (typeof input.accumulation === 'boolean') settings.accumulation = input.accumulation;
  if (input.params && typeof input.params === 'object') {
    const params = Object.fromEntries(
      Object.entries(input.params as Record<string, unknown>).flatMap(([key, value]) => {
        const number = finiteNumber(value);
        return number === undefined ? [] : [[key, number]];
      })
    );
    if (Object.keys(params).length > 0) settings.params = params;
  }
  return settings;
};

export const serializeAtmosphereSettings = (settings: AtmosphereSettings | null | undefined): string | null =>
  settings ? JSON.stringify({ ...settings, v: 1 }) : null;
