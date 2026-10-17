import { mutationFactory } from '$lib/factories';
import type { MarkerRow } from '$lib/realtime';
import type { ClipboardGrant, ClipboardPoint, TokenClipboard } from '$lib/utils/tokenClipboardSchema';
import { createQuery } from '@tanstack/svelte-query';

export const createClipboardGrantQuery = (sceneId: () => string, locations: () => string[], enabled: () => boolean) =>
  createQuery<ClipboardGrant>(() => {
    const source = sceneId();
    const artwork = locations();
    return {
      queryKey: ['tokenClipboardGrant', source, artwork],
      enabled: enabled(),
      staleTime: Infinity,
      retry: false,
      queryFn: async () => {
        const response = await fetch('/api/assets/clipboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'grant', sceneId: source, locations: artwork })
        });
        if (!response.ok) throw new Error((await response.json()).message || 'Token artwork authorization failed');
        return response.json();
      }
    };
  });

export const useTokenPasteMutation = () =>
  mutationFactory<
    { action: 'paste'; sceneId: string; clipboard: TokenClipboard; positions: ClipboardPoint[] },
    { markers: MarkerRow[] }
  >({ mutationKey: ['pasteTokens'], endpoint: '/api/assets/clipboard', method: 'POST', onSuccess: () => {} });
