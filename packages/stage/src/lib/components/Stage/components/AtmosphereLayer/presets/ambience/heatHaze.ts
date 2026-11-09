import type { AtmospherePreset } from '../../types';

const HeatHazePreset: AtmospherePreset = {
  ground: { haze: { strength: 0.6, color: '#ffd9a0' } },
  lighting: { tint: '#f5c98a', exposure: 1.02, darkness: 0.15 },
  wind: { strengthScale: 0.3, gustiness: 0.4, turbulence: 0.5 }
};

export default HeatHazePreset;
