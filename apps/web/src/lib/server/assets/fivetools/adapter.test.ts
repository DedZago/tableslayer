import { describe, expect, it } from 'vitest';
import { fiveToolsTokenName, MAX_UPLOAD_PREVIEW_RECORDS, previewFiveToolsJson } from './adapter';
import fixture from './upstream-fixture.json';

const base = 'https://5e.tools/img/';
const preview = (monster: unknown[], monsterFluff: unknown[] = []) =>
  previewFiveToolsJson(JSON.stringify({ monster, monsterFluff }), base);

describe('5etools artwork adapter', () => {
  it('normalizes stored upstream metadata without importing statblocks', () => {
    const records = previewFiveToolsJson(JSON.stringify(fixture), base);
    expect(records).toHaveLength(4);
    expect(records[0]).toMatchObject({
      name: 'Goblin',
      source: 'MM',
      tokenUrl: `${base}bestiary/tokens/MM/Goblin.webp`,
      artworkUrl: `${base}bestiary/MM/Goblin.webp`,
      warnings: []
    });
    expect(records[0]).not.toHaveProperty('note');
  });
  it('matches upstream punctuation and Unicode normalization', () => {
    expect(fiveToolsTokenName('Æther "Élite"')).toBe('AEther Elite');
    expect(preview([{ name: 'Æther "Élite"', source: 'HB', hasToken: true }])[0].tokenUrl).toBe(
      `${base}bestiary/tokens/HB/AEther%20Elite.webp`
    );
  });
  it('uses explicit token precedence before implicit source/name', () => {
    const record = {
      name: 'Wolf',
      source: 'MM',
      hasToken: true,
      tokenUrl: 'https://example.com/a.png',
      token: { name: 'Goblin', source: 'MM' },
      tokenHref: { type: 'external', url: 'https://example.com/b.png' }
    };
    expect(preview([record])[0].tokenUrl).toBe(record.tokenUrl);
    const { tokenUrl, ...withoutUrl } = record;
    expect(preview([withoutUrl])[0].tokenUrl).toBe(`${base}bestiary/tokens/MM/Goblin.webp`);
    const { token, ...withoutToken } = withoutUrl;
    expect(preview([withoutToken])[0].tokenUrl).toBe('https://example.com/b.png');
  });
  it('resolves available artwork references while preserving variant identity', () => {
    const records = preview([
      { name: 'Wolf', source: 'MM', token: { name: 'Wolf', source: 'MM' } },
      { name: 'Renamed wolf', source: 'HB', _copy: { name: 'Wolf', source: 'MM' }, hp: { average: 99 } }
    ]);
    expect(records[1].tokenUrl).toBe(records[0].tokenUrl);
    expect(records[1].identity).not.toBe(records[0].identity);
    expect(records[1]).not.toHaveProperty('hp');
  });
  it('reports unavailable references and cycles without hanging', () => {
    expect(
      preview([{ name: 'Variant', source: 'HB', _copy: { name: 'Missing', source: 'MM' } }])[0].warnings.join(' ')
    ).toContain('Missing base');
    const records = preview([
      { name: 'A', source: 'HB', _copy: { name: 'B', source: 'HB' } },
      { name: 'B', source: 'HB', _copy: { name: 'A', source: 'HB' } }
    ]);
    expect(records.every((record) => record.warnings.some((warning) => warning.includes('cycle')))).toBe(true);
  });
  it('resolves fluff references and leaves missing images as placeholders', () => {
    const records = preview(
      [
        { name: 'A', source: 'MM' },
        { name: 'B', source: 'MM' }
      ],
      [
        { name: 'A', source: 'MM', images: [{ href: { type: 'internal', path: 'bestiary/MM/A.webp' } }] },
        { name: 'B', source: 'MM', _copy: { name: 'A', source: 'MM' } }
      ]
    );
    expect(records[1].artworkUrl).toBe(records[0].artworkUrl);
    expect(preview([{ name: 'No image', source: 'HB' }])[0]).toMatchObject({ tokenUrl: null, artworkUrl: null });
  });
  it('rejects malformed documents and reports unsafe internal paths', () => {
    expect(() => previewFiveToolsJson('{}', base)).toThrow('monster array');
    expect(() => preview([{ name: '', source: 'MM' }])).toThrow();
    expect(
      preview([{ name: 'A', source: 'MM', tokenHref: { type: 'internal', path: '../secret' } }])[0].warnings.join(' ')
    ).toContain('Unsupported internal');
  });
});

it('resolves inline fluff dependencies and reports unsupported artwork transformations', () => {
  const records = preview(
    [{ name: 'Variant', source: 'HB', fluff: { _monsterFluff: { name: 'Wolf', source: 'MM' } } }],
    [{ name: 'Wolf', source: 'MM', images: [{ href: { type: 'internal', path: 'bestiary/MM/Wolf.webp' } }] }]
  );
  expect(records[0].artworkUrl).toBe(`${base}bestiary/MM/Wolf.webp`);
  const missing = preview([
    { name: 'Variant', source: 'HB', fluff: { _monsterFluff: { name: 'Missing', source: 'MM' } } }
  ]);
  expect(missing[0].warnings.join(' ')).toContain('Missing fluff base');
  const unsupported = preview([
    { name: 'Variant', source: 'HB', _copy: { name: 'Wolf', source: 'MM', _mod: { token: { mode: 'setProp' } } } },
    { name: 'Wolf', source: 'MM', hasToken: true }
  ]);
  expect(unsupported[0].warnings.join(' ')).toContain('Unsupported artwork inheritance');
});

it('accepts explicit absent portrait arrays in upstream fluff', () => {
  expect(
    preview([{ name: 'Wolf', source: 'MM' }], [{ name: 'Wolf', source: 'MM', images: null }])[0].artworkUrl
  ).toBeNull();
});

describe('uploaded bestiary limits', () => {
  it('refuses files with too many creatures', () => {
    const monsters = Array.from({ length: MAX_UPLOAD_PREVIEW_RECORDS + 1 }, (_, index) => ({
      name: `Goblin ${index}`,
      source: 'HB'
    }));
    expect(() => preview(monsters)).toThrow(/at most 2000/);
  });

  it('refuses files whose copies expand into too much stat block data', () => {
    const longText = 'x'.repeat(1900);
    const base = {
      name: 'Base',
      source: 'HB',
      trait: Array.from({ length: 30 }, (_, index) => ({ name: `Trait ${index}`, entries: [longText] }))
    };
    const copies = Array.from({ length: 1999 }, (_, index) => ({
      name: `Copy ${index}`,
      source: 'HB',
      _copy: { name: 'Base', source: 'HB' }
    }));
    expect(() => preview([base, ...copies])).toThrow(/too large to preview/);
  });

  it('treats uploaded replaceTxt patterns as literal text', () => {
    const records = preview([
      { name: 'Base', source: 'HB', action: [{ name: 'Bite', entries: ['Bites (a+)+ hard.'] }] },
      {
        name: 'Copy',
        source: 'HB',
        _copy: { name: 'Base', source: 'HB', _mod: { action: { mode: 'replaceTxt', replace: '(a+)+', with: 'very' } } }
      }
    ]);
    const copy = records.find((record) => record.name === 'Copy');
    expect(copy?.statBlock?.actions[0].body[0]).toEqual([{ kind: 'text', text: 'Bites very hard.' }]);
  });
});
