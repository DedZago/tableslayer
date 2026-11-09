import type { AtmospherePreset } from '../../types';

const SnowPreset: AtmospherePreset = {
  particles: [
    {
      shape: 'flake',
      count: 1800,
      depthLayers: 3,
      fall: 0.11,
      windInfluence: 0.8,
      size: [0.003, 0.008],
      stretch: 1,
      colorA: '#ffffff',
      colorB: '#dfe9f5',
      alpha: 0.85,
      blend: 'normal',
      lifetime: [7, 13],
      tumble: 0.15,
      wander: 0.02
    }
  ],
  ground: { snowRate: 1 / 60 },
  lighting: { tint: '#b8c6dc', exposure: 0.96, darkness: 0.08 },
  wind: { strengthScale: 0.5, gustiness: 0.25, turbulence: 0.45 }
};

export default SnowPreset;
