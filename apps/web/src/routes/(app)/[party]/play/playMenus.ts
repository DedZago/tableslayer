import type { MarkerRow } from '$lib/realtime';
import { AOE_EFFECT_SWATCHES } from '$lib/utils/aoeEffectSwatches';
import {
  expandToGroups,
  groupIdOf,
  groupMembers,
  planGroupToggle,
  type GroupedRows,
  type GroupMember
} from '$lib/utils/assetGroups';
import { CONDITION_CATEGORY_ICONS, conditionIcon } from '$lib/utils/conditionIcons';
import { conditionPickerState } from '$lib/utils/markerConditionPicker';
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconArrowsMaximize,
  IconBandage,
  IconCircle,
  IconCone2,
  IconContrast,
  IconDeselect,
  IconFlame,
  IconLine,
  IconLink,
  IconLinkOff,
  IconMountain,
  IconPaint,
  IconPalette,
  IconPencil,
  IconPin,
  IconPinnedOff,
  IconPlus,
  IconRectangleVertical,
  IconRuler,
  IconRuler2,
  IconSelectAll,
  IconSparkles,
  IconSquare,
  IconTrash,
  IconUnlink,
  IconX
} from '@tabler/icons-svelte';
import {
  AnnotationEffect,
  AOE_EFFECT_LABELS,
  AoeEffect,
  AoeShape,
  conditionIdsInCategory,
  MARKER_CONDITION_CATEGORIES,
  MARKER_CONDITIONS,
  resolveCondition,
  type MarkerCondition,
  type RadialMenuItemProps
} from '@tableslayer/stage';

// Item ids. Prefixed ids carry a value after the colon.
export const MENU_ID = {
  measureLine: 'measure-line',
  measureCircle: 'measure-circle',
  measureSquare: 'measure-square',
  measureCone: 'measure-cone:',
  measureBeam: 'measure-beam:',
  distance: 'distance',
  aoeShape: 'aoe-shape:',
  drawColor: 'draw-color:',
  drawEffect: 'draw-effect:',
  select: 'select',
  clearSelection: 'clear-selection',
  undo: 'undo',
  redo: 'redo',
  fit: 'fit',
  condition: 'cond:',
  exhaustionLevel: 'exhaustion:',
  newCondition: 'new-condition',
  group: 'group',
  ungroup: 'ungroup',
  leaveGroup: 'leave-group',
  groupWith: 'group-with',
  distanceFrom: 'distance-from',
  pin: 'pin',
  aoeEffect: 'aoe-effect:',
  aoeOpacity: 'aoe-opacity:',
  aoeDelete: 'aoe-delete'
} as const;

export const DRAW_COLORS = [
  { id: 'red', label: 'Red', color: '#d73e2e' },
  { id: 'orange', label: 'Orange', color: '#ffa500' },
  { id: 'yellow', label: 'Yellow', color: '#ffd93d' },
  { id: 'green', label: 'Green', color: '#6bcf7f' },
  { id: 'blue', label: 'Blue', color: '#2e86ab' },
  { id: 'purple', label: 'Purple', color: '#b197fc' }
];

export const DRAW_EFFECTS = [
  { effect: AnnotationEffect.Fire, label: 'Fire', hint: 'Flames that flicker' },
  { effect: AnnotationEffect.Water, label: 'Water', hint: 'Rippling water' },
  { effect: AnnotationEffect.Ice, label: 'Ice', hint: 'Frozen ground' },
  { effect: AnnotationEffect.Magic, label: 'Magic', hint: 'Shimmering arcane glow' },
  { effect: AnnotationEffect.Grease, label: 'Grease', hint: 'Slick, slippery ground' },
  { effect: AnnotationEffect.SpaceTear, label: 'Space tear', hint: 'A rift in reality' },
  { effect: AnnotationEffect.Web, label: 'Web', hint: 'Sticky webbing' },
  { effect: AnnotationEffect.Entangle, label: 'Entangle', hint: 'Grasping vines' }
];

