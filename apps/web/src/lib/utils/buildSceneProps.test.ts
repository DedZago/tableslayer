import type { SelectLight, SelectMarker, SelectScene } from '$lib/db/app/schema';
import type { AoeTemplateRow } from '$lib/realtime/types';
import { GridMode, StageMode } from '@tableslayer/stage';
import { describe, expect, it } from 'vitest';
import { buildSceneProps, withAutoConditions } from './buildSceneProps';

const baseScene = {
  id: 'scene-1',
  gameSessionId: 'session-1',
  name: 'Test scene',
  order: 1,
  backgroundColor: '#0b0b0c',
  displayPaddingX: 16,
  displayPaddingY: 16,
  displaySizeX: 38.4,
  displaySizeY: 21.6,
  displayResolutionX: 1920,
  displayResolutionY: 1080,
  fogOfWarUrl: null,
  fogOfWarColor: '#CCC',
  fogOfWarOpacityDm: 0.5,
  fogOfWarOpacityPlayer: 0.9,
  mapLocation: null,
  mapThumbLocation: null,
  mapRotation: 0,
  mapOffsetX: 100,
  mapOffsetY: -50,
  mapZoom: 2,
  gridType: 0,
  gridMode: GridMode.MapDefined,
  gridMapDefinedX: 20,
  gridMapDefinedY: 14,
  mapCoordVersion: 0,
  gridSpacing: 1,
  gridOpacity: 0.8,
  gridLineColor: '#E6E6E6',
  gridLineThickness: 1,
  gridShadowColor: '#000000',
  gridShadowSpread: 2,
  gridShadowBlur: 0.5,
  gridShadowOpacity: 0.4,
  sceneOffsetX: 0,
  sceneOffsetY: 0,
  sceneRotation: 0,
  weatherFov: 60,
  weatherIntensity: 1,
  weatherOpacity: 1,
  weatherType: 0,
  fogEnabled: false,
  fogColor: '#a0a0a0',
  fogOpacity: 0.8,
  edgeEnabled: false,
  edgeUrl: null,
  edgeOpacity: 0.3,
  edgeScale: 2,
  edgeFadeStart: 0.2,
  edgeFadeEnd: 1,
  effectsEnabled: true,
  effectsBloomIntensity: 0,
  effectsBloomThreshold: 0.5,
  effectsBloomSmoothing: 0.3,
  effectsBloomRadius: 0.5,
  effectsBloomLevels: 10,
  effectsBloomMipMapBlur: true,
  effectsChromaticAberrationOffset: 0,
  effectsLutUrl: null,
  effectsToneMappingMode: 0,
  markerStrokeColor: '#000000',
  markerStrokeWidth: 50,
  markerTextColor: '#ffffff',
  markerTextStrokeColor: '#000000'
} as unknown as SelectScene;

const marker = {
  id: 'marker-1',
  sceneId: 'scene-1',
  visibility: 0,
  title: 'Token',
  label: 'A1',
  imageLocation: null,
  imageScale: 1,
  positionX: 300,
  positionY: 150,
  shape: 1,
  shapeColor: '#ffffff',
  size: 1,
  note: null,
  pinnedTooltip: false
} as unknown as SelectMarker;

const light = {
  id: 'light-1',
  sceneId: 'scene-1',
  positionX: 300,
  positionY: 150,
  radius: 2,
  color: '#ffffff',
  style: 'lantern',
  pulse: 1,
  opacity: 1
} as unknown as SelectLight;

describe('buildSceneProps coordinate conversion', () => {
  it('retains the stored image scale when rendering and converting a token', async () => {
    const { convertMarkerToDbFormat } = await import('./convertStagePropsToMarkerData');
    const props = buildSceneProps(baseScene, [{ ...marker, imageScale: 1.75, size: 2 }], 'editor');
    expect(props.marker.markers[0].imageScale).toBe(1.75);
    expect(convertMarkerToDbFormat(props.marker.markers[0], marker.sceneId).imageScale).toBe(1.75);
  });

  it('converts v0 MapDefined positions to map-local coordinates on read', () => {
    // (300,150) display px with map offset (100,-50), zoom 2 → (100,100) map px
    const props = buildSceneProps(baseScene, [marker], 'editor', [], [light]);
    expect(props.marker.markers[0].position.x).toBeCloseTo(100, 10);
    expect(props.marker.markers[0].position.y).toBeCloseTo(100, 10);
    expect(props.light.lights[0].position.x).toBeCloseTo(100, 10);
    expect(props.light.lights[0].position.y).toBeCloseTo(100, 10);
  });

  it('passes v1 MapDefined positions through untouched', () => {
    const scene = { ...baseScene, mapCoordVersion: 1 } as SelectScene;
    const props = buildSceneProps(scene, [marker], 'editor', [], [light]);
    expect(props.marker.markers[0].position).toEqual({ x: 300, y: 150 });
    expect(props.light.lights[0].position).toEqual({ x: 300, y: 150 });
  });

  it('never converts FillSpace positions, regardless of the version flag', () => {
    const scene = { ...baseScene, gridMode: GridMode.FillSpace, mapCoordVersion: 0 } as SelectScene;
    const props = buildSceneProps(scene, [marker], 'editor', [], [light]);
    expect(props.marker.markers[0].position).toEqual({ x: 300, y: 150 });
  });
});

