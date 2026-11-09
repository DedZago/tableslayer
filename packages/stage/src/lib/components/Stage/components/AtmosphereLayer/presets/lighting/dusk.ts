import type { AtmospherePreset } from '../../types';

const DuskPreset: AtmospherePreset = {
  lighting: {
    tint: '#f0a050',
    exposure: 0.95,
    darkness: 0.5,
    sunAngle: 205,
    shafts: { count: 3, color: '#ffb060', strength: 0.5 }
  }
};

export default DuskPreset;
