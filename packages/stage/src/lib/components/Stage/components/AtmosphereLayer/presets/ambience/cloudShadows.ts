import type { AtmospherePreset } from '../../types';

const CloudShadowsPreset: AtmospherePreset = {
  ground: { clouds: { coverage: 0.5, darkness: 0.5, scale: 14, speed: 0.5, coverageParam: 'cloudCoverage' } },
  wind: { strengthScale: 0.8, gustiness: 0.3, turbulence: 0.2 }
};

export default CloudShadowsPreset;
