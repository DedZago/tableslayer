import { DensityMode } from '../../sim/types';
import type { AtmospherePreset } from '../../types';

// Phase 2: filled in by the ground (ground/lighting/density) and air (particles/events) streams
const BloodRainPreset: AtmospherePreset = {
  density: {
    mode: DensityMode.Everywhere,
    colorA: '#5a1a1c',
    colorB: '#80282a',
    scale: 3,
    octaves: 2,
    coverage: 0.14,
    overTokens: 0.2
  },
  ground: {
    wetRate: 1 / 30,
    puddles: 0.7,
    ripples: 0.9,
    wetTint: { color: '#8a0c12', strength: 0.55 },
    grade: { saturation: 1.1, contrast: 1.05 }
  },
  lighting: { tint: '#9a6262', exposure: 0.9, darkness: 0.3 },
  wind: { strengthScale: 1, gustiness: 0.4, turbulence: 0.35 },
  particles: [
    {
      depthLayers: 2,
      windInfluence: 0.45,
      stretch: 22,
      alpha: 0.85,
      blend: 'normal',
      shape: 'drop',
      count: 900,
      fall: 1.5,
      size: [0.0015, 0.0028],
      colorA: '#8a0f16',
      colorB: '#b3202a',
      lifetime: [0.6, 1]
    },
    {
      depthLayers: 2,
      windInfluence: 0.4,
      stretch: 9,
      alpha: 0.92,
      blend: 'normal',
      shape: 'drop',
      count: 110,
      fall: 1.3,
      size: [0.004, 0.0065],
      colorA: '#5e0a10',
      colorB: '#8a1018',
      lifetime: [0.8, 1.3]
    }
  ]
};

export default BloodRainPreset;
