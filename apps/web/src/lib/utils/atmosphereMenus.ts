import { IconAdjustments, IconCloudRain, IconMinus, IconPlus, IconSparkles } from '@tabler/icons-svelte';
import {
  ATMOSPHERE_CATEGORIES,
  ATMOSPHERE_EFFECTS,
  atmosphereEffectsInCategory,
  QUICK_SCENES,
  type AtmosphereSlot,
  type QuickScene,
  type RadialMenuItemProps
} from '@tableslayer/stage';
import { ATMOSPHERE_SLOT_LABELS, ATMOSPHERE_SLOTS, INTENSITY_STEP, type SlotState } from './atmosphereActions';
import { ATMOSPHERE_OFF_ICON, atmosphereIcon } from './atmosphereIcons';

export const ATMOSPHERE_MENU_PREFIX = 'gm-atmo:';
export const ATMOSPHERE_MENU_ROOT_ID = 'gm-atmo';
const QUICK_SCENES_PER_RING = 5;

export type AtmosphereMenuState = Record<AtmosphereSlot, SlotState>;

export type AtmosphereMenuAction =
  | { kind: 'effect'; slot: AtmosphereSlot; type: number }
  | { kind: 'off'; slot: AtmosphereSlot }
  | { kind: 'intensity'; slot: AtmosphereSlot; delta: number }
  | { kind: 'scene'; sceneId: string }
  | { kind: 'clear' };

const isSlot = (value: string | undefined): value is AtmosphereSlot => ATMOSPHERE_SLOTS.some((slot) => slot === value);

const menuId = (...parts: (string | number)[]) => `${ATMOSPHERE_MENU_PREFIX}${parts.join(':')}`;

export const parseAtmosphereMenuId = (itemId: string): AtmosphereMenuAction | null => {
  if (!itemId.startsWith(ATMOSPHERE_MENU_PREFIX)) return null;
  const [kind, first, second] = itemId.slice(ATMOSPHERE_MENU_PREFIX.length).split(':');
  if (kind === 'clear') return { kind };
  if (kind === 'scene' && first) return { kind, sceneId: first };
  if (!isSlot(first)) return null;
  if (kind === 'off') return { kind, slot: first };
  if (kind === 'effect' && second !== undefined && Number.isInteger(Number(second))) {
    return { kind, slot: first, type: Number(second) };
  }
  if (kind === 'intensity' && (second === 'up' || second === 'down')) {
    return { kind, slot: first, delta: second === 'up' ? INTENSITY_STEP : -INTENSITY_STEP };
  }
  return null;
};

const sceneIcon = (scene: QuickScene) =>
  scene.weather ? atmosphereIcon('weather', scene.weather) : atmosphereIcon('ambience', scene.ambience);

const percent = (value: number) => `${Math.round(value * 100)}%`;

const slotRing = (slot: AtmosphereSlot, state: SlotState): RadialMenuItemProps => {
  const categories = ATMOSPHERE_CATEGORIES[slot].map((category): RadialMenuItemProps => {
    const effects = atmosphereEffectsInCategory(slot, category.id);
    return {
      id: menuId('category', slot, category.id),
      label: category.label,
      hint: category.description,
      icon: atmosphereIcon(slot, effects[0]?.id ?? 0),
      active: effects.some((effect) => effect.id === state.type),
      submenu: effects.map((effect) => ({
        id: menuId('effect', slot, effect.id),
        label: effect.label,
        hint: effect.hint,
        icon: atmosphereIcon(slot, effect.id),
        active: effect.id === state.type,
        keepOpen: true
      }))
    };
  });
  const off: RadialMenuItemProps = {
    id: menuId('off', slot),
    label: 'Off',
    hint: `Remove the ${ATMOSPHERE_SLOT_LABELS[slot].toLowerCase()} effect`,
    icon: ATMOSPHERE_OFF_ICON,
    active: state.type === 0,
    keepOpen: true
  };
  const intensity: RadialMenuItemProps = {
    id: menuId('intensity', slot),
    label: 'Intensity',
    hint: `Currently ${percent(state.intensity)}`,
    icon: IconAdjustments,
    badge: percent(state.intensity),
    disabled: state.type === 0,
    submenu: [
      {
        id: menuId('intensity', slot, 'down'),
        label: 'Lower',
        hint: `Currently ${percent(state.intensity)}`,
        icon: IconMinus,
        keepOpen: true
      },
      {
        id: menuId('intensity', slot, 'up'),
        label: 'Higher',
        hint: `Currently ${percent(state.intensity)}`,
        icon: IconPlus,
        keepOpen: true
      }
    ]
  };
  return {
    id: menuId('slot', slot),
    label: ATMOSPHERE_SLOT_LABELS[slot],
    hint: `Pick ${ATMOSPHERE_SLOT_LABELS[slot].toLowerCase()} for this scene`,
    icon: atmosphereIcon(slot, state.type || ATMOSPHERE_EFFECTS[slot][0].id),
    active: state.type !== 0,
    submenu: [...categories, off, intensity]
  };
};

const quickScenesRing = (state: AtmosphereMenuState): RadialMenuItemProps => {
  const chunks = Array.from({ length: Math.ceil(QUICK_SCENES.length / QUICK_SCENES_PER_RING) }, (_, index) =>
    QUICK_SCENES.slice(index * QUICK_SCENES_PER_RING, (index + 1) * QUICK_SCENES_PER_RING)
  );
  return {
    id: menuId('scenes'),
    label: 'Quick scenes',
    hint: 'Set weather, lighting and ambience together',
    icon: IconSparkles,
    submenu: chunks.map((scenes, index) => ({
      id: menuId('scene-group', index),
      label: `Scenes ${index * QUICK_SCENES_PER_RING + 1}-${index * QUICK_SCENES_PER_RING + scenes.length}`,
      hint: scenes.map((scene) => scene.label).join(', '),
      icon: sceneIcon(scenes[0]),
      submenu: scenes.map((scene) => ({
        id: menuId('scene', scene.id),
        label: scene.label,
        hint: scene.hint,
        icon: sceneIcon(scene),
        active:
          state.weather.type === scene.weather &&
          state.lighting.type === scene.lighting &&
          state.ambience.type === scene.ambience,
        keepOpen: true
      }))
    }))
  };
};

/** The GM's Atmosphere ring: one ring per slot, quick scenes, and a way to clear everything */
export const atmosphereMenuItem = (state: AtmosphereMenuState): RadialMenuItemProps => ({
  id: ATMOSPHERE_MENU_ROOT_ID,
  label: 'Atmosphere',
  hint: 'Weather, lighting and ambience',
  icon: IconCloudRain,
  active: ATMOSPHERE_SLOTS.some((slot) => state[slot].type !== 0),
  submenu: [
    ...ATMOSPHERE_SLOTS.map((slot) => slotRing(slot, state[slot])),
    quickScenesRing(state),
    {
      id: menuId('clear'),
      label: 'Clear all',
      hint: 'Turn weather, lighting and ambience off',
      icon: ATMOSPHERE_OFF_ICON,
      danger: true,
      keepOpen: true
    }
  ]
});
