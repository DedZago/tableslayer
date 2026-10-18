// Matches the token clipboard schema; also keeps values far inside the DB integer range
export const MAX_HIT_POINTS = 100_000;

export const clampHitPoints = (value: number, max: number | null): number =>
  Math.min(Math.max(Math.round(value), 0), max ?? MAX_HIT_POINTS, MAX_HIT_POINTS);

export const clampTempHitPoints = (value: number): number => clampHitPoints(value, null);

export const applyDamage = (
  current: number,
  temp: number,
  amount: number,
  max: number | null
): { hitPoints: number; tempHitPoints: number } => {
  const absorbed = Math.min(temp, amount);
  return {
    hitPoints: clampHitPoints(current - (amount - absorbed), max),
    tempHitPoints: clampTempHitPoints(temp - absorbed)
  };
};

export const applyHealing = (current: number, amount: number, max: number | null): number =>
  clampHitPoints(current + amount, max);

export const hpFraction = (current: number, max: number | null): number | null =>
  max ? Math.min(Math.max(current / max, 0), 1) : null;
