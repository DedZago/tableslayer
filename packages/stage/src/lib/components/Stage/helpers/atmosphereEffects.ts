import type { AtmosphereSlot } from '../components/AtmosphereLayer/types';
import { AmbienceType, LightingType, WeatherType } from '../components/WeatherLayer/types';

export type AtmosphereCategoryId = string;

export type AtmosphereParamDefinition = {
  /** Key inside `AtmosphereSettings.params`; unique across slots */
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
};

export type AtmosphereEffectDefinition = {
  id: number;
  label: string;
  hint: string;
  category: AtmosphereCategoryId;
  /** At most three GM-facing extras */
  params: AtmosphereParamDefinition[];
  /** 1 = engine and core effects, 2 = the fantasy catalog */
  phase: 1 | 2;
};

export type AtmosphereCategoryDefinition = {
  id: AtmosphereCategoryId;
  label: string;
  description: string;
};

export type QuickScene = {
  id: string;
  label: string;
  hint: string;
  weather: number;
  lighting: number;
  ambience: number;
};

const effect = (
  id: number,
  label: string,
  hint: string,
  category: AtmosphereCategoryId,
  phase: 1 | 2,
  params: AtmosphereParamDefinition[] = []
): AtmosphereEffectDefinition => ({ id, label, hint, category, params, phase });

const param = (
  key: string,
  label: string,
  min: number,
  max: number,
  step: number,
  defaultValue: number
): AtmosphereParamDefinition => ({ key, label, min, max, step, default: defaultValue });

export const ATMOSPHERE_CATEGORIES: Record<AtmosphereSlot, AtmosphereCategoryDefinition[]> = {
  weather: [
    { id: 'rain', label: 'Rain and storms', description: 'Rain, thunder and hail' },
    { id: 'cold', label: 'Cold', description: 'Snow, blizzards and sleet' },
    { id: 'wind', label: 'Wind', description: 'Gales, dust and drifting leaves' },
    { id: 'fire', label: 'Fire', description: 'Ash, embers and ashfall' },
    { id: 'nature', label: 'Nature', description: 'Fireflies and blossoms' },
    { id: 'fantasy', label: 'Fantasy', description: 'Acid, blood, meteors and arcane storms' }
  ],
  lighting: [
    { id: 'time', label: 'Time of day', description: 'Dawn, dusk, night and overcast' },
    { id: 'special', label: 'Special', description: 'Sunbeams, eclipses, darkness and auroras' }
  ],
  ambience: [
    { id: 'natural', label: 'Natural', description: 'Fog, haze, smoke and water' },
    { id: 'magic', label: 'Magic', description: 'Fey lights, spirits, radiance and stars' },
    { id: 'dread', label: 'Dread and danger', description: 'Gloom, hellfire, horrors and tremors' }
  ]
};

