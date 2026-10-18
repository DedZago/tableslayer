import { describe, expect, it } from 'vitest';
import {
  advancePastRemoved,
  buildTurnView,
  compareCombatants,
  filterTurnView,
  formatSignedModifier,
  getNextTurn,
  getPreviousTurn,
  isDefeated,
  isDefeatedForPlayers,
  isSameTurn,
  normalizeInitiativeBonus,
  normalizeInitiativeValue,
  readTurnPosition,
  recoverTurnPosition,
  resolveInitiativeBonus,
  resolveInitiativeDraft,
  rollInitiative,
  sameCombatantView,
  sortCombatants,
  takeCombatantEntries,
  turnEntryKey,
  type Combatant,
  type TurnEntry,
  type TurnPosition
} from './initiative';
import type { StatBlock } from './statBlock/types';

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

const statBlockWith = (initiative: number | undefined, dex: number) =>
  ({ initiative, abilities: { dex: { score: 10, mod: dex } } }) as unknown as NonNullable<Combatant['statBlock']>;

const dead = [{ id: 'dead' }];

const T = make('T', 22);
const W = make('W', 20);
const G = make('G', 19);
const B = make('B', 18);
const M = make('M', 15);
const lineup = [T, W, G, B, M];

const at = (round: number, activeId: string | null, lairStep = false): TurnPosition => ({ round, activeId, lairStep });
const ids = (entries: TurnEntry[]) =>
  entries.map((entry) => (entry.kind === 'combatant' ? entry.combatant.id : entry.kind));

describe('resolveInitiativeBonus', () => {
  it('prefers the GM override, even when it is zero', () => {
    expect(resolveInitiativeBonus(make('a', 1, { initiativeBonus: 0, statBlock: statBlockWith(5, 3) }))).toBe(0);
  });

  it('uses the stat block initiative before the Dex modifier', () => {
    expect(resolveInitiativeBonus(make('a', 1, { statBlock: statBlockWith(5, 3) }))).toBe(5);
  });

  it('falls back to the Dex modifier when there is no initiative value', () => {
    expect(resolveInitiativeBonus(make('a', 1, { statBlock: statBlockWith(undefined, -1) }))).toBe(-1);
  });

  it('is zero without a stat block or override', () => {
    expect(resolveInitiativeBonus(make('a', 1))).toBe(0);
  });
});

describe('isDefeated', () => {
  it('is true for dead but not unconscious tokens, who still roll death saves', () => {
    expect(isDefeated(make('a', 1, { conditions: [{ id: 'dead' }] }))).toBe(true);
    expect(isDefeated(make('a', 1, { conditions: [{ id: 'unconscious' }] }))).toBe(false);
  });

  it('ignores other conditions', () => {
    expect(isDefeated(make('a', 1, { conditions: [{ id: 'prone' }] }))).toBe(false);
  });

  it('is true at zero hit points only when a stat block is present', () => {
    expect(isDefeated(make('a', 1, { statBlock: statBlockWith(0, 0), hitPoints: 0 }))).toBe(true);
    expect(isDefeated(make('a', 1, { hitPoints: 0 }))).toBe(false);
    expect(isDefeated(make('a', 1, { statBlock: statBlockWith(0, 0), hitPoints: 4 }))).toBe(false);
  });
});

describe('isDefeatedForPlayers', () => {
  it('ignores a GM-only dead condition but keeps a visible one and zero hit points', () => {
    expect(isDefeatedForPlayers(make('a', 10, { conditions: [{ id: 'dead', dmOnly: true }] }))).toBe(false);
    expect(isDefeated(make('a', 10, { conditions: [{ id: 'dead', dmOnly: true }] }))).toBe(true);
    expect(isDefeatedForPlayers(make('b', 10, { conditions: dead }))).toBe(true);
    expect(isDefeatedForPlayers(make('c', 10, { statBlock: statBlockWith(undefined, 0), hitPoints: 0 }))).toBe(true);
  });
});

