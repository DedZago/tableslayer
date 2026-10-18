<script lang="ts">
  import { Button, Icon, IconButton, Input } from '@tableslayer/ui';
  import { IconChevronDown, IconChevronRight, IconDice5, IconMinus, IconPlus } from '@tabler/icons-svelte';
  import { formatModifier, rollFormula } from '$lib/utils/statBlock';
  import type { Ability, StatEntry, StatSpellcasting } from '$lib/utils/statBlock/types';
  import StatBlockInline from './StatBlockInline.svelte';
  import { applyDamage, applyHealing, clampHitPoints, clampTempHitPoints, hpFraction } from './hitPoints';
  import type { HitPointsFields, StatBlockPanelProps } from './types';

  let {
    statBlock,
    hitPoints = null,
    tempHitPoints = null,
    readonly = false,
    variant = 'full',
    collapsed,
    onCollapsedChange,
    onHitPointsChange,
    onRoll,
    headerActions
  }: StatBlockPanelProps = $props();

  const ABILITIES: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
  const ABILITY_LABELS: Record<Ability, string> = {
    str: 'Str',
    dex: 'Dex',
    con: 'Con',
    int: 'Int',
    wis: 'Wis',
    cha: 'Cha'
  };
  const SIZE_NAMES: Record<string, string> = {
    T: 'Tiny',
    S: 'Small',
    M: 'Medium',
    L: 'Large',
    H: 'Huge',
    G: 'Gargantuan'
  };

  let localCollapsed = $state(false);
  let amountInput = $state<number | null>(null);

  const isCollapsed = $derived(collapsed ?? localCollapsed);
  const max = $derived(statBlock.hp.average);
  const current = $derived(hitPoints ?? max ?? 0);
  const temp = $derived(tempHitPoints ?? 0);
  const fraction = $derived(hpFraction(current, max));
  const canEditHitPoints = $derived(!readonly && onHitPointsChange !== undefined);
  const hpBarClasses = $derived(
    fraction === null
      ? []
      : [fraction <= 0.5 && 'statBlock__hpBar--low', fraction <= 0.25 && 'statBlock__hpBar--critical']
  );
  const subtitle = $derived(
    [statBlock.size.map((size) => SIZE_NAMES[size] ?? size).join(' or ') + ' ' + statBlock.type, statBlock.alignment]
      .filter(Boolean)
      .join(', ')
  );
  const speedText = $derived(
    statBlock.speed
      .map(
        (speed) =>
          `${speed.mode === 'walk' ? '' : `${speed.mode} `}${speed.feet} ft.${speed.note ? ` (${speed.note})` : ''}`
      )
      .join(', ')
  );
  const propRows = $derived.by(() => {
    const rows: [string, string][] = [
      ['Skills', statBlock.skills.map((skill) => `${skill.name} ${skill.bonus}`).join(', ')],
      [
        'Senses',
        [...statBlock.senses, statBlock.passive ? `passive Perception ${statBlock.passive}` : '']
          .filter(Boolean)
          .join(', ')
      ],
      ['Languages', statBlock.languages.join(', ')],
      ['Damage vulnerabilities', statBlock.vulnerable.join(', ')],
      ['Damage resistances', statBlock.resist.join(', ')],
      ['Damage immunities', statBlock.immune.join(', ')],
      ['Condition immunities', statBlock.conditionImmune.join(', ')]
    ];
    return rows.filter(([, value]) => value);
  });

  const toggleCollapsed = () => {
    localCollapsed = !isCollapsed;
    onCollapsedChange?.(!isCollapsed);
  };

  const commitHitPoints = (fields: HitPointsFields) => onHitPointsChange?.(fields);
  const setCurrent = (value: number) => {
    const hitPoints = clampHitPoints(value, max);
    commitHitPoints({ hitPoints });
    return hitPoints;
  };
  const setTemp = (value: number) => {
    const tempHitPoints = clampTempHitPoints(value);
    commitHitPoints({ tempHitPoints });
    return tempHitPoints;
  };
  const applyAmount = (amount: number | null, isHealing: boolean) => {
    const size = Math.abs(Math.round(amount ?? 0));
    if (!size) return;
    if (isHealing) commitHitPoints({ hitPoints: applyHealing(current, size, max) });
    else commitHitPoints(applyDamage(current, temp, size, max));
  };
  const handleAmountKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    applyAmount(amountInput, event.shiftKey);
    amountInput = null;
  };
  // The inputs are one-way bound: show the committed value even when clamping leaves the prop unchanged
  const handleNumberChange = (apply: (value: number) => number, read: () => number) => (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const value = Number(input.value);
    const isValid = input.value.trim() !== '' && Number.isFinite(value);
    input.value = String(isValid ? apply(value) : read());
  };

  const roll = (label: string, formula: string) => onRoll?.(label, formula, rollFormula(formula));
  const hitFormula = (bonus: number) => `1d20${bonus < 0 ? '' : '+'}${bonus}`;

  const saveBonus = (score: { mod: number; save?: number }) =>
    score.save !== undefined && score.save !== score.mod ? score.save : undefined;
