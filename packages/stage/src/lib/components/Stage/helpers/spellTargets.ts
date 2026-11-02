import type { AoeTemplate, SpellAimSettings } from '../components/AoeTemplateLayer/types';
import { MarkerVisibility, type Marker } from '../components/MarkerLayer/types';
import { StageMode } from '../components/Stage/types';
import { getTemplateLocalBounds, templateSdf } from './aoeTemplates';

type TargetableMarker = Pick<Marker, 'id' | 'position' | 'size' | 'visibility'>;
type RangedAim = Pick<SpellAimSettings, 'caster' | 'casterSizeCells' | 'rangeFt'>;

// Markers are drawn at 90% of their grid footprint
const MARKER_FOOTPRINT = 0.9;
// A token counts as inside an area once its drawn circle reaches this far (feet) into it: a hairline touch does not
export const AREA_OVERLAP_TOLERANCE_FT = 0.5;
// A pointer or fingertip counts as on a token a little beyond its edge
const PICK_SLOP = 1.1;

const radiusPx = (sizeCells: number, cellPx: number) => (sizeCells * cellPx * MARKER_FOOTPRINT) / 2;

const isShownTo = (marker: Pick<Marker, 'visibility'>, mode: StageMode) =>
  marker.visibility === MarkerVisibility.Always ||
  (marker.visibility === MarkerVisibility.Player ? mode === StageMode.Player : mode === StageMode.DM);

/** Layer px: how far from the caster's centre the range ring sits (range is measured from the caster's edge) */
export const spellTargetRingRadiusPx = (aim: RangedAim, cellPx: number, ftPerPx: number) =>
  aim.caster && aim.rangeFt ? aim.rangeFt / ftPerPx + radiusPx(aim.casterSizeCells ?? 1, cellPx) : 0;

/** Whether the target's edge is within the spell's reach of the caster's edge; spells without a caster or range reach everywhere */
export const isSpellTargetInRange = (
  aim: RangedAim,
  target: TargetableMarker,
  cellPx: number,
  ftPerPx: number
): boolean => {
  if (!aim.caster || !aim.rangeFt) return true;
  const centres = Math.hypot(target.position.x - aim.caster.x, target.position.y - aim.caster.y);
  const edgeGap = centres - radiusPx(aim.casterSizeCells ?? 1, cellPx) - radiusPx(target.size, cellPx);
  return edgeGap <= aim.rangeFt / ftPerPx + 0.5 / ftPerPx;
};

/** The nearest token under the point that this viewer can see and the spell can reach; null when none */
export const spellTargetAt = (
  aim: RangedAim,
  point: { x: number; y: number },
  markers: readonly TargetableMarker[],
  { cellPx, ftPerPx, mode }: { cellPx: number; ftPerPx: number; mode: StageMode }
): string | null => {
  let best: { id: string; distance: number } | null = null;
  for (const marker of markers) {
    if (!isShownTo(marker, mode)) continue;
    const distance = Math.hypot(point.x - marker.position.x, point.y - marker.position.y);
    if (distance > radiusPx(marker.size, cellPx) * PICK_SLOP) continue;
    if (!isSpellTargetInRange(aim, marker, cellPx, ftPerPx)) continue;
    if (!best || distance < best.distance) best = { id: marker.id, distance };
  }
  return best?.id ?? null;
};

/** Whether two marker id lists hold the same ids in the same order (what `markersInSpellArea` returns for one marker list) */
export const sameMarkerIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);

/**
 * The ids, in marker order, of the tokens this viewer can see whose drawn circle overlaps the area by more than
 * AREA_OVERLAP_TOLERANCE_FT. One pass: a bounding-box test in the template's frame rejects most tokens before
 * the shape's distance function runs, and the loop allocates nothing but the result.
 */
export const markersInSpellArea = (
  template: AoeTemplate,
  markers: readonly TargetableMarker[],
  { cellPx, ftPerPx, mode }: { cellPx: number; ftPerPx: number; mode: StageMode }
): string[] => {
  const inside: string[] = [];
  const bounds = getTemplateLocalBounds(template, 0);
  const radians = (template.angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const local = { x: 0, y: 0 };
  for (const marker of markers) {
    if (!isShownTo(marker, mode)) continue;
    const dx = (marker.position.x - template.position.x) * ftPerPx;
    const dy = (marker.position.y - template.position.y) * ftPerPx;
    local.x = dx * cos + dy * sin;
    local.y = -dx * sin + dy * cos;
    const radiusFt = radiusPx(marker.size, cellPx) * ftPerPx;
    if (
      local.x < bounds.minX - radiusFt ||
      local.x > bounds.maxX + radiusFt ||
      local.y < bounds.minY - radiusFt ||
      local.y > bounds.maxY + radiusFt
    ) {
      continue;
    }
    if (templateSdf(template, local) < radiusFt - AREA_OVERLAP_TOLERANCE_FT) inside.push(marker.id);
  }
  return inside;
};