describe('sorting', () => {
  it('sorts by initiative descending', () => {
    const { rolled } = sortCombatants([make('low', 5), make('high', 18), make('mid', 11)]);
    expect(rolled.map((c) => c.id)).toEqual(['high', 'mid', 'low']);
  });

  it('breaks ties with the higher tiebreak first', () => {
    const { rolled } = sortCombatants([
      make('a', 12),
      make('b', 12, { initiativeTiebreak: 2 }),
      make('c', 12, { initiativeTiebreak: -1 })
    ]);
    expect(rolled.map((c) => c.id)).toEqual(['b', 'a', 'c']);
  });

  it('breaks remaining ties by bonus, then title, then id', () => {
    const byBonus = [make('a', 12, { initiativeBonus: 1 }), make('b', 12, { initiativeBonus: 3 })];
    expect(sortCombatants(byBonus).rolled.map((c) => c.id)).toEqual(['b', 'a']);
    const byTitle = [make('z', 12, { title: 'Bandit' }), make('y', 12, { title: 'Acolyte' })];
    expect(sortCombatants(byTitle).rolled.map((c) => c.id)).toEqual(['y', 'z']);
    expect(compareCombatants(make('p', 12, { title: 'Same' }), make('q', 12, { title: 'Same' }))).toBeLessThan(0);
  });

  it('splits rolled and unrolled, ignoring tokens that are not in combat', () => {
    const { rolled, unrolled } = sortCombatants([
      make('rolled', 10),
      make('zed', null, { title: 'Zed' }),
      make('ada', null, { title: 'Ada' }),
      make('outside', 30, { inCombat: false }),
      make('offlist', null, { inCombat: false })
    ]);
    expect(rolled.map((c) => c.id)).toEqual(['rolled']);
    expect(unrolled.map((c) => c.id)).toEqual(['ada', 'zed']);
  });
});

describe('rollInitiative', () => {
  it('rolls with the given rng and adds the bonus', () => {
    expect(rollInitiative(2, () => 0.5)).toEqual({ roll: 11, total: 13, text: 'd20 (11) + 2 = 13' });
  });

  it('uses the lowest and highest faces at the rng extremes', () => {
    expect(rollInitiative(0, () => 0).roll).toBe(1);
    expect(rollInitiative(0, () => 0.999).roll).toBe(20);
  });

  it('formats a negative bonus with a minus sign', () => {
    expect(rollInitiative(-1, () => 0.65)).toEqual({ roll: 14, total: 13, text: 'd20 (14) − 1 = 13' });
  });
});

describe('getNextTurn', () => {
  const lairOn = true;
  const lairOff = false;

  it('starts round 1 at the top combatant while rolling', () => {
    expect(getNextTurn(lineup, at(0, null), lairOff)).toEqual(at(1, 'T'));
  });

  it('starts on the lair step while rolling when the lair comes first and lair actions are on', () => {
    const low = [make('a', 12), make('b', 4)];
    expect(getNextTurn(low, at(0, null), lairOn)).toEqual(at(1, null, true));
    expect(getNextTurn(low, at(0, null), lairOff)).toEqual(at(1, 'a'));
  });

  it('stays in the rolling phase when nobody has rolled', () => {
    expect(getNextTurn([], at(0, null), lairOn)).toEqual(at(0, null));
  });

  it('steps forward and keeps the round within it', () => {
    expect(getNextTurn(lineup, at(1, 'T'), lairOff)).toEqual(at(1, 'W'));
  });

  it('wraps past the end and increments the round', () => {
    expect(getNextTurn(lineup, at(2, 'M'), lairOff)).toEqual(at(3, 'T'));
  });

  it('skips defeated combatants', () => {
    const rolled = [T, make('W', 20, { conditions: dead }), G];
    expect(getNextTurn(rolled, at(1, 'T'), lairOff)).toEqual(at(1, 'G'));
  });

  it('stops on the lair step only when lair actions are on', () => {
    expect(getNextTurn(lineup, at(1, 'W'), lairOn)).toEqual(at(1, null, true));
    expect(getNextTurn(lineup, at(1, 'W'), lairOff)).toEqual(at(1, 'G'));
  });

  it('moves from the lair step to the next combatant', () => {
    expect(getNextTurn(lineup, at(1, null, true), lairOn)).toEqual(at(1, 'G'));
  });

  it('starts from the first slot when the active token was deleted', () => {
    expect(getNextTurn(lineup, at(2, 'deleted'), lairOff)).toEqual(at(2, 'T'));
  });

  it('does nothing when everyone is defeated', () => {
    const allDown = lineup.map((c) => ({ ...c, conditions: dead }));
    expect(getNextTurn(allDown, at(2, 'T'), lairOn)).toEqual(at(2, 'T'));
  });
});

describe('getPreviousTurn', () => {
  it('does nothing at the first slot of round 1', () => {
    expect(getPreviousTurn(lineup, at(1, 'T'), false)).toEqual(at(1, 'T'));
  });

  it('does nothing while rolling', () => {
    expect(getPreviousTurn(lineup, at(0, null), false)).toEqual(at(0, null));
  });

  it('steps back within a round', () => {
    expect(getPreviousTurn(lineup, at(1, 'W'), false)).toEqual(at(1, 'T'));
  });

  it('wraps to the last slot of the previous round', () => {
    expect(getPreviousTurn(lineup, at(2, 'T'), false)).toEqual(at(1, 'M'));
  });

  it('stops on the lair step only when lair actions are on', () => {
    expect(getPreviousTurn(lineup, at(1, 'G'), true)).toEqual(at(1, null, true));
    expect(getPreviousTurn(lineup, at(1, 'G'), false)).toEqual(at(1, 'W'));
  });

  it('skips defeated combatants', () => {
    const rolled = [T, make('W', 20, { conditions: dead }), G];
    expect(getPreviousTurn(rolled, at(1, 'G'), false)).toEqual(at(1, 'T'));
  });

  it('starts from the last slot when the active token was deleted', () => {
    expect(getPreviousTurn(lineup, at(2, 'deleted'), false)).toEqual(at(2, 'M'));
  });
});

