import { AoeEffect, AoeShape, resolveSpell, RULESETS, SPELLS, StageMode, type ResolvedSpell } from '@tableslayer/stage';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  areaPickedMarkerIds,
  buildSpellAim,
  buildSpellCast,
  buildSpellTemplate,
  buildSummonMarkers,
  buildTokenEffectRow,
  buildTokenEffects,
  castSpell,
  concentrationAfterCast,
  deleteMarkersWithSpells,
  endConcentration,
  removeSpellRows,
  selfPlacement,
  spellAimMode,
  spellAimPrompt,
  spellNeedsCaster,
  spellPickedMarkerIds,
  spellRowsOwnedBy,
  SUMMON_IMPACT_FRACTION,
  toggleSpellTarget,
  type CasterMarker,
  type CastSpellContext
} from './spellCasting';

const spellFor = (id: string, ruleset: 'dnd5e-2014' | 'dnd5e-2024' = 'dnd5e-2024'): ResolvedSpell =>
  resolveSpell(id, ruleset)!;

const caster: CasterMarker = { id: 'hero', positionX: 100, positionY: -50, size: 1, label: 'H' };
const placement = { position: { x: 300, y: 40 }, angle: 90 };
const options = { id: 'template-1', sceneId: 'scene-1', visibility: StageMode.Player, nowMs: 1_700_000_000_500 };

describe('spellAimMode', () => {
  it('aims blasts from the caster as a direction and ranged spells as a point', () => {
    expect(spellAimMode(spellFor('burning-hands'), true)).toBe('direction');
    expect(spellAimMode(spellFor('burning-hands'), false)).toBe('direction');
    expect(spellAimMode(spellFor('lightning-bolt'), true)).toBe('direction');
    expect(spellAimMode(spellFor('fireball'), true)).toBe('point');
    expect(spellAimMode(spellFor('web'), false)).toBe('point');
  });

  it('casts self-centred spells at once, but needs a point without a caster', () => {
    expect(spellAimMode(spellFor('spirit-guardians'), true)).toBe('self');
    expect(spellAimMode(spellFor('thunderwave'), true)).toBe('self');
    expect(spellAimMode(spellFor('thunderwave'), false)).toBe('point');
    expect(spellAimMode(spellFor('thunderwave', 'dnd5e-2014'), true)).toBe('direction');
  });

  it('aims summons at a point', () => {
    expect(spellAimMode(spellFor('spiritual-weapon'), true)).toBe('point');
    expect(spellAimMode(spellFor('flaming-sphere'), false)).toBe('point');
  });
});

describe('spellNeedsCaster', () => {
  it('only auras that follow the caster need one', () => {
    expect(spellNeedsCaster(spellFor('spirit-guardians'))).toBe(true);
    expect(spellNeedsCaster(spellFor('flaming-sphere'))).toBe(false);
    expect(spellNeedsCaster(spellFor('fireball'))).toBe(false);
  });
});

describe('buildSpellAim', () => {
  it('locks the preset area, effect and range, and draws the range ring from the caster', () => {
    expect(buildSpellAim(spellFor('fireball'), undefined, caster)).toEqual({
      spellId: 'fireball',
      label: 'Fireball',
      area: { shape: AoeShape.Circle, size: 20 },
      effect: AoeEffect.Fire,
      color: '#ff6a1a',
      aim: 'point',
      rangeFt: 150,
      caster: { x: 100, y: -50 }
    });
  });

  it('starts a caster direction at the edge of the caster token', () => {
    const aim = buildSpellAim(spellFor('burning-hands'), undefined, { ...caster, size: 2 })!;
    expect(aim).toMatchObject({ aim: 'direction', origin: { x: 100, y: -50 }, originRadiusCells: 1 });
    expect(buildSpellAim(spellFor('burning-hands'))!.origin).toBeUndefined();
  });

  it('has nothing to aim for a self spell', () => {
    expect(buildSpellAim(spellFor('spirit-guardians'), undefined, caster)).toBeNull();
  });

  it('shows the token footprint for a pure summon', () => {
    expect(buildSpellAim(spellFor('spiritual-weapon'), 'sword')!.area).toEqual({ shape: AoeShape.Circle, size: 2.5 });
    expect(buildSpellAim(spellFor('find-steed'), 'warhorse')!.area.size).toBe(5);
  });

  it('keeps the area of a summon that also has one', () => {
    expect(buildSpellAim(spellFor('flaming-sphere'), 'fire-sphere')!.area).toEqual({ shape: AoeShape.Circle, size: 5 });
  });
});

