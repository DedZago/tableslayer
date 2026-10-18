import type { MarkerRow, SceneSettings } from '$lib/realtime/types';
import type { Combatant } from '$lib/utils/initiative';
import { describe, expect, it } from 'vitest';
import {
  addCombatants,
  beginCombat,
  endCombat,
  nextTurn,
  nudgeTie,
  previousTurn,
  recoverActiveTurn,
  removeCombatants,
  rerollAll,
  rollEmpty,
  rollOne,
  setInitiative,
  setInitiativeBonus,
  startCombat
} from './combatActions';
import type { CombatSnapshot, CombatWriter } from './types';

const SCENE = 'scene-1';

const make = (id: string, initiative: number | null, extra: Partial<Combatant> = {}): Combatant => ({
  id,
  title: id,
  inCombat: true,
  initiative,
  initiativeBonus: null,
  initiativeTiebreak: 0,
  statBlock: null,
  hitPoints: null,
  conditions: [],
  visibility: 0,
  ...extra
});

const snapshotOf = (
  markers: Combatant[],
  settings: Partial<SceneSettings> = {},
  lairActions = false
): CombatSnapshot => ({
  settings: { combatLairActions: lairActions, ...settings } as SceneSettings,
  markers: markers as MarkerRow[]
});

const createFakeWriter = (snapshot: CombatSnapshot) => {
  const state = {
    markers: snapshot.markers.map((m) => ({ ...m })),
    settings: { ...snapshot.settings }
  };
  let transactions = 0;
  const writer: CombatWriter = {
    transaction(fn) {
      transactions++;
      fn();
    },
    setExistingMarkerFields(_sceneId, markerId, fields) {
      const marker = state.markers.find((m) => m.id === markerId);
      if (marker) Object.assign(marker, fields);
      return marker !== undefined;
    },
    setSceneSettings(_sceneId, fields) {
      Object.assign(state.settings, fields);
    }
  };
  return { writer, state, transactionCount: () => transactions };
};

