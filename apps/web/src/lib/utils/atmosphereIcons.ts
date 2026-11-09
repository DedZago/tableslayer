import {
  IconBolt,
  IconBulbOff,
  IconCircleOff,
  IconCloud,
  IconCloudRain,
  IconCloudSnow,
  IconCloudStorm,
  IconComet,
  IconDroplet,
  IconDropletHalf2,
  IconDroplets,
  IconFlame,
  IconFlower,
  IconGhost,
  IconGrain,
  IconHaze,
  IconLeaf,
  IconMoon2,
  IconMoonStars,
  IconMountain,
  IconMushroom,
  IconPlant2,
  IconRadioactive,
  IconSkull,
  IconSnowflake,
  IconSparkles,
  IconSpiral,
  IconStars,
  IconSun,
  IconSunHigh,
  IconSunrise,
  IconSunset2,
  IconTemperatureMinus,
  IconTemperatureSun,
  IconTornado,
  IconWaveSine,
  IconWind
} from '@tabler/icons-svelte';
import { AmbienceType, LightingType, WeatherType, type AtmosphereSlot, type IconComponent } from '@tableslayer/stage';

export const ATMOSPHERE_OFF_ICON: IconComponent = IconCircleOff;

type TileLook = { icon: IconComponent; from: string; to: string };

// Gradients are previews of each effect's palette, so they are literal colors rather than theme variables
const look = (icon: IconComponent, from: string, to: string): TileLook => ({ icon, from, to });

const LOOKS: Record<AtmosphereSlot, Record<number, TileLook>> = {
  weather: {
    [WeatherType.Rain]: look(IconCloudRain, '#2b4a6b', '#6f9bc4'),
    [WeatherType.Snow]: look(IconSnowflake, '#7d97b3', '#e8f1f8'),
    [WeatherType.Leaves]: look(IconLeaf, '#6b4a1f', '#b07a2a'),
    [WeatherType.Ash]: look(IconCloud, '#3a3836', '#8a8582'),
    [WeatherType.DustStorm]: look(IconHaze, '#8c6a35', '#d1a45f'),
    [WeatherType.Embers]: look(IconFlame, '#6b1f0e', '#e8791f'),
    [WeatherType.Blizzard]: look(IconTemperatureMinus, '#4f6f91', '#dbe9f5'),
    [WeatherType.Fireflies]: look(IconSparkles, '#14301f', '#b8d84a'),
    [WeatherType.Drizzle]: look(IconDroplet, '#3b566e', '#8fb0c9'),
    [WeatherType.HeavyRain]: look(IconDroplets, '#1d3550', '#4f7ba8'),
    [WeatherType.Thunderstorm]: look(IconCloudStorm, '#1c2238', '#5a6490'),
    [WeatherType.Hail]: look(IconGrain, '#4a6177', '#c3d6e4'),
    [WeatherType.Sandstorm]: look(IconTornado, '#7a4f1d', '#c98d3f'),
    [WeatherType.Gale]: look(IconWind, '#4b6670', '#a6c2c9'),
    [WeatherType.AcidRain]: look(IconRadioactive, '#2f4a14', '#b4d02e'),
    [WeatherType.BloodRain]: look(IconDroplet, '#3b0b0b', '#a31d1d'),
    [WeatherType.CherryBlossoms]: look(IconFlower, '#7a3f55', '#f2b8cb'),
    [WeatherType.VolcanicAshfall]: look(IconMountain, '#2a2220', '#a1411f'),
    [WeatherType.MeteorShower]: look(IconComet, '#14122e', '#6c5fc7'),
    [WeatherType.ArcaneStorm]: look(IconBolt, '#2a1448', '#9a5cf0'),
    [WeatherType.SporeDrift]: look(IconPlant2, '#1b3a2d', '#5fd0a0'),
    [WeatherType.Sleet]: look(IconCloudSnow, '#4a5f73', '#b3c7d8')
  },
  lighting: {
    [LightingType.Dawn]: look(IconSunrise, '#4a3a6b', '#f2a7a7'),
    [LightingType.Dusk]: look(IconSunset2, '#6b3a1f', '#f0a23a'),
    [LightingType.Night]: look(IconMoonStars, '#0b1330', '#2c4a8c'),
    [LightingType.Overcast]: look(IconCloud, '#55595e', '#9aa0a6'),
    [LightingType.Sunbeams]: look(IconSunHigh, '#7a5a14', '#f7d96a'),
    [LightingType.Eclipse]: look(IconMoon2, '#12060a', '#7a1f1f'),
    [LightingType.PitchDark]: look(IconBulbOff, '#050505', '#262626'),
    [LightingType.AuroraNight]: look(IconWaveSine, '#0b1330', '#2fbf8f')
  },
  ambience: {
    [AmbienceType.GroundFog]: look(IconHaze, '#4d5a63', '#b9c4cb'),
    [AmbienceType.CloudShadows]: look(IconCloud, '#3b4a3a', '#8aa07f'),
    [AmbienceType.HeatHaze]: look(IconTemperatureSun, '#7a4a1a', '#f0b25c'),
    [AmbienceType.WildfireSmoke]: look(IconFlame, '#3a2a22', '#c4691f'),
    [AmbienceType.Underwater]: look(IconDropletHalf2, '#0d3b4a', '#34b3b0'),
    [AmbienceType.SwampMiasma]: look(IconMushroom, '#2a3a14', '#8aa83a'),
    [AmbienceType.FeywildLights]: look(IconSparkles, '#3a1d5a', '#e07ad0'),
    [AmbienceType.GhostWisps]: look(IconGhost, '#1d2a3a', '#b9d3e8'),
    [AmbienceType.DivineRadiance]: look(IconSun, '#7a5a14', '#ffe9a0'),
    [AmbienceType.ShadowfellGloom]: look(IconSkull, '#0d1410', '#3a4a3a'),
    [AmbienceType.InfernalHellfire]: look(IconFlame, '#4a0b0b', '#e8451f'),
    [AmbienceType.AstralStarfield]: look(IconStars, '#10082e', '#5a3fb5'),
    [AmbienceType.AbyssalTentacles]: look(IconSpiral, '#1a0a2a', '#6a2f8f'),
    [AmbienceType.FreezingMist]: look(IconSnowflake, '#3a5a7a', '#bfe3f2'),
    [AmbienceType.SandwormTremors]: look(IconWaveSine, '#6b4a1f', '#d1a45f')
  }
};

const FALLBACK_LOOK = look(IconCircleOff, '#2a2a2a', '#4a4a4a');

export const atmosphereLook = (slot: AtmosphereSlot, id: number): TileLook => LOOKS[slot][id] ?? FALLBACK_LOOK;

export const atmosphereIcon = (slot: AtmosphereSlot, id: number): IconComponent => atmosphereLook(slot, id).icon;

export const atmosphereTileBackground = (slot: AtmosphereSlot, id: number): string => {
  const { from, to } = atmosphereLook(slot, id);
  return `linear-gradient(135deg, ${from}, ${to})`;
};