</script>

{#snippet entry(item: StatEntry)}
  <div class="statBlock__entry">
    <p class="statBlock__entryName">
      <StatBlockInline
        paragraphs={[item.nameInlines.length ? item.nameInlines : [{ kind: 'text', text: item.name }]]}
        inline
        rollLabel={item.name}
        {onRoll}
      />
    </p>
    {#if item.attack || item.save || item.recharge || item.cost}
      <div class="statBlock__entryChips">
        {#if item.attack}
          <button
            type="button"
            class="statBlock__chip statBlock__chip--hit statBlock__roll"
            onclick={() => roll(item.name, hitFormula(item.attack?.toHit ?? 0))}
          >
            <Icon Icon={IconDice5} size="0.875rem" />{formatModifier(item.attack.toHit)}
          </button>
        {/if}
        {#each item.attack?.damage ?? [] as damage}
          <button
            type="button"
            class="statBlock__chip statBlock__chip--damage statBlock__roll"
            onclick={() => roll(item.name, damage.formula)}
          >
            <Icon Icon={IconDice5} size="0.875rem" />{damage.formula}{damage.type ? ` ${damage.type}` : ''}
          </button>
        {/each}
        {#if item.save}
          <span class="statBlock__chip statBlock__chip--dc">
            DC {item.save.dc}{item.save.ability ? ` ${ABILITY_LABELS[item.save.ability]}` : ''}
          </span>
        {/if}
        {#if item.recharge}
          <span class="statBlock__entryNote">(Recharge {item.recharge >= 6 ? '6' : `${item.recharge}–6`})</span>
        {/if}
        {#if item.cost}
          <span class="statBlock__entryNote">(Costs {item.cost} actions)</span>
        {/if}
      </div>
    {/if}
    <StatBlockInline paragraphs={item.body} rollLabel={item.name} {onRoll} />
  </div>
{/snippet}

{#snippet entrySection(title: string, entries: StatEntry[], open: boolean)}
  {#if entries.length}
    <details class="statBlock__section" {open}>
      <summary class="statBlock__sectionTitle">{title}</summary>
      {#each entries as item}
        {@render entry(item)}
      {/each}
    </details>
  {/if}
{/snippet}

{#snippet propList()}
  <div class="statBlock__props">
    {#each propRows as [label, value]}
      <p class="statBlock__prop">
        <span class="statBlock__propLabel">{label}</span>
        {value}
      </p>
    {/each}
  </div>
{/snippet}

{#snippet spellcastingSection(spells: StatSpellcasting[])}
  <details class="statBlock__section">
    <summary class="statBlock__sectionTitle">Spellcasting</summary>
    {#each spells as spell}
      <div class="statBlock__entry">
        <p class="statBlock__entryName">
          {spell.name}
          {#if spell.dc !== undefined}<span class="statBlock__chip statBlock__chip--dc">DC {spell.dc}</span>{/if}
          {#if spell.toHit !== undefined}
            <button
              type="button"
              class="statBlock__chip statBlock__chip--hit statBlock__roll"
              onclick={() => roll(spell.name, hitFormula(spell.toHit ?? 0))}
            >
              <Icon Icon={IconDice5} size="0.875rem" />{formatModifier(spell.toHit)}
            </button>
          {/if}
        </p>
        <StatBlockInline paragraphs={spell.header} rollLabel={spell.name} {onRoll} />
        {#each spell.groups as group}
          <p class="statBlock__entryText">
            <span class="statBlock__em">{group.label}</span>
            {group.spells.join(', ')}
          </p>
        {/each}
        <StatBlockInline paragraphs={spell.footer} rollLabel={spell.name} {onRoll} />
      </div>
    {/each}
  </details>
{/snippet}

<section
  class={['statBlock', isCollapsed && 'statBlock--collapsed', variant === 'compact' && 'statBlock--compact']}
  aria-label={statBlock.name}
>
  <header class="statBlock__header">
    <div class="statBlock__titleGroup">
      <h3 class="statBlock__title">{statBlock.name}</h3>
      <span class="statBlock__crBadge">
        CR {statBlock.cr.display}{statBlock.cr.xp !== undefined ? ` · ${statBlock.cr.xp} XP` : ''} · PB +{statBlock.cr
          .pb}
      </span>
    </div>
    <div class="statBlock__headerEnd">
      {#if headerActions}{@render headerActions()}{/if}
      <IconButton
        variant="ghost"
        size="sm"
        class="statBlock__toggle"
        aria-expanded={!isCollapsed}
        aria-label={isCollapsed ? 'Expand stat block' : 'Collapse stat block'}
        onclick={toggleCollapsed}
      >
        <Icon Icon={isCollapsed ? IconChevronRight : IconChevronDown} size="1rem" />
      </IconButton>
    </div>
  </header>

  {#if !isCollapsed}
    <p class="statBlock__subtitle">{subtitle}</p>

    <div class="statBlock__vitals">
      <div class="statBlock__vital">
        <span class="statBlock__vitalLabel">AC</span>
        <span class="statBlock__vitalValue" title={statBlock.ac[0]?.note}>{statBlock.ac[0]?.value ?? '—'}</span>
      </div>

      <div class="statBlock__vital statBlock__hp">
        <span class="statBlock__vitalLabel">HP</span>
        {#if canEditHitPoints}
          <div class="statBlock__hpControls">
            <IconButton
              variant="ghost"
              size="sm"
              aria-label="Decrease hit points"
              onclick={() => setCurrent(current - 1)}
            >
              <Icon Icon={IconMinus} size="0.875rem" />
            </IconButton>
            <Input
              type="number"
              class="statBlock__hpInput"
              aria-label="Current hit points"
              value={current}
              onchange={handleNumberChange(setCurrent, () => current)}
            />
            <span class="statBlock__vitalValue" title={statBlock.hp.formula}>/ {max ?? '—'}</span>
            <IconButton
              variant="ghost"
              size="sm"
              aria-label="Increase hit points"
              onclick={() => setCurrent(current + 1)}
            >
              <Icon Icon={IconPlus} size="0.875rem" />
            </IconButton>
          </div>
          <div class="statBlock__hpControls">
            <Input
              type="number"
              class="statBlock__amountInput"
              placeholder="Amount"
              aria-label="Damage or heal amount, Enter to damage, Shift+Enter to heal"
              bind:value={amountInput}
              onkeydown={handleAmountKeydown}
            />
            <Button variant="ghost" size="sm" class="statBlock__damage" onclick={() => applyAmount(amountInput, false)}>
              Damage
            </Button>
            <Button variant="ghost" size="sm" onclick={() => applyAmount(amountInput, true)}>Heal</Button>
            <label class="statBlock__tempLabel">
              Temp
              <Input
                type="number"
                class="statBlock__tempInput"
                aria-label="Temporary hit points"
                value={temp}
                onchange={handleNumberChange(setTemp, () => temp)}
              />
            </label>
          </div>
        {:else}
          <span class="statBlock__vitalValue" title={statBlock.hp.formula}>
            {current}{max !== null ? ` / ${max}` : ''}
          </span>
        {/if}
        {#if fraction !== null}
          <div class="statBlock__hpTrack">
            <div class={['statBlock__hpBar', ...hpBarClasses]} style:width={`${fraction * 100}%`}></div>
          </div>
        {/if}
      </div>

      <div class="statBlock__vital">
        <span class="statBlock__vitalLabel">Speed</span>
        <span class="statBlock__vitalValue">{speedText || '—'}</span>
      </div>
    </div>

    <div class="statBlock__abilities">
      {#each ABILITIES as ability}
        {@const score = statBlock.abilities[ability]}
        {@const save = saveBonus(score)}
        <div class="statBlock__ability">
          <span class="statBlock__abilityName">{ABILITY_LABELS[ability]}</span>
          <span class="statBlock__abilityScore">{score.score}</span>
          <span
            class={['statBlock__abilityMod', save !== undefined && 'statBlock__abilitySave--proficient']}
            title={save !== undefined ? `Save ${formatModifier(save)}` : undefined}
          >
            {formatModifier(score.mod)}
          </span>
        </div>
      {/each}
    </div>

    {#if propRows.length}
      {#if variant === 'compact'}
        <details class="statBlock__section">
          <summary class="statBlock__sectionTitle">Proficiencies and resistances</summary>
          {@render propList()}
        </details>
      {:else}
        {@render propList()}
      {/if}
    {/if}
    {@render entrySection('Traits', statBlock.traits, false)}
    {@render entrySection('Actions', statBlock.actions, true)}
    {@render entrySection('Bonus actions', statBlock.bonusActions, false)}
    {@render entrySection('Reactions', statBlock.reactions, false)}
    {#if statBlock.legendary.length}
      <details class="statBlock__section">
        <summary class="statBlock__sectionTitle">
          Legendary actions{statBlock.legendaryCount !== undefined ? ` (${statBlock.legendaryCount})` : ''}
        </summary>
        {#if statBlock.legendaryHeader}
          <StatBlockInline paragraphs={statBlock.legendaryHeader} {onRoll} />
        {/if}
        {#each statBlock.legendary as item}
          {@render entry(item)}
        {/each}
      </details>
    {/if}
    {@render entrySection('Mythic actions', statBlock.mythic, false)}
    {#if statBlock.spellcasting.length}
      {@render spellcastingSection(statBlock.spellcasting)}
    {/if}
  {/if}
</section>

<style>
  .statBlock {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
    background: var(--surfaceBg);
    border: var(--borderThin);
    border-radius: var(--radius-2);
    color: var(--fg);
    font-size: 0.875rem;
  }

  .statBlock--compact {
    gap: 0.375rem;
    padding: 0.5rem;
    font-size: 0.8125rem;
  }

  .statBlock--compact .statBlock__title {
    font-size: 1rem;
  }

  .statBlock__header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .statBlock__titleGroup {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.5rem;
    min-width: 0;
  }

  .statBlock__title {
    margin: 0;
    font-size: 1.125rem;
    font-weight: var(--font-weight-6);
  }

  .statBlock__crBadge {
    font-size: 0.75rem;
    color: var(--fgMuted);
    white-space: nowrap;
  }

  .statBlock__headerEnd {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-shrink: 0;
  }

  .statBlock__subtitle {
    margin: 0;
    font-size: 0.75rem;
    font-style: italic;
    color: var(--fgMuted);
  }

  .statBlock__vitals {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1rem;
  }

  .statBlock__vital {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-width: 0;
  }

  .statBlock__hp {
    flex: 1 1 100%;
  }

  .statBlock__vitalLabel {
    font-size: 0.75rem;
    color: var(--fgMuted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .statBlock__vitalValue {
    font-weight: var(--font-weight-6);
  }

  .statBlock__hpControls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem;
  }

  .statBlock__hpInput,
  .statBlock__tempInput {
    width: 4.5rem;
  }

  .statBlock__amountInput {
    width: 6rem;
  }

  .statBlock__tempLabel {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    color: var(--fgMuted);
  }

  .statBlock .statBlock__damage {
    color: var(--fgDanger);
  }

  .statBlock__hpTrack {
    height: 0.375rem;
    width: 100%;
    background: var(--contrastLow);
    border-radius: var(--radius-1);
    overflow: hidden;
  }

  .statBlock__hpBar {
    height: 100%;
    background: var(--fgSuccess);
    transition: width 120ms ease-out;
  }

  .statBlock__hpBar--low {
    background: var(--orange-6);
  }

  .statBlock__hpBar--critical {
    background: var(--fgDanger);
  }

  .statBlock__abilities {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 0.25rem;
    text-align: center;
  }

  .statBlock__abilityName {
    display: block;
    font-size: 0.75rem;
    font-weight: var(--font-weight-6);
    text-transform: uppercase;
    color: var(--fgMuted);
  }

  .statBlock__abilityScore {
    display: block;
  }

  .statBlock__abilityMod {
    display: block;
    color: var(--fgMuted);
  }

  .statBlock__abilitySave--proficient {
    color: var(--fgPrimary);
    font-weight: var(--font-weight-6);
  }

  .statBlock__props {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .statBlock__prop {
    margin: 0;
  }

  .statBlock__propLabel {
    font-weight: var(--font-weight-6);
    margin-right: 0.25rem;
  }

  .statBlock__section {
    border-top: var(--borderThin);
    padding-top: 0.5rem;
  }

  .statBlock__sectionTitle {
    cursor: pointer;
    font-weight: var(--font-weight-6);
    font-size: 0.875rem;
  }

  .statBlock__entry {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.375rem 0;
  }

  .statBlock__entryName {
    margin: 0;
    font-weight: var(--font-weight-6);
  }

  .statBlock__entryChips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
  }

  .statBlock__entryNote {
    font-size: 0.75rem;
    color: var(--fgMuted);
  }

  .statBlock__entryText {
    margin: 0;
    line-height: 1.4;
  }

  .statBlock__chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.0625rem 0.375rem;
    font: inherit;
    font-size: 0.75rem;
    border: var(--borderThin);
    border-radius: var(--radius-1);
    background: var(--inputBg);
  }

  .statBlock__chip--dc {
    color: var(--fgMuted);
  }

  .statBlock__roll {
    cursor: pointer;
    color: var(--fg);
  }

  .statBlock__roll:hover {
    background: var(--menuItemHover);
  }

  .statBlock__em {
    font-style: italic;
  }

  .statBlock__ref {
    font-style: italic;
    text-decoration: underline dotted;
    text-underline-offset: 0.2em;
    cursor: default;
  }
</style>