describe('buildSceneProps fog rooms', () => {
  it('parses the fogOfWarRooms JSON into stage props', () => {
    const rooms = [
      {
        id: 'room-1',
        points: [
          { x: 0.1, y: 0.2 },
          { x: 0.5, y: 0.2 },
          { x: 0.3, y: 0.6 }
        ],
        enabled: true
      }
    ];
    const scene = { ...baseScene, fogOfWarRooms: JSON.stringify(rooms) } as SelectScene;
    const props = buildSceneProps(scene, [], 'editor');
    expect(props.fogOfWar.rooms).toEqual(rooms);
  });

  it('falls back to no rooms for missing or corrupt JSON', () => {
    expect(buildSceneProps(baseScene, [], 'editor').fogOfWar.rooms).toEqual([]);
    const corrupt = { ...baseScene, fogOfWarRooms: '{not json' } as SelectScene;
    expect(buildSceneProps(corrupt, [], 'editor').fogOfWar.rooms).toEqual([]);
  });
});

const aoeRow = (overrides: Partial<AoeTemplateRow> = {}): AoeTemplateRow => ({
  id: 'aoe-1',
  sceneId: 'scene-1',
  shape: 'cone',
  positionX: 300,
  positionY: 150,
  angle: 30,
  size: 15,
  width: 5,
  effect: 1,
  color: '#ff6a00',
  opacity: 0.6,
  visibility: StageMode.Player,
  label: 'Burning Hands',
  anchorMarkerId: null,
  createdAt: 1700000000,
  ...overrides
});

const markerWithHp = (average: number, hitPoints: number | null) =>
  ({
    ...marker,
    statBlock: { hp: { average } },
    hitPoints
  }) as unknown as SelectMarker;

describe('buildSceneProps conditions', () => {
  it('derives bloodied at or below half of the stat block max HP', () => {
    expect(buildSceneProps(baseScene, [markerWithHp(20, 10)], 'editor').marker.markers[0].conditions).toEqual([
      { id: 'bloodied' }
    ]);
  });

  it('does not derive bloodied above half, at zero, or without HP tracking', () => {
    expect(buildSceneProps(baseScene, [markerWithHp(20, 11)], 'editor').marker.markers[0].conditions).toEqual([]);
    expect(buildSceneProps(baseScene, [markerWithHp(20, 0)], 'editor').marker.markers[0].conditions).toEqual([]);
    expect(buildSceneProps(baseScene, [markerWithHp(20, null)], 'editor').marker.markers[0].conditions).toEqual([]);
  });

  it('keeps stored conditions and never duplicates bloodied', () => {
    const stored = [{ id: 'prone' }, { id: 'bloodied' }];
    expect(withAutoConditions(stored, { statBlock: { hp: { average: 20 } } as never, hitPoints: 5 })).toBe(stored);
    expect(
      withAutoConditions([{ id: 'prone' }], { statBlock: { hp: { average: 20 } } as never, hitPoints: 5 })
    ).toEqual([{ id: 'prone' }, { id: 'bloodied' }]);
  });

  it('defaults rows without a conditions value to none', () => {
    expect(buildSceneProps(baseScene, [marker], 'editor').marker.markers[0].conditions).toEqual([]);
  });

  it('drops GM-only conditions from player props but keeps them for the GM', () => {
    const conditions = [
      { id: 'prone' },
      { id: 'dead', dmOnly: true },
      { id: 'custom:1', label: 'Hexed', dmOnly: true }
    ];
    const row = { ...marker, conditions } as unknown as SelectMarker;
    expect(buildSceneProps(baseScene, [row], 'client').marker.markers[0].conditions).toEqual([{ id: 'prone' }]);
    expect(buildSceneProps(baseScene, [row], 'editor').marker.markers[0].conditions).toEqual(conditions);
  });
});

