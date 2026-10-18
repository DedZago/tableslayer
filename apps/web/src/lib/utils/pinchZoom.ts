export interface PinchView {
  offset: { x: number; y: number };
  zoom: number;
}

export interface PinchStep {
  /** Finger distance now over finger distance at the previous step */
  scale: number;
  /** Midpoint between the fingers, in client pixels */
  centroid: { x: number; y: number };
  /** Midpoint movement since the previous step, in client pixels */
  delta: { x: number; y: number };
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;

// Screen pixels (y down) into the scene's frame (y up, turned by the seating rotation)
const toSceneFrame = (x: number, y: number, rotationDeg: number) => {
  const radians = (Math.PI / 180) * rotationDeg;
  return {
    x: x * Math.cos(radians) + y * Math.sin(radians),
    y: -1 * (-x * Math.sin(radians) + y * Math.cos(radians))
  };
};

/** Zooms about the pinch midpoint so the content under the fingers stays put, and follows the midpoint as it drags */
export const applyPinchStep = (
  view: PinchView,
  step: PinchStep,
  canvas: { width: number; height: number },
  rotationDeg = 0
): PinchView => {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * step.scale));
  const ratio = zoom / view.zoom;
  const anchor = toSceneFrame(step.centroid.x - canvas.width / 2, step.centroid.y - canvas.height / 2, rotationDeg);
  const drag = toSceneFrame(step.delta.x, step.delta.y, rotationDeg);

  return {
    zoom,
    offset: {
      x: anchor.x - (anchor.x - view.offset.x) * ratio + drag.x,
      y: anchor.y - (anchor.y - view.offset.y) * ratio + drag.y
    }
  };
};
