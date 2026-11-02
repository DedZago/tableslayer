import { createSessionWriter, getSceneSnapshot } from '$lib/realtime/docSchema';
import type { MarkerRow, SceneSettings } from '$lib/realtime/types';
import { StageMode } from '@tableslayer/stage';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { MENU_ID, tokenMenu } from '../../routes/(app)/[party]/play/playMenus';
import { buildSceneProps } from './buildSceneProps';
import {
  castSpell,
  concentratingSpellName,
  deleteMarkersWithSpells,
  endConcentration,
  removeSpellRows,
  spellRowsOwnedBy,
  type CastSpellContext
} from './spellCasting';
import { planSceneSweep } from './templateExpiry';

const marker: MarkerRow = {
  id: 'emric',
  sceneId: 's1',
  visibility: 0,
  title: 'Emric',
  label: null,
  imageLocation: null,
  imageScale: 1,
  positionX: 100,
  positionY: 100,
  shape: 1,
  shapeColor: '#ffffff',
  size: 1,
  note: null,
  pinnedTooltip: false
};

const setup = () => {
  const doc = new Y.Doc();
  const writer = createSessionWriter(doc, 'tv');
  writer.createScene({ id: 's1', gameSessionId: 'g', name: 'S', order: 1 } as SceneSettings, { markers: [marker] });
  const client = {
    write: writer,
    scene: (id: string) => getSceneSnapshot(doc, id),
    stopCapturing: () => {}
  } as unknown as CastSpellContext['client'];
  let id = 0;
  const context: CastSpellContext = {
    client,
    presence: null,
    sceneId: 's1',
    ruleset: 'dnd5e-2024',
    templateVisibility: StageMode.Player,
    newId: () => `id-${id++}`,
    now: () => 1_800_000_000_000
  };
  return { doc, context, client };
};

describe('concentration through a real doc', () => {
  it('registers, shows and ends the concentration of a point spell cast from a token', () => {
    const { context, client, doc } = setup();
    castSpell(context, {
      spellId: 'moonbeam',
      placement: { position: { x: 300, y: 300 }, angle: 0 },
      caster: { id: 'emric', positionX: 100, positionY: 100, size: 1, label: null }
    });
    const snapshot = getSceneSnapshot(doc, 's1')!;
    expect(snapshot.aoeTemplates).toHaveLength(1);
    expect(snapshot.markers[0].concentration).toMatchObject({ spellId: 'moonbeam' });
    expect(concentratingSpellName(snapshot.markers[0], snapshot)).toBe('Moonbeam');
    const props = buildSceneProps(
      snapshot.settings as never,
      snapshot.markers as never,
      'client',
      [],
      [],
      undefined,
      snapshot.aoeTemplates
    );
    expect(props.tokenEffects?.map((effect) => effect.fx)).toEqual(['concentration']);
    expect(props.aoeTemplates?.templates[0].spellId).toBe('moonbeam');
    const items = tokenMenu({
      markers: snapshot.markers,
      customSuggestions: [],
      groupItems: [],
      selectionCount: 0,
      spells: { ruleset: 'dnd5e-2024', recent: [], hasCaster: true, noCasterHint: '' },
      concentratingOn: concentratingSpellName(snapshot.markers[0], snapshot)
    });
    expect(items.map((item) => item.id)).toContain(MENU_ID.endConcentration);
    expect(planSceneSweep(snapshot, 1_800_000_100).concentrationUpdates).toEqual([]);
    expect(endConcentration(client, 's1', 'emric')).toBe(true);
    expect(getSceneSnapshot(doc, 's1')!.aoeTemplates).toHaveLength(0);
  });

  it('clears the concentration when the area it listed is removed, and ends it with the caster token', () => {
    const { context, client, doc } = setup();
    const caster = { id: 'emric', positionX: 100, positionY: 100, size: 1, label: null };
    castSpell(context, { spellId: 'moonbeam', placement: { position: { x: 300, y: 300 }, angle: 0 }, caster });
    const [area] = getSceneSnapshot(doc, 's1')!.aoeTemplates;
    removeSpellRows(client, 's1', { templateIds: [area.id] });
    const after = getSceneSnapshot(doc, 's1')!;
    expect(after.aoeTemplates).toHaveLength(0);
    expect(after.markers[0].concentration).toBeNull();

    castSpell(context, { spellId: 'moonbeam', placement: { position: { x: 300, y: 300 }, angle: 0 }, caster });
    deleteMarkersWithSpells(client, 's1', ['emric']);
    const gone = getSceneSnapshot(doc, 's1')!;
    expect(gone.markers).toHaveLength(0);
    expect(gone.aoeTemplates).toHaveLength(0);
  });

  it('lists a token spell effect for removal', () => {
    const { context, client, doc } = setup();
    const caster = { id: 'emric', positionX: 100, positionY: 100, size: 1, label: null };
    castSpell(context, {
      spellId: 'bless',
      placement: { position: { x: 100, y: 100 }, angle: 0 },
      caster,
      targets: [caster]
    });
    const snapshot = getSceneSnapshot(doc, 's1')!;
    const owned = spellRowsOwnedBy(snapshot, 'emric');
    expect(owned.effects.map((effect) => effect.spellName)).toEqual(['Bless']);
    removeSpellRows(client, 's1', { templateIds: [owned.effects[0].templateId] });
    expect(getSceneSnapshot(doc, 's1')!.markers[0].concentration).toBeNull();
  });
});
