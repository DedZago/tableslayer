import type { MarkerRow } from '$lib/realtime';
import { mapToDisplaySpace } from '@tableslayer/stage';
import { describe, expect, it, vi } from 'vitest';
import {
  createTokenClipboard,
  parseTokenClipboard,
  serializeTokenClipboard,
  TOKEN_CLIPBOARD_LIMIT,
  tokenPastePositions,
  type ClipboardGeometry
} from './tokenClipboard';

const source: ClipboardGeometry = { cell: 50, displayScale: 0.5, rotation: 0, mapDefined: true };
const grant = { deploymentId: 'test-deployment', mediaGrant: 'signed-media-grant' };
const marker = (id: string, x: number, y = 0): MarkerRow => ({
  id,
  sceneId: 'source',
  assetId: null,
  positionX: x,
  positionY: y,
  title: 'Lupo à',
  label: 'A1',
  imageLocation: 'originals/wolf.png',
  imageScale: 1.5,
  shape: 1,
  shapeColor: '#ffffff',
  size: 2,
  visibility: 1,
  pinnedTooltip: true,
  note: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Private note' }] }] }
});
const group = () => createTokenClipboard([marker('a', -50), marker('b', 50)], source, grant);
const identity = (point: { x: number; y: number }) => point;

describe('portable token clipboard', () => {
  it('contains independent snapshots and excludes source IDs, scene IDs and pinned state', () => {
    const original = marker('a', 5);
    const copied = createTokenClipboard([original], source, grant);
    expect(copied.tokens[0]).toMatchObject({ title: 'Lupo à', imageScale: 1.5, size: 2 });
    expect(copied.tokens[0]).not.toHaveProperty('id');
    expect(copied.tokens[0]).not.toHaveProperty('sceneId');
    expect(copied.tokens[0]).not.toHaveProperty('pinnedTooltip');
    (original.note as { content: unknown[] }).content.length = 0;
    expect((copied.tokens[0].note as { content: unknown[] }).content).toHaveLength(1);
    expect(parseTokenClipboard(serializeTokenClipboard(copied))).toEqual(copied);
  });

  it('copies reactive note proxies as independent JSON', () => {
    const original = marker('a', 0);
    original.note = new Proxy(original.note as object, {});
    expect(createTokenClipboard([original], source, grant).tokens[0].note).toEqual(original.note);
  });

  it('scales map-local grid offsets and aligns the rendered group with a rotated destination map', () => {
    const positions = tokenPastePositions(
      group(),
      { ...source, cell: 100, rotation: 90 },
      { x: 10, y: 20 },
      identity,
      0
    );
    expect(positions).toEqual([
      { x: -90, y: 20 },
      { x: 110, y: 20 }
    ]);
    const rendered = positions.map((point) =>
      mapToDisplaySpace(point, { rotation: 90, zoom: 2, offset: { x: 0, y: 0 } })
    );
    expect(rendered[1].x - rendered[0].x).toBeCloseTo(0);
    expect(rendered[1].y - rendered[0].y).toBeCloseTo(400);
  });

  it('converts fill-space source rotation to map axes and rotates into a fill-space destination', () => {
    const copied = createTokenClipboard(
      [marker('a', 0, -50), marker('b', 0, 50)],
      { ...source, mapDefined: false, rotation: 90 },
      grant
    );
    const positions = tokenPastePositions(
      copied,
      { ...source, mapDefined: false, cell: 100, rotation: 180 },
      { x: 0, y: 0 },
      identity,
      0
    );
    expect(positions[0].x).toBeCloseTo(100);
    expect(positions[1].x).toBeCloseTo(-100);
    expect(positions[0].y).toBeCloseTo(0);
  });

  it('uses unrotated display-pixel fallback if either grid is unusable, retaining map alignment', () => {
    const copied = createTokenClipboard([marker('a', -50), marker('b', 50)], { ...source, cell: null }, grant);
    const positions = tokenPastePositions(
      copied,
      { ...source, mapDefined: false, displayScale: 1, cell: 100, rotation: 90 },
      { x: 0, y: 0 },
      identity,
      0
    );
    expect(positions[0].y).toBeCloseTo(-25);
    expect(positions[1].y).toBeCloseTo(25);
    const noDestinationGrid = tokenPastePositions(
      group(),
      { ...source, cell: null, displayScale: 2 },
      { x: 0, y: 0 },
      identity,
      0
    );
    expect(noDestinationGrid).toEqual([
      { x: -12.5, y: 0 },
      { x: 12.5, y: 0 }
    ]);
  });

  it('snaps only the group anchor and offsets repeated pastes by destination grid cells', () => {
    const snap = vi.fn((point: { x: number; y: number }) => ({
      x: Math.round(point.x / 60) * 60,
      y: Math.round(point.y / 60) * 60
    }));
    const positions = tokenPastePositions(group(), { ...source, cell: 60 }, { x: 13, y: 27 }, snap, 2);
    expect(snap).toHaveBeenCalledTimes(1);
    expect(positions).toEqual([
      { x: 60, y: -120 },
      { x: 180, y: -120 }
    ]);
  });

  it('uses a 40-display-pixel repeated-paste step when the destination has no grid', () => {
    const first = tokenPastePositions(group(), { ...source, cell: null, displayScale: 2 }, { x: 0, y: 0 }, identity, 0);
    const repeated = tokenPastePositions(
      group(),
      { ...source, cell: null, displayScale: 2 },
      { x: 0, y: 0 },
      identity,
      1
    );
    expect(repeated[0].x - first[0].x).toBe(20);
    expect(repeated[0].y - first[0].y).toBe(-20);
  });

  it('rejects unsupported versions, injected source fields, empty groups and oversized text', () => {
    const clipboard = group();
    expect(() => parseTokenClipboard(JSON.stringify({ ...clipboard, version: 2 }))).toThrow();
    expect(() =>
      parseTokenClipboard(JSON.stringify({ ...clipboard, tokens: [{ ...clipboard.tokens[0], sceneId: 'foreign' }] }))
    ).toThrow();
    expect(() => parseTokenClipboard(JSON.stringify({ ...clipboard, tokens: [] }))).toThrow();
    expect(() => parseTokenClipboard('x'.repeat(TOKEN_CLIPBOARD_LIMIT + 1))).toThrow('size limit');
  });

  it('rejects excessively nested notes without recursively walking untrusted objects', () => {
    const clipboard = group();
    let note: object = { type: 'doc' };
    for (let depth = 0; depth < 40; depth++) note = { type: 'doc', content: [note] };
    clipboard.tokens[0].note = note;
    expect(() => serializeTokenClipboard(clipboard)).toThrow();
  });
});
