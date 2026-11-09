import type { AtmospherePreset } from '../../types';

// Phase 2: filled in by the ground (ground/lighting/density) and air (particles/events) streams
const FreezingMistPreset: AtmospherePreset = {
  ground: {
    groundFog: { color: '#bcdcf4', colorB: '#8fbce0', density: 0.5, pockets: 0.4 },
    snowRate: 1 / 200,
    snowStrength: 0.35,
    snowColor: '#cfe4f5',
    grade: { saturation: 0.85 },
    tint: { color: '#a8d0ff', strength: 0.25 }
  },
  lighting: { tint: '#9cbae2', exposure: 0.98, darkness: 0.3, rimVignette: { color: '#bfe4ff', strength: 0.5 } },
  wind: { strengthScale: 0.3, gustiness: 0.15, turbulence: 0.3 },
  particles: [
    {
      depthLayers: 2,
      windInfluence: 0.3,
      stretch: 1,
      alpha: 0.9,
      blend: 'additive',
      shape: 'star',
      count: 140,
      fall: 0.02,
      size: [0.004, 0.01],
      colorA: '#e8fbff',
      colorB: '#a8dcff',
      lifetime: [2, 5],
      flicker: 1,
      wander: 0.01
    }
  ]
};

export default FreezingMistPreset;
