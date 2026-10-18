<script lang="ts">
  import { Button } from '@tableslayer/ui';
  import { useHandoutMutation } from '$lib/queries/handouts';
  import { hideHandout } from './handoutActions';
  import type { HandoutLivePillProps } from './types';

  let { partyId, client, onOpen }: HandoutLivePillProps = $props();
  const mutation = useHandoutMutation();
  let loading = $state(false);
  const active = $derived(client?.ready ? (client.partyState().activeHandout ?? null) : null);

  const hide = () => {
    const destinationClient = client;
    const destinationParty = partyId;
    return hideHandout({
      mutation,
      client: destinationClient,
      partyId: destinationParty,
      isCurrent: () => destinationClient === client && destinationParty === partyId,
      setLoading: (value) => (loading = value)
    });
  };
</script>

{#if active}
  <div class="handoutLivePill">
    <button type="button" class="handoutLivePill__label" onclick={onOpen}>
      <span class="handoutLivePill__dot" aria-hidden="true"></span>
      <span>
        Players see: <strong class="handoutLivePill__title">{active.title || 'Handout'}</strong>
      </span>
    </button>
    <Button variant="ghost" size="sm" isDisabled={loading || !client?.ready} onclick={hide}>Hide</Button>
  </div>
{/if}

<style>
  .handoutLivePill {
    position: absolute;
    top: 0.75rem;
    left: 0.75rem;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    max-width: calc(100% - 1.5rem);
    padding: 0.25rem 0.5rem 0.25rem 0.75rem;
    background: color-mix(in srgb, var(--bg) 85%, transparent);
    border: var(--borderThin);
    border-radius: 999px;
    box-shadow: var(--shadow-1);
    color: var(--fg);
    font-size: 0.875rem;
  }
  .handoutLivePill__label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    padding: 0;
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .handoutLivePill__label > span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .handoutLivePill__dot {
    flex-shrink: 0;
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--fgSuccess);
  }
  .handoutLivePill__title {
    font-weight: 600;
  }
</style>
