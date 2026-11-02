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
