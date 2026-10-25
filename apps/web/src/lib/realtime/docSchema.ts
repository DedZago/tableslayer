import type { MarkerCondition } from '@tableslayer/stage';
import * as Y from 'yjs';
import type {
  AnnotationRow,
  AoeTemplateRow,
  GameSessionHydrationData,
  HandoutDescriptor,
  LightRow,
  MarkerRow,
  PartyState,
  SceneChange,
  SceneListEntry,
  ScenePart,
  SceneSettings,
  SceneSnapshot
} from './types';

// Granular Y.js layout for a game session. Every shared value is an individual
// Y.Map key so concurrent edits merge per field (LWW) instead of clobbering whole
// objects. This module is dependency-light on purpose: it is shared between the
// SvelteKit app and the PartyKit server bundle.
//
// gameSession doc
//   meta: Y.Map { schemaVersion, hydratedAt }
//   scenes: Y.Map<sceneId, Y.Map>
//     settings: Y.Map<SceneSettings field, primitive>
//     markers: Y.Map<markerId, Y.Map<MarkerRow field, primitive>>
//       conditions: Y.Map<condition id, MarkerCondition> (rooms persisted before may still hold an array)
//     lights: Y.Map<lightId, Y.Map<LightRow field, primitive>>
//     aoeTemplates: Y.Map<aoeTemplateId, Y.Map<AoeTemplateRow field, primitive>>
//     annotations: Y.Map<annotationId, Y.Map<AnnotationRow field | 'mask', primitive | Uint8Array>>
//     fogMask: Uint8Array (RLE)
// party doc
//   state: Y.Map { activeSceneId, isPaused, activeHandout }

// v2: MapDefined marker/light positions are center-relative map pixels (see
// scene.mapCoordVersion). The bump fences stale tabs from writing legacy
// display-space coordinates into upgraded scenes; rooms rehydrate from the DB.
// v3: the aoeTemplates collection. Rooms without it rehydrate from the DB.
export const DOC_SCHEMA_VERSION = 3;
export const ANNOTATION_MASK_KEY = 'mask';
// Editor undo coalesces edits closer together than this into one step
export const UNDO_CAPTURE_TIMEOUT_MS = 500;

type SceneMap = Y.Map<unknown>;
type RowCollection = 'markers' | 'lights' | 'annotations' | 'aoeTemplates';
const ROW_COLLECTIONS: readonly RowCollection[] = ['markers', 'lights', 'aoeTemplates', 'annotations'];

export const getMeta = (doc: Y.Doc) => doc.getMap<unknown>('meta');
export const getScenesMap = (doc: Y.Doc) => doc.getMap<SceneMap>('scenes');
export const getPartyStateMap = (doc: Y.Doc) => doc.getMap<unknown>('state');

export const isDocHydrated = (doc: Y.Doc): boolean => getMeta(doc).get('schemaVersion') === DOC_SCHEMA_VERSION;

// A token's conditions are keyed by id, so edits to different conditions from any screen merge
const CONDITIONS_KEY = 'conditions';

// Readers get a plain array ordered by id; consumers sort it for display (sortConditions)
const conditionListOf = (map: Y.Map<MarkerCondition>): MarkerCondition[] =>
  [...map.values()].sort((a, b) => a.id.localeCompare(b.id));

const yMapToObject = <T>(map: Y.Map<unknown>, omit?: string): T => {
  const obj: Record<string, unknown> = {};
  map.forEach((value, key) => {
    if (key === omit) return;
    obj[key] = key === CONDITIONS_KEY && value instanceof Y.Map ? conditionListOf(value) : value;
  });
  return obj as T;
};

const sameCondition = (a: MarkerCondition | undefined, b: MarkerCondition) =>
  a !== undefined &&
  a.id === b.id &&
  a.label === b.label &&
  a.color === b.color &&
  a.value === b.value &&
  Boolean(a.dmOnly) === Boolean(b.dmOnly);

// Plain copy without undefined keys (Y.js can't encode undefined)
const storedCondition = (condition: MarkerCondition): MarkerCondition =>
  Object.fromEntries(Object.entries(condition).filter(([, value]) => value !== undefined)) as MarkerCondition;

