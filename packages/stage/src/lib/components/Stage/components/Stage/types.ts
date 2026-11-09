import type { AnnotationsLayerProps } from '../AnnotationLayer/types';
import type {
  AoeTemplate,
  AoeTemplateLayerExports,
  AoeTemplateLayerProps,
  SpellAimed,
  SpellAimPlaced,
  SpellAreaTargets,
  SpellTargeted
} from '../AoeTemplateLayer/types';
import type { EdgeOverlayProps } from '../EdgeOverlayLayer/types';
import type { FogLayerProps } from '../FogLayer/types';
import type { FogOfWarLayerProps } from '../FogOfWarLayer/types';
import type { GridLayerProps } from '../GridLayer/types';
import type { Light, LightLayerProps } from '../LightLayer/types';
import type { MapLayerProps, MapLayerType } from '../MapLayer/types';
import type { Marker, MarkerLayerProps } from '../MarkerLayer/types';
import type { MeasurementLayerProps } from '../MeasurementLayer/types';
import type { PostProcessingProps, SceneLayerProps } from '../Scene/types';
import type { SpellCast, SpellPrewarmExports } from '../SpellCastLayer/types';
import type { TokenEffect } from '../TokenEffectLayer/types';
import type { WeatherLayerProps } from '../WeatherLayer/types';
export type { CursorData } from '../CursorLayer/types';

export interface Callbacks {
  onAnnotationUpdate: (layerId: string, getBlob: () => Promise<Blob>, endPosition?: { x: number; y: number }) => void;
  onFogUpdate: (getBlob: () => Promise<Blob>) => void;
  onFogRoomAdd?: (points: { x: number; y: number }[]) => void;
  onFogRoomToggle?: (roomId: string) => void;
  onFogRoomDelete?: (roomId: string) => void;
  onMapUpdate: (offset: { x: number; y: number }, zoom: number) => void;
  onSceneUpdate: (offset: { x: number; y: number }, zoom: number) => void;
  onStageLoading: () => void;
  onStageInitialized: () => void;
  onMarkerAdded: (marker: Marker) => void;
  onMarkerMoved: (marker: Marker, position: { x: number; y: number }) => void;
  /** Group drag: called once per pointer move with every moved marker. Optional — falls back to onMarkerMoved per marker. */
  onMarkersMoved?: (moves: Array<{ marker: Marker; position: { x: number; y: number } }>) => void;
  /**
   * Group drag ended (pointer released, window blurred, layer reset) or was cancelled with Escape,
   * in which case the members were already moved back to their start positions.
   */
  onMarkersMoveEnd?: (result: { ids: string[]; cancelled: boolean }) => void;
  onMarkerSelected: (marker: Marker | null) => void;
  onMarkerDoubleClick?: (marker: Marker) => void;
  onMarkerContextMenu: (marker: Marker, event: MouseEvent | TouchEvent) => void;
  /** A 500 ms press on a token that did not move; the press then neither drags nor reports a click */
  onMarkerLongPress?: (marker: Marker, position: { x: number; y: number }) => void;
  onMeasurementStart?: (startPoint: { x: number; y: number }, type: number) => void;
  onMeasurementUpdate?: (
    startPoint: { x: number; y: number },
    endPoint: { x: number; y: number },
    type: number
  ) => void;
  onMeasurementEnd?: () => void;
  onCursorMove?: (worldPosition: { x: number; y: number; z: number }) => void;
  onMarkerHover?: (marker: Marker | null) => void;
  onLightAdded?: (light: Light) => void;
  onLightMoved?: (light: Light, position: { x: number; y: number }) => void;
  onLightSelected?: (light: Light | null) => void;
  onAoeTemplateAdded?: (template: AoeTemplate) => void;
  onAoeTemplateUpdated?: (id: string, patch: Partial<Omit<AoeTemplate, 'id'>>) => void;
  onAoeTemplateSelected?: (id: string | null) => void;
  /** Multi-selection; when omitted, `onAoeTemplateSelected` receives the last id */
  onAoeTemplatesSelected?: (ids: string[]) => void;
  onAoeTemplateDeleted?: (id: string) => void;
  /** A shape was right-clicked (mouse) or held down (touch); `position` is in client pixels */
  onAoeTemplateMenu?: (id: string, position: { x: number; y: number }, trigger: 'contextmenu' | 'longpress') => void;
  /** A spell set in the AoE tool's `spell` was cast: its placed area was clicked or tapped inside */
  onSpellAimed?: (aimed: SpellAimed) => void;
  /**
   * An area spell was placed (the first click), moved, or went back to following the pointer (null).
   * The consumer keeps the last placement so Enter can cast it, and un-places it on Escape
   * through `StageExports.aoeTemplates.unplaceSpellAim`
   */
  onSpellAimPlaced?: (placed: SpellAimPlaced) => void;
  /** A token was picked for a spell aimed in `target` mode; the aim stays until the consumer ends it */
  onSpellTargeted?: (targeted: SpellTargeted) => void;
  /**
   * An `area-targets` spell was placed or moved, or the tokens inside its area changed. Reported only when the
   * placement or the id list differs from the last report; the consumer stores the placement and passes it back
   */
  onSpellAreaTargets?: (areaTargets: SpellAreaTargets) => void;
  /** The aim was dismissed on the stage (right-click) */
  onSpellAimCancelled?: () => void;
}