describe('buildTurnView', () => {
  it('lists every combatant in order with the lair line between 20s and below 20', () => {
    const view = buildTurnView(lineup, at(0, null), false);
    expect(ids(view)).toEqual(['T', 'W', 'lair', 'G', 'B', 'M']);
    expect(view.every((entry) => entry.kind === 'roundEnd' || !('isActive' in entry) || !entry.isActive)).toBe(true);
  });

  it('marks the lair line as up next while rolling when it is the first stop', () => {
    const low = [make('a', 12), make('b', 4)];
    const view = buildTurnView(low, at(0, null), true);
    expect(view[0]).toMatchObject({ kind: 'lair', isUpNext: true });
  });

  it('places the round end after this round and before next round', () => {
    const view = buildTurnView(lineup, at(2, 'B'), false);
    expect(ids(view)).toEqual(['B', 'M', 'roundEnd', 'T', 'W', 'lair', 'G']);
    expect(view[2]).toEqual({ kind: 'roundEnd', round: 2 });
    expect(view.slice(0, 2).every((e) => e.kind === 'combatant' && !e.actsNextRound)).toBe(true);
    expect(view.slice(3).every((e) => e.kind !== 'roundEnd' && e.actsNextRound)).toBe(true);
  });

  it('puts the lair line right after an active combatant at 20', () => {
    const view = buildTurnView(lineup, at(2, 'W'), true);
    expect(ids(view).slice(0, 3)).toEqual(['W', 'lair', 'G']);
    expect(view[0]).toMatchObject({ kind: 'combatant', isActive: true });
    expect(view[1]).toMatchObject({ kind: 'lair', isActive: false, isUpNext: true });
  });

  it('marks the lair step as the active entry', () => {
    const view = buildTurnView(lineup, at(2, null, true), true);
    expect(view[0]).toMatchObject({ kind: 'lair', isActive: true, isUpNext: false });
  });

  it('marks defeated combatants', () => {
    const rolled = [T, make('W', 20, { conditions: dead })];
    const view = buildTurnView(rolled, at(1, 'T'), false);
    expect(view.find((e) => e.kind === 'combatant' && e.combatant.id === 'W')).toMatchObject({ isDefeated: true });
  });

  it('keeps every combatant in this round when the active token is missing', () => {
    const view = buildTurnView(lineup, at(2, 'gone'), false);
    expect(ids(view).slice(-2)).toEqual(['M', 'roundEnd']);
  });

  it('returns nothing when no one has rolled', () => {
    expect(buildTurnView([], at(0, null), true)).toEqual([]);
  });

  it('gives this-round and next-round lair lines distinct keys', () => {
    const view = buildTurnView(lineup, at(2, 'W'), false);
    expect(view.filter((e) => e.kind === 'lair').map(turnEntryKey)).toEqual(['lair-a']);
    const nextRound = buildTurnView(lineup, at(2, 'B'), false);
    expect(nextRound.filter((e) => e.kind === 'lair').map(turnEntryKey)).toEqual(['lair-b']);
  });
});

describe('filterTurnView', () => {
  it('keeps the round and lair positions of a hidden active combatant', () => {
    const hidden = make('H', 16, { visibility: 1 });
    const rolled = [T, W, hidden, M];
    const view = filterTurnView(buildTurnView(rolled, at(2, 'H'), false), (c) => c.visibility !== 1);
    expect(ids(view)).toEqual(['M', 'roundEnd', 'T', 'W', 'lair']);
    expect(view.some((e) => e.kind === 'combatant' && e.isActive)).toBe(false);
  });
});

describe('advancePastRemoved', () => {
  it('moves the turn past every removed combatant', () => {
    expect(advancePastRemoved(lineup, new Set(['W', 'G']), at(1, 'W'), false)).toEqual(at(1, 'B'));
  });

  it('wraps into the next round when the last combatant leaves', () => {
    expect(advancePastRemoved(lineup, new Set(['M']), at(1, 'M'), false)).toEqual(at(2, 'T'));
  });

  it('clears the active id when nobody standing is left', () => {
    const rolled = [make('T', 22, { conditions: dead }), W];
    expect(advancePastRemoved(rolled, new Set(['W']), at(3, 'W'), false)).toEqual(at(3, null));
  });

  it('leaves the turn alone when the active combatant stays', () => {
    const pos = at(1, 'T');
    expect(advancePastRemoved(lineup, new Set(['M']), pos, false)).toBe(pos);
  });
});

