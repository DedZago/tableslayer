import { describe, expect, it } from 'vitest';
import { AoeEffect, AoeShape, type AoeTemplate } from '../components/AoeTemplateLayer/types';
import { StageMode } from '../components/Stage/types';
import { AREA_DRAG_SLOP_MOUSE_PX, AREA_DRAG_SLOP_TOUCH_PX, isPlacedAreaDrag, placedAreaRelease } from './spellAim';

const fireball: AoeTemplate = {
  id: 'draft',
  shape: AoeShape.Circle,
  position: { x: 100, y: 100 },
  angle: 0,
  size: 20,
  width: 5,
  effect: AoeEffect.Fire,
  color: '#ff6a1a',
  opacity: 0.6,
  visibility: StageMode.Player,
  spellId: 'fireball'
};
const ftPerPx = 0.1;

describe('placedAreaRelease', () => {
  it('casts on a click inside the placed area', () => {
    expect(placedAreaRelease(fireball, { x: 150, y: 120 }, { dragged: false, ftPerPx })).toBe('cast');
  });

  it('moves the area on a click outside it', () => {
    expect(placedAreaRelease(fireball, { x: 400, y: 100 }, { dragged: false, ftPerPx })).toBe('move');
  });

  it('does nothing more once the press dragged the area', () => {
    expect(placedAreaRelease(fireball, { x: 150, y: 120 }, { dragged: true, ftPerPx })).toBe('none');
    expect(placedAreaRelease(fireball, { x: 400, y: 100 }, { dragged: true, ftPerPx })).toBe('none');
  });

  it('tests a cone in its own frame', () => {
    const cone = { ...fireball, shape: AoeShape.Cone, size: 15, angle: 90 };
    expect(placedAreaRelease(cone, { x: 100, y: 200 }, { dragged: false, ftPerPx })).toBe('cast');
    expect(placedAreaRelease(cone, { x: 100, y: 0 }, { dragged: false, ftPerPx })).toBe('move');
  });
});

describe('isPlacedAreaDrag', () => {
  it('needs a longer travel for a finger than for a mouse', () => {
    const from = { x: 0, y: 0 };
    expect(isPlacedAreaDrag(from, { x: AREA_DRAG_SLOP_MOUSE_PX, y: 0 }, false)).toBe(true);
    expect(isPlacedAreaDrag(from, { x: AREA_DRAG_SLOP_MOUSE_PX, y: 0 }, true)).toBe(false);
    expect(isPlacedAreaDrag(from, { x: 0, y: AREA_DRAG_SLOP_TOUCH_PX }, true)).toBe(true);
  });
});