/** The row's conditions map, converting a legacy array in place */
const conditionsMapOf = (row: Y.Map<unknown>): Y.Map<MarkerCondition> => {
  const current = row.get(CONDITIONS_KEY);
  if (current instanceof Y.Map) return current as Y.Map<MarkerCondition>;
  const map = new Y.Map<MarkerCondition>();
  for (const condition of Array.isArray(current) ? (current as MarkerCondition[]) : []) {
    map.set(condition.id, storedCondition(condition));
  }
  row.set(CONDITIONS_KEY, map);
  return map;
};

// A whole list (row upsert, paste, hydration) is applied as per-condition changes
const writeConditionList = (row: Y.Map<unknown>, list: MarkerCondition[] | null) => {
  const map = conditionsMapOf(row);
  const next = new Map((list ?? []).map((condition) => [condition.id, condition]));
  for (const id of [...map.keys()]) if (!next.has(id)) map.delete(id);
  for (const [id, condition] of next) {
    if (!sameCondition(map.get(id), condition)) map.set(id, storedCondition(condition));
  }
};

const setChangedFields = (map: Y.Map<unknown>, fields: Record<string, unknown>) => {
  for (const [key, value] of Object.entries(fields)) {
    if (key === CONDITIONS_KEY && (Array.isArray(value) || value === null)) {
      writeConditionList(map, value as MarkerCondition[] | null);
    } else if (value !== undefined && map.get(key) !== value) {
      map.set(key, value);
    }
  }
};

// Row objects are reused across snapshots until their Y.Map changes, so nothing may mutate them.
const rowObjectCache = new WeakMap<Y.Map<unknown>, unknown>();
const rowCacheTrackedDocs = new WeakSet<Y.Doc>();

export const invalidateRowObject = (map: unknown) => {
  if (map instanceof Y.Map) rowObjectCache.delete(map);
};

// Any doc that serves cached rows must invalidate them from its own observer, whatever
// client or server code applied the change (PartyKit persists remote edits from this same read path).
const trackRowObjects = (doc: Y.Doc) => {
  if (rowCacheTrackedDocs.has(doc)) return;
  rowCacheTrackedDocs.add(doc);
  getScenesMap(doc).observeDeep((events) => {
    // A change inside a nested map (a token's conditions) also invalidates the row holding it
    for (const event of events) {
      for (let type: Y.AbstractType<unknown> | null = event.target; type; type = type.parent) {
        invalidateRowObject(type);
      }
    }
  });
};

const rowObjectOf = <T>(row: Y.Map<unknown>): T => {
  const cached = rowObjectCache.get(row) as T | undefined;
  if (cached) return cached;
  const obj = yMapToObject<T>(row);
  rowObjectCache.set(row, obj);
  return obj;
};

// A row without its id is a fragment (a field patch that outlived its row); readers skip it
const isRowFragment = (row: Y.Map<unknown>) => typeof row.get('id') !== 'string';

const rowsOf = <T>(scene: SceneMap | undefined, collection: RowCollection, omit?: string): T[] => {
  const rows: T[] = [];
  const map = scene?.get(collection) as Y.Map<Y.Map<unknown>> | undefined;
  map?.forEach((row) => {
    if (isRowFragment(row)) return;
    rows.push(omit === undefined ? rowObjectOf<T>(row) : yMapToObject<T>(row, omit));
  });
  return rows;
};

/** Converts tokens' legacy condition arrays to per-condition maps; the room does this once on load */
export const upgradeConditionMaps = (doc: Y.Doc, origin: unknown) => {
  doc.transact(() => {
    getScenesMap(doc).forEach((scene) => {
      (scene.get('markers') as Y.Map<Y.Map<unknown>> | undefined)?.forEach((row) => {
        if (!isRowFragment(row) && !(row.get(CONDITIONS_KEY) instanceof Y.Map)) conditionsMapOf(row);
      });
    });
  }, origin);
};

/** Deletes row fragments left by older clients; returns the ids of the scenes it repaired */
export const pruneRowFragments = (doc: Y.Doc, origin: unknown): string[] => {
  const repaired = new Set<string>();
  doc.transact(() => {
    getScenesMap(doc).forEach((scene, sceneId) => {
      for (const collection of ROW_COLLECTIONS) {
        const map = scene.get(collection) as Y.Map<Y.Map<unknown>> | undefined;
        const fragmentIds = [...(map?.entries() ?? [])].filter(([, row]) => isRowFragment(row)).map(([id]) => id);
        for (const id of fragmentIds) map?.delete(id);
        if (fragmentIds.length > 0) repaired.add(sceneId);
      }
    });
  }, origin);
  return [...repaired];
};

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const getSceneSettings = (doc: Y.Doc, sceneId: string): SceneSettings | null => {
  const settings = getScenesMap(doc).get(sceneId)?.get('settings') as Y.Map<unknown> | undefined;
  return settings ? yMapToObject<SceneSettings>(settings) : null;
};

