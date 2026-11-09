import type { AtmospherePreset } from '../../types';

// Phase 2: filled in by the ground (ground/lighting/density) and air (particles/events) streams
const FeywildLightsPreset: AtmospherePreset = {
  ground: {
    grade: { saturation: 1.4 },
    tint: { color: '#e8c8ff', strength: 0.25 },
    glowPools: { color: '#ff6fd8', colorB: '#4fe0d0', strength: 0.35, scale: 5 }
  },
  lighting: { tint: '#b6a0e8', exposure: 1, darkness: 0.32, pulse: { amount: 0.08, period: 11 } },
  wind: { strengthScale: 0.3, gustiness: 0.15, turbulence: 0.4 },
  particles: [
    {
      depthLayers: 3,
      windInfluence: 0.2,
      stretch: 1,
      alpha: 0.8,
      blend: 'additive',
      shape: 'mote',
      count: 200,
      fall: -0.01,
      size: [0.008, 0.02],
      colorA: '#ff8ad8',
      colorB: '#8ad8ff',
      lifetime: [5, 10],
      flicker: 0.5,
      wander: 0.05,
      hueSpread: 360
    },
    {
      depthLayers: 2,
      windInfluence: 0.6,
      stretch: 1,
      alpha: 0.85,
      blend: 'normal',
      shape: 'petal',
      count: 40,
      fall: 0.08,
      size: [0.01, 0.018],
      colorA: '#ffc2e6',
      colorB: '#fff0fa',
      lifetime: [8, 14],
      tumble: 0.8,
      wander: 0.03,
      priority: -1
    }
  ]
};

export default FeywildLightsPreset;