const AOE_DAMAGE_EFFECTS = [
  AoeEffect.Fire,
  AoeEffect.Lightning,
  AoeEffect.Frost,
  AoeEffect.Acid,
  AoeEffect.Radiant,
  AoeEffect.Necrotic,
  AoeEffect.Force,
  AoeEffect.PoisonGas
];
const AOE_TERRAIN_EFFECTS = [
  AoeEffect.None,
  AoeEffect.Thorns,
  AoeEffect.Mud,
  AoeEffect.Darkness,
  AoeEffect.FogCloud,
  AoeEffect.Web,
  AoeEffect.Grease,
  AoeEffect.Water,
  AoeEffect.SleetStorm,
  AoeEffect.InsectSwarm
];

const AOE_SHAPES = [
  { shape: AoeShape.Circle, label: 'Circle', hint: 'Sphere, cylinder or emanation', icon: IconCircle },
  { shape: AoeShape.Square, label: 'Cube', hint: 'Cube or square area', icon: IconSquare },
  { shape: AoeShape.Cone, label: 'Cone', hint: 'Spreads out from the caster', icon: IconCone2 },
  { shape: AoeShape.Line, label: 'Line', hint: 'Long, narrow line', icon: IconRectangleVertical }
];

const CUSTOM_CONDITIONS_SHOWN = 7;
const EXHAUSTION_MAX = MARKER_CONDITIONS.exhaustion.maxValue ?? 6;

/** What a TV long press acts on */
export type MenuTarget =
  | { kind: 'general' }
  | { kind: 'token'; markerId: string; members: GroupMember[] }
  | { kind: 'aoe'; aoeId: string; members: GroupMember[] };

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

/** The TV never sees GM-only conditions, so they count as absent */
export const playerConditionRows = (rows: MarkerRow[]): MarkerRow[] =>
  rows.map((row) => ({ ...row, conditions: (row.conditions ?? []).filter((condition) => !condition.dmOnly) }));

export const conditionsItem = (rows: MarkerRow[], customSuggestions: MarkerCondition[]): RadialMenuItemProps => {
  const state = conditionPickerState(playerConditionRows(rows));
  const activeById = new Map(state.active.map((condition) => [condition.id, condition]));
  const isOn = (id: string) => activeById.has(id) || state.automatic.has(id);
  const tokens = rows.length === 1 ? 'this token' : `these ${rows.length} tokens`;

  const conditionItem = (condition: MarkerCondition): RadialMenuItemProps => {
    const info = resolveCondition(condition);
    const automatic = state.automatic.has(condition.id) && !activeById.has(condition.id);
    const mixed = state.mixed.has(condition.id);
    const hint = automatic
      ? `${info.description} Set automatically from hit points.`
      : mixed
        ? `Some of ${tokens} have it. ${info.description}`
        : info.description;
    return {
      id: `${MENU_ID.condition}${condition.id}`,
      label: info.label,
      hint,
      icon: conditionIcon(condition.id),
      accent: info.color,
      active: isOn(condition.id),
      badge: mixed ? '•' : undefined,
      disabled: automatic,
      keepOpen: true
    };
  };

  const exhaustionItem = (): RadialMenuItemProps => {
    const level = activeById.get('exhaustion')?.value;
    const info = MARKER_CONDITIONS.exhaustion;
    const levels = Array.from({ length: EXHAUSTION_MAX }, (_, index) => index + 1).map((value) => ({
      id: `${MENU_ID.exhaustionLevel}${value}`,
      label: `Level ${value}`,
      hint: value === EXHAUSTION_MAX ? 'Dies.' : `−${value * 2} to d20 tests, −${value * 5} ft speed.`,
      icon: conditionIcon('exhaustion'),
      accent: info.color,
      badge: value,
      active: level === value,
      keepOpen: true
    }));
    return {
      ...conditionItem({ id: 'exhaustion' }),
      label: level ? `Exhaustion ${level}` : info.label,
      badge: level ?? (state.mixed.has('exhaustion') ? '•' : undefined),
      submenu: [
        ...levels,
        {
          id: `${MENU_ID.exhaustionLevel}0`,
          label: 'Remove',
          hint: 'Clear exhaustion',
          icon: IconX,
          danger: true,
          disabled: !activeById.has('exhaustion') && !state.mixed.has('exhaustion'),
          keepOpen: true
        }
      ]
    };
  };

  const customConditions = [...state.active, ...customSuggestions]
    .filter((condition, index, list) => {
      if (resolveCondition(condition).category !== 'custom') return false;
      return list.findIndex((other) => other.id === condition.id) === index;
    })
    .slice(0, CUSTOM_CONDITIONS_SHOWN);

  const categoryItems = MARKER_CONDITION_CATEGORIES.map((category): RadialMenuItemProps => {
    const conditions: MarkerCondition[] =
      category.id === 'custom' ? customConditions : conditionIdsInCategory(category.id).map((id) => ({ id }));
    const onCount = conditions.filter((condition) => isOn(condition.id)).length;
    const submenu = conditions.map((condition) =>
      condition.id === 'exhaustion' ? exhaustionItem() : conditionItem(condition)
    );
    if (category.id === 'custom') {
      submenu.push({
        id: MENU_ID.newCondition,
        label: 'New…',
        hint: 'Name a status and pick its color',
        icon: IconPlus
      });
    }
    return {
      id: `condition-category:${category.id}`,
      label: category.label,
      hint: onCount ? `${category.description} ${onCount} on ${tokens}.` : category.description,
      icon: CONDITION_CATEGORY_ICONS[category.id],
      accent: category.color,
      badge: onCount || undefined,
      submenu
    };
  });

  const total = state.active.length + state.automatic.size;
  return {
    id: 'conditions',
    label: 'Conditions',
    hint: total ? `${total} on ${tokens}. Add or remove statuses.` : `Add statuses to ${tokens}`,
    icon: IconBandage,
    badge: total || undefined,
    submenu: categoryItems
  };
};

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

