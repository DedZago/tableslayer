import type { MarkerConcentration } from '@tableslayer/stage';

/** Ids of the rows a scene holds, to test a concentration against */
export interface ExistingRows {
  templateIds: ReadonlySet<string>;
  markerIds: ReadonlySet<string>;
}

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

export const isMarkerConcentration = (value: unknown): value is MarkerConcentration =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as MarkerConcentration).spellId === 'string' &&
  typeof (value as MarkerConcentration).startedAt === 'number' &&
  isStringList((value as MarkerConcentration).templateIds) &&
  isStringList((value as MarkerConcentration).markerIds);

/** The concentration without the rows that are gone; null when the field is unset or nothing it lists remains */
export const liveConcentration = (
  concentration: MarkerConcentration | null | undefined,
  existing: ExistingRows
): MarkerConcentration | null => {
  if (!isMarkerConcentration(concentration)) return null;
  const templateIds = concentration.templateIds.filter((id) => existing.templateIds.has(id));
  const markerIds = concentration.markerIds.filter((id) => existing.markerIds.has(id));
  if (templateIds.length === 0 && markerIds.length === 0) return null;
  return { ...concentration, templateIds, markerIds };
};

/** Derived, so no write is needed when its last row is deleted */
export const isConcentrationActive = (concentration: MarkerConcentration | null | undefined, existing: ExistingRows) =>
  liveConcentration(concentration, existing) !== null;

export const sameConcentration = (
  a: MarkerConcentration | null | undefined,
  b: MarkerConcentration | null | undefined
) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** A concentration carried to rows that got new ids (import); null when nothing it listed was carried over */
export const remapConcentration = (
  concentration: unknown,
  templateIds: ReadonlyMap<string, string>,
  markerIds: ReadonlyMap<string, string>
): MarkerConcentration | null => {
  if (!isMarkerConcentration(concentration)) return null;
  const remapped = {
    ...concentration,
    templateIds: concentration.templateIds.flatMap((id) => templateIds.get(id) ?? []),
    markerIds: concentration.markerIds.flatMap((id) => markerIds.get(id) ?? [])
  };
  return remapped.templateIds.length === 0 && remapped.markerIds.length === 0 ? null : remapped;
};

/** What a focused concentration lights up on the stage */
export interface ConcentrationHighlight {
  templateIds: string[];
  markerIds: string[];
}

export const NO_CONCENTRATION_HIGHLIGHT: ConcentrationHighlight = { templateIds: [], markerIds: [] };

type HighlightSnapshot = {
  markers: ReadonlyArray<{ id: string; concentration?: MarkerConcentration | null }>;
  aoeTemplates: ReadonlyArray<{ id: string }>;
};

/**
 * Everything the active concentrations of `casterIds` hold: their areas and token effects that still exist, their
 * summons, and the casters themselves (for the seal). Casters that are not concentrating add nothing.
 */
export const concentrationHighlight = (
  snapshot: HighlightSnapshot | null | undefined,
  casterIds: readonly string[]
): ConcentrationHighlight => {
  if (!snapshot || casterIds.length === 0) return NO_CONCENTRATION_HIGHLIGHT;
  const existing = {
    templateIds: new Set(snapshot.aoeTemplates.map((row) => row.id)),
    markerIds: new Set(snapshot.markers.map((row) => row.id))
  };
  const templateIds = new Set<string>();
  const markerIds = new Set<string>();
  for (const casterId of casterIds) {
    const caster = snapshot.markers.find((marker) => marker.id === casterId);
    const live = liveConcentration(caster?.concentration, existing);
    if (!live) continue;
    live.templateIds.forEach((id) => templateIds.add(id));
    live.markerIds.forEach((id) => markerIds.add(id));
    markerIds.add(casterId);
  }
  if (markerIds.size === 0) return NO_CONCENTRATION_HIGHLIGHT;
  return { templateIds: [...templateIds], markerIds: [...markerIds] };
};

/**
 * The TV's focus after a tap: a concentrating token tapped becomes the focus, tapping the focused token again,
 * any other token, or empty map clears it
 */
export const nextConcentrationFocus = (
  focusedId: string | null,
  tappedId: string | null,
  isConcentrating: (markerId: string) => boolean
): string | null => {
  if (!tappedId || tappedId === focusedId) return null;
  return isConcentrating(tappedId) ? tappedId : null;
};