describe('recoverTurnPosition', () => {
  it('continues from where a vanished active combatant stood', () => {
    expect(recoverTurnPosition(lineup, [T, W, B, M], at(2, 'G'), false)).toEqual(at(2, 'B'));
  });

  it('stops on the lair step after a vanished combatant when lair actions are on', () => {
    expect(recoverTurnPosition(lineup, [T, G, B, M], at(2, 'W'), true)).toEqual(at(2, null, true));
  });

  it('keeps the position while the active combatant is present', () => {
    const pos = at(2, 'G');
    expect(recoverTurnPosition(lineup, lineup, pos, false)).toBe(pos);
  });

  it('keeps the position when the previous order never had the active combatant', () => {
    const pos = at(2, 'gone');
    expect(recoverTurnPosition(lineup, lineup, pos, false)).toBe(pos);
  });

  it('ignores the rolling phase and the lair step', () => {
    expect(recoverTurnPosition(lineup, [T], at(0, null), true)).toEqual(at(0, null));
    expect(recoverTurnPosition(lineup, [T], at(2, null, true), true)).toEqual(at(2, null, true));
  });
});

describe('isSameTurn', () => {
  it('compares round, active id and lair step', () => {
    expect(isSameTurn(at(1, 'T'), at(1, 'T'))).toBe(true);
    expect(isSameTurn(at(1, 'T'), at(2, 'T'))).toBe(false);
    expect(isSameTurn(at(1, null, true), at(1, null, false))).toBe(false);
  });
});

describe('sameCombatantView', () => {
  it('ignores fields the tracker does not show, such as position', () => {
    const before = [{ ...T, positionX: 1 }];
    expect(sameCombatantView(before, [{ ...T, positionX: 5 }])).toBe(true);
  });

  it('detects combat field, order and length changes', () => {
    expect(sameCombatantView([T], [{ ...T, initiative: 3 }])).toBe(false);
    expect(sameCombatantView([T, W], [W, T])).toBe(false);
    expect(sameCombatantView([T], [T, W])).toBe(false);
  });
});

describe('takeCombatantEntries', () => {
  it('keeps the first combatants and counts the overflow', () => {
    const view = buildTurnView(lineup, at(2, 'B'), false);
    const { entries, overflow } = takeCombatantEntries(view, 2);
    expect(ids(entries)).toEqual(['B', 'M', 'roundEnd']);
    expect(overflow).toBe(3);
  });

  it('reports no overflow when everything fits', () => {
    const view = buildTurnView(lineup, at(0, null), false);
    expect(takeCombatantEntries(view, 12)).toEqual({ entries: view, overflow: 0 });
  });
});

describe('normalizers and drafts', () => {
  it('rounds and clamps the initiative value', () => {
    expect(normalizeInitiativeValue(7.6)).toBe(8);
    expect(normalizeInitiativeValue(-20)).toBe(-10);
    expect(normalizeInitiativeValue(99)).toBe(50);
    expect(normalizeInitiativeValue(null)).toBeNull();
    expect(normalizeInitiativeValue(Number.NaN)).toBeNull();
  });

  it('clamps the bonus between -20 and 30', () => {
    expect(normalizeInitiativeBonus(40)).toBe(30);
    expect(normalizeInitiativeBonus(-25)).toBe(-20);
  });

  it('reads drafts: blank clears, numbers normalize, junk keeps the current value', () => {
    expect(resolveInitiativeDraft('  ', 4, normalizeInitiativeValue)).toBeNull();
    expect(resolveInitiativeDraft(' 15 ', null, normalizeInitiativeValue)).toBe(15);
    expect(resolveInitiativeDraft('99', null, normalizeInitiativeValue)).toBe(50);
    expect(resolveInitiativeDraft('abc', 4, normalizeInitiativeValue)).toBe(4);
  });

  it('formats signed modifiers', () => {
    expect(formatSignedModifier(2)).toBe('+2');
    expect(formatSignedModifier(0)).toBe('+0');
    expect(formatSignedModifier(-1)).toBe('−1');
  });

  it('reads a turn position with defaults for older rows', () => {
    expect(readTurnPosition({})).toEqual(at(0, null, false));
    expect(readTurnPosition({ combatRound: 3, combatActiveMarkerId: 'x', combatLairStep: true })).toEqual(
      at(3, 'x', true)
    );
  });
});