export const ATMOSPHERE_EFFECTS: Record<AtmosphereSlot, AtmosphereEffectDefinition[]> = {
  weather: [
    effect(WeatherType.Rain, 'Rain', 'Slanted streaks, ripples and slowly wetting ground', 'rain', 1),
    effect(WeatherType.Drizzle, 'Drizzle', 'Sparse fine rain that dampens the ground', 'rain', 1),
    effect(WeatherType.HeavyRain, 'Heavy rain', 'Dense sheets in gusts, puddles grow', 'rain', 1),
    effect(WeatherType.Thunderstorm, 'Thunderstorm', 'Heavy rain, lightning and an overcast sky', 'rain', 1, [
      param('strikeRate', 'Strikes per minute', 1, 20, 1, 6)
    ]),
    effect(WeatherType.Hail, 'Hail', 'Fast bright pellets that bounce off the ground', 'rain', 1),
    effect(WeatherType.Snow, 'Snow', 'Slow flakes drifting down, snow cover builds', 'cold', 1),
    effect(WeatherType.Blizzard, 'Blizzard', 'Fast flakes, whiteout and wind lines', 'cold', 1),
    effect(WeatherType.Sleet, 'Sleet', 'Cold rain mixed with small flakes', 'cold', 2),
    effect(WeatherType.Leaves, 'Leaves', 'Leaves tumbling on the wind', 'wind', 1),
    effect(WeatherType.DustStorm, 'Dust storm', 'Grit streaks with fronts rolling across', 'wind', 1),
    effect(WeatherType.Sandstorm, 'Sandstorm', 'Dense ochre walls and low visibility', 'wind', 1),
    effect(WeatherType.Gale, 'Gale', 'Wind lines, flying debris and strong gusts', 'wind', 1),
    effect(WeatherType.Ash, 'Ash', 'Slow grey flakes with a warm tint', 'fire', 1),
    effect(WeatherType.Embers, 'Embers', 'Glowing sparks rising on hot air', 'fire', 1),
    effect(
      WeatherType.VolcanicAshfall,
      'Volcanic ashfall',
      'Heavy ash, red glow pulses and distant rumbles',
      'fire',
      2,
      [param('rumbleRate', 'Rumbles per minute', 0, 6, 1, 1)]
    ),
    effect(WeatherType.Fireflies, 'Fireflies', 'Wandering glowing motes', 'nature', 1),
    effect(WeatherType.CherryBlossoms, 'Cherry blossoms', 'Pink petals tumbling on the wind', 'nature', 2),
    effect(WeatherType.AcidRain, 'Acid rain', 'Green-yellow rain and rising fizz', 'fantasy', 2),
    effect(WeatherType.BloodRain, 'Blood rain', 'Dark red drops and red puddles', 'fantasy', 2),
    effect(WeatherType.MeteorShower, 'Meteor shower', 'Streaking meteors and the odd impact flash', 'fantasy', 2, [
      param('meteorRate', 'Meteors per minute', 1, 30, 1, 8)
    ]),
    effect(WeatherType.ArcaneStorm, 'Arcane storm', 'Swirling violet motes and coloured lightning', 'fantasy', 2, [
      param('arcaneStrikeRate', 'Strikes per minute', 1, 20, 1, 5),
      param('arcaneHue', 'Lightning hue', 0, 360, 5, 270)
    ]),
    effect(WeatherType.SporeDrift, 'Spore drift', 'Glowing spores rising and pulsing', 'fantasy', 2)
  ],
  lighting: [
    effect(LightingType.Dawn, 'Dawn', 'Cool pink light with low warm shafts', 'time', 1),
    effect(LightingType.Dusk, 'Dusk', 'Golden-orange light and long shafts', 'time', 1),
    effect(LightingType.Night, 'Night', 'Dark blue light where placed lights pop', 'time', 1, [
      param('moonTint', 'Moon tint', 0, 1, 0.05, 0.4)
    ]),
    effect(LightingType.Overcast, 'Overcast', 'Flat, desaturated and a little darker', 'time', 1),
    effect(LightingType.Sunbeams, 'Sunbeams', 'Pools of light with drifting dust', 'special', 1),
    effect(LightingType.Eclipse, 'Eclipse', 'Deep dim with a red rim and slow totality', 'special', 2),
    effect(LightingType.PitchDark, 'Pitch dark', 'Near black, only lights reveal the map', 'special', 2),
    effect(LightingType.AuroraNight, 'Aurora night', 'Night with undulating aurora ribbons', 'special', 2, [
      param('auroraHue', 'Aurora hue', 0, 360, 5, 140)
    ])
  ],
  ambience: [
    effect(AmbienceType.GroundFog, 'Ground fog', 'Drifting banks, dense under tokens', 'natural', 1, [
      param('fogDensity', 'Fog density', 0, 1, 0.05, 0.6)
    ]),
    effect(AmbienceType.CloudShadows, 'Cloud shadows', 'Large soft shadows drifting with the wind', 'natural', 1, [
      param('cloudCoverage', 'Cloud coverage', 0, 1, 0.05, 0.5)
    ]),
    effect(AmbienceType.HeatHaze, 'Heat haze', 'Shimmering air and a warm grade', 'natural', 1),
    effect(AmbienceType.WildfireSmoke, 'Wildfire smoke', 'Brown-grey plumes with an orange glow', 'natural', 1),
    effect(AmbienceType.Underwater, 'Underwater', 'Caustics, rising bubbles and a teal grade', 'natural', 1),
    effect(AmbienceType.SwampMiasma, 'Swamp miasma', 'Sickly green low fog and buzzing motes', 'natural', 2),
    effect(AmbienceType.FreezingMist, 'Freezing mist', 'Low blue fog and ice sparkles', 'natural', 2),
    effect(AmbienceType.FeywildLights, 'Feywild lights', 'Bobbing multicolour motes and petals', 'magic', 2),
    effect(AmbienceType.GhostWisps, 'Ghost wisps', 'Pale wisps fading in and out', 'magic', 2),
    effect(AmbienceType.DivineRadiance, 'Divine radiance', 'Golden shafts, motes and breathing light', 'magic', 2),
    effect(AmbienceType.AstralStarfield, 'Astral starfield', 'Twinkling stars over a violet void', 'magic', 2),
    effect(AmbienceType.ShadowfellGloom, 'Shadowfell gloom', 'Drained colour and creeping black-green fog', 'dread', 2),
    effect(AmbienceType.InfernalHellfire, 'Infernal hellfire', 'Red grade, embers, ash and fire flicker', 'dread', 2, [
      param('flickerRate', 'Flickers per minute', 1, 40, 1, 12)
    ]),
    effect(
      AmbienceType.AbyssalTentacles,
      'Abyssal tentacles',
      'Huge slow tentacle shadows beneath the map',
      'dread',
      2,
      [param('twitchRate', 'Twitches per minute', 0, 12, 1, 3)]
    ),
    effect(
      AmbienceType.SandwormTremors,
      'Sandworm tremors',
      'Ground rings and dust puffs at seeded spots',
      'dread',
      2,
      [param('tremorRate', 'Tremors per minute', 1, 12, 1, 3)]
    )
  ]
};

