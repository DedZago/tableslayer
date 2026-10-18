import { handleMutation } from '$lib/factories';
import type { MarkerRow, SceneSettings, SessionDocClient } from '$lib/realtime';
import { MarkerVisibility } from '@tableslayer/stage';

export const ASSET_DRAG_TYPE = 'application/x-tableslayer-asset';
export const MAX_PLACEMENT_QUANTITY = 20;

export type PlacementPoint = { x: number; y: number };
type PlaceAction = { action: 'place'; id: string; sceneId: string; quantity: number; x: number; y: number };
type PlaceResult = { markers?: MarkerRow[] };

export type PlaceAssetOptions = {
  assetId: string;
  quantity: number;
  at: PlacementPoint;
  sceneId: string;
  client: SessionDocClient | null;
  mutate: (action: PlaceAction) => Promise<PlaceResult | undefined>;
  snap?: (point: PlacementPoint) => PlacementPoint;
  visibility?: MarkerVisibility;
  onLoadingChange?: (loading: boolean) => void;
};

export const markerAssetSnapshot = (marker: MarkerRow) => ({
  name: (marker.title.trim() || 'Token').slice(0, 200),
  artworkLocation: marker.imageLocation,
  shape: marker.shape,
  shapeColor: marker.shapeColor,
  size: marker.size,
  imageScale: marker.imageScale,
  statBlock: marker.statBlock ?? null,
  initiativeBonus: marker.initiativeBonus ?? null
});

const markerSpacing = (settings: SceneSettings) => {
  const displayCell = (settings.gridSpacing * settings.displayResolutionX) / settings.displaySizeX;
  return settings.gridMode === 1 && settings.mapZoom > 0 ? displayCell / settings.mapZoom : displayCell;
};

// Lays out `count` copies in a near-square block centred on `at`. The top-left
// copy is snapped and the rest are whole cells away, so the block stays on the grid
export const placementPositions = (
  count: number,
  at: PlacementPoint,
  spacing: number,
  snap: (point: PlacementPoint) => PlacementPoint = (point) => point
): PlacementPoint[] => {
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const origin = snap({ x: at.x - ((columns - 1) / 2) * spacing, y: at.y + ((rows - 1) / 2) * spacing });
  return Array.from({ length: count }, (_, index) => ({
    x: origin.x + (index % columns) * spacing,
    y: origin.y - Math.floor(index / columns) * spacing
  }));
};

export const placeAsset = async ({
  assetId,
  quantity,
  at,
  sceneId,
  client,
  mutate,
  snap,
  visibility = MarkerVisibility.Always,
  onLoadingChange
}: PlaceAssetOptions) => {
  if (!client?.scene(sceneId)) return;
  const count = Math.min(MAX_PLACEMENT_QUANTITY, Math.max(1, Math.floor(quantity) || 1));
  const result = await handleMutation({
    mutation: () => mutate({ action: 'place', id: assetId, sceneId, quantity: count, x: 0, y: 0 }),
    formLoadingState: (value) => onLoadingChange?.(value),
    toastMessages: { error: { title: 'Asset action failed', body: (error) => error.message } }
  });
  const markers = result?.markers;
  const scene = client.scene(sceneId);
  if (!markers || !scene) return;
  const positions = placementPositions(markers.length, at, markerSpacing(scene.settings), snap);
  client.stopCapturing();
  client.write.transaction(() => {
    markers.forEach((marker, index) =>
      client.write.upsertMarker(sceneId, {
        ...marker,
        visibility,
        positionX: positions[index].x,
        positionY: positions[index].y
      })
    );
  });
  client.stopCapturing();
};
