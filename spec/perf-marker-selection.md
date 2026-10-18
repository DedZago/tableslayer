# Spec: Instant token selection (performance)

Part of `spec/dnd-combat-polish.md`. Scope tag: **PERF**.

## Problem

Clicking a token on the GM stage takes a noticeable time before the token is highlighted and the side panel switches.
Hit-testing itself is cheap (one raycast + O(n) distance check in `MarkerLayer.svelte` `findClosestMarker`), selection is
local `$state` and never goes over the network. The latency comes from what a single selection change triggers:

| ID  | Root cause                                                                                                                                                                                                                                                                                                                                             | Impact   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| RC1 | `{#key selectedMarkerId}` around `<MarkerManager>` in the GM page destroys and rebuilds the whole side panel (including a TipTap editor, ColorPicker, popovers) on every selection — even while the pane is collapsed.                                                                                                                                 | HIGH     |
| RC2 | `MarkerToken.svelte` `drawMarker()` reads `isHovered \|\| isSelected` to pick the stroke colour, so hover/select re-rasterises a 1024px+ canvas with gaussian shadow blur, calls `getComputedStyle(document.documentElement)` (forced style recalc), disposes the texture and uploads a new ~5 MB `CanvasTexture` — for the old **and** the new token. | HIGH     |
| RC3 | `renderStageProps = $derived({...stageProps, marker: {...stageProps.marker, selectedIds, dropTargetId}})` creates a brand-new props object on each selection change, re-running every `props`-reading effect in Stage/Scene/layers. The pruning effect always assigns a new array; `pinnedMarkerIds` is rebuilt on every markers change.               | MED-HIGH |
| RC4 | `MarkerLayer` sets `isDragging = true` on mousedown with no movement threshold; 1–2 px of jitter writes positions to the Y doc, rebuilds the whole scene props, and can snap the token into another cell (also creating an undo step).                                                                                                                 | MED      |
| RC5 | `<Canvas renderMode="always">` + heavy frame may add up to a frame of latency. Measure only; do not change render mode (animated shaders need it).                                                                                                                                                                                                     | LOW      |

Rust/WASM is **not** a fit here: the cost is DOM/Svelte reactivity and GPU uploads, not computation.

## Goals

- Click → highlight visible in the next frame (< 16 ms of main-thread work on a 50-token scene).
- Click → side panel updated in < 50 ms.
- A click with < 3 px movement never writes to the Y doc.

## Files

