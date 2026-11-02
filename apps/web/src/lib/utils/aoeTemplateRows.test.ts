import { AoeEffect, AoeShape, StageMode, type AoeTemplate } from '@tableslayer/stage';
import { describe, expect, it } from 'vitest';
import { aoeFieldsFromPatch, aoeRowFromTemplate } from './aoeTemplateRows';

const template: AoeTemplate = {
  id: 't1',
  shape: AoeShape.Circle,
  position: { x: 10, y: 20 },
  angle: 0,
  size: 20,
  width: 5,
  effect: AoeEffect.Fire,
  color: '#ff0000',
  opacity: 1,
  visibility: StageMode.Player
};

describe('aoeRowFromTemplate', () => {
  it('stores the anchor and converts expiresAt from epoch ms to Unix seconds', () => {
    const row = aoeRowFromTemplate('s1', { ...template, anchorMarkerId: 'm1', expiresAt: 1_700_000_123_456 });
    expect(row.anchorMarkerId).toBe('m1');
    expect(row.expiresAt).toBe(1_700_000_123);
  });

  it('leaves anchor and expiry empty by default', () => {
    const row = aoeRowFromTemplate('s1', template);
    expect(row.anchorMarkerId).toBeNull();
    expect(row.expiresAt).toBeNull();
  });
});

describe('aoeFieldsFromPatch', () => {
  it('converts a patched expiresAt and keeps null as null', () => {
    expect(aoeFieldsFromPatch({ expiresAt: 5_000 }).expiresAt).toBe(5);
    expect(aoeFieldsFromPatch({ expiresAt: null }).expiresAt).toBeNull();
    expect(aoeFieldsFromPatch({ size: 10 })).not.toHaveProperty('expiresAt');
  });
});
