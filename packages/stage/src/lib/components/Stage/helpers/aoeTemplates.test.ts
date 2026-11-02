import { describe, expect, it } from 'vitest';
import { AoeEffect, AoeShape, type AoeTemplate, type SpellAimSettings } from '../components/AoeTemplateLayer/types';
import { StageMode } from '../components/Stage/types';
import {
  EXPIRY_FADE_MS,
  anchoredTemplateMoves,
  angleFromCursor,
  formatTemplateLabel,
  getTemplateLocalBounds,
  getTemplateOutline,
  isTemplateAnchored,
  isTemplateExpired,
  nextTemplateInStack,
  normalizeTemplateAngle,
  rotateTemplateAngle,
  sizeFromCursor,
  spellAimDraft,
  spellAimPlacement,
  spellRangeRadiusPx,
  templateExpiryFade,
  templateFadeMs,
  templateIntersectsRect,
  templateLocalToLayer,
  templateSdf,
  templateSeed,
  withAnchoredPosition,
  worldToTemplateLocal
} from './aoeTemplates';

const makeTemplate = (overrides: Partial<AoeTemplate> = {}): AoeTemplate => ({
  id: 't1',
  shape: AoeShape.Circle,
  position: { x: 0, y: 0 },
  angle: 0,
  size: 20,
  width: 5,
  effect: AoeEffect.Fire,
  color: '#ff0000',
  opacity: 1,
  visibility: StageMode.Player,
  ...overrides
});

describe('getTemplateLocalBounds', () => {
  it('pads a circle by the feather on every side', () => {
    expect(getTemplateLocalBounds(makeTemplate(), 2)).toEqual({ minX: -22, maxX: 22, minY: -22, maxY: 22 });
  });

  it('spans a square from its face midpoint along +x', () => {
    expect(getTemplateLocalBounds(makeTemplate({ shape: AoeShape.Square, size: 10 }), 1)).toEqual({
      minX: -1,
      maxX: 11,
      minY: -6,
      maxY: 6
    });
  });

  it('uses the line width for a line and half the length for a cone', () => {
    expect(getTemplateLocalBounds(makeTemplate({ shape: AoeShape.Line, size: 30, width: 5 }), 1)).toEqual({
      minX: -1,
      maxX: 31,
      minY: -3.5,
      maxY: 3.5
    });
    expect(getTemplateLocalBounds(makeTemplate({ shape: AoeShape.Cone, size: 15 }), 1)).toEqual({
      minX: -1,
      maxX: 16,
      minY: -8.5,
      maxY: 8.5
    });
  });
});

describe('templateSdf', () => {
  it('is negative inside and positive outside a circle', () => {
    const circle = makeTemplate({ size: 20 });
    expect(templateSdf(circle, { x: 0, y: 0 })).toBe(-20);
    expect(templateSdf(circle, { x: 25, y: 0 })).toBe(5);
  });

  it('measures the square and line from their centre lines', () => {
    const square = makeTemplate({ shape: AoeShape.Square, size: 10 });
    expect(templateSdf(square, { x: 5, y: 0 })).toBeCloseTo(-5);
    expect(templateSdf(square, { x: 12, y: 0 })).toBeCloseTo(2);

    const line = makeTemplate({ shape: AoeShape.Line, size: 30, width: 4 });
    expect(templateSdf(line, { x: 15, y: 0 })).toBeCloseTo(-2);
    expect(templateSdf(line, { x: 15, y: 5 })).toBeCloseTo(3);
  });

  it('matches the 53.13 degree cone edge', () => {
    const cone = makeTemplate({ shape: AoeShape.Cone, size: 10 });
    expect(templateSdf(cone, { x: 5, y: 0 })).toBeCloseTo(-Math.sqrt(5), 6);
    expect(templateSdf(cone, { x: 5, y: 10 })).toBeCloseTo(Math.hypot(5 - 8, 10 - 4), 6);
    expect(templateSdf(cone, { x: -3, y: 0 })).toBeGreaterThan(0);
  });
});

