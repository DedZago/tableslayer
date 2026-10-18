import { handleMutation } from '$lib/factories';
import type { useHandoutMutation } from '$lib/queries/handouts';
import type { SessionDocClient } from '$lib/realtime';
import type { HandoutSource } from '$lib/server/handouts/types';

export type HandoutActionContext = {
  mutation: ReturnType<typeof useHandoutMutation>;
  client: SessionDocClient | null;
  partyId: string;
  isCurrent: () => boolean;
  setLoading: (value: boolean) => void;
};

export const showHandout = async (
  { mutation, client, partyId, isCurrent, setLoading }: HandoutActionContext,
  source: HandoutSource,
  title: string | null
) => {
  if (!client?.ready) return null;
  const result = await handleMutation({
    mutation: () => mutation.mutateAsync({ action: 'prepare', partyId, source, title }),
    formLoadingState: setLoading,
    toastMessages: { error: { title: 'Handout could not be shown', body: (error) => error.message } }
  });
  if (!result?.handout || !isCurrent()) return null;
  client.party.setHandout(result.handout);
  return result.handout;
};

export const hideHandout = async ({ mutation, client, partyId, isCurrent, setLoading }: HandoutActionContext) => {
  if (!client?.ready) return;
  const result = await handleMutation({
    mutation: () => mutation.mutateAsync({ action: 'authorize', partyId }),
    formLoadingState: setLoading,
    toastMessages: { error: { title: 'Handout could not be hidden', body: (error) => error.message } }
  });
  if (result?.success && isCurrent()) client.party.setHandout(null);
};
