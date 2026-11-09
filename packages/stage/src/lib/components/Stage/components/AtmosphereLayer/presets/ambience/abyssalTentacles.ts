import type { AtmospherePreset } from '../../types';

// Phase 2: filled in by the ground (ground/lighting/density) and air (particles/events) streams
const AbyssalTentaclesPreset: AtmospherePreset = {
  ground: {
    shadows: 'tentacles',
    shadowColor: '#14061f',
    shadowStrength: 0.88,
    tint: { color: '#8a60c0', strength: 0.25 }
  },
  lighting: { tint: '#503070', exposure: 0.9, darkness: 0.38, rimVignette: { color: '#6a20c0', strength: 0.3 } },
  wind: { strengthScale: 0.15, gustiness: 0.1, turbulence: 0.2 },
  particles: [
    {
      depthLayers: 2,
      windInfluence: 0.1,
      stretch: 1,
      alpha: 0.4,
      blend: 'normal',
      shape: 'mote',
      count: 60,
      fall: 0.01,
      size: [0.01, 0.022],
      colorA: '#1a0830',
      colorB: '#2c0f4a',
      lifetime: [8, 14],
      wander: 0.03
    }
  ]
};

export default AbyssalTentaclesPreset;
