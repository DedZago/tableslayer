import type { AtmosphereController } from '../atmosphereController.svelte';

/**
 * Uniform objects the map material, AtmosphereDarkness and AmbienceGround share per controller:
 * `quad` is 1 while the darkness quad is drawing (the map divides by the token lighting only then), and
 * `cell` is one grid cell as a fraction of the map height (written by MapLayer, which knows the grid).
 */
interface GroundShared {
  quad: { value: number };
  cell: { value: number };
}

const shared = new WeakMap<AtmosphereController, GroundShared>();

export const getGroundShared = (controller: AtmosphereController) => {
  let entry = shared.get(controller);
  if (!entry) {
    entry = { quad: { value: 0 }, cell: { value: 0.05 } };
    shared.set(controller, entry);
  }
  return entry;
};