const marker = (state: { markers: Combatant[] }, id: string) => {
  const found = state.markers.find((m) => m.id === id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
};

const lineup = (settings: Partial<SceneSettings> = {}) =>
  snapshotOf(
    [make('T', 22), make('W', 20), make('G', 19), make('B', 18), make('M', 15)],
    { combatRound: 1, combatActiveMarkerId: 'W', combatLairStep: false, ...settings },
    false
  );

describe('startCombat', () => {
  it('adds the tokens to combat in one transaction and opens the rolling phase', () => {
    const snapshot = snapshotOf([make('a', null, { inCombat: false }), make('b', null, { inCombat: false })], {
      combatRound: 3,
      combatActiveMarkerId: 'x',
      combatLairStep: true
    });
    const fake = createFakeWriter(snapshot);
    startCombat(fake.writer, SCENE, snapshot, ['a', 'b']);
    expect(marker(fake.state, 'a').inCombat).toBe(true);
    expect(marker(fake.state, 'b').inCombat).toBe(true);
    expect(fake.state.settings).toMatchObject({ combatRound: 0, combatActiveMarkerId: null, combatLairStep: false });
    expect(fake.transactionCount()).toBe(1);
  });

  it('keeps the turn when combat is already running', () => {
    const snapshot = lineup();
    const fake = createFakeWriter(snapshot);
    startCombat(fake.writer, SCENE, snapshot, ['Z']);
    expect(fake.state.settings).toMatchObject({ combatRound: 1, combatActiveMarkerId: 'W' });
  });
});

describe('addCombatants', () => {
  it('adds only tokens that are not already in combat, without an initiative', () => {
    const snapshot = snapshotOf([make('T', 22), make('new', 9, { inCombat: false })], { combatRound: 1 });
    const fake = createFakeWriter(snapshot);
    addCombatants(fake.writer, SCENE, snapshot, ['T', 'new']);
    expect(marker(fake.state, 'new')).toMatchObject({ inCombat: true, initiative: null });
    expect(marker(fake.state, 'T').initiative).toBe(22);
  });
});

describe('removeCombatants', () => {
  it('advances the turn when the active combatant is removed', () => {
    const snapshot = lineup();
    const fake = createFakeWriter(snapshot);
    removeCombatants(fake.writer, SCENE, snapshot, ['W']);
    expect(fake.state.settings).toMatchObject({ combatRound: 1, combatActiveMarkerId: 'G', combatLairStep: false });
    expect(marker(fake.state, 'W')).toMatchObject({ inCombat: false, initiative: null, initiativeTiebreak: 0 });
    expect(fake.transactionCount()).toBe(1);
  });

  it('skips over other removed combatants when the active one leaves', () => {
    const snapshot = lineup();
    const fake = createFakeWriter(snapshot);
    removeCombatants(fake.writer, SCENE, snapshot, ['W', 'G']);
    expect(fake.state.settings).toMatchObject({ combatRound: 1, combatActiveMarkerId: 'B' });
  });

  it('wraps into the next round when the last active combatant leaves', () => {
    const snapshot = snapshotOf([make('T', 22), make('M', 15)], { combatRound: 1, combatActiveMarkerId: 'M' });
    const fake = createFakeWriter(snapshot);
    removeCombatants(fake.writer, SCENE, snapshot, ['M']);
    expect(fake.state.settings).toMatchObject({ combatRound: 2, combatActiveMarkerId: 'T' });
  });

  it('leaves the turn alone when a non-active combatant is removed', () => {
    const snapshot = lineup();
    const fake = createFakeWriter(snapshot);
    removeCombatants(fake.writer, SCENE, snapshot, ['M']);
    expect(fake.state.settings).toMatchObject({ combatRound: 1, combatActiveMarkerId: 'W' });
  });

  it('ends combat when nobody is left', () => {
    const snapshot = snapshotOf([make('T', 22)], { combatRound: 2, combatActiveMarkerId: 'T' });
    const fake = createFakeWriter(snapshot);
    removeCombatants(fake.writer, SCENE, snapshot, ['T']);
    expect(fake.state.settings).toMatchObject({ combatRound: 0, combatActiveMarkerId: null, combatLairStep: false });
    expect(marker(fake.state, 'T').inCombat).toBe(false);
  });
});

describe('endCombat', () => {
  it('clears every combatant and the scene turn', () => {
    const snapshot = lineup({ combatLairStep: true, combatActiveMarkerId: null });
    const fake = createFakeWriter(snapshot);
    endCombat(fake.writer, SCENE, snapshot);
    for (const id of ['T', 'W', 'G', 'B', 'M']) {
      expect(marker(fake.state, id)).toMatchObject({ inCombat: false, initiative: null, initiativeTiebreak: 0 });
    }
    expect(fake.state.settings).toMatchObject({ combatRound: 0, combatActiveMarkerId: null, combatLairStep: false });
    expect(fake.transactionCount()).toBe(1);
  });
});

describe('initiative values', () => {
  it('resets the tiebreak only when the value changes', () => {
    const snapshot = snapshotOf([make('a', 12, { initiativeTiebreak: 3 })]);
    const same = createFakeWriter(snapshot);
    setInitiative(same.writer, SCENE, snapshot, 'a', 12);
    expect(marker(same.state, 'a').initiativeTiebreak).toBe(3);
    const changed = createFakeWriter(snapshot);
    setInitiative(changed.writer, SCENE, snapshot, 'a', 14);
    expect(marker(changed.state, 'a')).toMatchObject({ initiative: 14, initiativeTiebreak: 0 });
  });

  it('clamps the value and keeps the active combatant rolled', () => {
    const snapshot = lineup();
    const fake = createFakeWriter(snapshot);
    setInitiative(fake.writer, SCENE, snapshot, 'T', 99);
    expect(marker(fake.state, 'T').initiative).toBe(50);
    setInitiative(fake.writer, SCENE, snapshot, 'W', null);
    expect(marker(fake.state, 'W').initiative).toBe(20);
  });

  it('writes the bonus as a GM override and clamps it', () => {
    const snapshot = lineup();
    const fake = createFakeWriter(snapshot);
    setInitiativeBonus(fake.writer, SCENE, 'T', 40);
    expect(marker(fake.state, 'T').initiativeBonus).toBe(30);
    setInitiativeBonus(fake.writer, SCENE, 'T', null);
    expect(marker(fake.state, 'T').initiativeBonus).toBeNull();
  });
});

describe('rolling', () => {
  it('rolls only empty rows with their bonus and reports each roll', () => {
    const snapshot = snapshotOf([
      make('typed', 12),
      make('empty', null, { initiativeBonus: 3 }),
      make('monster', null, {
        statBlock: { initiative: 2, abilities: { dex: { mod: 0 } } } as unknown as Combatant['statBlock']
      })
    ]);
    const fake = createFakeWriter(snapshot);
    const lines = rollEmpty(fake.writer, SCENE, snapshot, () => 0.5);
    expect(marker(fake.state, 'typed').initiative).toBe(12);
    expect(marker(fake.state, 'empty').initiative).toBe(14);
    expect(marker(fake.state, 'monster').initiative).toBe(13);
    expect(lines).toEqual(['empty: d20 (11) + 3 = 14', 'monster: d20 (11) + 2 = 13']);
    expect(fake.transactionCount()).toBe(1);
  });

  it('rerolls every combatant', () => {
    const snapshot = snapshotOf([make('a', 1), make('b', 2)]);
    const fake = createFakeWriter(snapshot);
    const lines = rerollAll(fake.writer, SCENE, snapshot, () => 0);
    expect(lines).toHaveLength(2);
    expect(marker(fake.state, 'a').initiative).toBe(1);
    expect(marker(fake.state, 'b').initiative).toBe(1);
  });

  it('overwrites a single combatant', () => {
    const snapshot = snapshotOf([make('a', 18)]);
    const fake = createFakeWriter(snapshot);
    rollOne(fake.writer, SCENE, snapshot, 'a', () => 0.99);
    expect(marker(fake.state, 'a').initiative).toBe(20);
  });
});

describe('nudgeTie', () => {
  const tied = () => snapshotOf([make('a', 12), make('b', 12), make('c', 9)]);

  it('moves a combatant above its ties with max plus one', () => {
    const snapshot = tied();
    const fake = createFakeWriter(snapshot);
    nudgeTie(fake.writer, SCENE, snapshot, 'b', 'up');
    expect(marker(fake.state, 'b').initiativeTiebreak).toBe(1);
  });

  it('moves a combatant below its ties with min minus one', () => {
    const snapshot = tied();
    const fake = createFakeWriter(snapshot);
    nudgeTie(fake.writer, SCENE, snapshot, 'a', 'down');
    expect(marker(fake.state, 'a').initiativeTiebreak).toBe(-1);
  });
});

describe('turn actions', () => {
  it('begins round 1 at the top combatant', () => {
    const snapshot = snapshotOf([make('T', 22), make('W', 20)], { combatRound: 0 });
    const fake = createFakeWriter(snapshot);
    beginCombat(fake.writer, SCENE, snapshot);
    expect(fake.state.settings).toMatchObject({ combatRound: 1, combatActiveMarkerId: 'T', combatLairStep: false });
  });

  it('does not restart a running combat', () => {
    const snapshot = lineup();
    const fake = createFakeWriter(snapshot);
    beginCombat(fake.writer, SCENE, snapshot);
    expect(fake.state.settings).toMatchObject({ combatRound: 1, combatActiveMarkerId: 'W' });
  });

  it('moves forward and backward through the order', () => {
    const snapshot = lineup({ combatActiveMarkerId: 'T' });
    const forward = createFakeWriter(snapshot);
    nextTurn(forward.writer, SCENE, snapshot);
    expect(forward.state.settings).toMatchObject({ combatRound: 1, combatActiveMarkerId: 'W' });

    const back = createFakeWriter(snapshot);
    previousTurn(back.writer, SCENE, snapshot);
    expect(back.state.settings).toMatchObject({ combatRound: 1, combatActiveMarkerId: 'T' });
  });

  it('starts round 1 when next is pressed while rolling', () => {
    const snapshot = snapshotOf([make('T', 22)], { combatRound: 0 });
    const fake = createFakeWriter(snapshot);
    nextTurn(fake.writer, SCENE, snapshot);
    expect(fake.state.settings).toMatchObject({ combatRound: 1, combatActiveMarkerId: 'T' });
  });

  it('returns the new position, or null without writing when the turn cannot move', () => {
    const moving = snapshotOf([make('T', 22), make('W', 20)], { combatRound: 1, combatActiveMarkerId: 'T' });
    expect(nextTurn(createFakeWriter(moving).writer, SCENE, moving)).toEqual({
      round: 1,
      activeId: 'W',
      lairStep: false
    });

    const nobodyRolled = snapshotOf([make('a', null)], { combatRound: 0 });
    const idle = createFakeWriter(nobodyRolled);
    expect(beginCombat(idle.writer, SCENE, nobodyRolled)).toBeNull();
    expect(idle.transactionCount()).toBe(0);

    const firstSlot = snapshotOf([make('T', 22), make('W', 20)], { combatRound: 1, combatActiveMarkerId: 'T' });
    expect(previousTurn(createFakeWriter(firstSlot).writer, SCENE, firstSlot)).toBeNull();
  });

  it('lands on the lair step when lair actions are on', () => {
    const snapshot = snapshotOf(
      [make('T', 22), make('W', 20), make('G', 19)],
      { combatRound: 1, combatActiveMarkerId: 'W' },
      true
    );
    const fake = createFakeWriter(snapshot);
    nextTurn(fake.writer, SCENE, snapshot);
    expect(fake.state.settings).toMatchObject({ combatRound: 1, combatActiveMarkerId: null, combatLairStep: true });
  });
});

describe('recoverActiveTurn', () => {
  it('passes the turn on when the active combatant vanished from the scene', () => {
    const before = lineup();
    const after = snapshotOf(
      before.markers.filter((m) => m.id !== 'W') as Combatant[],
      { combatRound: 1, combatActiveMarkerId: 'W', combatLairStep: false },
      false
    );
    const fake = createFakeWriter(after);
    recoverActiveTurn(fake.writer, SCENE, after, before.markers);
    expect(fake.state.settings).toMatchObject({ combatRound: 1, combatActiveMarkerId: 'G', combatLairStep: false });
  });

  it('writes nothing while the active combatant is present', () => {
    const snapshot = lineup();
    const fake = createFakeWriter(snapshot);
    recoverActiveTurn(fake.writer, SCENE, snapshot, snapshot.markers);
    expect(fake.transactionCount()).toBe(0);
  });
});
