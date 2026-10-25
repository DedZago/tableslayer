import { describe, expect, it } from 'vitest';
import {
  cycleGroupSelection,
  expandToGroups,
  planGroupToggle,
  toggleGroupInSelection,
  type GroupMember,
  type GroupedRows
} from './assetGroups';

const rows: GroupedRows = {
  markers: [
    { id: 'hero', groupId: 'g1' },
    { id: 'goblin' },
    { id: 'orc', groupId: 'g2' },
    { id: 'lonely', groupId: 'g3' }
  ],
  lights: [
    { id: 'torch', groupId: 'g1' },
    { id: 'lamp', groupId: 'g2' }
  ],
  aoeTemplates: [{ id: 'aura', groupId: 'g1' }, { id: 'cloud' }]
};

const hero: GroupMember = { collection: 'markers', id: 'hero' };
const torch: GroupMember = { collection: 'lights', id: 'torch' };
const aura: GroupMember = { collection: 'aoeTemplates', id: 'aura' };
const goblin: GroupMember = { collection: 'markers', id: 'goblin' };
const orc: GroupMember = { collection: 'markers', id: 'orc' };
const lamp: GroupMember = { collection: 'lights', id: 'lamp' };
const lonely: GroupMember = { collection: 'markers', id: 'lonely' };
const g1 = [hero, torch, aura];

describe('cycleGroupSelection', () => {
  it('selects the whole group first, from any member', () => {
    expect(cycleGroupSelection(rows, aura, [])).toEqual(g1);
    expect(cycleGroupSelection(rows, torch, [goblin])).toEqual(g1);
  });

  it('then walks the members in order and returns to the group', () => {
    expect(cycleGroupSelection(rows, hero, g1)).toEqual([hero]);
    expect(cycleGroupSelection(rows, hero, [hero])).toEqual([torch]);
    expect(cycleGroupSelection(rows, hero, [torch])).toEqual([aura]);
    expect(cycleGroupSelection(rows, hero, [aura])).toEqual(g1);
  });

  it('selects ungrouped items and groups of one on their own', () => {
    expect(cycleGroupSelection(rows, goblin, g1)).toEqual([goblin]);
    expect(cycleGroupSelection(rows, lonely, [])).toEqual([lonely]);
  });
});

describe('expandToGroups and toggleGroupInSelection', () => {
  it('brings whole groups along without duplicates', () => {
    expect(expandToGroups(rows, [torch, goblin, hero])).toEqual([...g1, goblin]);
  });

  it('adds a group, then removes it', () => {
    const added = toggleGroupInSelection(rows, aura, [goblin]);
    expect(added).toEqual([goblin, ...g1]);
    expect(toggleGroupInSelection(rows, hero, added)).toEqual([goblin]);
  });
});

describe('planGroupToggle', () => {
  const newId = () => 'new';

  it('groups ungrouped items under a new id', () => {
    expect(planGroupToggle(rows, [goblin, { collection: 'aoeTemplates', id: 'cloud' }], newId)).toEqual({
      kind: 'group',
      groupId: 'new',
      members: [goblin, { collection: 'aoeTemplates', id: 'cloud' }]
    });
  });

  it('expands a group, merging every group it touches', () => {
    expect(planGroupToggle(rows, [...g1, goblin, orc, lamp], newId)).toEqual({
      kind: 'group',
      groupId: 'g1',
      members: [...g1, goblin, orc, lamp]
    });
  });

  it('ungroups a whole group selected alone', () => {
    expect(planGroupToggle(rows, g1, newId)).toEqual({ kind: 'ungroup', members: g1, whole: true });
  });

  it('takes a single cycled member out of its group', () => {
    expect(planGroupToggle(rows, [torch], newId)).toEqual({ kind: 'ungroup', members: [torch], whole: false });
  });

  it('dissolves a group that would be left with one member', () => {
    expect(planGroupToggle(rows, [lamp], newId)).toEqual({ kind: 'ungroup', members: [orc, lamp], whole: true });
  });

  it('has nothing to do with no selection or one ungrouped item', () => {
    expect(planGroupToggle(rows, [], newId)).toEqual({ kind: 'empty' });
    expect(planGroupToggle(rows, [goblin], newId)).toEqual({ kind: 'single' });
    expect(planGroupToggle(rows, [lonely], newId)).toEqual({ kind: 'single' });
  });
});
