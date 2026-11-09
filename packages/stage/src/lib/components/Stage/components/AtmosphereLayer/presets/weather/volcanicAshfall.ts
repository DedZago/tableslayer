import { DensityMode } from '../../sim/types';
import type { AtmospherePreset } from '../../types';

// Phase 2: filled in by the ground (ground/lighting/density) and air (particles/events) streams
const VolcanicAshfallPreset: AtmospherePreset = {
  density: {
    mode: DensityMode.Everywhere,
    colorA: '#5b4f4a',
    colorB: '#8a7468',
    scale: 2.4,
    octaves: 2,
    coverage: 0.3,
    overTokens: 0.35
  },
  ground: {
    snowRate: 1 / 50,
    snowStrength: 0.92,
    snowColor: '#8a8580',
    grade: { saturation: 0.78, contrast: 1.05 },
    tint: { color: '#d08060', strength: 0.4 }
  },
  lighting: { tint: '#a77562', exposure: 0.88, darkness: 0.38, pulse: { amount: 0.12, period: 9 } },
  wind: { strengthScale: 0.8, gustiness: 0.4, turbulence: 0.5 },
  particles: [
    {
      depthLayers: 3,
      windInfluence: 0.7,
      stretch: 1,
      alpha: 0.85,
      blend: 'normal',
      shape: 'atlasAsh',
      count: 1100,
      fall: 0.1,
      size: [0.01, 0.024],
      colorA: '#aaa39b',
      colorB: '#6f6a66',
      lifetime: [8, 14],
      tumble: 0.2,
      wander: 0.02
    },
    {
      depthLayers: 3,
      windInfluence: 0.6,
      stretch: 1,
      alpha: 1,
      blend: 'additive',
      shape: 'ember',
      count: 70,
      fall: -0.1,
      size: [0.006, 0.013],
      colorA: '#ff6a1f',
      colorB: '#ffb347',
      lifetime: [3, 6],
      flicker: 0.7,
      wander: 0.025
    }
  ],
  events: [
    { kind: 'tremor', ratePerMin: 1, rateParam: 'rumbleRate' },
    { kind: 'pulse', ratePerMin: 3 }
  ]
};

export default VolcanicAshfallPreset;
