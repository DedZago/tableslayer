<script lang="ts">
  import type { RadialMenuItemProps } from './types';
  import EffectPreview from './EffectPreview.svelte';

  interface Props {
    item: RadialMenuItemProps;
    angle: number;
    radius: number;
    counterRotation: number;
    focused: boolean;
    onSelect: (itemId: string) => void;
    onFocus: (itemId: string) => void;
  }

  const { item, angle, radius, counterRotation, focused, onSelect, onFocus }: Props = $props();

  const x = $derived(Math.cos(angle) * radius);
  const y = $derived(Math.sin(angle) * radius);
  const isSwatch = $derived(item.color !== undefined && item.effectType === undefined);
</script>

<!-- Disabled options stay pressable so the hub can say why they are off -->
<button
  class={[
    'radialMenuItem',
    item.active && 'radialMenuItem--active',
    item.danger && 'radialMenuItem--danger',
    item.disabled && 'radialMenuItem--disabled',
    focused && 'radialMenuItem--focused',
    item.submenu?.length && 'radialMenuItem--hasSubmenu'
  ]}
  style:--accent={item.accent ?? 'var(--fg)'}
  style:transform="translate({x}px, {y}px) rotate({-counterRotation}deg)"
  type="button"
  aria-label={item.label}
  aria-disabled={item.disabled}
  aria-pressed={item.active}
  onpointerdown={() => onFocus(item.id)}
  onpointerenter={(event) => event.pointerType === 'mouse' && onFocus(item.id)}
  onclick={() => onSelect(item.id)}
>
  <span class="radialMenuItem__circle">
    {#if item.effectType !== undefined}
      <EffectPreview effectType={item.effectType} size="100%" />
    {:else if isSwatch}
      <span class="radialMenuItem__swatch" style:background={item.color}></span>
    {:else if item.icon}
      <item.icon size={28} stroke={2} />
    {/if}
    {#if item.badge !== undefined}
      <span class="radialMenuItem__badge">{item.badge}</span>
    {/if}
  </span>
  <span class="radialMenuItem__label">{item.label}</span>
</button>

<style>
  .radialMenuItem {
    position: absolute;
    top: 0;
    left: 0;
    width: 4rem;
    height: 4rem;
    margin: -2rem 0 0 -2rem;
    padding: 0;
    background: none;
    border: none;
    color: var(--fg);
    cursor: pointer;
    pointer-events: auto;
    touch-action: none;
    -webkit-tap-highlight-color: transparent;
  }

  .radialMenuItem__circle {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    overflow: visible;
    color: var(--accent);
    background: var(--bg);
    border: 2px solid color-mix(in srgb, var(--accent) 45%, transparent);
    border-radius: 50%;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
    transition:
      transform 0.12s ease-out,
      background 0.12s ease-out;
  }

  .radialMenuItem--hasSubmenu .radialMenuItem__circle {
    border-style: double;
    border-width: 4px;
  }

  .radialMenuItem--focused .radialMenuItem__circle {
    transform: scale(1.12);
    border-color: var(--accent);
  }

  .radialMenuItem--active .radialMenuItem__circle {
    color: var(--bg);
    background: var(--accent);
    border-color: var(--fg);
  }

  .radialMenuItem--danger {
    --accent: var(--fgDanger);
  }

  .radialMenuItem--disabled .radialMenuItem__circle {
    opacity: 0.4;
  }

  .radialMenuItem__swatch {
    width: 100%;
    height: 100%;
    border-radius: 50%;
  }

  .radialMenuItem__badge {
    position: absolute;
    top: -0.25rem;
    right: -0.25rem;
    min-width: 1.375rem;
    height: 1.375rem;
    padding: 0 0.25rem;
    font-size: 0.75rem;
    font-weight: 700;
    line-height: 1.375rem;
    color: var(--bg);
    background: var(--fg);
    border-radius: 0.6875rem;
  }

  .radialMenuItem__label {
    position: absolute;
    top: calc(100% + 0.25rem);
    left: 50%;
    max-width: 7rem;
    padding: 0.0625rem 0.375rem;
    transform: translateX(-50%);
    font-size: 0.8125rem;
    font-weight: 600;
    line-height: 1.2;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--fg);
    background: color-mix(in srgb, var(--bg) 85%, transparent);
    border-radius: 0.375rem;
    pointer-events: none;
  }

  .radialMenuItem--disabled .radialMenuItem__label {
    color: var(--fgMuted);
  }
</style>