describe('spellAimPrompt', () => {
  it('asks for a tap for a point and a drag for a direction', () => {
    expect(spellAimPrompt('Fireball', buildSpellAim(spellFor('fireball'))!)).toBe('Tap where to place Fireball');
    expect(spellAimPrompt('Burning hands', buildSpellAim(spellFor('burning-hands'))!)).toBe(
      'Drag to aim Burning hands'
    );
  });

  it('asks for clicks with a mouse', () => {
    const fireball = buildSpellAim(spellFor('fireball'))!;
    expect(spellAimPrompt('Fireball', fireball, { mouse: true })).toBe('Click where to place Fireball');
    const fromCaster = buildSpellAim(spellFor('burning-hands'), undefined, caster)!;
    expect(spellAimPrompt('Burning hands', fromCaster, { mouse: true })).toBe('Click to aim Burning hands');
    const free = buildSpellAim(spellFor('burning-hands'))!;
    expect(spellAimPrompt('Burning hands', free, { mouse: true })).toBe(
      'Click to start Burning hands, then click to aim it'
    );
  });

  it('asks for a click or tap inside a placed area to cast it', () => {
    const fireball = buildSpellAim(spellFor('fireball'))!;
    expect(spellAimPrompt('Fireball', fireball, { mouse: true, placed: true })).toBe(
      'Click inside Fireball to cast · drag to move'
    );
    expect(spellAimPrompt('Fireball', fireball, { placed: true })).toBe('Tap inside Fireball to cast · drag to move');
  });
});

describe('buildSpellCast', () => {
  it('flies from the caster to the target with the area pointing along the aim', () => {
    expect(buildSpellCast(spellFor('fireball'), placement, caster, 'cast-1')).toMatchObject({
      id: 'cast-1',
      spellId: 'fireball',
      fx: 'burst',
      projectile: true,
      area: { shape: AoeShape.Circle, size: 20, angle: 90 },
      origin: { x: 100, y: -50 },
      target: { x: 300, y: 40 },
      durationMs: 2200
    });
  });

  it('starts at the point itself without a caster, and omits the projectile and area when there are none', () => {
    const cast = buildSpellCast(spellFor('spiritual-weapon'), placement, undefined, 'cast-2');
    expect(cast.origin).toEqual(placement.position);
    expect(cast.area).toBeUndefined();
    expect(cast.projectile).toBeUndefined();
    expect(cast.fx).toBe('summon');
    expect(buildSpellCast(spellFor('burning-hands'), placement, undefined, 'x').variant).toBe(0);
  });

  it('carries the cast variant of the spell', () => {
    expect(buildSpellCast(spellFor('cone-of-cold'), placement, caster, 'x').variant).toBe(2);
  });
});

describe('buildSpellTemplate', () => {
  it('labels an instant blast with the spell and expires it after the cast plus the 3 s fade', () => {
    const row = buildSpellTemplate(spellFor('fireball'), placement, options)!;
    expect(row).toMatchObject({
      id: 'template-1',
      sceneId: 'scene-1',
      shape: AoeShape.Circle,
      positionX: 300,
      positionY: 40,
      angle: 90,
      size: 20,
      effect: AoeEffect.Fire,
      label: 'Fireball',
      spellId: 'fireball',
      visibility: StageMode.Player,
      anchorMarkerId: null,
      groupId: null,
      createdAt: 1_700_000_000,
      expiresAt: 1_700_000_006
    });
  });

  it('keeps a lingering zone until it is removed', () => {
    expect(buildSpellTemplate(spellFor('web'), placement, options)!.expiresAt).toBeNull();
  });

  it('anchors an aura to the given marker, and ignores the anchor for other spells', () => {
    const anchored = buildSpellTemplate(spellFor('spirit-guardians'), placement, {
      ...options,
      anchorMarkerId: 'hero'
    });
    expect(anchored).toMatchObject({ anchorMarkerId: 'hero', expiresAt: null, effect: AoeEffect.SpiritGuardians });
    expect(
      buildSpellTemplate(spellFor('fireball'), placement, { ...options, anchorMarkerId: 'hero' })!.anchorMarkerId
    ).toBe(null);
  });

  it('keeps the line width, and has no template for a pure summon', () => {
    expect(buildSpellTemplate(spellFor('lightning-bolt'), placement, options)).toMatchObject({ size: 100, width: 5 });
    expect(buildSpellTemplate(spellFor('spiritual-weapon'), placement, options)).toBeNull();
  });
});

