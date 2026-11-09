import type { AtmospherePreset } from '../../types';

const GalePreset: AtmospherePreset = {
  particles: [
    {
      shape: 'windLine',
      count: 18,
      depthLayers: 2,
      fall: 0.05,
      windInfluence: 1,
      size: [0.0028, 0.005],
      stretch: 120,
      colorA: '#ffffff',
      colorB: '#dfe6ee',
      alpha: 0.6,
      blend: 'normal',
      lifetime: [0.5, 1.1]
    },
    {
      shape: 'atlasLeaves',
      count: 60,
      depthLayers: 2,
      fall: 0.1,
      windInfluence: 1,
      size: [0.022, 0.04],
      stretch: 1,
      colorA: '#b88a3a',
      colorB: '#6f8a34',
      alpha: 1,
      blend: 'normal',
      lifetime: [2, 4],
      tumble: 1.2,
      wander: 0.02
    }
  ],
  lighting: { tint: '#99a4b0', exposure: 0.97, darkness: 0.08 },
  wind: { strengthScale: 2.2, gustiness: 1, turbulence: 0.7 }
};

export default GalePreset;
