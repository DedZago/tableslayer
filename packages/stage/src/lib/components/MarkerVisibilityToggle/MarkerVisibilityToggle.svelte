<script lang="ts">
  import { IconEye, IconEyeOff } from '@tabler/icons-svelte';

  interface Props {
    /** Position of the token centre in container pixels */
    position: { x: number; y: number };
    /** Token diameter in container pixels */
    diameter: number;
    hidden: boolean;
    onToggle: () => void;
  }

  const { position, diameter, hidden, onToggle }: Props = $props();

  const label = $derived(hidden ? 'Show token to players' : 'Hide token from players');
</script>

<button
  type="button"
  class="markerVisibilityToggle"
  class:markerVisibilityToggle--hidden={hidden}
  style:left="{position.x}px"
  style:top="{position.y - diameter / 2}px"
  aria-label={label}
  title={label}
  onpointerdown={(event) => event.stopPropagation()}
  onclick={onToggle}
>
  {#if hidden}
    <IconEyeOff size={20} />
  {:else}
    <IconEye size={20} />
  {/if}
</button>

<style>
  .markerVisibilityToggle {
    position: absolute;
    z-index: 3;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    padding: 0;
    transform: translate(-50%, calc(-100% - 0.25rem));
    color: var(--fg);
    background: var(--surfaceBg);
    border: var(--borderThin);
    border-radius: 50%;
    box-shadow: var(--shadow-1);
    cursor: pointer;
    touch-action: manipulation;
  }

  .markerVisibilityToggle:hover {
    background: var(--menuItemHover);
  }

  .markerVisibilityToggle--hidden {
    color: var(--fgDanger);
  }
</style>
