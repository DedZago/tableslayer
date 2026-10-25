# TV radial menu

## Problem

On the TV (`/[party]/play`) the only menu was a two-finger-hold radial with a single icon-only item (Measure).
Everything else lived in the bottom toolbar or in a separate AoE long-press panel. Players couldn't tell what an icon
did without pressing it, there was no way to act on a token, grouping (B in the editor) did not exist on the TV, and
players had to ask the GM to apply conditions.

## Goals

- One radial menu style for the whole TV, opened by long press, that adapts to what was pressed.
- Every option shows an icon and a label, plus a one-line hint in the hub, so nothing needs to be triggered to be
  understood.
- Going back is always one tap: the hub or anywhere outside the ring goes up one level (closes at the top level).
- TV-sized touch targets; the menu faces the nearest table edge.
- Players can group / ungroup, measure, draw, place AoEs and edit conditions without the GM.
- Every TV edit goes through the same doc writers as the GM, so both screens stay in sync with no lost edits.

## Opening the menu

| Gesture                            | Menu                                      |
| ---------------------------------- | ----------------------------------------- |
| One-finger long press on a token   | Token menu (that token, or its selection) |
| One-finger long press on an AoE    | AoE menu (that shape, or the selection)   |
| One-finger long press on empty map | General menu                              |
| Two-finger hold                    | Menu for what is under the fingers        |
| Right-click (mouse)                | Menu for what is under the pointer        |

- Long press = 500 ms with less than 12 px of movement (the `AoeTemplateLayer` values). Moving further cancels it, so
  dragging never opens the menu. Tokens report it through the new `onMarkerLongPress` stage callback, which also
  cancels the pending drag and the release click; shapes use the existing `onAoeTemplateMenu`; empty map is detected
  by the play page (only with no tool active).
- A second open within 600 ms is ignored: some touchscreens report a long press as both a hold and a contextmenu.
- The press that opened the menu ends over it; the menu ignores any click that did not start on it.
- Long press on an item outside select mode acts on that item. In select mode, the press first adds the item to the
  selection (the stage reports the tap on press), so the menu acts on the whole selection.
- Hidden tokens (GM-only) are not hit-testable on the TV, as before.
- The menu closes on a leaf action, after 15 s without input, on scene switch or pause, and when its token or shape
  is deleted elsewhere.

## Look

- Round 4 rem buttons on a ring whose radius grows with the option count; the label is always visible under each
  button and the ring, labels and hub rotate to face the nearest edge.
- Options that open another ring have a double border. Active options are filled with their accent color. Danger
  options (delete) use `--fgDanger`. Disabled options are dimmed but still pressable, so the hub can say why they
  are off ("Nothing to undo").
- The hub shows the label and hint of the option under the finger; with nothing pressed it shows what the menu acts on
  ("Goblin", "3 selected", "Map") or the open submenu's name and hint, plus "Back" or "Close".
- Pressing an option shows its hint while held; releasing on it selects it, sliding off cancels.
- Toggles (conditions, exhaustion levels, AoE effect/opacity, undo/redo) keep the menu open, and the ring updates in
  place from the doc.
- Feedback for actions without a visible result appears as a short notice at the top ("Grouped 3 items").

## General menu (empty map)

| Option   | Action                                                                   |
| -------- | ------------------------------------------------------------------------ |
| Measure  | Ring: line, circle, square, cone (30/60/90°), beam (5–20 ft)             |
| Distance | Toggles distance mode                                                    |
| AoE      | Ring: circle, cube, cone, line; selects the AoE tool with that shape     |
| Draw     | Ring: Color (6 colors) or Effect (8 animated effects); temporary drawing |
| Select   | Toggles select mode                                                      |
| Clear    | Only with a selection; deselects everything                              |
| Undo     | Keeps the menu open; disabled with "Nothing to undo"                     |
| Redo     | Keeps the menu open; disabled with "Nothing to redo"                     |
| Fit view | Only when zoomed                                                         |

## Token menu

| Option      | Action                                                                 |
| ----------- | ---------------------------------------------------------------------- |
| Conditions  | Category ring → condition ring (see Conditions)                        |
| Group       | Selection that B would group                                           |
| Ungroup     | A whole group selected, or a single grouped token: dissolves the group |
| Leave group | A single token in a group of 3+: only it leaves                        |
| Group with… | A single ungrouped token: turns on select mode with it selected        |
| Distance    | Single token: distance mode from it                                    |
| Pin name    | Single token: toggles `pinnedTooltip`                                  |
| Clear       | Only with a selection                                                  |

## AoE menu

Replaces `AoeTemplateContextPanel` on the TV (the editor keeps its panel).

| Option              | Action                                                        |
| ------------------- | ------------------------------------------------------------- |
| Effect              | Ring: Damage (8 effects) or Terrain (10 effects), as swatches |
| Opacity             | Ring: 25 %, 50 %, 75 %, 100 %                                 |
| Group / Ungroup / … | Same rules as the token menu                                  |
| Delete              | Danger style; acts on every AoE the menu acts on              |

## Grouping on the TV

- TV selection is a `GroupMember[]` (tokens, AoEs, and lights brought along by a group, which the TV can't pick
  alone). `selectedMarkerIds` and `aoeSelectedIds` are views of it.
- In select mode a tap toggles the item with its whole group (`toggleGroupInSelection`) and the marquee adds the
  tokens and shapes it encloses (`expandToGroups`). There is no click cycling on the TV.
- Group / ungroup call `planGroupToggle` and `client.write.setGroup`, like `toggleGroup()` in the editor. The menu
  options come from `groupItems()` in `playMenus.ts`, which follows the same plan.

