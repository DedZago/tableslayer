# TV radial menu architecture

How the playfield (TV, `/[party]/play`) menu, grouping and condition editing work, and how they stay in sync with the
GM editor. Design history and requirements: `spec/tv-radial-menu.md`.

## Design decisions

- **One menu, opened by long press, chosen by what is under the press.** The TV is a shared touchscreen with no
  keyboard, so every action lives in one radial menu that adapts: token menu, AoE menu or general menu. The bottom
  toolbar stays as a shortcut for the common modes.
- **Readable without triggering.** Every option shows its label. The hub shows a one-line hint for the option under
  the finger; releasing on it selects it, sliding off cancels. Disabled options stay pressable so the hub can explain
  why they are off.
- **Back is always one tap.** The hub and any tap outside the ring go up one level and close the menu at the top
  level. The menu is a stack of submenu ids, never a copy of items, so rings update in place while open.
- **Menu content is pure data.** `playMenus.ts` builds `RadialMenuItemProps[]` from plain state, so all wording,
  ordering and enable rules are unit-tested without a browser. `PlayTools` only maps an item id to a doc write.
- **The TV uses the GM's writers.** Grouping calls `planGroupToggle` + `setGroup`, conditions call the same per-condition
  writers as the editor. No TV-only data paths exist, so the two screens can't drift.
- **Conditions merge per condition.** Each condition is its own key in the doc (see Data flow), so simultaneous edits
  on the GM and the TV both survive and the TV can't erase GM-only conditions it can't see.
- **The stage package stays icon-free.** The condition catalog (labels, colors, hints, categories) lives in
  `packages/stage`; the Tabler icons for conditions live in apps/web (`conditionIcons.ts`).

## Components and responsibilities

