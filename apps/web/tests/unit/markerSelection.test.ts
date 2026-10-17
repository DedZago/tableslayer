import { describe, expect, it } from 'vitest';
import {
  hitTestMarkers,
  markersInRectangle
} from '../../../../packages/stage/src/lib/components/Stage/helpers/markerSelection';

const markers = [
  { id: 'first', position: { x: 110, y: 220 }, radius: 30 },
  { id: 'second', position: { x: 145, y: 220 }, radius: 60 },
  { id: 'outside', position: { x: 180, y: 300 }, radius: 100 }
];

describe('token selection in viewport client coordinates', () => {
  it.each([
    [
      { x: 100, y: 200 },
      { x: 150, y: 240 }
    ],
    [
      { x: 150, y: 240 },
      { x: 100, y: 200 }
    ],
    [
      { x: 150, y: 200 },
      { x: 100, y: 240 }
    ],
    [
      { x: 100, y: 240 },
      { x: 150, y: 200 }
    ]
  ])('selects centers in any drag direction, excluding intersecting tokens whose centers are outside', (start, end) => {
    expect(markersInRectangle(markers, start, end)).toEqual(['first', 'second']);
  });

  it('includes centers on rectangle edges', () => {
    expect(markersInRectangle(markers, { x: 110, y: 220 }, { x: 145, y: 220 })).toEqual(['first', 'second']);
  });

  it('toggles the closest overlapping token rather than the first or largest token', () => {
    expect(hitTestMarkers(markers, { x: 140, y: 220 })).toBe('second');
    expect(hitTestMarkers(markers, { x: 115, y: 220 })).toBe('first');
  });

  it('uses each token radius and returns no hit for empty space or no selectable tokens', () => {
    expect(hitTestMarkers(markers.slice(0, 2), { x: 200, y: 220 })).toBe('second');
    expect(hitTestMarkers(markers, { x: 0, y: 0 })).toBeNull();
    expect(hitTestMarkers([], { x: 110, y: 220 })).toBeNull();
  });
});
