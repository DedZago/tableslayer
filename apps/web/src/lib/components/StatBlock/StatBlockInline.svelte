<script lang="ts">
  import { Icon } from '@tableslayer/ui';
  import { IconDice5 } from '@tabler/icons-svelte';
  import { formatModifier, rollFormula } from '$lib/utils/statBlock';
  import type { Inline } from '$lib/utils/statBlock/types';
  import type { StatBlockInlineProps } from './types';

  let { paragraphs, inline = false, rollLabel = '', onRoll }: StatBlockInlineProps = $props();

  const roll = (formula: string) => onRoll?.(rollLabel, formula, rollFormula(formula));
  const hitFormula = (bonus: number) => `1d20${bonus < 0 ? '' : '+'}${bonus}`;
  const rechargeText = (min: number) => (min >= 6 ? '(Recharge 6)' : `(Recharge ${min}–6)`);
</script>

{#snippet item(node: Inline)}
  {#if node.kind === 'text'}
    {node.text}
  {:else if node.kind === 'hit'}
    <button
      type="button"
      class="statBlock__chip statBlock__chip--hit statBlock__roll"
      onclick={() => roll(hitFormula(node.bonus))}
    >
      <Icon Icon={IconDice5} size="0.875rem" />{formatModifier(node.bonus)}
    </button>
  {:else if node.kind === 'damage'}
    <button
      type="button"
      class="statBlock__chip statBlock__chip--damage statBlock__roll"
      onclick={() => roll(node.formula)}
    >
      <Icon Icon={IconDice5} size="0.875rem" />{node.formula}
    </button>
  {:else if node.kind === 'dice'}
    <button type="button" class="statBlock__chip statBlock__roll" onclick={() => roll(node.formula)}>
      <Icon Icon={IconDice5} size="0.875rem" />{node.formula}
    </button>
  {:else if node.kind === 'dc'}
    <span class="statBlock__chip statBlock__chip--dc">DC {node.dc}</span>
  {:else if node.kind === 'attack'}
    <span class="statBlock__em">{node.label}</span>
  {:else if node.kind === 'ref'}
    <span class="statBlock__ref" title={node.refType}>{node.text}</span>
  {:else if node.kind === 'recharge'}
    {rechargeText(node.min)}
  {:else if node.kind === 'em'}
    <span class="statBlock__em">{node.text}</span>
  {/if}
{/snippet}

{#if inline}
  {#each paragraphs as paragraph}
    {#each paragraph as node}{@render item(node)}{/each}
  {/each}
{:else}
  {#each paragraphs as paragraph}
    <p class="statBlock__entryText">
      {#each paragraph as node}{@render item(node)}{/each}
    </p>
  {/each}
{/if}
