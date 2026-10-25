<script lang="ts">
  import * as THREE from 'three';
  import { T, type Props as ThrelteProps } from '@threlte/core';
  import { MarkerShape, MarkerSize, MarkerVisibility, type Marker } from './types';
  import { getContext, onDestroy, untrack } from 'svelte';
  import LayerInput from '../LayerInput/LayerInput.svelte';
  import type { Callbacks } from '../Stage/types';
  import { type StageProps, StageMode } from '../Stage/types';
  import MarkerToken from './MarkerToken.svelte';
  import { getGridCellSize, snapToGrid } from '../../helpers/grid';
  import { GridType, type GridLayerProps } from '../GridLayer/types';
  import type { DisplayProps } from '../Stage/types';
  import { SceneLayer } from '../Scene/types';
  import { MapLayerType } from '../MapLayer/types';
  import { v4 as uuidv4 } from 'uuid';
  import DistanceLabel from '../DistanceLabel/DistanceLabel.svelte';
  import { formatFeet, getMoveDistanceFeet } from '../../helpers/moveDistance';

  interface Props extends ThrelteProps<typeof THREE.Mesh> {
    props: StageProps;
    isActive: boolean;
    grid: GridLayerProps;
    display: DisplayProps;
    /** Display pixels per local pixel (map.zoom when anchored to the map in MapDefined mode) */
    localScale?: number;
    /** Map rotation in degrees, inherited from the map anchor in MapDefined mode */
    mapRotation?: number;
  }

  const { props, isActive, display, grid, localScale = 1, mapRotation = 0 }: Props = $props();

  const stage = getContext<{
    mode: StageMode;
    hoveredMarkerId: string | null;
    pinnedMarkerIds: string[];
    selectedMarkerIds?: string[];
    dropTargetMarkerId?: string | null;
    activeTurnMarkerId?: string | null;
    distanceMode?: boolean;
    markerClaimAt: number;
  }>('stage');
  const {
    onMarkerAdded,
    onMarkerMoved,
    onMarkersMoved,
    onMarkersMoveEnd,
    onMarkerSelected,
    onMarkerDoubleClick,
    onMarkerContextMenu,
    onMarkerLongPress,
    onMarkerHover
  } = getContext<Callbacks>('callbacks');

  const LONG_PRESS_MS = 500;
  const LONG_PRESS_SLOP_PX = 12;
  let longPress: { timer: ReturnType<typeof setTimeout>; x: number; y: number } | null = null;
  let longPressFired = false;

  function cancelLongPress() {
    if (longPress) clearTimeout(longPress.timer);
    longPress = null;
  }

  // Holding still on a token opens the consumer's menu instead of dragging or clicking it
  function armLongPress(marker: Marker, clientPoint: { x: number; y: number }) {
    cancelLongPress();
    if (!onMarkerLongPress) return;
    longPress = {
      ...clientPoint,
      timer: setTimeout(() => {
        longPress = null;
        if (isDragging || dragMoved) return;
        longPressFired = true;
        pendingDrag = null;
        groupDrag = null;
        dragStart = null;
        onMarkerLongPress(marker, clientPoint);
      }, LONG_PRESS_MS)
    };
  }

  // Double-click / double-tap detection on markers
  const DOUBLE_CLICK_MS = 350;
  let lastMarkerClick: { id: string; time: number } | null = null;

  // A press only becomes a drag once the pointer moves past the threshold, so
  // a stationary click never writes a position (and never adds an undo step)
  const DRAG_START_THRESHOLD_PX = 3;
  const TOUCH_DRAG_START_THRESHOLD_PX = 8;
  type PendingDrag = { clientX: number; clientY: number; isTouch: boolean };
  // Reactive: the player tooltip stays hidden while a press may still become a drag
  let pendingDrag: PendingDrag | null = $state.raw(null);

  // Pressing a selected token while several are selected moves the whole selection
  type GroupDrag = {
    anchorStart: THREE.Vector2;
    grabOffset: THREE.Vector2;
    members: { marker: Marker; start: THREE.Vector2 }[];
    lastDelta: THREE.Vector2 | null;
  };
  let groupDrag: GroupDrag | null = null;
  // Where the dragged token started, for the live "ft moved" label
  let dragStart: { id: string; x: number; y: number } | null = $state.raw(null);

  // A drag that actually started must not pop the selection tooltip on release; a
  // simple tap still does, and a tooltip already open before the drag survives it
  let tooltipWasOpenAtDown = false;
  let dragMoved = false;
  let pressedSelected = false;
  let tooltipSuppressed = $state(false);

  function getClientPoint(e: Event): { x: number; y: number } | null {
    if (typeof TouchEvent !== 'undefined' && e instanceof TouchEvent) {
      const touch = e.touches[0] ?? e.changedTouches[0];
      return touch ? { x: touch.clientX, y: touch.clientY } : null;
    }
    if (e instanceof MouseEvent) {
      return { x: e.clientX, y: e.clientY };
    }
    return null;
  }

  // Quad used for raycasting / mouse input detection
  // Use $state.raw() for Three.js objects to prevent proxy interference with internal properties
  let inputMesh = $state.raw(new THREE.Mesh());

  // Track the currently selected marker and dragging state
  let selectedMarker: Marker | null = $state(null);
  let isDragging = $state(false);
  let hoveredMarker: Marker | null = $state(null);
  let hoveredMarkerDelayed: Marker | null = $state(null); // Marker after hover delay
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  const HOVER_DELAY_MS = 500; // Half second delay before showing tooltip
  const HIDE_DELAY_MS = 300; // Delay before hiding tooltip to allow moving to it

  const ghostMarker: Marker = $state({
    id: uuidv4(),
    title: '',
    position: new THREE.Vector2(0, 0),
    size: MarkerSize.Small,
    shape: MarkerShape.Circle,
    shapeColor: '#ffffff',
    imageScale: 1.0,
    label: '',
    imageUrl: null,
    visibility: MarkerVisibility.Always,
    note: null
  });

  function findClosestMarker(gridCoords: THREE.Vector2) {
    // Find the marker that is closest to the mouse down point. The test point
    // must be within the outer radius of the marker for it to be considered.
    // Uses isTokenInteractable to ensure hidden/DM-only markers can't be found in Player mode.
    let closestMarker: Marker | undefined;
    let minDistance = Infinity;
    props.marker.markers.forEach((marker) => {
      if (!isTokenInteractable(marker)) return;

      const distance = gridCoords.distanceTo(marker.position);
      const markerRadius = getGridCellSize(grid, display) * marker.size;
      if (distance < minDistance && distance <= markerRadius / 2) {
        minDistance = distance;
        closestMarker = marker;
      }
    });

    return closestMarker;
  }

  function onMouseDown(e: MouseEvent | TouchEvent, coords: THREE.Vector2 | null) {
    if (!coords) return;

    // Check if TouchEvent is defined in the browser before using it
    const isTouchEvent = typeof TouchEvent !== 'undefined' && e instanceof TouchEvent;
    const isMouseEvent = e instanceof MouseEvent;

    // Verify the primary mouse/touch was used
    if (isMouseEvent && (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey)) return;
    if (isTouchEvent && (e as TouchEvent).touches.length !== 1) return;

    // Only allow marker interaction when activeLayer is None or Marker
    // This prevents marker dragging during fog, drawing, annotation, and measurement modes
    if (props.activeLayer !== MapLayerType.None && props.activeLayer !== MapLayerType.Marker) {
      return;
    }

    const gridCoords = new THREE.Vector2(coords.x - display.resolution.x / 2, coords.y - display.resolution.y / 2);

    const closestMarker = findClosestMarker(gridCoords);

    // Did we click on an existing marker?
    if (closestMarker !== undefined) {
      // Claim this pointer-down so shared gestures (fog-room double-tap) yield
      stage.markerClaimAt = performance.now();
      tooltipWasOpenAtDown = selectedMarker?.id === closestMarker.id && !tooltipSuppressed;
      tooltipSuppressed = false;
      dragMoved = false;
      longPressFired = false;
      const clientPoint = getClientPoint(e);
      selectedMarker = closestMarker;

      // Double-click/tap detection (only when a consumer is registered):
      // the second click opens the marker panel and must not start a drag
      const now = performance.now();
      const isDoubleClick =
        onMarkerDoubleClick !== undefined &&
        lastMarkerClick?.id === closestMarker.id &&
        now - lastMarkerClick.time < DOUBLE_CLICK_MS;
      lastMarkerClick = isDoubleClick ? null : { id: closestMarker.id, time: now };

      // Allow dragging in both DM and Player mode, except for pin-shaped markers (locked)
      if (!isDoubleClick && closestMarker.shape !== MarkerShape.Pin && clientPoint) {
        pendingDrag = { clientX: clientPoint.x, clientY: clientPoint.y, isTouch: isTouchEvent };
        dragStart = { id: closestMarker.id, x: closestMarker.position.x, y: closestMarker.position.y };
        groupDrag = createGroupDrag(closestMarker, gridCoords);
        // Clear tooltip when a drag may start
        hoveredMarkerDelayed = null;
        clearHoverTimer();
        listenForRelease();
      }
      // A press on a selected token keeps the selection until the press resolves:
      // a click reports the token (collapsing or cycling the selection), a drag moves what is selected
      pressedSelected = pendingDrag !== null && currentSelection().includes(closestMarker.id);
      if (!pressedSelected) {
        onMarkerSelected(selectedMarker);
      }
      if (isDoubleClick) {
        onMarkerDoubleClick(closestMarker);
      } else if (clientPoint) {
        armLongPress(closestMarker, clientPoint);
      }
    } else {
      lastMarkerClick = null;
      // In player mode, clicking empty space clears selection
      if (stage.mode === StageMode.Player) {
        selectedMarker = null;
        return;
      }

      // In DM mode, clicking empty space also clears selection (unless we're creating a new marker)
      if (props.activeLayer === MapLayerType.None) {
        selectedMarker = null;
        onMarkerSelected(null); // Notify that selection is cleared
        return;
      }
      const newMarker: Marker = {
        id: uuidv4(),
        title: 'New Marker',
        position: props.marker.snapToGrid ? snapToGrid(gridCoords, grid, display, false, localScale) : gridCoords,
        size: MarkerSize.Small,
        shape: MarkerShape.Circle,
        shapeColor: '#ffffff',
        imageScale: 1.0,
        label: 'A1',
        imageUrl: null,
        visibility: MarkerVisibility.Always,
        note: null
      };
      selectedMarker = newMarker;
      onMarkerAdded(newMarker);
    }
  }

  function onMouseMove(e: Event, coords: THREE.Vector2 | null) {
    if (!coords) {
      hoveredMarker = null;
      clearHoverTimer();
      return;
    }

    let position = new THREE.Vector2(coords.x - display.resolution.x / 2, coords.y - display.resolution.y / 2);
    const snapPosition = props.marker.snapToGrid ? snapToGrid(position, grid, display, false, localScale) : position;

    ghostMarker.position = snapPosition;

    // Only check for hover when we're not dragging and when activeLayer is None or Marker
    // This prevents hover during fog/drawing/annotation/measurement modes
    if (!isDragging && (props.activeLayer === MapLayerType.None || props.activeLayer === MapLayerType.Marker)) {
      // Check if there are any interactable markers (not just visible ones)
      const hasInteractableMarkers = props.marker.markers.some(isTokenInteractable);
      if (hasInteractableMarkers) {
        const newHoveredMarker = findClosestMarker(position) ?? null;

        // If we're hovering over a different marker than before
        if (newHoveredMarker?.id !== hoveredMarker?.id) {
          hoveredMarker = newHoveredMarker;
          clearHoverTimer();

          // Start timer for new hover if we have a marker
          if (newHoveredMarker) {
            cancelHideTimer(); // Cancel any pending hide
            hoverTimer = setTimeout(() => {
              hoveredMarkerDelayed = newHoveredMarker;
            }, HOVER_DELAY_MS);
          }
        }
      } else {
        hoveredMarker = null;
        clearHoverTimer();
      }
    } else {
      hoveredMarker = null;
      clearHoverTimer();
    }

    if (longPress) {
      const clientPoint = getClientPoint(e);
      if (clientPoint && Math.hypot(clientPoint.x - longPress.x, clientPoint.y - longPress.y) > LONG_PRESS_SLOP_PX) {
        cancelLongPress();
      }
    }

    if (pendingDrag) {
      if (!hasPassedDragThreshold(e, pendingDrag)) return;
      cancelLongPress();
      pendingDrag = null;
      isDragging = true;
      dragMoved = true;
    }

    if (!isDragging || !selectedMarker) return;
    if (groupDrag) {
      moveGroup(groupDrag, position);
      return;
    }
    onMarkerMoved(selectedMarker, snapPosition);
  }

  function hasPassedDragThreshold(e: Event, drag: PendingDrag) {
    const clientPoint = getClientPoint(e);
    if (!clientPoint) return false;
    const threshold = drag.isTouch ? TOUCH_DRAG_START_THRESHOLD_PX : DRAG_START_THRESHOLD_PX;
    return Math.hypot(clientPoint.x - drag.clientX, clientPoint.y - drag.clientY) > threshold;
  }

  function currentSelection(): string[] {
    return stage.selectedMarkerIds ?? props.marker.selectedIds ?? [];
  }

  function createGroupDrag(anchor: Marker, cursor: THREE.Vector2): GroupDrag | null {
    const selection = currentSelection();
    if (selection.length < 2 || !selection.includes(anchor.id)) return null;

    const members = props.marker.markers
      .filter((m) => selection.includes(m.id) && m.shape !== MarkerShape.Pin && isTokenInteractable(m))
      .map((marker) => ({ marker, start: new THREE.Vector2(marker.position.x, marker.position.y) }));
    if (members.length < 2) return null;

    const anchorStart = new THREE.Vector2(anchor.position.x, anchor.position.y);
    return { anchorStart, grabOffset: cursor.clone().sub(anchorStart), members, lastDelta: null };
  }

  function resolveGroupDelta(cursor: THREE.Vector2, drag: GroupDrag): THREE.Vector2 {
    const delta = cursor.clone().sub(drag.grabOffset).sub(drag.anchorStart);
    if (!props.marker.snapToGrid) return delta;

    if (grid.gridType === GridType.Square) {
      const cell = getGridCellSize(grid, display);
      return new THREE.Vector2(Math.round(delta.x / cell) * cell, Math.round(delta.y / cell) * cell);
    }
    const snapped = snapToGrid(drag.anchorStart.clone().add(delta), grid, display, true, localScale);
    return snapped.sub(drag.anchorStart);
  }

  function moveGroup(drag: GroupDrag, cursor: THREE.Vector2) {
    const delta = resolveGroupDelta(cursor, drag);
    if (drag.lastDelta?.equals(delta)) return;
    drag.lastDelta = delta;
    applyGroupDelta(drag, delta);
  }

  function applyGroupDelta(drag: GroupDrag, delta: THREE.Vector2) {
    const moves = drag.members.map(({ marker, start }) => ({
      marker,
      position: { x: start.x + delta.x, y: start.y + delta.y }
    }));
    if (onMarkersMoved) {
      onMarkersMoved(moves);
    } else {
      moves.forEach(({ marker, position }) => onMarkerMoved(marker, position));
    }
  }

  // Tells the consumer the gesture is over (it closes its undo group there); only for drags that moved
  function endGroupDrag(cancelled: boolean) {
    const drag = groupDrag;
    groupDrag = null;
    if (!drag || !dragMoved) return;
    onMarkersMoveEnd?.({ ids: drag.members.map(({ marker }) => marker.id), cancelled });
  }

  function onGroupDragKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !groupDrag || !isDragging) return;
    e.preventDefault();
    applyGroupDelta(groupDrag, new THREE.Vector2());
    endGroupDrag(true);
    isDragging = false;
  }

  function listenForRelease() {
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('blur', onMouseUp);
    window.addEventListener('keydown', onGroupDragKeyDown);
  }

  function stopListeningForRelease() {
    window.removeEventListener('mouseup', onMouseUp);
    window.removeEventListener('blur', onMouseUp);
    window.removeEventListener('keydown', onGroupDragKeyDown);
  }

  onDestroy(() => {
    cancelLongPress();
    stopListeningForRelease();
    endGroupDrag(false);
  });

  function clearHoverTimer() {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    if (hideTimer) {
      clearTimeout(hideTimer);
    }
    hideTimer = setTimeout(() => {
      hoveredMarkerDelayed = null;
    }, HIDE_DELAY_MS);
  }

  function cancelHideTimer() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function isTokenVisible(marker: Marker) {
    return (
      marker.visibility === MarkerVisibility.Always ||
      (marker.visibility === MarkerVisibility.DM && stage.mode === StageMode.DM) ||
      (marker.visibility === MarkerVisibility.Hover && stage.mode === StageMode.DM) ||
      (marker.visibility === MarkerVisibility.Hover &&
        stage.mode === StageMode.Player &&
        marker.id === stage.hoveredMarkerId) ||
      (marker.visibility === MarkerVisibility.Hover &&
        stage.mode === StageMode.Player &&
        stage.pinnedMarkerIds?.includes(marker.id)) ||
      (marker.visibility === MarkerVisibility.Player && stage.mode === StageMode.Player)
    );
  }

  /**
   * Checks if a marker can be interacted with (clicked, hovered, dragged) in the current mode.
   * In Player mode, only markers with Always or Player visibility can be interacted with.
   * Hover-revealed markers are visible to players but NOT interactable - they're for viewing only.
   * DM-only markers are never interactable in Player mode.
   */
  function isTokenInteractable(marker: Marker) {
    if (stage.mode === StageMode.DM) {
      // In DM mode, all visible markers are interactable
      return isTokenVisible(marker);
    }

    // In Player mode, only Always and Player visibility markers are interactable
    // Hover and DM visibility markers are view-only (revealed by DM) or hidden
    return marker.visibility === MarkerVisibility.Always || marker.visibility === MarkerVisibility.Player;
  }

  export const isSelectable = (marker: Marker) => props.marker.visible && isTokenInteractable(marker);

  function onMouseUp() {
    stopListeningForRelease();
    cancelLongPress();
    if (pressedSelected && !dragMoved && !longPressFired && selectedMarker) {
      onMarkerSelected(selectedMarker);
    }
    pressedSelected = false;
    longPressFired = false;
    endGroupDrag(false);
    pendingDrag = null;
    dragStart = null;
    if (isDragging && selectedMarker) {
      isDragging = false;
      tooltipSuppressed = dragMoved && !tooltipWasOpenAtDown;
    }
  }

  function onMouseLeave() {
    hoveredMarker = null;
    clearHoverTimer();
  }

  function onContextMenu(e: MouseEvent | TouchEvent, coords: THREE.Vector2 | null) {
    if (!coords) return;

    const gridCoords = new THREE.Vector2(coords.x - display.resolution.x / 2, coords.y - display.resolution.y / 2);
    const closestMarker = findClosestMarker(gridCoords);

    if (closestMarker) {
      onMarkerContextMenu(closestMarker, e);
    }
  }

  // Track previous hovered marker to detect changes
  let previousHoveredMarkerDelayed: Marker | null = null;

  // Notify about hover changes when in DM mode (only after delay)
  $effect(() => {
    if (stage.mode === StageMode.DM && hoveredMarkerDelayed !== previousHoveredMarkerDelayed) {
      onMarkerHover?.(hoveredMarkerDelayed);
      previousHoveredMarkerDelayed = hoveredMarkerDelayed;
    }
  });

  export function maintainHover(maintain: boolean) {
    if (maintain && stage.mode === StageMode.DM) {
      cancelHideTimer();
    } else if (!maintain && stage.mode === StageMode.DM && !hoveredMarker) {
      clearHoverTimer();
    }
  }

  /**
   * Called when the scene changes to clear all marker interaction state.
   * Resets selection, hover, dragging, and clears any pending timers.
   */
  export function onSceneChange() {
    selectedMarker = null;
    isDragging = false;
    hoveredMarker = null;
    hoveredMarkerDelayed = null;
    tooltipSuppressed = false;
    endGroupDrag(false);
    dragMoved = false;
    pressedSelected = false;
    longPressFired = false;
    cancelLongPress();
    pendingDrag = null;
    dragStart = null;
    stopListeningForRelease();

    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  const cellPx = $derived(getGridCellSize(grid, display));
  const labelRotation = $derived(props.scene.rotation);

  const movedLabel = $derived.by(() => {
    if (!isDragging || !dragStart) return null;
    const marker = props.marker.markers.find((m) => m.id === dragStart?.id);
    if (!marker) return null;
    return {
      id: marker.id,
      x: marker.position.x,
      y: marker.position.y,
      lift: (cellPx * marker.size) / 2 + cellPx * 0.4,
      text: formatFeet(getMoveDistanceFeet(dragStart, marker.position, grid, display))
    };
  });

  const distanceOrigin = $derived.by(() => {
    if (!stage.distanceMode) return null;
    const id = stage.selectedMarkerIds?.at(-1) ?? selectedMarker?.id;
    return props.marker.markers.find((m) => m.id === id && isTokenInteractable(m)) ?? null;
  });

  const distanceLabels = $derived.by(() => {
    const origin = distanceOrigin;
    if (!origin) return [];
    return props.marker.markers
      .filter((m) => m.id !== origin.id && isTokenVisible(m))
      .map((m) => ({
        id: m.id,
        x: m.position.x,
        y: m.position.y,
        lift: (cellPx * m.size) / 2 + cellPx * 0.4,
        text: formatFeet(getMoveDistanceFeet(origin.position, m.position, grid, display))
      }));
  });

  // Once the parent passes its selection in, a stale local pick must not stay highlighted
  $effect(() => {
    const selectedIds = stage.selectedMarkerIds;
    untrack(() => {
      if (selectedIds && selectedMarker && !selectedIds.includes(selectedMarker.id)) {
        selectedMarker = null;
      }
    });
  });

  // Export reactive state for hover and drag
  export const markerState = {
    get isHovering() {
      if (stage.mode === StageMode.DM) {
        return hoveredMarkerDelayed !== null && hoveredMarkerDelayed !== undefined;
      }
      return stage.hoveredMarkerId !== null && stage.hoveredMarkerId !== undefined;
    },
    get isDragging() {
      return isDragging;
    },
    get hoveredMarker() {
      // In DM mode, use the delayed hover
      if (stage.mode === StageMode.DM) {
        return hoveredMarkerDelayed;
      }
      // In Player mode, find the marker that matches the DM's hoveredMarkerId or is pinned
      if (stage.hoveredMarkerId) {
        const hoveredMarker = props.marker.markers.find((m) => m.id === stage.hoveredMarkerId);
        return hoveredMarker || null;
      }
      // Check for pinned markers
      if (stage.pinnedMarkerIds && stage.pinnedMarkerIds.length > 0) {
        const pinnedMarker = props.marker.markers.find((m) => stage.pinnedMarkerIds.includes(m.id));
        return pinnedMarker || null;
      }
      return null;
    },
    get selectedMarker() {
      return selectedMarker;
    },
    get tooltipSuppressed() {
      // A press that may still become a drag keeps a closed tooltip closed (no flash on drag start)
      return tooltipSuppressed || (pendingDrag !== null && !tooltipWasOpenAtDown);
    }
  };
</script>

<LayerInput
  id="marker"
  isActive={isActive || stage.mode === StageMode.Player}
  target={inputMesh}
  layerSize={{ width: display.resolution.x, height: display.resolution.y }}
  {onMouseDown}
  {onMouseMove}
  {onMouseUp}
  {onMouseLeave}
  {onContextMenu}
/>

<!-- This quad is user for raycasting / mouse input detection. It is invisible -->
<T.Mesh bind:ref={inputMesh} scale={[display.resolution.x, display.resolution.y, 1]} layers={[SceneLayer.Input]}>
  <T.MeshBasicMaterial visible={false} />
  <T.PlaneGeometry />
</T.Mesh>

<!-- This group contains all the markers -->
<T.Group name="markerLayer" position={[-0.5, -0.5, 0]}>
  {#each props.marker.markers as marker (marker.id)}
    {#if isTokenVisible(marker)}
      <MarkerToken
        {marker}
        {grid}
        {display}
        opacity={1.0}
        textColor={props.marker.text.color}
        textStroke={props.marker.text.strokeWidth}
        textStrokeColor={props.marker.text.strokeColor}
        textSize={props.marker.text.size}
        shadowColor={props.marker.shape.shadowColor}
        shadowBlur={props.marker.shape.shadowBlur}
        shadowOffset={props.marker.shape.shadowOffset}
        strokeColor={props.marker.shape.strokeColor}
        strokeWidth={props.marker.shape.strokeWidth}
        isSelected={selectedMarker?.id === marker.id || currentSelection().includes(marker.id)}
        isHovered={hoveredMarker?.id === marker.id ||
          (stage.dropTargetMarkerId ?? props.marker.dropTargetId) === marker.id}
        isActiveTurn={marker.id === stage.activeTurnMarkerId}
        sceneRotation={props.scene.rotation}
        {mapRotation}
      />
    {/if}
  {/each}

  {#each distanceLabels as label (label.id)}
    <DistanceLabel
      text={label.text}
      x={label.x}
      y={label.y}
      lift={label.lift}
      sceneZoom={props.scene.zoom}
      {localScale}
      sceneRotation={labelRotation}
      {mapRotation}
    />
  {/each}

  {#if movedLabel}
    <DistanceLabel
      text={movedLabel.text}
      x={movedLabel.x}
      y={movedLabel.y}
      lift={movedLabel.lift}
      sceneZoom={props.scene.zoom}
      {localScale}
      sceneRotation={labelRotation}
      {mapRotation}
    />
  {/if}

  <!-- Only show the ghost marker when the marker layer is active -->
  {#if isActive && stage.mode === StageMode.DM && props.activeLayer === MapLayerType.Marker}
    <MarkerToken
      marker={ghostMarker}
      {grid}
      {display}
      opacity={0.3}
      textColor={props.marker.text.color}
      textStroke={props.marker.text.strokeWidth}
      textStrokeColor={props.marker.text.strokeColor}
      textSize={props.marker.text.size}
      shadowColor={props.marker.shape.shadowColor}
      shadowBlur={props.marker.shape.shadowBlur}
      shadowOffset={props.marker.shape.shadowOffset}
      strokeColor={props.marker.shape.strokeColor}
      strokeWidth={props.marker.shape.strokeWidth}
      isSelected={false}
      isHovered={false}
      sceneRotation={props.scene.rotation}
      {mapRotation}
    />
  {/if}
</T.Group>
