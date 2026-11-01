<script lang="ts">
  import type { RadialMenuProps, RadialMenuItemProps } from './types';
  import RadialMenuItem from './RadialMenuItem.svelte';
  import { untrack } from 'svelte';
  import { normalizeRotation, unwrapAngleDelta, wheelRotationDegrees } from './rotation';

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
    onReposition,
    rotation,
    onRotationChange
  }: RadialMenuProps = $props();

  const ITEM_SPACING_PX = 100; // arc length per option, room for the button and its label
  const MIN_RADIUS_PX = 140;
  const TWIST_START_DEG = 8;
  const TWO_FINGER_MOVE_PX = 12;
  const WHEEL_PERSIST_DELAY_MS = 250;

  // Submenu ids from the top level down. Levels are re-read from `items`, so options that change
  // while the menu is open (a condition toggled on) update in place.
  let path: string[] = $state([]);
  // The press that opened the menu (a long press) ends over it; only clicks that also started on it count
  let armed = false;
  let focusedId: string | null = $state(null);
  let adjustedPosition = $state({ x: 0, y: 0 });
  let menuRotation = $state(0);
  let rootElement: HTMLDivElement | null = $state(null);

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

  const itemAngle = (index: number, total: number) => -Math.PI / 2 + ((2 * Math.PI) / total) * index;

  const close = () => {
    path = [];
    focusedId = null;
    onClose?.();
  };

  // One level up, or closed at the top level: the hub and any tap outside the ring both do this
  const back = () => {
    if (!armed || twisted) return;
    focusedId = null;
    if (depth === 0) close();
    else path = path.slice(0, depth - 1);
  };

  const select = (itemId: string) => {
    if (!armed || twisted) return;
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

  // A twist ends with a click on whatever is under the fingers; it must not count as a press
  let twisted = false;
  let twist: {
    lastAngle: number;
    total: number;
    startRotation: number;
    startMid: { x: number; y: number };
    active: boolean;
  } | null = null;
  let pendingRotation: number | null = null;
  let frameId: number | null = null;

  const touchAngle = (a: Touch, b: Touch) => (Math.atan2(b.clientY - a.clientY, b.clientX - a.clientX) * 180) / Math.PI;
  const touchMidpoint = (a: Touch, b: Touch) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });

  const flushRotation = () => {
    frameId = null;
    if (pendingRotation !== null) menuRotation = pendingRotation;
    pendingRotation = null;
  };

  const endTwist = () => {
    if (!twist) return;
    const wasActive = twist.active;
    twist = null;
    if (frameId !== null) cancelAnimationFrame(frameId);
    flushRotation();
    if (wasActive) onRotationChange?.(normalizeRotation(menuRotation));
  };

  // Wheel turns are stored once the wheel has been still for a moment
  let wheelPersistTimer: ReturnType<typeof setTimeout> | null = null;

  const flushWheelRotation = () => {
    if (!wheelPersistTimer) return;
    clearTimeout(wheelPersistTimer);
    wheelPersistTimer = null;
    if (frameId !== null) cancelAnimationFrame(frameId);
    flushRotation();
    onRotationChange?.(normalizeRotation(menuRotation));
  };

  const handleWheel = (event: WheelEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (twist) return;
    const degrees = wheelRotationDegrees(event.deltaY, event.deltaMode, window.innerHeight);
    if (!degrees) return;
    // Clockwise on screen lowers menuRotation, like a twist
    pendingRotation = (pendingRotation ?? menuRotation) - degrees;
    frameId ??= requestAnimationFrame(flushRotation);
    if (wheelPersistTimer) clearTimeout(wheelPersistTimer);
    wheelPersistTimer = setTimeout(flushWheelRotation, WHEEL_PERSIST_DELAY_MS);
    restartAutoClose();
  };

  const handleTouchStart = (event: TouchEvent) => {
    if (event.touches.length === 1) twisted = false;
    if (event.touches.length > 2) return endTwist();
    if (event.touches.length !== 2) return;
    const [a, b] = [event.touches[0], event.touches[1]];
    twist = {
      lastAngle: touchAngle(a, b),
      total: 0,
      startRotation: menuRotation,
      startMid: touchMidpoint(a, b),
      active: false
    };
  };

  const handleTouchMove = (event: TouchEvent) => {
    if (!twist || event.touches.length !== 2) return;
    event.preventDefault();
    const [a, b] = [event.touches[0], event.touches[1]];
    const angle = touchAngle(a, b);
    twist.total += unwrapAngleDelta(angle - twist.lastAngle);
    twist.lastAngle = angle;
    const mid = touchMidpoint(a, b);
    const moved = Math.hypot(mid.x - twist.startMid.x, mid.y - twist.startMid.y);
    if (moved > TWO_FINGER_MOVE_PX || Math.abs(twist.total) > TWIST_START_DEG) cancelTwoFingerHold();
    // Start following from here so the menu does not jump by the threshold
    if (!twist.active && Math.abs(twist.total) > TWIST_START_DEG) {
      twist.active = true;
      twisted = true;
      twist.total = 0;
      twist.startRotation = menuRotation;
    }
    if (!twist.active) return;
    // The menu turns the same way as the fingers; the container is drawn rotated by -menuRotation
    pendingRotation = twist.startRotation - twist.total;
    frameId ??= requestAnimationFrame(flushRotation);
    restartAutoClose();
  };

  const handleTouchEnd = (event: TouchEvent) => {
    if (event.touches.length < 2) endTwist();
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

  // Passive listeners cannot stop the page from pinch-zooming, so these are attached by hand
  $effect(() => {
    const element = rootElement;
    if (!element) return;
    const options = { capture: true, passive: false } as const;
    element.addEventListener('touchstart', handleTouchStart, options);
    element.addEventListener('touchmove', handleTouchMove, options);
    element.addEventListener('touchend', handleTouchEnd, options);
    element.addEventListener('touchcancel', handleTouchEnd, options);
    element.addEventListener('wheel', handleWheel, options);
    return () => {
      element.removeEventListener('wheel', handleWheel, options);
      flushWheelRotation();
      element.removeEventListener('touchstart', handleTouchStart, options);
      element.removeEventListener('touchmove', handleTouchMove, options);
      element.removeEventListener('touchend', handleTouchEnd, options);
      element.removeEventListener('touchcancel', handleTouchEnd, options);
      twist = null;
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = null;
      pendingRotation = null;
    };
  });

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

  // Open at the remembered rotation, or toward the nearest edge the first time. Only opening sets it:
  // a new position, a submenu or a stale `rotation` prop must not undo a turn made while open
  $effect(() => {
    if (!visible) return;
    untrack(() => {
      twisted = false;
      const remembered = rotation;
      menuRotation = remembered ?? rotationFromEdge(position.x, position.y, window.innerWidth, window.innerHeight);
      if (remembered === undefined) onRotationChange?.(menuRotation);
    });
  });

  // Keep the whole ring on screen
  $effect(() => {
    if (!visible) return;
    const reach = radius + 80;
    const width = window.innerWidth;
    const height = window.innerHeight;
    adjustedPosition = {
      x: Math.max(reach, Math.min(width - reach, position.x)),
      y: Math.max(reach, Math.min(height - reach, position.y))
    };
  });
</script>

{#if visible}
  <div
    class="radialMenu"
    bind:this={rootElement}
    onpointerdowncapture={(event) => {
      if (event.pointerType === 'mouse') twisted = false;
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

    <div
      class="radialMenu__container"
      style:left="{adjustedPosition.x}px"
      style:top="{adjustedPosition.y}px"
      style:transform="rotate({-menuRotation}deg)"
    >
      <div class="radialMenu__ring" style:width="{radius * 2}px" style:height="{radius * 2}px"></div>

      <button
        class="radialMenu__hub"
        type="button"
        style:transform="translate(-50%, -50%)"
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
    touch-action: none;
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
    will-change: transform;
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
