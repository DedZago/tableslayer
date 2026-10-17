import { mutationFactory } from '$lib/factories';
import type { HandoutDescriptor } from '$lib/realtime/types';
import type { HandoutSource } from '$lib/server/handouts/types';
import { validateMediaUpload } from '$lib/utils/mediaUpload';
import { uploadMediaFile } from './file';

type HandoutAction =
  | { action: 'prepare'; partyId: string; source: HandoutSource; title: string | null }
  | { action: 'authorize'; partyId: string };

export const useHandoutMutation = () =>
  mutationFactory<HandoutAction, { success?: boolean; handout?: HandoutDescriptor }>({
    mutationKey: ['handouts'],
    endpoint: '/api/handouts/manage',
    method: 'POST',
    onSuccess: () => {}
  });

export const useHandoutUploadMutation = () =>
  mutationFactory<{ partyId: string; file: File }, { location: string }, Error>({
    mutationKey: ['handoutUpload'],
    mutationFn: async ({ partyId, file }) => {
      validateMediaUpload(file, true);
      const authorize = async () => {
        const response = await fetch('/api/handouts/manage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'authorize', partyId })
        });
        if (!response.ok) throw new Error((await response.json()).message || 'Handout access denied');
      };
      await authorize();
      const uploaded = await uploadMediaFile(file, 'handout');
      await authorize();
      return uploaded;
    },
    onSuccess: () => {}
  });
