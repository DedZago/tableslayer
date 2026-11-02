/** Wraps an angle difference in degrees into (-180, 180] */
export const unwrapAngleDelta = (delta: number): number => {
  const wrapped = ((((delta + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
};

export const normalizeRotation = (rotation: number): number => ((rotation % 360) + 360) % 360;

const WHEEL_DEGREES_PER_PIXEL = 0.15;
const WHEEL_MAX_DEGREES = 15;
const WHEEL_LINE_PIXELS = 16;

/** Degrees of clockwise turn for one wheel event; scrolling down turns clockwise */
export const wheelRotationDegrees = (deltaY: number, deltaMode: number, pageHeight: number): number => {
  const pixels = deltaMode === 1 ? deltaY * WHEEL_LINE_PIXELS : deltaMode === 2 ? deltaY * pageHeight : deltaY;
  return Math.max(-WHEEL_MAX_DEGREES, Math.min(WHEEL_MAX_DEGREES, pixels * WHEEL_DEGREES_PER_PIXEL));
};
