import type { SelectAsset } from '$lib/db/app/schema';
import type { AssetListItem } from '$lib/queries/assets';
import type { SessionDocClient } from '$lib/realtime';
import type { FiveToolsImportItem, FiveToolsImportResult } from '$lib/server/assets/fivetools/types';
import type { PlacementPoint } from './assetPlacement';

export interface AssetLibraryProps {
  client: SessionDocClient | null;
  sceneId: string;
  selectedMarkerId?: string;
  bucketUrl: string;
  onPreviewArtwork?: (asset: AssetListItem) => void;
  onOpenCatalog?: () => void;
  quantity?: number;
  getViewportCenter?: () => PlacementPoint | null;
  snapPosition?: (point: PlacementPoint) => PlacementPoint;
}

export interface AssetEditorProps {
  asset?: AssetListItem | null;
  bucketUrl: string;
  onClose: () => void;
  onSaved: (asset: SelectAsset) => void;
}

export type AssetImportRow = FiveToolsImportItem & {
  selected: boolean;
  uploaded?: boolean;
  result?: FiveToolsImportResult;
};