describe('worldToTemplateLocal and templateLocalToLayer', () => {
  it('round-trips a point through a rotated, offset template', () => {
    const template = makeTemplate({ position: { x: 100, y: -40 }, angle: 90 });
    const ftPerPx = 0.5;
    const local = worldToTemplateLocal(template, { x: 100, y: 20 }, ftPerPx);
    expect(local.x).toBeCloseTo(30);
    expect(local.y).toBeCloseTo(0);

    const back = templateLocalToLayer(template, local, ftPerPx);
    expect(back.x).toBeCloseTo(100);
    expect(back.y).toBeCloseTo(20);
  });
});

describe('sizeFromCursor', () => {
  it('uses euclidean distance for circles and rounds to 5 ft', () => {
    expect(sizeFromCursor(AoeShape.Circle, { x: 0, y: 0 }, { x: 30, y: 40 }, 1, 0, true)).toBe(50);
  });

  it('projects onto the direction for cones', () => {
    expect(sizeFromCursor(AoeShape.Cone, { x: 0, y: 0 }, { x: 19, y: 100 }, 1, 0, true)).toBe(20);
  });

  it('keeps the raw distance when snapping is off, with a 5 ft minimum', () => {
    expect(sizeFromCursor(AoeShape.Line, { x: 0, y: 0 }, { x: 13, y: 0 }, 1, 0, false)).toBe(13);
    expect(sizeFromCursor(AoeShape.Line, { x: 0, y: 0 }, { x: 1, y: 0 }, 1, 0, true)).toBe(5);
    expect(sizeFromCursor(AoeShape.Line, { x: 0, y: 0 }, { x: -50, y: 0 }, 1, 0, true)).toBe(5);
  });
});

describe('angleFromCursor', () => {
  const origin = { x: 0, y: 0 };

  it('snaps cones and lines to 45 degrees when asked', () => {
    expect(angleFromCursor(origin, { x: 10, y: 9 }, AoeShape.Cone, true)).toBe(45);
    expect(angleFromCursor(origin, { x: 10, y: 9 }, AoeShape.Line, false)).toBeCloseTo(42, 0);
  });

  it('returns CCW degrees in [0, 360)', () => {
    expect(angleFromCursor(origin, { x: 0, y: -10 }, AoeShape.Line, false)).toBeCloseTo(270);
  });

  it('snaps squares to 90 degrees only when asked', () => {
    expect(angleFromCursor(origin, { x: 10, y: 3 }, AoeShape.Square, true)).toBe(0);
    expect(angleFromCursor(origin, { x: 3, y: 10 }, AoeShape.Square, true)).toBe(90);
    expect(angleFromCursor(origin, { x: 10, y: 3 }, AoeShape.Square, false)).toBeCloseTo(16.7, 1);
  });
});

describe('getTemplateOutline', () => {
  it('returns the cone and line corners in local feet', () => {
    expect(getTemplateOutline(makeTemplate({ shape: AoeShape.Cone, size: 10 }))).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: -5 },
      { x: 10, y: 5 }
    ]);
  });

  it('samples the circle outline on its radius', () => {
    const points = getTemplateOutline(makeTemplate({ size: 20 }));
    expect(points).toHaveLength(48);
    points.forEach((p) => expect(Math.hypot(p.x, p.y)).toBeCloseTo(20));
  });
});

describe('spell area labels', () => {
  it('never carries dimensions for a spell area, even while sizing it', () => {
    const spell = makeTemplate({ size: 20, label: 'Fireball', spellId: 'fireball' });
    expect(formatTemplateLabel(spell)).toBe('Fireball');
    expect(formatTemplateLabel(spell, true)).toBe('Fireball');
    expect(formatTemplateLabel(makeTemplate({ spellId: 'web' }), true)).toBe('');
  });

  it('marks the aim draft with its spell', () => {
    const draft = spellAimDraft(
      {
        spellId: 'moonbeam',
        label: 'Moonbeam',
        area: { shape: AoeShape.Circle, size: 5 },
        effect: AoeEffect.Moonbeam,
        color: '#fff',
        aim: 'point'
      },
      { position: { x: 0, y: 0 }, angle: 0 },
      { id: 'd', opacity: 0.6, visibility: StageMode.Player }
    );
    expect(draft.spellId).toBe('moonbeam');
  });
});