export const getSceneSnapshot = (doc: Y.Doc, sceneId: string): SceneSnapshot | null => {
  trackRowObjects(doc);
  const scene = getScenesMap(doc).get(sceneId);
  const settings = scene?.get('settings') as Y.Map<unknown> | undefined;
  if (!scene || !settings) return null;

  return {
    id: sceneId,
    settings: yMapToObject<SceneSettings>(settings),
    markers: rowsOf<MarkerRow>(scene, 'markers'),
    lights: rowsOf<LightRow>(scene, 'lights'),
    // Stable order: templates are matched by index when reused in the stage props
    aoeTemplates: rowsOf<AoeTemplateRow>(scene, 'aoeTemplates').sort(
      (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)
    ),
    // Masks ride along as stable Uint8Array references (cheap; Y.js returns the
    // same instance until a new mask is set), feeding declarative layer props
    annotations: rowsOf<AnnotationRow & { mask?: Uint8Array | null }>(scene, 'annotations').sort(
      (a, b) => a.order - b.order
    )
  };
};

export const listScenes = (doc: Y.Doc): SceneListEntry[] => {
  const entries: SceneListEntry[] = [];
  getScenesMap(doc).forEach((scene, id) => {
    const settings = scene.get('settings') as Y.Map<unknown> | undefined;
    if (!settings) return;
    entries.push({
      id,
      name: settings.get('name') as string,
      order: settings.get('order') as number,
      gameSessionId: settings.get('gameSessionId') as string,
      mapLocation: (settings.get('mapLocation') as string | null) ?? null,
      mapThumbLocation: (settings.get('mapThumbLocation') as string | null) ?? null
    });
  });
  return entries.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
};

export const getFogMask = (doc: Y.Doc, sceneId: string): Uint8Array | null =>
  (getScenesMap(doc).get(sceneId)?.get('fogMask') as Uint8Array | undefined) ?? null;

export const getAnnotationMask = (doc: Y.Doc, sceneId: string, annotationId: string): Uint8Array | null => {
  const annotations = getScenesMap(doc).get(sceneId)?.get('annotations') as Y.Map<Y.Map<unknown>> | undefined;
  return (annotations?.get(annotationId)?.get(ANNOTATION_MASK_KEY) as Uint8Array | undefined) ?? null;
};

export const getPartyState = (doc: Y.Doc): PartyState => {
  const state = getPartyStateMap(doc);
  return {
    activeSceneId: (state.get('activeSceneId') as string | null) ?? null,
    isPaused: (state.get('isPaused') as boolean) ?? false,
    activeHandout: (state.get('activeHandout') as HandoutDescriptor | null) ?? null
  };
};

// ---------------------------------------------------------------------------
// Scene ordering (fractional indexing; the server normalizes to integers on persist)
// ---------------------------------------------------------------------------

export const orderBetween = (prev: number | null, next: number | null): number => {
  if (prev === null && next === null) return 1;
  if (prev === null) return next! - 1;
  if (next === null) return prev + 1;
  return (prev + next) / 2;
};

// ---------------------------------------------------------------------------
// Writes — bound to a doc + transaction origin so every local mutation is tagged
// ---------------------------------------------------------------------------

const GROUPED_COLLECTIONS = ['markers', 'lights', 'aoeTemplates'] as const;
type GroupedCollection = (typeof GROUPED_COLLECTIONS)[number];

/** `playerView`: the writer can't see GM-only conditions (the TV), so it treats them as absent and never touches them */
export type ConditionWriteOptions = { playerView?: boolean };

/** `detached`: the row moves on its own, leaving the rest of its group where it is */
export type MoveOptions = { detached?: boolean };

