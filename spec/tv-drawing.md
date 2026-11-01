# TV drawing: permanent strokes, brush size, eraser, more effects

## Problem

On the TV (`/[party]/play`) Draw makes a _temporary_ layer that lives in presence (awareness), expires after 10 s
(`TEMPORARY_LAYER_TTL_MS`) and only becomes real if someone taps the Save button (`PersistButton`) in time. Because it
is not in the doc, undo can't see it. The brush size is fixed at 0.25 squares, there is no eraser anywhere (the
annotation layer is hard-wired to `DrawMode.Draw`), and drawings have 8 effects while the AoE shader already animates
about 12 more.

## Goals

- Every TV stroke is written to the doc as soon as it ends: no Save button, nothing expires, one undo step per stroke.
- A brush size slider that applies to the next stroke while the draw tool stays on, with the size visible on screen.
- An eraser that only removes player drawings (TV-made layers), never GM annotations, fog, tokens or the map.
- 14 more animated effects, chosen through radial categories (like conditions) on the TV and by category in the
  editor's drawing palette.
- GM and TV stay in sync through the normal doc writers; no TV-only data path.

## Decisions (confirmed)

| Question           | Answer                                                                      |
| ------------------ | --------------------------------------------------------------------------- |
| Temporary drawings | Replaced. Draw is always permanent; presence layers and Save button go away |
| Layer organization | One layer per color / effect per scene, reused ("Player drawing · Red")     |
| Eraser scope       | Player drawings only                                                        |
| New effects        | All four groups (14 effects), organized in radial categories                |

## Effects

The `AnnotationEffect` enum is persisted (`annotations.effect_type`), so new values are appended (9–22) and existing
numbers never change. Each new effect is a `#if EFFECT_TYPE == n` block in `AnnotationEffects.frag` (compile-time
define, per the stage-rendering rule), ported from the matching `AoeTemplate.frag` effect where one exists. The AoE
functions work in grid-cell coordinates with a signed distance to the edge; the annotation port derives cell
coordinates from a new `uCellSize` uniform (grid cell in mask texture pixels) and the edge distance from the existing
feathered mask (`getVolumeMask`), so effects keep the same scale as AoEs on the same map.

| Category (ring)   | Effects                                                               | Source                             |
| ----------------- | --------------------------------------------------------------------- | ---------------------------------- |
| Elements          | Fire, **Lava**, **Lightning**, Water, Ice, **Acid**                   | Lava new; Lightning, Acid from AoE |
| Magic             | Magic, **Radiant**, **Necrotic**, **Force**, **Darkness**, Space tear | AoE                                |
| Terrain           | Grease, **Mud**, **Blood**, **Thorns**, Entangle, Web                 | Blood new; Mud, Thorns from AoE    |
| Clouds and swarms | **Poison gas**, **Fog cloud**, **Sleet**, **Insect swarm**            | AoE                                |

- The catalog (enum value, label, hint, category, preview color, defaults in `AnnotationEffectDefaults`) lives in
  `packages/stage` next to the enum: `ANNOTATION_EFFECT_CATEGORIES` and `annotationEffectsInCategory()`, mirroring
  `MARKER_CONDITION_CATEGORIES`. The editor palette, the TV rings and `EFFECT_COLORS` all read it, so a new effect is
  added in one place.
- Previews: `EffectPreview` costs one WebGL context each and browsers keep about 16. Every picker therefore shows at
  most one category of previews at a time (≤ 6), never all 22.

## TV flow

### Draw ring (general menu → Draw)

| Option            | Action                                                                       |
| ----------------- | ---------------------------------------------------------------------------- |
| Color             | Ring of 8 colors (the editor palette: 6 colors + white + dark)               |
| Elements          | Ring of that category's effects (animated previews)                          |
| Magic             | 〃                                                                           |
| Terrain           | 〃                                                                           |
| Clouds and swarms | 〃                                                                           |
| Eraser            | Turns on the eraser (disabled with "No player drawings" when there are none) |
| Clear drawings    | Danger style. Deletes every player drawing in the scene, one undo step       |

Picking a color, effect or Eraser closes the menu and opens the **draw panel**.

### Draw panel

A small floating panel that stays while the tool is on, rotated to face the nearest table edge (like
`TvConditionForm`) and placed at the edge nearest where the menu was opened:

