import type { MarkerRow, SceneSettings } from '$lib/realtime/types';

export const LAIR_INITIATIVE = 20;

const INITIATIVE_VALUE_RANGE = { min: -10, max: 50 };
const INITIATIVE_BONUS_RANGE = { min: -20, max: 30 };
const DOWN_CONDITION_IDS = ['dead'];

export type Combatant = Pick<
  MarkerRow,
  | 'id'
  | 'title'
  | 'inCombat'
  | 'initiative'
  | 'initiativeBonus'
  | 'initiativeTiebreak'
  | 'statBlock'
  | 'hitPoints'
  | 'conditions'
  | 'visibility'
>;

export type TurnPosition = { round: number; activeId: string | null; lairStep: boolean };

export type TurnEntry<T extends Combatant = Combatant> =
  | { kind: 'combatant'; combatant: T; isActive: boolean; isDefeated: boolean; actsNextRound: boolean }
  | { kind: 'lair'; isActive: boolean; isUpNext: boolean; actsNextRound: boolean }
  | { kind: 'roundEnd'; round: number };

type Slot<T extends Combatant> = { kind: 'lair' } | { kind: 'combatant'; combatant: T };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const normalizeInRange =
  (range: { min: number; max: number }) =>
  (value: number | null): number | null =>
    value === null || !Number.isFinite(value) ? null : clamp(Math.round(value), range.min, range.max);

export const normalizeInitiativeValue = normalizeInRange(INITIATIVE_VALUE_RANGE);
export const normalizeInitiativeBonus = normalizeInRange(INITIATIVE_BONUS_RANGE);

export const resolveInitiativeBonus = (c: Combatant): number =>
  c.initiativeBonus ?? c.statBlock?.initiative ?? c.statBlock?.abilities.dex.mod ?? 0;

export const isDefeated = (c: Combatant): boolean =>
  (c.conditions ?? []).some((condition) => DOWN_CONDITION_IDS.includes(condition.id)) ||
  (c.statBlock != null && c.hitPoints != null && c.hitPoints <= 0);

// What players may see: GM-only conditions (a hidden Dead) don't grey out a portrait on the TV
export const isDefeatedForPlayers = (c: Combatant): boolean =>
  isDefeated({ ...c, conditions: (c.conditions ?? []).filter((condition) => !condition.dmOnly) });

const compareInitiative = (a: Combatant, b: Combatant): number => {
  const aValue = a.initiative ?? null;
  const bValue = b.initiative ?? null;
  if (aValue === bValue) return 0;
  if (aValue === null) return 1;
  if (bValue === null) return -1;
  return bValue - aValue;
};

export const compareCombatants = (a: Combatant, b: Combatant): number =>
  compareInitiative(a, b) ||
  (b.initiativeTiebreak ?? 0) - (a.initiativeTiebreak ?? 0) ||
  resolveInitiativeBonus(b) - resolveInitiativeBonus(a) ||
  a.title.localeCompare(b.title) ||
  a.id.localeCompare(b.id);

export const sortCombatants = <T extends Combatant>(markers: T[]): { rolled: T[]; unrolled: T[] } => {
  const inCombat = markers.filter((m) => m.inCombat ?? false);
  const rolled = inCombat.filter((m) => m.initiative != null).sort(compareCombatants);
  const unrolled = inCombat
    .filter((m) => m.initiative == null)
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  return { rolled, unrolled };
};

export const rollInitiative = (bonus: number, rng: () => number = Math.random) => {
  const roll = Math.floor(rng() * 20) + 1;
  const sign = bonus < 0 ? '−' : '+';
  return { roll, total: roll + bonus, text: `d20 (${roll}) ${sign} ${Math.abs(bonus)} = ${roll + bonus}` };
};

export const readTurnPosition = (
  settings: Pick<SceneSettings, 'combatRound' | 'combatActiveMarkerId' | 'combatLairStep'>
): TurnPosition => ({
  round: settings.combatRound ?? 0,
  activeId: settings.combatActiveMarkerId ?? null,
  lairStep: settings.combatLairStep ?? false
});

