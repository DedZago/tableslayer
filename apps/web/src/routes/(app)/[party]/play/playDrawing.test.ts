import type { AnnotationRow } from '$lib/realtime';
import { AnnotationEffect, StageMode } from '@tableslayer/stage';
import { describe, expect, it } from 'vitest';
import { brushLabel, newPlayerLayer, playerDrawings, playerLayerFor } from './playDrawing';

const layer = (id: string, overrides: Partial<AnnotationRow> = {}): AnnotationRow => ({
  id,
  sceneId: 's1',
  name: id,
  opacity: 1,
  color: '#d73e2e',
  url: null,
  visibility: StageMode.Player,
  order: 0,
  effectType: null,
  playerDrawn: true,
  ...overrides
});

describe('playerDrawings', () => {
  it('keeps visible player layers only', () => {
    const rows = [layer('tv'), layer('gm', { playerDrawn: false }), layer('hidden', { visibility: StageMode.DM })];
    expect(playerDrawings(rows).map(({ id }) => id)).toEqual(['tv']);
  });

  it('treats rows from before the field existed as GM drawings', () => {
    const { playerDrawn: _, ...legacy } = layer('legacy');
    expect(playerDrawings([legacy])).toEqual([]);
  });
});

describe('playerLayerFor', () => {
  const rows = [
    layer('gm-red', { playerDrawn: false }),
    layer('red', { name: 'Renamed by the GM' }),
    layer('fire', { effectType: AnnotationEffect.Fire, color: '#ff4d1a' })
  ];

  it('reuses the player layer of the same color, even after a rename, and never a GM layer', () => {
    expect(playerLayerFor(rows, { kind: 'color', color: '#D73E2E' })?.id).toBe('red');
  });

  it('matches effects by effect, not color', () => {
    expect(playerLayerFor(rows, { kind: 'effect', effect: AnnotationEffect.Fire })?.id).toBe('fire');
    expect(playerLayerFor(rows, { kind: 'effect', effect: AnnotationEffect.Lava })).toBeUndefined();
  });

  it('skips a layer the GM hid, so the next stroke makes a visible one', () => {
    expect(playerLayerFor([layer('red', { visibility: StageMode.DM })], { kind: 'color', color: '#d73e2e' })).toBe(
      undefined
    );
  });
});

describe('newPlayerLayer', () => {
  it('names the layer after the brush and puts it on top', () => {
    const row = newPlayerLayer('n', 's1', [layer('a', { order: -2 })], {
      kind: 'effect',
      effect: AnnotationEffect.Lava
    });
    expect(row).toMatchObject({
      name: 'Player effect · Lava',
      effectType: AnnotationEffect.Lava,
      order: -3,
      playerDrawn: true,
      visibility: StageMode.Player
    });
    expect(newPlayerLayer('n', 's1', [], { kind: 'color', color: '#ffffff' }).name).toBe('Player drawing · White');
  });

  it('labels brushes', () => {
    expect(brushLabel({ kind: 'erase' })).toBe('Eraser');
  });
});
