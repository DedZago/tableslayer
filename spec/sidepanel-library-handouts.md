# Spec: Side panel tabs, asset library and player handouts

Part of `spec/dnd-combat-polish.md`. Scope tag: **PANEL**. The 5etools search view itself is specified in
`spec/5etools-statblocks.md` (scope **5E**); this spec only defines where it opens from.

## Problem

`HandoutControls` and `AssetLibrary` are native `<details>` blocks stacked inside the right-hand paneforge column:

1. The handout block sits above every tool and steals height from Annotation/Light/Marker managers (up to `50dvh` + a fixed 12rem preview).
2. `open={!!preview || !!active}` re-opens the handout block on every render while a handout is live.
3. AssetLibrary + MarkerManager (`height: 100%`) inside one scroller → nested double scrollbars, sticky header in the wrong context. AssetImport adds a third scroller three disclosure levels deep.
4. AssetLibrary lives in the `{:else}` branch → unmounts when Draw/Light is active, losing search text and form state.
5. `previewAssetHandout` / `previewTokenHandout` always call `markersPane.expand()` → the stage refits and the map jumps.
6. The "Preview handout" text button is in MarkerManager's `imagePreview` snippet, used in every list row → rows wrap.
7. The asset edit form (6 fields) is always visible; delete has no confirmation; native widgets don't match the app.

## Decision (confirmed with user)

**Docked tabs in the right pane**: `Tokens | Library | Handout`. The pane already resizes, collapses, persists its layout,
refits the stage and becomes a bottom sheet on mobile. The 5etools catalog opens as a larger overlay from the Library tab.

```
┌── map ────────────────┬[Tokens][Library][Handout●]┐
│                       │ [🔍 Search assets…][×1][+][⇣][🔖]│
│                       │ ┌──┐┌──┐┌──┐┌──┐              │
│                       │ │🖼││🖼││🖼││🖼│  hover: ⊕ ▣ ⋯  │
│                       │ └──┘└──┘└──┘└──┘              │
│ [● Players see: Map ✕]│ Drag a tile onto the map      │
└───────────────────────┴───────────────────────────────┘
```

## Files

| File                                                                                              | Change                                                                                                    |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `apps/web/src/lib/components/GameSession/SidePanelTabs.svelte` (new)                              | tab strip                                                                                                 |
| `apps/web/src/lib/components/Assets/AssetLibrary.svelte`                                          | rewrite: toolbar + thumbnail grid + view switch (`grid`/`edit`)                                           |
| `apps/web/src/lib/components/Assets/AssetEditor.svelte` (new)                                     | edit/create sub-view                                                                                      |
| `apps/web/src/lib/components/Assets/assetPlacement.ts` (new)                                      | shared `placeAsset(...)` used by click-place and drop-place                                               |
| `apps/web/src/lib/components/Assets/types.ts`, `index.ts`                                         | props/exports                                                                                             |
| `apps/web/src/lib/components/Handouts/HandoutPanel.svelte` (new, replaces HandoutControls)        | compact panel                                                                                             |
| `apps/web/src/lib/components/Handouts/HandoutLivePill.svelte` (new)                               | "Players see: …" pill over the stage                                                                      |
| `apps/web/src/lib/components/Handouts/HandoutOverlay.svelte`                                      | fade-in + backdrop polish (player view)                                                                   |
| `apps/web/src/lib/components/Handouts/index.ts`                                                   | exports (keep `HandoutControls` export as alias of `HandoutPanel` until all imports updated, then remove) |
| `apps/web/src/lib/components/GameSession/MarkerManager.svelte`                                    | remove "Preview handout" from `imagePreview`; add ghost "Show as handout" button in edit view             |
| GM `+page.svelte`                                                                                 | tabs, mount panels, drag-to-map, live pill, preview behaviour                                             |
| `apps/web/tests/e2e/{handouts,persistence,asset-library,asset-catalog,asset-import}.auth.test.ts` | selectors                                                                                                 |

## Implementation steps

### 1. `SidePanelTabs.svelte`

