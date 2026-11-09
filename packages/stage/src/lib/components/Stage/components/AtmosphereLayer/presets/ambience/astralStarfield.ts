import { DensityMode } from '../../sim/types';
import type { AtmospherePreset } from '../../types';

// Phase 2: filled in by the ground (ground/lighting/density) and air (particles/events) streams
const AstralStarfieldPreset: AtmospherePreset = {
  density: {
    mode: DensityMode.Everywhere,
    colorA: '#6a2ac0',
    colorB: '#2a6cc0',
    scale: 1.6,
    octaves: 3,
    coverage: 0.32,
    overTokens: 0,
    nebula: true,
    speed: 0.4
  },
  ground: { grade: { saturation: 1.2 }, tint: { color: '#a890ff', strength: 0.25 } },
  lighting: { tint: '#2d2468', exposure: 0.92, darkness: 0.76 },
  wind: { strengthScale: 0.15, gustiness: 0.1, turbulence: 0.2 },
  particles: [
    {
      depthLayers: 2,
      windInfluence: 0,
      stretch: 1,
      alpha: 0.9,
      blend: 'additive',
      shape: 'star',
      count: 220,
      fall: 0.01,
      size: [0.004, 0.011],
      colorA: '#cfd8ff',
      colorB: '#ffffff',
      lifetime: [10, 20],
      flicker: 0.9
    },
    {
      depthLayers: 2,
      windInfluence: 0,
      stretch: 1,
      alpha: 0.7,
      blend: 'additive',
      shape: 'mote',
      count: 280,
      fall: 0.006,
      size: [0.002, 0.004],
      colorA: '#b8a8ff',
      colorB: '#e6e0ff',
      lifetime: [12, 22],
      flicker: 0.7,
      priority: -1
    },
    {
      depthLayers: 1,
      windInfluence: 0,
      stretch: 40,
      alpha: 0.9,
      blend: 'additive',
      shape: 'meteor',
      count: 2,
      fall: 0.9,
      size: [0.002, 0.003],
      colorA: '#cfe0ff',
      colorB: '#ffffff',
      lifetime: [18, 34],
      priority: -2
    }
  ]
};

export default AstralStarfieldPreset;
