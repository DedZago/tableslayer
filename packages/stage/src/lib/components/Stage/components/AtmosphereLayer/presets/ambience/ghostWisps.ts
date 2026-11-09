import type { AtmospherePreset } from '../../types';

// Phase 2: filled in by the ground (ground/lighting/density) and air (particles/events) streams
const GhostWispsPreset: AtmospherePreset = {
  ground: {
    grade: { saturation: 0.35, contrast: 1.1 },
    tint: { color: '#a8c4e8', strength: 0.35 },
    groundFog: { color: '#d0e2f2', colorB: '#a9bdd6', density: 0.38, pockets: 0.6 }
  },
  lighting: { tint: '#7c90b2', exposure: 0.92, darkness: 0.5 },
  wind: { strengthScale: 0.3, gustiness: 0.2, turbulence: 0.4 },
  particles: [
    {
      depthLayers: 2,
      windInfluence: 0.35,
      stretch: 1.8,
      alpha: 0.32,
      blend: 'additive',
      shape: 'wisp',
      count: 26,
      fall: 0,
      size: [0.05, 0.11],
      colorA: '#bfe6ff',
      colorB: '#e8f4ff',
      lifetime: [8, 16],
      wander: 0.06
    },
    {
      depthLayers: 2,
      windInfluence: 0.2,
      stretch: 1,
      alpha: 0.5,
      blend: 'additive',
      shape: 'mote',
      count: 60,
      fall: -0.01,
      size: [0.005, 0.01],
      colorA: '#d8f1ff',
      colorB: '#ffffff',
      lifetime: [4, 9],
      flicker: 0.6,
      wander: 0.03,
      priority: -1
    }
  ]
};

export default GhostWispsPreset;
