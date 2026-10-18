<script lang="ts">
  import { LAIR_INITIATIVE } from '$lib/utils/initiative';

  let {
    kind,
    round = 0,
    isActive = false,
    isUpNext = false
  }: {
    kind: 'lair' | 'roundEnd';
    round?: number;
    isActive?: boolean;
    isUpNext?: boolean;
  } = $props();
</script>

<!--
@component
  Divider between turn groups. `roundEnd` marks where the round ends. `lair` marks where
  initiative 20 falls, and lights up when the next turn stops on it or it is the active step.
-->

{#if kind === 'roundEnd'}
  <div class="initiativeDivider initiativeDivider--roundEnd" role="separator">
    <span class="initiativeDivider__line"></span>
    <span class="initiativeDivider__label">
      End of round {round}
      <span class="initiativeDivider__dot" aria-hidden="true">·</span>
      <span class="initiativeDivider__next">round {round + 1}</span>
    </span>
    <span class="initiativeDivider__line"></span>
  </div>
{:else}
  <div
    class={[
      'initiativeDivider',
      'initiativeDivider--lair',
      isActive && 'initiativeDivider--active',
      isUpNext && 'initiativeDivider--upNext'
    ]}
    role="separator"
  >
    <span class="initiativeDivider__line"></span>
    <span class="initiativeDivider__label">
      {#if isActive}
        ▶ {LAIR_INITIATIVE} · Lair action
      {:else}
        {LAIR_INITIATIVE} · lair actions
      {/if}
    </span>
    <span class="initiativeDivider__line"></span>
  </div>
{/if}

<style>
  .initiativeDivider {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    height: 20px;
    font-size: 0.75rem;
    color: var(--fgMuted);
  }
  .initiativeDivider__line {
    flex: 1;
    min-width: 0;
  }
  .initiativeDivider__label {
    flex-shrink: 0;
    white-space: nowrap;
  }
  .initiativeDivider--roundEnd .initiativeDivider__line {
    border-top: 2px solid var(--fgMuted);
  }
  .initiativeDivider__next {
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 0.6875rem;
    font-weight: var(--font-weight-6);
  }
  .initiativeDivider--lair .initiativeDivider__line {
    border-top: 1px dashed var(--fgMuted);
  }
  .initiativeDivider--upNext {
    color: var(--turnColor);
  }
  .initiativeDivider--upNext .initiativeDivider__line {
    border-top-color: var(--turnColor);
  }
  .initiativeDivider--active {
    color: var(--bg);
    font-weight: var(--font-weight-6);
  }
  .initiativeDivider--active .initiativeDivider__label {
    background: var(--turnColor);
    padding: 0.125rem 0.5rem;
    border-radius: var(--radius-2);
  }
  .initiativeDivider--active .initiativeDivider__line {
    border-top-color: var(--turnColor);
  }
</style>
