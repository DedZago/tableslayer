import type { AtmospherePreset } from '../../types';

// Phase 2: filled in by the ground (ground/lighting/density) and air (particles/events) streams
const SandwormTremorsPreset: AtmospherePreset = {
  ground: { tint: { color: '#d0a060', strength: 0.2 }, grade: { saturation: 1.05 } },
  lighting: { tint: '#e0b880', exposure: 1, darkness: 0.16 },
  wind: { strengthScale: 0.5, gustiness: 0.3, turbulence: 0.4 },
  events: [{ kind: 'tremor', ratePerMin: 3, rateParam: 'tremorRate' }]
};

export default SandwormTremorsPreset;