/**
 * Fast-changing state passed to <Stage> as component props, outside the main
 * `props` object, so changing it never rebuilds the render props.
 */
export interface StageInteractionProps {
  selectedMarkerIds?: string[];
  /** Lights drawn as selected; without it the light layer highlights the light it last picked */
  selectedLightIds?: string[];
  dropTargetMarkerId?: string | null;
  /** Combatant whose turn it is; draws the active-turn ring */
  activeTurnMarkerId?: string | null;
  /** Shows the distance from the selected token to every other visible token */
  distanceMode?: boolean;
  /** Transient spell animations to play; the consumer prunes them after `durationMs` */
  spellCasts?: SpellCast[];
  /**
   * A focused concentration: its areas and token effects (by template id) glow and pulse, and the tokens listed
   * (its summons and the caster) are outlined, the caster's seal brightened
   */
  spellHighlight?: SpellHighlight;
}

export interface SpellHighlight {
  templateIds: string[];
  markerIds: string[];
}

export enum StageMode {
  DM = 0,
  Player = 1
}

/**
 * Rendering quality tier. The Stage only ever receives a concrete tier;
 * automatic tier selection is the responsibility of the consumer.
 */
export type PerformanceTier = 'high' | 'medium' | 'low';

/**
 * Per-tier rendering settings applied by the individual layers.
 * fogOctaveCap limits noise octaves per fog layer, fogLayerCount limits how
 * many of the four fog-of-war noise layers render, weatherResolutionScale
 * scales the particle render target, weatherParticleScale scales particle
 * counts, and forcePostProcessingOff bypasses the effect composer entirely.
 *
 * The atmo* knobs drive the atmosphere engine: atmoFieldSize and atmoAccumSize are the wind field and
 * accumulation texture edges in texels, atmoSimHz the worker step rate, atmoDepthLayers the particle
 * parallax layers, atmoRippleTaps the ripple cells sampled per axis (1 = single tap), atmoDensityScale
 * the density render target scale relative to the air target, atmoNoiseOctaves the fbm octave cap and
 * atmoHdrBolts whether lightning bolts render above 1.0 for bloom.
 */
export const PERFORMANCE_TIER_SETTINGS: Record<
  PerformanceTier,
  {
    fogLayerCount: number;
    fogOctaveCap: number;
    weatherResolutionScale: number;
    weatherParticleScale: number;
    forcePostProcessingOff: boolean;
    atmoFieldSize: number;
    atmoAccumSize: number;
    atmoSimHz: number;
    atmoDepthLayers: 1 | 2 | 3;
    atmoRippleTaps: 1 | 2 | 3;
    atmoDensityScale: number;
    atmoNoiseOctaves: 1 | 2 | 3;
    atmoHdrBolts: boolean;
  }
> = {
  high: {
    fogLayerCount: 4,
    fogOctaveCap: Number.MAX_SAFE_INTEGER,
    weatherResolutionScale: 1,
    weatherParticleScale: 1,
    forcePostProcessingOff: false,
    atmoFieldSize: 128,
    atmoAccumSize: 128,
    atmoSimHz: 30,
    atmoDepthLayers: 3,
    atmoRippleTaps: 3,
    atmoDensityScale: 0.5,
    atmoNoiseOctaves: 3,
    atmoHdrBolts: true
  },
  medium: {
    fogLayerCount: 2,
    fogOctaveCap: 3,
    weatherResolutionScale: 0.5,
    weatherParticleScale: 0.5,
    forcePostProcessingOff: false,
    atmoFieldSize: 96,
    atmoAccumSize: 128,
    atmoSimHz: 20,
    atmoDepthLayers: 2,
    atmoRippleTaps: 2,
    atmoDensityScale: 0.5,
    atmoNoiseOctaves: 2,
    atmoHdrBolts: false
  },
  low: {
    fogLayerCount: 1,
    fogOctaveCap: 2,
    weatherResolutionScale: 0.5,
    weatherParticleScale: 0.25,
    forcePostProcessingOff: true,
    atmoFieldSize: 64,
    atmoAccumSize: 64,
    atmoSimHz: 12,
    atmoDepthLayers: 1,
    atmoRippleTaps: 1,
    atmoDensityScale: 0.5,
    atmoNoiseOctaves: 1,
    atmoHdrBolts: false
  }
};