export const createSessionWriter = (doc: Y.Doc, origin: unknown) => {
  // Rows positioned explicitly in the open transaction; group moves never shift them,
  // so dragging several members of a group together moves each one exactly once
  const placedThisTransaction = new Set<string>();
  let transactDepth = 0;
  const transact = (fn: () => void) => {
    transactDepth++;
    try {
      doc.transact(fn, origin);
    } finally {
      transactDepth--;
      if (transactDepth === 0) placedThisTransaction.clear();
    }
  };
  const scenes = () => getScenesMap(doc);

  // A write against a missing scene is a caller bug (stale id, not-yet-hydrated
  // doc). Never fail silently — silent no-ops cost hours of debugging.
  const warnMissing = (what: string, sceneId: string) => {
    console.warn(`[realtime] write dropped: ${what} — scene ${sceneId} not in doc`);
  };

  const collectionOf = (sceneId: string, collection: RowCollection) =>
    scenes().get(sceneId)?.get(collection) as Y.Map<Y.Map<unknown>> | undefined;

  // The rest of the group keeps its offset to the moved row
  const shiftGroup = (sceneId: string, groupId: string, dx: number, dy: number) => {
    for (const collection of GROUPED_COLLECTIONS) {
      collectionOf(sceneId, collection)?.forEach((row, id) => {
        if (row.get('groupId') !== groupId || placedThisTransaction.has(`${collection}:${id}`)) return;
        row.set('positionX', ((row.get('positionX') as number) ?? 0) + dx);
        row.set('positionY', ((row.get('positionY') as number) ?? 0) + dy);
      });
    }
  };

  const writeRowFields = (
    sceneId: string,
    collection: RowCollection,
    id: string,
    row: Y.Map<unknown>,
    fields: Record<string, unknown>,
    options?: MoveOptions
  ) => {
    const isGrouped = (GROUPED_COLLECTIONS as readonly string[]).includes(collection);
    const placesRow = isGrouped && (fields.positionX !== undefined || fields.positionY !== undefined);
    if (!placesRow) {
      setChangedFields(row, fields);
      return;
    }
    const fromX = row.get('positionX') as number | undefined;
    const fromY = row.get('positionY') as number | undefined;
    placedThisTransaction.add(`${collection as GroupedCollection}:${id}`);
    setChangedFields(row, fields);
    const groupId = row.get('groupId');
    if (options?.detached || typeof groupId !== 'string' || fromX === undefined || fromY === undefined) return;
    const dx = ((row.get('positionX') as number) ?? fromX) - fromX;
    const dy = ((row.get('positionY') as number) ?? fromY) - fromY;
    if (dx !== 0 || dy !== 0) shiftGroup(sceneId, groupId, dx, dy);
  };

  const upsertRow = (
    sceneId: string,
    collection: RowCollection,
    id: string,
    fields: Record<string, unknown>,
    options?: MoveOptions
  ) => {
    transact(() => {
      const map = collectionOf(sceneId, collection);
      if (!map) {
        warnMissing(`upsert ${collection}/${id}`, sceneId);
        return;
      }
      let row = map.get(id);
      if (!row) {
        // Only a whole row creates one: a field patch for a row deleted or undone elsewhere is dropped
        if (fields.id !== id) return;
        row = new Y.Map();
        map.set(id, row);
        // Created with the row, so two screens never race to create it
        if (collection === 'markers') conditionsMapOf(row);
      }
      writeRowFields(sceneId, collection, id, row, fields, options);
    });
  };

  const deleteRow = (sceneId: string, collection: RowCollection, id: string) => {
    transact(() => {
      const map = collectionOf(sceneId, collection);
      if (!map) {
        warnMissing(`delete ${collection}/${id}`, sceneId);
        return;
      }
      map.delete(id);
    });
  };

  return {
    /**
     * Groups multiple writer calls into one Y transaction (nested transacts
     * fold into the outer one), so multi-row updates land atomically.
     */
    transaction(fn: () => void) {
      transact(fn);
    },
    createScene(
      settings: SceneSettings,
      content?: {
        markers?: MarkerRow[];
        lights?: LightRow[];
        aoeTemplates?: AoeTemplateRow[];
        annotations?: Array<AnnotationRow & { mask?: Uint8Array | null }>;
        fogMask?: Uint8Array | null;
      }
    ) {
      transact(() => {
        const scene = new Y.Map<unknown>();
        scenes().set(settings.id, scene as SceneMap);

        const settingsMap = new Y.Map<unknown>();
        scene.set('settings', settingsMap);
        setChangedFields(settingsMap, settings as unknown as Record<string, unknown>);

        for (const collection of ['markers', 'lights', 'aoeTemplates', 'annotations'] as const) {
          const map = new Y.Map<Y.Map<unknown>>();
          scene.set(collection, map);
          for (const row of content?.[collection] ?? []) {
            const rowMap = new Y.Map<unknown>();
            map.set(row.id, rowMap);
            const { mask, ...fields } = row as AnnotationRow & { mask?: Uint8Array | null };
            setChangedFields(rowMap, fields as unknown as Record<string, unknown>);
            if (collection === 'markers') conditionsMapOf(rowMap);
            if (collection === 'annotations' && mask) rowMap.set(ANNOTATION_MASK_KEY, mask);
          }
        }

        if (content?.fogMask) scene.set('fogMask', content.fogMask);
      });
    },

    deleteScene(sceneId: string) {
      transact(() => scenes().delete(sceneId));
    },

    setSceneSettings(sceneId: string, fields: Partial<SceneSettings>) {
      transact(() => {
        const settings = scenes().get(sceneId)?.get('settings') as Y.Map<unknown> | undefined;
        if (!settings) {
          warnMissing('setSceneSettings', sceneId);
          return;
        }
        setChangedFields(settings, fields as Record<string, unknown>);
      });
    },

    setFogMask(sceneId: string, mask: Uint8Array) {
      transact(() => {
        const scene = scenes().get(sceneId);
        if (!scene) {
          warnMissing('setFogMask', sceneId);
          return;
        }
        scene.set('fogMask', mask);
      });
    },

    upsertMarker(sceneId: string, marker: MarkerRow, options?: MoveOptions) {
      upsertRow(sceneId, 'markers', marker.id, marker as unknown as Record<string, unknown>, options);
    },
    setMarkerFields(sceneId: string, markerId: string, fields: Partial<MarkerRow>, options?: MoveOptions) {
      upsertRow(sceneId, 'markers', markerId, fields as Record<string, unknown>, options);
    },
    setExistingMarkerFields(sceneId: string, markerId: string, fields: Partial<MarkerRow>, options?: MoveOptions) {
      let updated = false;
      transact(() => {
        const row = collectionOf(sceneId, 'markers')?.get(markerId);
        if (!row) return;
        writeRowFields(sceneId, 'markers', markerId, row, fields as Record<string, unknown>, options);
        updated = true;
      });
      return updated;
    },
    deleteMarker(sceneId: string, markerId: string) {
      deleteRow(sceneId, 'markers', markerId);
    },
    /**
     * Condition edits touch one key per token, so they merge with any other screen's edits and never
     * disturb conditions the writer didn't name (GM-only ones the TV can't see).
     * Toggle removes the condition when every token has it, otherwise adds it where missing.
     */
    toggleMarkerCondition(
      sceneId: string,
      markerIds: string[],
      condition: MarkerCondition,
      options?: ConditionWriteOptions
    ) {
      transact(() => {
        const rows = markerIds.flatMap((id) => collectionOf(sceneId, 'markers')?.get(id) ?? []);
        const maps = rows.map(conditionsMapOf);
        const has = (map: Y.Map<MarkerCondition>) => {
          const existing = map.get(condition.id);
          return existing !== undefined && !(options?.playerView && existing.dmOnly);
        };
        const allHave = maps.length > 0 && maps.every(has);
        for (const map of maps) {
          if (allHave) map.delete(condition.id);
          else if (!map.has(condition.id)) map.set(condition.id, storedCondition(condition));
        }
      });
    },
    /** Sets a valued condition (exhaustion) to `value` on every token; 0 or less removes it */
    setMarkerConditionValue(
      sceneId: string,
      markerIds: string[],
      conditionId: string,
      value: number,
      options?: ConditionWriteOptions
    ) {
      transact(() => {
        for (const id of markerIds) {
          const row = collectionOf(sceneId, 'markers')?.get(id);
          if (!row) continue;
          const map = conditionsMapOf(row);
          const existing = map.get(conditionId);
          if (options?.playerView && existing?.dmOnly) continue;
          if (value <= 0) map.delete(conditionId);
          else if (existing?.value !== value) {
            map.set(conditionId, storedCondition({ ...existing, id: conditionId, value }));
          }
        }
      });
    },
    /** Steps a valued condition on each token from its own level, capped at `max`; below 1 removes it */
    stepMarkerConditionValue(sceneId: string, markerIds: string[], conditionId: string, delta: number, max: number) {
      transact(() => {
        for (const id of markerIds) {
          const row = collectionOf(sceneId, 'markers')?.get(id);
          if (!row) continue;
          const map = conditionsMapOf(row);
          const existing = map.get(conditionId);
          const value = Math.min((existing?.value ?? 0) + delta, max);
          if (value <= 0) map.delete(conditionId);
          else map.set(conditionId, storedCondition({ ...existing, id: conditionId, value }));
        }
      });
    },
    toggleMarkerConditionDmOnly(sceneId: string, markerIds: string[], conditionId: string) {
      transact(() => {
        for (const id of markerIds) {
          const row = collectionOf(sceneId, 'markers')?.get(id);
          const existing = row ? conditionsMapOf(row).get(conditionId) : undefined;
          if (!row || !existing) continue;
          const { dmOnly, ...rest } = existing;
          conditionsMapOf(row).set(conditionId, dmOnly ? rest : { ...rest, dmOnly: true });
        }
      });
    },
    clearMarkerConditions(sceneId: string, markerIds: string[]) {
      transact(() => {
        for (const id of markerIds) {
          const row = collectionOf(sceneId, 'markers')?.get(id);
          if (row) conditionsMapOf(row).clear();
        }
      });
    },

    /** Puts rows in a group (or takes them out with null); positions stay where they are */
    setGroup(sceneId: string, members: Array<{ collection: GroupedCollection; id: string }>, groupId: string | null) {
      transact(() => {
        for (const { collection, id } of members) {
          const row = collectionOf(sceneId, collection)?.get(id);
          if (row) setChangedFields(row, { groupId });
        }
      });
    },

    upsertLight(sceneId: string, light: LightRow, options?: MoveOptions) {
      upsertRow(sceneId, 'lights', light.id, light as unknown as Record<string, unknown>, options);
    },
    setLightFields(sceneId: string, lightId: string, fields: Partial<LightRow>, options?: MoveOptions) {
      upsertRow(sceneId, 'lights', lightId, fields as Record<string, unknown>, options);
    },
    deleteLight(sceneId: string, lightId: string) {
      deleteRow(sceneId, 'lights', lightId);
    },

    upsertAoeTemplate(sceneId: string, template: AoeTemplateRow, options?: MoveOptions) {
      upsertRow(sceneId, 'aoeTemplates', template.id, template as unknown as Record<string, unknown>, options);
    },
    setAoeTemplateFields(sceneId: string, templateId: string, fields: Partial<AoeTemplateRow>, options?: MoveOptions) {
      upsertRow(sceneId, 'aoeTemplates', templateId, fields as Record<string, unknown>, options);
    },
    deleteAoeTemplate(sceneId: string, templateId: string) {
      deleteRow(sceneId, 'aoeTemplates', templateId);
    },

    upsertAnnotation(sceneId: string, annotation: AnnotationRow, mask?: Uint8Array | null) {
      transact(() => {
        upsertRow(sceneId, 'annotations', annotation.id, annotation as unknown as Record<string, unknown>);
        if (mask) {
          collectionOf(sceneId, 'annotations')?.get(annotation.id)?.set(ANNOTATION_MASK_KEY, mask);
        }
      });
    },
    setAnnotationFields(sceneId: string, annotationId: string, fields: Partial<AnnotationRow>) {
      upsertRow(sceneId, 'annotations', annotationId, fields as Record<string, unknown>);
    },
    setAnnotationMask(sceneId: string, annotationId: string, mask: Uint8Array) {
      transact(() => {
        const row = collectionOf(sceneId, 'annotations')?.get(annotationId);
        if (!row) {
          warnMissing(`setAnnotationMask ${annotationId}`, sceneId);
          return;
        }
        row.set(ANNOTATION_MASK_KEY, mask);
      });
    },
    deleteAnnotation(sceneId: string, annotationId: string) {
      deleteRow(sceneId, 'annotations', annotationId);
    }
  };
};

