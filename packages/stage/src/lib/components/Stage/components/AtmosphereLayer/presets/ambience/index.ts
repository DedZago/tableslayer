import { AmbienceType } from '../../../WeatherLayer/types';
import type { AtmospherePreset } from '../../types';
import AbyssalTentaclesPreset from './abyssalTentacles';
import AstralStarfieldPreset from './astralStarfield';
import CloudShadowsPreset from './cloudShadows';
import DivineRadiancePreset from './divineRadiance';
import FeywildLightsPreset from './feywildLights';
import FreezingMistPreset from './freezingMist';
import GhostWispsPreset from './ghostWisps';
import GroundFogPreset from './groundFog';
import HeatHazePreset from './heatHaze';
import InfernalHellfirePreset from './infernalHellfire';
import SandwormTremorsPreset from './sandwormTremors';
import ShadowfellGloomPreset from './shadowfellGloom';
import SwampMiasmaPreset from './swampMiasma';
import UnderwaterPreset from './underwater';
import WildfireSmokePreset from './wildfireSmoke';

export const AMBIENCE_PRESETS: Partial<Record<number, AtmospherePreset>> = {
  [AmbienceType.GroundFog]: GroundFogPreset,
  [AmbienceType.CloudShadows]: CloudShadowsPreset,
  [AmbienceType.HeatHaze]: HeatHazePreset,
  [AmbienceType.WildfireSmoke]: WildfireSmokePreset,
  [AmbienceType.Underwater]: UnderwaterPreset,
  [AmbienceType.SwampMiasma]: SwampMiasmaPreset,
  [AmbienceType.FeywildLights]: FeywildLightsPreset,
  [AmbienceType.GhostWisps]: GhostWispsPreset,
  [AmbienceType.DivineRadiance]: DivineRadiancePreset,
  [AmbienceType.ShadowfellGloom]: ShadowfellGloomPreset,
  [AmbienceType.InfernalHellfire]: InfernalHellfirePreset,
  [AmbienceType.AstralStarfield]: AstralStarfieldPreset,
  [AmbienceType.AbyssalTentacles]: AbyssalTentaclesPreset,
  [AmbienceType.FreezingMist]: FreezingMistPreset,
  [AmbienceType.SandwormTremors]: SandwormTremorsPreset
};
