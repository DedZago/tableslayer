import type { AtmospherePreset } from '../../types';

const UnderwaterPreset: AtmospherePreset = {
  particles: [
    {
      shape: 'bubble',
      count: 200,
      depthLayers: 3,
      fall: -0.2,
      windInfluence: 0.2,
      size: [0.008, 0.02],
      stretch: 1,
      colorA: '#d8fbff',
      colorB: '#8fe0e8',
      alpha: 0.55,
      blend: 'normal',
      lifetime: [4, 8],
      wander: 0.03
    }
  ],
  ground: { caustics: 0.7, tint: { color: '#2f8f93', strength: 0.35 } },
  lighting: { tint: '#3a9aa0', exposure: 0.95, darkness: 0.4 },
  wind: { strengthScale: 0.25, gustiness: 0.1, turbulence: 0.3 }
};

export default UnderwaterPreset;
