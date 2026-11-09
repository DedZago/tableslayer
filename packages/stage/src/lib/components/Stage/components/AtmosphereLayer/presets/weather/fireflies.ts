import type { AtmospherePreset } from '../../types';

const FirefliesPreset: AtmospherePreset = {
  particles: [
    {
      shape: 'mote',
      count: 140,
      depthLayers: 2,
      fall: 0,
      windInfluence: 0.15,
      size: [0.01, 0.02],
      stretch: 1,
      colorA: '#d8ff6a',
      colorB: '#a6ff9a',
      alpha: 1,
      blend: 'additive',
      lifetime: [4, 9],
      flicker: 0.9,
      wander: 0.06
    }
  ],
  wind: { strengthScale: 0.3, gustiness: 0.1, turbulence: 0.2 }
};

export default FirefliesPreset;
