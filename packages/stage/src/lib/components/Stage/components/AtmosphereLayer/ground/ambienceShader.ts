import fieldChunk from '../../../shaders/atmosphere/field.glsl?raw';
import ambienceChunk from '../../../shaders/atmosphere/groundAmbience.glsl?raw';
import noiseChunk from '../../../shaders/atmosphere/noise.glsl?raw';
import { DensityMode } from '../sim/types';
import type { ComposedAtmosphere } from '../types';

export const ambienceVertexShader = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export interface AmbienceFeatures {
  fog: boolean;
  density: boolean;
  densityMode: DensityMode;
  octaves: number;
  nebula: boolean;
  tentacles: boolean;
  tremor: boolean;
}

/** The under-token parts of the composition AmbienceGround draws, which select its program */
export const getAmbienceFeatures = (composed: ComposedAtmosphere): AmbienceFeatures => {
  const { density, ground, events } = composed;
  const hasDensity = density !== null && density.overTokens < 1;
  return {
    fog: ground.groundFog !== null,
    density: hasDensity,
    densityMode: hasDensity ? density.mode : DensityMode.None,
    octaves: density?.octaves ?? 2,
    nebula: hasDensity && density.nebula,
    tentacles: ground.shadows === 'tentacles',
    tremor: events.some((event) => event.kind === 'tremor')
  };
};

export const getAmbienceSignature = ({
  fog,
  density,
  densityMode,
  octaves,
  nebula,
  tentacles,
  tremor
}: AmbienceFeatures) =>
  !fog && !density && !tentacles && !tremor
    ? ''
    : [
        fog ? 'fog' : '',
        density ? `density${densityMode}${nebula ? 'n' : ''}` : '',
        tentacles ? 'tentacles' : '',
        tremor ? 'tremor' : '',
        `oct${octaves}`
      ].join('|');

export const buildAmbienceFragmentShader = ({
  fog,
  density,
  densityMode,
  octaves,
  nebula,
  tentacles,
  tremor
}: AmbienceFeatures) =>
  [
    'precision highp float;',
    `#define ATMO_OCTAVES ${octaves}`,
    fog ? '#define AMBIENCE_FOG' : '',
    density ? '#define AMBIENCE_DENSITY' : '',
    nebula ? '#define DENSITY_NEBULA' : '',
    tentacles ? '#define AMBIENCE_TENTACLES' : '',
    tremor ? '#define AMBIENCE_TREMOR' : '',
    `#define DENSITY_MODE ${densityMode}`,
    noiseChunk,
    fieldChunk,
    ambienceChunk
  ].join('\n');
