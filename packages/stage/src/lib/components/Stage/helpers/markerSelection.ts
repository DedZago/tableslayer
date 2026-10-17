export type ScreenMarker = {
  id: string;
  position: { x: number; y: number };
  radius: number;
};

export const hitTestMarkers = (markers: ScreenMarker[], point: { x: number; y: number }): string | null => {
  let closest: string | null = null;
  let distance = Infinity;
  for (const marker of markers) {
    const nextDistance = Math.hypot(marker.position.x - point.x, marker.position.y - point.y);
    if (nextDistance <= marker.radius && nextDistance < distance) {
      closest = marker.id;
      distance = nextDistance;
    }
  }
  return closest;
};

export const markersInRectangle = (
  markers: ScreenMarker[],
  start: { x: number; y: number },
  end: { x: number; y: number }
): string[] =>
  markers
    .filter(
      ({ position }) =>
        position.x >= Math.min(start.x, end.x) &&
        position.x <= Math.max(start.x, end.x) &&
        position.y >= Math.min(start.y, end.y) &&
        position.y <= Math.max(start.y, end.y)
    )
    .map(({ id }) => id);
