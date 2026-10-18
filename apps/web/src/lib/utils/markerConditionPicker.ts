import type { MarkerRow } from '$lib/realtime';
import { MARKER_CONDITIONS, sortConditions, type MarkerCondition } from '@tableslayer/stage';
import { isAutoBloodied } from './buildSceneProps';

type ConditionRow = Pick<MarkerRow, 'conditions' | 'statBlock' | 'hitPoints'>;

export type ConditionPickerState = {
  /** Stored conditions every target has; a value is kept only when all targets share it */
  active: MarkerCondition[];
  /** Stored conditions only some targets have */
  mixed: Set<string>;
  /** Derived conditions (auto Bloodied) shown read-only when no target stores them */
  automatic: Set<string>;
};

export const conditionPickerState = (rows: ConditionRow[]): ConditionPickerState => {
  const byId = new Map<string, MarkerCondition[]>();
  for (const row of rows) {
    for (const condition of row.conditions ?? [])
      byId.set(condition.id, [...(byId.get(condition.id) ?? []), condition]);
  }
  const active: MarkerCondition[] = [];
  const mixed = new Set<string>();
  for (const [id, list] of byId) {
    if (list.length !== rows.length) {
      mixed.add(id);
      continue;
    }
    const sharedValue = list.every((condition) => condition.value === list[0].value);
    active.push(sharedValue ? list[0] : { ...list[0], value: undefined });
  }
  const automatic = new Set<string>();
  if (rows.length > 0 && !byId.has('bloodied') && rows.every(isAutoBloodied)) automatic.add('bloodied');
  return { active, mixed, automatic };
};

// Steps a valued condition (exhaustion) on one token; dropping below 1 removes it
export const stepConditionValue = (stored: MarkerCondition[], id: string, delta: number): MarkerCondition[] => {
  const existing = stored.find((condition) => condition.id === id);
  const rest = stored.filter((condition) => condition.id !== id);
  const max = MARKER_CONDITIONS[id]?.maxValue ?? 1;
  const value = Math.min((existing?.value ?? 0) + delta, max);
  return value <= 0 ? rest : sortConditions([...rest, { ...existing, id, value }]);
};
