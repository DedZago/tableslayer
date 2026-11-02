import { describe, expect, it } from 'vitest';
import { AoeEffect, AoeShape, type AoeTemplate } from '../components/AoeTemplateLayer/types';
import { MarkerVisibility } from '../components/MarkerLayer/types';
import { StageMode } from '../components/Stage/types';
import {
  AREA_OVERLAP_TOLERANCE_FT,
  isSpellTargetInRange,
  markersInSpellArea,
  sameMarkerIds,
  spellTargetAt,
  spellTargetRingRadiusPx
} from './spellTargets';

// 100 px per cell, 5 ft per cell: 20 px per foot
const scale = { cellPx: 100, ftPerPx: 1 / 20, mode: StageMode.Player };

const marker = (id: string, x: number, y: number, overrides: { size?: number; visibility?: number } = {}) => ({
  id,
  position: { x, y },
  size: overrides.size ?? 1,
  visibility: overrides.visibility ?? MarkerVisibility.Always
});

const aim = { caster: { x: 0, y: 0 }, casterSizeCells: 1, rangeFt: 30 };

describe('spellTargetAt', () => {
  it('finds the token under the pointer', () => {
    const markers = [marker('a', 0, 0), marker('b', 200, 0)];
    expect(spellTargetAt(aim, { x: 205, y: 4 }, markers, scale)).toBe('b');
  });

  it('is null over empty map', () => {
    expect(spellTargetAt(aim, { x: 100, y: 300 }, [marker('a', 0, 0)], scale)).toBeNull();
  });

  it('prefers the nearest of two overlapping tokens', () => {
    const markers = [marker('a', 200, 0, { size: 3 }), marker('b', 230, 0)];
    expect(spellTargetAt(aim, { x: 235, y: 0 }, markers, scale)).toBe('b');
  });

  it('ignores tokens out of range and tokens hidden from the viewer', () => {
    const far = marker('far', 1000, 0);
    expect(spellTargetAt(aim, { x: 1000, y: 0 }, [far], scale)).toBeNull();
    const dmOnly = marker('gm', 200, 0, { visibility: MarkerVisibility.DM });
    expect(spellTargetAt(aim, { x: 200, y: 0 }, [dmOnly], scale)).toBeNull();
    expect(spellTargetAt(aim, { x: 200, y: 0 }, [dmOnly], { ...scale, mode: StageMode.DM })).toBe('gm');
  });

  it('reaches everywhere without a caster or a range', () => {
    const far = marker('far', 5000, 0);
    expect(spellTargetAt({}, { x: 5000, y: 0 }, [far], scale)).toBe('far');
    expect(spellTargetAt({ caster: { x: 0, y: 0 } }, { x: 5000, y: 0 }, [far], scale)).toBe('far');
  });
});

describe('isSpellTargetInRange', () => {
  const touch = { caster: { x: 0, y: 0 }, casterSizeCells: 1, rangeFt: 5 };

  it('measures from edge to edge, so a touch spell reaches the adjacent square', () => {
    expect(isSpellTargetInRange(touch, marker('adjacent', 100, 0), 100, 1 / 20)).toBe(true);
    expect(isSpellTargetInRange(touch, marker('gap', 200, 0), 100, 1 / 20)).toBe(true);
    expect(isSpellTargetInRange(touch, marker('far', 300, 0), 100, 1 / 20)).toBe(false);
  });

  it('lets the caster target itself', () => {
    expect(isSpellTargetInRange(touch, marker('self', 0, 0), 100, 1 / 20)).toBe(true);
  });
});

describe('spellTargetRingRadiusPx', () => {
  it('is the range from the caster edge, or nothing without a caster or range', () => {
    expect(spellTargetRingRadiusPx(aim, 100, 1 / 20)).toBeCloseTo(30 * 20 + 45);
    expect(spellTargetRingRadiusPx({ rangeFt: 30 }, 100, 1 / 20)).toBe(0);
    expect(spellTargetRingRadiusPx({ caster: { x: 0, y: 0 } }, 100, 1 / 20)).toBe(0);
  });
});

describe('markersInSpellArea', () => {
  const area = (overrides: Partial<AoeTemplate>): AoeTemplate => ({
    id: 'draft',
    shape: AoeShape.Circle,
    position: { x: 0, y: 0 },
    angle: 0,
    size: 10,
    width: 5,
    effect: AoeEffect.None,
    color: '#fff',
    opacity: 0.5,
    visibility: StageMode.Player,
    ...overrides
  });

  it('counts a token whose circle is well inside, and one that only partly overlaps', () => {
    const markers = [marker('inside', 0, 0), marker('partial', 230, 0)];
    expect(markersInSpellArea(area({}), markers, scale)).toEqual(['inside', 'partial']);
  });

  it('leaves out a token that only grazes the edge, and one outside', () => {
    expect(AREA_OVERLAP_TOLERANCE_FT).toBe(0.5);
    // Radius 2.25 ft: the centre at 12 ft overlaps by 0.25 ft, at 12.25 ft it just touches
    const markers = [marker('shallow', 240, 0), marker('hairline', 245, 0), marker('outside', 1000, 0)];
    expect(markersInSpellArea(area({}), markers, scale)).toEqual([]);
  });

  it('follows a rotated cube', () => {
    // A 20 ft cube turned to point down the layer's y axis: x within 10 ft, y from 0 to 20 ft
    const cube = area({ shape: AoeShape.Square, size: 20, angle: 90 });
    const markers = [
      marker('in', 0, 200),
      marker('graze', 0, -30),
      marker('behind', 0, -60),
      marker('beside', 300, 200)
    ];
    expect(markersInSpellArea(cube, markers, scale)).toEqual(['in', 'graze']);
  });

  it('follows a cone from its apex', () => {
    const cone = area({ shape: AoeShape.Cone, size: 30 });
    const markers = [marker('axis', 400, 0), marker('wide', 400, 380), marker('beyond', 800, 0)];
    expect(markersInSpellArea(cone, markers, scale)).toEqual(['axis']);
  });

  it('counts a sphere around its centre', () => {
    const sphere = area({ size: 20 });
    const markers = [marker('near', 100, 100), marker('edge', 0, 380), marker('out', 0, 500)];
    expect(markersInSpellArea(sphere, markers, scale)).toEqual(['near', 'edge']);
  });

  it('only counts tokens the viewer can see', () => {
    const gm = marker('gm', 0, 0, { visibility: MarkerVisibility.DM });
    expect(markersInSpellArea(area({}), [gm], scale)).toEqual([]);
    expect(markersInSpellArea(area({}), [gm], { ...scale, mode: StageMode.DM })).toEqual(['gm']);
  });

  it('measures a large token by its own circle', () => {
    // Radius 6.75 ft: a centre 16 ft out overlaps by 0.75 ft, 16.5 ft by 0.25 ft
    const markers = [marker('overlap', 320, 0, { size: 3 }), marker('graze', 330, 0, { size: 3 })];
    expect(markersInSpellArea(area({}), markers, scale)).toEqual(['overlap']);
  });

  it('is empty without tokens', () => {
    expect(markersInSpellArea(area({}), [], scale)).toEqual([]);
  });
});

describe('sameMarkerIds', () => {
  it('compares ids in order', () => {
    expect(sameMarkerIds(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameMarkerIds(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameMarkerIds(['a'], ['a', 'b'])).toBe(false);
    expect(sameMarkerIds([], [])).toBe(true);
  });
});