## Conditions

### Catalog

All 15 official 5e conditions were already present. Added: Turned, Surprised, Outlined, Silenced, Cursed, Reaction
used, Inspired, Shielded, Sanctuary, Protected, Enlarged, Reduced, Polymorphed, Dying, Stable.

The catalog's `group: 'condition' | 'combat'` became `category`, one of eight plus custom
(`MARKER_CONDITION_CATEGORIES`). The editor's `ConditionPicker` and the TV radial both use it.

| Category  | Conditions                                                            |
| --------- | --------------------------------------------------------------------- |
| Can't act | Incapacitated, Stunned, Paralyzed, Unconscious, Petrified, Surprised  |
| Senses    | Blinded, Deafened, Invisible, Hidden, Outlined, Silenced              |
| Mind      | Charmed, Frightened, Turned, Polymorphed                              |
| Movement  | Grappled, Restrained, Prone, Flying                                   |
| Debuffs   | Poisoned, Exhaustion, Baned, Slowed, Marked, Burning, Cursed, Reduced |
| Buffs     | Blessed, Hasted, Inspired, Shielded, Protected, Sanctuary, Enlarged   |
| Actions   | Concentrating, Raging, Dodging, Reaction used                         |
| Life      | Bloodied (automatic), Dying, Stable, Dead                             |
| Custom    | Custom conditions used in the scene + New…                            |

Catalog order is display order (badges sort by it). Each condition has a color, a unique badge abbreviation, a rules
hint of at most 140 characters and a Tabler icon (web-side `conditionIcons.ts`, keeping `packages/stage` free of icon
dependencies). Each category has an icon and a color.

### TV flow

- Conditions opens the category ring; categories with conditions on show a count badge and say so in their hint.
- A category opens its conditions; active ones are filled, ones only some targets have show a dot. A tap toggles it
  on every target token and the ring stays open.
- Exhaustion opens levels 1–6 (with their penalty as the hint) plus Remove.
- Custom shows up to 7 custom conditions used in the scene plus New…, which opens `TvConditionForm` (name, 24
  characters, and 8 colors) facing the same edge.
- Players can create custom conditions but cannot set GM-only. GM-only conditions are never shown on the TV and never
  touched by a TV edit (`playerView` writer option).
- Bloodied stays derived from HP: shown as automatic, not toggleable.

## Sync and conflicts

A token's conditions used to be one JSON array: two screens editing the same token's conditions at once lost one edit,
and a TV write built from its filtered view would have deleted GM-only conditions.

Now a token's conditions live in a nested `Y.Map` keyed by condition id inside the marker row:

- Writers `toggleMarkerCondition`, `setMarkerConditionValue`, `stepMarkerConditionValue`,
  `toggleMarkerConditionDmOnly` and `clearMarkerConditions` write or delete one key per token, so concurrent edits
  from any screen merge. With `{ playerView: true }` a GM-only entry counts as absent and is never changed.
- A whole list (row upsert, token paste, scene duplicate, hydration) is applied as per-condition changes.
- The map is created with each token (and by the room for older rows on load, `upgradeConditionMaps`), so two
  screens never race to create it.
- Readers still get `MarkerCondition[]` (ordered by id; `buildSceneProps` sorts for display). The row cache
  invalidates a row when its nested map changes. The DB column stays a JSON array; no migration.
- Every TV action is one transaction wrapped in `stopCapturing()`: one undo step on the TV, one update for the GM.
- Selection, menu and form state are local-only.

## Files

- `packages/stage/src/lib/components/RadialMenu/*`: level stack with back, hub with title/hint, labels, accent,
  active, badge, danger, keep-open, auto-close, opening-press guard. The unused table layout was removed.
- `packages/stage` `MarkerLayer.svelte` + `Stage/types.ts`: `onMarkerLongPress`.
- `packages/stage` `helpers/markerConditions.ts` (+ test): categories, new conditions, hints.
- `apps/web/src/lib/realtime/docSchema.ts` (+ tests): nested conditions map, condition writers, `upgradeConditionMaps`;
  `partykit/gameSession.ts` calls it on load.
- `apps/web/src/lib/utils/conditionIcons.ts` (+ test), `markerConditionPicker.ts` (`CUSTOM_CONDITION_COLORS`).
- `ConditionPicker.svelte`: sections by category with icons. Editor page: condition edits use the writers.
- `apps/web/src/routes/(app)/[party]/play/playMenus.ts` (+ test): menu builders.
- `usePlayTools.svelte.ts`: selection as `GroupMember[]`, menu state and actions. `+page@.svelte`: long press on empty
  map, menu wiring, notice, form. New `TvConditionForm.svelte`.

## Testing

- Unit: catalog (all official conditions, unique abbreviations, every category fits a ring); icons for every
  condition; menu builders (options, disabled hints, active and mixed states, GM-only hidden, ring sizes, group
  options); doc writers (concurrent toggles merge, GM-only untouched from the player view, steps, whole-list writes,
  array → map upgrade, row cache, one undo step).
- Manual on the TV: long press token / AoE / map / two fingers; dragging never opens the menu; back from every ring
  via hub and outside tap; group a token + cone and drag on GM and TV; toggle conditions on the TV while the GM
  toggles another on the same token.

## Edge cases

- A selection with tokens and AoEs: Conditions applies to the tokens only.
- A group with a light: the TV can ungroup it but not select the light alone.
- Scene switch, pause, or the target deleted elsewhere while the menu is open: it closes.
- Menu near a corner: clamped on screen and rotated toward the nearest edge; the custom condition form does the same.
