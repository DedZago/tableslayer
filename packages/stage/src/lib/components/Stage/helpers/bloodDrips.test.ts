import { describe, expect, it } from 'vitest';
import {
  advanceDrip,
  createDripState,
  DRIP_LIMITS,
  dripShape,
  settleDrip,
  stepDrip,
  type DripSpec
} from './bloodDrips';

const spec: DripSpec = { x: 0, y: 0.44, width: 0.04, maxLength: 0.22, seed: 12345 };

const run = (seconds: number, onStep?: (state: ReturnType<typeof createDripState>) => void) => {
  const state = createDripState(spec);
  for (let t = 0; t < seconds; t += 1 / 60) {
    advanceDrip(state, spec, 1 / 60);
    onStep?.(state);
  }
  return state;
};

describe('blood drips', () => {
  it('runs down from the rim and slows as it wets the surface', () => {
    const lengths: number[] = [];
    run(8, (state) => lengths.push(state.length));
    const speedEarly = lengths[150] - lengths[120];
    const speedLate = lengths[450] - lengths[420];
    expect(lengths.at(-1)!).toBeGreaterThan(spec.maxLength * 0.5);
    expect(speedLate).toBeLessThan(speedEarly);
  });

  it('never runs past its length limit and never shrinks', () => {
    let previous = 0;
    run(120, (state) => {
      expect(state.length).toBeLessThanOrEqual(spec.maxLength + 1e-6);
      expect(state.length).toBeGreaterThanOrEqual(previous);
      previous = state.length;
    });
  });

  it('pinches off drops that fall faster and faster and then vanish', () => {
    const state = createDripState(spec);
    const speeds: number[] = [];
    let sawDrop = false;
    for (let t = 0; t < 120; t += 1 / 60) {
      stepDrip(state, spec, 1 / 60);
      if (state.dropMass > 0) {
        sawDrop = true;
        speeds.push(state.dropSpeed);
        expect(state.dropOffset).toBeLessThanOrEqual(DRIP_LIMITS.DROP_FADE_DISTANCE + 0.05);
      }
    }
    expect(sawDrop).toBe(true);
    expect(speeds[5]).toBeGreaterThan(speeds[0]);
  });

  it('keeps the head below the detach mass after a drop falls', () => {
    run(120, (state) => {
      if (state.dropMass > 0) expect(state.headMass).toBeLessThanOrEqual(DRIP_LIMITS.DETACH_MASS);
    });
  });

  it('caps a long frame gap instead of jumping ahead', () => {
    const state = createDripState(spec);
    advanceDrip(state, spec, 30);
    expect(state.length).toBeLessThan(0.05);
  });

  it('is deterministic for a seed', () => {
    expect(run(20)).toEqual(run(20));
  });

  it('settles to a still pose with nothing in flight', () => {
    const state = createDripState(spec);
    settleDrip(state, spec, 40);
    const shape = dripShape(state, spec);
    expect(shape.length).toBeGreaterThan(spec.maxLength * 0.5);
    expect(shape.surgeRadius).toBe(0);
    expect(shape.dropRadius).toBe(0);
  });
});
