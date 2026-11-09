import type { AtmospherePreset } from '../../types';

// Phase 2: filled in by the ground (ground/lighting/density) and air (particles/events) streams
const SwampMiasmaPreset: AtmospherePreset = {
  ground: {
    groundFog: { color: '#7a9440', colorB: '#3f5a22', density: 0.85, pockets: 0.8 },
    tint: { color: '#a8bc78', strength: 0.3 },
    grade: { saturation: 0.9 }
  },
  lighting: { tint: '#8ea070', exposure: 0.92, darkness: 0.32 },
  wind: { strengthScale: 0.3, gustiness: 0.1, turbulence: 0.3 },
  particles: [
    {
      depthLayers: 2,
      windInfluence: 0.1,
      stretch: 1,
      alpha: 0.9,
      blend: 'additive',
      shape: 'mote',
      count: 160,
      fall: 0,
      size: [0.003, 0.006],
      colorA: '#d9ff7a',
      colorB: '#b6ff6a',
      lifetime: [3, 7],
      flicker: 0.5,
      wander: 0.05,
      jitter: 0.004
    },
    {
      depthLayers: 2,
      windInfluence: 0.1,
      stretch: 1,
      alpha: 0.7,
      blend: 'normal',
      shape: 'mote',
      count: 110,
      fall: 0,
      size: [0.002, 0.004],
      colorA: '#1b2a10',
      colorB: '#2a3a18',
      lifetime: [3, 7],
      wander: 0.05,
      jitter: 0.005,
      priority: -1
    }
  ]
};

export default SwampMiasmaPreset;
