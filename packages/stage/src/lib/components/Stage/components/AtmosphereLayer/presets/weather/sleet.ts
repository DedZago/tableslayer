import type { AtmospherePreset } from '../../types';

// Phase 2: filled in by the ground (ground/lighting/density) and air (particles/events) streams
const SleetPreset: AtmospherePreset = {
  ground: {
    wetRate: 1 / 50,
    puddles: 0.35,
    ripples: 0.5,
    snowRate: 1 / 140,
    snowStrength: 0.45,
    grade: { saturation: 0.9 }
  },
  lighting: { tint: '#8c98aa', exposure: 0.94, darkness: 0.16 },
  wind: { strengthScale: 1.1, gustiness: 0.5, turbulence: 0.4 },
  particles: [
    {
      depthLayers: 2,
      windInfluence: 0.55,
      stretch: 18,
      alpha: 0.5,
      blend: 'normal',
      shape: 'streak',
      count: 1100,
      fall: 2,
      size: [0.0016, 0.0028],
      colorA: '#d4e2f2',
      colorB: '#a9bdd3',
      lifetime: [0.5, 0.9]
    },
    {
      depthLayers: 3,
      windInfluence: 0.8,
      stretch: 1.6,
      alpha: 0.85,
      blend: 'normal',
      shape: 'flake',
      count: 520,
      fall: 0.55,
      size: [0.003, 0.007],
      colorA: '#ffffff',
      colorB: '#dbe7f4',
      lifetime: [1.5, 2.8],
      tumble: 0.1
    }
  ]
};

export default SleetPreset;
