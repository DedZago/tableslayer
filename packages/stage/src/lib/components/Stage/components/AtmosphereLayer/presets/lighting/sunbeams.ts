import type { AtmospherePreset } from '../../types';

const SunbeamsPreset: AtmospherePreset = {
  particles: [
    {
      shape: 'mote',
      count: 140,
      depthLayers: 2,
      fall: 0.01,
      windInfluence: 0.5,
      size: [0.006, 0.012],
      stretch: 1,
      colorA: '#fff4d0',
      colorB: '#ffe3a0',
      alpha: 0.6,
      blend: 'additive',
      lifetime: [6, 12],
      flicker: 0.4,
      wander: 0.02
    }
  ],
  lighting: {
    tint: '#8f98b0',
    exposure: 1,
    darkness: 0.42,
    sunAngle: 60,
    shafts: { count: 5, color: '#fff0c0', strength: 0.8 }
  }
};

export default SunbeamsPreset;
