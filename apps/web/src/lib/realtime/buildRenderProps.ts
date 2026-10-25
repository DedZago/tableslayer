import type { SelectAnnotation, SelectLight, SelectMarker, SelectScene } from '$lib/db/app/schema';
import { buildSceneProps } from '$lib/utils/buildSceneProps';
import type { AoeToolSettings, DrawMode, MapLayerType, StageProps, ToolType } from '@tableslayer/stage';
import type { SceneSnapshot } from './types';

/**
 * Local-only view state layered over the shared doc snapshot. Nothing here is
 * synced or persisted with the scene — it lives in plain component $state and
 * its overrides win for exactly as long as the page keeps them set (e.g. for
 * the duration of a drag gesture), replacing the old timing-window guards.
 */
export interface LocalView {
  mode: 'editor' | 'client';
  activeLayer?: MapLayerType;
  /** Editor workspace camera; never shared. */
  viewport?: {
    offset?: { x: number; y: number };
    zoom?: number;
    rotation?: number;
    autoFit?: boolean;
  };
  /** In-progress map alignment drag (committed to the doc on gesture end). */
  mapTransform?: {
    offset?: { x: number; y: number };
    zoom?: number;
  };
  /** In-progress marker drags by id (committed to the doc on drop). */
  markerPositions?: Record<string, { x: number; y: number }>;
  /** A dragged token that moves without the rest of its group */
  detachedMarkerId?: string | null;
  /** Snap-to-grid is a per-user preference, not a shared scene setting. */
  marker?: { snapToGrid?: boolean };
  light?: { snapToGrid?: boolean };
  /** Local tool configuration; brush size/line width are per-user preferences. */
  fogTool?: { type?: ToolType; size?: number; mode?: DrawMode };
  annotations?: {
    activeLayer?: string | null;
    lineWidth?: number;
    smoothingEnabled?: boolean;
  };
  /** Active measurement tool configuration (type, cone angle, beam width). */
  measurement?: { type?: number; coneAngle?: number; beamWidth?: number };
  /** AoE tool settings and selection are per-user, like the other tools. */
  aoeTemplates?: {
    tool?: Partial<AoeToolSettings>;
    selectedId?: string | null;
    selectedIds?: string[];
    showLabels?: boolean;
    playerSelectable?: boolean;
  };
}

type Point = { x: number; y: number };

// The rest of a dragged token's group follows its live position before the drag's writes land
const applyDragPositions = (
  props: StageProps,
  snapshot: SceneSnapshot,
  overrides: Record<string, Point>,
  detachedMarkerId: string | null | undefined
) => {
  const groupOfMarker = new Map(snapshot.markers.map((marker) => [marker.id, marker.groupId ?? null]));
  const groupDeltas = new Map<string, Point>();
  for (const marker of props.marker.markers) {
    const override = overrides[marker.id];
    if (!override) continue;
    const groupId = groupOfMarker.get(marker.id);
    if (groupId && marker.id !== detachedMarkerId && !groupDeltas.has(groupId)) {
      groupDeltas.set(groupId, { x: override.x - marker.position.x, y: override.y - marker.position.y });
    }
    marker.position = override;
  }
  if (groupDeltas.size === 0) return;

  const shifted = (position: Point, groupId: string | null | undefined) => {
    const delta = groupId ? groupDeltas.get(groupId) : undefined;
    return delta ? { x: position.x + delta.x, y: position.y + delta.y } : position;
  };
  for (const marker of props.marker.markers) {
    if (!overrides[marker.id]) marker.position = shifted(marker.position, groupOfMarker.get(marker.id));
  }
  const lightGroups = new Map(snapshot.lights.map((light) => [light.id, light.groupId]));
  for (const light of props.light.lights) light.position = shifted(light.position, lightGroups.get(light.id));
  const templateGroups = new Map(snapshot.aoeTemplates.map((template) => [template.id, template.groupId]));
  for (const template of props.aoeTemplates?.templates ?? []) {
    template.position = shifted(template.position, templateGroups.get(template.id));
  }
};

/**
 * Pure derivation: shared snapshot + local view -> StageProps. The result is a
 * fresh object each call; interaction callbacks must write to the doc or to the
 * local view, never back into the returned props.
 */
export const buildRenderProps = (snapshot: SceneSnapshot, view: LocalView, bucketUrl?: string): StageProps => {
  // Doc rows structurally match the drizzle Select* row types (see realtime/types.ts)
  const props = buildSceneProps(
    snapshot.settings as unknown as SelectScene,
    snapshot.markers as unknown as SelectMarker[],
    view.mode,
    snapshot.annotations as unknown as SelectAnnotation[],
    snapshot.lights as unknown as SelectLight[],
    bucketUrl,
    snapshot.aoeTemplates
  );

  if (view.activeLayer !== undefined) props.activeLayer = view.activeLayer;

  if (view.viewport?.offset) props.scene.offset = view.viewport.offset;
  if (view.viewport?.zoom !== undefined) props.scene.zoom = view.viewport.zoom;
  if (view.viewport?.rotation !== undefined) props.scene.rotation = view.viewport.rotation;
  if (view.viewport?.autoFit !== undefined) props.scene.autoFit = view.viewport.autoFit;

  if (view.mapTransform?.offset) props.map.offset = view.mapTransform.offset;
  if (view.mapTransform?.zoom !== undefined) props.map.zoom = view.mapTransform.zoom;

  if (view.markerPositions) applyDragPositions(props, snapshot, view.markerPositions, view.detachedMarkerId);

  if (view.marker?.snapToGrid !== undefined) props.marker.snapToGrid = view.marker.snapToGrid;
  if (view.light?.snapToGrid !== undefined) props.light.snapToGrid = view.light.snapToGrid;

  if (view.fogTool?.type !== undefined) props.fogOfWar.tool.type = view.fogTool.type;
  if (view.fogTool?.size !== undefined) props.fogOfWar.tool.size = view.fogTool.size;
  if (view.fogTool?.mode !== undefined) props.fogOfWar.tool.mode = view.fogTool.mode;

  if (view.annotations?.activeLayer !== undefined) props.annotations.activeLayer = view.annotations.activeLayer;
  if (view.annotations?.lineWidth !== undefined) props.annotations.lineWidth = view.annotations.lineWidth;
  if (view.annotations?.smoothingEnabled !== undefined) {
    props.annotations.smoothingEnabled = view.annotations.smoothingEnabled;
  }

  if (view.measurement?.type !== undefined) props.measurement.type = view.measurement.type;
  if (view.measurement?.coneAngle !== undefined) props.measurement.coneAngle = view.measurement.coneAngle;
  if (view.measurement?.beamWidth !== undefined) props.measurement.beamWidth = view.measurement.beamWidth;

  if (view.aoeTemplates?.tool) props.aoeTemplates!.tool = { ...props.aoeTemplates!.tool, ...view.aoeTemplates.tool };
  if (view.aoeTemplates?.selectedId !== undefined) props.aoeTemplates!.selectedId = view.aoeTemplates.selectedId;
  if (view.aoeTemplates?.selectedIds !== undefined) props.aoeTemplates!.selectedIds = view.aoeTemplates.selectedIds;
  if (view.aoeTemplates?.showLabels !== undefined) props.aoeTemplates!.showLabels = view.aoeTemplates.showLabels;
  if (view.aoeTemplates?.playerSelectable !== undefined) {
    props.aoeTemplates!.playerSelectable = view.aoeTemplates.playerSelectable;
  }

  return props;
};
