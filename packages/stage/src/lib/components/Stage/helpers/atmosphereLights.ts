import type { GridLayerProps } from '../components/GridLayer/types';
import type { Light } from '../components/LightLayer/types';
import type { DisplayProps } from '../components/Stage/types';
import { getGridCellSize } from './grid';
import { displayToMapSpace, getMapGridCellSize, type MapImageSize, type MapTransform } from './mapSpace';

/** A placed light converted to the atmosphere's map UV space (u right, v up) */
export interface AtmosphereLightUv {
  u: number;
  v: number;
  /** In map-height units */
  radius: number;
  color: string;
  /** 0..1 */
  intensity: number;
}

export interface LightSpaceOptions {
  isMapDefined: boolean;
  map: MapTransform;
  mapSize: MapImageSize;
  grid: GridLayerProps;
  /** The real display (FillSpace lights are in display pixels) */
  display: DisplayProps;
}

/**
 * Builds the marker-space to map-UV converter for lights: MapDefined positions are center-relative map
 * pixels, FillSpace positions are center-relative display pixels (see `helpers/mapSpace.ts`).
 */
export const createLightToMapUv = ({ isMapDefined, map, mapSize, grid, display }: LightSpaceOptions) => {
  const cellMapPx = isMapDefined ? getMapGridCellSize(grid, mapSize) : getGridCellSize(grid, display) / map.zoom;
  return (light: Pick<Light, 'position' | 'radius' | 'color' | 'opacity'>): AtmosphereLightUv => {
    const mapPosition = isMapDefined ? light.position : displayToMapSpace(light.position, map);
    return {
      u: mapPosition.x / mapSize.width + 0.5,
      v: mapPosition.y / mapSize.height + 0.5,
      radius: ((light.radius / 2) * cellMapPx) / mapSize.height,
      color: light.color,
      intensity: light.opacity
    };
  };
};
