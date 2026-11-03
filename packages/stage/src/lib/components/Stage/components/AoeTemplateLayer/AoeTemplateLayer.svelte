<script lang="ts">
  import * as THREE from 'three';
  import { T, useTask, useThrelte } from '@threlte/core';
  import { getContext, untrack } from 'svelte';
  import { v4 as uuidv4 } from 'uuid';
  import LayerInput from '../LayerInput/LayerInput.svelte';
  import { type Callbacks, StageMode, type DisplayProps, type PerformanceTier } from '../Stage/types';
  import type { FramePacer } from '../../helpers/framePacing';
  import type { GridLayerProps } from '../GridLayer/types';
  import { SceneLayer } from '../Scene/types';
  import { getGridCellSize, snapToGrid } from '../../helpers/grid';
  import {
    markersInSpellArea,
    sameMarkerIds,
    spellTargetAt,
    spellTargetRingRadiusPx
  } from '../../helpers/spellTargets';
  import {
    TEMPLATE_MIN_SIZE_FT,
    angleFromCursor,
    getTemplateHandlePoints,
    isTemplateAnchored,
    isTemplateExpired,
    nextTemplateInStack,
    sizeFromCursor,
    spellAimDraft,
    spellAimPlacement,
    spellAimPointer,
    spellRangeRadiusPx,
    templateContainsPoint,
    templateFadeMs,
    templateIntersectsRect,
    withAnchoredPosition,
    type SpellAimPlacement,
    type TemplatePoint
  } from '../../helpers/aoeTemplates';
  import { isPlacedAreaDrag, placedAreaRelease } from '../../helpers/spellAim';
  import type { Marker } from '../MarkerLayer/types';
  import {
    AoeEffect,
    AoeShape,
    type AoeTemplate,
    type AoeTemplateLayerExports,
    type AoeTemplateLayerProps,
    type SpellAimSettings,
    type SpellAreaTargets
  } from './types';
  import AoeTemplateMesh from './AoeTemplateMesh.svelte';
  import AoeTemplateHandles from './AoeTemplateHandles.svelte';
  import SpellRangeRing from './SpellRangeRing.svelte';

  interface Props {
    props: AoeTemplateLayerProps;
    mode: StageMode;
    isActive: boolean;
    /** Select-only input while no tool is active, so shapes can be picked and deleted */
    selectable?: boolean;
    grid: GridLayerProps;
    /** Anchored display: map-space in MapDefined mode, the real display otherwise */
    display: DisplayProps;
    sceneZoom: number;
    /** Display pixels per local pixel (map.zoom when anchored to the map) */
    localScale: number;
    sceneRotation: number;
    mapRotation: number;
    /** Live token positions, so anchored templates follow their token (including mid-drag) */
    markers?: readonly Marker[];
  }

  const {
    props,
    mode,
    isActive,
    selectable = false,
    grid,
    display,
    sceneZoom,
    localScale,
    sceneRotation,
    mapRotation,
    markers = []
  }: Props = $props();

  const { renderer } = useThrelte();
  const stage = getContext<{
    performanceTier: PerformanceTier;
    markerClaimAt: number;
    spellTargetMarkerId: string | null;
    spellPickedMarkerIds: string[];
    spellEligibleMarkerIds: string[];
    spellHighlight: { templateIds: string[]; markerIds: string[] };
  }>('stage');
  const framePacer = getContext<FramePacer | undefined>('framePacer');
  const MARKER_CLAIM_WINDOW_MS = 100;
  const {
    onAoeTemplateAdded,
    onAoeTemplateUpdated,
    onAoeTemplateSelected,
    onAoeTemplatesSelected,
    onAoeTemplateMenu,
    onSpellAimed,
    onSpellAimPlaced,
    onSpellAreaTargets,
    onSpellTargeted,
    onSpellAimCancelled
  } = getContext<Callbacks>('callbacks');

  const EDIT_EMIT_INTERVAL_MS = 50;
  const EXPIRY_CHECK_INTERVAL_MS = 1000;
  // A press that starts on an existing shape is a tap (select / cycle) until it travels this far
  const TAP_SLOP_PX = 10;
  const LONG_PRESS_MS = 500;
  const LONG_PRESS_SLOP_PX = 12;
  // A fingertip covers far more than a mouse pointer, so touch grabs handles from further away
  const TOUCH_GRAB_SCALE = 2;
  const SPELL_DRAFT_ID = 'spell-aim-draft';
  const NO_MARKER_IDS: string[] = [];

  type Interaction =
    | { kind: 'idle' }
    /** `tapStack` is the shapes under the press, topmost first; while `crossed` is false it may still be a tap */
    | { kind: 'dragging'; draft: AoeTemplate; tapStack: string[]; crossed: boolean }
    | { kind: 'aiming'; draft: AoeTemplate }
    | { kind: 'moving'; id: string; grab: TemplatePoint; starts: Record<string, TemplatePoint> }
    | { kind: 'resizing'; id: string };

  let inputMesh = $state.raw(new THREE.Mesh());
  let interaction = $state<Interaction>({ kind: 'idle' });
  let edit: { patches: Record<string, Partial<AoeTemplate>> } | null = $state(null);
  let lastEmitAt = 0;
  let longPress: { timer: ReturnType<typeof setTimeout>; x: number; y: number } | null = null;
  /** The shape just drawn keeps its handles until a press lands elsewhere, so it can be resized right away */
  let justDrawnId = $state<string | null>(null);

  // Shared time for every fill; each template's uTime is this same object
  const sharedTime = { value: 0 };
  // Animated areas loop at the ambient rate; one that is fading out needs every frame to look smooth
  useTask((delta) => {
    sharedTime.value += delta;
    if (animatedTemplateCount > 0 || hasHighlight || castCue) framePacer?.markAmbient();
    if (expiryWindows.length === 0) return;
    const nowMs = Date.now();
    if (expiryWindows.some(({ fadeStartMs, expiresAt }) => nowMs >= fadeStartMs && nowMs < expiresAt)) {
      framePacer?.markActive();
    }
  });

  const cellPx = $derived(getGridCellSize(grid, display));
  const ftToPx = $derived(cellPx / (grid.worldGridSize || 5));
  const ftPerPx = $derived(1 / ftToPx);
  const handleRadius = $derived(0.35 * cellPx);
  const isPendingTap = $derived(
    interaction.kind === 'dragging' && interaction.tapStack.length > 0 && !interaction.crossed
  );

  // Spell aiming replaces free drawing while the tool carries a spell
  const spell = $derived(isActive ? props.tool.spell : undefined);
  // The consumer rebuilds the spell object on every pick or move, so resets key on its id, never its identity
  const spellId = $derived(spell?.spellId);
  const targeting = $derived(spell?.mode === 'target');
  const areaPicking = $derived(spell?.mode === 'area-targets');
  // An area spell takes two clicks: the first places it, a click inside it casts
  const twoClick = $derived(!!spell && !targeting && !areaPicking);
  let placedAim = $state<SpellAimPlacement | null>(null);
  let lastPressWasTouch = $state(false);
  // Once placed, an area-target aim draws the consumer's placement and a two-click aim its own; until then it follows the pointer
  const placedArea = $derived(areaPicking ? (spell?.placement ?? null) : twoClick ? placedAim : null);
  const castCue = $derived(twoClick && placedAim ? (lastPressWasTouch ? 'Tap to cast' : 'Click to cast') : null);
  let spellAim = $state<{ start: TemplatePoint | null; pointer: TemplatePoint | null }>({ start: null, pointer: null });
  let areaPress: {
    grab: TemplatePoint;
    from: TemplatePoint;
    isTouch: boolean;
    crossed: boolean;
    tapId: string | null;
  } | null = null;
  let lastAreaReport: SpellAreaTargets | null = null;
  const spellPlacement = $derived(
    placedArea ??
      (spell && !targeting && spellAim.pointer
        ? spellAimPlacement(spell, {
            pointer: spellAim.pointer,
            start: spellAim.start,
            ftPerPx,
            cellPx,
            snapAngle: props.tool.snapAngle
          })
        : null)
  );
  const spellDraft = $derived(
    spell && !targeting && spellPlacement
      ? spellAimDraft(spell, spellPlacement, {
          id: SPELL_DRAFT_ID,
          opacity: props.tool.opacity,
          visibility: props.tool.visibility
        })
      : null
  );
  const spellRangePx = $derived(
    spell ? (targeting ? spellTargetRingRadiusPx(spell, cellPx, ftPerPx) : spellRangeRadiusPx(spell, ftPerPx)) : 0
  );
  // The token the pointer is over, when the spell can reach it; the marker layer outlines it like a drop target
  const targetedMarkerId = $derived(
    spell && targeting && spellAim.pointer
      ? spellTargetAt(spell, spellAim.pointer, markers, { cellPx, ftPerPx, mode })
      : null
  );

  // The visible tokens inside the placed area; recomputed only when the area, a token or the viewer changes
  const insideIds = $derived(
    areaPicking && placedArea && spellDraft
      ? markersInSpellArea(spellDraft, markers, { cellPx, ftPerPx, mode })
      : NO_MARKER_IDS
  );

  const pickedMarkerIds = $derived(targeting || areaPicking ? (spell?.pickedMarkerIds ?? []) : []);

  const reportAreaTargets = (next: SpellAreaTargets) => {
    const last = lastAreaReport;
    if (
      last &&
      last.spellId === next.spellId &&
      last.placement.position.x === next.placement.position.x &&
      last.placement.position.y === next.placement.position.y &&
      last.placement.angle === next.placement.angle &&
      sameMarkerIds(last.markerIds, next.markerIds)
    ) {
      return;
    }
    lastAreaReport = next;
    onSpellAreaTargets?.(next);
  };

  // Tokens that move, or a viewer change, can change who is inside while the area stays put
  $effect(() => {
    const placement = placedArea;
    const markerIds = insideIds;
    const id = spellId;
    untrack(() => {
      if (placement && id) reportAreaTargets({ spellId: id, placement, markerIds });
      else lastAreaReport = null;
    });
  });

  $effect(() => {
    stage.spellEligibleMarkerIds = insideIds;
    return () => {
      stage.spellEligibleMarkerIds = [];
    };
  });

  $effect(() => {
    stage.spellTargetMarkerId = targetedMarkerId;
    return () => {
      stage.spellTargetMarkerId = null;
    };
  });

  $effect(() => {
    stage.spellPickedMarkerIds = pickedMarkerIds;
    return () => {
      stage.spellPickedMarkerIds = [];
    };
  });

  const draft = $derived(
    spellDraft ??
      ((interaction.kind === 'dragging' || interaction.kind === 'aiming') && !isPendingTap ? interaction.draft : null)
  );
  const selectedIds = $derived(props.selectedIds ?? (props.selectedId ? [props.selectedId] : []));
  const selectedSet = $derived(new Set(selectedIds));
  const hasHandles = (id: string) => selectedSet.has(id) || id === justDrawnId;

  let nowMs = $state(Date.now());
  const hasExpiringTemplates = $derived(props.templates.some((template) => template.expiresAt != null));

  // Each mesh fades itself every frame; this coarse clock only drops templates once they are gone
  $effect(() => {
    if (!hasExpiringTemplates) return;
    nowMs = Date.now();
    const timer = setInterval(() => (nowMs = Date.now()), EXPIRY_CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  });

  const visibleTemplates = $derived(
    props.templates.filter(
      (template) =>
        !template.effectOnly &&
        (mode === StageMode.DM || template.visibility !== StageMode.DM) &&
        !isTemplateExpired(template.expiresAt, nowMs)
    )
  );
  const editedTemplates = $derived(
    visibleTemplates.map((template) =>
      withAnchoredPosition(
        edit?.patches[template.id] ? { ...template, ...edit.patches[template.id] } : template,
        markers
      )
    )
  );
  const drawnTemplates = $derived(draft ? [...editedTemplates, draft] : editedTemplates);
  const expiryWindows = $derived(
    drawnTemplates.flatMap((template) =>
      template.expiresAt == null
        ? []
        : [{ expiresAt: template.expiresAt, fadeStartMs: template.expiresAt - templateFadeMs(template) }]
    )
  );
  const animatedTemplateCount = $derived(
    drawnTemplates.filter((template) => template.effect !== AoeEffect.None || template.expiresAt != null).length
  );

  // Keyed on the ids, so a consumer rebuilding the same highlight changes nothing
  const highlightKey = $derived(stage.spellHighlight?.templateIds.join('|') ?? '');
  const highlightedIds = $derived(new Set(highlightKey ? highlightKey.split('|') : []));
  const hasHighlight = $derived(drawnTemplates.some((template) => highlightedIds.has(template.id)));
  $effect(() => {
    if (!isActive) untrack(() => endInteraction());
  });

  // Reported to the consumer so Enter can cast the placed area and Esc can un-place it
  const setPlacedAim = (placement: SpellAimPlacement | null) => {
    const wasPlaced = placedAim !== null;
    placedAim = placement;
    if (!placement && !wasPlaced) return;
    const id = untrack(() => spellId);
    onSpellAimPlaced?.(placement && id ? { spellId: id, position: placement.position, angle: placement.angle } : null);
  };

  // A different spell, or leaving the layer, drops the aim so it can't carry over
  $effect(() => {
    void spellId;
    untrack(() => {
      spellAim = { start: null, pointer: null };
      areaPress = null;
      lastAreaReport = null;
      setPlacedAim(null);
    });
  });

  $effect(() => {
    const canvas = renderer.domElement;
    if (!isActive) return;
    canvas.style.cursor = 'crosshair';
    return () => {
      canvas.style.cursor = '';
    };
  });

  const toLayerPoint = (coords: THREE.Vector2): TemplatePoint => ({
    x: coords.x - display.resolution.x / 2,
    y: coords.y - display.resolution.y / 2
  });

  const snapPoint = (point: TemplatePoint, disableSnap: boolean): TemplatePoint => {
    if (!props.tool.snapToGrid || disableSnap) return point;
    const snapped = snapToGrid(new THREE.Vector2(point.x, point.y), grid, display, false, localScale);
    return { x: snapped.x, y: snapped.y };
  };

  const isNear = (a: TemplatePoint, b: TemplatePoint, radius = handleRadius) =>
    Math.hypot(a.x - b.x, a.y - b.y) <= radius;

  // Topmost first: later templates draw over earlier ones
  const findTemplatesAt = (point: TemplatePoint) =>
    [...editedTemplates]
      .reverse()
      .filter((template) => isNear(point, template.position) || templateContainsPoint(template, point, ftPerPx));

  const selectTemplates = (ids: string[]) => {
    if (onAoeTemplatesSelected) onAoeTemplatesSelected(ids);
    else onAoeTemplateSelected?.(ids.at(-1) ?? null);
  };

  // Tapping a stack of overlapping shapes walks down it, one shape per tap. A tap on the only
  // selected shape is still reported, so the consumer can cycle through a group it belongs to
  const cycleSelection = (stack: string[]) => {
    const next = nextTemplateInStack(stack, props.selectedId);
    if (next) selectTemplates([next]);
  };

  const updateDraft = (current: AoeTemplate, point: TemplatePoint, disableSnap: boolean): AoeTemplate => {
    const angle =
      current.shape === AoeShape.Circle
        ? current.angle
        : angleFromCursor(current.position, point, current.shape, props.tool.snapAngle && !disableSnap);
    const size = sizeFromCursor(current.shape, current.position, point, ftPerPx, angle, !disableSnap);
    return { ...current, angle, size };
  };

  const startDraft = (point: TemplatePoint, disableSnap: boolean, tapStack: string[]) => {
    const position = snapPoint(point, disableSnap);
    interaction = {
      kind: 'dragging',
      tapStack,
      crossed: false,
      draft: {
        id: uuidv4(),
        shape: props.tool.shape,
        position,
        angle: 0,
        size: TEMPLATE_MIN_SIZE_FT,
        width: props.tool.lineWidth,
        effect: props.tool.effect,
        color: props.tool.color,
        opacity: props.tool.opacity,
        visibility: props.tool.visibility,
        label: null
      }
    };
  };

  const emitEdit = (final: boolean) => {
    if (!edit) return;
    const now = performance.now();
    if (!final && now - lastEmitAt < EDIT_EMIT_INTERVAL_MS) return;
    lastEmitAt = now;
    for (const [id, patch] of Object.entries(edit.patches)) onAoeTemplateUpdated?.(id, patch);
  };

  // Ends any gesture; an in-progress move/resize lands its latest patch first
  const endInteraction = () => {
    cancelLongPress();
    if (interaction.kind === 'moving' || interaction.kind === 'resizing') emitEdit(true);
    edit = null;
    interaction = { kind: 'idle' };
  };

  const commitDraft = (template: AoeTemplate) => {
    onAoeTemplateAdded?.(template);
    justDrawnId = template.id;
    interaction = { kind: 'idle' };
  };

  // Dragging a selected shape's origin carries the whole selection along with it
  const startMove = (anchor: AoeTemplate, point: TemplatePoint) => {
    const ids = selectedSet.has(anchor.id) ? selectedIds : [anchor.id];
    const starts = Object.fromEntries(
      editedTemplates
        .filter((template) => ids.includes(template.id) && !isTemplateAnchored(template, markers))
        .map((t) => [t.id, { ...t.position }])
    );
    interaction = {
      kind: 'moving',
      id: anchor.id,
      grab: { x: point.x - anchor.position.x, y: point.y - anchor.position.y },
      starts
    };
    edit = { patches: {} };
  };

  const startResize = (id: string) => {
    interaction = { kind: 'resizing', id };
    edit = { patches: {} };
  };

  // TouchEvent is undefined in some desktop browsers, so `instanceof TouchEvent` can throw
  const isTouchEvent = (e: MouseEvent | TouchEvent): e is TouchEvent => 'touches' in e;

  // The closest origin or end handle of a shape that shows its handles
  const findHandle = (point: TemplatePoint, isTouch: boolean) => {
    const radius = isTouch ? handleRadius * TOUCH_GRAB_SCALE : handleRadius;
    return editedTemplates
      .filter((template) => hasHandles(template.id))
      .flatMap((template) => {
        const { origin, end } = getTemplateHandlePoints(template, ftPerPx);
        const endHandle = { template, kind: 'end' as const, at: end };
        // An anchored template moves with its token, never by its own origin
        return isTemplateAnchored(template, markers)
          ? [endHandle]
          : [{ template, kind: 'origin' as const, at: origin }, endHandle];
      })
      .filter((handle) => isNear(point, handle.at, radius))
      .sort(
        (a, b) => Math.hypot(point.x - a.at.x, point.y - a.at.y) - Math.hypot(point.x - b.at.x, point.y - b.at.y)
      )[0];
  };

  // Grabbing a shape's origin moves the selection; grabbing its far end resizes and rotates it
  const startGrab = (handle: NonNullable<ReturnType<typeof findHandle>>, point: TemplatePoint) => {
    if (handle.kind === 'origin') startMove(handle.template, point);
    else startResize(handle.template.id);
  };

  const cancelLongPress = () => {
    if (longPress) clearTimeout(longPress.timer);
    longPress = null;
  };

  const touchClientPoint = (e: TouchEvent) => {
    const touch = e.touches[0] ?? e.changedTouches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
  };

  // Holding a finger on a shape opens its menu; a token under the same press, or any drag, wins instead
  const armLongPress = (e: TouchEvent, stack: string[]) => {
    cancelLongPress();
    const client = touchClientPoint(e);
    if (!onAoeTemplateMenu || !client || stack.length === 0) return;
    setTimeout(() => {
      if (performance.now() - stage.markerClaimAt < MARKER_CLAIM_WINDOW_MS) return;
      cancelLongPress();
      longPress = {
        ...client,
        timer: setTimeout(() => {
          longPress = null;
          if (interaction.kind === 'dragging' && interaction.crossed) return;
          interaction = { kind: 'idle' };
          const target = props.selectedId && stack.includes(props.selectedId) ? props.selectedId : stack[0];
          if (!selectedSet.has(target)) selectTemplates([target]);
          onAoeTemplateMenu(target, client, 'longpress');
        }, LONG_PRESS_MS)
      };
    }, 0);
  };

  const aimedPoint = (aimed: SpellAimSettings, coords: THREE.Vector2, e: MouseEvent | TouchEvent) => {
    const point = toLayerPoint(coords);
    return aimed.aim === 'point' && aimed.mode !== 'target'
      ? snapPoint(point, e instanceof MouseEvent && e.altKey)
      : point;
  };

  const completeSpellTarget = () => {
    if (!spell || !targetedMarkerId) return;
    onSpellTargeted?.({ spellId: spell.spellId, markerId: targetedMarkerId });
  };

  // The click that used to cast now places the area; a second click inside it casts
  const completeSpellAim = () => {
    if (!spell || !spellPlacement) return;
    if (areaPicking && spellDraft) {
      const markerIds = markersInSpellArea(spellDraft, markers, { cellPx, ftPerPx, mode });
      reportAreaTargets({ spellId: spell.spellId, placement: spellPlacement, markerIds });
    } else {
      setPlacedAim({ position: { ...spellPlacement.position }, angle: spellPlacement.angle });
    }
    spellAim = { start: null, pointer: null };
  };

  // Point aim keeps where the area was grabbed and snaps like placement; direction aim re-aims about its origin
  const movedPlacement = (
    aimed: SpellAimSettings,
    placed: SpellAimPlacement,
    pointer: TemplatePoint,
    e: MouseEvent | TouchEvent | null
  ) =>
    spellAimPlacement(aimed, {
      pointer: aimed.aim === 'point' ? snapPoint(pointer, e instanceof MouseEvent && e.altKey) : pointer,
      start: placed.position,
      ftPerPx,
      cellPx,
      snapAngle: props.tool.snapAngle
    });

  // A press on a placed area is a click (a token toggle for an area-target aim, a cast or move for a two-click one) until it travels, then it drags the area
  const pressPlacedArea = (
    aimed: SpellAimSettings,
    placed: NonNullable<typeof placedArea>,
    point: TemplatePoint,
    isTouch: boolean
  ) => {
    const anchor = spellAimPointer(aimed, placed, ftPerPx);
    const under = spellTargetAt({}, point, markers, { cellPx, ftPerPx, mode });
    areaPress = {
      grab: { x: point.x - anchor.x, y: point.y - anchor.y },
      from: point,
      isTouch,
      crossed: false,
      tapId: areaPicking && under && insideIds.includes(under) ? under : null
    };
  };

  // Past the drag slop a press moves the placed area, and an area-target aim reports who is inside it now
  const dragPlacedArea = (
    aimed: SpellAimSettings,
    placed: NonNullable<typeof placedArea>,
    point: TemplatePoint,
    e: MouseEvent | TouchEvent
  ) => {
    const press = areaPress;
    if (!press) return;
    if (e instanceof MouseEvent && (e.buttons & 1) === 0) {
      areaPress = null;
      return;
    }
    if (!press.crossed && !isPlacedAreaDrag(press.from, point, press.isTouch)) return;
    press.crossed = true;
    const grabbed = aimed.aim === 'point' ? { x: point.x - press.grab.x, y: point.y - press.grab.y } : point;
    const placement = movedPlacement(aimed, placed, grabbed, e);
    if (!areaPicking) {
      setPlacedAim(placement);
      return;
    }
    const moved = spellAimDraft(aimed, placement, {
      id: SPELL_DRAFT_ID,
      opacity: props.tool.opacity,
      visibility: props.tool.visibility
    });
    reportAreaTargets({
      spellId: aimed.spellId,
      placement,
      markerIds: markersInSpellArea(moved, markers, { cellPx, ftPerPx, mode })
    });
  };

  const releasePlacedArea = (aimed: SpellAimSettings, coords: THREE.Vector2 | null, e: MouseEvent | TouchEvent) => {
    const press = areaPress;
    areaPress = null;
    if (!coords || !press) return;
    if (areaPicking) {
      if (!press.crossed && press.tapId) onSpellTargeted?.({ spellId: aimed.spellId, markerId: press.tapId });
      return;
    }
    const placed = placedAim;
    if (!placed || !spellDraft) return;
    const action = placedAreaRelease(spellDraft, press.from, { dragged: press.crossed, ftPerPx });
    if (action === 'cast') {
      setPlacedAim(null);
      onSpellAimed?.({ spellId: aimed.spellId, position: placed.position, angle: placed.angle });
    } else if (action === 'move') {
      setPlacedAim(movedPlacement(aimed, placed, press.from, e));
    }
  };

  // Touch places on release (press, drag to aim, lift); a mouse press places, unless it only fixed the start
  const pressSpell = (aimed: SpellAimSettings, point: TemplatePoint, isTouch: boolean) => {
    if (aimed.mode === 'target') {
      spellAim = { start: null, pointer: point };
      if (!isTouch) completeSpellTarget();
      return;
    }
    const fixesStart = aimed.aim === 'direction' && !aimed.origin && !spellAim.start;
    spellAim = { start: fixesStart ? point : spellAim.start, pointer: point };
    if (!isTouch && !fixesStart) completeSpellAim();
  };

  const onContextMenu = (e: MouseEvent | TouchEvent, coords: THREE.Vector2 | null) => {
    if (spell) {
      if (!(e instanceof MouseEvent) || (e as PointerEvent).pointerType === 'touch') return;
      e.preventDefault();
      // A placed area goes back to following the pointer first; a second right-click cancels
      if (twoClick && placedAim) unplaceSpellAim();
      else onSpellAimCancelled?.();
      return;
    }
    if (!coords || !(e instanceof MouseEvent)) return;
    const id = findTemplatesAt(toLayerPoint(coords))[0]?.id;
    if (!id) return;
    e.preventDefault();
    // A touch long-press is handled by the press timer
    if ((e as PointerEvent).pointerType === 'touch') return;
    if (interaction.kind === 'dragging' && !interaction.crossed) interaction = { kind: 'idle' };
    onAoeTemplateMenu?.(id, { x: e.clientX, y: e.clientY }, 'contextmenu');
  };

  const onMouseDown = (e: MouseEvent | TouchEvent, coords: THREE.Vector2 | null) => {
    if (!coords) return;
    if (e instanceof MouseEvent && e.button !== 0) return;
    if (isTouchEvent(e) && e.touches.length !== 1) return;

    if (spell) {
      lastPressWasTouch = isTouchEvent(e);
      if (placedArea) pressPlacedArea(spell, placedArea, toLayerPoint(coords), isTouchEvent(e));
      else pressSpell(spell, aimedPoint(spell, coords, e), isTouchEvent(e));
      return;
    }

    const point = toLayerPoint(coords);
    const disableSnap = e instanceof MouseEvent && e.altKey;

    cancelLongPress();

    const isTouch = isTouchEvent(e);
    const handle = findHandle(point, isTouch);
    if (!handle) justDrawnId = null;

    if (!isActive) {
      if (handle) {
        // A token under the handle wins, as with selection below
        setTimeout(() => {
          if (performance.now() - stage.markerClaimAt < MARKER_CLAIM_WINDOW_MS) return;
          startGrab(handle, point);
        }, 0);
        return;
      }

      const stack = findTemplatesAt(point).map((template) => template.id);
      if (stack.length === 0) {
        if (props.playerSelectable && selectedIds.length > 0) selectTemplates([]);
        return;
      }
      if (isTouchEvent(e)) armLongPress(e, stack);
      // A token or light under the same click wins; markers stamp the claim on their own mouse-down
      setTimeout(() => {
        if (performance.now() - stage.markerClaimAt < MARKER_CLAIM_WINDOW_MS) return;
        cycleSelection(stack);
      }, 0);
      return;
    }

    if (interaction.kind === 'aiming') {
      commitDraft(updateDraft(interaction.draft, point, disableSnap));
      return;
    }
    if (interaction.kind !== 'idle') return;

    if (handle) {
      startGrab(handle, point);
      return;
    }

    // Starts a new shape even on top of existing ones; a short tap instead selects the shape under it
    const stack = findTemplatesAt(point).map((template) => template.id);
    startDraft(point, disableSnap, stack);
    if (isTouchEvent(e)) armLongPress(e, stack);
  };

  const onMouseMove = (e: MouseEvent | TouchEvent, coords: THREE.Vector2 | null) => {
    if (!coords) return;
    if (spell) {
      if (placedArea) dragPlacedArea(spell, placedArea, toLayerPoint(coords), e);
      else spellAim = { ...spellAim, pointer: aimedPoint(spell, coords, e) };
      return;
    }
    const point = toLayerPoint(coords);
    const disableSnap = e instanceof MouseEvent && e.altKey;

    if (longPress && isTouchEvent(e)) {
      const client = touchClientPoint(e);
      if (client && Math.hypot(client.x - longPress.x, client.y - longPress.y) > LONG_PRESS_SLOP_PX) cancelLongPress();
    }

    // The button was released outside the canvas, where no mouseup reaches us
    const isEditing = interaction.kind === 'moving' || interaction.kind === 'resizing';
    if (isEditing && e instanceof MouseEvent && (e.buttons & 1) === 0) {
      endInteraction();
      return;
    }

    switch (interaction.kind) {
      case 'dragging': {
        const moved = Math.hypot(point.x - interaction.draft.position.x, point.y - interaction.draft.position.y);
        interaction = {
          ...interaction,
          crossed: interaction.crossed || moved >= Math.max(cellPx, TAP_SLOP_PX),
          draft: updateDraft(interaction.draft, point, disableSnap)
        };
        break;
      }
      case 'aiming':
        interaction = { ...interaction, draft: updateDraft(interaction.draft, point, disableSnap) };
        break;
      case 'moving': {
        const { id, grab, starts } = interaction;
        const anchor = snapPoint({ x: point.x - grab.x, y: point.y - grab.y }, disableSnap);
        const dx = anchor.x - starts[id].x;
        const dy = anchor.y - starts[id].y;
        edit = {
          patches: Object.fromEntries(
            Object.entries(starts).map(([startId, start]) => [
              startId,
              { position: { x: start.x + dx, y: start.y + dy } }
            ])
          )
        };
        emitEdit(false);
        break;
      }
      case 'resizing': {
        const resizedId = interaction.id;
        const template = editedTemplates.find((t) => t.id === resizedId);
        if (!template) break;
        const angle =
          template.shape === AoeShape.Circle
            ? template.angle
            : angleFromCursor(template.position, point, template.shape, props.tool.snapAngle && !disableSnap);
        const size = sizeFromCursor(template.shape, template.position, point, ftPerPx, angle, !disableSnap);
        edit = { patches: { [template.id]: template.shape === AoeShape.Circle ? { size } : { size, angle } } };
        emitEdit(false);
        break;
      }
    }
  };

  const onMouseUp = (e: MouseEvent | TouchEvent, coords: THREE.Vector2 | null) => {
    if (spell) {
      if (placedArea || areaPress) {
        releasePlacedArea(spell, coords, e);
        return;
      }
      if (!isTouchEvent(e)) return;
      if (!coords) spellAim = { start: null, pointer: null };
      else if (targeting) completeSpellTarget();
      else completeSpellAim();
      return;
    }
    cancelLongPress();
    // Released off the layer, or a pinch cancelled the gesture
    if (!coords) {
      if (interaction.kind !== 'aiming') endInteraction();
      return;
    }
    const point = toLayerPoint(coords);
    const disableSnap = e instanceof MouseEvent && e.altKey;

    switch (interaction.kind) {
      case 'dragging': {
        const current = updateDraft(interaction.draft, point, disableSnap);
        const movedPx = Math.hypot(point.x - current.position.x, point.y - current.position.y);
        const { tapStack, crossed } = interaction;
        if (tapStack.length > 0 && !crossed && movedPx < Math.max(cellPx, TAP_SLOP_PX)) {
          interaction = { kind: 'idle' };
          cycleSelection(tapStack);
        } else if (movedPx >= cellPx) {
          commitDraft(current);
        } else if (isTouchEvent(e)) {
          // Touch has no hover to aim with, so a short tap would leave a stranded ghost shape
          interaction = { kind: 'idle' };
        } else {
          interaction = { kind: 'aiming', draft: current };
        }
        break;
      }
      case 'moving':
      case 'resizing':
        endInteraction();
        break;
    }
  };

  export const hasDraft = () => interaction.kind === 'dragging' || interaction.kind === 'aiming' || !!spellDraft;

  export const hitTest = (point: TemplatePoint) => findTemplatesAt(point)[0]?.id ?? null;

  export const inRectangle = (start: TemplatePoint, end: TemplatePoint) =>
    editedTemplates
      .filter((template) => templateIntersectsRect(template, start, end, ftPerPx))
      .map((template) => template.id);

  export const cancelDraft = () => {
    if (hasDraft()) interaction = { kind: 'idle' };
    spellAim = { start: null, pointer: null };
    areaPress = null;
    setPlacedAim(null);
  };

  /** Sends a placed, not yet cast, area back to following the pointer; false when nothing was placed */
  export const unplaceSpellAim = () => {
    if (!placedAim) return false;
    areaPress = null;
    setPlacedAim(null);
    return true;
  };

  // Leaving the tool drops any half-drawn shape so it can't follow later gestures
  $effect(() => {
    if (!isActive)
      untrack(() => {
        cancelDraft();
        justDrawnId = null;
      });
  });

  const inputIsActive = $derived(isActive || (selectable && (mode === StageMode.DM || !!props.playerSelectable)));
</script>

<LayerInput
  id="aoe-template"
  isActive={inputIsActive}
  target={inputMesh}
  layerSize={{ width: display.resolution.x, height: display.resolution.y }}
  {onMouseDown}
  {onMouseMove}
  {onMouseUp}
  {onContextMenu}
  isContextMenuActive={inputIsActive}
/>

<!-- Invisible quad that receives pointer input in layer space -->
<T.Mesh bind:ref={inputMesh} scale={[display.resolution.x, display.resolution.y, 1]} layers={[SceneLayer.Input]}>
  <T.MeshBasicMaterial visible={false} />
  <T.PlaneGeometry />
</T.Mesh>

{#if spell?.caster && spellRangePx > 0}
  <SpellRangeRing center={spell.caster} radius={spellRangePx} color={spell.color} />
{/if}

{#each drawnTemplates as template (template.id)}
  <AoeTemplateMesh
    {template}
    {ftToPx}
    {sharedTime}
    isDraft={draft?.id === template.id && !castCue}
    highlighted={highlightedIds.has(template.id)}
    performanceTier={stage.performanceTier}
  />
{/each}

{#each drawnTemplates as template (template.id)}
  {#if mode === StageMode.DM || hasHandles(template.id) || draft?.id === template.id}
    <AoeTemplateHandles
      {template}
      {ftToPx}
      {handleRadius}
      {sceneZoom}
      {localScale}
      {sceneRotation}
      {mapRotation}
      isSelected={hasHandles(template.id)}
      isDraft={draft?.id === template.id && !castCue}
      showLabel={props.showLabels}
      cue={draft?.id === template.id ? castCue : null}
      isHighlighted={highlightedIds.has(template.id)}
    />
  {/if}
{/each}
