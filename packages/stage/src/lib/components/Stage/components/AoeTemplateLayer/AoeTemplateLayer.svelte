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
    TEMPLATE_MIN_SIZE_FT,
    angleFromCursor,
    getTemplateHandlePoints,
    nextTemplateInStack,
    sizeFromCursor,
    templateContainsPoint,
    templateIntersectsRect,
    type TemplatePoint
  } from '../../helpers/aoeTemplates';
  import {
    AoeEffect,
    AoeShape,
    type AoeTemplate,
    type AoeTemplateLayerExports,
    type AoeTemplateLayerProps
  } from './types';
  import AoeTemplateMesh from './AoeTemplateMesh.svelte';
  import AoeTemplateHandles from './AoeTemplateHandles.svelte';

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
    mapRotation
  }: Props = $props();

  const { renderer } = useThrelte();
  const stage = getContext<{ performanceTier: PerformanceTier; markerClaimAt: number }>('stage');
  const framePacer = getContext<FramePacer | undefined>('framePacer');
  const MARKER_CLAIM_WINDOW_MS = 100;
  const { onAoeTemplateAdded, onAoeTemplateUpdated, onAoeTemplateSelected, onAoeTemplatesSelected, onAoeTemplateMenu } =
    getContext<Callbacks>('callbacks');

  const EDIT_EMIT_INTERVAL_MS = 50;
  // A press that starts on an existing shape is a tap (select / cycle) until it travels this far
  const TAP_SLOP_PX = 10;
  const LONG_PRESS_MS = 500;
  const LONG_PRESS_SLOP_PX = 12;
  // A fingertip covers far more than a mouse pointer, so touch grabs handles from further away
  const TOUCH_GRAB_SCALE = 2;

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
  useTask((delta) => {
    sharedTime.value += delta;
    if (animatedTemplateCount > 0) framePacer?.markActive();
  });

  const cellPx = $derived(getGridCellSize(grid, display));
  const ftToPx = $derived(cellPx / (grid.worldGridSize || 5));
  const ftPerPx = $derived(1 / ftToPx);
  const handleRadius = $derived(0.35 * cellPx);
  const isPendingTap = $derived(
    interaction.kind === 'dragging' && interaction.tapStack.length > 0 && !interaction.crossed
  );
  const draft = $derived(
    (interaction.kind === 'dragging' || interaction.kind === 'aiming') && !isPendingTap ? interaction.draft : null
  );
  const selectedIds = $derived(props.selectedIds ?? (props.selectedId ? [props.selectedId] : []));
  const selectedSet = $derived(new Set(selectedIds));
  const hasHandles = (id: string) => selectedSet.has(id) || id === justDrawnId;

  const visibleTemplates = $derived(
    props.templates.filter((template) => mode === StageMode.DM || template.visibility !== StageMode.DM)
  );
  const editedTemplates = $derived(
    visibleTemplates.map((template) =>
      edit?.patches[template.id] ? { ...template, ...edit.patches[template.id] } : template
    )
  );
  const drawnTemplates = $derived(draft ? [...editedTemplates, draft] : editedTemplates);
  const animatedTemplateCount = $derived(
    drawnTemplates.filter((template) => template.effect !== AoeEffect.None).length
  );

  $effect(() => {
    if (!isActive) untrack(() => endInteraction());
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
      editedTemplates.filter((template) => ids.includes(template.id)).map((t) => [t.id, { ...t.position }])
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
        return [
          { template, kind: 'origin' as const, at: origin },
          { template, kind: 'end' as const, at: end }
        ];
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

  const onContextMenu = (e: MouseEvent | TouchEvent, coords: THREE.Vector2 | null) => {
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

  export const hasDraft = () => interaction.kind === 'dragging' || interaction.kind === 'aiming';

  export const hitTest = (point: TemplatePoint) => findTemplatesAt(point)[0]?.id ?? null;

  export const inRectangle = (start: TemplatePoint, end: TemplatePoint) =>
    editedTemplates
      .filter((template) => templateIntersectsRect(template, start, end, ftPerPx))
      .map((template) => template.id);

  export const cancelDraft = () => {
    if (hasDraft()) interaction = { kind: 'idle' };
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

{#each drawnTemplates as template (template.id)}
  <AoeTemplateMesh
    {template}
    {ftToPx}
    {sharedTime}
    isDraft={draft?.id === template.id}
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
      isDraft={draft?.id === template.id}
      showLabel={props.showLabels}
    />
  {/if}
{/each}