Props: `selected: 'tokens' | 'library' | 'handout' | 'combat'`, `onSelect(tab)`, `handoutLive: boolean`, `combatLive: boolean`, `showLibrary: boolean`, `showHandout: boolean`.
The fourth tab "Combat" (`IconSwords`, live dot when `combatLive`) is always shown to the GM; its panel content comes from INIT (`spec/initiative-tracker.md`).
`AssetEditor` also gets an "Initiative bonus" numeric field (empty = automatic), saved as asset `initiativeBonus` (INIT).

- `role="tablist"`; each tab a `<button role="tab" aria-selected id="sidePanelTab-<name>" aria-controls="sidePanel-<name>">`.
- Icons + labels: Tokens (`IconUsers`), Library (`IconBooks`), Handout (`IconPhoto`), all 14px icons with text.
- Live dot `.sidePanelTabs__liveDot` (8px circle, `var(--fgSuccess)`) on Handout when `handoutLive`.
- CSS: `.sidePanelTabs { display: flex; gap: 0.25rem; padding: 0.5rem 1rem; border-bottom: var(--borderThin); position: sticky; top: 0; background: var(--bg); z-index: 1; }`
  `.sidePanelTabs__tab { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 0.375rem; padding: 0.375rem 0.5rem; border-radius: var(--radius-2); color: var(--fgMuted); font-size: 0.875rem; }`
  `.sidePanelTabs__tab:hover { background: var(--menuItemHover); color: var(--fg); }`
  `.sidePanelTabs__tab--isActive { background: var(--fgPrimary); color: var(--bg); }` (check contrast in both themes; if poor use `var(--contrastLow)` + `color: var(--fg)` + 2px bottom border `var(--fgPrimary)`).
- Keyboard: Left/Right arrows move between tabs.

### 2. `+page.svelte` structure

- `let sidePanelTab = $state<'tokens' | 'library' | 'handout' | 'combat'>('tokens');`
- In `handleSelectActiveControl`: when the control is annotation / light / marker / aoe → `sidePanelTab = 'tokens'`.
- Restructure the right pane `.editor-tools`:
  ```svelte
  <div class="editor-tools">
    <SidePanelTabs
      selected={sidePanelTab}
      onSelect={(t) => (sidePanelTab = t)}
      handoutLive={!!activeHandout}
      showLibrary={canEditAssets}
      showHandout={canPresentHandouts}
    />
    <div class="editor-tools__content" id="sidePanel-tokens" role="tabpanel" hidden={sidePanelTab !== 'tokens'}>
      {#if !isMarkersCollapsed}
        …existing Annotation/Light/Checklist/Marker managers (no AssetLibrary, no HandoutControls)…
      {/if}
    </div>
    <div class="editor-tools__content" id="sidePanel-library" role="tabpanel" hidden={sidePanelTab !== 'library'}>
      <AssetLibrary … />
    </div>
    <div class="editor-tools__content" id="sidePanel-handout" role="tabpanel" hidden={sidePanelTab !== 'handout'}>
      {#if canPresentHandouts}<HandoutPanel … />{/if}
    </div>
  </div>
  ```
  Library and Handout stay mounted (CSS `hidden`) so their state survives tab switches.
  CSS: `.editor-tools { display: flex; flex-direction: column; height: 100%; min-height: 0; }`
  `.editor-tools__content { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }`
  `.editor-tools__content[hidden] { display: none; }` — each child manages its own scroll.
- `previewAssetHandout` / `previewTokenHandout`: set `sidePanelTab = 'handout'`; call `markersPane.expand()` **only if** `isMarkersCollapsed`.
- Add "Show as handout" and "Save to library" to the token right-click panel actions (see COND spec `TokenContextPanel`).

### 3. Drag asset tiles onto the map

- Tile: `draggable="true"`, `ondragstart={(e) => { e.dataTransfer!.setData('application/x-tableslayer-asset', asset.id); e.dataTransfer!.effectAllowed = 'copy'; }}`.
  Use a small drag image: `e.dataTransfer.setDragImage(tileImgEl, 32, 32)`.
- Page `handleCanvasDragOver`: **before** the existing file guard, `if (e.dataTransfer?.types.includes('application/x-tableslayer-asset')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; return; }` (`getData` is unavailable during dragover).
- Page `handleCanvasDrop`: if the asset MIME is present → `const id = e.dataTransfer.getData(...)`;
  `const point = stage.markers.clientToPosition({ x: e.clientX, y: e.clientY }, true);` if `null` → toast "Drop inside the map";
  else `placeAsset({ assetId: id, quantity: libraryQuantity, at: point, … })`.
