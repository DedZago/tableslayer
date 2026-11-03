import { spellMenuItem, type SpellMenuState } from '$lib/utils/spellMenus';
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconArrowsMaximize,
  IconBooks,
  IconCircleDashed,
  IconEye,
  IconEyeOff,
  IconPresentation,
  IconSwords,
  IconTrash
} from '@tabler/icons-svelte';
import { MarkerVisibility, resolveCondition, StageMode, type RadialMenuItemProps } from '@tableslayer/stage';
import {
  aoeMenu,
  aoeShapesItem,
  measureItem,
  MENU_ID,
  tokenMenu,
  type AoeMenuState,
  type TokenMenuState
} from '../../play/playMenus';

/** Ids only the GM's rings carry; the player's rings in playMenus.ts never offer them */
export const GM_MENU_ID = {
  visibility: 'gm-visibility:',
  aoeVisibility: 'gm-aoe-visibility:',
  hideCondition: 'gm-hide-condition:',
  clearConditions: 'gm-clear-conditions',
  combat: 'gm-combat:',
  handout: 'gm-handout',
  saveToLibrary: 'gm-save-to-library',
  deleteTokens: 'gm-delete-tokens'
} as const;

export interface EditorMenuState {
  canUndo: boolean;
  canRedo: boolean;
  spells: SpellMenuState;
}

/** The ring a right-click on empty map opens: the TV's tools that apply to the GM's editor */
export const editorGeneralMenu = ({ canUndo, canRedo, spells }: EditorMenuState): RadialMenuItemProps[] => [
  measureItem,
  aoeShapesItem,
  spellMenuItem(spells),
  {
    id: MENU_ID.undo,
    label: 'Undo',
    hint: canUndo ? 'Undo the last change' : 'Nothing to undo',
    icon: IconArrowBackUp,
    disabled: !canUndo,
    keepOpen: true
  },
  {
    id: MENU_ID.redo,
    label: 'Redo',
    hint: canRedo ? 'Redo what was undone' : 'Nothing to redo',
    icon: IconArrowForwardUp,
    disabled: !canRedo,
    keepOpen: true
  },
  { id: MENU_ID.fit, label: 'Fit view', hint: 'Reset zoom and pan', icon: IconArrowsMaximize }
];

const TOKEN_VISIBILITIES = [
  { value: MarkerVisibility.DM, label: 'GM only', hint: 'Players never see it', icon: IconEyeOff },
  { value: MarkerVisibility.Always, label: 'Everyone', hint: "Always on the players' map", icon: IconEye },
  { value: MarkerVisibility.Hover, label: 'On hover', hint: 'Shown while the GM hovers it', icon: IconCircleDashed }
];

export interface GmTokenMenuState extends Omit<TokenMenuState, 'gm'> {
  /** Undefined when the selected tokens differ */
  visibility: MarkerVisibility | undefined;
  combat: { running: boolean; inCombat: number };
  canShowHandout: boolean;
  canSaveToLibrary: boolean;
}

const combatItems = ({ running, inCombat }: GmTokenMenuState['combat'], count: number): RadialMenuItemProps[] => {
  const action = (type: 'start' | 'add' | 'remove', label: string, hint: string): RadialMenuItemProps => ({
    id: `${GM_MENU_ID.combat}${type}`,
    label,
    hint,
    icon: IconSwords
  });
  if (!running)
    return [action('start', 'Start combat', `Roll in ${count === 1 ? 'this token' : `these ${count} tokens`}`)];
  return [
    ...(inCombat < count ? [action('add', 'Add to combat', 'Join the running combat')] : []),
    ...(inCombat > 0 ? [action('remove', 'Leave combat', 'Take out of the running combat')] : [])
  ];
};

/** The GM's token ring: everything the player's has, plus visibility, hidden conditions, combat, handouts and delete */
export const gmTokenMenu = (state: GmTokenMenuState): RadialMenuItemProps[] => {
  const { markers, visibility } = state;
  const single = markers.length === 1;
  // A GM-only token can't stay pinned for players
  const items = tokenMenu({ ...state, gm: true }).filter(
    (item) => !(item.id === MENU_ID.pin && visibility === MarkerVisibility.DM)
  );
  const active = markers.length ? (markers[0].conditions ?? []) : [];
  const hideable = active.filter((condition) => markers.every((m) => m.conditions?.some((c) => c.id === condition.id)));
  const extras: RadialMenuItemProps[] = [
    {
      id: 'gm-visibility',
      label: 'Visibility',
      hint: "Who sees this token on the players' map",
      icon: IconEye,
      submenu: TOKEN_VISIBILITIES.map(({ value, label, hint, icon }) => ({
        id: `${GM_MENU_ID.visibility}${value}`,
        label,
        hint,
        icon,
        active: visibility === value,
        keepOpen: true
      }))
    },
    ...(hideable.length
      ? [
          {
            id: 'gm-hide-conditions',
            label: 'Hidden conditions',
            hint: 'Conditions only the GM sees',
            icon: IconEyeOff,
            submenu: hideable.map((condition) => ({
              id: `${GM_MENU_ID.hideCondition}${condition.id}`,
              label: resolveCondition(condition).label,
              hint: condition.dmOnly ? 'Hidden from players. Tap to show' : 'Shown to players. Tap to hide',
              icon: condition.dmOnly ? IconEyeOff : IconEye,
              active: !!condition.dmOnly,
              keepOpen: true
            }))
          }
        ]
      : []),
    ...(active.length
      ? [
          {
            id: GM_MENU_ID.clearConditions,
            label: 'Clear conditions',
            hint: 'Remove every condition',
            icon: IconTrash,
            danger: true
          }
        ]
      : []),
    ...combatItems(state.combat, markers.length),
    ...(single && state.canShowHandout
      ? [
          {
            id: GM_MENU_ID.handout,
            label: 'Show as handout',
            hint: 'Present the token art to players',
            icon: IconPresentation
          }
        ]
      : []),
    ...(single && state.canSaveToLibrary
      ? [
          {
            id: GM_MENU_ID.saveToLibrary,
            label: 'Save to library',
            hint: 'Keep this token for other scenes',
            icon: IconBooks
          }
        ]
      : []),
    {
      id: GM_MENU_ID.deleteTokens,
      label: single ? 'Delete' : `Delete ${markers.length}`,
      hint: single ? 'Remove this token' : `Remove these ${markers.length} tokens`,
      icon: IconTrash,
      danger: true
    }
  ];
  return [...items, ...extras];
};

export interface GmAoeMenuState extends AoeMenuState {
  /** Undefined when the selected areas differ */
  visibility: StageMode | undefined;
}

/** The GM's area ring: the player's effect and opacity, plus who sees it */
export const gmAoeMenu = (state: GmAoeMenuState): RadialMenuItemProps[] => {
  const items = aoeMenu(state);
  const visibilityItem: RadialMenuItemProps = {
    id: 'gm-aoe-visibility',
    label: 'Visibility',
    hint: "Who sees this area on the players' map",
    icon: IconEye,
    submenu: [
      { value: StageMode.DM, label: 'GM only', hint: 'Players never see it', icon: IconEyeOff },
      { value: StageMode.Player, label: 'Everyone', hint: "Shown on the players' map", icon: IconEye }
    ].map(({ value, label, hint, icon }) => ({
      id: `${GM_MENU_ID.aoeVisibility}${value}`,
      label,
      hint,
      icon,
      active: state.visibility === value,
      keepOpen: true
    }))
  };
  return [...items.slice(0, -1), visibilityItem, items[items.length - 1]];
};
