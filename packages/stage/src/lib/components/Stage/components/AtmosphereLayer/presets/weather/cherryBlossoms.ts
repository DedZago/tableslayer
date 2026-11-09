import type { AtmospherePreset } from '../../types';

// Phase 2: filled in by the ground (ground/lighting/density) and air (particles/events) streams
const CherryBlossomsPreset: AtmospherePreset = {
  ground: {
    snowRate: 1 / 110,
    snowStrength: 0.8,
    snowColor: '#f3b5cb',
    grade: { saturation: 1.12 },
    tint: { color: '#ffe6ee', strength: 0.25 }
  },
  lighting: { tint: '#ffdbe4', exposure: 1.02, darkness: 0.14, sunAngle: 55 },
  wind: { strengthScale: 0.6, gustiness: 0.3, turbulence: 0.4 },
  particles: [
    {
      depthLayers: 3,
      windInfluence: 1,
      stretch: 1,
      alpha: 0.95,
      blend: 'normal',
      shape: 'petal',
      count: 240,
      fall: 0.12,
      size: [0.011, 0.022],
      colorA: '#ffb3cf',
      colorB: '#fff0f5',
      lifetime: [7, 13],
      tumble: 1.1,
      wander: 0.025
    },
    {
      depthLayers: 2,
      windInfluence: 1,
      stretch: 1,
      alpha: 0.9,
      blend: 'normal',
      shape: 'petal',
      count: 160,
      fall: 0.08,
      size: [0.006, 0.011],
      colorA: '#ff9fc3',
      colorB: '#ffe3ee',
      lifetime: [9, 16],
      tumble: 0.8,
      wander: 0.015,
      priority: -1
    }
  ]
};

export default CherryBlossomsPreset;
