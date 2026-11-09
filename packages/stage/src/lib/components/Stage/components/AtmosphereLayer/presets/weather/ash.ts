import type { AtmospherePreset } from '../../types';

const AshPreset: AtmospherePreset = {
  particles: [
    {
      shape: 'atlasAsh',
      count: 900,
      depthLayers: 3,
      fall: 0.09,
      windInfluence: 0.7,
      size: [0.01, 0.022],
      stretch: 1,
      colorA: '#cfc8be',
      colorB: '#8f8982',
      alpha: 0.85,
      blend: 'normal',
      lifetime: [8, 14],
      tumble: 0.2,
      wander: 0.02
    }
  ],
  lighting: { tint: '#b59a86', exposure: 0.94, darkness: 0.15 },
  wind: { strengthScale: 0.6, gustiness: 0.25, turbulence: 0.4 }
};

export default AshPreset;
