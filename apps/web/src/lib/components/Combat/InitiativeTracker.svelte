<script lang="ts">
  import { flip } from 'svelte/animate';
  import { Button, ConfirmActionButton, Icon, IconButton, InputCheckbox, Popover } from '@tableslayer/ui';
  import { IconDots, IconPlayerTrackPrev } from '@tabler/icons-svelte';
  import { generateSquareThumbnailUrl } from '$lib/utils/generateR2Url';
  import {
    buildTurnView,
    isDefeated,
    resolveInitiativeBonus,
    sortCombatants,
    turnEntryKey,
    type TurnPosition
  } from '$lib/utils/initiative';
  import InitiativeDivider from './InitiativeDivider.svelte';
  import InitiativeRow from './InitiativeRow.svelte';
  import type { CombatAction, CombatToken } from './types';

  let {
    combatants,
    position,
    lairActions,
    showOnTv,
    selectedMarkerIds,
    bucketUrl,
    onAction,
    onSelectMarker,
    onBonusChange,
    onSettingsChange
  }: {
    combatants: CombatToken[];
    position: TurnPosition;
    lairActions: boolean;
    showOnTv: boolean;
    selectedMarkerIds: string[];
    bucketUrl: string;
    onAction: (action: CombatAction) => void;
    onSelectMarker: (id: string) => void;
    onBonusChange: (id: string, bonus: number | null) => void;
    onSettingsChange: (fields: { combatLairActions?: boolean; combatShowOnTv?: boolean }) => void;
  } = $props();

  let isMenuOpen = $state(false);
  let isRerollArmed = $state(false);

  const sorted = $derived(sortCombatants(combatants));
  const rolled = $derived(sorted.rolled);
  const unrolled = $derived(sorted.unrolled);
  const turnEntries = $derived(buildTurnView(rolled, position, lairActions));
  const isRolling = $derived(position.round === 0);
  const combatantIds = $derived(new Set(combatants.map((c) => c.id)));
  const selectedOutside = $derived(selectedMarkerIds.filter((id) => !combatantIds.has(id)));
  const isEveryoneDown = $derived(rolled.length > 0 && rolled.every(isDefeated));
  const tiedIds = $derived(
    new Set(
      rolled
        .filter((c) => rolled.some((other) => other.id !== c.id && other.initiative === c.initiative))
        .map((c) => c.id)
    )
  );

  const thumbUrlOf = (c: CombatToken) =>
    c.imageLocation ? generateSquareThumbnailUrl(c.imageLocation, bucketUrl) : null;
  const hpOf = (c: CombatToken) => {
    const max = c.statBlock?.hp.average;
    return c.hitPoints != null && max != null ? { current: c.hitPoints, max } : null;
  };
  const bonusOf = (c: CombatToken) => resolveInitiativeBonus(c);

  $effect(() => {
    if (!isMenuOpen) isRerollArmed = false;
  });

  const rerollEveryone = () => {
    if (!isRerollArmed) {
      isRerollArmed = true;
      return;
    }
    isRerollArmed = false;
    isMenuOpen = false;
    onAction({ type: 'rerollAll' });
  };
</script>

<!--
@component
  GM-side initiative tracker (the Combat tab). It renders and emits only; the page runs the actions.
-->