- **Current brush**: color swatch, effect preview or eraser icon. Tap → reopens the Draw ring there to switch.
- **Size slider**: the editor's steps (`0.25, 0.5, 0.75, 1, 2, 3, 4, 5` squares), large touch thumb, value label
  ("1 sq"), and a live circle showing the brush size at the current zoom. Changing it applies to the next stroke
  immediately; it is local state, not shared.
- **Draw / Eraser** toggle.
- **Undo** (same as the menu's undo; disabled with nothing to undo).
- **Done**: turns the tool off.

The tool also turns off after 30 s without a stroke (today's 3 s idle reset is too short for a panel), on scene switch
and on pause. Size and last brush are remembered for the session (local only).

## Data flow

### Writing strokes

- `PlayTools` keeps the active brush `{ kind: 'color', color } | { kind: 'effect', effect } | { kind: 'erase' }`.
- On the first stroke with a brush, it finds this scene's player layer for that brush (`playerDrawn` and matching
  color, or matching `effectType`) or creates one with `upsertAnnotation` (name "Player drawing · Red" /
  "Player effect · Fire", visibility Player, ordered on top of the other player layers). It then sets the stage's
  `annotations.activeLayer` to it. The new layer starts with an empty mask, so the stroke draws on it like any
  editor layer.
- `onAnnotationUpdate(layerId, …)` → `stage.annotations.toRLE(layerId)` → `client.write.setAnnotationMask`. Layer
  creation (if any) and the mask write happen inside one `stopCapturing` pair, so **one stroke = one undo step**, and
  undoing the first stroke also removes the layer it created.
- The mask readback is async; strokes made before an earlier readback finishes keep their order (the readback
  snapshot is taken at call time, see stage-rendering skill). If the scene changes before it resolves, the write still
  targets the scene the stroke was drawn on.
- Undo/redo restore older mask bytes in the doc; `AnnotationMaterial` already re-applies a changed `mask` prop, so the
  TV and the GM both repaint with no extra code.

### Identifying player drawings

New annotation field `playerDrawn: boolean` (default false). It marks TV-created layers so the eraser, Clear
drawings and layer reuse don't depend on names the GM can rename. **This needs a DB column and a migration, which
you run (D-3)**; the field is threaded through `fromDb.ts`, `wire.ts`, the persist schema, room load, session
export/import and scene duplicate, typed optional in the doc (`playerDrawn ?? false`). The GM sees these layers in the
normal layer list and can rename, hide, reorder or delete them; renaming doesn't break reuse.

### Eraser

- Stage: `AnnotationsLayerProps` gains `tool?: 'draw' | 'erase'` and `eraseLayerIds?: string[]`. In erase mode the
  stroke is applied with `DrawMode.Erase` (already supported by `DrawingMaterial`, used by fog) to every listed layer
  instead of the single active layer, and the brush outline shows. On release `onAnnotationUpdate` fires once per
  layer the stroke touched. `toRLE(layerId?)` / `toPng(layerId?)` take an optional layer id.
- The TV passes the visible player layers as `eraseLayerIds`. GM layers are never listed, so they can't be erased.
- The writes for one eraser stroke go into one `stopCapturing` pair: one undo step. A layer erased to empty stays (the
  GM can delete it; Clear drawings removes it).
- Out of scope but nearly free once the stage supports it: an eraser button in the editor's `DrawingSliders` that
  erases the active layer. Say if you want it.

### Removed

- TV temporary layers: `tempAnnotationLayers`, `tempLayerUrls`, `#tempMaskCache`, the expiry ticker,
  `persistCurrentDrawing`, the persist button state and `<PersistButton>` on the play page.
- Presence `temporaryLayers` API (`createTemporaryLayer`, `broadcastTemporaryLayer`, `removeTemporaryLayer`,
  `cleanupExpiredTemporaryLayers`, `TEMPORARY_LAYER_TTL_MS`) if nothing else uses it. `PersistButton` stays in
  `packages/ui` (no UI package change, no changeset).

## Editor palette

`DrawingSliders`' popover becomes: the 8 colors on top, then one row of category tabs (Elements, Magic, Terrain,
Clouds and swarms) showing that category's effect previews (≤ 6 contexts). The selected effect's category opens by
default. The opacity slider gradient reads the effect's preview color from the catalog.

