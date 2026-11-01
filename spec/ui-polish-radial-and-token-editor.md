# UI polish: TV radial menu orientation and DM token editor

Branch: `feat/ui-polish` (worktree `../tableslayer-ui-polish`), based on `feat/automatic-migration`.

## 1. TV radial menu orientation

### Problem

`packages/stage/src/lib/components/RadialMenu/RadialMenu.svelte` sets `menuRotation` from `rotationFromEdge()` every
time it opens: it turns to face the nearest screen edge. Opening near the middle of the TV, or roughly as far from two
edges, flips the menu to an orientation that looks random. Once open there is no way to turn it.

### Behavior

1. **Remember the last orientation.** The menu opens at the rotation last used on that device. If none is stored yet,
   it uses the nearest edge (current `rotationFromEdge`), once. After that the stored value always wins, including
   after reposition (two-finger hold / right-click on the backdrop) and after a page reload.
2. **Continuous two-finger twist.** While the menu is open, placing two fingers anywhere on it (backdrop, ring, items
   or hub) and twisting turns the whole menu by the same angle as the fingers, without snapping to 90° steps. Lifting
   the fingers keeps the angle and stores it.
3. **Twist vs. two-finger hold.** The existing two-finger hold on the backdrop moves the menu after 500 ms. Once the
   finger angle has changed by more than `TWIST_START_DEG` (≈ 8°) or the fingers moved more than ~12 px, cancel the hold
   timer so a twist never repositions the menu. A still two-finger hold still repositions it.
4. A twist must not select an item, go back or close the menu: suppress the `click` that follows a gesture that
   rotated (e.g. a `twisted` flag that `select`/`back` check, cleared on the next single-finger `pointerdown`).
5. Twisting restarts the auto-close timer.

### Implementation

- **Rotate the container, not the items.** Today each item gets `angle - menuRotation` and counter-rotates its label by
  `-menuRotation`; the hub rotates by `-menuRotation`. That is the same as rotating `.radialMenu__container` by
  `-menuRotation`. Do that instead:
  - `.radialMenu__container` gets `transform: rotate(${-menuRotation}deg)` (it has `width: 0; height: 0` at the menu
    centre, so it pivots on the hub). Add `will-change: transform` only while twisting.
  - `itemAngle` drops the rotation term; items are laid out at fixed angles.
  - Remove `counterRotation` from `RadialMenuItem` (prop and its `rotate(...)` in the transform) and the hub's
    `rotate(...)`.
  - The result: a twist updates one CSS variable / style on one element per frame. No per-item recompute.
- **Gesture handling.** Listen on the `.radialMenu` root with `ontouchstart`/`ontouchmove`/`ontouchend`/`ontouchcancel`
  (capture phase, so it works over items, which have `touch-action: none`). On 2 touches: store the start angle
  `atan2(dy, dx)` between the two touches and the current `menuRotation`. On move: compute the delta, unwrap it into
  (-180°, 180°], and set the pending rotation; apply at most once per animation frame via `requestAnimationFrame`.
  Call `preventDefault()` on two-finger moves so the page does not pinch-zoom. Rotation sign: the menu turns the same
  way the fingers turn (clockwise fingers → clockwise menu on screen).
- **Persistence lives in the consumer.** `RadialMenu` stays generic:
  - New optional props in `types.ts`: `rotation?: number` (degrees; when `undefined` the menu uses the nearest edge on
    open) and `onRotationChange?: (rotation: number) => void` (called once when a twist ends, normalized to
    `[0, 360)`).
  - On open, `menuRotation = rotation ?? rotationFromEdge(...)`; if the edge was used, call `onRotationChange` with it so
    the consumer stores it.
  - The TV page `apps/web/src/routes/(app)/[party]/play/+page@.svelte` keeps a `radialMenuRotation` state, read from
    `localStorage` key `tableslayer:tvRadialMenuRotation` on mount (wrapped in try/catch, invalid → `undefined`), and
    writes it in `onRotationChange`.
- The on-screen clamping (`reach = radius + 80`) is rotation-independent; keep it.
- Leave `rotationFromEdge` in place for the first-open fallback.

### Edge cases

- Third finger added mid-twist: end the twist (keep the angle).
- One finger lifted: end the twist, store the angle.
- Twist started on the backdrop while in a submenu: rotates, does not go back.
- Menu closes (auto-close, select) mid-twist: drop the gesture state, cancel any pending frame.
- Desktop/mouse: unchanged behavior apart from remembering the angle.

## 2. DM token editor

### Problem

The sidebar editor (`apps/web/src/lib/components/GameSession/MarkerManager.svelte`, edit view) stacks the stat block,
an "Appearance" `<details>` (image, show as handout, background color, visibility, pin, label, title, shape, size),
conditions, the notes editor and delete in one long column. The map popover
(`apps/web/src/lib/components/GameSession/TokenContextPanel.svelte`) stacks conditions, visibility, pin, handout,
library, combat and delete. Both are hard to scan.

### Sidebar editor layout

Keep the "List all markers" back link. Below it:

