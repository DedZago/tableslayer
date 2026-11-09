import type { AtmospherePreset } from '../../types';
import HeavyRainPreset from './heavyRain';

const ThunderstormPreset: AtmospherePreset = {
  ...HeavyRainPreset,
  lighting: { tint: '#5f6c80', exposure: 0.9, darkness: 0.32 },
  events: [{ kind: 'lightning', ratePerMin: 4.5, rateParam: 'strikeRate', bolts: [1, 2], hueMode: 'none' }],
  wind: { strengthScale: 1.4, gustiness: 0.8, turbulence: 0.5 }
};

export default ThunderstormPreset;
