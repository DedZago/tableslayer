import { DensityMode } from '../../sim/types';
import type { AtmospherePreset } from '../../types';

const GroundFogPreset: AtmospherePreset = {
  particles: [
    {
      shape: 'wisp',
      count: 40,
      depthLayers: 2,
      fall: 0,
      windInfluence: 0.6,
      size: [0.14, 0.28],
      stretch: 1,
      colorA: '#e2e8ec',
      colorB: '#c4ced6',
      alpha: 0.16,
      blend: 'normal',
      lifetime: [10, 18],
      wander: 0.03
    }
  ],
  density: {
    mode: DensityMode.Everywhere,
    colorA: '#dde3e8',
    colorB: '#b9c3cc',
    scale: 2.5,
    octaves: 2,
    coverage: 0.2,
    overTokens: 0.25
  },
  ground: { groundFog: { color: '#cfd6dc', density: 0.75, densityParam: 'fogDensity' } },
  lighting: { tint: '#aab5c0', exposure: 0.98, darkness: 0.1 },
  wind: { strengthScale: 0.5, gustiness: 0.2, turbulence: 0.3 }
};

export default GroundFogPreset;
