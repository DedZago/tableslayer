import {
  advancePastRemoved,
  getNextTurn,
  getPreviousTurn,
  isSameTurn,
  normalizeInitiativeBonus,
  normalizeInitiativeValue,
  readTurnPosition,
  recoverTurnPosition,
  resolveInitiativeBonus,
  rollInitiative,
  sortCombatants,
  type TurnPosition
} from '$lib/utils/initiative';
import type { CombatSnapshot, CombatWriter } from './types';

type Rng = () => number;

const ROLLING_POSITION: TurnPosition = { round: 0, activeId: null, lairStep: false };

const combatantsOf = (snapshot: CombatSnapshot) => snapshot.markers.filter((m) => m.inCombat ?? false);

const lairActionsOf = (snapshot: CombatSnapshot) => snapshot.settings.combatLairActions ?? false;

const writeTurnPosition = (write: CombatWriter, sceneId: string, pos: TurnPosition) =>
  write.setSceneSettings(sceneId, {
    combatRound: pos.round,
    combatActiveMarkerId: pos.activeId,
    combatLairStep: pos.lairStep
  });

const clearCombatFields = (write: CombatWriter, sceneId: string, ids: string[]) => {
  for (const id of ids) {
    write.setExistingMarkerFields(sceneId, id, { inCombat: false, initiative: null, initiativeTiebreak: 0 });
  }
};

const rollFor = (write: CombatWriter, sceneId: string, targets: CombatSnapshot['markers'], rng: Rng): string[] => {
  const results = targets.map((target) => ({ target, roll: rollInitiative(resolveInitiativeBonus(target), rng) }));
  write.transaction(() => {
    for (const { target, roll } of results) {
      write.setExistingMarkerFields(sceneId, target.id, { initiative: roll.total, initiativeTiebreak: 0 });
    }
  });
  return results.map(({ target, roll }) => `${target.title}: ${roll.text}`);
};

// Returns the new position, or null when the turn did not move
const applyTurn = (
  write: CombatWriter,
  sceneId: string,
  snapshot: CombatSnapshot,
  step: (rolled: CombatSnapshot['markers'], pos: TurnPosition, lairActions: boolean) => TurnPosition
): TurnPosition | null => {
  const rolled = sortCombatants(snapshot.markers).rolled;
  const pos = readTurnPosition(snapshot.settings);
  const next = step(rolled, pos, lairActionsOf(snapshot));
  if (isSameTurn(pos, next)) return null;
  write.transaction(() => writeTurnPosition(write, sceneId, next));
  return next;
};

export const startCombat = (write: CombatWriter, sceneId: string, snapshot: CombatSnapshot, ids: string[]) => {
  const alreadyRunning = combatantsOf(snapshot).length > 0;
  write.transaction(() => {
    for (const id of ids) write.setExistingMarkerFields(sceneId, id, { inCombat: true });
    if (!alreadyRunning) writeTurnPosition(write, sceneId, ROLLING_POSITION);
  });
};

export const addCombatants = (write: CombatWriter, sceneId: string, snapshot: CombatSnapshot, ids: string[]) => {
  const inCombat = new Set(combatantsOf(snapshot).map((m) => m.id));
  write.transaction(() => {
    for (const id of ids.filter((id) => !inCombat.has(id))) {
      write.setExistingMarkerFields(sceneId, id, { inCombat: true, initiative: null });
    }
  });
};

export const removeCombatants = (write: CombatWriter, sceneId: string, snapshot: CombatSnapshot, ids: string[]) => {
  const removed = new Set(ids);
  const remaining = combatantsOf(snapshot).filter((m) => !removed.has(m.id));
  if (remaining.length === 0) {
    endCombat(write, sceneId, snapshot);
    return;
  }
  const pos = readTurnPosition(snapshot.settings);
  const next = advancePastRemoved(sortCombatants(snapshot.markers).rolled, removed, pos, lairActionsOf(snapshot));
  const removedIds = combatantsOf(snapshot)
    .filter((m) => removed.has(m.id))
    .map((m) => m.id);
  write.transaction(() => {
    clearCombatFields(write, sceneId, removedIds);
    if (next !== pos) writeTurnPosition(write, sceneId, next);
  });
};