/** Group options for what the menu acts on, following the editor's B rules */
export const groupItems = (rows: GroupedRows, members: GroupMember[]): RadialMenuItemProps[] => {
  if (members.length >= 2) {
    const plan = planGroupToggle(rows, members, () => 'new');
    if (plan.kind === 'group') {
      return [
        {
          id: MENU_ID.group,
          label: 'Group',
          hint: `Move these ${plan.members.length} together`,
          icon: IconLink
        }
      ];
    }
    if (plan.kind === 'ungroup' && plan.whole) {
      return [
        { id: MENU_ID.ungroup, label: 'Ungroup', hint: 'Split the group; each piece moves alone', icon: IconLinkOff }
      ];
    }
    return [];
  }
  const [member] = members;
  if (!member) return [];
  const groupId = groupIdOf(rows, member);
  const group = groupId ? groupMembers(rows, groupId) : [];
  if (group.length < 2) {
    return [
      {
        id: MENU_ID.groupWith,
        label: 'Group with…',
        hint: 'Pick tokens and areas that move with it, then hold one and tap Group',
        icon: IconLink
      }
    ];
  }
  const items: RadialMenuItemProps[] = [
    {
      id: MENU_ID.ungroup,
      label: 'Ungroup',
      hint: `Split the group of ${group.length}; each piece moves alone`,
      icon: IconLinkOff
    }
  ];
  if (group.length > 2) {
    items.push({
      id: MENU_ID.leaveGroup,
      label: 'Leave group',
      hint: 'Only this one stops moving with the group',
      icon: IconUnlink
    });
  }
  return items;
};

/** A long press acts on the selection when it includes the pressed item, otherwise on that item alone */
export const menuMembers = (pressed: GroupMember, selection: GroupMember[]): GroupMember[] =>
  selection.some((member) => member.collection === pressed.collection && member.id === pressed.id) &&
  selection.length > 1
    ? selection
    : [pressed];

export const groupSelectionFor = (rows: GroupedRows, member: GroupMember) => expandToGroups(rows, [member]);

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

