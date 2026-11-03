/**
 * The last angle a radial menu was turned to, kept per device. Menus open upright until someone turns one,
 * then every menu on that screen opens at the last angle used.
 */
export class RadialMenuRotation {
  #key: string;
  value = $state<number | undefined>(undefined);

  constructor(key: string) {
    this.#key = key;
    try {
      const stored = parseFloat(localStorage.getItem(key) ?? '');
      this.value = Number.isFinite(stored) ? stored : undefined;
    } catch {
      this.value = undefined;
    }
  }

  save = (rotation: number) => {
    this.value = rotation;
    try {
      localStorage.setItem(this.#key, String(rotation));
    } catch {
      // storage unavailable: the angle lasts for this session only
    }
  };
}
