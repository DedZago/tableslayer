import type { AoeTemplate } from '../components/AoeTemplateLayer/types';
import { templateContainsPoint, type TemplatePoint } from './aoeTemplates';

// A press on a placed spell area becomes a drag only after this far, like a token press
export const AREA_DRAG_SLOP_MOUSE_PX = 3;
export const AREA_DRAG_SLOP_TOUCH_PX = 8;

/** Whether a press on a placed area has travelled far enough to drag it */
export const isPlacedAreaDrag = (from: TemplatePoint, to: TemplatePoint, isTouch: boolean): boolean =>
  Math.hypot(to.x - from.x, to.y - from.y) >= (isTouch ? AREA_DRAG_SLOP_TOUCH_PX : AREA_DRAG_SLOP_MOUSE_PX);

/**
 * What a press on a placed (not yet cast) spell area does when it is released: a drag already moved the area,
 * a click inside casts it, a click outside moves (point aim) or re-aims (direction aim) it there.
 */
export const placedAreaRelease = (
  placed: AoeTemplate,
  press: TemplatePoint,
  { dragged, ftPerPx }: { dragged: boolean; ftPerPx: number }
): 'none' | 'cast' | 'move' => {
  if (dragged) return 'none';
  return templateContainsPoint(placed, press, ftPerPx) ? 'cast' : 'move';
};
