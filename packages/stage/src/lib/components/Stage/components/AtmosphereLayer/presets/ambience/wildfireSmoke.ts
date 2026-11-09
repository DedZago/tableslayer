import { DensityMode } from '../../sim/types';
import type { AtmospherePreset } from '../../types';

const WildfireSmokePreset: AtmospherePreset = {
  particles: [
    {
      shape: 'ember',
      count: 120,
      depthLayers: 2,
      fall: -0.12,
      windInfluence: 0.8,
      size: [0.005, 0.012],
      stretch: 1,
      colorA: '#ffa040',
      colorB: '#ff5a1a',
      alpha: 1,
      blend: 'additive',
      lifetime: [3, 6],
      flicker: 0.7,
      wander: 0.03
    }
  ],
  density: {
    mode: DensityMode.Plumes,
    colorA: '#4a3f38',
    colorB: '#8a6f58',
    scale: 2,
    octaves: 3,
    coverage: 0.68,
    overTokens: 0.4,
    speed: 0.8
  },
  ground: { tint: { color: '#c07840', strength: 0.18 } },
  lighting: { tint: '#b8855a', exposure: 0.9, darkness: 0.3 },
  wind: { strengthScale: 1, gustiness: 0.4, turbulence: 0.5 }
};

export default WildfireSmokePreset;
