import type { AtmospherePreset } from '../../types';

// Phase 2: filled in by the ground (ground/lighting/density) and air (particles/events) streams
const EclipsePreset: AtmospherePreset = {
  lighting: {
    tint: '#7a5560',
    exposure: 0.85,
    darkness: 0.72,
    rimVignette: { color: '#ff5a1a', strength: 0.6 },
    pulse: { amount: 0.3, period: 48 }
  },
  ground: { grade: { saturation: 0.85, contrast: 1.1 } },
  particles: [
    {
      depthLayers: 2,
      windInfluence: 0.2,
      stretch: 1,
      alpha: 0.5,
      blend: 'additive',
      shape: 'mote',
      count: 40,
      fall: -0.02,
      size: [0.006, 0.012],
      colorA: '#ff6a4a',
      colorB: '#ffb070',
      lifetime: [6, 12],
      flicker: 0.6,
      wander: 0.04
    }
  ]
};

export default EclipsePreset;