export type GeneralMenuState = {
  canUndo: boolean;
  canRedo: boolean;
  canFit: boolean;
  groupSelect: boolean;
  distanceMode: boolean;
  selectionCount: number;
};

const clearSelectionItem = (count: number): RadialMenuItemProps => ({
  id: MENU_ID.clearSelection,
  label: 'Clear',
  hint: `Deselect ${count === 1 ? 'the selected item' : `all ${count} selected items`}`,
  icon: IconDeselect
});

export const generalMenu = (state: GeneralMenuState): RadialMenuItemProps[] => {
  const items: RadialMenuItemProps[] = [
    {
      id: 'measure',
      label: 'Measure',
      hint: 'Drag to measure a distance or an area',
      icon: IconRuler,
      submenu: [
        { id: MENU_ID.measureLine, label: 'Line', hint: 'Straight distance between two points', icon: IconLine },
        { id: MENU_ID.measureCircle, label: 'Circle', hint: 'Radius around a point', icon: IconCircle },
        { id: MENU_ID.measureSquare, label: 'Square', hint: 'Square or cube area', icon: IconSquare },
        {
          id: 'measure-cone',
          label: 'Cone',
          hint: 'Pick the cone angle',
          icon: IconCone2,
          submenu: [30, 60, 90].map((angle) => ({
            id: `${MENU_ID.measureCone}${angle}`,
            label: `${angle}°`,
            hint: `Cone ${angle}° wide`,
            icon: IconCone2
          }))
        },
        {
          id: 'measure-beam',
          label: 'Beam',
          hint: 'Pick the beam width',
          icon: IconRectangleVertical,
          submenu: [5, 10, 15, 20].map((width) => ({
            id: `${MENU_ID.measureBeam}${width}`,
            label: `${width} ft`,
            hint: `Beam ${width} ft wide`,
            icon: IconRectangleVertical
          }))
        }
      ]
    },
    {
      id: MENU_ID.distance,
      label: state.distanceMode ? 'Stop distances' : 'Distance',
      hint: state.distanceMode ? 'Hide token distances' : 'Tap a token to see how far every other token is',
      icon: IconRuler2,
      active: state.distanceMode
    },
    {
      id: 'aoe',
      label: 'AoE',
      hint: 'Place a spell area, then drag on the map',
      icon: IconCone2,
      submenu: AOE_SHAPES.map(({ shape, label, hint, icon }) => ({
        id: `${MENU_ID.aoeShape}${shape}`,
        label,
        hint,
        icon
      }))
    },
    {
      id: 'draw',
      label: 'Draw',
      hint: 'Temporary drawing that fades after a while',
      icon: IconPencil,
      submenu: [
        {
          id: 'draw-colors',
          label: 'Color',
          hint: 'Draw a plain line',
          icon: IconPaint,
          submenu: DRAW_COLORS.map(({ id, label, color }) => ({
            id: `${MENU_ID.drawColor}${id}`,
            label,
            hint: `Draw in ${label.toLowerCase()}`,
            color
          }))
        },
        {
          id: 'draw-effects',
          label: 'Effect',
          hint: 'Paint an animated effect',
          icon: IconSparkles,
          submenu: DRAW_EFFECTS.map(({ effect, label, hint }) => ({
            id: `${MENU_ID.drawEffect}${effect}`,
            label,
            hint,
            effectType: effect
          }))
        }
      ]
    },
    {
      id: MENU_ID.select,
      label: state.groupSelect ? 'Stop selecting' : 'Select',
      hint: state.groupSelect ? 'Leave selection mode' : 'Tap or drag around tokens and areas to pick several',
      icon: IconSelectAll,
      active: state.groupSelect
    }
  ];
  if (state.selectionCount > 0) items.push(clearSelectionItem(state.selectionCount));
  items.push(
    {
      id: MENU_ID.undo,
      label: 'Undo',
      hint: state.canUndo ? 'Undo the last change made on this screen' : 'Nothing to undo',
      icon: IconArrowBackUp,
      disabled: !state.canUndo,
      keepOpen: true
    },
    {
      id: MENU_ID.redo,
      label: 'Redo',
      hint: state.canRedo ? 'Redo what was undone' : 'Nothing to redo',
      icon: IconArrowForwardUp,
      disabled: !state.canRedo,
      keepOpen: true
    }
  );
  if (state.canFit) {
    items.push({ id: MENU_ID.fit, label: 'Fit view', hint: 'Reset zoom and pan', icon: IconArrowsMaximize });
  }
  return items;
};