export type SessionWriter = ReturnType<typeof createSessionWriter>;

export const createPartyWriter = (partyDoc: Y.Doc, origin: unknown) => ({
  setActiveScene(sceneId: string | null) {
    partyDoc.transact(() => getPartyStateMap(partyDoc).set('activeSceneId', sceneId), origin);
  },
  setHandout(handout: HandoutDescriptor | null) {
    partyDoc.transact(() => getPartyStateMap(partyDoc).set('activeHandout', handout ? { ...handout } : null), origin);
  },
  setPaused(isPaused: boolean) {
    partyDoc.transact(() => getPartyStateMap(partyDoc).set('isPaused', isPaused), origin);
  }
});

export type PartyWriter = ReturnType<typeof createPartyWriter>;

// ---------------------------------------------------------------------------
// Undo groups: one gesture (group drag, multi-token edit) becomes one undo step
// no matter how long it runs. Capture timeout is only lifted while the group is open.
// ---------------------------------------------------------------------------

/** The undo stack top when a group opened; a different top on close means the group recorded a step. */
export type UndoGroupMark = { readonly top: unknown };

const undoStackTop = (undoManager: Y.UndoManager) => undoManager.undoStack[undoManager.undoStack.length - 1];

export const openUndoCaptureGroup = (undoManager: Y.UndoManager): UndoGroupMark => {
  undoManager.stopCapturing();
  undoManager.captureTimeout = Number.POSITIVE_INFINITY;
  return { top: undoStackTop(undoManager) };
};

