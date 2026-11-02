import {
  IconBolt,
  IconCircleDashed,
  IconCloud,
  IconFlame,
  IconMountain,
  IconPaw,
  IconShield,
  IconSkull,
  IconSparkles,
  IconTarget,
  IconWand
} from '@tabler/icons-svelte';
import {
  resolveSpell,
  SPELL_CATEGORIES,
  SPELL_CATEGORY_GROUPS,
  spellFxKinds,
  spellsInCategory,
  type IconComponent,
  type RadialMenuItemProps,
  type ResolvedSpell,
  type Ruleset,
  type SpellCastFx,
  type SpellCategory,
  type SpellCategoryDefinition,
  type TokenEffectKind
} from '@tableslayer/stage';
import type { RecentSpell } from './recentSpells';
import { spellNeedsCaster } from './spellCasting';

/** The top-level "Cast spell" item; the TV and the editor both open the ring below it */
export const SPELL_MENU_ROOT_ID = 'cast-spell';

const SPELL_ITEM_PREFIX = 'spell:';

export const TV_NO_CASTER_HINT = 'Long-press a token to cast from it';
export const EDITOR_NO_CASTER_HINT = 'Select a token to cast from it';

export interface SpellMenuState {
  ruleset: Ruleset;
  recent: readonly RecentSpell[];
  /** A single token acts as the caster; auras need one */
  hasCaster: boolean;
  /** Why a spell that needs a caster is off, worded for the screen that shows it */
  noCasterHint: string;
}

const CATEGORY_ICONS: Record<SpellCategory, IconComponent> = {
  blast: IconFlame,
  'zone-control': IconMountain,
  'zone-obscure': IconCloud,
  'zone-magic': IconSparkles,
  aura: IconCircleDashed,
  summon: IconPaw,
  'target-hold': IconTarget,
  'target-curse': IconSkull,
  'target-boon': IconShield,
  'target-enhance': IconBolt
};

export const spellItemId = ({ spellId, variantId }: RecentSpell) =>
  `${SPELL_ITEM_PREFIX}${spellId}${variantId ? `:${variantId}` : ''}`;

/** The spell and variant a leaf item stands for; null for any other item id */
export const parseSpellItemId = (itemId: string): RecentSpell | null => {
  if (!itemId.startsWith(SPELL_ITEM_PREFIX)) return null;
  const [spellId, variantId] = itemId.slice(SPELL_ITEM_PREFIX.length).split(':');
  return spellId ? { spellId, ...(variantId && { variantId }) } : null;
};

const availability = (spell: ResolvedSpell, state: SpellMenuState) =>
  spellNeedsCaster(spell) && !state.hasCaster ? { disabled: true, hint: state.noCasterHint } : null;

// The hub names the spell and nothing else: players know its area and save
const leafItem = (spell: ResolvedSpell, state: SpellMenuState, entry: RecentSpell, label: string) => ({
  id: spellItemId(entry),
  label,
  icon: CATEGORY_ICONS[spell.category],
  accent: spell.resolved.cast.palette[0],
  ...availability(spell, state)
});

const spellItem = (spell: ResolvedSpell, state: SpellMenuState): RadialMenuItemProps => {
  const { summon } = spell.resolved;
  if (!summon) return leafItem(spell, state, { spellId: spell.id }, spell.name);
  return {
    ...leafItem(spell, state, { spellId: spell.id }, spell.name),
    submenu: summon.variants.map((variant) =>
      leafItem(spell, state, { spellId: spell.id, variantId: variant.id }, variant.label)
    )
  };
};

// A summon is remembered with the variant picked, so Recent casts it again in one tap
const recentItem = (entry: RecentSpell, state: SpellMenuState): RadialMenuItemProps | null => {
  const spell = resolveSpell(entry.spellId, state.ruleset);
  if (!spell) return null;
  const variant = spell.resolved.summon?.variants.find((candidate) => candidate.id === entry.variantId);
  if (spell.resolved.summon && !variant) return null;
  return leafItem(spell, state, entry, variant ? `${spell.name}: ${variant.label}` : spell.name);
};

const CATEGORY_ITEM_PREFIX = 'spell-category:';
const GROUP_ITEM_PREFIX = 'spell-group:';

const categoryItem = (category: SpellCategoryDefinition, state: SpellMenuState): RadialMenuItemProps => ({
  id: `${CATEGORY_ITEM_PREFIX}${category.id}`,
  label: category.label,
  hint: category.hint,
  icon: CATEGORY_ICONS[category.id],
  submenu: spellsInCategory(category.id, state.ruleset).map((definition) => {
    const spell = resolveSpell(definition.id, state.ruleset)!;
    return spellItem(spell, state);
  })
});

// Categories sharing a group open from one item, so the top ring stays within the radial menu's limit
const categoryItems = (state: SpellMenuState): RadialMenuItemProps[] => {
  const items: RadialMenuItemProps[] = [];
  for (const category of SPELL_CATEGORIES) {
    const group = SPELL_CATEGORY_GROUPS.find((candidate) => candidate.id === category.group);
    if (!group) {
      items.push(categoryItem(category, state));
    } else if (!items.some((item) => item.id === `${GROUP_ITEM_PREFIX}${group.id}`)) {
      items.push({
        id: `${GROUP_ITEM_PREFIX}${group.id}`,
        label: group.label,
        hint: group.hint,
        icon: CATEGORY_ICONS[category.id],
        submenu: SPELL_CATEGORIES.filter((member) => member.group === group.id).map((member) =>
          categoryItem(member, state)
        )
      });
    }
  }
  return items;
};

export const recentSpellItem = (state: SpellMenuState): RadialMenuItemProps => ({
  id: 'spell-recent',
  label: 'Recent',
  hint: 'Spells you cast lately on this device',
  icon: IconWand,
  submenu: state.recent.flatMap((entry) => recentItem(entry, state) ?? [])
});

/** "Cast spell": Recent (once something was cast) plus one ring per category, down to the spells and their variants */
export const spellMenuItem = (state: SpellMenuState): RadialMenuItemProps => {
  const recent = recentSpellItem(state);
  return {
    id: SPELL_MENU_ROOT_ID,
    label: 'Cast spell',
    hint: 'Pick a spell, then aim it on the map',
    icon: IconWand,
    submenu: [...(recent.submenu?.length ? [recent] : []), ...categoryItems(state)]
  };
};

export interface SpellPrewarmState {
  ruleset: Ruleset;
  recent: readonly RecentSpell[];
}

const resolveAll = (ids: readonly string[], ruleset: Ruleset): ResolvedSpell[] =>
  ids.flatMap((id) => resolveSpell(id, ruleset) ?? []);

/**
 * The programs a submenu opening should link: a category ring, the Recent ring or one summon's variants
 * link just the cast and token effects of the spells shown. Other rings (the root, a group) link nothing.
 */
export const spellFxToPrewarm = (
  itemId: string,
  { ruleset, recent }: SpellPrewarmState
): { cast: SpellCastFx[]; token: TokenEffectKind[] } => {
  let ids: string[] = [];
  if (itemId === 'spell-recent') ids = recent.map((entry) => entry.spellId);
  else if (itemId.startsWith(CATEGORY_ITEM_PREFIX)) {
    const category = SPELL_CATEGORIES.find((candidate) => `${CATEGORY_ITEM_PREFIX}${candidate.id}` === itemId);
    if (category) ids = spellsInCategory(category.id, ruleset).map((spell) => spell.id);
  } else {
    const spell = parseSpellItemId(itemId);
    if (spell) ids = [spell.spellId];
  }
  return spellFxKinds(resolveAll(ids, ruleset));
};
