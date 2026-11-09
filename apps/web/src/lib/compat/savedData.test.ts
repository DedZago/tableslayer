import { annotationsTable, aoeTemplateTable, lightTable, markerTable, sceneTable } from '$lib/db/app/schema';
import { buildRenderProps } from '$lib/realtime/buildRenderProps';
import { getSceneSnapshot, hydrateGameSessionDoc } from '$lib/realtime/docSchema';
import { aoeTemplateRowFromDb, sceneRowToSettings } from '$lib/realtime/fromDb';
import type { ScenePart } from '$lib/realtime/types';
import { hydrationDataFromWire, sceneWireFromDoc, type SessionSnapshotWire } from '$lib/realtime/wire';
import { applySessionPersist, buildSessionSnapshot } from '$lib/server/realtime';
import { type Client, createClient } from '@libsql/client';
import { getTableColumns, type Table } from 'drizzle-orm';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

// Saved-data compatibility: every fixture is data as it was saved at one migration.
// Each one is migrated to the current schema, loaded through the server snapshot and
// the live doc, and saved back, so a change that breaks old scenes fails here.
// Add a fixture (named after the latest migration) whenever a change alters saved data.

const testDb = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('$lib/db/app', () => ({
  get db() {
    return testDb.current;
  }
}));

interface SavedDataFixture {
  migration: string;
  description: string;
  // "table.column" -> why its saved value may change or disappear
  allowedChanges: Record<string, string>;
  // SQL table -> rows keyed by SQL column, in insert order (parents first)
  tables: Record<string, Record<string, unknown>[]>;
}

type RawRow = Record<string, unknown>;
type JournalEntry = { idx: number; tag: string; when: number };

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../db/app/migrations', import.meta.url));
const ALL_PARTS: ScenePart[] = ['settings', 'markers', 'lights', 'aoeTemplates', 'annotations', 'fogMask'];
const DOC_TABLES = {
  scene: sceneTable,
  marker: markerTable,
  light: lightTable,
  aoe_template: aoeTemplateTable,
  annotations: annotationsTable
} as const;

const fixtures = import.meta.glob<SavedDataFixture>('./fixtures/*.json', { eager: true, import: 'default' });

const migrationsUpTo = (tag: string, into: string) => {
  const journal = JSON.parse(readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'));
  const entries: JournalEntry[] = journal.entries;
  const last = entries.findIndex((entry) => entry.tag === tag);
  if (last === -1) throw new Error(`Fixture migration ${tag} is not in the migration journal`);
  const kept = entries.slice(0, last + 1);
  mkdirSync(join(into, 'meta'), { recursive: true });
  for (const entry of kept) copyFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(into, `${entry.tag}.sql`));
  writeFileSync(join(into, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: kept }));
  return into;
};