describe('buildSummonMarkers', () => {
  const summonOptions = { id: 'token-1', sceneId: 'scene-1', caster };

  it('conjures a player-visible token with the variant art and the spell colour', () => {
    expect(buildSummonMarkers(spellFor('spiritual-weapon'), 'mace', placement, summonOptions)).toEqual([
      expect.objectContaining({
        id: 'token-1',
        sceneId: 'scene-1',
        title: 'Spiritual weapon',
        label: 'H',
        imageLocation: '/spell-tokens/mace.svg',
        positionX: 300,
        positionY: 40,
        shapeColor: '#fde68a',
        size: 1,
        visibility: 0
      })
    ]);
  });

  it('uses the size of the variant', () => {
    expect(buildSummonMarkers(spellFor('find-steed'), 'warhorse', placement, summonOptions)[0].size).toBe(2);
    expect(buildSummonMarkers(spellFor('find-steed'), 'pony', placement, summonOptions)[0].size).toBe(1);
  });

  it('falls back to the first variant and leaves the label empty without a caster', () => {
    const [marker] = buildSummonMarkers(spellFor('find-familiar'), 'dragon', placement, { id: 't', sceneId: 's' });
    expect(marker.imageLocation).toBe('/spell-tokens/owl.svg');
    expect(marker.label).toBeNull();
  });

  it('conjures nothing for a spell that does not summon', () => {
    expect(buildSummonMarkers(spellFor('fireball'), undefined, placement, summonOptions)).toEqual([]);
  });
});

const harness = () => {
  const timers: Array<{ run: () => void; delayMs: number }> = [];
  let nextId = 0;
  const upsertMarker = vi.fn();
  const upsertAoeTemplate = vi.fn();
  const stopCapturing = vi.fn();
  const castOnPresence = vi.fn();
  const setMarkerFields = vi.fn();
  const deleteAoeTemplate = vi.fn();
  const deleteMarker = vi.fn();
  const notify = vi.fn();
  const snapshot = {
    markers: [{ id: 'hero', concentration: null as unknown }, { id: 'goblin' }],
    aoeTemplates: [{ id: 'old-effect' }]
  };
  const context: CastSpellContext = {
    client: {
      write: {
        transaction: (fn: () => void) => fn(),
        upsertMarker,
        upsertAoeTemplate,
        setMarkerFields,
        deleteAoeTemplate,
        deleteMarker
      },
      scene: () => snapshot,
      stopCapturing
    } as unknown as CastSpellContext['client'],
    notify,
    presence: { castSpell: castOnPresence },
    sceneId: 'scene-1',
    ruleset: 'dnd5e-2024',
    templateVisibility: StageMode.DM,
    snapToGrid: (point) => ({ x: Math.round(point.x / 50) * 50, y: Math.round(point.y / 50) * 50 }),
    now: () => 1_700_000_000_000,
    newId: () => `id-${nextId++}`,
    setTimer: (run, delayMs) => timers.push({ run, delayMs })
  };
  return {
    context,
    timers,
    upsertMarker,
    upsertAoeTemplate,
    stopCapturing,
    castOnPresence,
    setMarkerFields,
    deleteAoeTemplate,
    deleteMarker,
    notify,
    snapshot
  };
};