describe('formatTemplateLabel', () => {
  it('omits dimensions on request', () => {
    expect(formatTemplateLabel(makeTemplate({ label: 'Fireball' }), false)).toBe('Fireball');
    expect(formatTemplateLabel(makeTemplate(), false)).toBe('');
  });

  it('describes each shape in feet', () => {
    expect(formatTemplateLabel(makeTemplate({ size: 20 }))).toBe('20 ft radius');
    expect(formatTemplateLabel(makeTemplate({ shape: AoeShape.Square, size: 10 }))).toBe('10 ft cube');
    expect(formatTemplateLabel(makeTemplate({ shape: AoeShape.Cone, size: 15 }))).toBe('15 ft cone');
    expect(formatTemplateLabel(makeTemplate({ shape: AoeShape.Line, size: 30, width: 5 }))).toBe('30 × 5 ft line');
  });

  it('prefixes the spell name when present', () => {
    expect(formatTemplateLabel(makeTemplate({ size: 20, label: ' Fireball ' }))).toBe('Fireball · 20 ft radius');
    expect(formatTemplateLabel(makeTemplate({ size: 20, label: '   ' }))).toBe('20 ft radius');
  });
});

describe('templateSeed', () => {
  it('is deterministic and within [0, 1)', () => {
    expect(templateSeed('abc')).toBe(templateSeed('abc'));
    const seed = templateSeed('8f1c2d3e-0000-4000-8000-000000000000');
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThan(1);
    expect(templateSeed('abc')).not.toBe(templateSeed('abd'));
  });
});

describe('normalizeTemplateAngle', () => {
  it('wraps into [0, 360)', () => {
    expect(normalizeTemplateAngle(AoeShape.Cone, -15)).toBe(345);
    expect(normalizeTemplateAngle(AoeShape.Line, 375)).toBe(15);
  });

  it('snaps squares to quarter turns', () => {
    expect(normalizeTemplateAngle(AoeShape.Square, 50)).toBe(90);
    expect(normalizeTemplateAngle(AoeShape.Square, -40)).toBe(0);
    expect(normalizeTemplateAngle(AoeShape.Square, 300)).toBe(270);
  });
});

describe('rotateTemplateAngle', () => {
  it('adds the delta for cones and lines', () => {
    expect(rotateTemplateAngle(AoeShape.Cone, 350, 15)).toBe(5);
    expect(rotateTemplateAngle(AoeShape.Line, 10, -45)).toBe(325);
  });

  it('turns squares a quarter in the delta direction', () => {
    expect(rotateTemplateAngle(AoeShape.Square, 0, 15)).toBe(90);
    expect(rotateTemplateAngle(AoeShape.Square, 0, -45)).toBe(270);
    expect(rotateTemplateAngle(AoeShape.Square, 15, 15)).toBe(90);
  });
});

describe('nextTemplateInStack', () => {
  it('starts at the topmost when nothing in the stack is selected', () => {
    expect(nextTemplateInStack(['a', 'b', 'c'], null)).toBe('a');
    expect(nextTemplateInStack(['a', 'b', 'c'], 'z')).toBe('a');
  });

  it('steps down the stack and wraps around', () => {
    expect(nextTemplateInStack(['a', 'b', 'c'], 'a')).toBe('b');
    expect(nextTemplateInStack(['a', 'b', 'c'], 'c')).toBe('a');
  });

  it('returns null for an empty stack', () => {
    expect(nextTemplateInStack([], 'a')).toBeNull();
  });
});