export const setInitiative = (
  write: CombatWriter,
  sceneId: string,
  snapshot: CombatSnapshot,
  id: string,
  value: number | null
) => {
  const next = normalizeInitiativeValue(value);
  if (next === null && snapshot.settings.combatActiveMarkerId === id) return;
  const current = snapshot.markers.find((m) => m.id === id)?.initiative ?? null;
  write.transaction(() => {
    write.setExistingMarkerFields(
      sceneId,
      id,
      current === next ? { initiative: next } : { initiative: next, initiativeTiebreak: 0 }
    );
  });
};

export const setInitiativeBonus = (write: CombatWriter, sceneId: string, id: string, bonus: number | null) => {
  write.transaction(() => {
    write.setExistingMarkerFields(sceneId, id, { initiativeBonus: normalizeInitiativeBonus(bonus) });
  });
};

export const rollEmpty = (write: CombatWriter, sceneId: string, snapshot: CombatSnapshot, rng: Rng = Math.random) =>
  rollFor(
    write,
    sceneId,
    combatantsOf(snapshot).filter((m) => m.initiative == null),
    rng
  );

export const rerollAll = (write: CombatWriter, sceneId: string, snapshot: CombatSnapshot, rng: Rng = Math.random) =>
  rollFor(write, sceneId, combatantsOf(snapshot), rng);

export const rollOne = (
  write: CombatWriter,
  sceneId: string,
  snapshot: CombatSnapshot,
  id: string,
  rng: Rng = Math.random
): string[] =>
  rollFor(
    write,
    sceneId,
    snapshot.markers.filter((m) => m.id === id && (m.inCombat ?? false)),
    rng
  );

export const nudgeTie = (
  write: CombatWriter,
  sceneId: string,
  snapshot: CombatSnapshot,
  id: string,
  direction: 'up' | 'down'
) => {
  const target = snapshot.markers.find((m) => m.id === id);
  if (target?.initiative == null) return;
  const tiebreaks = combatantsOf(snapshot)
    .filter((m) => m.initiative === target.initiative)
    .map((m) => m.initiativeTiebreak ?? 0);
  const tiebreak = direction === 'up' ? Math.max(...tiebreaks) + 1 : Math.min(...tiebreaks) - 1;
  write.transaction(() => {
    write.setExistingMarkerFields(sceneId, id, { initiativeTiebreak: tiebreak });
  });
};

export const beginCombat = (write: CombatWriter, sceneId: string, snapshot: CombatSnapshot) => {
  if (readTurnPosition(snapshot.settings).round > 0) return null;
  return applyTurn(write, sceneId, snapshot, getNextTurn);
};

export const nextTurn = (write: CombatWriter, sceneId: string, snapshot: CombatSnapshot) =>
  applyTurn(write, sceneId, snapshot, getNextTurn);

export const previousTurn = (write: CombatWriter, sceneId: string, snapshot: CombatSnapshot) =>
  applyTurn(write, sceneId, snapshot, getPreviousTurn);

export const endCombat = (write: CombatWriter, sceneId: string, snapshot: CombatSnapshot) => {
  const ids = combatantsOf(snapshot).map((m) => m.id);
  write.transaction(() => {
    clearCombatFields(write, sceneId, ids);
    writeTurnPosition(write, sceneId, ROLLING_POSITION);
  });
};

// The active combatant can vanish without removeCombatants (undo of its placement, a sync delete).
// previousCombatants is the combat list from before the change; the turn passes to the next one still present.
export const recoverActiveTurn = (
  write: CombatWriter,
  sceneId: string,
  snapshot: CombatSnapshot,
  previousCombatants: CombatSnapshot['markers']
) => {
  const pos = readTurnPosition(snapshot.settings);
  const next = recoverTurnPosition(
    sortCombatants(previousCombatants).rolled,
    sortCombatants(snapshot.markers).rolled,
    pos,
    lairActionsOf(snapshot)
  );
  if (isSameTurn(pos, next)) return;
  write.transaction(() => writeTurnPosition(write, sceneId, next));
};
