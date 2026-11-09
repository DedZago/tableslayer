import type { AtmospherePreset } from '../../types';

const HailPreset: AtmospherePreset = {
  particles: [
    {
      shape: 'hail',
      count: 650,
      depthLayers: 3,
      fall: 3.2,
      windInfluence: 0.4,
      size: [0.006, 0.011],
      stretch: 4,
      colorA: '#f2f7ff',
      colorB: '#cdd9e8',
      alpha: 0.95,
      blend: 'normal',
      lifetime: [0.4, 0.7]
    }
  ],
  ground: { wetRate: 1 / 90, puddles: 0.1, ripples: 0.35 },
  lighting: { tint: '#76849a', exposure: 0.93, darkness: 0.22 },
  wind: { strengthScale: 1, gustiness: 0.6, turbulence: 0.4 }
};

export default HailPreset;
