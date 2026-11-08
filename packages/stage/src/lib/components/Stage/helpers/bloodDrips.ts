// A tiny, THREE-free physics model for blood running down from a bloodied token's rim.
// Lengths are token units (y down = screen down), time is seconds, mass is relative to the
// amount a drip's head holds before gravity beats surface tension (PIN_MASS).
//
// - The rim releases pulses of blood at random intervals; each pulse rolls down the already
//   wet trail as a bead and joins the head.
// - The head is overdamped (viscous): it creeps at a speed proportional to its excess mass and
//   leaves part of that mass behind as it wets new surface, so it slows down and stops.
// - Near its length limit the head stalls and keeps filling until it pinches off a drop that
//   falls with gravity and fades out.

export type DripSpec = {
  x: number;
  y: number;
  width: number;
  maxLength: number;
  seed: number;
};

export type DripState = {
  length: number;
  headMass: number;
  surgePosition: number;
  surgeMass: number;
  dropOffset: number;
  dropSpeed: number;
  dropMass: number;
  nextPulseIn: number;
  random: number;
};

const PIN_MASS = 1;
const DETACH_MASS = 1.6;
const KEPT_AFTER_DETACH = 1.05;
const MOBILITY = 0.12;
const DEPOSIT_PER_LENGTH = 4.5;
const ABSORB_RATE = 0.05;
const SURGE_SPEED = 0.25;
const SURGE_SPEED_PER_MASS = 0.35;
const GRAVITY = 1.3;
const DROP_FADE_DISTANCE = 0.24;
const START_LENGTH = 0.012;
const MAX_STEP = 1 / 30;
const MAX_FRAME_DT = 0.1;

const nextRandom = (state: DripState) => {
  state.random = (Math.imul(state.random ^ (state.random >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
  return state.random / 4294967296;
};

export const createDripState = (spec: DripSpec): DripState => ({
  length: START_LENGTH,
  headMass: 0.6,
  surgePosition: 0,
  surgeMass: 0,
  dropOffset: 0,
  dropSpeed: 0,
  dropMass: 0,
  // Drips start one after another rather than all at once
  nextPulseIn: ((spec.seed % 1000) / 1000) * 1.6,
  random: (spec.seed * 2654435761) >>> 0
});

const releasePulse = (state: DripState, isFirst: boolean) => {
  // The first pulse carries enough blood to run most of the way down
  const mass = isFirst ? 1.4 + nextRandom(state) * 0.8 : 0.25 + nextRandom(state) * 0.4;
  if (state.surgeMass <= 0) state.surgePosition = 0;
  state.surgeMass += mass;
  state.nextPulseIn = 1.2 + nextRandom(state) * 2.3;
};

const stepSurge = (state: DripState, dt: number) => {
  if (state.surgeMass <= 0) return;
  state.surgePosition += (SURGE_SPEED + SURGE_SPEED_PER_MASS * state.surgeMass) * dt;
  if (state.surgePosition < state.length) return;
  state.headMass += state.surgeMass;
  state.surgeMass = 0;
  state.surgePosition = 0;
};

const stepHead = (state: DripState, spec: DripSpec, dt: number) => {
  const excess = Math.max(0, state.headMass - PIN_MASS);
  // Stalls smoothly over the last fifth of its reach
  const room = Math.min(1, Math.max(0, (spec.maxLength - state.length) / (spec.maxLength * 0.2)));
  const advance = MOBILITY * excess * room * dt;
  state.length += advance;
  state.headMass -= advance * DEPOSIT_PER_LENGTH;
  // The surface slowly soaks up a resting head, so it does not stay swollen forever
  state.headMass -= ABSORB_RATE * Math.max(0, state.headMass - PIN_MASS * 0.85) * dt;
  // A moving head runs on instead; only a stalled one fills up until it pinches off
  if (state.headMass > DETACH_MASS && room < 0.35 && state.dropMass <= 0) {
    state.dropMass = state.headMass - KEPT_AFTER_DETACH;
    state.headMass = KEPT_AFTER_DETACH;
    state.dropOffset = 0;
    state.dropSpeed = 0.05;
  }
};

const stepDrop = (state: DripState, dt: number) => {
  if (state.dropMass <= 0) return;
  state.dropSpeed += GRAVITY * dt;
  state.dropOffset += state.dropSpeed * dt;
  if (state.dropOffset > DROP_FADE_DISTANCE) state.dropMass = 0;
};

export const stepDrip = (state: DripState, spec: DripSpec, dt: number) => {
  const isFirst = state.length <= START_LENGTH && state.surgeMass <= 0 && state.headMass < PIN_MASS;
  state.nextPulseIn -= dt;
  if (state.nextPulseIn <= 0) releasePulse(state, isFirst);
  stepSurge(state, dt);
  stepHead(state, spec, dt);
  stepDrop(state, dt);
};

/** Advances by a frame's elapsed time in small fixed steps; long gaps (tab hidden, culled) are capped */
export const advanceDrip = (state: DripState, spec: DripSpec, frameDt: number) => {
  let remaining = Math.min(Math.max(frameDt, 0), MAX_FRAME_DT);
  while (remaining > 0) {
    const dt = Math.min(remaining, MAX_STEP);
    stepDrip(state, spec, dt);
    remaining -= dt;
  }
};

/** Runs the model forward in one go, e.g. to show a settled pose without motion */
export const settleDrip = (state: DripState, spec: DripSpec, seconds: number) => {
  for (let elapsed = 0; elapsed < seconds; elapsed += MAX_STEP) stepDrip(state, spec, MAX_STEP);
  state.surgeMass = 0;
  state.dropMass = 0;
};

/** How the shader should draw a drip: radii follow mass so heavier blobs swell */
export const dripShape = (state: DripState, spec: DripSpec) => {
  const w = spec.width;
  const fallen = Math.min(1, state.dropOffset / DROP_FADE_DISTANCE);
  const dropExit = fallen <= 0.6 ? 0 : ((fallen - 0.6) / 0.4) ** 2;
  return {
    length: state.length,
    headRadius: w * (0.38 + 0.32 * Math.sqrt(Math.max(state.headMass, 0))),
    surgePosition: state.surgePosition,
    surgeRadius: state.surgeMass > 0 ? w * (0.3 + 0.3 * Math.sqrt(state.surgeMass)) : 0,
    dropOffset: state.dropOffset,
    // Holds its full size and opacity for most of the fall, then shrinks and fades out together
    dropRadius: state.dropMass > 0 ? w * (0.42 + 0.35 * Math.sqrt(state.dropMass)) * (1 - 0.35 * dropExit) : 0,
    dropAlpha: state.dropMass > 0 ? 1 - dropExit : 0,
    dropStretch: Math.min(0.6, state.dropSpeed * 0.9)
  };
};

export const DRIP_LIMITS = { PIN_MASS, DETACH_MASS, DROP_FADE_DISTANCE };