export const turnEntryKey = (entry: TurnEntry): string => {
  if (entry.kind === 'combatant') return entry.combatant.id;
  if (entry.kind === 'roundEnd') return 'round-end';
  return entry.actsNextRound ? 'lair-b' : 'lair-a';
};

const buildSlots = <T extends Combatant>(rolled: T[]): Slot<T>[] => {
  if (rolled.length === 0) return [];
  const firstBelowLair = rolled.findIndex((c) => (c.initiative ?? 0) < LAIR_INITIATIVE);
  const lairIndex = firstBelowLair === -1 ? rolled.length : firstBelowLair;
  return [
    ...rolled.slice(0, lairIndex).map((combatant): Slot<T> => ({ kind: 'combatant', combatant })),
    { kind: 'lair' },
    ...rolled.slice(lairIndex).map((combatant): Slot<T> => ({ kind: 'combatant', combatant }))
  ];
};

const slotMatches = <T extends Combatant>(slot: Slot<T>, pos: TurnPosition): boolean =>
  pos.lairStep ? slot.kind === 'lair' : slot.kind === 'combatant' && slot.combatant.id === pos.activeId;

const NO_SKIP: ReadonlySet<string> = new Set();

const canStop = <T extends Combatant>(slot: Slot<T>, lairActions: boolean, skipIds: ReadonlySet<string>): boolean =>
  slot.kind === 'lair' ? lairActions : !isDefeated(slot.combatant) && !skipIds.has(slot.combatant.id);

const positionAt = <T extends Combatant>(slot: Slot<T>, round: number): TurnPosition =>
  slot.kind === 'lair'
    ? { round, activeId: null, lairStep: true }
    : { round, activeId: slot.combatant.id, lairStep: false };

const stepTurn = <T extends Combatant>(
  slots: Slot<T>[],
  pos: TurnPosition,
  lairActions: boolean,
  direction: 1 | -1,
  skipIds: ReadonlySet<string>
): TurnPosition => {
  const count = slots.length;
  const index = slots.findIndex((slot) => slotMatches(slot, pos));
  const origin = index === -1 ? (direction === 1 ? -1 : count) : index;

  for (let step = 1; step <= count; step++) {
    const absolute = origin + direction * step;
    const slot = slots[((absolute % count) + count) % count];
    const roundDelta = Math.floor(absolute / count);
    if (!canStop(slot, lairActions, skipIds)) continue;
    if (pos.round + roundDelta < 1) return pos;
    return positionAt(slot, pos.round + roundDelta);
  }
  return pos;
};

const anyoneStanding = <T extends Combatant>(rolled: T[], skipIds: ReadonlySet<string>): boolean =>
  rolled.some((c) => !isDefeated(c) && !skipIds.has(c.id));

export const getNextTurn = <T extends Combatant>(
  rolled: T[],
  pos: TurnPosition,
  lairActions: boolean,
  skipIds: ReadonlySet<string> = NO_SKIP
): TurnPosition => {
  if (!anyoneStanding(rolled, skipIds)) return pos;
  const slots = buildSlots(rolled);
  if (pos.round === 0) {
    const firstStop = slots.find((slot) => canStop(slot, lairActions, skipIds));
    return firstStop ? positionAt(firstStop, 1) : pos;
  }
  return stepTurn(slots, pos, lairActions, 1, skipIds);
};

export const getPreviousTurn = <T extends Combatant>(
  rolled: T[],
  pos: TurnPosition,
  lairActions: boolean
): TurnPosition => {
  if (pos.round === 0 || !anyoneStanding(rolled, NO_SKIP)) return pos;
  return stepTurn(buildSlots(rolled), pos, lairActions, -1, NO_SKIP);
};

export const isSameTurn = (a: TurnPosition, b: TurnPosition): boolean =>
  a.round === b.round && a.activeId === b.activeId && a.lairStep === b.lairStep;