## Files

- `packages/stage` `AnnotationLayer/types.ts`: enum values 9–22, defaults, `ANNOTATION_EFFECT_CATEGORIES`,
  `annotationEffectsInCategory`, `tool` / `eraseLayerIds` props. Exports in `Stage/index.ts`.
- `packages/stage` `shaders/AnnotationEffects.frag`: 14 effect blocks + `uCellSize`; `AnnotationMaterial.svelte`:
  uniform and erase mode; `AnnotationLayer.svelte`: multi-layer erase, per-layer `toRLE`/`toPng`.
- `packages/stage` `RadialMenu/EffectPreviewScene` (if it needs the new uniform), `DrawingSliders.svelte`.
- `apps/web` `db/app/schema.ts` (`player_drawn`), `realtime/types.ts`, `fromDb.ts`, `wire.ts`,
  `api/internal/persistSession`, `server/realtime`, export/import, scene duplicate.
- `apps/web` `play/playMenus.ts` (+ tests): Draw ring with categories, Eraser, Clear drawings.
- `apps/web` `play/usePlayTools.svelte.ts`: brush state, layer find/create, per-stroke writes, eraser, clear, idle.
- `apps/web` `play/+page@.svelte`, new `play/TvDrawPanel.svelte`; presence cleanup.
- Docs: `docs/tv-radial-menu-architecture.md`, skills `stage-rendering` and `web-data-patterns`.

## Testing

- Unit: effect catalog (every enum value in exactly one category, unique labels, ≤ 10 per ring, defaults for all);
  `playMenus` Draw ring (categories, Eraser disabled without player drawings, Clear is danger); player-layer lookup
  (reuse by color/effect, ignores GM layers, survives rename); doc round trip of `playerDrawn`.
- `pnpm run check`, format check, web and stage tests.
- Manual on the TV: draw → GM sees it at once; undo removes the last stroke on both screens (first undo of a new
  layer removes the layer); size slider changes the next stroke and the size circle; eraser removes TV strokes but
  not a GM drawing underneath; Clear drawings then undo restores them; every new effect renders and animates on
  Windows (ANGLE) without stalls; editor palette tabs never show more than one category of previews.

## Edge cases

- GM and TV draw on the same player layer at the same moment: the mask is one blob, so the later write wins and the
  other stroke is lost. Rare (GM normally draws on their own layers); accepted.
- The GM deletes the layer the TV is drawing on: the next stroke creates a new one.
- The GM hides a player layer (visibility DM): the TV doesn't show it and the eraser skips it. The next time a
  player picks that brush, it gets a fresh visible layer; strokes made before re-picking go onto the hidden layer.
- Scenes with old annotations from the removed Save flow ("Player drawing" / "Player effect"): they have
  `playerDrawn = false`, so they count as GM drawings and the eraser leaves them alone.
- Mask undo history pins old bytes in memory; the existing undo stack cap applies.

## Implementation notes

- **Draft layer.** The stage can only paint on a layer it renders, so a brush with no player layer yet paints on a
  local draft (`PlayTools.draftLayers`, prepended to the stage's layers) with a fresh id. Its first stroke creates the
  doc row with that id and mask together, so the layer component stays mounted. Picking a different brush starts a new
  draft.
- **Stroke saving.** `onAnnotationUpdate` collects the layers a stroke touched in a microtask, issues their readbacks at
  once (snapshot at call time), and chains the writes so strokes land in order even if a readback is slow.
- **Editor eraser.** Added: `DrawingSliders` has an eraser toggle (`erasing` / `onEraserToggle`) that erases the
  active layer; picking a color or effect goes back to drawing.
- **Migration.** `0059_romantic_eternals.sql` adds `annotations.player_drawn` (default false). Run on the development
  database on 2026-10-26 after a backup.
- **Presence.** The temporary layer API was removed from `PresenceChannel`; `PersistButton` stays in `packages/ui`.
- **Effects.** Each ported effect was strengthened where the AoE version relied on its outline (lightning haze,
  radiant glow, force field, poison gas, sleet, insect swarm). All 23 variants compile and link in headless Chromium
  (WebGL2 / SwiftShader), and each was rendered on a test mask and checked by eye.
