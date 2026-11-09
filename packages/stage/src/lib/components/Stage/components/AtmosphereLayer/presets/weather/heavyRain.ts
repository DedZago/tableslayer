import { DensityMode } from '../../sim/types';
import type { AtmospherePreset } from '../../types';

const HeavyRainPreset: AtmospherePreset = {
  particles: [
    {
      shape: 'streak',
      count: 3600,
      depthLayers: 3,
      fall: 3,
      windInfluence: 0.85,
      size: [0.0018, 0.0032],
      stretch: 30,
      colorA: '#c2d0e2',
      colorB: '#8ea5c0',
      alpha: 0.65,
      blend: 'normal',
      lifetime: [0.35, 0.65]
    },
    {
      shape: 'streak',
      count: 70,
      depthLayers: 1,
      fall: 2.8,
      windInfluence: 0.9,
      size: [0.012, 0.024],
      stretch: 70,
      colorA: '#b4c2d4',
      colorB: '#9fb0c6',
      alpha: 0.07,
      blend: 'normal',
      lifetime: [0.5, 0.9],
      priority: -1
    }
  ],
  density: {
    mode: DensityMode.Everywhere,
    colorA: '#8d9aab',
    colorB: '#aab6c4',
    scale: 3,
    octaves: 2,
    coverage: 0.18,
    overTokens: 0.2
  },
  ground: { wetRate: 1 / 28, puddles: 0.7, ripples: 1 },
  lighting: { tint: '#7d8a9c', exposure: 0.93, darkness: 0.2 },
  wind: { strengthScale: 1.2, gustiness: 0.6, turbulence: 0.4 }
};

export default HeavyRainPreset;