- `assetPlacement.ts`: move the current `place()` logic out of AssetLibrary into
  `export const placeAsset = async ({ assetId, quantity, at, sceneId, client, mutate }) => …` that lays out N copies in a
  compact grid starting at `at` (offsets in grid cells from `at`, not from 0,0) and writes all rows in one `client.write.transaction`.
  Click-place uses the current viewport centre (`stage.scene.getViewportCenter?.()` if available, else `{x:0,y:0}`).
  Keep quantity as library state passed to the page via a bindable prop or callback.

### 4. `AssetLibrary.svelte` rewrite

Props (keep existing): `client, sceneId, selectedMarkerId, bucketUrl, onPreviewArtwork`; add `onOpenCatalog()` and `quantity` (bindable).

- `let view = $state<'grid' | 'edit'>('grid'); let editing = $state<SelectAsset | null>(null);`
- Block `.assetLibrary { height: 100%; display: flex; flex-direction: column; min-height: 0; }`
- Toolbar `.assetLibrary__toolbar` (one row, `display: flex; gap: 0.5rem; align-items: center; padding: 0.75rem 1rem; border-bottom: var(--borderThin);`):
  - `Input` search (`aria-label="Search assets"`, placeholder "Search assets…", leading `IconSearch`), `flex: 1`.
  - `Input type="number" aria-label="Quantity" min=1 max=20` width `3.5rem`, prefix "×".
  - IconButtons with ToolTips: New asset (`IconPlus`), Add from 5etools (`IconDownload`, calls `onOpenCatalog`),
    Save selected token (`IconBookmarkPlus`, only when `selectedMarkerId`).
- Grid `.assetLibrary__list` (keep this class for tests) `display: grid; grid-template-columns: repeat(auto-fill, minmax(5.5rem, 1fr)); gap: 0.75rem; padding: 1rem; overflow-y: auto; flex: 1; min-height: 0; align-content: start;`
- Tile `.assetLibrary__item` — a `div` containing:
  - `<button class="assetLibrary__tile" aria-label="Place {name}">` (click = place; `aspect-ratio: 1; border-radius: var(--radius-2); background: var(--contrastLow); border: var(--borderThin); position: relative; overflow: hidden;` hover/focus border `var(--fgPrimary)`)
  - `<img class="assetLibrary__tileImage">` 128×128 via `generateR2Url`, `object-fit: contain`, `loading="lazy"`.
  - Badges top-left `.assetLibrary__badge` (e.g. "CR ¼", "Stats") — 0.625rem pill, `background: color-mix(in srgb, var(--bg) 80%, transparent)`.
  - Hover actions `.assetLibrary__tileActions` bottom bar, `opacity: 0` → `1` on `:hover` / `:focus-within`:
    IconButtons Place (`aria-label="Place"`, `IconPlus`), Show as handout (`IconPresentation`), More (`IconDots` → `ContextMenu` with Edit, Show as handout, Delete (danger, confirm via second click "Click again to delete" or `ConfirmActionButton`)).
  - `oncontextmenu` on the tile opens the same `ContextMenu`.
  - Name `.assetLibrary__tileName` below the tile: `font-size: 0.75rem; color: var(--fgMuted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center;`
- Empty state `.assetLibrary__empty`: "No assets yet. Add one from 5etools or save a token from the map." with two ghost buttons.
- Footer hint `.assetLibrary__hint` (muted, 0.75rem): "Click to place · drag onto the map · right-click for more".
- `view === 'edit'` → `<AssetEditor asset={editing} … onClose={() => (view = 'grid')} />`.

### 5. `AssetEditor.svelte`

Props: `asset?: SelectAsset | null`, `bucketUrl`, `onClose()`, `onSaved(asset)`.