export const QUICK_SCENES: QuickScene[] = [
  {
    id: 'stormy-night',
    label: 'Stormy night',
    hint: 'Thunderstorm, night and cloud shadows',
    weather: WeatherType.Thunderstorm,
    lighting: LightingType.Night,
    ambience: AmbienceType.CloudShadows
  },
  {
    id: 'winter-pass',
    label: 'Winter pass',
    hint: 'Blizzard, overcast and freezing mist',
    weather: WeatherType.Blizzard,
    lighting: LightingType.Overcast,
    ambience: AmbienceType.FreezingMist
  },
  {
    id: 'desert-noon',
    label: 'Desert noon',
    hint: 'Dust storm and heat haze',
    weather: WeatherType.DustStorm,
    lighting: LightingType.None,
    ambience: AmbienceType.HeatHaze
  },
  {
    id: 'feywild-glade',
    label: 'Feywild glade',
    hint: 'Cherry blossoms, sunbeams and Feywild lights',
    weather: WeatherType.CherryBlossoms,
    lighting: LightingType.Sunbeams,
    ambience: AmbienceType.FeywildLights
  },
  {
    id: 'haunted-moor',
    label: 'Haunted moor',
    hint: 'Drizzle, night and ghost wisps',
    weather: WeatherType.Drizzle,
    lighting: LightingType.Night,
    ambience: AmbienceType.GhostWisps
  },
  {
    id: 'sunken-temple',
    label: 'Sunken temple',
    hint: 'Sunbeams and underwater',
    weather: WeatherType.None,
    lighting: LightingType.Sunbeams,
    ambience: AmbienceType.Underwater
  },
  {
    id: 'hellscape',
    label: 'Hellscape',
    hint: 'Embers, dusk and infernal hellfire',
    weather: WeatherType.Embers,
    lighting: LightingType.Dusk,
    ambience: AmbienceType.InfernalHellfire
  },
  {
    id: 'volcanic-wastes',
    label: 'Volcanic wastes',
    hint: 'Volcanic ashfall, overcast and wildfire smoke',
    weather: WeatherType.VolcanicAshfall,
    lighting: LightingType.Overcast,
    ambience: AmbienceType.WildfireSmoke
  },
  {
    id: 'shadowfell',
    label: 'Shadowfell',
    hint: 'Ash, pitch dark and Shadowfell gloom',
    weather: WeatherType.Ash,
    lighting: LightingType.PitchDark,
    ambience: AmbienceType.ShadowfellGloom
  },
  {
    id: 'astral-sea',
    label: 'Astral sea',
    hint: 'Night and an astral starfield',
    weather: WeatherType.None,
    lighting: LightingType.Night,
    ambience: AmbienceType.AstralStarfield
  }
];

export const atmosphereEffectDefinition = (slot: AtmosphereSlot, id: number): AtmosphereEffectDefinition | undefined =>
  ATMOSPHERE_EFFECTS[slot].find((definition) => definition.id === id);

export const atmosphereEffectsInCategory = (
  slot: AtmosphereSlot,
  category: AtmosphereCategoryId
): AtmosphereEffectDefinition[] => ATMOSPHERE_EFFECTS[slot].filter((definition) => definition.category === category);
