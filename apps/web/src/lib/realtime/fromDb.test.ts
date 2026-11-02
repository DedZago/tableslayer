import type { SelectAoeTemplate } from '$lib/db/app/schema';
import { describe, expect, it } from 'vitest';
import { aoeTemplateRowFromDb, aoeTemplateRowToDb } from './fromDb';

const dbRow: SelectAoeTemplate = {
  id: 't1',
  sceneId: 's1',
  shape: 'circle',
  positionX: 1,
  positionY: 2,
  angle: 0,
  size: 20,
  width: 5,
  effect: 1,
  color: '#ff6a00',
  opacity: 0.6,
  visibility: 1,
  label: 'Fireball',
  anchorMarkerId: null,
  groupId: null,
  spellId: 'fireball',
  expiresAt: new Date(1700000060 * 1000),
  createdAt: new Date(1700000000 * 1000)
};

describe('aoe template row conversion', () => {
  it('converts timestamps to Unix seconds and keeps the spell id', () => {
    expect(aoeTemplateRowFromDb(dbRow)).toMatchObject({
      spellId: 'fireball',
      expiresAt: 1700000060,
      createdAt: 1700000000
    });
  });

  it('maps a missing expiry to null in both directions', () => {
    expect(aoeTemplateRowFromDb({ ...dbRow, expiresAt: null }).expiresAt).toBeNull();
    const row = { ...aoeTemplateRowFromDb(dbRow), expiresAt: undefined, spellId: undefined };
    expect(aoeTemplateRowToDb(row)).toMatchObject({ expiresAt: null, spellId: null });
  });

  it('round trips every column', () => {
    expect(aoeTemplateRowToDb(aoeTemplateRowFromDb(dbRow))).toEqual(dbRow);
  });
});
