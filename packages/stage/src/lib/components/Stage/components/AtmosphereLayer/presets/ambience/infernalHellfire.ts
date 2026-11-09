import type { AtmospherePreset } from '../../types';

// Phase 2: filled in by the ground (ground/lighting/density) and air (particles/events) streams
const InfernalHellfirePreset: AtmospherePreset = {
  ground: {
    haze: { strength: 0.55, color: '#ff9060' },
    tint: { color: '#ff6a3a', strength: 0.22 },
    grade: { saturation: 1.15, contrast: 1.1 },
    speckle: { color: '#ff5a1a', strength: 0.55, glow: 0.9 }
  },
  lighting: { tint: '#c8503a', exposure: 1, darkness: 0.46, rimVignette: { color: '#ff3a10', strength: 0.4 } },
  wind: { strengthScale: 0.4, gustiness: 0.4, turbulence: 0.6 },
  particles: [
    {
      depthLayers: 3,
      windInfluence: 0.6,
      stretch: 1,
      alpha: 1,
      blend: 'additive',
      shape: 'ember',
      count: 300,
      fall: -0.16,
      size: [0.006, 0.015],
      colorA: '#ff5a1a',
      colorB: '#ffb040',
      lifetime: [3, 7],
      flicker: 0.6,
      wander: 0.03
    },
    {
      depthLayers: 2,
      windInfluence: 0.6,
      stretch: 1,
      alpha: 0.7,
      blend: 'normal',
      shape: 'atlasAsh',
      count: 90,
      fall: 0.07,
      size: [0.01, 0.022],
      colorA: '#4a3a35',
      colorB: '#6a5348',
      lifetime: [8, 14],
      tumble: 0.2,
      wander: 0.02,
      priority: -1
    }
  ],
  events: [{ kind: 'flicker', ratePerMin: 12, rateParam: 'flickerRate' }]
};

export default InfernalHellfirePreset;