describe('castSpell', () => {
  it('casts an upcast area at the slot size and remembers the slot', () => {
    const { context, upsertAoeTemplate, castOnPresence } = harness();
    const recent = castSpell(context, { spellId: 'fog-cloud', slotLevel: 3, placement, caster });
    expect(recent).toEqual({ spellId: 'fog-cloud', slotLevel: 3 });
    expect(upsertAoeTemplate).toHaveBeenCalledWith('scene-1', expect.objectContaining({ size: 60 }));
    expect(castOnPresence).toHaveBeenCalledWith(
      expect.objectContaining({ area: expect.objectContaining({ size: 60 }) })
    );
  });

  it('casts at base level without a slot, or with one at or below the spell level', () => {
    const { context, upsertAoeTemplate } = harness();
    expect(castSpell(context, { spellId: 'fog-cloud', placement })).toEqual({ spellId: 'fog-cloud' });
    expect(castSpell(context, { spellId: 'fog-cloud', slotLevel: 1, placement })).toEqual({ spellId: 'fog-cloud' });
    upsertAoeTemplate.mock.calls.forEach(([, row]) => expect(row.size).toBe(20));
  });

  it('remembers the slot of a spell whose area does not grow', () => {
    const { context, upsertAoeTemplate } = harness();
    expect(castSpell(context, { spellId: 'fireball', slotLevel: 5, placement })).toEqual({
      spellId: 'fireball',
      slotLevel: 5
    });
    expect(upsertAoeTemplate).toHaveBeenCalledWith('scene-1', expect.objectContaining({ size: 20 }));
  });

  it('plays a blast on the scene and writes its template at once, with the GM-chosen visibility', () => {
    const { context, upsertAoeTemplate, castOnPresence, stopCapturing, upsertMarker } = harness();
    const recent = castSpell(context, { spellId: 'fireball', placement, caster });
    expect(recent).toEqual({ spellId: 'fireball' });
    expect(castOnPresence).toHaveBeenCalledWith(
      expect.objectContaining({ spellId: 'fireball', sceneId: 'scene-1', target: placement.position })
    );
    expect(upsertAoeTemplate).toHaveBeenCalledWith(
      'scene-1',
      expect.objectContaining({ spellId: 'fireball', visibility: StageMode.DM, anchorMarkerId: null })
    );
    expect(upsertMarker).not.toHaveBeenCalled();
    expect(stopCapturing).toHaveBeenCalledTimes(2);
  });

  it('anchors a self aura to the caster', () => {
    const { context, upsertAoeTemplate } = harness();
    castSpell(context, { spellId: 'spirit-guardians', placement: selfPlacement(caster), caster });
    expect(upsertAoeTemplate).toHaveBeenCalledWith(
      'scene-1',
      expect.objectContaining({ anchorMarkerId: 'hero', positionX: 100, positionY: -50 })
    );
  });

  it('conjures a summon halfway through the animation, snapped to the grid', () => {
    const { context, timers, upsertMarker, upsertAoeTemplate, castOnPresence } = harness();
    const recent = castSpell(context, {
      spellId: 'spiritual-weapon',
      variantId: 'axe',
      placement: { position: { x: 123, y: 78 }, angle: 0 },
      caster
    });
    expect(recent).toEqual({ spellId: 'spiritual-weapon', variantId: 'axe' });
    expect(castOnPresence).toHaveBeenCalledWith(expect.objectContaining({ target: { x: 100, y: 100 } }));
    expect(upsertMarker).not.toHaveBeenCalled();
    expect(timers).toHaveLength(1);
    expect(timers[0].delayMs).toBe(2000 * SUMMON_IMPACT_FRACTION);

    timers[0].run();
    expect(upsertMarker).toHaveBeenCalledWith(
      'scene-1',
      expect.objectContaining({
        title: 'Spiritual weapon',
        positionX: 100,
        positionY: 100,
        imageLocation: '/spell-tokens/axe.svg'
      })
    );
    expect(upsertAoeTemplate).not.toHaveBeenCalled();
  });

  it('anchors the area of a flaming sphere to the token it conjures', () => {
    const { context, timers, upsertMarker, upsertAoeTemplate } = harness();
    castSpell(context, { spellId: 'flaming-sphere', variantId: 'fire-sphere', placement, caster });
    timers[0].run();
    const markerId = upsertMarker.mock.calls[0][1].id;
    expect(upsertAoeTemplate).toHaveBeenCalledWith(
      'scene-1',
      expect.objectContaining({ anchorMarkerId: markerId, spellId: 'flaming-sphere', expiresAt: null })
    );
  });

  it('ignores a spell the ruleset does not list', () => {
    const { context, castOnPresence, upsertAoeTemplate } = harness();
    expect(castSpell(context, { spellId: 'stinking-cloud', placement })).toBeNull();
    expect(castSpell(context, { spellId: 'unknown', placement })).toBeNull();
    expect(castOnPresence).not.toHaveBeenCalled();
    expect(upsertAoeTemplate).not.toHaveBeenCalled();
  });

  it('still writes when nobody else is listening', () => {
    const { context, upsertAoeTemplate } = harness();
    castSpell({ ...context, presence: null }, { spellId: 'web', placement });
    expect(upsertAoeTemplate).toHaveBeenCalledTimes(1);
  });
});

describe('built-in summon art', () => {
  const artDirectory = fileURLToPath(new URL('../../../static/spell-tokens/', import.meta.url));
  const icons = new Set(
    Object.values(SPELLS).flatMap((spell) =>
      RULESETS.flatMap((ruleset) => resolveSpell(spell.id, ruleset)?.resolved.summon?.variants ?? []).map((v) => v.icon)
    )
  );

  it('ships a small svg for every variant icon', () => {
    expect(icons.size).toBeGreaterThan(20);
    for (const icon of icons) {
      const file = `${artDirectory}${icon}.svg`;
      expect(existsSync(file), icon).toBe(true);
      expect(statSync(file).size, icon).toBeLessThan(4096);
    }
  });
});

const goblin = { id: 'goblin', positionX: 300, positionY: 40, size: 1 };

