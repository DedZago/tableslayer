import type { StagePerformanceSetting } from '$lib/stores/stagePerformance.svelte';
import type { HoveredMarker } from '@tableslayer/stage';
import type YPartyKitProvider from 'y-partykit/provider';

type Awareness = YPartyKitProvider['awareness'];

export interface CursorData {
  userId: string;
  worldPosition: { x: number; y: number; z: number };
  color?: string;
  label?: string;
  lastMoveTime: number;
  clientId?: number;
}

export interface MeasurementData {
  userId: string;
  startPoint: { x: number; y: number };
  endPoint: { x: number; y: number };
  type: number;
  timestamp: number;
  clientId?: number;
  color: string;
  thickness: number;
  outlineColor: string;
  outlineThickness: number;
  opacity: number;
  markerSize: number;
  autoHideDelay: number;
  fadeoutTime: number;
  showDistance: boolean;
  snapToGrid: boolean;
  enableDMG252: boolean;
  beamWidth?: number;
  coneAngle?: number;
}

export interface MeasurementStyleProps {
  color: string;
  thickness: number;
  outlineColor: string;
  outlineThickness: number;
  opacity: number;
  markerSize: number;
  autoHideDelay: number;
  fadeoutTime: number;
  showDistance: boolean;
  snapToGrid: boolean;
  enableDMG252: boolean;
  beamWidth?: number;
  coneAngle?: number;
}

/** Refresh awareness before Y.js's 30s timeout drops idle clients. */
const HEARTBEAT_INTERVAL_MS = 15000;

/**
 * Reactive wrapper around Y.js awareness for all ephemeral, never-persisted state:
 * cursors, measurements, hovered and pinned markers, and the stage performance setting.
 */
export class PresenceChannel {
  cursors = $state<Record<string, CursorData>>({});
  measurements = $state<Record<string, MeasurementData>>({});
  hoveredMarker = $state<HoveredMarker | null>(null);
  pinnedMarkers = $state<string[]>([]);
  stagePerformance = $state<StagePerformanceSetting | null>(null);

  #awareness: Awareness;
  #userId: string;
  #heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(awareness: Awareness, userId: string) {
    this.#awareness = awareness;
    this.#userId = userId;
    this.#awareness.on('change', this.#readStates);
    this.#startHeartbeat();
  }

  #startHeartbeat() {
    if (this.#heartbeat) return;
    this.#heartbeat = setInterval(() => this.#refresh(), HEARTBEAT_INTERVAL_MS);
  }

  #stopHeartbeat() {
    if (this.#heartbeat) clearInterval(this.#heartbeat);
    this.#heartbeat = null;
  }

  /**
   * Pause before the provider disconnects: stop the heartbeat and clear every
   * ephemeral field so a stale cursor cannot reappear on peers when the provider
   * re-sends local state on reconnect. Keeps `stagePerformance` (the playfield
   * mirrors it) and never sets a null state — y-protocols makes
   * setLocalStateField a no-op on null, which would silently break cursors after wake.
   */
  suspend() {
    this.#stopHeartbeat();
    const stagePerformance = this.#awareness.getLocalState()?.stagePerformance;
    this.#awareness.setLocalState(stagePerformance ? { stagePerformance } : {});
  }

  resume() {
    this.#startHeartbeat();
  }

  #readStates = () => {
    const cursors: Record<string, CursorData> = {};
    const measurements: Record<string, MeasurementData> = {};
    let hoveredMarker: HoveredMarker | null = null;
    let pinnedMarkers: string[] = [];
    let stagePerformance: StagePerformanceSetting | null = null;

    this.#awareness.getStates().forEach((state, clientId) => {
      if (state.cursor && clientId !== this.#awareness.clientID) {
        cursors[`${state.cursor.userId}_${clientId}`] = { ...state.cursor, clientId };
      }
      if (state.measurement) {
        measurements[`${state.measurement.userId}_${clientId}`] = { ...state.measurement, clientId };
      }
      if (state.hoveredMarker) {
        hoveredMarker = state.hoveredMarker as HoveredMarker;
      }
      if (Array.isArray(state.pinnedMarkers) && state.pinnedMarkers.length > 0) {
        pinnedMarkers = state.pinnedMarkers;
      }
      if (state.stagePerformance?.setting) {
        stagePerformance = state.stagePerformance.setting as StagePerformanceSetting;
      }
    });

    this.cursors = cursors;
    this.measurements = measurements;
    this.hoveredMarker = hoveredMarker;
    this.pinnedMarkers = pinnedMarkers;
    this.stagePerformance = stagePerformance;
  };

  #refresh() {
    const current = this.#awareness.getLocalState();
    if (current) this.#awareness.setLocalState(current);
  }

  updateCursor(worldPosition: { x: number; y: number; z: number }, color?: string, label?: string) {
    this.#awareness.setLocalStateField('cursor', {
      userId: this.#userId,
      worldPosition,
      color: color || '#ffffff',
      label: label || this.#userId,
      lastMoveTime: Date.now()
    });
  }

  updateMeasurement(
    startPoint: { x: number; y: number } | null,
    endPoint: { x: number; y: number } | null,
    type: number,
    style?: MeasurementStyleProps
  ) {
    if (startPoint === null || endPoint === null) {
      this.#awareness.setLocalStateField('measurement', null);
      return;
    }
    this.#awareness.setLocalStateField('measurement', {
      userId: this.#userId,
      startPoint,
      endPoint,
      type,
      timestamp: Date.now(),
      color: style?.color ?? '#FFFFFF',
      thickness: style?.thickness ?? 12,
      outlineColor: style?.outlineColor ?? '#000000',
      outlineThickness: style?.outlineThickness ?? 4,
      opacity: style?.opacity ?? 1,
      markerSize: style?.markerSize ?? 24,
      autoHideDelay: style?.autoHideDelay ?? 3000,
      fadeoutTime: style?.fadeoutTime ?? 500,
      showDistance: style?.showDistance ?? true,
      snapToGrid: style?.snapToGrid ?? true,
      enableDMG252: style?.enableDMG252 ?? true,
      beamWidth: style?.beamWidth,
      coneAngle: style?.coneAngle
    });
  }

  updateHoveredMarker(marker: HoveredMarker | null) {
    this.#awareness.setLocalStateField('hoveredMarker', marker);
  }

  updatePinnedMarkers(markerIds: string[]) {
    this.#awareness.setLocalStateField('pinnedMarkers', markerIds);
  }

  /**
   * Broadcasts the DM's stage performance setting so connected playfields
   * mirror it. Playfields persist the received value locally, so it survives
   * reloads even when the editor is offline.
   */
  updateStagePerformance(setting: StagePerformanceSetting) {
    this.#awareness.setLocalStateField('stagePerformance', { setting, userId: this.#userId });
  }

  destroy() {
    this.#stopHeartbeat();
    this.#awareness.off('change', this.#readStates);
  }
}
