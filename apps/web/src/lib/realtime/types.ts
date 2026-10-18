// Row types for the shared game session document.
// These structurally mirror the drizzle Select* types in $lib/db/app/schema, but are
// defined locally so this module (and docSchema.ts) can be bundled into the PartyKit
// server without dragging in drizzle/zod. Field names must match the DB columns 1:1 —
// the server persister copies them straight into upserts.

import type { AoeTemplate, MarkerCondition } from '@tableslayer/stage';
import type { StatBlock } from '../utils/statBlock/types';

export interface SceneSettings {
  id: string;
  gameSessionId: string;
  name: string;
  order: number;
  backgroundColor: string;
  displayPaddingX: number;
  displayPaddingY: number;
  displaySizeX: number;
  displaySizeY: number;
  displayResolutionX: number;
  displayResolutionY: number;
  fogOfWarUrl: string | null;
  fogOfWarRooms: string | null;
  fogOfWarColor: string;
  fogOfWarOpacityDm: number;
  fogOfWarOpacityPlayer: number;
  mapLocation: string | null;
  mapThumbLocation: string | null;
  mapRotation: number;
  mapOffsetX: number;
  mapOffsetY: number;
  mapZoom: number;
  gridType: number;
  gridMode: number;
  gridMapDefinedX: number | null;
  gridMapDefinedY: number | null;
  /** 0 = legacy display-space marker/light positions, 1 = map-local (MapDefined scenes) */
  mapCoordVersion: number;
  gridSpacing: number;
  gridOpacity: number;
  gridLineColor: string;
  gridLineThickness: number;
  gridShadowColor: string;
  gridShadowSpread: number;
  gridShadowBlur: number;
  gridShadowOpacity: number;
  sceneOffsetX: number;
  sceneOffsetY: number;
  sceneRotation: number;
  weatherFov: number;
  weatherIntensity: number;
  weatherOpacity: number;
  weatherType: number;
  fogEnabled: boolean;
  fogColor: string;
  fogOpacity: number;
  edgeEnabled: boolean;
  edgeUrl: string | null;
  edgeOpacity: number;
  edgeScale: number;
  edgeFadeStart: number;
  edgeFadeEnd: number;
  effectsEnabled: boolean;
  effectsBloomIntensity: number;
  effectsBloomThreshold: number;
  effectsBloomSmoothing: number;
  effectsBloomRadius: number;
  effectsBloomLevels: number;
  effectsBloomMipMapBlur: boolean;
  effectsChromaticAberrationOffset: number;
  effectsLutUrl: string | null;
  effectsToneMappingMode: number;
  markerStrokeColor: string;
  markerStrokeWidth: number;
  markerTextColor: string;
  markerTextStrokeColor: string;
  // Combat (optional: rows hydrated before these fields existed lack them)
  /** 0 = no combat or still rolling initiative, 1+ = current round */
  combatRound?: number;
  combatActiveMarkerId?: string | null;
  /** True while the turn sits on the initiative-20 lair step */
  combatLairStep?: boolean;
  /** Whether turns stop on the lair step */
  combatLairActions?: boolean;
  combatShowOnTv?: boolean;
}

export interface MarkerRow {
  assetId?: string | null;
  id: string;
  sceneId: string;
  visibility: number;
  title: string;
  label: string | null;
  imageLocation: string | null;
  imageScale: number;
  positionX: number;
  positionY: number;
  shape: number;
  shapeColor: string;
  size: number;
  note: unknown;
  pinnedTooltip: boolean;
  conditions?: MarkerCondition[] | null;
  statBlock?: StatBlock | null;
  hitPoints?: number | null;
  tempHitPoints?: number | null;
  // Combat (optional for the same reason as SceneSettings)
  inCombat?: boolean;
  /** Rolled or typed total; null = not rolled */
  initiative?: number | null;
  /** GM override; null = use the stat block or 0 */
  initiativeBonus?: number | null;
  /** Higher acts first among equal initiatives */
  initiativeTiebreak?: number;
}

export interface LightRow {
  id: string;
  sceneId: string;
  positionX: number;
  positionY: number;
  radius: number;
  color: string;
  style: string;
  pulse: number;
  opacity: number;
}

export interface AnnotationRow {
  id: string;
  sceneId: string;
  name: string;
  opacity: number;
  color: string;
  url: string | null;
  visibility: number;
  order: number;
  effectType: number | null;
}

export interface AoeTemplateRow {
  id: string;
  sceneId: string;
  shape: `${AoeTemplate['shape']}`;
  positionX: number;
  positionY: number;
  angle: number;
  size: number;
  width: number;
  effect: number;
  color: string;
  opacity: number;
  visibility: number;
  label: string | null;
  anchorMarkerId: string | null;
  /** Unix seconds, like the DB column; used for stable ordering */
  createdAt: number;
}

export interface SceneSnapshot {
  id: string;
  settings: SceneSettings;
  markers: MarkerRow[];
  lights: LightRow[];
  aoeTemplates: AoeTemplateRow[];
  /** Includes each annotation's RLE mask as a stable Uint8Array reference. */
  annotations: Array<AnnotationRow & { mask?: Uint8Array | null }>;
}

/** Lightweight entry for scene lists/selectors, derived from settings. */
export interface SceneListEntry {
  id: string;
  name: string;
  order: number;
  gameSessionId: string;
  mapLocation: string | null;
  mapThumbLocation: string | null;
}

export interface HandoutDescriptor {
  presentationId: string;
  artworkLocation: string;
  title: string | null;
  presenterId: string;
  publishedAt: number;
}

export interface PartyState {
  activeSceneId: string | null;
  isPaused: boolean;
  activeHandout?: HandoutDescriptor | null;
}

/** Everything needed to build a session doc from the database. */
export interface GameSessionHydrationData {
  scenes: Array<{
    settings: SceneSettings;
    markers: MarkerRow[];
    lights: LightRow[];
    aoeTemplates?: AoeTemplateRow[];
    annotations: Array<AnnotationRow & { mask?: Uint8Array | null }>;
    fogMask?: Uint8Array | null;
  }>;
}

export type ScenePart = 'settings' | 'markers' | 'lights' | 'aoeTemplates' | 'annotations' | 'fogMask';

export interface SceneChange {
  sceneId: string;
  part: ScenePart | 'scenes';
  /** Changed keys at the event target (settings field names, marker/annotation ids, ...). */
  keys: string[];
  /** Set when the change happened inside a keyed child (markerId, lightId, aoeTemplateId, annotationId). */
  childId?: string;
  /** False when this client's own transaction produced the change. */
  remote: boolean;
  /** True when a local Y.UndoManager produced the change (local, but the canvas
   *  must re-apply masks exactly as it does for remote changes). */
  undoRedo: boolean;
}
