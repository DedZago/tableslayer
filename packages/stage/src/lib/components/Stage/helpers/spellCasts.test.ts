import { describe, expect, it } from 'vitest';
import { AoeShape } from '../components/AoeTemplateLayer/types';
import type { SpellCast } from '../components/SpellCastLayer/types';
import {
  getSpellCastBounds,
  pruneSpellCasts,
  receiveSpellCast,
  SPELL_CAST_LINK_GRACE_MS,
  SPELL_FX_INDEX,
  SPELL_FX_LIST,
  spellCastProgress,
  writeSpellCastShake,
  type BroadcastSpellCast
} from './spellCasts';

const cast = (overrides: Partial<SpellCast> = {}): SpellCast => ({
  id: 'a',
  spellId: 'fireball',
  fx: 'burst',
  variant: 0,
  palette: ['#ff0000', '#ffffff'],
  origin: { x: 0, y: 0 },
  target: { x: 0, y: 0 },
  durationMs: 1000,
  startedAt: 0,
  ...overrides
});

const broadcast = (id: string, sceneId = 's1'): BroadcastSpellCast => {
  const { startedAt: _startedAt, ...rest } = cast({ id });
  return { ...rest, sceneId };
};

describe('SPELL_FX_INDEX', () => {
  it('gives every archetype a unique define value', () => {
    expect(new Set(Object.values(SPELL_FX_INDEX)).size).toBe(SPELL_FX_LIST.length);
  });
});

describe('spellCastProgress', () => {
  it('runs 0..1 over the duration', () => {
    expect(spellCastProgress(cast(), 500, 'high')).toBeCloseTo(0.5);
    expect(spellCastProgress(cast(), 1000, 'medium')).toBeCloseTo(1);
  });

  it('starts at the impact and finishes in 60% of the time on low', () => {
    expect(spellCastProgress(cast(), 0, 'low')).toBeCloseTo(0.4);
    expect(spellCastProgress(cast(), 600, 'low')).toBeCloseTo(1);
  });
});

describe('getSpellCastBounds', () => {
  it('covers the area, the caster and padding', () => {
    const bounds = getSpellCastBounds(
      cast({
        area: { shape: AoeShape.Circle, size: 20, angle: 0 },
        origin: { x: -50, y: 0 }
      }),
      1
    );
    expect(bounds.centerX - bounds.width / 2).toBeLessThan(-50);
    expect(bounds.centerX + bounds.width / 2).toBeGreaterThan(20);
  });

  it('follows the area angle', () => {
    const bounds = getSpellCastBounds(cast({ area: { shape: AoeShape.Line, size: 100, width: 5, angle: 90 } }), 1);
    expect(bounds.height).toBeGreaterThan(bounds.width);
  });
});

describe('writeSpellCastShake', () => {
  it('shakes only inside the impact window, within the cap', () => {
    const out = { x: 0, y: 0 };
    writeSpellCastShake([cast()], 100, out);
    expect(out).toEqual({ x: 0, y: 0 });
    writeSpellCastShake([cast()], 420, out);
    expect(Math.abs(out.x)).toBeLessThanOrEqual(6);
    expect(Math.abs(out.x) + Math.abs(out.y)).toBeGreaterThan(0);
    writeSpellCastShake([cast()], 700, out);
    expect(out).toEqual({ x: 0, y: 0 });
  });

  it('ignores archetypes without a blast', () => {
    const out = { x: 0, y: 0 };
    writeSpellCastShake([cast({ fx: 'summon' })], 420, out);
    expect(out).toEqual({ x: 0, y: 0 });
  });
});

describe('receiveSpellCast', () => {
  it('adds a new cast for the shown scene with a local start time', () => {
    const seen = new Map<number, string>();
    const next = receiveSpellCast([], seen, 7, broadcast('x'), 's1', 5000);
    expect(next).toHaveLength(1);
    expect(next[0].startedAt).toBe(5000);
    expect(next[0]).not.toHaveProperty('sceneId');
  });

  it('ignores a repeated id from the same client', () => {
    const seen = new Map<number, string>();
    const first = receiveSpellCast([], seen, 7, broadcast('x'), 's1', 5000);
    expect(receiveSpellCast(first, seen, 7, broadcast('x'), 's1', 5100)).toBe(first);
  });

  it('ignores other scenes but remembers the id', () => {
    const seen = new Map<number, string>();
    expect(receiveSpellCast([], seen, 7, broadcast('x', 's2'), 's1', 1)).toEqual([]);
    expect(seen.get(7)).toBe('x');
  });

  it('forgets a client whose field cleared, so a later cast plays', () => {
    const seen = new Map<number, string>();
    receiveSpellCast([], seen, 7, broadcast('x'), 's1', 1);
    receiveSpellCast([], seen, 7, null, 's1', 2);
    expect(receiveSpellCast([], seen, 7, broadcast('x'), 's1', 3)).toHaveLength(1);
  });

  it('keeps at most the concurrency cap, dropping the oldest', () => {
    const seen = new Map<number, string>();
    let active: readonly SpellCast[] = [];
    for (let i = 0; i < 8; i++) active = receiveSpellCast(active, seen, i, broadcast(`c${i}`), 's1', i);
    expect(active).toHaveLength(6);
    expect(active[0].id).toBe('c2');
  });
});

describe('pruneSpellCasts', () => {
  it('drops expired casts and keeps the array when nothing expired', () => {
    const now = 1200 + SPELL_CAST_LINK_GRACE_MS;
    const live = cast({ id: 'live', startedAt: now - 100 });
    const old = cast({ id: 'old', startedAt: 0 });
    expect(pruneSpellCasts([old, live], now).map((c) => c.id)).toEqual(['live']);
    const list = [live];
    expect(pruneSpellCasts(list, now)).toBe(list);
  });

  it('keeps a cast past its duration while its program may still be linking', () => {
    const waiting = cast({ startedAt: 0, durationMs: 1000 });
    expect(pruneSpellCasts([waiting], 1000 + SPELL_CAST_LINK_GRACE_MS - 1)).toHaveLength(1);
  });
});
