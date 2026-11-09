export interface AirTargetSizeInput {
  mapWidth: number;
  mapHeight: number;
  /** Display px per map px */
  screenScale: number;
  pixelRatio: number;
  bufferWidth: number;
  bufferHeight: number;
  /** Tier knob `weatherResolutionScale` */
  resolutionScale: number;
}

const MIN_TARGET_HEIGHT = 32;
const SIZE_STEPS_PER_OCTAVE = 4;

/**
 * Pixel size of the air target: the map's on-screen footprint clamped to the drawing buffer, scaled by the
 * tier. The height snaps up to a geometric step (about 19 % apart) so a zoom gesture does not reallocate the
 * target every frame, and the width follows the map aspect.
 */
export const airTargetSize = ({
  mapWidth,
  mapHeight,
  screenScale,
  pixelRatio,
  bufferWidth,
  bufferHeight,
  resolutionScale
}: AirTargetSizeInput) => {
  const footprintWidth = Math.max(1, mapWidth * screenScale * pixelRatio);
  const footprintHeight = Math.max(1, mapHeight * screenScale * pixelRatio);
  const fit = Math.min(1, bufferWidth / footprintWidth, bufferHeight / footprintHeight);
  const wanted = Math.max(MIN_TARGET_HEIGHT, footprintHeight * fit * resolutionScale);
  const height = Math.round(2 ** (Math.ceil(Math.log2(wanted) * SIZE_STEPS_PER_OCTAVE) / SIZE_STEPS_PER_OCTAVE));
  const width = Math.max(MIN_TARGET_HEIGHT, Math.round((height * mapWidth) / Math.max(1, mapHeight)));
  return { width, height };
};
