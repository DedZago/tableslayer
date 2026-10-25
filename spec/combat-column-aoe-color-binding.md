# Combat column, AoE recolor, token binding

## Problem statement

1. **Initiative disappears mid-battle.** The tracker is a "Combat" tab in the right side panel. Picking the token, AoE or light tool switches the panel back to the tokens tab, so the turn order vanishes while the GM works. Adding or removing tokens during a fight works only from the tracker footer or the token menu. `I` silently ignores tokens that are already in combat.
2. **A token click doesn't show its stat block.** The stat block lives in the tokens tab. If the panel is on combat, library or handout, clicking a token on the map changes nothing visible, so the panel looks stuck on the same page.
3. **AoE recolor goes to the wrong place.** The toolbar effect picker only changes the drawing tool. With an AoE selected, picking an effect leaves that AoE unchanged and quietly changes every AoE drawn afterwards.
4. **Nothing moves together.** There's no way to keep a light (a torch), an AoE (an aura) and tokens (a familiar) together so they move as one.

## Proposed solution

### 1. Combat column

- The initiative tracker gets its own column inside the right pane, next to the tabs column. It doesn't depend on which tab is open.
- It opens automatically when combat starts, and the right pane expands if it's collapsed. A `Combat` toggle in the tab bar shows or hides it. The live dot stays.
- The tab bar loses the `combat` tab.
- **Mobile (vertical layout):** the column stacks above the tabs.
- **Shortcuts:**
  - `I` adds the selected tokens. If none are in combat yet, it starts combat.
  - `Shift+I` removes the selected tokens from combat.
  - Both show a toast when nothing changes.

### 2. Token click opens its stat block

- `onMarkerSelected` with a token switches the side panel to the tokens tab and hides the checklist.
- The `MarkerManager` edit view, with the stat block, then follows the clicked token.
- The combat column stays open beside it.

### 3. AoE recolor

- Toolbar effect picker:
  - With AoE(s) selected, it recolors only the selection and leaves the tool unchanged.
  - With nothing selected, it sets the tool, as now.
- The swatch shows the effect of whatever it will change.
- The context menu and the AoE manager already patch only the selection, so they stay as they are.

### 4. Grouping (`B`)

Any mix of tokens, lights and AoEs can be grouped. Members are equal: there is no anchor.

**Data**

- `groupId` on markers, lights and AoE templates. Markers and lights get a new column, AoEs too (their reserved `anchor_marker_id` stays unused). The user generates and runs the migration.
- Positions stay absolute; the offsets between members are implicit.
- Group ids are scoped to a scene. Scene duplicate and import copy them as is. Pasted tokens never carry one.

**Writer**

- A position write on any member, through any marker, light or AoE writer, shifts the rest of the group by the same delta in the same transaction. So GM drags, TV drags, group drags and undo/redo all behave the same way.
- **Explicit wins:** a row positioned explicitly in the same transaction is never shifted, so dragging several members together moves each once.
- `{ detached: true }` moves one member alone.
- Deleting a member leaves the rest grouped. A group left with one member behaves like an ungrouped item.

**Live drag preview**

- `buildRenderProps` applies a dragged token's local delta to the rest of its group, unless `detachedMarkerId` names it.

**GM flow**

- **Group:** select several items (`Shift+click`, `Shift+drag`, which now also pick lights), press `B`. If the selection touches existing groups, they merge into one (the group expands).
- **Selecting:** a plain click on any member selects the whole group. Clicking again (anywhere on the group) selects the members one at a time, tokens first, then lights, then AoEs, and then the whole group again. Shift+click and the marquee add or remove whole groups.
- **Dragging:** with the whole group selected, dragging any member moves the group. A member picked out by cycling moves alone, and keeps its new offset.
- **Ungroup:** `B` with the whole group selected ungroups everything. `B` with one picked-out member removes just that member; a group left with one member dissolves.
- **Delete:** with no tool active, Delete removes everything selected (tokens, lights and AoEs).
- **Stage input:** a press on an already selected token or light reports the click on release, and only when the press didn't become a drag, so dragging a selected group doesn't cycle it. A tap on the only selected AoE is still reported.

## Files

- `apps/web/src/routes/(app)/[party]/[gameSession]/[[selectedScene]]/+page.svelte`
- `apps/web/src/lib/components/GameSession/SidePanelTabs.svelte`
- `apps/web/src/lib/components/Combat/InitiativeTracker.svelte` (layout only)
- `apps/web/src/lib/components/GameSession/AoeTemplateControls.svelte`, `SceneControls.svelte`
- `apps/web/src/lib/realtime/docSchema.ts`, `types.ts`, `buildRenderProps.ts`
- `apps/web/src/lib/utils/assetGroups.ts` (new: selection cycling and the `B` plan)
- `apps/web/src/lib/db/app/schema.ts` (`group_id` on markers, lights and AoE templates)
- `packages/stage`: `MarkerLayer`, `LightLayer`, `AoeTemplateLayer`, `Stage`/`Scene` exports (`selectedLightIds`, `lights.hitTest/inRectangle`)
- `apps/web/src/routes/api/gameSessions/importGameSession/+server.ts` (lights carry `groupId`)
- Tests: `docSchema.test.ts`, `assetGroups.test.ts`, `buildSceneProps.test.ts` (render-props preview)

## Testing strategy

**Unit tests**

- Moving any member (token, light or AoE) shifts the rest of its group; other groups and ungrouped rows stay put.
- A detached move leaves the group in place.
- Explicit wins inside a transaction.
- Deleting a member keeps the rest grouped.
- Undo restores a group move in one step.
- Selection cycling, Shift+click toggling, group expansion and every `B` outcome.
- Render-props drag preview, with and without a detached token.

**Manual**

- Group a token, a light and a cone; drag each of them and check all three move, on the GM screen and on the TV.
- Click the group repeatedly and check it walks token, light, cone, group. Drag the picked cone alone, then check the group keeps the new offset.
- `B` on a picked member removes it; `B` on the whole group ungroups it. Group a group with another token and check it expands.
- Undo a group move.
- Recolor a selected AoE from the toolbar, then draw a new one and check it uses the tool effect.
- Start combat, switch tools, and check the column stays.
- Click tokens and check the stat block follows.

## Edge cases

- **Member deleted remotely or undone:** the rest keep their positions and stay grouped; a group of one acts ungrouped.
- **Picked member moved alone:** its offset changes, and the group keeps the new spot.
- **Overlapping members:** cycling is click-order based, so a light hidden under its token is still reachable.
- **Migration not run:** server persistence of marker, light and AoE rows fails. The user has to run the migration before using the feature.