| File                                                                                       | Change                                                                                                                              |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/routes/(app)/[party]/[gameSession]/[[selectedScene]]/+page.svelte`           | remove `{#key}`, remove `renderStageProps`, add `setSelection`, memoise `pinnedMarkerIds`, don't mount pane content while collapsed |
| `apps/web/src/lib/components/GameSession/MarkerManager.svelte`                             | edit view uses `$derived` `editingMarker` + `{#if}` (no keyed `#each`); one Editor instance reused                                  |
| `packages/ui/src/lib/components/Editor/Editor.svelte`                                      | `setContent(content, { emitUpdate: false })` when content changes from outside (**needs changeset — user creates, `patch`**)        |
| `packages/stage/src/lib/components/Stage/components/MarkerLayer/MarkerToken.svelte`        | separate highlight ring mesh, cached CSS var, reuse CanvasTexture, smaller canvas, shared geometry, image cache                     |
| `packages/stage/src/lib/components/Stage/components/MarkerLayer/MarkerLayer.svelte`        | drag start threshold, optimistic selection, read selection from stage context                                                       |
| `packages/stage/src/lib/components/Stage/components/Stage/Stage.svelte` + `Stage/types.ts` | new props `selectedMarkerIds`, `dropTargetMarkerId` copied into stage context                                                       |
| `packages/stage/src/lib/components/Stage/helpers/tokenRasterCache.ts` (new)                | module-level image + CSS var caches                                                                                                 |
| `.claude/skills/stage-rendering/SKILL.md`                                                  | update "Editor selection" + new gotchas, bump "last verified"                                                                       |

## Implementation steps

### Step 1 — Stop remounting the side panel (RC1)

1. In `+page.svelte` find `{#key selectedMarkerId}` (≈ line 2042) and delete the `{#key}` / `{/key}` lines, leaving `<MarkerManager …/>` as is.
2. In `MarkerManager.svelte` find the edit-view loop
   `{#each stageProps.marker.markers.filter((m) => m.id === editingMarkerId) as marker (marker.id)}`.
   - Add near the other derived values: `const editingMarker = $derived(stageProps.marker.markers.find((m) => m.id === editingMarkerId));`
   - Replace the `{#each …}` / `{/each}` with `{#if editingMarker}` / `{/if}` and rename `marker` → `editingMarker` inside that block
     (or add `{@const marker = editingMarker}` as the first line inside the `{#if}` to keep the diff small).
3. Notes editor reuse:
   - In `packages/ui/src/lib/components/Editor/Editor.svelte`, in the `$effect` that syncs external `content` into the editor,
     change `editor.commands.setContent(content)` to `editor.commands.setContent(content, { emitUpdate: false })`.
   - In MarkerManager replace `bind:content={marker.note}` with `content={marker.note}` and an `onChange` handler that
     captures the id at call time: `onChange={(json) => saveNote(marker.id, json)}` where `saveNote` calls the existing
     note-save path with that explicit id. A pending throttled save must never land on a different token.
4. In `+page.svelte`, wrap the right-pane tool content (the block containing AnnotationManager / LightManager / MarkerManager)
   in `{#if !isMarkersCollapsed}` … `{/if}`. The double-click path (`onMarkerDoubleClick`) expands the pane, which mounts it — fine.
   **Coordinate with `spec/sidepanel-library-handouts.md`**: after the tab redesign, only the _Tokens_ tab content is gated; Library/Handout stay mounted.

### Step 2 — Highlight ring as its own mesh (RC2)

In `MarkerToken.svelte`:

1. In `drawMarker()` remove the `isHovered || isSelected` branch: always stroke with the normal `strokeColor`. After this,
   the canvas `$effect` must depend only on appearance values (shape, colour, label, image, text, shadow, size).
   Verify by reading every value the effect reads — each must be a `$derived` primitive, never `marker` itself
   (see stage-rendering skill: "Effects must key off prop VALUES").
2. Add a highlight mesh as a sibling of the token mesh inside the same `<T.Group>`:
   ```svelte
   <T.Mesh
     geometry={getHighlightGeometry(marker.shape)}
     material={isSelected ? selectedRingMaterial : hoverRingMaterial}
     visible={isSelected || isHovered}
     renderOrder={SceneLayerOrder.Marker + 1}
     scale={[ringScale, ringScale, 1]}
     layers={[SceneLayer.Main]}
   />
   ```
   - Create in a new module `helpers/tokenRasterCache.ts` (module-level, created lazily once, never disposed per token):
     - `getHighlightGeometry(shape)` — `RingGeometry(0.46, 0.5, 64)` for circle, a square frame (4 thin `PlaneGeometry`s merged
       via `BufferGeometryUtils.mergeGeometries`, or a `ShapeGeometry` with a hole) for square, triangle frame for triangle. Pin shape → circle.
     - `selectedRingMaterial` / `hoverRingMaterial` — `MeshBasicMaterial({ color, transparent: true, depthTest: false })`.
       Colour from `getCssColor('--fgPrimary')` (see step 3). Hover uses the same colour at `opacity: 0.6`.
   - `ringScale` = the same world size the token quad uses (re-use the existing size computation).
3. CSS variable cache: in `tokenRasterCache.ts` export `getCssColor(name: string): string` that reads
   `getComputedStyle(document.documentElement)` **once** per name and stores it in a `Map`. Export `clearCssColorCache()`
   and call it from a `MutationObserver` on `document.documentElement` attributes `class`/`data-theme` (set up once, lazily).
   Remove all direct `getComputedStyle` calls from the draw path.
4. Reuse the `CanvasTexture`: create it once; on redraw draw into the same canvas and set `texture.needsUpdate = true`.
   Only recreate the canvas/texture when `paddedCanvasSize` changes.
5. Smaller raster: replace the fixed 1024 canvas with `canvasSize = 512` (keep a constant `TOKEN_CANVAS_SIZE = 512` at the top).
   Set `texture.generateMipmaps = true` and `minFilter = THREE.LinearMipmapLinearFilter` (unchanged quality when zoomed out).
   Visually verify tokens still look sharp at max zoom in `apps/docs` stage route; if not, use 768.
6. Image cache: in `tokenRasterCache.ts` add
   `const imageCache = new Map<string, Promise<ImageBitmap>>(); export const loadTokenImage = (url) => …` using
   `fetch(url, { mode: 'cors' })` → `blob()` → `createImageBitmap(blob)`; on failure delete the entry and rethrow.
   Use it in place of the per-token `THREE.Texture` image load. Remove the `imageTexture.dispose()` from `onDestroy`
   (it disposed a shared cached texture).
7. Share the token quad geometry: one module-level `PlaneGeometry(1, 1)` exported from `tokenRasterCache.ts`; never dispose it.

### Step 3 — Selection out of the props object (RC3)

1. `packages/stage/.../Stage/types.ts`: add to `StageProps` (top-level, _not_ inside `marker`):
   `selectedMarkerIds?: string[]; dropTargetMarkerId?: string | null;` (mirror how `hoveredMarkerId` is passed).
2. `Stage.svelte`: copy both into the stage context in the existing context-sync effect.
3. `MarkerLayer.svelte`, where each token's `isSelected` is computed:
   `isSelected={selectedMarker?.id === marker.id || (stage.selectedMarkerIds ?? props.marker.selectedIds ?? []).includes(marker.id)}`
   and likewise `dropTargetMarkerId ?? props.marker.dropTargetId`. `selectedMarker` is the layer's own local state set on
   mousedown → the highlight appears without waiting for the parent. Keep `marker.selectedIds` / `dropTargetId` as
   deprecated optional fallbacks (apps/docs still uses them).
4. `+page.svelte`:
   - Delete `renderStageProps`; pass `props={stageProps}` plus `selectedMarkerIds={selectedMarkerIds}` and
     `dropTargetMarkerId={artworkDropTargetId}` to `<Stage>`.
   - Add helper `const setSelection = (ids: string[]) => { if (ids.length === selectedMarkerIds.length && ids.every((id, i) => id === selectedMarkerIds[i])) return; selectedMarkerIds = ids; };`
     and use it everywhere `selectedMarkerIds =` is assigned (onMarkerSelected, onMarkerAdded, shift-gesture finish,
     MarkerManager `onSelectionChange`, pruning effect, select-all).
   - Pruning effect: early `return` when `selectedMarkerIds.length === 0`; otherwise compute filtered list and call `setSelection`.
   - `pinnedMarkerIds`: keep the previous array when contents are equal:
     ```ts
     let pinnedCache: string[] = [];
     const pinnedMarkerIds = $derived.by(() => {
       const next = stageProps.marker.markers.filter((m) => m.pinnedTooltip).map((m) => m.id);
       if (next.length === pinnedCache.length && next.every((id, i) => id === pinnedCache[i])) return pinnedCache;
       pinnedCache = next;
       return next;
     });
     ```

### Step 4 — Drag start threshold (RC4)

In `MarkerLayer.svelte`:

1. Add constants `DRAG_START_THRESHOLD_PX = 3` (mouse) and `TOUCH_DRAG_START_THRESHOLD_PX = 8`.
2. `onMouseDown`: instead of `isDragging = true`, set `pendingDrag = { clientX, clientY, isTouch }`.
3. `onMouseMove`: if `pendingDrag` and the pointer moved more than the threshold → `isDragging = true; dragMoved = true;`
   clear hover tooltip timers, then continue with the existing move logic. If not past threshold → return.
4. `onMouseUp`: clear `pendingDrag`.
5. Add a `window` `mouseup` + `blur` listener while `isDragging || pendingDrag` that calls `onMouseUp()` (fixes stuck drags
   when the button is released outside the canvas). Remove the listener on release and in `onDestroy`.
6. In the GM page `onMarkerMoved`: return early when the new position equals `target.position` (x and y).

### Step 5 — Measure (RC5)

Add temporary timing while developing (remove before commit): `performance.mark('select')` in `onMarkerSelected` and
`requestAnimationFrame(() => performance.measure('select→frame', 'select'))`. Record before/after numbers in the PR description.

## Testing

- `pnpm run check`, `pnpm run format-check`.
- Manual (docs stage route + GM editor, 50 tokens): click tokens rapidly → highlight is instant; side panel switches without flicker;
  a stationary click never moves a token or adds an undo step; releasing a drag outside the canvas ends the drag.
- Theme switch (light/dark) updates the highlight ring colour.
- Notes: edit token A's note, immediately click token B → A's note saved on A, B's note untouched.

## Edge cases

- Touch: keep the existing 50 ms debounce in `LayerInput`; threshold 8 px.
- Pin-shaped markers stay non-draggable.
- Two tokens with the same image URL share one `ImageBitmap`; destroying one must not break the other.
- Changeset: `packages/ui` Editor change → user runs `pnpm changeset` (`patch`).
