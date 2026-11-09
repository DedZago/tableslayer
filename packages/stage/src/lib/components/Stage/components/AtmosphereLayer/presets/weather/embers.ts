import type { AtmospherePreset } from '../../types';

const EmbersPreset: AtmospherePreset = {
  particles: [
    {
      shape: 'ember',
      count: 420,
      depthLayers: 3,
      fall: -0.14,
      windInfluence: 0.6,
      size: [0.006, 0.016],
      stretch: 1,
      colorA: '#ff9a3c',
      colorB: '#ff4d12',
      alpha: 1,
      blend: 'additive',
      lifetime: [3, 7],
      flicker: 0.6,
      wander: 0.03
    }
  ],
  lighting: { tint: '#c98a5a', exposure: 1, darkness: 0.12 },
  wind: { strengthScale: 0.7, gustiness: 0.35, turbulence: 0.5 }
};

export default EmbersPreset;
