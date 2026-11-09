import type { AtmospherePreset } from '../../types';

// Phase 2: filled in by the ground (ground/lighting/density) and air (particles/events) streams
const DivineRadiancePreset: AtmospherePreset = {
  ground: {
    grade: { saturation: 1.15 },
    tint: { color: '#ffe29a', strength: 0.28 },
    glowPools: { color: '#ffd878', colorB: '#fff2c8', strength: 0.3, scale: 6 }
  },
  lighting: {
    tint: '#ffe8b0',
    exposure: 1.08,
    darkness: 0.28,
    sunAngle: 80,
    shafts: { count: 4, color: '#ffe6a0', strength: 0.7 },
    pulse: { amount: 0.3, period: 8 }
  },
  wind: { strengthScale: 0.2, gustiness: 0.1, turbulence: 0.2 },
  particles: [
    {
      depthLayers: 3,
      windInfluence: 0.2,
      stretch: 1,
      alpha: 0.8,
      blend: 'additive',
      shape: 'mote',
      count: 220,
      fall: -0.03,
      size: [0.006, 0.016],
      colorA: '#ffd88a',
      colorB: '#fff2c0',
      lifetime: [6, 12],
      flicker: 0.5,
      wander: 0.03
    }
  ]
};

export default DivineRadiancePreset;
