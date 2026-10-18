<script lang="ts">
  import { Button } from '@tableslayer/ui';
  import StatBlockPanel from './StatBlockPanel.svelte';
  import type { StatBlockQuickCardProps } from './types';

  let {
    statBlock,
    hitPoints,
    tempHitPoints,
    collapsed,
    onCollapsedChange,
    onHitPointsChange,
    onRoll,
    onOpenFullStatBlock
  }: StatBlockQuickCardProps = $props();
</script>

{#snippet fullStatBlockButton()}
  <Button variant="ghost" size="sm" onclick={onOpenFullStatBlock}>Full stat block</Button>
{/snippet}

<div class="statBlockQuickCard">
  <StatBlockPanel
    {statBlock}
    {hitPoints}
    {tempHitPoints}
    variant="compact"
    {collapsed}
    {onCollapsedChange}
    {onHitPointsChange}
    {onRoll}
    headerActions={onOpenFullStatBlock ? fullStatBlockButton : undefined}
  />
</div>

<style>
  .statBlockQuickCard {
    position: absolute;
    left: 1rem;
    bottom: 1rem;
    z-index: 2;
    width: min(22rem, 40vw);
    max-height: 45vh;
    overflow-y: auto;
    border-radius: var(--radius-2);
    box-shadow: var(--shadow-1);
  }
</style>
