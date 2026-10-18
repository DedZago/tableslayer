import type { StatBlock } from '$lib/utils/statBlock/types';

export type FiveToolsPreview = {
  identity: string;
  name: string;
  source: string;
  tokenUrl: string | null;
  artworkUrl: string | null;
  warnings: string[];
  duplicates?: { id: string; name: string }[];
  cr?: string;
  creatureType?: string;
  size?: string;
  statBlock?: StatBlock | null;
};

export type FiveToolsImportItem = {
  record: FiveToolsPreview;
  requestId: string;
  policy: 'skip' | 'update' | 'another';
  targetId?: string;
};

export type FiveToolsImportResult = {
  identity: string;
  requestId: string;
  status: 'created' | 'updated' | 'skipped' | 'failed';
  assetId?: string;
  message?: string;
};

export type FiveToolsCatalogStatus = {
  state: 'idle' | 'loading' | 'ready' | 'error';
  completed: number;
  total: number;
  recordCount: number;
  warnings: string[];
  error?: string;
};

export type FiveToolsCatalogResult = {
  status: FiveToolsCatalogStatus;
  records: FiveToolsPreview[];
  totalMatches: number;
  sources: { source: string; count: number }[];
};
