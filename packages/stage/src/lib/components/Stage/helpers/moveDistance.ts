import type { GridLayerProps } from '../components/GridLayer/types';
import type { DisplayProps } from '../components/Stage/types';
import { getGridCellSize } from './grid';

type Point = { x: number; y: number };

/** Grid steps between two layer points, diagonals counting as one step */
export const getGridSteps = (a: Point, b: Point, cellPx: number) =>
  cellPx > 0 ? Math.round(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / cellPx) : 0;

export const getMoveDistanceFeet = (a: Point, b: Point, grid: GridLayerProps, display: DisplayProps) =>
  getGridSteps(a, b, getGridCellSize(grid, display)) * (grid.worldGridSize || 5);

export const formatFeet = (feet: number) => `${Math.round(feet * 10) / 10} ft`;
