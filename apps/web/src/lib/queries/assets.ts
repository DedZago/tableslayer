import type { SelectAsset } from '$lib/db/app/schema';
import { mutationFactory } from '$lib/factories';
import type { MarkerRow } from '$lib/realtime';
import { validateMediaUpload } from '$lib/utils/mediaUpload';
import { createQuery, useQueryClient } from '@tanstack/svelte-query';
import { uploadMediaFile } from './file';

type AssetAction =
  | { action: 'authorizeArtwork'; sceneId: string; location: string }
  | {
      action: 'save';
      fields: {
        id?: string;
        name: string;
        artworkLocation?: string | null;
        tokenArtworkLocation?: string | null;
        shape?: number;
        shapeColor?: string;
        size?: number;
        imageScale?: number;
      };
    }
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
      };
    }
  | { action: 'place'; id: string; sceneId: string; quantity: number; x: number; y: number };

export const createAssetsQuery = (search: () => string) =>
  createQuery<{ assets: SelectAsset[] }>(() => ({
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

export const useAssetMutation = () => {
  const client = useQueryClient();
  return mutationFactory<AssetAction, { asset?: SelectAsset; markers?: MarkerRow[]; success?: boolean }>({
    mutationKey: ['assets'],
    endpoint: '/api/assets/manage',
    method: 'POST',
    onSuccess: () => client.invalidateQueries({ queryKey: ['assets'] })
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
