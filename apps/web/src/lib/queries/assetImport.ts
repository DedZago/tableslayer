import { mutationFactory } from '$lib/factories';
import type {
  FiveToolsCatalogResult,
  FiveToolsCatalogStatus,
  FiveToolsImportItem,
  FiveToolsImportResult,
  FiveToolsPreview
} from '$lib/server/assets/fivetools/types';
import type { StatBlock } from '$lib/utils/statBlock/types';
import { createQuery, useQueryClient } from '@tanstack/svelte-query';

export const useAssetImportPreviewMutation = () =>
  mutationFactory<{ action: 'preview'; json: string }, { records: FiveToolsPreview[] }>({
    mutationKey: ['assetImportPreview'],
    endpoint: '/api/assets/import',
    method: 'POST',
    onSuccess: () => {}
  });

export const useAssetImportMutation = () => {
  const client = useQueryClient();
  return mutationFactory<{ action: 'import'; items: FiveToolsImportItem[] }, { results: FiveToolsImportResult[] }>({
    mutationKey: ['assetImport'],
    endpoint: '/api/assets/import',
    method: 'POST',
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ['assets'] }),
        client.invalidateQueries({ queryKey: ['assetCatalog'] })
      ])
  });
};

export const createAssetCatalogQuery = (
  search: () => string,
  source: () => string,
  offset: () => number,
  enabled: () => boolean,
  filters: () => { crRange: string; creatureType: string }
) =>
  createQuery<FiveToolsCatalogResult>(() => ({
    queryKey: ['assetCatalog', search(), source(), offset(), filters()],
    enabled: enabled(),
    queryFn: async () => {
      const response = await fetch('/api/assets/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'search',
          search: search(),
          source: source(),
          offset: offset(),
          ...filters()
        })
      });
      if (!response.ok) throw new Error((await response.json()).message || 'Catalog search failed');
      return response.json();
    },
    staleTime: 30000,
    refetchInterval: (query) => (query.state.data?.status.state === 'loading' ? 1500 : false),
    retry: false
  }));

export const createCatalogStatBlockQuery = (identity: () => string | null) =>
  createQuery<StatBlock | null>(() => {
    const current = identity();
    return {
      queryKey: ['assetCatalogStatBlock', current],
      enabled: !!current,
      queryFn: async () => {
        const response = await fetch('/api/assets/catalog', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'statBlock', identity: current })
        });
        if (!response.ok) throw new Error((await response.json()).message || 'Stat block lookup failed');
        return (await response.json()).statBlock;
      },
      staleTime: Infinity,
      retry: false
    };
  });

export const useAssetCatalogRefreshMutation = () => {
  const client = useQueryClient();
  return mutationFactory<{ action: 'refresh' }, { status: FiveToolsCatalogStatus }>({
    mutationKey: ['assetCatalogRefresh'],
    endpoint: '/api/assets/catalog',
    method: 'POST',
    onSuccess: () => client.invalidateQueries({ queryKey: ['assetCatalog'] })
  });
};
