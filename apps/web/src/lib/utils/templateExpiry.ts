import type { SessionDocClient } from '$lib/realtime';
import type { AoeTemplateRow, MarkerRow } from '$lib/realtime/types';
import { resolveSpellAnyRuleset, type MarkerConcentration } from '@tableslayer/stage';
import { liveConcentration, sameConcentration } from './concentration';

export const EXPIRY_SWEEP_INTERVAL_MS = 2000;

/** Ids of rows whose `expiresAt` (Unix seconds) has passed */
export const expiredTemplateIds = (
  templates: ReadonlyArray<{ id: string; expiresAt?: number | null }>,
  nowSeconds: number
): string[] => templates.filter((t) => t.expiresAt != null && t.expiresAt <= nowSeconds).map((t) => t.id);

type SweptTemplate = Pick<AoeTemplateRow, 'id' | 'spellId' | 'anchorMarkerId' | 'expiresAt'>;
type SweptMarker = Pick<MarkerRow, 'id' | 'concentration'>;

/**
 * What each caster was concentrating on the last time this client looked, per scene. A caster deleted
 * from the scene takes its field with it, so this is how the rows it listed are still found.
 */
export type ConcentrationMemory = Map<string, MarkerConcentration>;

export interface SweepPlan {
  deleteTemplateIds: string[];
  deleteMarkerIds: string[];
  /** Fields to write: a pruned list, or null when nothing listed remains */
  concentrationUpdates: Array<{ markerId: string; concentration: MarkerConcentration | null }>;
  /** The memory to carry into the next sweep */
  memory: ConcentrationMemory;
}

/** Attached effect rows (spell rows whose spell draws on a token) whose token is gone */
export const orphanedEffectTemplateIds = (templates: readonly SweptTemplate[], markerIds: ReadonlySet<string>) =>
  templates
    .filter(
      (template) =>
        template.spellId &&
        template.anchorMarkerId &&
        !markerIds.has(template.anchorMarkerId) &&
        resolveSpellAnyRuleset(template.spellId)?.resolved.tokenFx
    )
    .map((template) => template.id);

/**
 * Everything one sweep of a scene removes or rewrites: expired templates, attached effects whose token is gone,
 * the rows of casters that left the scene, and concentrations pruned to the rows that still exist
 * (cleared when none do). Pure, so several clients planning from the same doc agree.
 */
export const planSceneSweep = (
  scene: { markers: readonly SweptMarker[]; aoeTemplates: readonly SweptTemplate[] },
  nowSeconds: number,
  remembered: ConcentrationMemory = new Map()
): SweepPlan => {
  const markerIds = new Set(scene.markers.map((marker) => marker.id));
  const templateIds = new Set(scene.aoeTemplates.map((template) => template.id));

  const deleteTemplates = new Set([
    ...expiredTemplateIds(scene.aoeTemplates, nowSeconds),
    ...orphanedEffectTemplateIds(scene.aoeTemplates, markerIds)
  ]);
  const deleteMarkers = new Set<string>();
  for (const [casterId, concentration] of remembered) {
    if (markerIds.has(casterId)) continue;
    concentration.templateIds.filter((id) => templateIds.has(id)).forEach((id) => deleteTemplates.add(id));
    concentration.markerIds.filter((id) => markerIds.has(id)).forEach((id) => deleteMarkers.add(id));
  }

  const remaining = {
    templateIds: new Set([...templateIds].filter((id) => !deleteTemplates.has(id))),
    markerIds: new Set([...markerIds].filter((id) => !deleteMarkers.has(id)))
  };
  const memory: ConcentrationMemory = new Map();
  const concentrationUpdates: SweepPlan['concentrationUpdates'] = [];
  for (const marker of scene.markers) {
    if (!marker.concentration || deleteMarkers.has(marker.id)) continue;
    const live = liveConcentration(marker.concentration, remaining);
    if (live) memory.set(marker.id, live);
    if (!sameConcentration(live, marker.concentration)) {
      concentrationUpdates.push({ markerId: marker.id, concentration: live });
    }
  }
  return {
    deleteTemplateIds: [...deleteTemplates],
    deleteMarkerIds: [...deleteMarkers],
    concentrationUpdates,
    memory
  };
};

const isEmptyPlan = (plan: SweepPlan) =>
  plan.deleteTemplateIds.length === 0 && plan.deleteMarkerIds.length === 0 && plan.concentrationUpdates.length === 0;

/**
 * Sweeps a scene through the system writer: the origin is outside the local undo scope, so a sweep never
 * becomes a Ctrl+Z step. Every write is idempotent across clients. Returns the memory for the next sweep.
 */
export const sweepScene = (
  client: SessionDocClient,
  sceneId: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  remembered: ConcentrationMemory = new Map()
): ConcentrationMemory => {
  const scene = client.scene(sceneId);
  if (!scene) return remembered;
  const plan = planSceneSweep(scene, nowSeconds, remembered);
  if (!isEmptyPlan(plan)) {
    const writer = client.systemWrite;
    writer.transaction(() => {
      plan.deleteTemplateIds.forEach((id) => writer.deleteAoeTemplate(sceneId, id));
      plan.deleteMarkerIds.forEach((id) => writer.deleteMarker(sceneId, id));
      plan.concentrationUpdates.forEach(({ markerId, concentration }) =>
        writer.setMarkerFields(sceneId, markerId, { concentration })
      );
    });
  }
  return plan.memory;
};

/** Deletes expired templates of a scene; the rest of the sweep (attached effects, concentration) rides along */
export const sweepExpiredTemplates = (
  client: SessionDocClient,
  sceneId: string,
  nowSeconds = Math.floor(Date.now() / 1000)
) => {
  sweepScene(client, sceneId, nowSeconds);
};

/** Sweeps every EXPIRY_SWEEP_INTERVAL_MS while `canSweep` holds; returns the stop function */
export const startTemplateExpirySweep = (
  client: SessionDocClient,
  getSceneId: () => string | null | undefined,
  canSweep: () => boolean
) => {
  const memories = new Map<string, ConcentrationMemory>();
  const timer = setInterval(() => {
    const sceneId = getSceneId();
    if (!sceneId || !canSweep()) return;
    memories.set(sceneId, sweepScene(client, sceneId, undefined, memories.get(sceneId)));
  }, EXPIRY_SWEEP_INTERVAL_MS);
  return () => clearInterval(timer);
};
