import { LightingType } from '../../../WeatherLayer/types';
import type { AtmospherePreset } from '../../types';
import AuroraNightPreset from './auroraNight';
import DawnPreset from './dawn';
import DuskPreset from './dusk';
import EclipsePreset from './eclipse';
import NightPreset from './night';
import OvercastPreset from './overcast';
import PitchDarkPreset from './pitchDark';
import SunbeamsPreset from './sunbeams';

export const LIGHTING_PRESETS: Partial<Record<number, AtmospherePreset>> = {
  [LightingType.Dawn]: DawnPreset,
  [LightingType.Dusk]: DuskPreset,
  [LightingType.Night]: NightPreset,
  [LightingType.Overcast]: OvercastPreset,
  [LightingType.Sunbeams]: SunbeamsPreset,
  [LightingType.Eclipse]: EclipsePreset,
  [LightingType.PitchDark]: PitchDarkPreset,
  [LightingType.AuroraNight]: AuroraNightPreset
};