export interface DisplayProps {
  /**
   * The minimum padding around the grid relative to the edge of the scene.
   * The actual padding may be greater depending on the grid layout.
   */
  padding: {
    x: number;
    y: number;
  };

  /**
   * The size of the display in inches
   */
  size: { x: number; y: number };

  /**
   * The resolution of the display in pixels
   */
  resolution: { x: number; y: number };

  /**
   * Maximum device pixel ratio to use for rendering.
   * Caps the pixel ratio to improve performance on high-DPI devices with weak GPUs.
   * Defaults to 2 if not specified.
   */
  maxPixelRatio?: number;
}

/**
 * Properties for the Stage component
 */
export type StageProps = {
  mode: StageMode;
  activeLayer: MapLayerType;
  annotations: AnnotationsLayerProps;
  backgroundColor: string;
  debug: {
    enableStats: boolean;
    loggingRate: number;
    enableMetrics: boolean;
    logMetricsToConsole: boolean;
    disabledLayers: string[];
  };
  display: DisplayProps;
  fog: FogLayerProps;
  edgeOverlay: EdgeOverlayProps;
  fogOfWar: FogOfWarLayerProps;
  grid: GridLayerProps;
  light: LightLayerProps;
  map: MapLayerProps;
  marker: MarkerLayerProps;
  measurement: MeasurementLayerProps;
  /** Spell area templates. Optional so existing consumers keep working. */
  aoeTemplates?: AoeTemplateLayerProps;
  /** Ambient effects bound to tokens (spell effects, concentration rings); drawn by a lazily loaded layer */
  tokenEffects?: TokenEffect[];
  /**
   * Rendering quality tier. Defaults to 'high' (full quality).
   */
  performanceTier?: PerformanceTier;
  postProcessing: PostProcessingProps;
  scene: SceneLayerProps;
  weather: WeatherLayerProps;
};

export interface StageExports {
  annotations: {
    clear: (layerId: string) => void;
    /** The active layer's mask, or the given layer's */
    toRLE: (layerId?: string) => Promise<Uint8Array>;
    fromRLE: (rleData: Uint8Array, width: number, height: number) => Promise<void>;
    loadMask: (layerId: string, rleData: Uint8Array) => Promise<void>;
    isDrawing: () => boolean;
  };

  fogOfWar: {
    clear: () => void;
    reset: () => void;
    toPng: () => Promise<Blob>;
    toRLE: () => Promise<Uint8Array>;
    fromRLE: (rleData: Uint8Array, width: number, height: number) => Promise<void>;
    isDrawing: () => boolean;
    commitPolygon: () => void;
    cancelPolygon: () => void;
    polygonPointCount: () => number;
    deleteRoomAtCursor: () => void;
  };
  map: {
    fit: () => void;
    fill: () => void;
    getSize: () => { width: number; height: number } | null;
  };
  scene: {
    fit: () => void;
    fill: () => void;
    generateThumbnail: () => Promise<Blob>;
    /** One grid cell's width in CSS pixels at the current zoom */
    gridCellScreenSize: () => number;
  };
  markers: {
    isHoveringMarker: boolean;
    isDraggingMarker: boolean;
    clientToPosition: (point: { x: number; y: number }, requireOnMap?: boolean) => { x: number; y: number } | null;
    viewportCenter: () => { x: number; y: number } | null;
    snapPosition: (point: { x: number; y: number }) => { x: number; y: number };
    hitTest: (point: { x: number; y: number }) => string | null;
    inRectangle: (start: { x: number; y: number }, end: { x: number; y: number }) => string[];
  };
  lights: {
    isHoveringLight: boolean;
    isDraggingLight: boolean;
    /** The light under a layer-local point (see `markers.clientToPosition`) */
    hitTest: (point: { x: number; y: number }) => string | null;
    /** Lights whose center lies inside a layer-local rectangle */
    inRectangle: (start: { x: number; y: number }, end: { x: number; y: number }) => string[];
  };
  aoeTemplates: AoeTemplateLayerExports;
  spells: SpellPrewarmExports;
  measurement: {
    getCurrentMeasurement: () => {
      startPoint: { x: number; y: number } | null;
      endPoint: { x: number; y: number } | null;
      type: number;
    } | null;
    isDrawing: () => boolean;
  };
  onSceneChange: () => void;
}
