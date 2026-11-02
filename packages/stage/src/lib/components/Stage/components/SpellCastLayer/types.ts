import type { SpellArea, SpellCastFx, TokenEffectKind } from '../../helpers/spells';

export interface SpellCastPoint {
  x: number;
  y: number;
}

/**
 * One transient spell animation. Points are marker-space (layer-local px, the
 * same space as AoeTemplate.position); areas are feet.
 */
export interface SpellCast {
  id: string;
  spellId: string;
  fx: SpellCastFx;
  variant: number;
  palette: [string, string];
  /** Burst only: a bead flies from `origin` to `target` before the impact */
  projectile?: boolean;
  /** Placed at `target`, pointing along `angle` (degrees CCW from +x) */
  area?: SpellArea & { angle: number };
  /** Caster centre, or the point itself for spells without a caster */
  origin: SpellCastPoint;
  /** Template origin / summon spot */
  target: SpellCastPoint;
  durationMs: number;
  /** Local `performance.now()` on the receiving client, never a remote clock */
  startedAt: number;
}

/** Mutable offset (CSS px) the layer writes and Scene's render task applies to the camera */
export interface CameraShake {
  x: number;
  y: number;
}

export interface SpellCastLayerExports {
  /** Links the programs of the given archetypes (all by default) so a cast never links one mid-animation */
  prewarm(fxs?: SpellCastFx[]): void;
}

/** What the stage's `spells.prewarm` links: cast archetypes and token effect kinds, loading their layers first */
export interface SpellPrewarmExports {
  prewarm(fxs?: SpellCastFx[], tokenFxs?: TokenEffectKind[]): void;
}
