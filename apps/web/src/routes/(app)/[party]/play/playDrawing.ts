import type { AnnotationRow } from '$lib/realtime';
import { AnnotationEffect, annotationEffectDefinition, StageMode } from '@tableslayer/stage';

/** What the TV draw tool paints with */
export type DrawBrush =
  { kind: 'color'; color: string } | { kind: 'effect'; effect: AnnotationEffect } | { kind: 'erase' };

/** The editor palette's colors, so TV and GM drawings match */
export const DRAW_COLORS = [
  { id: 'red', label: 'Red', color: '#d73e2e' },
  { id: 'orange', label: 'Orange', color: '#ffa500' },
  { id: 'yellow', label: 'Yellow', color: '#ffd93d' },
  { id: 'green', label: 'Green', color: '#6bcf7f' },
  { id: 'blue', label: 'Blue', color: '#2e86ab' },
  { id: 'purple', label: 'Purple', color: '#b197fc' },
  { id: 'white', label: 'White', color: '#ffffff' },
  { id: 'dark', label: 'Dark', color: '#2a2a2a' }
];

/** Brush sizes in grid squares, the editor's steps */
export const DRAW_BRUSH_SIZES = [0.25, 0.5, 0.75, 1, 2, 3, 4, 5];

export const brushLabel = (brush: DrawBrush): string => {
  if (brush.kind === 'erase') return 'Eraser';
  if (brush.kind === 'effect') return annotationEffectDefinition(brush.effect)?.label ?? 'Effect';
  const color = brush.color.toLowerCase();
  return DRAW_COLORS.find((entry) => entry.color === color)?.label ?? 'Color';
};

/** Player drawings the TV can see: the only layers its eraser and Clear drawings touch */
export const playerDrawings = (annotations: AnnotationRow[]): AnnotationRow[] =>
  annotations.filter((annotation) => annotation.playerDrawn && annotation.visibility === StageMode.Player);

/** The scene's player layer for a brush, reused so each color or effect stays one layer for the GM */
export const playerLayerFor = (annotations: AnnotationRow[], brush: DrawBrush): AnnotationRow | undefined => {
  if (brush.kind === 'erase') return undefined;
  return playerDrawings(annotations).find((annotation) =>
    brush.kind === 'effect'
      ? annotation.effectType === brush.effect
      : !annotation.effectType && annotation.color.toLowerCase() === brush.color.toLowerCase()
  );
};

/** A new player layer for a brush, on top of every other layer */
export const newPlayerLayer = (
  id: string,
  sceneId: string,
  annotations: AnnotationRow[],
  brush: Exclude<DrawBrush, { kind: 'erase' }>
): AnnotationRow => {
  const effect = brush.kind === 'effect' ? annotationEffectDefinition(brush.effect) : undefined;
  return {
    id,
    sceneId,
    name: `${effect ? 'Player effect' : 'Player drawing'} · ${brushLabel(brush)}`,
    opacity: 1,
    color: brush.kind === 'effect' ? (effect?.color ?? '#ffffff') : brush.color,
    url: null,
    visibility: StageMode.Player,
    order: Math.min(1, ...annotations.map((annotation) => annotation.order)) - 1,
    effectType: brush.kind === 'effect' ? brush.effect : null,
    playerDrawn: true
  };
};
