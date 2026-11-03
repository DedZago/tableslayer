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
  SPELLS,
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

const SLOT_SEPARATOR = '@';
const SLOT_ITEM_PREFIX = 'spell-slot:';
const SLOT_GROUP_PREFIX = 'spell-slots:';
const CATEGORY_ITEM_PREFIX = 'spell-category:';
const GROUP_ITEM_PREFIX = 'spell-group:';
/** Options a ring holds before it splits into category rings */
const RING_LIMIT = 8;

/** A leaf carries its slot only when it is above the spell's own level, so a base-level pick keeps its old id */
export const spellItemId = ({ spellId, variantId, slotLevel }: RecentSpell) =>
  `${SPELL_ITEM_PREFIX}${spellId}${variantId ? `:${variantId}` : ''}${slotLevel ? `${SLOT_SEPARATOR}${slotLevel}` : ''}`;

/** The spell, variant and slot a leaf item stands for; null for any other item id. Ids without a slot cast at base level */
export const parseSpellItemId = (itemId: string): RecentSpell | null => {
  if (!itemId.startsWith(SPELL_ITEM_PREFIX)) return null;
  const [body, slot] = itemId.slice(SPELL_ITEM_PREFIX.length).split(SLOT_SEPARATOR);
  const [spellId, variantId] = body.split(':');
  const slotLevel = Number(slot);
  return spellId
    ? { spellId, ...(variantId && { variantId }), ...(Number.isInteger(slotLevel) && slotLevel > 0 && { slotLevel }) }
    : null;
};

const ROMAN_LEVELS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];

export const romanLevel = (level: number) => ROMAN_LEVELS[level] ?? String(level);

/** The slot a pick carries: only one above the spell's own level */
const upcastSlot = (spell: ResolvedSpell, slotLevel: number | undefined) =>
  slotLevel !== undefined && slotLevel > spell.resolved.level ? slotLevel : undefined;

const availability = (spell: ResolvedSpell, state: SpellMenuState) =>
  spellNeedsCaster(spell) && !state.hasCaster ? { disabled: true, hint: state.noCasterHint } : null;

// The hub names the spell and nothing else (players know its area and save), plus the slot when it is upcast
const leafItem = (spell: ResolvedSpell, state: SpellMenuState, entry: RecentSpell, label: string) => {
  const slotLevel = upcastSlot(spell, entry.slotLevel);
  return {
    id: spellItemId({ ...entry, slotLevel }),
    label,
    icon: CATEGORY_ICONS[spell.category],
    accent: spell.resolved.cast.palette[0],
    ...(slotLevel && { hint: `At level ${romanLevel(slotLevel)}` }),
    ...availability(spell, state)
  };
};

const spellItem = (spell: ResolvedSpell, state: SpellMenuState, slotLevel?: number): RadialMenuItemProps => {
  const { summon } = spell.resolved;
  const entry = { spellId: spell.id, slotLevel };
  if (!summon) return leafItem(spell, state, entry, spell.name);
  return {
    ...leafItem(spell, state, entry, spell.name),
    submenu: summon.variants.map((variant) =>
      leafItem(spell, state, { ...entry, variantId: variant.id }, variant.label)
    )
  };
};

// A summon is remembered with the variant picked, so Recent casts it again in one tap, at the slot it was cast with
const recentItem = (entry: RecentSpell, state: SpellMenuState): RadialMenuItemProps | null => {
  const spell = resolveSpell(entry.spellId, state.ruleset);
  if (!spell) return null;
  const variant = spell.resolved.summon?.variants.find((candidate) => candidate.id === entry.variantId);
  if (spell.resolved.summon && !variant) return null;
  return leafItem(spell, state, entry, variant ? `${spell.name}: ${variant.label}` : spell.name);
};

/** Every spell the ruleset lists, by level, then name */
const rulesetSpells = (ruleset: Ruleset): ResolvedSpell[] =>
  Object.keys(SPELLS)
    .flatMap((id) => resolveSpell(id, ruleset) ?? [])
    .sort((a, b) => a.resolved.level - b.resolved.level || a.name.localeCompare(b.name));

/** What a slot casts: cantrips for slot 0, else every leveled spell up to the slot (upcast when below it) */
export const spellsAtSlot = (ruleset: Ruleset, slotLevel: number): ResolvedSpell[] =>
  rulesetSpells(ruleset).filter(({ resolved: { level } }) =>
    slotLevel === 0 ? level === 0 : level > 0 && level <= slotLevel
  );

const slotSuffix = (slotLevel: number) => `${SLOT_SEPARATOR}${slotLevel}`;

const categoryItem = (
  category: SpellCategoryDefinition,
  spells: readonly ResolvedSpell[],
  state: SpellMenuState,
  slotLevel: number
): RadialMenuItemProps => ({
  id: `${CATEGORY_ITEM_PREFIX}${category.id}${slotSuffix(slotLevel)}`,
  label: category.label,
  hint: category.hint,
  icon: CATEGORY_ICONS[category.id],
  submenu: spells.map((spell) => spellItem(spell, state, slotLevel))
});

