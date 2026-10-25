export type GroupCollection = 'markers' | 'lights' | 'aoeTemplates';
export type GroupMember = { collection: GroupCollection; id: string };

type GroupedRow = { id: string; groupId?: string | null };
export type GroupedRows = Record<GroupCollection, GroupedRow[]>;

export const GROUP_COLLECTIONS: readonly GroupCollection[] = ['markers', 'lights', 'aoeTemplates'];

export const memberKey = (member: GroupMember) => `${member.collection}:${member.id}`;

const includesMember = (members: GroupMember[], member: GroupMember) =>
  members.some((other) => other.collection === member.collection && other.id === member.id);

export const sameMembers = (a: GroupMember[], b: GroupMember[]) =>
  a.length === b.length && a.every((member) => includesMember(b, member));

export const groupIdOf = (rows: GroupedRows, member: GroupMember): string | null =>
  rows[member.collection].find((row) => row.id === member.id)?.groupId ?? null;

/** A group's members in click-cycle order: tokens, then lights, then AoEs */
export const groupMembers = (rows: GroupedRows, groupId: string): GroupMember[] =>
  GROUP_COLLECTIONS.flatMap((collection) =>
    rows[collection].filter((row) => row.groupId === groupId).map((row) => ({ collection, id: row.id }))
  );

// A group left with one member (the others were deleted) behaves like an ungrouped item
const groupOf = (rows: GroupedRows, member: GroupMember): GroupMember[] | null => {
  const groupId = groupIdOf(rows, member);
  const members = groupId ? groupMembers(rows, groupId) : [];
  return members.length > 1 ? members : null;
};

/** Every item brings its whole group along */
export const expandToGroups = (rows: GroupedRows, items: GroupMember[]): GroupMember[] => {
  const expanded: GroupMember[] = [];
  for (const item of items) {
    for (const member of groupOf(rows, item) ?? [item]) {
      if (!includesMember(expanded, member)) expanded.push(member);
    }
  }
  return expanded;
};

/** A plain click on a grouped item selects the whole group, then each member in turn, then the group again */
export const cycleGroupSelection = (rows: GroupedRows, clicked: GroupMember, selected: GroupMember[]) => {
  const members = groupOf(rows, clicked);
  if (!members) return [clicked];
  if (sameMembers(selected, members)) return [members[0]];
  const index =
    selected.length === 1 ? members.findIndex((member) => memberKey(member) === memberKey(selected[0])) : -1;
  if (index === -1 || index === members.length - 1) return members;
  return [members[index + 1]];
};

/** Shift+click adds an item's whole group, or removes it when the group is already selected */
export const toggleGroupInSelection = (rows: GroupedRows, clicked: GroupMember, selected: GroupMember[]) => {
  const members = groupOf(rows, clicked) ?? [clicked];
  if (members.every((member) => includesMember(selected, member))) {
    return selected.filter((member) => !includesMember(members, member));
  }
  return expandToGroups(rows, [...selected, ...members]);
};

export type GroupPlan =
  | { kind: 'empty' }
  | { kind: 'single' }
  | { kind: 'ungroup'; members: GroupMember[]; whole: boolean }
  | { kind: 'group'; groupId: string; members: GroupMember[] };

/**
 * What B does with the selection. A whole group selected alone is ungrouped; one member picked out
 * of its group (by cycling) leaves it, dissolving a group that would be left with one member.
 * Anything else becomes one group, merging the groups it touches.
 */
export const planGroupToggle = (rows: GroupedRows, selected: GroupMember[], newGroupId: () => string): GroupPlan => {
  if (selected.length === 0) return { kind: 'empty' };

  const [first] = selected;
  const firstGroup = groupOf(rows, first);
  if (selected.length === 1) {
    if (!firstGroup) return { kind: 'single' };
    const rest = firstGroup.filter((member) => memberKey(member) !== memberKey(first));
    return rest.length < 2
      ? { kind: 'ungroup', members: firstGroup, whole: true }
      : { kind: 'ungroup', members: [first], whole: false };
  }
  if (firstGroup && sameMembers(selected, firstGroup)) return { kind: 'ungroup', members: firstGroup, whole: true };

  const members = expandToGroups(rows, selected);
  const existing = selected.find((member) => groupOf(rows, member));
  const groupId = (existing && groupIdOf(rows, existing)) || newGroupId();
  return { kind: 'group', groupId, members };
};
