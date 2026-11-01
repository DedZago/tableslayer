/** Wraps an angle difference in degrees into (-180, 180] */
export const unwrapAngleDelta = (delta: number): number => {
  const wrapped = ((((delta + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
};

export const normalizeRotation = (rotation: number): number => ((rotation % 360) + 360) % 360;