- `.assetEditor__back` — `Link` "← Back to library".
- `.assetEditor__formGrid` (copy MarkerManager's `__formGrid`: 2 columns, 1 column under a 420px container width via `@container`).
- Fields: artwork drop tile `.assetEditor__artwork` (hidden `<input type=file aria-label="Artwork file">`, drop via `$lib/utils/imageDrop`),
  `FormControl label="Asset name"` + `Input`, Shape `RadioButton` (MarkerManager icons + "None"), Size `RadioButton` S/M/L,
  Colour `Popover` + `ColorPickerSwatch`, Image scale `InputSlider` 0.1–10.
- Footer `.assetEditor__footer`: primary `Button` "Save asset"/"Create asset", `ConfirmActionButton` Delete when editing.
- If the asset has a stat block show a read-only summary line "CR 1/4 · Small humanoid · stats attached" (`assetEditor__stats`).

### 6. `HandoutPanel.svelte` (replaces HandoutControls)

Same props as `HandoutControlsProps`. No `<details>`, no `max-height`.

- `.handoutPanel { display: flex; flex-direction: column; gap: 1rem; padding: 1rem; overflow-y: auto; height: 100%; }`
- Empty state `.handoutPanel__dropzone`: dashed `2px dashed var(--contrastMedium)`, `border-radius: var(--radius-2)`, `padding: 2rem`,
  centered text "Drop an image here or click to upload" + muted second line "Or right-click a token → Show as handout". Contains the
  hidden `<input type=file aria-label="Upload handout image">`; accepts drops.
- With a preview/active handout `.handoutPanel__preview` (`aspect-ratio: 4/3; background: var(--contrastEmpty); border: var(--borderThin); border-radius: var(--radius-2); position: relative;` `data-testid="handoutPreview"`):
  - `HandoutImage` contain-fit.
  - `.handoutPanel__badge--live` top-left "LIVE" (`background: var(--fgPrimary); color: var(--bg); font-size: 0.625rem; letter-spacing: 0.08em; text-transform: uppercase`) when shown to players.
  - `.handoutPanel__dismiss` IconButton (`IconX`, `aria-label="Close preview"`) top-right when not live.
- Title `Input variant="transparent" aria-label="Handout title" placeholder="Title (optional)"`.
- `.handoutPanel__actions`: one primary `Button` toggling "Show to players" ↔ "Hide handout"; ghost `Button` "Replace image".
- Status: visually hidden `<p role="status">` keeping the existing status text (tests use it); paused note as muted text.

### 7. `HandoutLivePill.svelte`

Shown over the stage (inside `.stageWrapper`, top-left, `position: absolute; z-index: 2`) when a handout is live:
`● Players see: <title or "Handout">  [Hide]`. Pill: `background: color-mix(in srgb, var(--bg) 85%, transparent); border: var(--borderThin); border-radius: 999px; padding: 0.25rem 0.5rem 0.25rem 0.75rem; box-shadow: var(--shadow-1);`
Clicking the text switches to the Handout tab (and expands the pane if collapsed). Hide calls the same hide logic as the panel —
extract publish/hide into `apps/web/src/lib/components/Handouts/handoutActions.ts` so both use it.

### 8. Player overlay polish (`HandoutOverlay.svelte`)

Fade in 150 ms (`transition:fade`), backdrop `color-mix(in srgb, var(--bg) 92%, transparent)`, image framed with `var(--shadow-2)`,
caption bold. Respect `prefers-reduced-motion` (no fade).

### 9. MarkerManager

Delete the "Preview handout" button from the `imagePreview` snippet and its `.markerManager__handoutButton` style.
In the edit view, beside "Change image", add ghost `Button` with `IconPresentation` "Show as handout".

### 10. E2E tests

Replace `.handout-controls` + `summary` with clicking tab "Handout"; `.assets` + `summary` / text "Personal asset library" with
tab "Library"; Edit/Delete buttons with the tile `More` menu items. Keep accessible names: Search assets, Quantity, Place,
Upload handout image, Handout title, Show to players, Hide handout, `role=status`, testid `handoutPreview`.

## Testing

- `pnpm run check`, `pnpm run format-check`; e2e specs listed above.
- Manual: switching tabs never resizes the map; Library search text survives switching to Draw and back; showing a handout from a
  token jumps to the Handout tab without map refit if the pane is open; live pill appears/hides; drag 3× goblin onto the map places
  3 tokens around the drop point; mobile bottom sheet shows tabs.

## Edge cases

- Users without asset/handout permissions: hide those tabs; if only Tokens remains, hide the tab strip.
- Drop outside the map rect → toast, no placement.
- Popover/ContextMenu inside the pane → `portal="body"` to avoid clipping.
