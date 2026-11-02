import type { SessionDocClient } from '$lib/realtime';
import type { AoeTemplateRow } from '$lib/realtime/types';
import { anchoredTemplateMoves, type AnchorMarker, type AoeTemplate } from '@tableslayer/stage';

const msToUnixSeconds = (ms: number | null | undefined) => (ms ? Math.floor(ms / 1000) : null);

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
  anchorMarkerId: template.anchorMarkerId ?? null,
  expiresAt: msToUnixSeconds(template.expiresAt),
  createdAt: Math.floor(Date.now() / 1000)
});

export const aoeFieldsFromPatch = (patch: Partial<Omit<AoeTemplate, 'id'>>): Partial<AoeTemplateRow> => {
  const { position, shape, expiresAt, ...rest } = patch;
  return {
    ...rest,
    ...(expiresAt !== undefined && { expiresAt: msToUnixSeconds(expiresAt) }),
    ...(position && { positionX: position.x, positionY: position.y }),
    ...(shape && { shape: shape as AoeTemplateRow['shape'] })
  };
};

/**
 * Persists where the templates anchored to just-moved tokens ended up. Written detached so a
 * group shared with the token is not shifted a second time; display always follows the live token.
 */
export const writeAnchoredTemplateMoves = (
  client: SessionDocClient,
  sceneId: string,
  templates: ReadonlyArray<Pick<AoeTemplate, 'id' | 'anchorMarkerId' | 'position'>>,
  markers: readonly AnchorMarker[],
  movedMarkerIds: readonly string[]
) => {
  const moves = anchoredTemplateMoves(templates, markers, movedMarkerIds);
  if (moves.length === 0) return;
  client.write.transaction(() => {
    for (const { id, position } of moves) {
      client.write.setAoeTemplateFields(sceneId, id, aoeFieldsFromPatch({ position }), { detached: true });
    }
  });
};
