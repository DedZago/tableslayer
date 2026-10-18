<script lang="ts">
  import { tick } from 'svelte';
  import { Icon, IconButton } from '@tableslayer/ui';
  import { MarkerVisibility, resolveCondition } from '@tableslayer/stage';
  import {
    IconDice5,
    IconChevronUp,
    IconChevronDown,
    IconEyeOff,
    IconPlayerPlayFilled,
    IconSkull,
    IconX
  } from '@tabler/icons-svelte';
  import {
    formatSignedModifier,
    normalizeInitiativeBonus,
    normalizeInitiativeValue,
    resolveInitiativeDraft
  } from '$lib/utils/initiative';
  import type { CombatToken } from './types';

  let {
    combatant,
    isActive,
    isDefeated,
    isSelected,
    actsNextRound,
    isTied,
    bonus,
    hp,
    thumbUrl,
    onSelect,
    onInitiativeChange,
    onBonusChange,
    onRoll,
    onNudge,
    onRemove
  }: {
    combatant: CombatToken;
    isActive: boolean;
    isDefeated: boolean;
    isSelected: boolean;
    actsNextRound: boolean;
    isTied: boolean;
    bonus: number;
    hp: { current: number; max: number } | null;
    thumbUrl: string | null;
    onSelect: (id: string) => void;
    onInitiativeChange: (value: number | null) => void;
    onBonusChange: (bonus: number | null) => void;
    onRoll: () => void;
    onNudge: (direction: 'up' | 'down') => void;
    onRemove: () => void;
  } = $props();

  let bonusInput = $state<HTMLInputElement>();
  let isEditingBonus = $state(false);
  let bonusDraft = $state('');

  const hiddenFromPlayers = $derived(
    combatant.visibility === MarkerVisibility.DM || combatant.visibility === MarkerVisibility.Hover
  );
  const isAutomaticBonus = $derived(combatant.initiativeBonus == null);
  const conditions = $derived((combatant.conditions ?? []).slice(0, 3).map((condition) => resolveCondition(condition)));
  const hpPercent = $derived(hp && hp.max > 0 ? Math.max(0, Math.min(100, (hp.current / hp.max) * 100)) : 0);
  const hpLevel = $derived(hpPercent <= 25 ? 'critical' : hpPercent <= 50 ? 'low' : 'healthy');
  const fallbackLabel = $derived(combatant.label || combatant.title.slice(0, 2));

  const bonusSource = $derived.by(() => {
    if (!isAutomaticBonus) return 'Set by GM';
    if (combatant.statBlock?.initiative != null) {
      return `From stat block (initiative ${formatSignedModifier(combatant.statBlock.initiative)})`;
    }
    if (combatant.statBlock) {
      return `From stat block (Dex ${formatSignedModifier(combatant.statBlock.abilities.dex.mod)})`;
    }
    return 'Automatic, no stat block';
  });

  const commitInitiative = (input: HTMLInputElement) => {
    const current = combatant.initiative ?? null;
    const draft = resolveInitiativeDraft(input.value, current, normalizeInitiativeValue);
    // The active combatant must keep a value, so clearing it is refused
    const next = draft === null && isActive ? current : draft;
    input.value = next === null ? '' : String(next);
    if (next !== current) onInitiativeChange(next);
  };

  const stepInitiative = (input: HTMLInputElement, delta: number) => {
    const next = normalizeInitiativeValue((combatant.initiative ?? 0) + delta);
    input.value = next === null ? '' : String(next);
    if (next !== combatant.initiative) onInitiativeChange(next);
  };

  const handleInitiativeKey = (event: KeyboardEvent) => {
    const input = event.currentTarget as HTMLInputElement;
    if (event.key === 'Enter') {
      event.preventDefault();
      commitInitiative(input);
    } else if (event.key === 'Escape') {
      // Blurring makes the page's shortcut handler see no focused input, so keep Escape from clearing the selection
      event.stopPropagation();
      input.value = combatant.initiative == null ? '' : String(combatant.initiative);
      input.blur();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      stepInitiative(input, event.key === 'ArrowUp' ? 1 : -1);
    }
  };

  const startBonusEdit = () => {
    bonusDraft = combatant.initiativeBonus == null ? '' : String(combatant.initiativeBonus);
    isEditingBonus = true;
    void tick().then(() => bonusInput?.focus());
  };

  const finishBonusEdit = (commit: boolean) => {
    if (!isEditingBonus) return;
    isEditingBonus = false;
    if (!commit) return;
    const current = combatant.initiativeBonus ?? null;
    const next = resolveInitiativeDraft(bonusDraft, current, normalizeInitiativeBonus);
    if (next !== current) onBonusChange(next);
  };

  const handleBonusKey = (event: KeyboardEvent) => {
    if (event.key === 'Enter') finishBonusEdit(true);
    if (event.key === 'Escape') finishBonusEdit(false);
  };
