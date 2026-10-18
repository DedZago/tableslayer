import type { AoeTemplateRow } from '$lib/realtime/types';
import type { AoeTemplate } from '@tableslayer/stage';

export const aoeRowFromTemplate = (sceneId: string, template: AoeTemplate): AoeTemplateRow => ({
  id: template.id,
  sceneId,
  shape: template.shape as AoeTemplateRow['shape'],
  positionX: template.position.x,
  positionY: template.position.y,
  angle: template.angle,
  size: template.size,
  width: template.width,
  effect: template.effect,
  color: template.color,
  opacity: template.opacity,
  visibility: template.visibility,
  label: template.label ?? null,
  anchorMarkerId: null,
  createdAt: Math.floor(Date.now() / 1000)
});

export const aoeFieldsFromPatch = (patch: Partial<Omit<AoeTemplate, 'id'>>): Partial<AoeTemplateRow> => {
  const { position, shape, ...rest } = patch;
  return {
    ...rest,
    ...(position && { positionX: position.x, positionY: position.y }),
    ...(shape && { shape: shape as AoeTemplateRow['shape'] })
  };
};