// When the active combatant leaves, the turn passes to the next one still in the order
export const advancePastRemoved = <T extends Combatant>(
  rolled: T[],
  removedIds: ReadonlySet<string>,
  pos: TurnPosition,
  lairActions: boolean
): TurnPosition => {
  if (pos.activeId === null || !removedIds.has(pos.activeId)) return pos;
  const next = getNextTurn(rolled, pos, lairActions, removedIds);
  return next.activeId !== null && removedIds.has(next.activeId) ? { ...next, activeId: null, lairStep: false } : next;
};

// The active combatant vanished without removeCombatants (undo, a sync delete): advance using the previous order
export const recoverTurnPosition = <T extends Combatant>(
  previousRolled: T[],
  rolled: T[],
  pos: TurnPosition,
  lairActions: boolean
): TurnPosition => {
  if (pos.round === 0 || pos.activeId === null) return pos;
  const currentIds = new Set(rolled.map((c) => c.id));
  if (currentIds.has(pos.activeId)) return pos;
  const removedIds = new Set(previousRolled.filter((c) => !currentIds.has(c.id)).map((c) => c.id));
  return advancePastRemoved(previousRolled, removedIds, pos, lairActions);
};

export const buildTurnView = <T extends Combatant>(
  rolled: T[],
  pos: TurnPosition,
  lairActions: boolean
): TurnEntry<T>[] => {
  const slots = buildSlots(rolled);
  const upNext = getNextTurn(rolled, pos, lairActions);
  const toEntry = (slot: Slot<T>, isActive: boolean, actsNextRound: boolean): TurnEntry<T> =>
    slot.kind === 'lair'
      ? { kind: 'lair', isActive, isUpNext: !isActive && upNext.lairStep, actsNextRound }
      : {
          kind: 'combatant',
          combatant: slot.combatant,
          isActive,
          isDefeated: isDefeated(slot.combatant),
          actsNextRound
        };

  if (pos.round === 0) return slots.map((slot) => toEntry(slot, false, false));

  const current = slots.findIndex((slot) => slotMatches(slot, pos));
  const origin = current === -1 ? 0 : current;
  return [
    ...slots.slice(origin).map((slot) => toEntry(slot, slotMatches(slot, pos), false)),
    { kind: 'roundEnd', round: pos.round },
    ...slots.slice(0, origin).map((slot) => toEntry(slot, false, true))
  ];
};

// Drops hidden combatants after the view is built, so their turn still holds its place in the order
export const filterTurnView = <T extends Combatant>(
  entries: TurnEntry<T>[],
  isShown: (combatant: T) => boolean
): TurnEntry<T>[] => entries.filter((entry) => entry.kind !== 'combatant' || isShown(entry.combatant));

const COMBAT_VIEW_FIELDS = [
  'id',
  'title',
  'label',
  'inCombat',
  'initiative',
  'initiativeBonus',
  'initiativeTiebreak',
  'statBlock',
  'hitPoints',
  'conditions',
  'visibility',
  'imageLocation',
  'shapeColor'
] as const;

// Snapshot rows keep stable references for unchanged values, so a shallow compare of the shown fields is enough
export const sameCombatantView = <T extends Partial<Pick<MarkerRow, (typeof COMBAT_VIEW_FIELDS)[number]>>>(
  a: T[],
  b: T[]
): boolean =>
  a.length === b.length && a.every((row, i) => COMBAT_VIEW_FIELDS.every((field) => row[field] === b[i][field]));

export const takeCombatantEntries = <T extends Combatant>(
  entries: TurnEntry<T>[],
  max: number
): { entries: TurnEntry<T>[]; overflow: number } => {
  const total = entries.filter((entry) => entry.kind === 'combatant').length;
  const kept: TurnEntry<T>[] = [];
  let shown = 0;
  for (const entry of entries) {
    if (entry.kind === 'combatant') {
      if (shown === max) break;
      shown++;
    }
    kept.push(entry);
  }
  return { entries: kept, overflow: total - shown };
};

export const resolveInitiativeDraft = (
  text: string,
  current: number | null,
  normalize: (value: number | null) => number | null
): number | null => {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? normalize(parsed) : current;
};

export const formatSignedModifier = (value: number): string => (value < 0 ? `−${Math.abs(value)}` : `+${value}`);
