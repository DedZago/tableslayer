import { DensityMode } from '../../sim/types';
import type { AtmospherePreset } from '../../types';

const DustStormPreset: AtmospherePreset = {
  particles: [
    {
      shape: 'grit',
      count: 2800,
      depthLayers: 2,
      fall: 0.15,
      windInfluence: 1,
      size: [0.004, 0.009],
      stretch: 5,
      colorA: '#d9b27a',
      colorB: '#b0804a',
      alpha: 0.55,
      blend: 'normal',
      lifetime: [1.2, 2.4]
    }
  ],
  density: {
    mode: DensityMode.EdgeInflow,
    colorA: '#c99a5b',
    colorB: '#e0c08a',
    scale: 2.2,
    octaves: 3,
    coverage: 0.45,
    overTokens: 0.5,
    speed: 1.4
  },
  ground: { tint: { color: '#d8b98a', strength: 0.12 } },
  lighting: { tint: '#d1a56e', exposure: 0.95, darkness: 0.2 },
  wind: { strengthScale: 1.5, gustiness: 0.7, turbulence: 0.6 }
};

export default DustStormPreset;
