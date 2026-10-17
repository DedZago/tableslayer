import type { SelectAsset } from '$lib/db/app/schema';
import type { SessionDocClient } from '$lib/realtime';
import type { FiveToolsImportItem, FiveToolsImportResult } from '$lib/server/assets/fivetools/types';

export interface AssetLibraryProps {
  client: SessionDocClient | null;
  sceneId: string;
  selectedMarkerId?: string;
  bucketUrl: string;
  onPreviewArtwork?: (asset: SelectAsset) => void;
}

export type AssetImportRow = FiveToolsImportItem & { selected: boolean; result?: FiveToolsImportResult };
