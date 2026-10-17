import { createHash } from 'node:crypto';

const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`;
const hash = (value) => createHash('sha256').update(value).digest('hex');

export const collectMediaReferences = async (database, objectKeys = []) => {
  const protectedLocations = new Set(
    (await database.execute('SELECT location FROM clipboard_artwork')).rows.map((row) => row.location)
  );
  const files = (await database.execute('SELECT id, location FROM files')).rows;
  const registered = new Map(files.map((row) => [row.location, row.id]));
  const locationsById = new Map(files.map((row) => [row.id, row.location]));
  const locations = new Set([...registered.keys(), ...objectKeys]);
  const references = new Map();
  const add = (location, reason) => {
    const reasons = references.get(location) ?? new Set();
    reasons.add(reason);
    references.set(location, reasons);
  };
  const tables = (await database.execute("SELECT name FROM sqlite_master WHERE type = 'table'")).rows;
  for (const { name } of tables) {
    if (['files', 'user_files', 'clipboard_artwork'].includes(name) || name.startsWith('sqlite_')) continue;
    const foreignKeys = (await database.execute(`PRAGMA foreign_key_list(${quote(name)})`)).rows;
    const fileColumns = foreignKeys.filter((key) => key.table === 'files').map((key) => key.from);
    const rows = (await database.execute(`SELECT * FROM ${quote(name)}`)).rows;
    for (const row of rows) {
      for (const column of fileColumns) {
        const location = locationsById.get(row[column]);
        if (location) add(location, `${name}.${column}`);
      }
      for (const [column, value] of Object.entries(row)) {
        if (typeof value !== 'string') continue;
        for (const location of locations) {
          if (
            value.includes(location) ||
            value.includes(location.split('/').map(encodeURIComponent).join('/')) ||
            value.includes(encodeURIComponent(location))
          )
            add(location, `${name}.${column}`);
        }
      }
    }
  }
  return { protectedLocations, registered, references };
};

export const createMediaInventory = async ({ database, storage, binding, now = Date.now() }) => {
  const objects = await storage.list();
  const { protectedLocations, registered, references } = await collectMediaReferences(
    database,
    objects.map((object) => object.key)
  );
  const items = objects.map((object) => {
    const reasons = [...(references.get(object.key) ?? [])];
    if (protectedLocations.has(object.key)) reasons.push('permanent clipboard or legacy protection');
    if (!object.key.startsWith('uploads/') && !object.key.startsWith('originals/')) reasons.push('retained namespace');
    if (object.key.startsWith('originals/') && !registered.has(object.key)) reasons.push('unregistered original');
    if (now - object.modifiedAt < 24 * 60 * 60 * 1000) reasons.push('less than 24 hours old');
    return { ...object, classification: reasons.length ? 'protected' : 'candidate', reasons, delete: false };
  });
  return { version: 1, binding: hash(binding), generatedAt: new Date(now).toISOString(), items };
};

export const applyMediaInventory = async ({ database, storage, binding, plan, now = Date.now() }) => {
  if (plan.version !== 1 || plan.binding !== hash(binding) || !Array.isArray(plan.items))
    throw new Error('Inventory does not belong to this database and storage');
  const selected = plan.items.filter((item) => item.delete === true);
  if (new Set(selected.map((item) => item.key)).size !== selected.length) throw new Error('Duplicate inventory keys');
  const current = await createMediaInventory({ database, storage, binding, now });
  const actual = new Map(current.items.map((item) => [item.key, item]));
  for (const item of selected) {
    const object = actual.get(item.key);
    if (
      item.classification !== 'candidate' ||
      !object ||
      object.classification !== 'candidate' ||
      object.version !== item.version
    )
      throw new Error(`Inventory changed or artwork is protected: ${item.key}`);
  }
  for (const item of selected) {
    await storage.remove(item.key, item.version);
    if (item.key.startsWith('originals/'))
      await database.execute({ sql: 'DELETE FROM files WHERE location = ?', args: [item.key] });
  }
  return selected.length;
};