/**
 * Pass `discard` (the mark from open) when the gesture was cancelled and the doc is back where it
 * started: its step is undone and dropped so Ctrl+Z doesn't land on a step that changes nothing.
 */
export const closeUndoCaptureGroup = (undoManager: Y.UndoManager, discard?: UndoGroupMark) => {
  undoManager.captureTimeout = UNDO_CAPTURE_TIMEOUT_MS;
  undoManager.stopCapturing();
  if (discard && undoStackTop(undoManager) !== discard.top) {
    undoManager.undo();
    undoManager.clear(false, true);
  }
};

// ---------------------------------------------------------------------------
// Hydration (server builds the doc from the DB; clients never initialize shared state)
// ---------------------------------------------------------------------------

export const hydrateGameSessionDoc = (doc: Y.Doc, data: GameSessionHydrationData, origin: unknown) => {
  const writer = createSessionWriter(doc, origin);
  doc.transact(() => {
    for (const scene of data.scenes) {
      writer.createScene(scene.settings, scene);
    }
    getMeta(doc).set('schemaVersion', DOC_SCHEMA_VERSION);
    getMeta(doc).set('hydratedAt', Date.now());
  }, origin);
};

// ---------------------------------------------------------------------------
// Change classification for observers
// ---------------------------------------------------------------------------