describe('templateIntersectsRect', () => {
  const circle = makeTemplate({ position: { x: 100, y: 100 }, size: 20 });

  it('matches a rectangle around the origin', () => {
    expect(templateIntersectsRect(circle, { x: 90, y: 90 }, { x: 110, y: 110 }, 0.1)).toBe(true);
  });

  it('matches a rectangle sitting entirely inside the shape', () => {
    expect(templateIntersectsRect(circle, { x: 101, y: 101 }, { x: 102, y: 102 }, 0.1)).toBe(true);
  });

  it('matches a rectangle that only clips the edge', () => {
    expect(templateIntersectsRect(circle, { x: 190, y: 90 }, { x: 400, y: 110 }, 0.1)).toBe(true);
  });

  it('misses a distant rectangle', () => {
    expect(templateIntersectsRect(circle, { x: 400, y: 400 }, { x: 500, y: 500 }, 0.1)).toBe(false);
  });
});

describe('anchored templates', () => {
  const markers = [
    { id: 'm1', position: { x: 40, y: -10 } },
    { id: 'm2', position: { x: 0, y: 0 } }
  ];

  it('follows the anchor marker position', () => {
    const template = makeTemplate({ anchorMarkerId: 'm1', position: { x: 5, y: 5 } });
    expect(isTemplateAnchored(template, markers)).toBe(true);
    expect(withAnchoredPosition(template, markers).position).toEqual({ x: 40, y: -10 });
  });

  it('keeps its stored position when the marker is gone or unset', () => {
    const missing = makeTemplate({ anchorMarkerId: 'gone', position: { x: 5, y: 5 } });
    expect(isTemplateAnchored(missing, markers)).toBe(false);
    expect(withAnchoredPosition(missing, markers)).toBe(missing);
    const free = makeTemplate({ position: { x: 5, y: 5 } });
    expect(withAnchoredPosition(free, markers)).toBe(free);
  });

  it('returns the same object when already at the marker', () => {
    const template = makeTemplate({ anchorMarkerId: 'm2', position: { x: 0, y: 0 } });
    expect(withAnchoredPosition(template, markers)).toBe(template);
  });

  it('reports stored positions to update for moved anchors only', () => {
    const templates = [
      makeTemplate({ id: 'a', anchorMarkerId: 'm1', position: { x: 0, y: 0 } }),
      makeTemplate({ id: 'b', anchorMarkerId: 'm2', position: { x: 9, y: 9 } }),
      makeTemplate({ id: 'c', position: { x: 1, y: 1 } })
    ];
    expect(anchoredTemplateMoves(templates, markers, ['m1'])).toEqual([{ id: 'a', position: { x: 40, y: -10 } }]);
    expect(anchoredTemplateMoves(templates, markers, [])).toEqual([]);
  });
});

describe('template expiry', () => {
  const expiresAt = 100_000;

  it('is fully visible until the final fade window', () => {
    expect(templateExpiryFade(null, 0)).toBe(1);
    expect(templateExpiryFade(undefined, 0)).toBe(1);
    expect(templateExpiryFade(expiresAt, expiresAt - EXPIRY_FADE_MS - 1)).toBe(1);
  });

  it('fades linearly over the last window and ends at zero', () => {
    expect(templateExpiryFade(expiresAt, expiresAt - EXPIRY_FADE_MS / 2)).toBeCloseTo(0.5);
    expect(templateExpiryFade(expiresAt, expiresAt)).toBe(0);
    expect(templateExpiryFade(expiresAt, expiresAt + 1000)).toBe(0);
  });

  it('is expired from the expiry instant on', () => {
    expect(isTemplateExpired(null, 5)).toBe(false);
    expect(isTemplateExpired(expiresAt, expiresAt - 1)).toBe(false);
    expect(isTemplateExpired(expiresAt, expiresAt)).toBe(true);
  });
});

