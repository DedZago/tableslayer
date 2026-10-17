import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FiveToolsCatalogResult } from './types';

const mocks = vi.hoisted(() => ({ storage: new Map<string, Buffer>(), download: vi.fn(), duplicates: vi.fn() }));
vi.mock('$lib/server/file/files', () => ({
  readCatalogCache: async (key: string) => mocks.storage.get(key) ?? null,
  writeCatalogCache: async (key: string, data: Buffer) => mocks.storage.set(key, data)
}));
vi.mock('./download', () => ({ downloadFiveToolsResource: mocks.download }));
vi.mock('./import', () => ({
  fiveToolsImageBase: () => 'https://example.com/images/',
  fiveToolsDuplicates: mocks.duplicates
}));
const base = 'https://example.com/bestiary/';
let resources: Record<string, unknown>;
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.storage.clear();
  vi.stubEnv('FIVETOOLS_CATALOG_BASE_URL', base);
  resources = {
    'index.json': { MM: 'bestiary-mm.json', HB: 'bestiary-hb.json' },
    'fluff-index.json': { MM: 'fluff-bestiary-mm.json' },
    'bestiary-mm.json': { monster: [{ name: 'Wolf', source: 'MM', token: { name: 'Wolf', source: 'MM' } }] },
    'bestiary-hb.json': { monster: [{ name: 'Other wolf', source: 'HB', _copy: { name: 'Wolf', source: 'MM' } }] },
    'fluff-bestiary-mm.json': {
      monsterFluff: [{ name: 'Wolf', source: 'MM', images: [{ href: { type: 'internal', path: 'wolf.webp' } }] }]
    }
  };
  mocks.download.mockImplementation(async (url: string) => {
    const filename = url.slice(base.length);
    if (!(filename in resources)) throw new Error('Missing resource');
    return { data: Buffer.from(JSON.stringify(resources[filename])), contentType: 'application/json', sourceUrl: url };
  });
  mocks.duplicates.mockImplementation(async (_owner: string, records: unknown[]) => records);
});
afterEach(() => vi.unstubAllEnvs());
const ready = async (search = '', source = '', offset = 0): Promise<FiveToolsCatalogResult> => {
  const { searchFiveToolsCatalog } = await import('./catalog');
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await searchFiveToolsCatalog('owner', search, source, offset);
    if (result.status.state !== 'loading') return result;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error('Catalog did not finish');
};

describe('persisted all-source catalog', () => {
  it('searches all sources and resolves cross-source dependencies and portraits', async () => {
    const result = await ready('wolf');
    expect(result.status.state).toBe('ready');
    expect(result.sources).toEqual(['HB', 'MM']);
    expect(result.records).toHaveLength(2);
    expect(result.records[0].tokenUrl).toBe(result.records[1].tokenUrl);
    expect(result.records.find((record) => record.source === 'MM')?.artworkUrl).toBe(
      'https://example.com/images/wolf.webp'
    );
    expect(result.status.completed).toBe(3);
  });
  it('never redownloads sources for keystrokes, source filters or pagination', async () => {
    await ready('wolf');
    const count = mocks.download.mock.calls.length;
    expect((await ready('other')).records).toHaveLength(1);
    expect((await ready('wolf', 'MM')).records).toHaveLength(1);
    await ready('', '', 100);
    expect(mocks.download).toHaveBeenCalledTimes(count);
    expect(mocks.duplicates).toHaveBeenCalledWith('owner', expect.any(Array));
  });
  it('rebuilds from persisted cache after process restart without upstream access', async () => {
    await ready();
    const count = mocks.download.mock.calls.length;
    vi.resetModules();
    mocks.download.mockRejectedValue(new Error('Offline'));
    expect((await ready('wolf')).records).toHaveLength(2);
    expect(mocks.download).toHaveBeenCalledTimes(count);
  });
  it('retains downloaded revisions and their URL provenance on manual refresh', async () => {
    await ready();
    const oldKeys = [...mocks.storage.keys()];
    resources['bestiary-mm.json'] = { monster: [{ name: 'New wolf', source: 'MM' }] };
    const { refreshFiveToolsCatalog } = await import('./catalog');
    refreshFiveToolsCatalog();
    expect((await ready('New wolf')).records).toHaveLength(1);
    expect(oldKeys.every((key) => mocks.storage.has(key))).toBe(true);
    expect(mocks.storage.size).toBeGreaterThan(oldKeys.length);
    expect(
      [...mocks.storage.values()].some((data) =>
        data.toString().includes('"sourceUrl":"https://example.com/bestiary/bestiary-mm.json"')
      )
    ).toBe(true);
  });
  it('reports partial source failures while keeping successfully loaded names usable', async () => {
    delete resources['bestiary-hb.json'];
    const result = await ready();
    expect(result.status.state).toBe('ready');
    expect(result.records).toHaveLength(1);
    expect(result.status.warnings.join(' ')).toContain('bestiary-hb.json');
  });
  it('rejects index filenames that escape the configured directory', async () => {
    resources['index.json'] = { MM: '../private.json' };
    const result = await ready();
    expect(result.status.state).toBe('error');
    expect(mocks.download).toHaveBeenCalledTimes(1);
  });
  it('returns a bounded result page while preserving total match count', async () => {
    resources['bestiary-mm.json'] = {
      monster: Array.from({ length: 105 }, (_, index) => ({
        name: `Creature ${String(index).padStart(3, '0')}`,
        source: 'MM'
      }))
    };
    expect((await ready('Creature')).records).toHaveLength(100);
    const second = await ready('Creature', '', 100);
    expect(second.records).toHaveLength(5);
    expect(second.totalMatches).toBe(105);
  });
  it('limits concurrent downloads and shares the initial load across clients', async () => {
    resources['index.json'] = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [`S${index}`, `bestiary-source-${index}.json`])
    );
    for (let index = 0; index < 12; index++)
      resources[`bestiary-source-${index}.json`] = { monster: [{ name: `Creature ${index}`, source: `S${index}` }] };
    let active = 0;
    let maximum = 0;
    mocks.download.mockImplementation(async (url: string) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return { data: Buffer.from(JSON.stringify(resources[url.slice(base.length)])), sourceUrl: url };
    });
    await Promise.all([ready(), ready(), ready()]);
    expect(maximum).toBeLessThanOrEqual(4);
    expect(mocks.download).toHaveBeenCalledTimes(15);
  });
});
