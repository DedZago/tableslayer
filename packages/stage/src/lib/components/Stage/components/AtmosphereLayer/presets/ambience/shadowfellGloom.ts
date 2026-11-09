import type { AtmospherePreset } from '../../types';

// Phase 2: filled in by the ground (ground/lighting/density) and air (particles/events) streams
const ShadowfellGloomPreset: AtmospherePreset = {
  ground: {
    grade: { saturation: 0.25, contrast: 1.15 },
    groundFog: { color: '#0a140e', colorB: '#1c2a20', density: 0.92, pockets: 0.5, edge: 0.9 }
  },
  lighting: { tint: '#5c6c62', exposure: 0.85, darkness: 0.62 },
  wind: { strengthScale: 0.25, gustiness: 0.1, turbulence: 0.3 },
  particles: [
    {
      depthLayers: 2,
      windInfluence: 0.3,
      stretch: 1,
      alpha: 0.85,
      blend: 'normal',
      shape: 'mote',
      count: 420,
      fall: 0.05,
      size: [0.005, 0.014],
      colorA: '#8b8f99',
      colorB: '#555a63',
      lifetime: [8, 14],
      wander: 0.02
    },
    {
      depthLayers: 2,
      windInfluence: 0.4,
      stretch: 1,
      alpha: 0.6,
      blend: 'normal',
      shape: 'atlasAsh',
      count: 80,
      fall: 0.06,
      size: [0.012, 0.026],
      colorA: '#7a7f88',
      colorB: '#555a62',
      lifetime: [9, 15],
      tumble: 0.15,
      wander: 0.015,
      priority: -1
    }
  ]
};

export default ShadowfellGloomPreset;
