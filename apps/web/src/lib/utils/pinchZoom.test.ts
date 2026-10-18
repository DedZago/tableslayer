import { describe, expect, it } from 'vitest';
import { applyPinchStep } from './pinchZoom';

const canvas = { width: 1000, height: 600 };
const centre = { x: 500, y: 300 };

describe('applyPinchStep', () => {
  it('zooms about the canvas centre without moving the view', () => {
    const next = applyPinchStep(
      { offset: { x: 0, y: 0 }, zoom: 1 },
      { scale: 2, centroid: centre, delta: { x: 0, y: 0 } },
      canvas
    );
    expect(next.zoom).toBe(2);
    expect(next.offset.x).toBeCloseTo(0);
    expect(next.offset.y).toBeCloseTo(0);
  });

  it('keeps the content under the fingers fixed on screen', () => {
    const view = { offset: { x: 40, y: -20 }, zoom: 1 };
    const centroid = { x: 800, y: 150 };
    const next = applyPinchStep(view, { scale: 1.5, centroid, delta: { x: 0, y: 0 } }, canvas);
    const anchor = { x: centroid.x - 500, y: -(centroid.y - 300) };
    const contentBefore = { x: (anchor.x - view.offset.x) / view.zoom, y: (anchor.y - view.offset.y) / view.zoom };
    const contentAfter = { x: (anchor.x - next.offset.x) / next.zoom, y: (anchor.y - next.offset.y) / next.zoom };
    expect(contentAfter.x).toBeCloseTo(contentBefore.x);
    expect(contentAfter.y).toBeCloseTo(contentBefore.y);
  });

  it('drags with the midpoint, y up', () => {
    const next = applyPinchStep(
      { offset: { x: 0, y: 0 }, zoom: 1 },
      { scale: 1, centroid: centre, delta: { x: 30, y: 10 } },
      canvas
    );
    expect(next.offset.x).toBeCloseTo(30);
    expect(next.offset.y).toBeCloseTo(-10);
  });

  it('turns the drag with the seating rotation', () => {
    const next = applyPinchStep(
      { offset: { x: 0, y: 0 }, zoom: 1 },
      { scale: 1, centroid: centre, delta: { x: 30, y: 0 } },
      canvas,
      180
    );
    expect(next.offset.x).toBeCloseTo(-30);
  });

  it('clamps the zoom range', () => {
    const zoomIn = applyPinchStep(
      { offset: { x: 0, y: 0 }, zoom: 9 },
      { scale: 5, centroid: centre, delta: { x: 0, y: 0 } },
      canvas
    );
    const zoomOut = applyPinchStep(
      { offset: { x: 0, y: 0 }, zoom: 0.2 },
      { scale: 0.1, centroid: centre, delta: { x: 0, y: 0 } },
      canvas
    );
    expect(zoomIn.zoom).toBe(10);
    expect(zoomOut.zoom).toBe(0.1);
  });
});
