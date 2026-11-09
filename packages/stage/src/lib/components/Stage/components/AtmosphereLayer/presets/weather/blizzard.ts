import { DensityMode } from '../../sim/types';
import type { AtmospherePreset } from '../../types';

const BlizzardPreset: AtmospherePreset = {
  particles: [
    {
      shape: 'flake',
      count: 3800,
      depthLayers: 3,
      fall: 0.7,
      windInfluence: 1,
      size: [0.0018, 0.0042],
      stretch: 11,
      colorA: '#ffffff',
      colorB: '#dfe9f5',
      alpha: 0.85,
      blend: 'normal',
      lifetime: [1.2, 2.6],
      tumble: 0.1
    },
    {
      shape: 'windLine',
      count: 12,
      depthLayers: 2,
      fall: 0.2,
      windInfluence: 1,
      size: [0.0028, 0.005],
      stretch: 120,
      colorA: '#ffffff',
      colorB: '#e8eef5',
      alpha: 0.35,
      blend: 'normal',
      lifetime: [0.6, 1.2],
      priority: -1
    }
  ],
  density: {
    mode: DensityMode.Everywhere,
    colorA: '#e8eef5',
    colorB: '#ffffff',
    scale: 2.5,
    octaves: 2,
    coverage: 0.55,
    overTokens: 0.6
  },
  ground: { snowRate: 1 / 25 },
  lighting: { tint: '#c3d0e2', exposure: 0.95, darkness: 0.15 },
  wind: { strengthScale: 1.6, gustiness: 0.7, turbulence: 0.7 }
};

export default BlizzardPreset;
