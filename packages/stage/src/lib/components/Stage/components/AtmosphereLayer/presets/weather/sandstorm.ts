import { DensityMode } from '../../sim/types';
import type { AtmospherePreset } from '../../types';

const SandstormPreset: AtmospherePreset = {
  particles: [
    {
      shape: 'grit',
      count: 4500,
      depthLayers: 3,
      fall: 0.1,
      windInfluence: 1,
      size: [0.004, 0.01],
      stretch: 6,
      colorA: '#dcae6a',
      colorB: '#a8703a',
      alpha: 0.65,
      blend: 'normal',
      lifetime: [0.9, 1.8]
    }
  ],
  density: {
    mode: DensityMode.EdgeInflow,
    colorA: '#b9783a',
    colorB: '#d9a35e',
    scale: 1.8,
    octaves: 3,
    coverage: 0.8,
    overTokens: 0.8,
    speed: 1.8
  },
  lighting: { tint: '#b87a42', exposure: 0.9, darkness: 0.38 },
  wind: { strengthScale: 2, gustiness: 0.9, turbulence: 0.8 }
};

export default SandstormPreset;
