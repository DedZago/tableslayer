import type { AtmospherePreset } from '../../types';

// Phase 2: filled in by the ground (ground/lighting/density) and air (particles/events) streams
const PitchDarkPreset: AtmospherePreset = {
  lighting: { tint: '#10131c', exposure: 0.85, darkness: 0.96 }
};

export default PitchDarkPreset;
