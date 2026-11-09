import { DensityMode } from '../../sim/types';
import type { AtmospherePreset } from '../../types';

// Phase 2: filled in by the ground (ground/lighting/density) and air (particles/events) streams
const SporeDriftPreset: AtmospherePreset = {
  density: {
    mode: DensityMode.Everywhere,
    colorA: '#2f8a7a',
    colorB: '#7a50b0',
    scale: 2.6,
    octaves: 2,
    coverage: 0.16,
    overTokens: 0.3
  },
  ground: {
    tint: { color: '#b8a0e0', strength: 0.22 },
    grade: { saturation: 1.15 },
    glowPools: { color: '#3af0c0', colorB: '#a860ff', strength: 0.2, scale: 5 }
  },
  lighting: { tint: '#6ab0aa', exposure: 0.95, darkness: 0.36, pulse: { amount: 0.1, period: 9 } },
  wind: { strengthScale: 0.35, gustiness: 0.15, turbulence: 0.5 },
  particles: [
    {
      depthLayers: 3,
      windInfluence: 0.4,
      stretch: 1,
      alpha: 0.75,
      blend: 'additive',
      shape: 'spore',
      count: 420,
      fall: -0.035,
      size: [0.005, 0.012],
      colorA: '#9dffb0',
      colorB: '#e6ff9a',
      lifetime: [8, 16],
      flicker: 0.6,
      wander: 0.04
    }
  ]
};

export default SporeDriftPreset;
