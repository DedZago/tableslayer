<script lang="ts">
  import { flip } from 'svelte/animate';
  import { Icon } from '@tableslayer/ui';
  import { MarkerVisibility } from '@tableslayer/stage';
  import { IconSkull } from '@tabler/icons-svelte';
  import { generateSquareThumbnailUrl } from '$lib/utils/generateR2Url';
  import {
    buildTurnView,
    filterTurnView,
    isDefeatedForPlayers,
    sortCombatants,
    takeCombatantEntries,
    turnEntryKey,
    type TurnPosition
  } from '$lib/utils/initiative';
  import type { CombatToken } from './types';

  const MAX_PORTRAITS = 12;

  let {
    combatants,
    position,
    bucketUrl,
    lairActions = false
  }: {
    combatants: CombatToken[];
    position: TurnPosition;
    bucketUrl: string;
    lairActions?: boolean;
  } = $props();

  const isShownToPlayers = (c: CombatToken) =>
    c.visibility !== MarkerVisibility.DM && c.visibility !== MarkerVisibility.Hover;
  const visible = $derived(combatants.filter(isShownToPlayers));
  // The view is built from every combatant so a hidden active turn keeps its place, then hidden rows are dropped
  const turnView = $derived(
    takeCombatantEntries(
      filterTurnView(buildTurnView(sortCombatants(combatants).rolled, position, lairActions), isShownToPlayers),
      MAX_PORTRAITS
    )
  );
  const isShown = $derived(position.round > 0 && visible.length > 0);
  const thumbUrlOf = (c: CombatToken) =>
    c.imageLocation ? generateSquareThumbnailUrl(c.imageLocation, bucketUrl) : null;
</script>

<!--
@component
  Turn-order strip for the player view. Read-only: it never takes pointer input.
-->

{#if isShown}
  <div class="initiativeStrip" aria-label={`Turn order, round ${position.round}`}>
    <div class="initiativeStrip__round">Round {position.round}</div>
    <div class="initiativeStrip__portraits">
      {#each turnView.entries as entry (turnEntryKey(entry))}
        <div class="initiativeStrip__slot" animate:flip={{ duration: 180 }}>
          {#if entry.kind === 'combatant'}
            <div
              class={[
                'initiativeStrip__portrait',
                entry.isActive && 'initiativeStrip__portrait--active',
                isDefeatedForPlayers(entry.combatant) && 'initiativeStrip__portrait--defeated'
              ]}
              title={entry.combatant.title}
            >
              {#if thumbUrlOf(entry.combatant)}
                <img src={thumbUrlOf(entry.combatant)} alt="" />
              {:else}
                <span class="initiativeStrip__fallback" style:background-color={entry.combatant.shapeColor}>
                  {entry.combatant.label || entry.combatant.title.slice(0, 2)}
                </span>
              {/if}
              {#if isDefeatedForPlayers(entry.combatant)}
                <span class="initiativeStrip__skull"><Icon Icon={IconSkull} size="1rem" /></span>
              {/if}
            </div>
            {#if entry.isActive}
              <div class="initiativeStrip__name">{entry.combatant.title}</div>
            {/if}
          {:else if entry.kind === 'roundEnd'}
            <div class="initiativeStrip__roundEnd"></div>
          {:else if entry.isActive}
            <div class="initiativeStrip__lair initiativeStrip__lair--active">Lair</div>
          {:else}
            <div class={['initiativeStrip__lair', entry.isUpNext && 'initiativeStrip__lair--upNext']}>20</div>
          {/if}
        </div>
      {/each}
      {#if turnView.overflow > 0}
        <div class="initiativeStrip__more">+{turnView.overflow}</div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .initiativeStrip {
    --turnColor: var(--yellow-500);
    pointer-events: none;
    position: absolute;
    top: 0.75rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    max-width: calc(100% - 1.5rem);
    padding: 0.5rem 0.75rem;
    border-radius: var(--radius-3);
    background: color-mix(in srgb, var(--bg) 80%, transparent);
    backdrop-filter: blur(6px);
    color: var(--fg);
  }
  .initiativeStrip__round {
    flex-shrink: 0;
    font-size: 0.8125rem;
    font-weight: var(--font-weight-6);
    padding: 0.125rem 0.5rem;
    border-radius: var(--radius-2);
    border: var(--borderThin);
  }
  .initiativeStrip__portraits {
    display: flex;
    align-items: flex-end;
    gap: 0.375rem;
    min-width: 0;
    overflow: hidden;
  }
  .initiativeStrip__slot {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex-shrink: 0;
    gap: 0.25rem;
  }
  .initiativeStrip__portrait {
    position: relative;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    overflow: hidden;
    border: 2px solid transparent;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .initiativeStrip__portrait img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .initiativeStrip__portrait--active {
    width: 56px;
    height: 56px;
    border-color: var(--turnColor);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--turnColor) 35%, transparent);
  }
  .initiativeStrip__portrait--defeated {
    filter: grayscale(1);
    opacity: 0.4;
  }
  .initiativeStrip__fallback {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--bg);
    font-size: 0.75rem;
    font-weight: var(--font-weight-6);
  }
  .initiativeStrip__skull {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--fg);
  }
  .initiativeStrip__name {
    max-width: 14ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.6875rem;
    font-weight: var(--font-weight-6);
  }
  .initiativeStrip__roundEnd {
    align-self: stretch;
    width: 2px;
    margin: 0 0.25rem;
    background: var(--fgMuted);
  }
  .initiativeStrip__lair {
    padding: 0 0.25rem;
    font-size: 0.75rem;
    font-weight: var(--font-weight-6);
    color: var(--fgMuted);
    border-left: 1px dashed var(--fgMuted);
    padding-left: 0.375rem;
  }
  .initiativeStrip__lair--upNext {
    color: var(--turnColor);
    border-left-color: var(--turnColor);
  }
  .initiativeStrip__lair--active {
    padding: 0.25rem 0.5rem;
    border: none;
    border-radius: var(--radius-2);
    background: var(--turnColor);
    color: var(--bg);
  }
  .initiativeStrip__more {
    flex-shrink: 0;
    font-size: 0.8125rem;
    font-weight: var(--font-weight-6);
    color: var(--fgMuted);
  }
</style>
