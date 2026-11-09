import { DensityMode } from '../../sim/types';
import type { AtmospherePreset } from '../../types';

// Phase 2: filled in by the ground (ground/lighting/density) and air (particles/events) streams
const ArcaneStormPreset: AtmospherePreset = {
  density: {
    mode: DensityMode.Everywhere,
    colorA: '#4a2a8a',
    colorB: '#7a58cc',
    scale: 3,
    octaves: 2,
    coverage: 0.16,
    overTokens: 0.25
  },
  ground: { tint: { color: '#b49aff', strength: 0.3 }, grade: { saturation: 1.2 } },
  lighting: { tint: '#6a58a8', exposure: 0.95, darkness: 0.42 },
  wind: { strengthScale: 1.1, gustiness: 0.6, turbulence: 0.7 },
  particles: [
    {
      depthLayers: 3,
      windInfluence: 0.9,
      stretch: 1,
      alpha: 0.8,
      blend: 'additive',
      shape: 'mote',
      count: 700,
      fall: 0,
      size: [0.004, 0.009],
      colorA: '#9b6bff',
      colorB: '#4fa3ff',
      lifetime: [4, 8],
      flicker: 0.5,
      wander: 0.04,
      tumble: 0.5
    },
    {
      depthLayers: 2,
      windInfluence: 0.6,
      stretch: 1,
      alpha: 0.8,
      blend: 'additive',
      shape: 'star',
      count: 70,
      fall: 0,
      size: [0.006, 0.012],
      colorA: '#e3d4ff',
      colorB: '#bfe0ff',
      lifetime: [2, 4],
      flicker: 0.9,
      priority: -1
    }
  ],
  events: [
    {
      kind: 'surge',
      ratePerMin: 5,
      rateParam: 'arcaneStrikeRate',
      bolts: [1, 2],
      hueMode: 'fixed',
      hue: 270,
      hueParam: 'arcaneHue'
    }
  ]
};

export default ArcaneStormPreset;
