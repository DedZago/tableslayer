import { DensityMode } from '../../sim/types';
import type { AtmospherePreset } from '../../types';

// Phase 2: filled in by the ground (ground/lighting/density) and air (particles/events) streams
const AcidRainPreset: AtmospherePreset = {
  density: {
    mode: DensityMode.Everywhere,
    colorA: '#9cae4a',
    colorB: '#c4d65a',
    scale: 3,
    octaves: 2,
    coverage: 0.14,
    overTokens: 0.25
  },
  ground: {
    wetRate: 1 / 38,
    puddles: 0.45,
    ripples: 0.9,
    wetTint: { color: '#b4d636', strength: 0.4 },
    speckle: { color: '#c8ee3a', strength: 0.5, glow: 0.25 },
    grade: { saturation: 1.12 }
  },
  lighting: { tint: '#a3ad74', exposure: 0.95, darkness: 0.2 },
  wind: { strengthScale: 0.9, gustiness: 0.3, turbulence: 0.35 },
  particles: [
    {
      depthLayers: 2,
      windInfluence: 0.5,
      stretch: 24,
      alpha: 0.62,
      blend: 'normal',
      shape: 'streak',
      count: 1500,
      fall: 2.2,
      size: [0.0018, 0.003],
      colorA: '#c4f23a',
      colorB: '#e9f04a',
      lifetime: [0.45, 0.8]
    },
    {
      depthLayers: 2,
      windInfluence: 0.3,
      stretch: 1,
      alpha: 0.5,
      blend: 'additive',
      shape: 'mote',
      count: 260,
      fall: -0.07,
      size: [0.006, 0.014],
      colorA: '#b6ff5a',
      colorB: '#eaff7a',
      lifetime: [2.5, 5],
      flicker: 0.35,
      wander: 0.02
    }
  ]
};

export default AcidRainPreset;
