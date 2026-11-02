import { AoeShape } from '../components/AoeTemplateLayer/types';
import type { CameraShake, SpellCast, SpellCastPoint } from '../components/SpellCastLayer/types';
import type { PerformanceTier } from '../components/Stage/types';
import { templateSeed } from './aoeTemplates';
import type { SpellArea, SpellCastFx } from './spells';

export const MAX_CONCURRENT_SPELL_CASTS = 6;
/** A cast whose program is still linking waits this long past its duration before it is dropped unplayed */
export const SPELL_CAST_LINK_GRACE_MS = 4000;
export const SPELL_SHAKE_MAX_PX = 6;
export const SPELL_SHAKE_MS = 180;
/** Normalised time at which travel and charge end and the impact begins */
export const SPELL_IMPACT_START = 0.4;
const LOW_TIER_DURATION_SCALE = 0.6;
const BASE_AREA_FT = 5;
const MIN_PAD_FT = 8;

/** Index of each archetype: the value of the `SPELL_FX` shader define */
export const SPELL_FX_INDEX: Record<SpellCastFx, number> = {
  burst: 0,
  cone: 1,
  bolt: 2,
  wave: 3,
  zone: 4,
  aura: 5,
  summon: 6,
  rain: 7,
  beam: 8
};

export const SPELL_FX_LIST = Object.keys(SPELL_FX_INDEX) as SpellCastFx[];

const SHAKING_FX: ReadonlySet<SpellCastFx> = new Set(['burst', 'cone', 'bolt', 'wave', 'rain']);

export const spellCastArea = (cast: Pick<SpellCast, 'area'>): SpellArea & { angle: number } =>
  cast.area ?? { shape: AoeShape.Circle, size: BASE_AREA_FT, angle: 0 };

/** Milliseconds a cast plays for on a tier (low skips straight to the impact) */
export const spellCastPlayMs = (cast: Pick<SpellCast, 'durationMs'>, tier: PerformanceTier) =>
  tier === 'low' ? cast.durationMs * LOW_TIER_DURATION_SCALE : cast.durationMs;

/** Shader timeline position: 0..1, reaching 1 when the cast is over. Low tier starts at the impact */
export const spellCastProgress = (
  cast: Pick<SpellCast, 'startedAt' | 'durationMs'>,
  nowMs: number,
  tier: PerformanceTier
) => {
  const elapsed = Math.max(nowMs - cast.startedAt, 0);
  const fraction = elapsed / Math.max(cast.durationMs, 1);
  return tier === 'low' ? SPELL_IMPACT_START + fraction : fraction;
};

/**
 * Quad covering the cast in feet relative to `target` (layer axes): the area, the caster
 * and enough padding for shockwave rings and glows that overshoot the shape.
 */
export const getSpellCastBounds = (cast: Pick<SpellCast, 'area' | 'origin' | 'target'>, ftToPx: number) => {
  const area = spellCastArea(cast);
  const cos = Math.cos((area.angle * Math.PI) / 180);
  const sin = Math.sin((area.angle * Math.PI) / 180);
  const local: SpellCastPoint[] = [];
  const { size } = area;
  switch (area.shape) {
    case AoeShape.Circle:
      local.push({ x: -size, y: -size }, { x: size, y: size });
      break;
    case AoeShape.Line:
      local.push({ x: 0, y: -(area.width ?? BASE_AREA_FT) / 2 }, { x: size, y: (area.width ?? BASE_AREA_FT) / 2 });
      break;
    default:
      local.push({ x: 0, y: -size / 2 }, { x: size, y: size / 2 });
  }
  const corners = [
    { x: local[0].x, y: local[0].y },
    { x: local[1].x, y: local[0].y },
    { x: local[1].x, y: local[1].y },
    { x: local[0].x, y: local[1].y }
  ];
  const points = corners.map((corner) => ({ x: corner.x * cos - corner.y * sin, y: corner.x * sin + corner.y * cos }));
  points.push(
    { x: 0, y: 0 },
    { x: (cast.origin.x - cast.target.x) / ftToPx, y: (cast.origin.y - cast.target.y) / ftToPx }
  );

  const pad = Math.max(MIN_PAD_FT, size * 0.3);
  const minX = Math.min(...points.map((point) => point.x)) - pad;
  const maxX = Math.max(...points.map((point) => point.x)) + pad;
  const minY = Math.min(...points.map((point) => point.y)) - pad;
  const maxY = Math.max(...points.map((point) => point.y)) + pad;
  return { centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2, width: maxX - minX, height: maxY - minY };
};

/**
 * Writes the combined camera shake of every blast that is inside its impact window.
 * Allocation free; each cast shakes along its own phase so overlapping blasts do not cancel.
 */
export const writeSpellCastShake = (casts: readonly SpellCast[], nowMs: number, out: CameraShake) => {
  let x = 0;
  let y = 0;
  for (const cast of casts) {
    if (!SHAKING_FX.has(cast.fx)) continue;
    const sinceImpact = nowMs - cast.startedAt - cast.durationMs * SPELL_IMPACT_START;
    if (sinceImpact < 0 || sinceImpact > SPELL_SHAKE_MS) continue;
    const decay = 1 - sinceImpact / SPELL_SHAKE_MS;
    const amplitude = Math.min(SPELL_SHAKE_MAX_PX, 2 + spellCastArea(cast).size * 0.08) * decay * decay;
    const phase = templateSeed(cast.id) * 6.2831853;
    x += amplitude * Math.sin(sinceImpact * 0.11 + phase);
    y += amplitude * Math.cos(sinceImpact * 0.137 + phase * 1.7);
  }
  out.x = Math.max(-SPELL_SHAKE_MAX_PX, Math.min(SPELL_SHAKE_MAX_PX, x));
  out.y = Math.max(-SPELL_SHAKE_MAX_PX, Math.min(SPELL_SHAKE_MAX_PX, y));
};

/** A cast as it travels through awareness: no local clock, but the scene it was cast in */
export type BroadcastSpellCast = Omit<SpellCast, 'startedAt'> & { sceneId: string };

/**
 * Appends a remote client's cast to the local list when its id is new for that client and
 * it was cast in the scene being shown. `seen` (client id to last cast id) is updated in place.
 */
export const receiveSpellCast = (
  active: readonly SpellCast[],
  seen: Map<number, string>,
  clientId: number,
  broadcast: BroadcastSpellCast | null | undefined,
  sceneId: string | null | undefined,
  nowMs: number
): readonly SpellCast[] => {
  if (!broadcast) {
    seen.delete(clientId);
    return active;
  }
  if (seen.get(clientId) === broadcast.id) return active;
  seen.set(clientId, broadcast.id);
  if (!sceneId || broadcast.sceneId !== sceneId) return active;
  const { sceneId: _sceneId, ...cast } = broadcast;
  return [...active, { ...cast, startedAt: nowMs }].slice(-MAX_CONCURRENT_SPELL_CASTS);
};

/** Drops casts whose duration (plus the link grace) has passed; returns the same array when nothing expired */
export const pruneSpellCasts = (active: readonly SpellCast[], nowMs: number): readonly SpellCast[] => {
  const alive = active.filter((cast) => nowMs < cast.startedAt + cast.durationMs + SPELL_CAST_LINK_GRACE_MS);
  return alive.length === active.length ? active : alive;
};
