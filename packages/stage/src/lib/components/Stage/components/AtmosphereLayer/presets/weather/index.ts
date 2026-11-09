import { WeatherType } from '../../../WeatherLayer/types';
import type { AtmospherePreset } from '../../types';
import AcidRainPreset from './acidRain';
import ArcaneStormPreset from './arcaneStorm';
import AshPreset from './ash';
import BlizzardPreset from './blizzard';
import BloodRainPreset from './bloodRain';
import CherryBlossomsPreset from './cherryBlossoms';
import DrizzlePreset from './drizzle';
import DustStormPreset from './dustStorm';
import EmbersPreset from './embers';
import FirefliesPreset from './fireflies';
import GalePreset from './gale';
import HailPreset from './hail';
import HeavyRainPreset from './heavyRain';
import LeavesPreset from './leaves';
import MeteorShowerPreset from './meteorShower';
import RainPreset from './rain';
import SandstormPreset from './sandstorm';
import SleetPreset from './sleet';
import SnowPreset from './snow';
import SporeDriftPreset from './sporeDrift';
import ThunderstormPreset from './thunderstorm';
import VolcanicAshfallPreset from './volcanicAshfall';

export const WEATHER_PRESETS: Partial<Record<number, AtmospherePreset>> = {
  [WeatherType.Rain]: RainPreset,
  [WeatherType.Drizzle]: DrizzlePreset,
  [WeatherType.HeavyRain]: HeavyRainPreset,
  [WeatherType.Thunderstorm]: ThunderstormPreset,
  [WeatherType.Hail]: HailPreset,
  [WeatherType.Snow]: SnowPreset,
  [WeatherType.Leaves]: LeavesPreset,
  [WeatherType.Ash]: AshPreset,
  [WeatherType.DustStorm]: DustStormPreset,
  [WeatherType.Embers]: EmbersPreset,
  [WeatherType.Blizzard]: BlizzardPreset,
  [WeatherType.Fireflies]: FirefliesPreset,
  [WeatherType.Sandstorm]: SandstormPreset,
  [WeatherType.Gale]: GalePreset,
  [WeatherType.AcidRain]: AcidRainPreset,
  [WeatherType.BloodRain]: BloodRainPreset,
  [WeatherType.CherryBlossoms]: CherryBlossomsPreset,
  [WeatherType.VolcanicAshfall]: VolcanicAshfallPreset,
  [WeatherType.MeteorShower]: MeteorShowerPreset,
  [WeatherType.ArcaneStorm]: ArcaneStormPreset,
  [WeatherType.SporeDrift]: SporeDriftPreset,
  [WeatherType.Sleet]: SleetPreset
};
