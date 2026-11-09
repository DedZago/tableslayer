import { QUICK_SCENES, type RadialMenuItemProps, type StageProps } from '@tableslayer/stage';
import { describe, expect, it } from 'vitest';
import { applyQuickScene, nudgeSlotIntensity, setSlotEffect } from './atmosphereActions';
import { atmosphereMenuItem, parseAtmosphereMenuId, type AtmosphereMenuState } from './atmosphereMenus';

const state: AtmosphereMenuState = {
  weather: { type: 11, intensity: 0.5 },
  lighting: { type: 3, intensity: 1 },
  ambience: { type: 0, intensity: 1 }
};

const walk = (items: RadialMenuItemProps[] = []): RadialMenuItemProps[] =>
  items.flatMap((item) => [item, ...walk(item.submenu)]);
const rings = (item: RadialMenuItemProps): RadialMenuItemProps[][] =>
  item.submenu ? [item.submenu, ...item.submenu.flatMap(rings)] : [];

const makeProps = () =>
  ({
    weather: { type: 0, intensity: 1, lighting: { type: 0, intensity: 1 }, ambience: { type: 0, intensity: 1 } }
  }) as unknown as StageProps;

describe('atmosphereMenuItem', () => {
  const root = atmosphereMenuItem(state);

  it('keeps every ring to eight items or fewer', () => {
    for (const ring of rings(root)) expect(ring.length).toBeLessThanOrEqual(8);
  });

  it('prefixes every id and keeps them unique', () => {
    const ids = [root, ...walk(root.submenu)].map((item) => item.id);
    expect(ids.every((id) => id.startsWith('gm-atmo'))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('marks the current effects and its category as active', () => {
    const all = walk(root.submenu);
    expect(all.find((item) => item.id === 'gm-atmo:effect:weather:11')?.active).toBe(true);
    expect(all.find((item) => item.id === 'gm-atmo:effect:weather:1')?.active).toBe(false);
    expect(all.find((item) => item.id === 'gm-atmo:category:weather:rain')?.active).toBe(true);
    expect(all.find((item) => item.id === 'gm-atmo:off:ambience')?.active).toBe(true);
  });

  it('offers every quick scene once', () => {
    const sceneIds = walk(root.submenu).filter((item) => item.id.startsWith('gm-atmo:scene:'));
    expect(sceneIds).toHaveLength(QUICK_SCENES.length);
  });
});

describe('parseAtmosphereMenuId', () => {
  it('parses actions and ignores ring parents and foreign ids', () => {
    expect(parseAtmosphereMenuId('gm-atmo:effect:lighting:3')).toEqual({ kind: 'effect', slot: 'lighting', type: 3 });
    expect(parseAtmosphereMenuId('gm-atmo:off:weather')).toEqual({ kind: 'off', slot: 'weather' });
    expect(parseAtmosphereMenuId('gm-atmo:intensity:ambience:down')).toEqual({
      kind: 'intensity',
      slot: 'ambience',
      delta: -0.25
    });
    expect(parseAtmosphereMenuId('gm-atmo:scene:stormy-night')).toEqual({ kind: 'scene', sceneId: 'stormy-night' });
    expect(parseAtmosphereMenuId('gm-atmo:clear')).toEqual({ kind: 'clear' });
    expect(parseAtmosphereMenuId('gm-atmo:intensity:weather')).toBeNull();
    expect(parseAtmosphereMenuId('gm-atmo:effect:sky:3')).toBeNull();
    expect(parseAtmosphereMenuId('measure-line')).toBeNull();
  });
});

describe('atmosphere actions', () => {
  it('writes the three slots of a quick scene', () => {
    const props = makeProps();
    const scene = QUICK_SCENES.find((candidate) => candidate.id === 'stormy-night')!;
    applyQuickScene(props, scene);
    expect(props.weather.type).toBe(scene.weather);
    expect(props.weather.lighting?.type).toBe(scene.lighting);
    expect(props.weather.ambience?.type).toBe(scene.ambience);
  });

  it('unmutes a slot at zero intensity when an effect is picked, and keeps zero otherwise', () => {
    const props = makeProps();
    props.weather.lighting = { type: 0, intensity: 0 };
    setSlotEffect(props, 'lighting', 3);
    expect(props.weather.lighting).toEqual({ type: 3, intensity: 1 });
    nudgeSlotIntensity(props, 'lighting', -2);
    expect(props.weather.lighting.intensity).toBe(0);
  });
});
