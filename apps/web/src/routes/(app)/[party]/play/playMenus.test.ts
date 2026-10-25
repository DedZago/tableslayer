import type { MarkerRow } from '$lib/realtime';
import type { GroupedRows, GroupMember } from '$lib/utils/assetGroups';
import { AoeEffect, MARKER_CONDITION_CATEGORIES, type RadialMenuItemProps } from '@tableslayer/stage';
import { describe, expect, it } from 'vitest';
import {
  aoeMenu,
  conditionsItem,
  generalMenu,
  groupItems,
  MENU_ID,
  menuMembers,
  tokenMenu,
  type GeneralMenuState
} from './playMenus';

const marker = (id: string, overrides: Partial<MarkerRow> = {}): MarkerRow => ({
  id,
  sceneId: 's1',
  visibility: 1,
  title: id,
  label: null,
  imageLocation: null,
  imageScale: 1,
  positionX: 0,
  positionY: 0,
  shape: 1,
  shapeColor: '#fff',
  size: 1,
  note: null,
  pinnedTooltip: false,
  ...overrides
});

const ids = (items: RadialMenuItemProps[]) => items.map((item) => item.id);
const find = (items: RadialMenuItemProps[] | undefined, id: string) => items?.find((item) => item.id === id);

const idle: GeneralMenuState = {
  canUndo: false,
  canRedo: false,
  canFit: false,
  groupSelect: false,
  distanceMode: false,
  selectionCount: 0
};

describe('generalMenu', () => {
  it('offers the table tools with labels and hints', () => {
    const items = generalMenu(idle);
    expect(ids(items)).toEqual(['measure', 'distance', 'aoe', 'draw', 'select', 'undo', 'redo']);
    for (const item of items) {
      expect(item.label).not.toBe('');
      expect(item.hint).toBeTruthy();
    }
  });

  it('explains why undo is off and shows Fit and Clear only when they apply', () => {
    const items = generalMenu({ ...idle, canFit: true, selectionCount: 2 });
    expect(find(items, MENU_ID.undo)).toMatchObject({ disabled: true, hint: 'Nothing to undo' });
    expect(ids(items)).toContain(MENU_ID.fit);
    expect(ids(items)).toContain(MENU_ID.clearSelection);
  });

  it('keeps every ring small enough to read', () => {
    const check = (items: RadialMenuItemProps[]) => {
      expect(items.length).toBeLessThanOrEqual(10);
      items.forEach((item) => item.submenu && check(item.submenu));
    };
    check(generalMenu({ ...idle, canFit: true, selectionCount: 1 }));
    check(aoeMenu({ count: 1, effect: AoeEffect.Fire, opacity: 1, groupItems: [] }));
    check([conditionsItem([marker('a')], [])]);
  });
});

describe('conditionsItem', () => {
  it('groups conditions by category, with custom ones and New… last', () => {
    const custom = { id: 'custom:1', label: 'Hexed', color: '#f00' };
    const item = conditionsItem([marker('a')], [custom]);
    expect(item.submenu).toHaveLength(MARKER_CONDITION_CATEGORIES.length);
    expect(ids(find(item.submenu, 'condition-category:custom')!.submenu!)).toEqual([
      `${MENU_ID.condition}custom:1`,
      MENU_ID.newCondition
    ]);
  });

  it('marks active conditions, counts them per category and keeps the ring open on toggle', () => {
    const item = conditionsItem([marker('a', { conditions: [{ id: 'prone' }, { id: 'grappled' }] })], []);
    const movement = find(item.submenu, 'condition-category:movement')!;
    expect(movement.badge).toBe(2);
    expect(find(movement.submenu, `${MENU_ID.condition}prone`)).toMatchObject({ active: true, keepOpen: true });
    expect(item.badge).toBe(2);
  });

  it('hides GM-only conditions from the TV', () => {
    const item = conditionsItem([marker('a', { conditions: [{ id: 'prone', dmOnly: true }] })], []);
    const movement = find(item.submenu, 'condition-category:movement')!;
    expect(find(movement.submenu, `${MENU_ID.condition}prone`)?.active).toBe(false);
    expect(item.badge).toBeUndefined();
  });

  it('flags conditions only some tokens have', () => {
    const item = conditionsItem([marker('a', { conditions: [{ id: 'prone' }] }), marker('b')], []);
    const prone = find(find(item.submenu, 'condition-category:movement')!.submenu, `${MENU_ID.condition}prone`)!;
    expect(prone).toMatchObject({ active: false, badge: '•' });
    expect(prone.hint).toMatch(/^Some of these 2 tokens/);
  });

  it('opens exhaustion as levels, showing the current one', () => {
    const item = conditionsItem([marker('a', { conditions: [{ id: 'exhaustion', value: 3 }] })], []);
    const exhaustion = find(
      find(item.submenu, 'condition-category:debuffs')!.submenu,
      `${MENU_ID.condition}exhaustion`
    )!;
    expect(exhaustion.label).toBe('Exhaustion 3');
    expect(find(exhaustion.submenu, `${MENU_ID.exhaustionLevel}3`)?.active).toBe(true);
    expect(find(exhaustion.submenu, `${MENU_ID.exhaustionLevel}0`)?.disabled).toBe(false);
  });
});

