import type { AtmospherePreset } from '../../types';

const LeavesPreset: AtmospherePreset = {
  particles: [
    {
      shape: 'atlasLeaves',
      count: 90,
      depthLayers: 2,
      fall: 0.18,
      windInfluence: 1,
      size: [0.02, 0.038],
      stretch: 1,
      colorA: '#c8792a',
      colorB: '#7a8f2f',
      alpha: 1,
      blend: 'normal',
      lifetime: [6, 11],
      tumble: 0.7,
      wander: 0.03
    }
  ],
  wind: { strengthScale: 1.3, gustiness: 0.6, turbulence: 0.6 }
};

export default LeavesPreset;
