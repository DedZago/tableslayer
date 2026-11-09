import type { AtmospherePreset } from '../../types';

const DrizzlePreset: AtmospherePreset = {
  particles: [
    {
      shape: 'streak',
      count: 800,
      depthLayers: 1,
      fall: 1.6,
      windInfluence: 0.4,
      size: [0.0012, 0.002],
      stretch: 18,
      colorA: '#c9d6e6',
      colorB: '#a9bbcf',
      alpha: 0.5,
      blend: 'normal',
      lifetime: [0.6, 1.1]
    }
  ],
  ground: { wetRate: 1 / 80, puddles: 0.1, ripples: 0.25 },
  lighting: { tint: '#939fae', exposure: 0.97, darkness: 0.06 },
  wind: { strengthScale: 0.6, gustiness: 0.2, turbulence: 0.2 }
};

export default DrizzlePreset;
