import type { AtmospherePreset } from '../../types';

// Phase 2: filled in by the ground (ground/lighting/density) and air (particles/events) streams
const AuroraNightPreset: AtmospherePreset = {
  lighting: {
    tint: '#17305a',
    exposure: 0.95,
    darkness: 0.72,
    aurora: { strength: 0.9, hue: 140, hueParam: 'auroraHue' }
  }
};

export default AuroraNightPreset;