describe('spell aiming', () => {
  const spell = (overrides: Partial<SpellAimSettings> = {}): SpellAimSettings => ({
    spellId: 'fireball',
    area: { shape: AoeShape.Circle, size: 20 },
    effect: AoeEffect.Fire,
    color: '#ff6a1a',
    aim: 'point',
    ...overrides
  });
  const pointer = { pointer: { x: 100, y: 50 }, ftPerPx: 0.1, cellPx: 50, snapAngle: true };

  it('places a point aim under the pointer', () => {
    expect(spellAimPlacement(spell(), pointer)).toEqual({ position: { x: 100, y: 50 }, angle: 0 });
  });

  it('centres a point-aimed cube on the pointer', () => {
    const cube = spell({ area: { shape: AoeShape.Square, size: 20 } });
    expect(spellAimPlacement(cube, pointer).position).toEqual({ x: 0, y: 50 });
  });

  it('keeps a fixed origin and takes only the angle from the pointer', () => {
    const cone = spell({ aim: 'direction', area: { shape: AoeShape.Cone, size: 15 }, origin: { x: 0, y: 50 } });
    expect(spellAimPlacement(cone, pointer)).toEqual({ position: { x: 0, y: 50 }, angle: 0 });
    expect(spellAimPlacement(cone, { ...pointer, pointer: { x: 0, y: 150 } }).angle).toBe(90);
  });

  it('pushes a fixed origin out to the caster edge along the angle', () => {
    const cone = spell({
      aim: 'direction',
      area: { shape: AoeShape.Cone, size: 15 },
      origin: { x: 0, y: 0 },
      originRadiusCells: 0.5
    });
    const { position, angle } = spellAimPlacement(cone, { ...pointer, pointer: { x: 0, y: 200 } });
    expect(angle).toBe(90);
    expect(position.x).toBeCloseTo(0);
    expect(position.y).toBeCloseTo(25);
  });

  it('starts a free direction aim at the first press and snaps its angle', () => {
    const line = spell({ aim: 'direction', area: { shape: AoeShape.Line, size: 100, width: 5 } });
    const placement = spellAimPlacement(line, { ...pointer, start: { x: 10, y: 10 }, pointer: { x: 110, y: 120 } });
    expect(placement.position).toEqual({ x: 10, y: 10 });
    expect(placement.angle).toBe(45);
    expect(spellAimPlacement(line, { ...pointer, snapAngle: false, start: { x: 10, y: 10 } }).angle).toBeCloseTo(
      (Math.atan2(40, 90) * 180) / Math.PI
    );
  });

  it('builds a draft with the preset shape, size and effect', () => {
    const line = spell({
      aim: 'direction',
      area: { shape: AoeShape.Line, size: 100, width: 5 },
      label: 'Lightning bolt'
    });
    const draft = spellAimDraft(
      line,
      { position: { x: 1, y: 2 }, angle: 90 },
      {
        id: 'draft',
        opacity: 0.6,
        visibility: StageMode.Player
      }
    );
    expect(draft).toMatchObject({
      id: 'draft',
      shape: AoeShape.Line,
      size: 100,
      width: 5,
      effect: AoeEffect.Fire,
      label: 'Lightning bolt',
      position: { x: 1, y: 2 },
      angle: 90
    });
    expect(spellAimDraft(spell(), { position: { x: 0, y: 0 }, angle: 0 }, draft).width).toBe(5);
  });

  it('sizes the range ring only for a caster with a range', () => {
    expect(spellRangeRadiusPx({ caster: { x: 0, y: 0 }, rangeFt: 150 }, 0.1)).toBe(1500);
    expect(spellRangeRadiusPx({ rangeFt: 150 }, 0.1)).toBe(0);
    expect(spellRangeRadiusPx({ caster: { x: 0, y: 0 }, rangeFt: 0 }, 0.1)).toBe(0);
  });
});

describe('per-template fade', () => {
  it('fades instant spells over their own 3 s and everything else over the default', () => {
    expect(templateFadeMs(makeTemplate({ spellId: 'fireball' }))).toBe(3000);
    expect(templateFadeMs(makeTemplate({ spellId: 'web' }))).toBe(EXPIRY_FADE_MS);
    expect(templateFadeMs(makeTemplate())).toBe(EXPIRY_FADE_MS);
  });

  it('holds full strength until the fade window opens', () => {
    const expiresAt = 100_000;
    expect(templateExpiryFade(expiresAt, expiresAt - 3001, 3000)).toBe(1);
    expect(templateExpiryFade(expiresAt, expiresAt - 1500, 3000)).toBeCloseTo(0.5);
    expect(templateExpiryFade(expiresAt, expiresAt, 3000)).toBe(0);
  });
});
