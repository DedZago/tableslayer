import type { AssetRole, SelectAsset } from '$lib/db/app/schema';
import { mutationFactory } from '$lib/factories';
import type { MarkerRow } from '$lib/realtime';
import type { AssetStatSummary } from '$lib/server/assets/assets';
import { validateMediaUpload } from '$lib/utils/mediaUpload';
import type { StatBlock } from '$lib/utils/statBlock/types';
import { createQuery, useQueryClient } from '@tanstack/svelte-query';
import { uploadMediaFile } from './file';

type AssetAction =
  | { action: 'authorizeArtwork'; sceneId: string; location: string }
  | {
      action: 'save';
      fields: {
        id?: string;
        name?: string;
        artworkLocation?: string | null;
        tokenArtworkLocation?: string | null;
        shape?: number;
        shapeColor?: string;
        size?: number;
        imageScale?: number;
        role?: AssetRole | null;
        cropX?: number;
        cropY?: number;
        cropZoom?: number;
        initiativeBonus?: number | null;
      };
    }
  | { action: 'get'; id: string }
  | { action: 'delete'; id: string }
  | {
      action: 'saveMarker';
      sceneId: string;
      markerId: string;
      snapshot?: {
        name: string;
        artworkLocation: string | null;
        shape: number;
        shapeColor: string;
        size: number;
        imageScale: number;
        statBlock?: StatBlock | null;
        initiativeBonus?: number | null;
      };
    }
  | { action: 'place'; id: string; sceneId: string; quantity: number; x: number; y: number };

export type AssetListItem = Omit<SelectAsset, 'statBlock'> & { statSummary: AssetStatSummary | null };

export const createAssetsQuery = (search: () => string) =>
  createQuery<{ assets: AssetListItem[] }>(() => ({
    queryKey: ['assets', search()],
    queryFn: async () => {
      const response = await fetch('/api/assets/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list', search: search() })
      });
      if (!response.ok) throw new Error((await response.json()).message || 'Failed to load assets');
      return response.json();
    }
  }));

export const createAssetDetailQuery = (id: () => string | null) =>
  createQuery<SelectAsset>(() => {
    const current = id();
    return {
      queryKey: ['assetDetail', current],
      enabled: !!current,
      queryFn: async () => {
        const response = await fetch('/api/assets/manage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'get', id: current })
        });
        if (!response.ok) throw new Error((await response.json()).message || 'Failed to load asset');
        return (await response.json()).asset;
      },
      retry: false
    };
  });

export const useAssetMutation = () => {
  const client = useQueryClient();
  return mutationFactory<AssetAction, { asset?: SelectAsset; markers?: MarkerRow[]; success?: boolean }>({
    mutationKey: ['assets'],
    endpoint: '/api/assets/manage',
    method: 'POST',
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ['assets'] }),
        client.invalidateQueries({ queryKey: ['assetDetail'] })
      ])
  });
};

export const useTokenArtworkMutation = () =>
  mutationFactory<{ file: File; sceneId: string }, { location: string }, Error>({
    mutationKey: ['tokenArtwork'],
    mutationFn: async ({ file, sceneId }) => {
      validateMediaUpload(file, true);
      const authorize = async (location?: string) => {
        const response = await fetch('/api/assets/manage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'authorizeArtwork', sceneId, location })
        });
        if (!response.ok) throw new Error((await response.json()).message || 'Artwork access denied');
      };
      await authorize();
      const uploaded = await uploadMediaFile(file, 'marker');
      await authorize(uploaded.location);
      return uploaded;
    },
    onSuccess: () => {}
  });