| Piece                                                            | Role                                                                                           |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `packages/stage/.../RadialMenu/RadialMenu.svelte`                | Ring layout, level stack, back/close, hub text, edge rotation, auto-close, opening-press guard |
| `packages/stage/.../RadialMenu/RadialMenuItem.svelte`            | One option: icon/swatch/effect preview, label, badge, active/danger/disabled styles            |
| `packages/stage/.../MarkerLayer/MarkerLayer.svelte`              | `onMarkerLongPress`: 500 ms still press on a token; cancels drag and release click             |
| `packages/stage/.../AoeTemplateLayer`                            | `onAoeTemplateMenu` for right-click or long press on a shape (unchanged)                       |
| `packages/stage/.../helpers/markerConditions.ts`                 | Condition catalog, `MARKER_CONDITION_CATEGORIES`, `conditionIdsInCategory`, sorting            |
| `apps/web/src/lib/utils/conditionIcons.ts`                       | Icon per condition and per category                                                            |
| `apps/web/src/lib/utils/assetGroups.ts`                          | Group selection rules and `planGroupToggle` (shared with the editor's B)                       |
| `apps/web/src/lib/realtime/docSchema.ts`                         | Nested conditions map, condition writers, `upgradeConditionMaps`                               |
| `apps/web/src/routes/(app)/[party]/play/playMenus.ts`            | Pure menu builders: `generalMenu`, `tokenMenu`, `aoeMenu`, `conditionsItem`, `groupItems`      |
| `apps/web/src/routes/(app)/[party]/play/usePlayTools.svelte.ts`  | Selection, menu state, `openMenuAt`, `selectMenuItem` actions, notices, custom condition form  |
| `apps/web/src/routes/(app)/[party]/play/+page@.svelte`           | Long press on empty map, gesture detector, stage callbacks, menu/notice/form rendering         |
| `apps/web/src/routes/(app)/[party]/play/TvConditionForm.svelte`  | Name + color form for a new custom condition, rotated like the menu                            |
| `apps/web/src/routes/(app)/[party]/play/playDrawing.ts`          | Draw brushes, colors, brush sizes, player-layer lookup and creation                            |
| `apps/web/src/routes/(app)/[party]/play/TvDrawPanel.svelte`      | Draw panel: brush, size slider + size circle, eraser, undo, done; faces the nearest edge       |
| `apps/web/src/lib/components/GameSession/ConditionPicker.svelte` | Editor picker, organized by the same categories                                                |

## Interaction flow

```
press ──► token?  MarkerLayer timer ──► onMarkerLongPress ──► tools.openTokenMenu
      ├─► shape?  AoeTemplateLayer timer ──► onAoeTemplateMenu ──► tools.openAoeMenu
      └─► map     play page timer (no tool active) ──► tools.openMenuAt (hit-tests)
two-finger hold / right-click ──► gesture detector ──► tools.openMenuAt (hit-tests)

tools.menu = { target, x, y } ──► tools.menuItems (playMenus builders, re-derived from the doc)
                               └► <RadialMenu items title onItemSelect onClose>
option released ──► submenu? push id onto the stack
                └─► leaf ──► tools.selectMenuItem(id) ──► client.write.* ──► doc ──► snapshot ──► menuItems
                         └─► keepOpen? stay : close
```

- **Targets.** `MenuTarget` is `general`, `token` or `aoe`, with `members: GroupMember[]`. Outside select mode the
  members are the pressed item; in select mode `menuMembers` uses the whole selection when it includes the pressed
  item (the stage already added an unselected item on press).
- **Duplicate opens.** Touchscreens may fire both a hold and a contextmenu for one long press; `#openMenu` ignores a
  second open within 600 ms.
- **The release of the opening press.** It ends over the new menu. `RadialMenu` only honours clicks after a
  pointerdown on itself (`armed`), so that release can't select or close anything.
- **Closing.** Leaf actions (unless `keepOpen`), hub/outside tap at the top level, 15 s idle, scene switch or pause,
  and `menuTargetGone` (the token or shape was deleted elsewhere).

## Data flow

### Selection (local only)

`PlayTools.selection` is a `GroupMember[]` of tokens, AoEs and any lights a group brought along (the TV can't pick a
light alone). `selectedMarkerIds` / `aoeSelectedIds` are getter/setter views of it that feed the stage and the
toolbar. In select mode a tap toggles the item with its group (`toggleGroupInSelection`); the marquee adds enclosed
tokens and shapes with their groups (`expandToGroups`). Nothing about selection or menu state is shared.

### Groups

`groupItems(rows, members)` asks `planGroupToggle` the same question the editor's B does and offers Group, Ungroup,
Leave group (groups of 3+) or Group with… (enters select mode). Actions write `setGroup`; moving any member already
shifts its group inside the doc writer, so TV drags, GM drags and undo all keep groups together.

### Conditions in the doc

```
marker row: Y.Map
  conditions: Y.Map<conditionId, MarkerCondition>   // one key per condition
```

- **Writers** (one key per token, each call one transaction): `toggleMarkerCondition`, `setMarkerConditionValue`,
  `stepMarkerConditionValue`, `toggleMarkerConditionDmOnly`, `clearMarkerConditions`. Toggle removes only when every
  target has the condition, otherwise adds it where missing.
- **`{ playerView: true }`** (the TV): a GM-only entry counts as absent and is never changed or deleted.
- **Whole lists** (`upsertMarker`, `setMarkerFields`, token paste, scene duplicate, hydration) are diffed into
  per-condition changes by `writeConditionList`.
- **Creation race.** The map is created with each token row; `upgradeConditionMaps` converts older array rows when the
  PartyKit room loads (`partykit/gameSession.ts`). Two screens therefore never both create the map, which would let one
  replace the other.
- **Reads.** Snapshots return `MarkerCondition[]` ordered by id; `buildSceneProps` sorts by catalog order and filters
  GM-only conditions for player props. The row-object cache walks `event.target.parent` so a nested change refreshes
  its row.
- **Persistence.** Unchanged: the persist path reads snapshot arrays and the DB column stays JSON.

### Drawing

Draw opens a ring of colors, one ring per effect category, Eraser and Clear drawings (`drawItem`). Picking a brush
turns on the draw tool and the draw panel (`setDrawBrush`); the panel's brush button reopens just the Draw ring
(`MenuTarget` `draw`). Strokes paint on this brush's player layer (`playerLayerFor`: `playerDrawn`, visible, same color
or effect), or on a local draft layer with a fresh id until its first stroke saves it with `upsertAnnotation`. Each
stroke end collects the touched layers (`onAnnotationUpdate`), reads their masks back at once and writes them in one
`stopCapturing` pair, so one stroke is one undo step on the TV and in the editor. The eraser passes the player layers
as `eraseLayerIds`, so GM drawings are never erased. The tool turns off after 30 s without a stroke, on Done, on
scene switch and on pause. Design and decisions: `spec/tv-drawing.md`.

