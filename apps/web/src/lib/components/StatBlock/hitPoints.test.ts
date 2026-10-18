import { describe, expect, it } from 'vitest';
import { applyDamage, applyHealing, clampHitPoints, clampTempHitPoints, hpFraction } from './hitPoints';

describe('hit points helpers', () => {
  it('clamps to the range 0 to max', () => {
    expect(clampHitPoints(-3, 7)).toBe(0);
    expect(clampHitPoints(9, 7)).toBe(7);
    expect(clampHitPoints(4.6, 7)).toBe(5);
    expect(clampHitPoints(40, null)).toBe(40);
  });

  it('caps hit points and temp hit points at 100,000', () => {
    expect(clampHitPoints(1e20, null)).toBe(100_000);
    expect(clampHitPoints(500_000, 1_000_000)).toBe(100_000);
    expect(clampTempHitPoints(1e20)).toBe(100_000);
    expect(clampTempHitPoints(-4)).toBe(0);
  });

  it('damage consumes temp hit points first', () => {
    expect(applyDamage(7, 3, 5, 7)).toEqual({ hitPoints: 5, tempHitPoints: 0 });
    expect(applyDamage(7, 3, 2, 7)).toEqual({ hitPoints: 7, tempHitPoints: 1 });
  });

  it('damage cannot go below zero', () => {
    expect(applyDamage(4, 0, 20, 7)).toEqual({ hitPoints: 0, tempHitPoints: 0 });
  });

  it('healing clamps to max', () => {
    expect(applyHealing(5, 10, 7)).toBe(7);
    expect(applyHealing(5, 1, null)).toBe(6);
  });

  it('fraction is null without a max and clamped otherwise', () => {
    expect(hpFraction(3, null)).toBeNull();
    expect(hpFraction(3, 0)).toBeNull();
    expect(hpFraction(9, 6)).toBe(1);
    expect(hpFraction(3, 6)).toBe(0.5);
  });
});
