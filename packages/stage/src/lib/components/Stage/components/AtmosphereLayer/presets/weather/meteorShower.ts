import type { AtmospherePreset } from '../../types';

// Phase 2: filled in by the ground (ground/lighting/density) and air (particles/events) streams
const MeteorShowerPreset: AtmospherePreset = {
  ground: { grade: { saturation: 0.95 } },
  lighting: { tint: '#2d3868', tintAlt: '#6a78b0', exposure: 0.95, darkness: 0.62 },
  wind: { strengthScale: 0.4, gustiness: 0.2, turbulence: 0.2 },
  particles: [
    {
      depthLayers: 2,
      windInfluence: 0,
      stretch: 1,
      alpha: 0.55,
      blend: 'additive',
      shape: 'star',
      count: 90,
      fall: 0,
      size: [0.006, 0.012],
      colorA: '#cfe4ff',
      colorB: '#fff3d0',
      lifetime: [5, 10],
      flicker: 0.8
    }
  ],
  events: [{ kind: 'meteor', ratePerMin: 8, rateParam: 'meteorRate' }]
};

export default MeteorShowerPreset;