### Undo

Each TV action runs inside `PlayTools.#write`, which wraps the writes in `client.stopCapturing()`: one undo step on
the TV, and the GM can undo it too (`setUndoScope(..., { includeRemote: true })`).

## Key functions

| Function                                  | Where                    | Purpose                                                           |
| ----------------------------------------- | ------------------------ | ----------------------------------------------------------------- |
| `openMenuAt(point)`                       | `usePlayTools`           | Hit-tests token, then shape, else opens the general menu          |
| `menuItems` / `menuTitle`                 | `usePlayTools`           | Current ring content and hub title, derived from the doc          |
| `selectMenuItem(id)`                      | `usePlayTools`           | Maps an item id (`MENU_ID`, prefixed ids carry a value) to writes |
| `conditionsItem(rows, customSuggestions)` | `playMenus`              | Category ring → condition rings, active/mixed/automatic states    |
| `groupItems(rows, members)`               | `playMenus`              | Group options following the B rules                               |
| `generalMenu`, `tokenMenu`, `aoeMenu`     | `playMenus`              | Top-level rings per target                                        |
| `toggleMarkerCondition` and friends       | `docSchema` writer       | Per-condition doc writes                                          |
| `upgradeConditionMaps(doc, origin)`       | `docSchema`              | Array → map conversion on room load                               |
| `conditionIdsInCategory(category)`        | stage `markerConditions` | Catalog ids of one category, in display order                     |

## How to modify or extend

- **Add a menu option.** Add an id to `MENU_ID`, an item in the relevant builder in `playMenus.ts` (label in sentence
  case plus a hint), and a branch in `selectMenuItem`. Add a test in `playMenus.test.ts`. Keep each ring at 10
  options or fewer (a test checks this); split into a submenu instead.
- **Add a toggle that should keep the menu open.** Set `keepOpen: true` and make the item's `active` come from doc
  state, so the ring re-renders when the write lands.
- **Add a condition.** Add it to `MARKER_CONDITIONS` in catalog order inside its category (unique `abbr`, hint ≤ 140
  characters, at most 8 per category), then add its icon in `conditionIcons.ts`. Tests fail if either is missing.
  Nothing else changes: the editor picker and the TV ring both read the categories.
- **Add a condition category.** Add it to `ConditionCategory` and `MARKER_CONDITION_CATEGORIES`, give it an icon in
  `CONDITION_CATEGORY_ICONS`, and keep the top ring at 10 or fewer.
- **Write conditions from new code.** Use the condition writers; never write an array rebuilt from a rendered or
  filtered view. Pass `{ playerView: true }` from any client that can't see GM-only conditions.
- **Long press on another stage item.** Follow `onMarkerLongPress`: a timer armed on press, cancelled past 12 px or
  on release, which also cancels the item's drag and suppresses the release click, and is only armed when the
  consumer registers the callback.
- **Use `RadialMenu` elsewhere.** Pass `items`, `title`/`subtitle` for the hub, `onItemSelect`, `onClose`, and
  optionally `autoCloseMs`, `backIcon`, `closeIcon`, `onReposition`. Effect previews (`effectType`) each cost a
  WebGL context while visible; prefer CSS swatches (`color` accepts gradients) for long lists.
