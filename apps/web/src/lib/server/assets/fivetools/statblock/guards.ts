export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export const asString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

export const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

export const stringsOf = (value: unknown): string[] =>
  asArray(value).filter((item): item is string => typeof item === 'string');

export const recordsOf = (value: unknown): Record<string, unknown>[] => asArray(value).filter(isRecord);

export const lookup = <T>(record: Record<string, T>, key: string): T | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined;