describe('buildSceneProps aoe templates', () => {
  it('maps rows to stage templates with the same v0 coordinate conversion as lights', () => {
    const props = buildSceneProps(baseScene, [], 'editor', [], [], undefined, [aoeRow()]);
    expect(props.aoeTemplates?.templates[0]).toMatchObject({
      id: 'aoe-1',
      shape: 'cone',
      position: { x: 100, y: 100 },
      angle: 30,
      size: 15,
      width: 5,
      effect: 1,
      label: 'Burning Hands'
    });
  });

  it('rotates angles of legacy display-space templates into map space', () => {
    const scene = { ...baseScene, mapRotation: 90 } as SelectScene;
    const props = buildSceneProps(scene, [], 'editor', [], [], undefined, [aoeRow()]);
    expect(props.aoeTemplates?.templates[0].angle).toBe(-60);
  });

  it('hides DM-only templates from player clients only', () => {
    const rows = [aoeRow({ id: 'gm', visibility: StageMode.DM }), aoeRow({ id: 'pl' })];
    expect(
      buildSceneProps(baseScene, [], 'client', [], [], undefined, rows).aoeTemplates?.templates.map((t) => t.id)
    ).toEqual(['pl']);
    expect(
      buildSceneProps(baseScene, [], 'editor', [], [], undefined, rows).aoeTemplates?.templates.map((t) => t.id)
    ).toEqual(['gm', 'pl']);
  });

  it('starts with no selection and a fresh default tool each call', () => {
    const first = buildSceneProps(baseScene, [], 'editor');
    const second = buildSceneProps(baseScene, [], 'editor');
    expect(first.aoeTemplates).toMatchObject({ templates: [], selectedId: null, showLabels: true });
    expect(first.aoeTemplates?.tool).not.toBe(second.aoeTemplates?.tool);
  });
});

describe('buildRenderProps drag preview of groups', () => {
  const groupedSnapshot = () =>
    ({
      id: 'scene-1',
      settings: { ...baseScene, mapCoordVersion: 1 },
      markers: [
        { ...marker, groupId: 'g1' },
        { ...marker, id: 'familiar', positionX: 320, groupId: 'g1' },
        { ...marker, id: 'dragged-too', positionX: 340, groupId: 'g1' }
      ],
      lights: [{ ...light, groupId: 'g1' }],
      aoeTemplates: [aoeRow({ groupId: 'g1' }), aoeRow({ id: 'aoe-2' })],
      annotations: []
    }) as unknown as Parameters<typeof import('$lib/realtime/buildRenderProps').buildRenderProps>[0];
  const positionOf = (items: Array<{ id: string; position: { x: number; y: number } }>, id: string) =>
    items.find((item) => item.id === id)!.position;

  it('moves the rest of a dragged token group by its live delta', async () => {
    const { buildRenderProps } = await import('$lib/realtime/buildRenderProps');
    const props = buildRenderProps(groupedSnapshot(), {
      mode: 'editor',
      markerPositions: { 'marker-1': { x: 310, y: 160 }, 'dragged-too': { x: 0, y: 0 } }
    });

    expect(positionOf(props.marker.markers, 'familiar')).toEqual({ x: 330, y: 160 });
    expect(positionOf(props.marker.markers, 'dragged-too')).toEqual({ x: 0, y: 0 });
    expect(positionOf(props.light.lights, 'light-1')).toEqual({ x: 310, y: 160 });
    expect(positionOf(props.aoeTemplates!.templates, 'aoe-1')).toEqual({ x: 310, y: 160 });
    expect(positionOf(props.aoeTemplates!.templates, 'aoe-2')).toEqual({ x: 300, y: 150 });
  });

  it('leaves the group in place while a detached token is dragged', async () => {
    const { buildRenderProps } = await import('$lib/realtime/buildRenderProps');
    const props = buildRenderProps(groupedSnapshot(), {
      mode: 'editor',
      markerPositions: { 'marker-1': { x: 310, y: 160 } },
      detachedMarkerId: 'marker-1'
    });

    expect(positionOf(props.marker.markers, 'marker-1')).toEqual({ x: 310, y: 160 });
    expect(positionOf(props.marker.markers, 'familiar')).toEqual({ x: 320, y: 150 });
    expect(positionOf(props.light.lights, 'light-1')).toEqual({ x: 300, y: 150 });
  });
});
