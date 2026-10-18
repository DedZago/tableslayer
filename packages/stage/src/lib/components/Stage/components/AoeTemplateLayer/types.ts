import type { StageMode } from '../Stage/types';

export enum AoeShape {
  Circle = 'circle',
  Square = 'square',
  Cone = 'cone',
  Line = 'line'
}

export enum AoeEffect {
  None = 0,
  Fire,
  Lightning,
  Frost,
  PoisonGas,
  Thorns,
  Mud,
  Darkness,
  FogCloud,
  Web,
  Grease,
  Radiant,
  Necrotic,
  Force,
  Water,
  SleetStorm,
  InsectSwarm,
  Acid
}

export interface AoeTemplate {
  id: string;
  shape: AoeShape;
  /** Origin: centre for circle, apex for cone, face midpoint for square/line */
  position: { x: number; y: number };
  /** Degrees CCW from +x, layer-local */
  angle: number;
  /** Feet: radius | side | length */
  size: number;
  /** Feet, line only (default 5) */
  width: number;
  effect: AoeEffect;
  color: string;
  /** 0..1 */
  opacity: number;
  /** StageMode.DM = GM-only, StageMode.Player = visible to players */
  visibility: StageMode;
  /** Optional spell name */
  label?: string | null;
}

export interface AoeToolSettings {
  shape: AoeShape;
  effect: AoeEffect;
  color: string;
  opacity: number;
  lineWidth: number;
  snapToGrid: boolean;
  snapAngle: boolean;
  visibility: StageMode;
}

export interface AoeTemplateLayerProps {
  templates: AoeTemplate[];
  selectedId: string | null;
  showLabels: boolean;
  tool: AoeToolSettings;
}

export interface AoeTemplateLayerExports {
  cancelDraft(): void;
  hasDraft(): boolean;
}