export type TokenMenuState = {
  markers: MarkerRow[];
  customSuggestions: MarkerCondition[];
  groupItems: RadialMenuItemProps[];
  selectionCount: number;
};

export const tokenMenu = (state: TokenMenuState): RadialMenuItemProps[] => {
  const items = [conditionsItem(state.markers, state.customSuggestions), ...state.groupItems];
  if (state.markers.length === 1) {
    const [marker] = state.markers;
    items.push(
      {
        id: MENU_ID.distanceFrom,
        label: 'Distance',
        hint: 'Show how far every other token is from this one',
        icon: IconRuler2
      },
      {
        id: MENU_ID.pin,
        label: marker.pinnedTooltip ? 'Unpin name' : 'Pin name',
        hint: marker.pinnedTooltip ? 'Show the name only when tapped' : 'Keep the name visible on the map',
        icon: marker.pinnedTooltip ? IconPinnedOff : IconPin,
        active: marker.pinnedTooltip
      }
    );
  }
  if (state.selectionCount > 0) items.push(clearSelectionItem(state.selectionCount));
  return items;
};

export type AoeMenuState = {
  count: number;
  /** Undefined when the selected shapes differ */
  effect: AoeEffect | undefined;
  opacity: number | undefined;
  groupItems: RadialMenuItemProps[];
};

const aoeEffectItem = (effect: AoeEffect, current: AoeEffect | undefined): RadialMenuItemProps => ({
  id: `${MENU_ID.aoeEffect}${effect}`,
  label: AOE_EFFECT_LABELS[effect],
  hint: effect === AoeEffect.None ? 'Plain colored area' : `${AOE_EFFECT_LABELS[effect]} effect`,
  color: AOE_EFFECT_SWATCHES[effect],
  active: effect === current,
  keepOpen: true
});

export const aoeMenu = (state: AoeMenuState): RadialMenuItemProps[] => {
  const shapes = state.count === 1 ? 'this area' : `these ${state.count} areas`;
  return [
    {
      id: 'aoe-effect',
      label: 'Effect',
      hint: `Change how ${shapes} look`,
      icon: IconPalette,
      submenu: [
        {
          id: 'aoe-effect-damage',
          label: 'Damage',
          hint: 'Fire, lightning, frost, acid…',
          icon: IconFlame,
          submenu: AOE_DAMAGE_EFFECTS.map((effect) => aoeEffectItem(effect, state.effect))
        },
        {
          id: 'aoe-effect-terrain',
          label: 'Terrain',
          hint: 'Darkness, fog, web, mud…',
          icon: IconMountain,
          submenu: AOE_TERRAIN_EFFECTS.map((effect) => aoeEffectItem(effect, state.effect))
        }
      ]
    },
    {
      id: 'aoe-opacity',
      label: 'Opacity',
      hint: `Make ${shapes} lighter or stronger`,
      icon: IconContrast,
      submenu: [0.25, 0.5, 0.75, 1].map((opacity) => ({
        id: `${MENU_ID.aoeOpacity}${opacity}`,
        label: `${opacity * 100}%`,
        hint: opacity === 1 ? 'Fully opaque' : `${opacity * 100}% opaque`,
        icon: IconContrast,
        active: state.opacity === opacity,
        keepOpen: true
      }))
    },
    ...state.groupItems,
    { id: MENU_ID.aoeDelete, label: 'Delete', hint: `Remove ${shapes}`, icon: IconTrash, danger: true }
  ];
};
