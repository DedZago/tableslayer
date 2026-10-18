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
    sizeFromCursor,
    templateContainsPoint,
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
  const { onAoeTemplateAdded, onAoeTemplateUpdated, onAoeTemplateSelected } = getContext<Callbacks>('callbacks');

  const EDIT_EMIT_INTERVAL_MS = 50;

  type Interaction =
    | { kind: 'idle' }
    | { kind: 'dragging'; draft: AoeTemplate }
    | { kind: 'aiming'; draft: AoeTemplate }
    | { kind: 'moving'; id: string; grab: TemplatePoint }
    | { kind: 'resizing'; id: string };

  let inputMesh = $state.raw(new THREE.Mesh());
  let interaction = $state<Interaction>({ kind: 'idle' });
  let edit: { id: string; patch: Partial<AoeTemplate> } | null = $state(null);
  let lastEmitAt = 0;

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
  const draft = $derived(interaction.kind === 'dragging' || interaction.kind === 'aiming' ? interaction.draft : null);

  const visibleTemplates = $derived(
    props.templates.filter((template) => mode === StageMode.DM || template.visibility !== StageMode.DM)
  );
  const editedTemplates = $derived(
    visibleTemplates.map((template) => (edit?.id === template.id ? { ...template, ...edit.patch } : template))
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
    if (!isActive || mode !== StageMode.DM) return;
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

  const isNear = (a: TemplatePoint, b: TemplatePoint) => Math.hypot(a.x - b.x, a.y - b.y) <= handleRadius;

  const findTemplateAt = (point: TemplatePoint) =>
    [...editedTemplates]
      .reverse()
      .find((template) => isNear(point, template.position) || templateContainsPoint(template, point, ftPerPx));

  const findSelectedTemplate = () => editedTemplates.find((template) => template.id === props.selectedId);

  const updateDraft = (current: AoeTemplate, point: TemplatePoint, disableSnap: boolean): AoeTemplate => {
    const angle =
      current.shape === AoeShape.Circle
        ? current.angle
        : angleFromCursor(current.position, point, current.shape, props.tool.snapAngle && !disableSnap);
    const size = sizeFromCursor(current.shape, current.position, point, ftPerPx, angle, !disableSnap);
    return { ...current, angle, size };
  };

  const startDraft = (point: TemplatePoint, disableSnap: boolean) => {
    const position = snapPoint(point, disableSnap);
    interaction = {
      kind: 'dragging',
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
    onAoeTemplateUpdated?.(edit.id, edit.patch);
  };

  // Ends any gesture; an in-progress move/resize lands its latest patch first
  const endInteraction = () => {
    if (interaction.kind === 'moving' || interaction.kind === 'resizing') emitEdit(true);
    edit = null;
    interaction = { kind: 'idle' };
  };

  const commitDraft = (template: AoeTemplate) => {
    onAoeTemplateAdded?.(template);
    interaction = { kind: 'idle' };
  };

  const startEdit = (id: string, kind: 'moving' | 'resizing', grab: TemplatePoint = { x: 0, y: 0 }) => {
    interaction = kind === 'moving' ? { kind, id, grab } : { kind, id };
    edit = { id, patch: {} };
  };

  const onMouseDown = (e: MouseEvent | TouchEvent, coords: THREE.Vector2 | null) => {
    if (!coords) return;
    if (e instanceof MouseEvent && e.button !== 0) return;
    if (e instanceof TouchEvent && e.touches.length !== 1) return;

    const point = toLayerPoint(coords);
    const disableSnap = e instanceof MouseEvent && e.altKey;

    if (!isActive) {
      const hit = findTemplateAt(point);
      if (!hit || hit.id === props.selectedId) return;
      // A token or light under the same click wins; markers stamp the claim on their own mouse-down
      setTimeout(() => {
        if (performance.now() - stage.markerClaimAt < MARKER_CLAIM_WINDOW_MS) return;
        onAoeTemplateSelected?.(hit.id);
      }, 0);
      return;
    }

    if (interaction.kind === 'aiming') {
      commitDraft(updateDraft(interaction.draft, point, disableSnap));
      return;
    }
    if (interaction.kind !== 'idle') return;

    const selected = findSelectedTemplate();
    if (selected) {
      const handles = getTemplateHandlePoints(selected, ftPerPx);
      if (isNear(point, handles.origin)) {
        startEdit(selected.id, 'moving', { x: point.x - selected.position.x, y: point.y - selected.position.y });
        return;
      }
      if (isNear(point, handles.end)) {
        startEdit(selected.id, 'resizing');
        return;
      }
    }

    const hit = findTemplateAt(point);
    if (hit) {
      if (hit.id === props.selectedId) {
        startEdit(hit.id, 'moving', { x: point.x - hit.position.x, y: point.y - hit.position.y });
      } else {
        onAoeTemplateSelected?.(hit.id);
      }
      return;
    }
    startDraft(point, disableSnap);
  };

  const onMouseMove = (e: MouseEvent | TouchEvent, coords: THREE.Vector2 | null) => {
    if (!coords) return;
    const point = toLayerPoint(coords);
    const disableSnap = e instanceof MouseEvent && e.altKey;

    // The button was released outside the canvas, where no mouseup reaches us
    const isEditing = interaction.kind === 'moving' || interaction.kind === 'resizing';
    if (isEditing && e instanceof MouseEvent && (e.buttons & 1) === 0) {
      endInteraction();
      return;
    }

    switch (interaction.kind) {
      case 'dragging':
      case 'aiming':
        interaction = { ...interaction, draft: updateDraft(interaction.draft, point, disableSnap) };
        break;
      case 'moving': {
        const position = snapPoint({ x: point.x - interaction.grab.x, y: point.y - interaction.grab.y }, disableSnap);
        edit = { id: interaction.id, patch: { position } };
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
        edit = { id: template.id, patch: template.shape === AoeShape.Circle ? { size } : { size, angle } };
        emitEdit(false);
        break;
      }
    }
  };

  const onMouseUp = (e: MouseEvent | TouchEvent, coords: THREE.Vector2 | null) => {
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
        if (movedPx >= cellPx) {
          commitDraft(current);
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

  export const cancelDraft = () => {
    if (hasDraft()) interaction = { kind: 'idle' };
  };

  const inputIsActive = $derived((isActive || selectable) && mode === StageMode.DM);
</script>

<LayerInput
  id="aoe-template"
  isActive={inputIsActive}
  target={inputMesh}
  layerSize={{ width: display.resolution.x, height: display.resolution.y }}
  {onMouseDown}
  {onMouseMove}
  {onMouseUp}
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

{#if mode === StageMode.DM}
  {#each drawnTemplates as template (template.id)}
    <AoeTemplateHandles
      {template}
      {ftToPx}
      {handleRadius}
      {sceneZoom}
      {localScale}
      {sceneRotation}
      {mapRotation}
      isSelected={template.id === props.selectedId}
      isDraft={draft?.id === template.id}
      showLabel={props.showLabels}
    />
  {/each}
{/if}