describe('groupItems', () => {
  const rows: GroupedRows = {
    markers: [{ id: 'hero', groupId: 'g1' }, { id: 'mount', groupId: 'g2' }, { id: 'goblin' }],
    lights: [
      { id: 'torch', groupId: 'g1' },
      { id: 'lantern', groupId: 'g2' }
    ],
    aoeTemplates: [{ id: 'aura', groupId: 'g1' }]
  };
  const m = (id: string): GroupMember => ({ collection: 'markers', id });

  it('offers Group with… for an ungrouped item', () => {
    expect(ids(groupItems(rows, [m('goblin')]))).toEqual([MENU_ID.groupWith]);
  });

  it('offers Ungroup and Leave group for a member of a larger group', () => {
    expect(ids(groupItems(rows, [m('hero')]))).toEqual([MENU_ID.ungroup, MENU_ID.leaveGroup]);
  });

  it('offers only Ungroup when leaving would break a group of two', () => {
    expect(ids(groupItems(rows, [m('mount')]))).toEqual([MENU_ID.ungroup]);
  });

  it('follows the B rules for a selection', () => {
    expect(ids(groupItems(rows, [m('goblin'), m('mount'), { collection: 'lights', id: 'lantern' }]))).toEqual([
      MENU_ID.group
    ]);
    expect(
      ids(
        groupItems(rows, [m('hero'), { collection: 'lights', id: 'torch' }, { collection: 'aoeTemplates', id: 'aura' }])
      )
    ).toEqual([MENU_ID.ungroup]);
  });
});

describe('menuMembers', () => {
  const a: GroupMember = { collection: 'markers', id: 'a' };
  const b: GroupMember = { collection: 'aoeTemplates', id: 'b' };

  it('acts on the selection when it includes the pressed item', () => {
    expect(menuMembers(a, [a, b])).toEqual([a, b]);
  });

  it('acts on the pressed item alone otherwise', () => {
    expect(menuMembers(a, [b])).toEqual([a]);
    expect(menuMembers(a, [a])).toEqual([a]);
  });
});

describe('tokenMenu and aoeMenu', () => {
  it('offers distance and pin for one token only', () => {
    const one = tokenMenu({ markers: [marker('a')], customSuggestions: [], groupItems: [], selectionCount: 0 });
    expect(ids(one)).toEqual(['conditions', MENU_ID.distanceFrom, MENU_ID.pin]);
    const two = tokenMenu({
      markers: [marker('a'), marker('b')],
      customSuggestions: [],
      groupItems: [],
      selectionCount: 2
    });
    expect(ids(two)).toEqual(['conditions', MENU_ID.clearSelection]);
  });

  it('labels pin by its current state', () => {
    const items = tokenMenu({
      markers: [marker('a', { pinnedTooltip: true })],
      customSuggestions: [],
      groupItems: [],
      selectionCount: 0
    });
    expect(find(items, MENU_ID.pin)).toMatchObject({ label: 'Unpin name', active: true });
  });

  it('marks the current effect and opacity and ends with a danger delete', () => {
    const items = aoeMenu({ count: 1, effect: AoeEffect.Fire, opacity: 0.5, groupItems: [] });
    const damage = find(find(items, 'aoe-effect')!.submenu, 'aoe-effect-damage')!;
    expect(find(damage.submenu, `${MENU_ID.aoeEffect}${AoeEffect.Fire}`)?.active).toBe(true);
    expect(find(find(items, 'aoe-opacity')!.submenu, `${MENU_ID.aoeOpacity}0.5`)?.active).toBe(true);
    expect(items.at(-1)).toMatchObject({ id: MENU_ID.aoeDelete, danger: true });
  });
});
