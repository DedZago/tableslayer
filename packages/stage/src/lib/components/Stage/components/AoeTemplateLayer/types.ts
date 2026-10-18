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
  /** Primary selection (last of `selectedIds`); drives the edit panel */
  selectedId: string | null;
  /** Every selected template; falls back to `selectedId` when omitted */
  selectedIds?: string[];
  showLabels: boolean;
  tool: AoeToolSettings;
  /** Lets a player-mode screen (the TV) pick, move and edit shapes while no tool is active */
  playerSelectable?: boolean;
}

export interface AoeTemplateLayerExports {
  cancelDraft(): void;
  hasDraft(): boolean;
  /** Topmost visible template at a point in marker-space (layer-local px) */
  hitTest(point: { x: number; y: number }): string | null;
  /** Visible templates touched by a rectangle in marker-space */
  inRectangle(start: { x: number; y: number }, end: { x: number; y: number }): string[];
}

export const AOE_EFFECT_DEFAULT_COLORS: Record<AoeEffect, string> = {
  [AoeEffect.None]: '#ffffff',
  [AoeEffect.Fire]: '#ff6a1a',
  [AoeEffect.Lightning]: '#5aa8ff',
  [AoeEffect.Frost]: '#9ee8ff',
  [AoeEffect.PoisonGas]: '#7fd13b',
  [AoeEffect.Thorns]: '#5b8a2e',
  [AoeEffect.Mud]: '#7a5230',
  [AoeEffect.Darkness]: '#4b2a6b',
  [AoeEffect.FogCloud]: '#d4d8de',
  [AoeEffect.Web]: '#e8e8e8',
  [AoeEffect.Grease]: '#6b7280',
  [AoeEffect.Radiant]: '#ffd166',
  [AoeEffect.Necrotic]: '#3f7a3a',
  [AoeEffect.Force]: '#a78bfa',
  [AoeEffect.Water]: '#2dd4bf',
  [AoeEffect.SleetStorm]: '#cfe6f2',
  [AoeEffect.InsectSwarm]: '#6b4a1e',
  [AoeEffect.Acid]: '#c8e62a'
};

export const AOE_EFFECT_LABELS: Record<AoeEffect, string> = {
  [AoeEffect.None]: 'None',
  [AoeEffect.Fire]: 'Fire',
  [AoeEffect.Lightning]: 'Lightning',
  [AoeEffect.Frost]: 'Frost',
  [AoeEffect.PoisonGas]: 'Poison gas',
  [AoeEffect.Thorns]: 'Thorns',
  [AoeEffect.Mud]: 'Mud',
  [AoeEffect.Darkness]: 'Darkness',
  [AoeEffect.FogCloud]: 'Fog cloud',
  [AoeEffect.Web]: 'Web',
  [AoeEffect.Grease]: 'Grease',
  [AoeEffect.Radiant]: 'Radiant',
  [AoeEffect.Necrotic]: 'Necrotic',
  [AoeEffect.Force]: 'Force',
  [AoeEffect.Water]: 'Water',
  [AoeEffect.SleetStorm]: 'Sleet storm',
  [AoeEffect.InsectSwarm]: 'Insect swarm',
  [AoeEffect.Acid]: 'Acid'
};