describe('target spells', () => {
  it('aims at tokens with the range ring around the caster', () => {
    expect(spellAimMode(spellFor('hold-person'), false)).toBe('target');
    expect(spellAimMode(spellFor('blur'), true)).toBe('self');
    expect(spellNeedsCaster(spellFor('hold-person'))).toBe(false);
    expect(spellNeedsCaster(spellFor('blur'))).toBe(true);
    expect(buildSpellAim(spellFor('hold-person'), undefined, caster)).toMatchObject({
      mode: 'target',
      rangeFt: 60,
      caster: { x: 100, y: -50 },
      casterSizeCells: 1
    });
    const bless = buildSpellAim(spellFor('bless'))!;
    expect(spellAimPrompt('Bless', bless)).toBe('Tap targets for Bless');
    expect(spellAimPrompt('Bless', bless, { mouse: true, picked: 1 })).toBe('Bless: 1 target');
    expect(spellAimPrompt('Bless', bless, { picked: 4 })).toBe('Bless: 4 targets');
  });

  it('toggles a token in and out of the picks', () => {
    expect(toggleSpellTarget(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleSpellTarget(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('builds an effect-only row anchored to the target, sized to its footprint', () => {
    const row = buildTokenEffectRow(spellFor('hold-person'), { ...goblin, size: 2 }, options)!;
    expect(row).toMatchObject({
      shape: AoeShape.Circle,
      size: 5,
      effect: AoeEffect.None,
      anchorMarkerId: 'goblin',
      spellId: 'hold-person',
      positionX: 300,
      expiresAt: null
    });
    expect(buildTokenEffectRow(spellFor('command'), goblin, options)!.expiresAt).toBe(1_700_000_005);
    expect(buildTokenEffectRow(spellFor('fireball'), goblin, options)).toBeNull();
  });

  it('writes a target cast as a row anchored to the target and registers the caster concentration', () => {
    const { context, upsertAoeTemplate, setMarkerFields, castOnPresence } = harness();
    castSpell(context, {
      spellId: 'hold-person',
      placement: selfPlacement({ positionX: 300, positionY: 40 }),
      caster,
      targets: [goblin]
    });
    expect(castOnPresence).toHaveBeenCalledWith(expect.objectContaining({ fx: 'beam', origin: { x: 100, y: -50 } }));
    const row = upsertAoeTemplate.mock.calls[0][1];
    expect(row).toMatchObject({ anchorMarkerId: 'goblin', spellId: 'hold-person' });
    expect(setMarkerFields).toHaveBeenCalledWith('scene-1', 'hero', {
      concentration: { spellId: 'hold-person', startedAt: 1_700_000_000, templateIds: [row.id], markerIds: [] }
    });
  });

  it('does not register concentration for a spell that does not need it, or a cast without a caster', () => {
    const a = harness();
    castSpell(a.context, { spellId: 'charm-person', placement, caster, targets: [goblin] });
    expect(a.setMarkerFields).not.toHaveBeenCalled();
    const b = harness();
    castSpell(b.context, { spellId: 'hold-person', placement, targets: [goblin] });
    expect(b.setMarkerFields).not.toHaveBeenCalled();
  });

  it('ends the previous concentration, with a toast, when a new one starts', () => {
    const { context, snapshot, deleteAoeTemplate, deleteMarker, notify, setMarkerFields } = harness();
    snapshot.markers[0].concentration = {
      spellId: 'bless',
      startedAt: 5,
      templateIds: ['old-effect'],
      markerIds: ['goblin']
    };
    castSpell(context, { spellId: 'hold-person', placement, caster, targets: [goblin] });
    expect(deleteAoeTemplate).toHaveBeenCalledWith('scene-1', 'old-effect');
    expect(deleteMarker).toHaveBeenCalledWith('scene-1', 'goblin');
    expect(notify).toHaveBeenCalledWith('Bless ended. Concentrating on Hold person');
    expect(setMarkerFields.mock.calls[0][2].concentration.spellId).toBe('hold-person');
  });

  it('casts once on every picked target as one undo step under one concentration', () => {
    const { context, upsertAoeTemplate, setMarkerFields, castOnPresence, stopCapturing } = harness();
    const orc = { id: 'orc', positionX: -200, positionY: 90, size: 2 };
    castSpell(context, { spellId: 'bless', placement, caster, targets: [goblin, orc, caster] });
    expect(castOnPresence).toHaveBeenCalledTimes(3);
    expect(castOnPresence.mock.calls[1][0]).toMatchObject({ origin: { x: 100, y: -50 }, target: { x: -200, y: 90 } });
    const rows = upsertAoeTemplate.mock.calls.map((call) => call[1]);
    expect(rows.map((row) => row.anchorMarkerId)).toEqual(['goblin', 'orc', 'hero']);
    expect(setMarkerFields).toHaveBeenCalledTimes(1);
    expect(setMarkerFields.mock.calls[0][2].concentration.templateIds).toEqual(rows.map((row) => row.id));
    expect(stopCapturing).toHaveBeenCalledTimes(2);
  });

  it('binds a self effect to the caster', () => {
    const { context, upsertAoeTemplate } = harness();
    castSpell(context, { spellId: 'mirror-image', placement: selfPlacement(caster), caster });
    expect(upsertAoeTemplate.mock.calls[0][1]).toMatchObject({ anchorMarkerId: 'hero', spellId: 'mirror-image' });
  });
});

describe('concentrationAfterCast', () => {
  it('starts a fresh concentration listing the rows the cast made', () => {
    expect(concentrationAfterCast('hex', 9, { templateIds: ['b'], markerIds: [] })).toEqual({
      spellId: 'hex',
      startedAt: 9,
      templateIds: ['b'],
      markerIds: []
    });
  });
});

describe('endConcentration', () => {
  const make = (concentration: unknown) => {
    const calls: string[] = [];
    const writer = {
      transaction: (fn: () => void) => fn(),
      deleteAoeTemplate: (_s: string, id: string) => calls.push(`template:${id}`),
      deleteMarker: (_s: string, id: string) => calls.push(`marker:${id}`),
      setMarkerFields: (_s: string, id: string, fields: object) => calls.push(`set:${id}:${JSON.stringify(fields)}`)
    };
    const client = {
      write: writer,
      stopCapturing: () => {},
      scene: () => ({
        markers: [{ id: 'hero', concentration }, { id: 'sphere' }],
        aoeTemplates: [{ id: 'zone' }, { id: 'unrelated' }]
      })
    } as unknown as Parameters<typeof endConcentration>[0];
    return { client, calls };
  };

  it('deletes exactly the listed rows that exist and clears the field, in one transaction', () => {
    const { client, calls } = make({
      spellId: 'flaming-sphere',
      startedAt: 1,
      templateIds: ['zone', 'missing'],
      markerIds: ['sphere']
    });
    expect(endConcentration(client, 'scene-1', 'hero')).toBe(true);
    expect(calls).toEqual(['template:zone', 'marker:sphere', 'set:hero:{"concentration":null}']);
  });

  it('does nothing for a token that is not concentrating', () => {
    const { client, calls } = make(null);
    expect(endConcentration(client, 'scene-1', 'hero')).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('buildTokenEffects', () => {
  const rows = [
    { id: 't1', spellId: 'hold-person', anchorMarkerId: 'goblin', color: '#aab4c8', createdAt: 100 },
    { id: 't2', spellId: 'hold-person', anchorMarkerId: 'gone', color: '#aab4c8', createdAt: 100 },
    { id: 't3', spellId: 'spirit-guardians', anchorMarkerId: 'hero', color: '#cfe9ff', createdAt: 100 },
    { id: 't4', spellId: 'fireball', anchorMarkerId: 'hero', color: '#ff6a1a', createdAt: 100 }
  ];

  it('draws each attached effect on its token and drops effects of missing tokens', () => {
    const effects = buildTokenEffects(
      rows,
      [{ id: 'hero' }, { id: 'goblin' }].map((m) => ({ ...m, concentration: null }))
    );
    expect(effects.map((e) => [e.id, e.markerId, e.fx])).toEqual([
      ['t1', 'goblin', 'chains'],
      ['t3', 'hero', 'orbit']
    ]);
    expect(effects[1]).toMatchObject({ radius: 15, startedAt: 100_000 });
  });

  it('adds a ring for an active concentration only', () => {
    const active = { spellId: 'hold-person', startedAt: 50, templateIds: ['t1'], markerIds: [] };
    const stale = { spellId: 'hold-person', startedAt: 50, templateIds: ['vanished'], markerIds: [] };
    const effects = buildTokenEffects(rows, [
      { id: 'hero', concentration: active },
      { id: 'goblin', concentration: stale }
    ]);
    const rings = effects.filter((e) => e.fx === 'concentration');
    expect(rings).toEqual([expect.objectContaining({ markerId: 'hero', startedAt: 50_000, color: '#aab4c8' })]);
  });
});

describe('spellRowsOwnedBy', () => {
  const snapshot = {
    markers: [
      {
        id: 'wizard',
        title: 'Wizard',
        imageLocation: null,
        concentration: { spellId: 'flaming-sphere', startedAt: 1, templateIds: ['sphere-area'], markerIds: ['sphere'] }
      },
      { id: 'goblin', title: 'Goblin', imageLocation: null, concentration: null },
      { id: 'sphere', title: 'Flaming sphere', imageLocation: '/spell-tokens/sphere.svg', concentration: null },
      { id: 'steed', title: 'Steed', imageLocation: '/spell-tokens/horse.svg', concentration: null }
    ],
    aoeTemplates: [
      { id: 'sphere-area', spellId: 'flaming-sphere', anchorMarkerId: 'sphere' },
      { id: 'chains', spellId: 'hold-person', anchorMarkerId: 'goblin' },
      { id: 'bless', spellId: 'bless', anchorMarkerId: 'goblin' },
      { id: 'drawn', spellId: null, anchorMarkerId: 'goblin' }
    ]
  };

  it('lists the effect-only rows bound to a token with their spell names', () => {
    const owned = spellRowsOwnedBy(snapshot, 'goblin');
    expect(owned.effects).toEqual([
      { templateId: 'chains', spellId: 'hold-person', spellName: 'Hold person' },
      { templateId: 'bless', spellId: 'bless', spellName: 'Bless' }
    ]);
    expect(owned.anchoredTemplateIds).toEqual(['chains', 'bless']);
    expect(owned.summonedBy).toBeNull();
  });

  it('names the spell that conjured a token, from the caster list or from the built-in art', () => {
    expect(spellRowsOwnedBy(snapshot, 'sphere').summonedBy).toBe('Flaming sphere');
    expect(spellRowsOwnedBy(snapshot, 'sphere').anchoredTemplateIds).toEqual(['sphere-area']);
    expect(spellRowsOwnedBy(snapshot, 'steed').summonedBy).toBe('Steed');
    expect(spellRowsOwnedBy(snapshot, 'wizard').summonedBy).toBeNull();
  });
});

describe('removing spell rows', () => {
  const make = () => {
    const calls: string[] = [];
    const snapshot = {
      markers: [
        {
          id: 'wizard',
          concentration: { spellId: 'hold-person', startedAt: 1, templateIds: ['chains'], markerIds: [] as string[] }
        },
        {
          id: 'caster',
          concentration: {
            spellId: 'flaming-sphere',
            startedAt: 1,
            templateIds: ['area', 'extra'],
            markerIds: ['sphere']
          }
        },
        { id: 'sphere', title: 'Flaming sphere', imageLocation: '/spell-tokens/sphere.svg', concentration: null },
        { id: 'goblin', concentration: null }
      ],
      aoeTemplates: [
        { id: 'chains', spellId: 'hold-person', anchorMarkerId: 'goblin' },
        { id: 'area', spellId: 'flaming-sphere', anchorMarkerId: 'sphere' },
        { id: 'extra', spellId: 'flaming-sphere', anchorMarkerId: null }
      ]
    };
    const writer = {
      transaction: (fn: () => void) => fn(),
      deleteAoeTemplate: (_s: string, id: string) => calls.push(`template:${id}`),
      deleteMarker: (_s: string, id: string) => calls.push(`marker:${id}`),
      setMarkerFields: (_s: string, id: string, fields: object) => calls.push(`set:${id}:${JSON.stringify(fields)}`)
    };
    const client = { write: writer, stopCapturing: () => {}, scene: () => snapshot };
    return { client: client as unknown as Parameters<typeof removeSpellRows>[0], calls };
  };

  it('clears the concentration of the caster whose last row was removed', () => {
    const { client, calls } = make();
    removeSpellRows(client, 'scene-1', { templateIds: ['chains'] });
    expect(calls).toEqual(['template:chains', 'set:wizard:{"concentration":null}']);
  });

  it('prunes a concentration that keeps other rows', () => {
    const { client, calls } = make();
    removeSpellRows(client, 'scene-1', { templateIds: ['area'] });
    expect(calls[0]).toBe('template:area');
    expect(calls[1]).toContain('"templateIds":["extra"]');
    expect(calls[1]).toContain('"markerIds":["sphere"]');
  });

  it('dismisses a summon with the areas anchored to it and the entry that listed it', () => {
    const { client, calls } = make();
    deleteMarkersWithSpells(client, 'scene-1', ['sphere']);
    expect(calls.slice(0, 2)).toEqual(['template:area', 'marker:sphere']);
    expect(calls[2]).toContain('set:caster:');
    expect(calls[2]).toContain('"templateIds":["extra"]');
  });

  it('deleting a caster removes the rows it listed, in one go', () => {
    const { client, calls } = make();
    deleteMarkersWithSpells(client, 'scene-1', ['caster']);
    expect(calls).toEqual(['template:area', 'template:extra', 'marker:caster', 'marker:sphere']);
  });

  it('deletes several tokens in one transaction, so it is one undo step', () => {
    const { client, calls } = make();
    let transactions = 0;
    const { transaction } = client.write;
    client.write.transaction = (fn: () => void) => {
      transactions++;
      transaction(fn);
    };
    deleteMarkersWithSpells(client, 'scene-1', ['wizard', 'goblin']);
    expect(transactions).toBe(1);
    expect(calls).toEqual(['template:chains', 'marker:wizard', 'marker:goblin']);
  });
});

describe('area-pick spells', () => {
  const goblin = { id: 'goblin', positionX: 300, positionY: 40, size: 1 };
  const orc = { id: 'orc', positionX: -200, positionY: 90, size: 2 };
  const area = { position: { x: 250, y: 0 }, angle: 0 };

  it('aims by placing the area, and only a cone from the caster needs one', () => {
    expect(spellAimMode(spellFor('slow'), false)).toBe('area-targets');
    expect(spellAimMode(spellFor('fear'), true)).toBe('area-targets');
    expect(spellNeedsCaster(spellFor('slow'))).toBe(false);
    expect(spellNeedsCaster(spellFor('sleep'))).toBe(false);
    expect(spellNeedsCaster(spellFor('fear'))).toBe(true);
  });

  it('builds area-target settings with the placement and the picks', () => {
    const picked = ['goblin'];
    expect(buildSpellAim(spellFor('slow'), undefined, caster, { placement: area, picked })).toMatchObject({
      mode: 'area-targets',
      aim: 'point',
      area: { shape: AoeShape.Square, size: 40 },
      rangeFt: 120,
      caster: { x: 100, y: -50 },
      placement: area,
      pickedMarkerIds: picked
    });
    const fear = buildSpellAim(spellFor('fear'), undefined, caster)!;
    expect(fear).toMatchObject({ mode: 'area-targets', aim: 'direction', origin: { x: 100, y: -50 } });
    expect(fear.placement).toBeUndefined();
  });

  it('derives the picks: choose keeps ticked tokens inside, saves keeps everyone inside but the unticked', () => {
    expect(areaPickedMarkerIds('choose', ['a', 'b', 'c'], ['b', 'x'])).toEqual(['b']);
    expect(areaPickedMarkerIds('saves', ['a', 'b', 'c'], ['b', 'x'])).toEqual(['a', 'c']);
    // Moving the area away and back keeps the GM's choices
    expect(areaPickedMarkerIds('choose', [], ['b'])).toEqual([]);
    expect(areaPickedMarkerIds('choose', ['b'], ['b'])).toEqual(['b']);
    const inside = ['a', 'b'];
    expect(spellPickedMarkerIds(spellFor('slow'), { toggled: ['a'], inside, placement: null })).toEqual(['a']);
    expect(spellPickedMarkerIds(spellFor('fear'), { toggled: ['a'], inside, placement: null })).toEqual(['b']);
    expect(spellPickedMarkerIds(spellFor('bless'), { toggled: ['a', 'zzz'], inside, placement: null })).toEqual([
      'a',
      'zzz'
    ]);
  });

  it('prompts to place, then counts the creatures', () => {
    const slow = buildSpellAim(spellFor('slow'))!;
    expect(spellAimPrompt('Slow', slow)).toBe('Tap where to place Slow');
    expect(spellAimPrompt('Slow', slow, { mouse: true })).toBe('Click where to place Slow');
    const placed = buildSpellAim(spellFor('slow'), undefined, undefined, { placement: area })!;
    expect(spellAimPrompt('Slow', placed, { picked: 2, inside: 4 })).toBe('Slow: 2 of 4 creatures · drag to move');
    expect(spellAimPrompt('Slow', placed, { picked: 1, inside: 1 })).toBe('Slow: 1 of 1 creature · drag to move');
  });

  it('plays the area once with no beams, then writes one effect per creature under one concentration', () => {
    const { context, timers, upsertAoeTemplate, setMarkerFields, castOnPresence, stopCapturing } = harness();
    castSpell(context, { spellId: 'slow', placement: area, areaPlacement: area, caster, targets: [goblin, orc] });
    expect(castOnPresence).toHaveBeenCalledTimes(1);
    expect(castOnPresence.mock.calls[0][0]).toMatchObject({
      fx: 'zone',
      target: area.position,
      area: { size: 40 }
    });
    expect(upsertAoeTemplate).not.toHaveBeenCalled();
    expect(timers[0].delayMs).toBe(spellFor('slow').resolved.cast.durationMs * SUMMON_IMPACT_FRACTION);
    timers[0].run();
    const rows = upsertAoeTemplate.mock.calls.map((call) => call[1]);
    expect(rows.map((row) => [row.anchorMarkerId, row.spellId, row.effect])).toEqual([
      ['goblin', 'slow', AoeEffect.None],
      ['orc', 'slow', AoeEffect.None]
    ]);
    expect(setMarkerFields).toHaveBeenCalledTimes(1);
    expect(setMarkerFields.mock.calls[0][2].concentration.templateIds).toEqual(rows.map((row) => row.id));
    expect(stopCapturing).toHaveBeenCalledTimes(2);
  });

  it('lets an instant area pick expire like any instant spell', () => {
    const { context, timers, upsertAoeTemplate, setMarkerFields } = harness();
    castSpell(context, {
      spellId: 'mass-cure-wounds',
      placement: area,
      areaPlacement: area,
      caster,
      targets: [goblin]
    });
    timers[0].run();
    expect(upsertAoeTemplate.mock.calls[0][1].expiresAt).toBeGreaterThan(1_700_000_000);
    expect(setMarkerFields).not.toHaveBeenCalled();
  });
});