</script>

<!--
@component
  One combatant in the initiative tracker. Clicking anywhere on the row selects the token.
  The initiative and bonus inputs and the hover actions sit above that overlay.
-->

<div
  class={[
    'initiativeRow',
    isActive && 'initiativeRow--active',
    isDefeated && 'initiativeRow--defeated',
    isSelected && 'initiativeRow--selected'
  ]}
  aria-current={isActive ? 'step' : undefined}
  data-next-round={actsNextRound || undefined}
>
  <button
    type="button"
    class="initiativeRow__select"
    tabindex="-1"
    aria-label={`Select ${combatant.title}`}
    onclick={() => onSelect(combatant.id)}
  ></button>

  <div class="initiativeRow__turn" aria-hidden="true">
    {#if isActive}
      <Icon Icon={IconPlayerPlayFilled} size="0.875rem" color="var(--turnColor)" />
    {/if}
  </div>

  <input
    class="initiativeRow__initiative"
    type="text"
    inputmode="numeric"
    placeholder="—"
    value={combatant.initiative ?? ''}
    aria-label={`Initiative for ${combatant.title}`}
    onkeydown={handleInitiativeKey}
    onblur={(event) => commitInitiative(event.currentTarget)}
  />

  <div class="initiativeRow__thumb">
    {#if thumbUrl}
      <img src={thumbUrl} alt="" />
    {:else}
      <span class="initiativeRow__fallback" style:background-color={combatant.shapeColor}>{fallbackLabel}</span>
    {/if}
  </div>

  <div class="initiativeRow__name">
    <span class="initiativeRow__title">{combatant.title}</span>
    {#each conditions as condition}
      <span class="initiativeRow__condition" style:background-color={condition.color} title={condition.label}></span>
    {/each}
    {#if hiddenFromPlayers}
      <span class="initiativeRow__icon" title="Hidden from players">
        <Icon Icon={IconEyeOff} size="0.875rem" />
      </span>
    {/if}
    {#if isDefeated}
      <span class="initiativeRow__icon" title="Skipped (dead)">
        <Icon Icon={IconSkull} size="0.875rem" />
      </span>
    {/if}
  </div>

  {#if hp}
    <div class="initiativeRow__hp">
      <span class="initiativeRow__hpValue">{hp.current}/{hp.max}</span>
      <span class="initiativeRow__hpBar">
        <span
          class={['initiativeRow__hpFill', `initiativeRow__hpFill--${hpLevel}`]}
          style:width={`${hpPercent}%`}
        ></span>
      </span>
    </div>
  {/if}

  <div class="initiativeRow__bonus">
    {#if isEditingBonus}
      <input
        bind:this={bonusInput}
        class="initiativeRow__bonusInput"
        type="text"
        inputmode="numeric"
        size="4"
        placeholder="Auto"
        aria-label={`Initiative bonus for ${combatant.title}`}
        bind:value={bonusDraft}
        onkeydown={handleBonusKey}
        onblur={() => finishBonusEdit(true)}
      />
    {:else}
      <button
        type="button"
        class={['initiativeRow__bonusChip', isAutomaticBonus && 'initiativeRow__bonusChip--automatic']}
        title={bonusSource}
        aria-label={`Initiative bonus ${formatSignedModifier(bonus)}, ${bonusSource}. Click to edit`}
        onclick={startBonusEdit}
      >
        {formatSignedModifier(bonus)}
      </button>
    {/if}
  </div>

  <div class="initiativeRow__actions">
    <IconButton variant="ghost" size="sm" title="Roll initiative" aria-label="Roll initiative" onclick={onRoll}>
      <Icon Icon={IconDice5} size="0.875rem" />
    </IconButton>
    {#if isTied}
      <IconButton
        variant="ghost"
        size="sm"
        title="Act earlier in tie"
        aria-label="Act earlier in tie"
        onclick={() => onNudge('up')}
      >
        <Icon Icon={IconChevronUp} size="0.875rem" />
      </IconButton>
      <IconButton
        variant="ghost"
        size="sm"
        title="Act later in tie"
        aria-label="Act later in tie"
        onclick={() => onNudge('down')}
      >
        <Icon Icon={IconChevronDown} size="0.875rem" />
      </IconButton>
    {/if}
    <IconButton variant="ghost" size="sm" title="Remove from combat" aria-label="Remove from combat" onclick={onRemove}>
      <Icon Icon={IconX} size="0.875rem" />
    </IconButton>
  </div>
</div>

<style>
  .initiativeRow {
    position: relative;
    display: grid;
    grid-template-columns: 1.25rem 3rem 1.75rem 1fr auto auto;
    align-items: center;
    gap: 0.5rem;
    min-height: 40px;
    padding: 0 0.5rem;
    border-radius: var(--radius-2);
    border-left: 3px solid transparent;
    transition: background-color 120ms ease;
  }
  .initiativeRow:hover {
    background: color-mix(in srgb, var(--fgMuted) 10%, transparent);
  }
  .initiativeRow--active {
    background: color-mix(in srgb, var(--turnColor) 14%, transparent);
    border-left-color: var(--turnColor);
  }
  .initiativeRow--selected {
    outline: var(--borderThin);
    outline-color: var(--fgPrimary);
    outline-offset: -1px;
  }
  .initiativeRow--defeated {
    opacity: 0.5;
  }
  .initiativeRow--defeated .initiativeRow__title {
    text-decoration: line-through;
  }

  .initiativeRow__select {
    position: absolute;
    inset: 0;
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    cursor: pointer;
    border-radius: inherit;
  }
  .initiativeRow__turn,
  .initiativeRow__thumb,
  .initiativeRow__name,
  .initiativeRow__hp {
    position: relative;
    pointer-events: none;
    min-width: 0;
  }
  .initiativeRow__turn {
    display: flex;
    justify-content: center;
  }

  .initiativeRow__initiative {
    position: relative;
    z-index: 1;
    width: 3ch;
    background: transparent;
    border: none;
    color: var(--fg);
    font-weight: var(--font-weight-6);
    font-size: 1.125rem;
    text-align: center;
    padding: 0;
    cursor: text;
  }
  .initiativeRow__initiative::placeholder {
    color: var(--fgMuted);
  }
  .initiativeRow__initiative:focus {
    outline: var(--borderThin);
    outline-color: var(--fgPrimary);
    border-radius: var(--radius-2);
  }

  .initiativeRow__thumb {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .initiativeRow__thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .initiativeRow__fallback {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--bg);
    font-size: 0.6875rem;
    font-weight: var(--font-weight-6);
  }

  .initiativeRow__name {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-width: 0;
    overflow: hidden;
  }
  .initiativeRow__title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg);
  }
  .initiativeRow__condition {
    flex-shrink: 0;
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
  }
  .initiativeRow__icon {
    display: inline-flex;
    flex-shrink: 0;
    color: var(--fgMuted);
  }

  .initiativeRow__hp {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 3.5rem;
    font-size: 0.75rem;
    color: var(--fgMuted);
  }
  .initiativeRow__hpValue {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .initiativeRow__hpBar {
    display: block;
    height: 4px;
    border-radius: 2px;
    background: color-mix(in srgb, var(--fgMuted) 25%, transparent);
    overflow: hidden;
  }
  .initiativeRow__hpFill {
    display: block;
    height: 100%;
    background: var(--fgSuccess);
  }
  .initiativeRow__hpFill--low {
    background: var(--orange-6);
  }
  .initiativeRow__hpFill--critical {
    background: var(--fgDanger);
  }

  .initiativeRow__bonus {
    position: relative;
    z-index: 1;
    pointer-events: auto;
  }
  .initiativeRow__bonusChip {
    font-size: 0.8125rem;
    font-weight: var(--font-weight-6);
    padding: 0.125rem 0.5rem;
    border-radius: var(--radius-2);
    border: var(--borderThin);
    background: transparent;
    color: var(--fg);
    cursor: pointer;
    font-variant-numeric: tabular-nums;
  }
  .initiativeRow__bonusChip--automatic {
    color: var(--fgMuted);
    border-style: dashed;
  }
  .initiativeRow__bonusInput {
    width: 4ch;
    font-size: 0.8125rem;
    padding: 0.125rem 0.25rem;
    border-radius: var(--radius-2);
    border: var(--borderThin);
    background: var(--bg);
    color: var(--fg);
  }

  .initiativeRow__actions {
    position: absolute;
    right: 0.25rem;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    gap: 0.125rem;
    padding: 0.125rem;
    border-radius: var(--radius-2);
    background: var(--bg);
    opacity: 0;
    pointer-events: none;
    z-index: 2;
  }
  .initiativeRow:hover .initiativeRow__actions,
  .initiativeRow:focus-within .initiativeRow__actions {
    opacity: 1;
    pointer-events: auto;
  }
</style>
