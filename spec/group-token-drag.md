# Spec: Group token drag ("party movement")

Part of `spec/dnd-combat-polish.md`. Scope tag: **GROUP**. Depends on PERF step 4 (drag threshold) — both live in `MarkerLayer.svelte` and are implemented by the same agent.

## Problem

Multi-select already exists in the GM editor (Shift+click toggles, Shift+drag rectangle, sidebar checkboxes, "Select all"),
but dragging a selected token collapses the selection: `MarkerLayer.onMouseDown` always calls `onMarkerSelected(marker)`,
and the page sets `selectedMarkerIds = [marker.id]`. Only one token moves.

## Behaviour

- With ≥ 2 tokens selected, pressing on **any selected token** and dragging moves **all selected tokens** together, keeping
  their relative offsets.
- The grabbed token is the *anchor*. The token does not jump to the cursor: the grab offset is preserved.
- Snapping (when grid snap is on): the anchor's target is snapped; the same delta is applied to every member.
  - Square grid: the delta is rounded to **whole cells** (`getGridCellSize(grid, display)`), so centred tokens stay centred.
  - Hex grid: anchor snapped with `centerOnly = true`.
- Pressing on a selected token and releasing **without moving** (< threshold) collapses the selection to that token (design-tool behaviour).
- Pressing on an **unselected** token behaves as today (selects it alone, drags it alone).
- Pin-shaped tokens and tokens that aren't interactable are excluded from the group (they stay put).
- `Escape` during a group drag restores all start positions.
- `Ctrl/Cmd + A` (when no text input is focused and the active tool is None or Marker) selects all GM-visible tokens.
  `Escape` with no tool active and no drag clears the selection.
- The whole gesture is **one undo step** and players see the group move live (one Y transaction per throttle tick).

## Files

| File | Change |
| --- | --- |
| `packages/stage/src/lib/components/Stage/types.ts` | add optional callback `onMarkersMoved` |
| `packages/stage/src/lib/components/Stage/components/MarkerLayer/MarkerLayer.svelte` | group-drag state machine |
| `apps/web/src/lib/realtime/SessionDocClient.svelte.ts` | `beginUndoGroup()` / `endUndoGroup()` |
| `apps/web/src/lib/realtime/docSchema.test.ts` | undo-group test |
| `apps/web/src/routes/(app)/[party]/[gameSession]/[[selectedScene]]/+page.svelte` | `onMarkersMoved` writer, select-all, Escape, flush on hide |
| `apps/web/src/lib/components/GameSession/Shortcuts.svelte` | document new shortcuts |
| `docs/undo-redo-architecture.md`, `.claude/skills/stage-rendering/SKILL.md` | document undo groups + group drag |

## Implementation steps

### 1. Callback type

`Stage/types.ts`, in the callbacks interface next to `onMarkerMoved`:

```ts
/** Group drag: called once per pointer move with every moved marker. Optional — falls back to onMarkerMoved per marker. */
onMarkersMoved?: (moves: Array<{ marker: Marker; position: { x: number; y: number } }>) => void;
```

### 2. Stage: `MarkerLayer.svelte`

1. Read `onMarkersMoved` from the callbacks context next to `onMarkerMoved`.
2. State:
   ```ts
   type GroupDrag = {
     anchorId: string;
     anchorStart: THREE.Vector2;
     grabOffset: THREE.Vector2; // cursor - anchorStart at mousedown
     members: { marker: Marker; start: THREE.Vector2 }[];
     lastDelta: THREE.Vector2 | null;
   };
   let groupDrag: GroupDrag | null = null;
   ```
3. Selection source: `const currentSelection = () => stage.selectedMarkerIds ?? props.marker.selectedIds ?? [];` (see PERF step 3).
4. `onMouseDown` — after finding `closestMarker` and after the double-click check, if **all** hold:
   `stage.mode === StageMode.DM`, `closestMarker.shape !== MarkerShape.Pin`, `currentSelection().includes(closestMarker.id)`,
   `currentSelection().length > 1`:
   - `members` = markers whose id is in the selection, are interactable (`isTokenInteractable`) and not Pin.
   - Set `groupDrag`, set `pendingDrag` (PERF step 4), clear hover timers, **return before calling `onMarkerSelected`**.
5. Delta helper (inside the component):
   ```ts
   const resolveGroupDelta = (cursor: THREE.Vector2, drag: GroupDrag): THREE.Vector2 => {
     const target = cursor.clone().sub(drag.grabOffset);
     const delta = target.sub(drag.anchorStart);
     if (!props.grid.snapToGrid /* use the existing snap flag the single drag uses */) return delta;
     if (props.grid.gridType === GridType.Square) {
       const cell = getGridCellSize(props.grid, props.display);
       return new THREE.Vector2(Math.round(delta.x / cell) * cell, Math.round(delta.y / cell) * cell);
     }
     const snapped = snapToGrid(drag.anchorStart.clone().add(delta), props.grid, props.display, true /* centerOnly */, localScale);
     return new THREE.Vector2(snapped.x, snapped.y).sub(drag.anchorStart);
   };
   ```
   Use the same snap flag / helpers the existing single-token drag uses (look at the current `snapToGrid(...)` call in `onMouseMove`).
