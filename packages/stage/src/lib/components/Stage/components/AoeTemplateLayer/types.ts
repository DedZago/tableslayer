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
  Acid,
  Thunder,
  Silence,
  HypnoticPattern,
  FaerieFire,
  Sleep,
  SpiritGuardians,
  Moonbeam,
  CloudOfDaggers,
  HungerOfHadar,
  Entangle,
  SpikeGrowth
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
  /** The spell that made this area: its label never carries dimensions, and selecting it shows the spell's card */
  spellId?: string | null;
  /** Marker id this template follows (auras like Spirit Guardians); position is then the marker's */
  anchorMarkerId?: string | null;
  /** Epoch ms; the template fades out over the last EXPIRY_FADE_MS and is hidden after it */
  expiresAt?: number | null;
  /** A spell effect bound to a token (drawn by the TokenEffectLayer): no fill, no hit-test, no handles */
  effectOnly?: boolean;
}

/** Feet like AoeTemplate; `width` is the line width */
export interface SpellAimArea {
  shape: AoeShape;
  size: number;
  width?: number;
}

/**
 * Aiming a spell with the AoE layer active: the preset shape and size are locked, the effect previews on the
 * draft, and the completed aim fires `onSpellAimed` instead of `onAoeTemplateAdded`. Points are layer-local px.
 */
export interface SpellAimSettings {
  spellId: string;
  /**
   * `area` (default): the preset area is aimed at a point or along a direction.
   * `target`: tokens are picked, in range of the caster; each pick fires `onSpellTargeted` and the aim stays
   * until the consumer ends it. `area` is then unused.
   * `area-targets`: the area is aimed like `area`, but placing it fires `onSpellAreaTargets` (the area and the
   * tokens inside it) and the aim stays: the area can be dragged, and a tap on a token inside fires `onSpellTargeted`.
   */
  mode?: 'area' | 'target' | 'area-targets';
  /** Target and area-target aim: the tokens picked so far, outlined as selected */
  pickedMarkerIds?: string[];
  /** Area-target aim: where the area was placed; owned by the consumer, which stores what `onSpellAreaTargets` reports */
  placement?: SpellAreaTargets['placement'] | null;
  /** Shown beside the draft's dimensions */
  label?: string;
  area: SpellAimArea;
  effect: AoeEffect;
  color: string;
  /**
   * `point`: the area follows the pointer and a press places it.
   * `direction`: the area starts at a fixed origin and the pointer sets its angle.
   */
  aim: 'point' | 'direction';
  /** Direction aim: where the area starts. Omitted, the first press sets it (press, drag, release on touch) */
  origin?: { x: number; y: number };
  /** Direction aim with an origin: the area starts this many grid cells from the origin, at the caster's edge */
  originRadiusCells?: number;
  /** Caster centre; with `rangeFt` a dashed range ring is drawn around it */
  caster?: { x: number; y: number };
  /** Caster token size in grid cells; target aiming measures range from its edge */
  casterSizeCells?: number;
  rangeFt?: number;
}

export interface SpellTargeted {
  spellId: string;
  markerId: string;
}

/** A spell area placed and waiting for the click inside it that casts; null when it went back to following the pointer */
export type SpellAimPlaced = SpellAimed | null;

export interface SpellAimed {
  spellId: string;
  /** Where the template starts (its origin), layer-local px */
  position: { x: number; y: number };
  /** Degrees CCW from +x */
  angle: number;
}

/** The area an `area-targets` aim currently covers and the tokens this viewer can see inside it, in marker order */
export interface SpellAreaTargets {
  spellId: string;
  placement: { position: { x: number; y: number }; angle: number };
  markerIds: string[];
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
  /** While set, the layer aims this spell instead of drawing free shapes */
  spell?: SpellAimSettings;
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
  /** Sends a placed, not yet cast, spell area back to following the pointer; false when none was placed */
  unplaceSpellAim(): boolean;
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
  [AoeEffect.Acid]: '#c8e62a',
  [AoeEffect.Thunder]: '#b8c4e8',
  [AoeEffect.Silence]: '#6b7a99',
  [AoeEffect.HypnoticPattern]: '#d56bff',
  [AoeEffect.FaerieFire]: '#7dffb2',
  [AoeEffect.Sleep]: '#6d7bd9',
  [AoeEffect.SpiritGuardians]: '#cfe9ff',
  [AoeEffect.Moonbeam]: '#c7d2fe',
  [AoeEffect.CloudOfDaggers]: '#cbd5e1',
  [AoeEffect.HungerOfHadar]: '#3a2a6b',
  [AoeEffect.Entangle]: '#4d9a3a',
  [AoeEffect.SpikeGrowth]: '#9a8450'
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
  [AoeEffect.Acid]: 'Acid',
  [AoeEffect.Thunder]: 'Thunder',
  [AoeEffect.Silence]: 'Silence',
  [AoeEffect.HypnoticPattern]: 'Hypnotic pattern',
  [AoeEffect.FaerieFire]: 'Faerie fire',
  [AoeEffect.Sleep]: 'Sleep',
  [AoeEffect.SpiritGuardians]: 'Spirit guardians',
  [AoeEffect.Moonbeam]: 'Moonbeam',
  [AoeEffect.CloudOfDaggers]: 'Cloud of daggers',
  [AoeEffect.HungerOfHadar]: 'Hunger of Hadar',
  [AoeEffect.Entangle]: 'Entangle',
  [AoeEffect.SpikeGrowth]: 'Spike growth'
};
