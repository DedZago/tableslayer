import type { SelectAnnotation, SelectAoeTemplate, SelectLight, SelectMarker, SelectScene } from '$lib/db/app/schema';
import type { AnnotationRow, AoeTemplateRow, LightRow, MarkerRow, SceneSettings } from './types';

// DB row -> doc row converters (app-side only; the PartyKit bundle never imports this).

export const sceneRowToSettings = (scene: SelectScene): SceneSettings => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { fogOfWarMask, annotationLayers, lastUpdated, ...settings } = scene;
  return settings;
};

export const markerRowFromDb = (marker: SelectMarker): MarkerRow => marker;
export const lightRowFromDb = (light: SelectLight): LightRow => light;
export const aoeTemplateRowFromDb = (template: SelectAoeTemplate): AoeTemplateRow => ({
  ...template,
  createdAt: Math.floor(template.createdAt.getTime() / 1000)
});
export const aoeTemplateRowToDb = (template: AoeTemplateRow): SelectAoeTemplate => ({
  ...template,
  createdAt: new Date(template.createdAt * 1000)
});
export const annotationRowFromDb = (annotation: SelectAnnotation): AnnotationRow => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { mask, ...row } = annotation;
  return row;
};