// A slot with too many spells for one ring opens the category rings that hold some; categories sharing a group open from one item
const categoryItems = (
  spells: readonly ResolvedSpell[],
  state: SpellMenuState,
  slotLevel: number
): RadialMenuItemProps[] => {
  const inCategory = (category: SpellCategoryDefinition) => spells.filter((spell) => spell.category === category.id);
  const filled = SPELL_CATEGORIES.filter((category) => inCategory(category).length > 0);
  const items: RadialMenuItemProps[] = [];
  for (const category of filled) {
    const group = SPELL_CATEGORY_GROUPS.find((candidate) => candidate.id === category.group);
    if (!group) {
      items.push(categoryItem(category, inCategory(category), state, slotLevel));
      continue;
    }
    const groupId = `${GROUP_ITEM_PREFIX}${group.id}${slotSuffix(slotLevel)}`;
    if (items.some((item) => item.id === groupId)) continue;
    items.push({
      id: groupId,
      label: group.label,
      hint: group.hint,
      icon: CATEGORY_ICONS[category.id],
      submenu: filled
        .filter((member) => member.group === group.id)
        .map((member) => categoryItem(member, inCategory(member), state, slotLevel))
    });
  }
  return items;
};

const slotItem = (slotLevel: number, state: SpellMenuState): RadialMenuItemProps => {
  const spells = spellsAtSlot(state.ruleset, slotLevel);
  return {
    id: `${SLOT_ITEM_PREFIX}${slotLevel}`,
    label: slotLevel === 0 ? 'Cantrips' : `Level ${romanLevel(slotLevel)}`,
    hint:
      slotLevel === 0 ? 'Spells that need no slot' : `Spells up to level ${romanLevel(slotLevel)}, cast with this slot`,
    ...(slotLevel === 0 ? { icon: IconWand } : { iconText: romanLevel(slotLevel) }),
    submenu:
      spells.length <= RING_LIMIT
        ? spells.map((spell) => spellItem(spell, state, slotLevel))
        : categoryItems(spells, state, slotLevel)
  };
};

/** Slot levels the top ring shows: cantrips when the ruleset has any, then I up to its highest spell level */
const slotLevels = (ruleset: Ruleset): number[] => {
  const levels = rulesetSpells(ruleset).map((spell) => spell.resolved.level);
  const highest = Math.max(0, ...levels);
  return [...(levels.includes(0) ? [0] : []), ...Array.from({ length: highest }, (_, index) => index + 1)];
};

/** The slot items, the highest grouped under one item ("Level VI–IX") when they would not fit beside Recent */
export const slotLevelItems = (levels: readonly number[], make: (level: number) => RadialMenuItemProps) => {
  const room = RING_LIMIT - 1;
  if (levels.length <= room) return levels.map(make);
  const grouped = levels.slice(room - 1);
  const [from, to] = [grouped[0], grouped[grouped.length - 1]];
  return [
    ...levels.slice(0, room - 1).map(make),
    {
      id: `${SLOT_GROUP_PREFIX}${from}-${to}`,
      label: `Level ${romanLevel(from)}–${romanLevel(to)}`,
      iconText: `${romanLevel(from)}–${romanLevel(to)}`,
      submenu: grouped.map(make)
    }
  ];
};

export const recentSpellItem = (state: SpellMenuState): RadialMenuItemProps => ({
  id: 'spell-recent',
  label: 'Recent',
  hint: 'Spells you cast lately on this device',
  icon: IconWand,
  submenu: state.recent.flatMap((entry) => recentItem(entry, state) ?? [])
});

/** "Cast spell": Recent (once something was cast), Cantrips and one ring per slot level, down to the spells and their variants */
export const spellMenuItem = (state: SpellMenuState): RadialMenuItemProps => {
  const recent = recentSpellItem(state);
  return {
    id: SPELL_MENU_ROOT_ID,
    label: 'Cast spell',
    hint: 'Pick a slot level, then a spell, then aim it on the map',
    icon: IconWand,
    submenu: [
      ...(recent.submenu?.length ? [recent] : []),
      ...slotLevelItems(slotLevels(state.ruleset), (level) => slotItem(level, state))
    ]
  };
};

export interface SpellPrewarmState {
  ruleset: Ruleset;
  recent: readonly RecentSpell[];
}

const resolveAll = (ids: readonly string[], ruleset: Ruleset): ResolvedSpell[] =>
  ids.flatMap((id) => resolveSpell(id, ruleset) ?? []);

/** The spells a ring opened by `itemId` lists; empty for rings of rings (the root, a group, a crowded slot) */
const spellsShownBy = (itemId: string, { ruleset, recent }: SpellPrewarmState): ResolvedSpell[] => {
  if (itemId === 'spell-recent')
    return resolveAll(
      recent.map((entry) => entry.spellId),
      ruleset
    );
  if (itemId.startsWith(SLOT_ITEM_PREFIX)) {
    const spells = spellsAtSlot(ruleset, Number(itemId.slice(SLOT_ITEM_PREFIX.length)));
    return spells.length <= RING_LIMIT ? spells : [];
  }
  if (itemId.startsWith(CATEGORY_ITEM_PREFIX)) {
    const [categoryId, slot] = itemId.slice(CATEGORY_ITEM_PREFIX.length).split(SLOT_SEPARATOR);
    const spells = slot === undefined ? rulesetSpells(ruleset) : spellsAtSlot(ruleset, Number(slot));
    return spells.filter((spell) => spell.category === categoryId);
  }
  const spell = parseSpellItemId(itemId);
  return spell ? resolveAll([spell.spellId], ruleset) : [];
};

/**
 * The programs a submenu opening should link: a slot ring that lists spells, a category ring, the Recent ring or
 * one summon's variants link just the cast and token effects of the spells shown. Rings of rings link nothing.
 */
export const spellFxToPrewarm = (
  itemId: string,
  state: SpellPrewarmState
): { cast: SpellCastFx[]; token: TokenEffectKind[] } => spellFxKinds(spellsShownBy(itemId, state));