<div class="initiativeTracker">
  {#if combatants.length === 0}
    <div class="initiativeTracker__empty">
      <p class="initiativeTracker__emptyText">Select tokens on the map, then start combat.</p>
      <Button
        isDisabled={selectedMarkerIds.length === 0}
        onclick={() => onAction({ type: 'start', ids: selectedMarkerIds })}
      >
        Start combat with {selectedMarkerIds.length} selected
      </Button>
      <p class="initiativeTracker__hint">
        or press <kbd class="initiativeTracker__key">I</kbd>
      </p>
    </div>
  {:else}
    <header class="initiativeTracker__header">
      <div class="initiativeTracker__top">
        <h3 class="initiativeTracker__round">{isRolling ? 'Roll initiative' : `Round ${position.round}`}</h3>
        <Popover bind:isOpen={isMenuOpen} positioning={{ placement: 'bottom-end' }}>
          {#snippet trigger()}
            <Icon Icon={IconDots} />
          {/snippet}
          {#snippet content()}
            <div class="initiativeTracker__menu">
              <InputCheckbox
                checked={lairActions}
                label="Lair actions at 20"
                onchange={(event) => onSettingsChange({ combatLairActions: event.currentTarget.checked })}
              />
              <InputCheckbox
                checked={showOnTv}
                label="Show turn order on TV"
                onchange={(event) => onSettingsChange({ combatShowOnTv: event.currentTarget.checked })}
              />
              <Button variant="ghost" size="sm" onclick={rerollEveryone}>
                {isRerollArmed ? 'Confirm re-roll' : 'Re-roll everyone'}
              </Button>
            </div>
          {/snippet}
        </Popover>
      </div>

      <div class="initiativeTracker__controls">
        {#if isRolling}
          <Button
            variant="primary"
            size="sm"
            isDisabled={unrolled.length === 0}
            onclick={() => onAction({ type: 'rollEmpty' })}
          >
            Roll for {unrolled.length} empty
          </Button>
          <Button
            variant={unrolled.length === 0 ? 'primary' : 'ghost'}
            size="sm"
            isDisabled={rolled.length === 0}
            onclick={() => onAction({ type: 'begin' })}
          >
            Begin round 1
          </Button>
        {:else}
          <IconButton
            variant="ghost"
            title="Previous turn (Shift+N)"
            aria-label="Previous turn"
            onclick={() => onAction({ type: 'previous' })}
          >
            <Icon Icon={IconPlayerTrackPrev} />
          </IconButton>
          <Button variant="primary" size="sm" onclick={() => onAction({ type: 'next' })}>
            Next turn
            {#snippet end()}
              <kbd class="initiativeTracker__key">N</kbd>
            {/snippet}
          </Button>
        {/if}
      </div>

      {#if isEveryoneDown}
        <p class="initiativeTracker__hint">Everyone is down. End combat?</p>
      {/if}
    </header>

    <div class="initiativeTracker__list" role="list">
      {#each turnEntries as entry (turnEntryKey(entry))}
        <div class="initiativeTracker__entry" role="listitem" animate:flip={{ duration: 180 }}>
          {#if entry.kind === 'combatant'}
            <InitiativeRow
              combatant={entry.combatant}
              isActive={entry.isActive}
              isDefeated={entry.isDefeated}
              isSelected={selectedMarkerIds.includes(entry.combatant.id)}
              actsNextRound={entry.actsNextRound}
              isTied={tiedIds.has(entry.combatant.id)}
              bonus={bonusOf(entry.combatant)}
              hp={hpOf(entry.combatant)}
              thumbUrl={thumbUrlOf(entry.combatant)}
              onSelect={onSelectMarker}
              onInitiativeChange={(value) => onAction({ type: 'setInitiative', id: entry.combatant.id, value })}
              onBonusChange={(bonus) => onBonusChange(entry.combatant.id, bonus)}
              onRoll={() => onAction({ type: 'rollOne', id: entry.combatant.id })}
              onNudge={(direction) => onAction({ type: 'nudgeTie', id: entry.combatant.id, direction })}
              onRemove={() => onAction({ type: 'remove', ids: [entry.combatant.id] })}
            />
          {:else if entry.kind === 'roundEnd'}
            <InitiativeDivider kind="roundEnd" round={entry.round} />
          {:else}
            <InitiativeDivider kind="lair" isActive={entry.isActive} isUpNext={entry.isUpNext} />
          {/if}
        </div>
      {/each}
    </div>

    {#if unrolled.length > 0}
      <div class="initiativeTracker__unrolled">
        <h4 class="initiativeTracker__sectionTitle">Not rolled</h4>
        <div class="initiativeTracker__list" role="list">
          {#each unrolled as combatant (combatant.id)}
            <div class="initiativeTracker__entry" role="listitem" animate:flip={{ duration: 180 }}>
              <InitiativeRow
                {combatant}
                isActive={false}
                isDefeated={false}
                isSelected={selectedMarkerIds.includes(combatant.id)}
                actsNextRound={false}
                isTied={false}
                bonus={bonusOf(combatant)}
                hp={hpOf(combatant)}
                thumbUrl={thumbUrlOf(combatant)}
                onSelect={onSelectMarker}
                onInitiativeChange={(value) => onAction({ type: 'setInitiative', id: combatant.id, value })}
                onBonusChange={(bonus) => onBonusChange(combatant.id, bonus)}
                onRoll={() => onAction({ type: 'rollOne', id: combatant.id })}
                onNudge={() => {}}
                onRemove={() => onAction({ type: 'remove', ids: [combatant.id] })}
              />
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <footer class="initiativeTracker__footer">
      {#if selectedOutside.length > 0}
        <Button variant="ghost" size="sm" onclick={() => onAction({ type: 'add', ids: selectedOutside })}>
          Add {selectedOutside.length} selected
        </Button>
      {/if}
      <span class="initiativeTracker__spacer"></span>
      <ConfirmActionButton action={() => onAction({ type: 'end' })} actionButtonText="End combat">
        {#snippet trigger({ triggerProps })}
          <Button as="div" variant="danger" size="sm" {...triggerProps}>End combat</Button>
        {/snippet}
        {#snippet actionMessage()}
          End combat on every screen? Turn order and initiative are cleared.
        {/snippet}
      </ConfirmActionButton>
    </footer>
  {/if}
</div>

<style>
  .initiativeTracker {
    --turnColor: var(--yellow-500);
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    color: var(--fg);
  }
  .initiativeTracker__header {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem 1rem 0.5rem;
    background: var(--bg);
    border-bottom: var(--borderThin);
  }
  .initiativeTracker__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .initiativeTracker__round {
    margin: 0;
    font-size: var(--font-size-4);
    font-weight: var(--font-weight-6);
  }
  .initiativeTracker__controls {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .initiativeTracker__hint {
    margin: 0;
    font-size: 0.8125rem;
    color: var(--fgMuted);
  }
  .initiativeTracker__key {
    display: inline-block;
    padding: 0 0.3rem;
    margin-left: 0.25rem;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    border: var(--borderThin);
    border-radius: var(--radius-2);
    line-height: 1.4;
  }
  .initiativeTracker__menu {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 14rem;
    padding: 0.25rem;
  }
  .initiativeTracker__list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0.5rem 1rem;
  }
  .initiativeTracker__entry {
    min-width: 0;
  }
  .initiativeTracker__unrolled {
    padding: 0 1rem;
    border-top: var(--borderThin);
    padding-top: 0.5rem;
  }
  .initiativeTracker__sectionTitle {
    margin: 0.25rem 0;
    font-size: 0.8125rem;
    font-weight: var(--font-weight-6);
    color: var(--fgMuted);
  }
  .initiativeTracker__footer {
    margin-top: auto;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-top: var(--borderThin);
  }
  .initiativeTracker__spacer {
    flex: 1;
  }
  .initiativeTracker__empty {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 1.5rem 1rem;
  }
  .initiativeTracker__emptyText {
    margin: 0;
    color: var(--fgMuted);
  }
</style>
