import type { SessionWriter } from '$lib/realtime/docSchema';
import type { MarkerRow, SceneSnapshot } from '$lib/realtime/types';
import type { Combatant } from '$lib/utils/initiative';

export type CombatToken = Combatant & Pick<MarkerRow, 'imageLocation' | 'shapeColor' | 'label'>;

export type CombatSnapshot = Pick<SceneSnapshot, 'settings' | 'markers'>;

export type CombatWriter = Pick<SessionWriter, 'transaction' | 'setExistingMarkerFields' | 'setSceneSettings'>;

export type CombatAction =
  | { type: 'start'; ids: string[] }
  | { type: 'add'; ids: string[] }
  | { type: 'remove'; ids: string[] }
  | { type: 'setInitiative'; id: string; value: number | null }
  | { type: 'rollEmpty' }
  | { type: 'rerollAll' }
  | { type: 'rollOne'; id: string }
  | { type: 'nudgeTie'; id: string; direction: 'up' | 'down' }
  | { type: 'begin' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'end' };