6. `onMouseMove` — when `groupDrag` and the drag threshold is passed:
   - `delta = resolveGroupDelta(cursorWorld, groupDrag)`; if `lastDelta` equals `delta` → return (no write).
   - `moves = members.map(({ marker, start }) => ({ marker, position: { x: start.x + delta.x, y: start.y + delta.y } }))`.
   - `onMarkersMoved ? onMarkersMoved(moves) : moves.forEach((m) => onMarkerMoved(m.marker, m.position))`.
7. `onMouseUp`: if `groupDrag && !dragMoved` → `onMarkerSelected(anchorMarker)`. Reset `groupDrag = null`.
8. `Escape` (window keydown, only while `groupDrag`): emit moves with `delta = (0,0)` (start positions), then end the drag.
9. Reset `groupDrag` in `onSceneChange` and in the window `mouseup`/`blur` handler (PERF step 4.5).

### 3. Undo groups: `SessionDocClient.svelte.ts`

Next to `stopCapturing()`:

```ts
beginUndoGroup = () => {
  this.#undoManager?.stopCapturing();
  if (this.#undoManager) this.#undoManager.captureTimeout = Number.POSITIVE_INFINITY;
};
endUndoGroup = () => {
  if (!this.#undoManager) return;
  this.#undoManager.captureTimeout = 500; // matches the default used when the manager is created
  this.#undoManager.stopCapturing();
};
```

Match the real field/variable names of the per-scene undo manager in that file. Test in `docSchema.test.ts` ("undo/redo"
suite): with fake timers, `beginUndoGroup()` + 20 position transactions spread over 2 s + `endUndoGroup()` → one `undo()`
restores all original positions.

### 4. GM page writer (`+page.svelte`, next to `onMarkerMoved`)

**Do not reuse `writeMarkerPosition`**: its `throttle` keeps only the last arguments, so per-marker calls in the same tick would drop writes.

```ts
let groupDragPending: Record<string, { x: number; y: number }> = {};
let groupClearTimer: ReturnType<typeof setTimeout> | undefined;

const writeGroupPositions = throttle(() => {
  const client = session.client;
  const batch = groupDragPending;
  groupDragPending = {};
  if (!client) return;
  client.write.transaction(() => {
    for (const [id, p] of Object.entries(batch)) {
      client.write.setMarkerFields(selectedSceneId, id, { positionX: p.x, positionY: p.y });
    }
  });
}, 50);

const finishGroupDrag = () => {
  const client = session.client;
  const ids = Object.keys(groupDragFinal);
  if (client && ids.length) {
    client.write.transaction(() => {
      for (const id of ids) client.write.setMarkerFields(selectedSceneId, id, { positionX: groupDragFinal[id].x, positionY: groupDragFinal[id].y });
    });
  }
  for (const id of ids) delete dragPositions[id];
  groupDragFinal = {};
  groupClearTimer = undefined;
  client?.endUndoGroup();
};
let groupDragFinal: Record<string, { x: number; y: number }> = {};

const onMarkersMoved = (moves: Array<{ marker: Marker; position: { x: number; y: number } }>) => {
  if (groupClearTimer === undefined) session.client?.beginUndoGroup();
  for (const { marker, position } of moves) {
    const target = stageProps.marker.markers.find((m) => m.id === marker.id);
    if (target) target.position = position; // same in-place pattern as onMarkerMoved
    dragPositions[marker.id] = position;
    groupDragPending[marker.id] = position;
    groupDragFinal[marker.id] = position;
  }
  writeGroupPositions();
  clearTimeout(groupClearTimer);
  groupClearTimer = setTimeout(finishGroupDrag, 300);
};
```

- Pass `onMarkersMoved` in the `callbacks` object given to `<Stage>`.
- Extend `commitPendingGestureWrites` (called when the tab is hidden): if `groupClearTimer !== undefined`,
  `clearTimeout(groupClearTimer); finishGroupDrag();`.
- Mirror whatever `onMarkerMoved` does for the scene thumbnail idle guard (it already checks `dragPositions`).

### 5. Shortcuts (`+page.svelte` `handleKeydown`)

- Skip if the event target is an input/textarea/contenteditable (reuse the existing guard in `handleKeydown`).
- `Ctrl/Cmd + A` with `activeLayer` None or Marker: `setSelection(stageProps.marker.markers.filter((m) => m.visibility !== MarkerVisibility.Player).map((m) => m.id)); event.preventDefault();`
  (keep the same filter the pruning effect uses so the selection isn't immediately pruned).
- `Escape` with no active tool: `setSelection([])`. Check `utils/stageKeyCommands.ts` first so Escape isn't handled twice.
- `Shortcuts.svelte`: add rows "Select all tokens — Ctrl/⌘ + A", "Move selected tokens — drag any selected token", "Clear selection — Esc".

## Testing

- Unit: undo-group test (above).
- Manual: select 4 tokens (Shift+drag), drag one → all move, relative layout kept, grid-aligned; Ctrl+Z restores all in one step;
  player view shows the group moving live; click (no move) on a selected token selects only it; Escape mid-drag restores;
  releasing outside the canvas ends the drag.

## Edge cases

- Group containing a token on another scene: impossible (selection is cleared on scene switch).
- A member deleted by another editor mid-drag: `setMarkerFields` on a missing id must be a no-op — verify, otherwise guard with `existsMarker`.
- Pause > 500 ms mid-drag: still one undo step (capture timeout is infinite during the group).
- Touch: group drag works the same with the touch threshold.
