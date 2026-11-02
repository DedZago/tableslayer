<script lang="ts">
  let {
    prompt,
    castLabel,
    onCast,
    onCancel,
    size = 'md'
  }: {
    prompt: string;
    /** Target aim: the confirm button's label; it is hidden without one */
    castLabel?: string | null;
    onCast?: () => void;
    onCancel: () => void;
    /** `lg` reads from across the table on the TV */
    size?: 'md' | 'lg';
  } = $props();
</script>

<div class="spellAimBar spellAimBar--{size}" role="status">
  <span class="spellAimBar__prompt">{prompt}</span>
  {#if castLabel && onCast}
    <button type="button" class="spellAimBar__button spellAimBar__button--cast" onclick={onCast}>{castLabel}</button>
  {/if}
  <button type="button" class="spellAimBar__button" onclick={onCancel}>Cancel</button>
</div>

<style>
  .spellAimBar {
    position: fixed;
    top: 1rem;
    left: 50%;
    z-index: 1001;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    max-width: calc(100vw - 2rem);
    padding: 0.5rem 0.75rem 0.5rem 1rem;
    transform: translateX(-50%);
    font-size: 0.875rem;
    color: var(--fg);
    background: color-mix(in srgb, var(--bg) 90%, transparent);
    border: 1px solid var(--fgMuted);
    border-radius: 0.75rem;
  }

  .spellAimBar--lg {
    top: 1.5rem;
    gap: 1rem;
    max-width: min(36rem, calc(100vw - 2rem));
    padding: 0.75rem 1.25rem;
    font-size: 1.125rem;
  }

  .spellAimBar__prompt {
    min-width: 0;
    text-align: center;
  }

  .spellAimBar__button {
    flex-shrink: 0;
    padding: 0.25rem 0.75rem;
    font: inherit;
    color: var(--fg);
    background: transparent;
    border: 1px solid var(--fgMuted);
    border-radius: 0.5rem;
    cursor: pointer;
  }

  .spellAimBar__button--cast {
    color: var(--bg);
    background: var(--fgPrimary);
    border-color: var(--fgPrimary);
  }
</style>