const insertRows = async (client: Client, table: string, rows: RawRow[]) => {
  for (const row of rows) {
    const columns = Object.keys(row);
    await client.execute({
      sql: `INSERT OR IGNORE INTO "${table}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      args: columns.map((column) => row[column] as never)
    });
  }
};

const selectRow = async (client: Client, table: string, row: RawRow): Promise<RawRow | undefined> => {
  const result = await client.execute({ sql: `SELECT * FROM "${table}" WHERE "id" = ?`, args: [row.id as never] });
  return result.rows[0] ? { ...result.rows[0] } : undefined;
};

// Maps a raw row the way drizzle reads it, keeping only the columns the row has
const rowFromDriver = (table: Table, raw: RawRow) =>
  Object.fromEntries(
    Object.entries(getTableColumns(table)).flatMap(([key, column]) => {
      if (!(column.name in raw)) return [];
      const value = raw[column.name];
      return [[key, value === null ? null : column.mapFromDriverValue(value)]];
    })
  );

const nonFinitePaths = (value: unknown, path = 'props', seen = new WeakSet<object>()): string[] => {
  if (typeof value === 'number') return Number.isFinite(value) ? [] : [path];
  if (!value || typeof value !== 'object' || seen.has(value)) return [];
  seen.add(value);
  return Object.entries(value).flatMap(([key, child]) => nonFinitePaths(child, `${path}.${key}`, seen));
};

const expectDocRenders = (doc: Y.Doc, fixture: SavedDataFixture) => {
  for (const scene of fixture.tables.scene ?? []) {
    const snapshot = getSceneSnapshot(doc, scene.id as string);
    expect(snapshot, `scene ${scene.id} is missing from the doc`).not.toBeNull();
    for (const mode of ['editor', 'client'] as const) {
      const props = buildRenderProps(snapshot!, { mode });
      expect(nonFinitePaths(props)).toEqual([]);
      expect(props.weather.type).toBe(scene.weather_type);
      expect(props.marker.markers).toHaveLength(
        (fixture.tables.marker ?? []).filter((m) => m.scene_id === scene.id).length
      );
      expect(props.light.lights).toHaveLength(
        (fixture.tables.light ?? []).filter((l) => l.scene_id === scene.id).length
      );
    }
  }
};

const docFromWire = (wire: SessionSnapshotWire) => {
  const doc = new Y.Doc();
  hydrateGameSessionDoc(doc, hydrationDataFromWire(JSON.parse(JSON.stringify(wire))), 'test');
  return doc;
};

describe.each(Object.entries(fixtures))('saved data %s', (_file, fixture) => {
  let dir: string;
  let client: Client;
  const baselineRows: Record<string, RawRow[]> = {};
  const sessionIds = (fixture.tables.game_session ?? []).map((session) => session.id as string);

  const expectValuesKept = async (skip: string[] = []) => {
    for (const [table, rows] of Object.entries(fixture.tables)) {
      for (const row of rows) {
        const stored = await selectRow(client, table, row);
        expect(stored, `${table} ${row.id} was lost`).toBeDefined();
        for (const [column, value] of Object.entries(row)) {
          const key = `${table}.${column}`;
          if (key in fixture.allowedChanges || skip.includes(key)) continue;
          expect(column in stored!, `${key} was dropped`).toBe(true);
          expect(stored![column], key).toEqual(value);
        }
      }
    }
  };

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'saved-data-'));
    client = createClient({ url: `file:${join(dir, 'app.db')}` });
    const db: LibSQLDatabase = drizzle(client);
    testDb.current = db;

    await migrate(db, { migrationsFolder: migrationsUpTo(fixture.migration, join(dir, 'baseline')) });
    for (const [table, rows] of Object.entries(fixture.tables)) {
      await insertRows(client, table, rows);
      const stored = await Promise.all(rows.map((row) => selectRow(client, table, row)));
      baselineRows[table] = stored.filter((row): row is RawRow => row !== undefined);
    }
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  });

  afterAll(() => {
    client?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps every saved value through the migrations', async () => {
    await expectValuesKept();
  });

  it('loads the migrated rows through the server snapshot and the live doc', async () => {
    for (const sessionId of sessionIds) {
      expectDocRenders(docFromWire(await buildSessionSnapshot(sessionId)), fixture);
    }
  });

  it('loads and saves a live session hydrated before the update', async () => {
    // A room still open across a deploy holds the old row shape, without the newer fields
    const rowsFor = (table: keyof typeof DOC_TABLES, sceneId: string) =>
      (baselineRows[table] ?? [])
        .filter((row) => row.scene_id === sceneId)
        .map((row) => rowFromDriver(DOC_TABLES[table], row));

    for (const sessionId of sessionIds) {
      const scenes = (baselineRows.scene ?? []).filter((scene) => scene.session_id === sessionId);
      const oldWire = {
        gameSessionId: sessionId,
        scenes: scenes.map((raw) => ({
          settings: sceneRowToSettings(rowFromDriver(sceneTable, raw) as never),
          markers: rowsFor('marker', raw.id as string),
          lights: rowsFor('light', raw.id as string),
          aoeTemplates: rowsFor('aoe_template', raw.id as string).map((row) => aoeTemplateRowFromDb(row as never)),
          annotations: rowsFor('annotations', raw.id as string),
          fogMask: (raw.fog_of_war_mask as string | null) ?? null
        }))
      } as unknown as SessionSnapshotWire;

      const doc = docFromWire(oldWire);
      expectDocRenders(doc, fixture);

      const persisted = scenes.map((scene) => sceneWireFromDoc(doc, scene.id as string, ALL_PARTS)!);
      await applySessionPersist(
        JSON.parse(JSON.stringify({ gameSessionId: sessionId, scenes: persisted, deletedSceneIds: [] }))
      );
      // Saving touches the timestamps; everything else must come back unchanged
      await expectValuesKept(['scene.last_updated', 'game_session.last_updated']);
      expectDocRenders(docFromWire(await buildSessionSnapshot(sessionId)), fixture);
    }
  });
});
