import { createClient } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMediaInventory, createMediaInventory } from '../../scripts/media-cleanup.mjs';

let database;
let storage;
const now = Date.now();
const object = (key) => ({ key, bytes: 10, modifiedAt: now - 48 * 60 * 60 * 1000, version: key });
beforeEach(async () => {
  database = createClient({ url: 'file::memory:' });
  await database.executeMultiple(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE files (id INTEGER PRIMARY KEY, location TEXT UNIQUE);
    CREATE TABLE user_files (user_id TEXT, file_id INTEGER REFERENCES files(id) ON DELETE CASCADE);
    CREATE TABLE clipboard_artwork (location TEXT PRIMARY KEY, created_at INTEGER);
    CREATE TABLE asset (artwork_location TEXT, token_artwork_location TEXT);
    CREATE TABLE marker (image_location TEXT);
    CREATE TABLE party (active_handout TEXT, avatar_file_id INTEGER REFERENCES files(id) ON DELETE CASCADE);
    CREATE TABLE scene (map_location TEXT, notes TEXT);
    INSERT INTO files VALUES (1, 'originals/unused.png'), (2, 'originals/legacy.png'), (3, 'originals/avatar.png');
    INSERT INTO user_files VALUES ('owner', 1);
    INSERT INTO clipboard_artwork VALUES ('originals/legacy.png', 1), ('originals/copied.png', 1);
    INSERT INTO party VALUES ('{"artworkLocation":"originals/handout.png"}', 3);
    INSERT INTO asset VALUES ('originals/portrait.png', 'originals/token.png');
    INSERT INTO marker VALUES ('originals/marker.png');
    INSERT INTO scene VALUES ('uploads/referenced.png', '![image](/assets/originals/note.png)');
  `);
  storage = {
    list: vi
      .fn()
      .mockResolvedValue([
        ...['unused', 'legacy', 'avatar', 'copied', 'handout', 'portrait', 'token', 'marker', 'note', 'unknown'].map(
          (name) => object(`originals/${name}.png`)
        ),
        object('uploads/abandoned.png'),
        object('uploads/referenced.png'),
        object('catalog/cache.json'),
        { ...object('uploads/recent.png'), modifiedAt: now }
      ]),
    remove: vi.fn()
  };
});
afterEach(() => database.close());
const inventory = () => createMediaInventory({ database, storage, binding: 'deployment', now });
const apply = (plan) => applyMediaInventory({ database, storage, binding: 'deployment', plan, now });

describe('operator-reviewed media cleanup', () => {
  it('protects references, permanent grants, legacy, unknown originals and recent uploads', async () => {
    const plan = await inventory();
    expect(plan.items.filter((item) => item.classification === 'candidate').map((item) => item.key)).toEqual([
      'originals/unused.png',
      'uploads/abandoned.png'
    ]);
    expect(plan.items.find((item) => item.key === 'uploads/referenced.png').reasons).toContain('scene.map_location');
    expect(plan.items.find((item) => item.key === 'originals/avatar.png').reasons).toContain('party.avatar_file_id');
    expect(plan.items.find((item) => item.key === 'originals/note.png').reasons).toContain('scene.notes');
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('removes only explicitly selected candidates and clears their file metadata', async () => {
    const plan = await inventory();
    plan.items.find((item) => item.key === 'originals/unused.png').delete = true;
    expect(await apply(plan)).toBe(1);
    expect(storage.remove).toHaveBeenCalledExactlyOnceWith('originals/unused.png', 'originals/unused.png');
    expect((await database.execute('SELECT * FROM files WHERE id = 1')).rows).toHaveLength(0);
    expect((await database.execute('SELECT * FROM user_files')).rows).toHaveLength(0);
  });

  it('rejects newly referenced candidates before removing any selected object', async () => {
    const plan = await inventory();
    for (const item of plan.items) item.delete = item.classification === 'candidate';
    await database.execute("INSERT INTO marker VALUES ('uploads/abandoned.png')");
    await expect(apply(plan)).rejects.toThrow('protected');
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('rejects candidates protected by a new clipboard grant', async () => {
    const plan = await inventory();
    plan.items.find((item) => item.key === 'originals/unused.png').delete = true;
    await database.execute("INSERT INTO clipboard_artwork VALUES ('originals/unused.png', 1)");
    await expect(apply(plan)).rejects.toThrow('protected');
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('rejects changed objects, protected selections and another deployment', async () => {
    const plan = await inventory();
    plan.items.find((item) => item.key === 'uploads/abandoned.png').delete = true;
    storage.list.mockResolvedValue([{ ...object('uploads/abandoned.png'), version: 'changed' }]);
    await expect(apply(plan)).rejects.toThrow('changed');
    plan.binding = 'other';
    await expect(apply(plan)).rejects.toThrow('does not belong');
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('keeps file metadata if object deletion fails', async () => {
    const plan = await inventory();
    plan.items.find((item) => item.key === 'originals/unused.png').delete = true;
    storage.remove.mockRejectedValue(new Error('Storage failure'));
    await expect(apply(plan)).rejects.toThrow('Storage failure');
    expect((await database.execute('SELECT * FROM files WHERE id = 1')).rows).toHaveLength(1);
  });
});
