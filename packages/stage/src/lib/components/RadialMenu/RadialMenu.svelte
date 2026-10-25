<script lang="ts">
  import type { RadialMenuProps, RadialMenuItemProps } from './types';
  import RadialMenuItem from './RadialMenuItem.svelte';

  const {
    visible = false,
    position,
    items,
    title,
    subtitle,
    backIcon,
    closeIcon,
    autoCloseMs,
    onItemSelect,
    onClose,
    onReposition
  }: RadialMenuProps = $props();

  const ITEM_SPACING_PX = 100; // arc length per option, room for the button and its label
  const MIN_RADIUS_PX = 140;

  // Submenu ids from the top level down. Levels are re-read from `items`, so options that change
  // while the menu is open (a condition toggled on) update in place.
  let path: string[] = $state([]);
  // The press that opened the menu (a long press) ends over it; only clicks that also started on it count
  let armed = false;
  let focusedId: string | null = $state(null);
  let adjustedPosition = $state({ x: 0, y: 0 });
  let menuRotation = $state(0);

  const levels = $derived.by(() => {
    const result: Array<{ parent: RadialMenuItemProps | null; items: RadialMenuItemProps[] }> = [
      { parent: null, items }
    ];
    for (const id of path) {
      const parent = result[result.length - 1].items.find((item) => item.id === id);
      if (!parent?.submenu?.length) break;
      result.push({ parent, items: parent.submenu });
    }
    return result;
  });
  const level = $derived(levels[levels.length - 1]);
  const depth = $derived(levels.length - 1);
  const radius = $derived(Math.max(MIN_RADIUS_PX, (level.items.length * ITEM_SPACING_PX) / (2 * Math.PI)));
  const focused = $derived(level.items.find((item) => item.id === focusedId));
  const hubTitle = $derived(focused?.label ?? level.parent?.label ?? title ?? '');
  const hubHint = $derived(focused?.hint ?? (focused ? '' : (level.parent?.hint ?? subtitle ?? '')));

  // Items face the nearest screen edge, where the person who opened the menu is sitting
  const rotationFromEdge = (x: number, y: number, width: number, height: number): number => {
    const distances = [height - y, width - x, y, x];
    const nearest = distances.indexOf(Math.min(...distances));
    return [0, 90, 180, 270][nearest];
  };

  // The ring, its labels and the hub all turn by -menuRotation, so they read upright from that edge
  const itemAngle = (index: number, total: number) =>
    -Math.PI / 2 + ((2 * Math.PI) / total) * index - (menuRotation * Math.PI) / 180;

  const close = () => {
    path = [];
    focusedId = null;
    onClose?.();
  };

  // One level up, or closed at the top level: the hub and any tap outside the ring both do this
  const back = () => {
    if (!armed) return;
    focusedId = null;
    if (depth === 0) close();
    else path = path.slice(0, depth - 1);
  };

  const select = (itemId: string) => {
    if (!armed) return;
    const item = level.items.find((candidate) => candidate.id === itemId);
    if (!item) return;
    if (item.disabled) {
      focusedId = item.id;
      return;
    }
    if (item.submenu?.length) {
      path = [...path.slice(0, depth), item.id];
      focusedId = null;
      return;
    }
    onItemSelect?.(item.id);
    if (!item.keepOpen) close();
  };

  const reposition = (point: { x: number; y: number }) => {
    path = [];
    focusedId = null;
    onReposition?.(point);
  };

  // Two-finger hold on the backdrop moves the menu, like opening it
  let twoFingerTimer: ReturnType<typeof setTimeout> | null = null;
  const cancelTwoFingerHold = () => {
    if (twoFingerTimer) clearTimeout(twoFingerTimer);
    twoFingerTimer = null;
  };
  const handleBackdropTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 2 || !onReposition) return;
    const point = {
      x: (event.touches[0].clientX + event.touches[1].clientX) / 2,
      y: (event.touches[0].clientY + event.touches[1].clientY) / 2
    };
    cancelTwoFingerHold();
    twoFingerTimer = setTimeout(() => reposition(point), 500);
  };

  const handleBackdropContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    if (onReposition) reposition({ x: event.clientX, y: event.clientY });
  };

  let autoCloseTimer: ReturnType<typeof setTimeout> | null = null;
  const restartAutoClose = () => {
    if (autoCloseTimer) clearTimeout(autoCloseTimer);
    autoCloseTimer = visible && autoCloseMs ? setTimeout(close, autoCloseMs) : null;
  };

  $effect(() => {
    if (!visible) {
      path = [];
      focusedId = null;
    }
    armed = false;
    restartAutoClose();
    return () => {
      if (autoCloseTimer) clearTimeout(autoCloseTimer);
      cancelTwoFingerHold();
    };
  });

  // Keep the whole ring on screen and turn it toward the nearest edge
  $effect(() => {
    if (!visible) return;
    const reach = radius + 80;
    const width = window.innerWidth;
    const height = window.innerHeight;
    adjustedPosition = {
      x: Math.max(reach, Math.min(width - reach, position.x)),
      y: Math.max(reach, Math.min(height - reach, position.y))
    };
    menuRotation = rotationFromEdge(position.x, position.y, width, height);
  });
