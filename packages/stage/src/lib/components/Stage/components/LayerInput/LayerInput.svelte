<script lang="ts">
  import * as THREE from 'three';
  import { getContext, onDestroy, onMount } from 'svelte';
  import { useThrelte } from '@threlte/core';
  import type { Size } from '../../types';
  import { SceneLayer } from '../Scene/types';

  interface Props {
    id?: string;
    isActive: boolean;
    /**
     * Overrides isActive for the contextmenu handler only, letting a layer
     * keep right-click behavior while it is not the active drawing layer
     */
    isContextMenuActive?: boolean;
    target?: THREE.Mesh;
    layerSize?: Size | null;
    onMouseDown?: (e: MouseEvent | TouchEvent, coords: THREE.Vector2 | null) => void;
    onMouseUp?: (e: MouseEvent | TouchEvent, coords: THREE.Vector2 | null) => void;
    onMouseMove?: (e: MouseEvent | TouchEvent, coords: THREE.Vector2 | null) => void;
    onContextMenu?: (e: MouseEvent | TouchEvent, coords: THREE.Vector2 | null) => void;
    /**
     * Touch-only double-tap, gated like onContextMenu (isContextMenuActive
     * overrides isActive). Fires on the second tap's touchstart, independent
     * of the debounced drawing handlers.
     */
    onDoubleTap?: (e: TouchEvent, coords: THREE.Vector2 | null) => void;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
    onWheel?: (e: WheelEvent) => void;
  }

  let {
    id,
    layerSize,
    isActive,
    isContextMenuActive,
    target,
    onMouseDown,
    onMouseUp,
    onMouseMove,
    onMouseEnter,
    onMouseLeave,
    onWheel,
    onContextMenu,
    onDoubleTap
  }: Props = $props();

  const { camera, renderer, size } = useThrelte();
  const stage = getContext<{ altPansView?: boolean } | undefined>('stage');

  let raycaster = new THREE.Raycaster();
  raycaster.layers.enable(SceneLayer.Overlay);
  raycaster.layers.enable(SceneLayer.Main);
  raycaster.layers.enable(SceneLayer.Input);

  // Track pending touch to detect multi-touch gestures
  let touchStartTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingTouchEvent: TouchEvent | null = null;
  let pendingTouchCoords: THREE.Vector2 | null = null;
  let isDrawing = false;

  // Bind events to the renderer's canvas element
  onMount(() => {
    // Mouse events
    if (onMouseDown) renderer.domElement.addEventListener('mousedown', handleMouseDown);
    if (onMouseMove) renderer.domElement.addEventListener('mousemove', handleMouseMove);
    if (onMouseUp) renderer.domElement.addEventListener('mouseup', handleMouseUp);
    if (onMouseEnter) renderer.domElement.addEventListener('mouseenter', handleMouseEnter);
    if (onMouseLeave) renderer.domElement.addEventListener('mouseleave', handleMouseLeave);
    if (onContextMenu) renderer.domElement.addEventListener('contextmenu', handleContextMenu);
    if (onWheel) renderer.domElement.addEventListener('wheel', handleWheel);

    // Touch events
    if (onMouseDown) renderer.domElement.addEventListener('touchstart', handleTouchStart);
    if (onMouseMove) renderer.domElement.addEventListener('touchmove', handleTouchMove);
    if (onMouseUp) renderer.domElement.addEventListener('touchend', handleTouchEnd);
    if (onMouseUp || onMouseLeave) renderer.domElement.addEventListener('touchcancel', handleTouchCancel);
    if (onDoubleTap) renderer.domElement.addEventListener('touchstart', handleDoubleTapTouchStart);
  });

  onDestroy(() => {
    // Clean up any pending timers
    if (touchStartTimer) {
      clearTimeout(touchStartTimer);
      touchStartTimer = null;
    }

    // Mouse events
    if (onMouseDown) renderer.domElement.removeEventListener('mousedown', handleMouseDown);
    if (onMouseMove) renderer.domElement.removeEventListener('mousemove', handleMouseMove);
    if (onMouseUp) renderer.domElement.removeEventListener('mouseup', handleMouseUp);
    if (onMouseEnter) renderer.domElement.removeEventListener('mouseenter', handleMouseEnter);
    if (onMouseLeave) renderer.domElement.removeEventListener('mouseleave', handleMouseLeave);
    if (onContextMenu) renderer.domElement.removeEventListener('contextmenu', handleContextMenu);
    if (onWheel) renderer.domElement.removeEventListener('wheel', handleWheel);

    // Touch events
    if (onMouseDown) renderer.domElement.removeEventListener('touchstart', handleTouchStart);
    if (onMouseMove) renderer.domElement.removeEventListener('touchmove', handleTouchMove);
    if (onMouseUp) renderer.domElement.removeEventListener('touchend', handleTouchEnd);
    if (onMouseUp || onMouseLeave) renderer.domElement.removeEventListener('touchcancel', handleTouchCancel);
    if (onDoubleTap) renderer.domElement.removeEventListener('touchstart', handleDoubleTapTouchStart);
  });

  export function getId() {
    return id;
  }

  // Internal event handler methods for mouse
  function handleMouseDown(event: MouseEvent) {
    if (onMouseDown && isActive && !event.ctrlKey && !event.metaKey && !(event.altKey && stage?.altPansView)) {
      onMouseDown(event, mouseToCanvasCoords(event));
    }
  }

  function handleMouseUp(event: MouseEvent) {
    if (onMouseUp && isActive) {
      onMouseUp(event, mouseToCanvasCoords(event));
    }
  }

  function handleMouseMove(event: MouseEvent) {
    if (onMouseMove && isActive) {
      onMouseMove(event, mouseToCanvasCoords(event));
    }
  }

  function handleMouseEnter() {
    if (onMouseEnter && isActive) {
      onMouseEnter();
    }
  }

  function handleMouseLeave() {
    if (onMouseLeave && isActive) {
      onMouseLeave();
    }
  }

  function handleContextMenu(event: MouseEvent) {
    if (onContextMenu && (isContextMenuActive ?? isActive)) {
      onContextMenu(event, mouseToCanvasCoords(event));
    }
  }

  function handleWheel(event: WheelEvent) {
    if (onWheel && isActive) {
      onWheel(event);
    }
  }

  // Double-tap detection in screen px, deliberately not preventDefaulting so
  // it observes rather than competes with the drawing/gesture handlers
  const DOUBLE_TAP_MS = 400;
  const DOUBLE_TAP_SLOP_PX = 40;
  let lastTap: { time: number; x: number; y: number } | null = null;

  function handleDoubleTapTouchStart(event: TouchEvent) {
    if (!onDoubleTap || !(isContextMenuActive ?? isActive)) return;
    if (event.touches.length !== 1) {
      lastTap = null;
      return;
    }
    const touch = event.touches[0];
    const now = performance.now();
    const isDouble =
      lastTap !== null &&
      now - lastTap.time < DOUBLE_TAP_MS &&
      Math.hypot(touch.clientX - lastTap.x, touch.clientY - lastTap.y) < DOUBLE_TAP_SLOP_PX;
    if (isDouble) {
      lastTap = null;
      onDoubleTap(event, touchToCanvasCoords(touch));
    } else {
      lastTap = { time: now, x: touch.clientX, y: touch.clientY };
    }
  }

  function handleTouchStart(event: TouchEvent) {
    if (onMouseDown && isActive) {
      // If multiple touches detected immediately, cancel any pending touch
      if (event.touches.length > 1) {
        // Cancel pending touch if it exists
        if (touchStartTimer) {
          clearTimeout(touchStartTimer);
          touchStartTimer = null;
          pendingTouchEvent = null;
          pendingTouchCoords = null;
        }
        // Stop any ongoing drawing
        if (isDrawing && onMouseUp) {
          onMouseUp(event, null);
          isDrawing = false;
        }
        return;
      }

      event.preventDefault(); // Prevent scrolling when interacting with the canvas
      const touch = event.touches[0];
      const coords = touchToCanvasCoords(touch);

      // Store the touch event and wait to see if another finger touches
      pendingTouchEvent = event;
      pendingTouchCoords = coords;

      // Clear any existing timer
      if (touchStartTimer) {
        clearTimeout(touchStartTimer);
      }

      // Wait 50ms to see if this becomes a multi-touch gesture
      touchStartTimer = setTimeout(() => {
        // If we still only have one touch after the delay, start drawing
        if (pendingTouchEvent && pendingTouchCoords && event.touches.length === 1) {
          onMouseDown(pendingTouchEvent, pendingTouchCoords);
          isDrawing = true;
        }
        touchStartTimer = null;
        pendingTouchEvent = null;
        pendingTouchCoords = null;
      }, 50);
    }
  }

  function handleTouchEnd(event: TouchEvent) {
    if (onMouseUp && isActive) {
      event.preventDefault();

      const touch = event.changedTouches[0];
      const coords = touch ? touchToCanvasCoords(touch) : null;

      // A tap shorter than the multi-touch wait still counts. Its release waits a tick so
      // layers that defer their press (to let a token claim it) see press before release
      if (touchStartTimer) {
        clearTimeout(touchStartTimer);
        touchStartTimer = null;
        const pressEvent = pendingTouchEvent;
        const pressCoords = pendingTouchCoords;
        pendingTouchEvent = null;
        pendingTouchCoords = null;
        if (onMouseDown && pressEvent && pressCoords && event.touches.length === 0) {
          onMouseDown(pressEvent, pressCoords);
          setTimeout(() => onMouseUp(event, coords), 0);
        }
        return;
      }

      // Only trigger mouse up if we were actually drawing
      if (isDrawing) {
        onMouseUp(event, coords);
        isDrawing = false;
      }
    }
  }

  function handleTouchMove(event: TouchEvent) {
    // Not gated on a coarse pointer: touchscreen TVs often report a fine one, which stranded drags mid-gesture
    if (onMouseMove && isActive) {
      // Stop drawing if multiple touches detected (pinch/zoom gesture)
      if (event.touches.length > 1) {
        // Cancel any pending touch
        if (touchStartTimer) {
          clearTimeout(touchStartTimer);
          touchStartTimer = null;
          pendingTouchEvent = null;
          pendingTouchCoords = null;
        }
        // Stop any ongoing drawing
        if (isDrawing && onMouseUp) {
          onMouseUp(event, null);
          isDrawing = false;
        }
        return;
      }

      // Only process move if we're actually drawing
      if (isDrawing) {
        event.preventDefault();
        const touch = event.touches[0];
        onMouseMove(event, touchToCanvasCoords(touch));
      }
    }
  }

  function handleTouchCancel(event: TouchEvent) {
    // Clean up any pending or ongoing touch operations
    if (touchStartTimer) {
      clearTimeout(touchStartTimer);
      touchStartTimer = null;
      pendingTouchEvent = null;
      pendingTouchCoords = null;
    }

    // The browser took the touch (system gesture, palm rejection): end the gesture so no layer stays mid-drag
    if (isDrawing) {
      isDrawing = false;
      onMouseUp?.(event, null);
    }

    if (onMouseLeave && isActive) {
      onMouseLeave();
    }
  }

  function mouseToCanvasCoords(e: MouseEvent): THREE.Vector2 | null {
    if (!target || !layerSize) return null;

    const mouse = new THREE.Vector2((e.offsetX / $size.width) * 2 - 1, -(e.offsetY / $size.height) * 2 + 1);

    raycaster.setFromCamera(mouse, $camera);
    const intersects = raycaster.intersectObject(target);

    if (intersects.length > 0) {
      const { point } = intersects[0];
      const localPoint = target.worldToLocal(point);
      const canvasPoint = new THREE.Vector2(
        layerSize.width * (localPoint.x + 0.5),
        layerSize.height * (localPoint.y + 0.5)
      );
      return canvasPoint;
    } else {
      return null;
    }
  }

  function touchToCanvasCoords(touch: Touch): THREE.Vector2 | null {
    if (!target || !layerSize || !renderer.domElement) return null;

    const rect = renderer.domElement.getBoundingClientRect();

    const offsetX = touch.clientX - rect.left;
    const offsetY = touch.clientY - rect.top;

    const mouse = new THREE.Vector2((offsetX / $size.width) * 2 - 1, -(offsetY / $size.height) * 2 + 1);

    raycaster.setFromCamera(mouse, $camera);
    const intersects = raycaster.intersectObject(target);

    if (intersects.length > 0) {
      const { point } = intersects[0];
      const localPoint = target.worldToLocal(point);
      const canvasPoint = new THREE.Vector2(
        layerSize.width * (localPoint.x + 0.5),
        layerSize.height * (localPoint.y + 0.5)
      );
      return canvasPoint;
    } else {
      return null;
    }
  }
</script>
