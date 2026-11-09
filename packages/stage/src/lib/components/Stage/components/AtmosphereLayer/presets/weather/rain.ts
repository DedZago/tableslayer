import type { AtmospherePreset } from '../../types';

const RainPreset: AtmospherePreset = {
  particles: [
    {
      shape: 'streak',
      count: 1800,
      depthLayers: 2,
      fall: 2.4,
      windInfluence: 0.55,
      size: [0.0018, 0.003],
      stretch: 26,
      colorA: '#c9d6e6',
      colorB: '#9fb4cc',
      alpha: 0.55,
      blend: 'normal',
      lifetime: [0.45, 0.8]
    }
  ],
  ground: { wetRate: 1 / 45, puddles: 0.35, ripples: 0.6 },
  lighting: { tint: '#8a97a8', exposure: 0.95, darkness: 0.1 },
  wind: { strengthScale: 1, gustiness: 0.35, turbulence: 0.3 }
};

export default RainPreset;