const SCENE_PARTS: ReadonlySet<string> = new Set([
  'settings',
  'markers',
  'lights',
  'aoeTemplates',
  'annotations',
  'fogMask'
]);

export const classifySceneEvents = (events: Y.YEvent<Y.Map<unknown>>[], transaction: Y.Transaction): SceneChange[] => {
  const changes: SceneChange[] = [];
  const remote = !transaction.local;
  const undoRedo = transaction.origin instanceof Y.UndoManager;

  for (const event of events) {
    const path = event.path;
    const keys = [...event.changes.keys.keys()];

    if (path.length === 0) {
      // Scenes added/removed at the top level
      changes.push({ sceneId: keys[0] ?? '', part: 'scenes', keys, remote, undoRedo });
    } else if (path.length === 1) {
      // A key set directly on a scene map (fogMask, or a collection map replaced)
      const sceneId = String(path[0]);
      for (const key of keys) {
        if (SCENE_PARTS.has(key)) {
          changes.push({ sceneId, part: key as ScenePart, keys: [key], remote, undoRedo });
        }
      }
    } else if (SCENE_PARTS.has(String(path[1]))) {
      const sceneId = String(path[0]);
      const part = String(path[1]) as ScenePart;
      // path.length === 2 → rows added/removed (keys are row ids)
      // path.length === 3 → fields changed inside a row (path[2] is the row id)
      changes.push({
        sceneId,
        part,
        keys,
        childId: path.length >= 3 ? String(path[2]) : undefined,
        remote,
        undoRedo
      });
    }
  }

  return changes;
};
