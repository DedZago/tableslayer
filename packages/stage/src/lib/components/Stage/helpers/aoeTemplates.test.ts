import { describe, expect, it } from 'vitest';
import { AoeEffect, AoeShape, type AoeTemplate } from '../components/AoeTemplateLayer/types';
import { StageMode } from '../components/Stage/types';
import {
  angleFromCursor,
  formatTemplateLabel,
  getTemplateLocalBounds,
  getTemplateOutline,
  normalizeTemplateAngle,
  rotateTemplateAngle,
  sizeFromCursor,
  templateLocalToLayer,
  templateSdf,
  templateSeed,
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