</script>

{#if visible}
  <div
    class="radialMenu"
    onpointerdowncapture={() => {
      armed = true;
      restartAutoClose();
    }}
  >
    <button
      class="radialMenu__backdrop"
      type="button"
      aria-label={depth > 0 ? 'Back' : 'Close menu'}
      onclick={back}
      oncontextmenu={handleBackdropContextMenu}
      ontouchstart={handleBackdropTouchStart}
      ontouchend={cancelTwoFingerHold}
      ontouchmove={(event) => event.touches.length !== 2 && cancelTwoFingerHold()}
      ontouchcancel={cancelTwoFingerHold}
    ></button>

    <div class="radialMenu__container" style:left="{adjustedPosition.x}px" style:top="{adjustedPosition.y}px">
      <div class="radialMenu__ring" style:width="{radius * 2}px" style:height="{radius * 2}px"></div>

      <button
        class="radialMenu__hub"
        type="button"
        style:transform="translate(-50%, -50%) rotate({-menuRotation}deg)"
        aria-label={depth > 0 ? `Back from ${level.parent?.label}` : 'Close menu'}
        onclick={back}
      >
        <span class="radialMenu__hubTitle">{hubTitle}</span>
        {#if hubHint}
          <span class="radialMenu__hubHint">{hubHint}</span>
        {/if}
        <span class="radialMenu__hubAction">
          {#if depth > 0 && backIcon}
            {@const BackIcon = backIcon}
            <BackIcon size={14} stroke={2} />
          {:else if depth === 0 && closeIcon}
            {@const CloseIcon = closeIcon}
            <CloseIcon size={14} stroke={2} />
          {/if}
          {depth > 0 ? 'Back' : 'Close'}
        </span>
      </button>

      {#each level.items as item, index (item.id)}
        <RadialMenuItem
          {item}
          angle={itemAngle(index, level.items.length)}
          {radius}
          counterRotation={menuRotation}
          focused={focusedId === item.id}
          onSelect={select}
          onFocus={(id) => (focusedId = id)}
        />
      {/each}
    </div>
  </div>
{/if}

<style>
  .radialMenu {
    position: fixed;
    inset: 0;
    z-index: 1000;
    pointer-events: auto;
  }

  .radialMenu__backdrop {
    position: absolute;
    inset: 0;
    padding: 0;
    background: color-mix(in srgb, var(--bg) 25%, transparent);
    border: none;
    cursor: pointer;
  }

  .radialMenu__container {
    position: absolute;
    width: 0;
    height: 0;
    pointer-events: none;
  }

  .radialMenu__ring {
    position: absolute;
    top: 0;
    left: 0;
    transform: translate(-50%, -50%);
    border: 1px dashed color-mix(in srgb, var(--fg) 25%, transparent);
    border-radius: 50%;
  }

  .radialMenu__hub {
    position: absolute;
    top: 0;
    left: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    width: 9.5rem;
    height: 9.5rem;
    padding: 1rem;
    color: var(--fg);
    text-align: center;
    background: color-mix(in srgb, var(--bg) 92%, transparent);
    border: 1px solid var(--fgMuted);
    border-radius: 50%;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
    cursor: pointer;
    pointer-events: auto;
    -webkit-tap-highlight-color: transparent;
  }

  .radialMenu__hubTitle {
    max-width: 100%;
    overflow: hidden;
    font-size: 0.9375rem;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .radialMenu__hubHint {
    display: -webkit-box;
    overflow: hidden;
    font-size: 0.75rem;
    line-height: 1.25;
    color: var(--fgMuted);
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 4;
    line-clamp: 4;
  }

  .radialMenu__hubAction {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    margin-top: 0.125rem;
    font-size: 0.6875rem;
    font-weight: 600;
    color: var(--fgMuted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
</style>