1. **Compact header (always visible)**
   - Row 1: image thumbnail (≈ 48 px, the existing `imagePreview` snippet: click to change image, hover to remove), and
     beside it the **Title** input (full width) and the **Label** input (narrow, max 3 chars) on one row.
   - Row 2: **Visibility** segmented control (DM / Everyone / On hover, same `RadioButton` and same `onSelectedChange`
     side effects: auto-unpin on DM, checklist tracking, `socketUpdate()`), and a **pin** icon toggle button
     (`IconPin`/`IconPinFilled` from `@tabler/icons-svelte`, `aria-pressed`, tooltip/aria-label "Pin tooltip for
     players") shown only when visibility is not DM and `onPinToggle` exists.
2. **Tabs** (follow the `SidePanelTabs.svelte` pattern: `role="tablist"`/`role="tab"`/`role="tabpanel"`, arrow-key
   navigation, `aria-selected`, BEM classes):
   - **Stats** — only when `statBlockFor` returns a stat block; contains `StatBlockPanel` as today.
   - **Look** — background color (swatch popover + hex input), shape, size, and the "Show as handout" button.
   - **Conditions** — only when `conditionPickerFor` exists; `ConditionPicker`. The tab shows a small count badge of
     active conditions when > 0 (use what `conditionPickerFor(marker.id)` exposes; if no count is available, skip the
     badge rather than adding new data plumbing).
   - **Notes** — the `Editor` with the existing `onblur` flush.
   - Default tab: Stats when there is a stat block, otherwise Look. Remember the last selected tab for the session in a
     component-level `$state` (not per marker); if the remembered tab is not available for this marker, fall back to
     the default.
3. **Footer**: the delete `ConfirmActionButton`, unchanged behavior.

Keep all existing `data-testid` attributes (`markerManager`, `markerEditView`, `markerBackButton`, list ones). Keep form
`name`s and visible label text where e2e tests use them (check `apps/web/tests/e2e/marker.auth.test.ts`,
`image-drops.auth.test.ts`, `asset-library.auth.test.ts`, `token-clipboard.auth.test.ts`); if a test clicks something
that moves into a tab, update the test to open that tab first.

### Map popover layout (`TokenContextPanel.svelte`)

Same vocabulary, smaller:

1. Header: name (or "N tokens") and a close button (`onClose`).
2. Quick row: visibility segmented control (if `onVisibilityChange`), pin icon toggle (if `onPinToggle`), and icon
   buttons with aria-labels/tooltips for "Show as handout" (if `onShowAsHandout`) and "Save to library" (if
   `onSaveToLibrary`).
3. Tabs: **Conditions** (default) and **Combat** (only when `onCombatAction`; same start/add/remove buttons as today).
   If there is only one tab, render its content without a tab bar.
4. Footer: "Delete marker" danger action, unchanged.

Props and callbacks stay the same so `[[selectedScene]]/+page.svelte` does not change. Placement/clamping logic stays.

### Shared tab component

Both editors use the same tab bar. Create `apps/web/src/lib/components/GameSession/TokenEditorTabs.svelte` (generic:
`tabs: { id: string; label: string; badge?: number }[]`, `selected`, `onSelect`, `idPrefix` for unique element ids)
rather than copying markup twice. Do not modify `packages/ui` (it would require a changeset).

### Style rules

BEM class names, CSS variables from `packages/ui/src/lib/styles/globals.css` only, sentence case for all UI text.

## 3. Dev stack in parallel

`compose.dev.yaml` has a fixed project name and fixed host ports, and `make dev` stops the existing dev stack first.
Make it configurable with unchanged defaults:

- `compose.dev.yaml`: host side of the port mappings becomes `${DEV_DOCS_PORT:-5173}`, `${DEV_APP_PORT:-5174}`,
  `${DEV_PARTYKIT_PORT:-1999}`; `PUBLIC_PARTYKIT_HOST` uses `${DEV_PARTYKIT_PORT:-1999}`; `BASE_URL` uses
  `${DEV_APP_PORT:-5174}`. Container-side ports, the healthcheck and internal URLs stay as they are.
- Project name: `COMPOSE_PROJECT_NAME` in `.env` overrides `name:` (compose precedence), so no file change needed; note
  it in `docs/local-container-hosting.md`.
- `Makefile`: the printed URLs use the configured ports (read `DEV_APP_PORT`/`DEV_DOCS_PORT` from `.env` like
  `LAN_HOST`, defaulting to 5174/5173).
- Document the parallel-worktree setup in `docs/local-container-hosting.md`.

The worktree's own `.env` (gitignored, created by the user) sets `COMPOSE_PROJECT_NAME=tableslayer-uipolish`,
`DEV_DOCS_PORT=5273`, `DEV_APP_PORT=5274`, `DEV_PARTYKIT_PORT=2099` and its own `DATA_ROOT`.

## Files

- `packages/stage/src/lib/components/RadialMenu/RadialMenu.svelte`, `RadialMenuItem.svelte`, `types.ts`
- `apps/web/src/routes/(app)/[party]/play/+page@.svelte`
- `apps/web/src/lib/components/GameSession/MarkerManager.svelte`, `TokenContextPanel.svelte`
- new `apps/web/src/lib/components/GameSession/TokenEditorTabs.svelte`
- `compose.dev.yaml`, `Makefile`, `docs/local-container-hosting.md`
- e2e tests only if selectors break
- `.claude/skills/stage-rendering/SKILL.md` if it documents the radial menu rotation (SK-1)

## Testing

- `pnpm run check`, `pnpm run format-check`, `pnpm --filter web test` (vitest; includes `playMenus.test.ts`).
- If practical, a unit test for the twist angle math (delta unwrap and normalization) — only if it is extracted into a
  pure helper that is worth testing.
- Manual: TV view on a touch screen — open, twist both directions past 180°, reload, reopen (same angle), two-finger
  still hold still repositions, twist over an item does not select it. DM view — edit a token with and without a stat
  block, switch tabs, change each field, pin toggle hides when DM-only, popover on single and multi-select.
