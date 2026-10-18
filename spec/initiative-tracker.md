# Spec: initiative tracker (scope INIT)

Part of `spec/dnd-combat-polish.md`. This is a must-have feature for the user.

## Problem

There is no way to run combat turn order in Table Slayer. GMs track initiative on paper, so they keep looking away
from the table, and players at the TV can't see whose turn it is.

## Goals (from the user)

1. Start combat using the selected tokens.
2. Roll initiative for all selected tokens using their initiative bonus:
   - For 5etools monsters, the bonus comes from the stat block (initiative, or the Dex modifier).
   - For the GM's own characters, the bonus can be edited.
   - Every initiative value can be edited after rolling.
3. Show the combatants in order in the side panel, each with their initiative.
4. Advance turns and rounds. The list re-orders so the active combatant is always on top.
5. Clearly mark where the round ends, where initiative count 20 falls (lair actions), and who is active.
6. Fit cleanly into the existing UI.

## Decisions (confirmed with the user)

- **GM screen:** a **Combat** tab in the right pane, next to Tokens / Library / Handout. It has a live dot while combat runs
  and opens automatically when combat starts.
- **TV:** a compact turn-order strip along the top of the player view. The GM can switch it off per scene.
  Tokens hidden from players are left out.
- **Active token on the map:** a pulsing gold ring on the active combatant, on the GM screen and the TV.
- **Follow turn:** "Next turn" selects the new active token, so the quick stat card (5E scope) shows its stats.
- Combat is **per scene**. Every client sees it live because it is stored in the realtime doc and persisted to the DB.
- Combat writes go through `client.systemWrite`, which is excluded from Ctrl+Z. Turn changes are undone with
  **Previous turn** instead, so Ctrl+Z never mixes token moves with turn changes.
- Players roll their physical dice at the table. The GM types the result into the row, or clicks the per-row d20 to roll for
  a token. "Roll initiative" rolls only the empty rows, so typed values are never overwritten.

## UX walkthrough

1. The GM selects 5 tokens (box-select, Shift+click or Ctrl+A), right-clicks, and chooses **Start combat (5)**.
   The other ways to start are pressing `I`, or the **Start combat with 5 selected** button in the empty Combat tab.
   The Combat tab opens in the **rolling** phase (round 0).
2. Each row shows an empty initiative box, the token thumbnail and name, and the bonus chip (`+2`). The header has a
   primary button **Roll for 3 empty** and a secondary button **Begin round 1**.
3. Players call out their rolls and the GM types them (Tab moves to the next row). The GM clicks **Roll for 3 empty**:
   - Monsters roll d20 + bonus.
   - A toast shows `Goblin: d20 (14) + 2 = 16`, or one summary toast when more than 3 rolled.
4. The GM clicks **Begin round 1** (it becomes primary once every row has a value).
   - The round becomes 1 and the top combatant becomes active.
   - The token gets a gold ring and is selected, and the stat card shows it.
5. The GM presses **Next turn** or `N`. The list rotates:

```
Round 2                                   [◀]  [Next turn ▶]   [⋯]
──────────────────────────────────────────────────────────────────
▶ 18  [img] Goblin boss    ●●     ▮▮▮▮▮▯ 21/27      +2
  15  [img] Mira                   30/34            +3
┄┄┄ 20 · lair actions ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
━━━ End of round 2 · round 3 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  22  [img] Thorin                                    +1
  20  [img] Wolf  ☠ (skipped)                          +2
┄┄┄ 20 · lair actions ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
  19  [img] Goblin            ●       ▮▮▯▯▯▯ 3/7        +2
──────────────────────────────────────────────────────────────────
Not rolled
  —   [img] Bandit                                    +1   [🎲]
──────────────────────────────────────────────────────────────────
[+ Add 2 selected]                                   [End combat]
```

   In this view:
   - Rows above "End of round N" still act this round. Rows below it have already acted and will act next round.
   - The "20 · lair actions" line sits where initiative 20 falls in each part, so it can appear twice: once for this round
     and once for the next. Lair actions lose ties, so the line goes after every combatant at exactly 20.
   - When initiative 20 is the next thing to happen, the line turns bright and shows **Lair action** (see "Lair step" below).
   - Dead tokens are dimmed with a skull and skipped automatically. Rows hidden from players show an eye-off icon.
6. Clicking a row selects that token on the map. Clicking the initiative number edits it in place, and Enter or blur saves.
   The list re-sorts at once and the active combatant stays active.
7. **Add 2 selected** adds tokens mid-fight. Their initiative is empty and they wait in "Not rolled" until it is set.
   If the new value is higher than the active combatant's, the token lands below "End of round" and acts next round.
8. **End combat** is a `ConfirmActionButton`. It clears every combatant, sets the round back to 0 and removes the ring.

### Lair step

When a turn ends and the next combatant in order is below 20 while the previous one was at 20 or above (or the order wraps
past 20 into a new round), "Next turn" first stops on the **lair step**:
- The 20 line becomes the active row (gold, "▶ 20 · Lair action").
- No token is active and nothing is selected.

Pressing Next again moves to the next combatant. The lair step only happens when the scene's `combatLairActions` toggle is on
(⋯ menu → "Lair actions at 20", default off). When the toggle is off, the line is still drawn as a muted reference marker,
but turns never stop on it.

## Data model

### DB (wave 0 adds these to `schema.ts`; the user generates and runs the migration)

`scene` table:

| Column | Type | Default | Meaning |
| --- | --- | --- | --- |
| `combat_round` | integer NOT NULL | 0 | 0 means no combat or still rolling, 1 or more is the current round |
| `combat_active_marker_id` | text, nullable | null | Active combatant. Null in the rolling phase, after combat, or on the lair step |
| `combat_lair_step` | integer (boolean) NOT NULL | false | True while the turn sits on the initiative-20 lair step |
| `combat_lair_actions` | integer (boolean) NOT NULL | false | Whether turns stop on the lair step |
| `combat_show_on_tv` | integer (boolean) NOT NULL | true | Whether the TV shows the turn-order strip |

"Combat is running" is derived as `markers.some(m => m.inCombat)`. There is no separate flag that could get out of sync.

`marker` table:

| Column | Type | Default | Meaning |
| --- | --- | --- | --- |
| `in_combat` | integer (boolean) NOT NULL | false | In the turn order |
| `initiative` | real, nullable | null | The rolled or typed total. Null means not rolled |
| `initiative_bonus` | integer, nullable | null | GM override. Null means use the stat block or 0 |
| `initiative_tiebreak` | real NOT NULL | 0 | Higher goes first among equal initiatives; set by the tie ▲▼ buttons |

`asset` table:

| Column | Type | Default | Meaning |
| --- | --- | --- | --- |
| `initiative_bonus` | integer, nullable | null | Remembered bonus for library characters, copied to new tokens on placement |

Use the existing drizzle patterns, e.g. `integer('combat_round').notNull().default(0)`,
`integer('combat_lair_step', { mode: 'boolean' }).notNull().default(false)` and `real('initiative')`.

### Realtime types (wave 0, `apps/web/src/lib/realtime/types.ts`)

- `SceneSettings` gains `combatRound: number; combatActiveMarkerId: string | null; combatLairStep: boolean;
  combatLairActions: boolean; combatShowOnTv: boolean;`.
- `MarkerRow` gains `inCombat: boolean; initiative: number | null; initiativeBonus: number | null; initiativeTiebreak: number;`.

No new Y collection is needed. These are plain fields on the existing scene `settings` map and marker rows, so per-field LWW
merging works as it does today. Bump `DOC_SCHEMA_VERSION` together with the AOE change. Both ride the same bump to 3, so
there is no separate bump for INIT.

### Stage types (wave 0, `packages/stage/.../Stage/types.ts`)

- Add a `StageProps`-level prop (outside `props`, like `selectedMarkerIds`), named `activeTurnMarkerId?: string | null`.
  Changing the turn must not rebuild `renderStageProps`.

## Pure logic: `apps/web/src/lib/utils/initiative.ts` (+ `initiative.test.ts`)

This holds no Svelte or Y.js code, only functions over `MarkerRow`-like objects. The type used is
`type Combatant = Pick<MarkerRow, 'id' | 'title' | 'inCombat' | 'initiative' | 'initiativeBonus' | 'initiativeTiebreak' | 'statBlock' | 'conditions' | 'visibility'>`.

```ts
export const LAIR_INITIATIVE = 20;

// Bonus: GM override → stat block initiative → stat block Dex mod → 0
export const resolveInitiativeBonus = (c: Combatant): number =>
  c.initiativeBonus ?? c.statBlock?.initiative ?? c.statBlock?.abilities.dex.mod ?? 0;

export const isDefeated = (c: Combatant) => c.conditions?.some((x) => x.id === 'dead') ?? false;

// Sort: initiative desc (null last), tiebreak desc, bonus desc, title asc, id asc
export const compareCombatants = (a: Combatant, b: Combatant): number => { … };

export const sortCombatants = (markers: Combatant[]): { rolled: Combatant[]; unrolled: Combatant[] } => …;
//   rolled = inCombat && initiative !== null, sorted; unrolled = inCombat && initiative === null, sorted by title

export const rollInitiative = (bonus: number, rng = Math.random) => {
  const roll = Math.floor(rng() * 20) + 1;
  return { roll, total: roll + bonus, text: `d20 (${roll}) ${bonus < 0 ? '−' : '+'} ${Math.abs(bonus)} = ${roll + bonus}` };
};
//   self-contained on purpose: no dependency on the 5E dice parser being built in parallel

export type TurnPosition = { round: number; activeId: string | null; lairStep: boolean };

export const getNextTurn = (rolled: Combatant[], pos: TurnPosition, lairActions: boolean): TurnPosition => { … };
export const getPreviousTurn = (rolled: Combatant[], pos: TurnPosition, lairActions: boolean): TurnPosition => { … };

export type TurnEntry =
  | { kind: 'combatant'; combatant: Combatant; isActive: boolean; isDefeated: boolean; actsNextRound: boolean }
  | { kind: 'lair'; isActive: boolean; isUpNext: boolean; actsNextRound: boolean }
  | { kind: 'roundEnd'; round: number };

export const buildTurnView = (rolled: Combatant[], pos: TurnPosition, lairActions: boolean): TurnEntry[] => { … };
```

### Turn order algorithm

Build a cyclic sequence of "slots" from `rolled` (already sorted):

1. `slots = []`.
2. Walk `rolled` in order. Before pushing the first combatant whose `initiative < 20`, push the slot `{ lair }`.
   If every combatant is at 20 or above, push `{ lair }` at the end.
   (If `lairActions` is off, the lair slot is still built for the view but turns never stop on it.)
3. Push each combatant as `{ combatant }`.

**`getNextTurn`:**
- **Rolling phase** (`round === 0`): return `{ round: 1, activeId: first non-defeated combatant, lairStep: false }`.
  If the lair slot comes first, `lairActions` is on, and no combatant is above 20, then start on the lair step instead.
- **Otherwise:**
  - Find the current slot index:
    - The lair slot if `pos.lairStep`.
    - Else the index of `activeId`.
    - If `activeId` is missing (the token was deleted), start at index -1 so the next turn is the first slot.
    - The round is unchanged in every case.
  - Step forward one slot at a time, at most `slots.length` steps:
    - Wrapping past the end adds 1 to `round`.
    - Skip defeated combatants.
    - Skip the lair slot when `lairActions` is off.
    - Stop at the first slot that is not skipped.
  - If every slot is skipped (everyone defeated), return `pos` unchanged.

**`getPreviousTurn`:** the mirror of `getNextTurn`. Wrapping before the start subtracts 1 from `round`, with a minimum of 1.
At round 1 on the first slot it does nothing.

**`buildTurnView`:**
- **Rolling phase:** the slots in order with `isActive = false` and no `roundEnd`.
  The lair entry is always included as a reference marker.
- **Otherwise:** rotate `slots` so the current slot comes first.
  - Entries from the current slot to the end of `slots` belong to this round (`actsNextRound = false`).
  - Then push `{ roundEnd, round: pos.round }`.
  - Then the entries from the start of `slots` up to the current slot (`actsNextRound = true`).
  - `isUpNext` on a lair entry means the next turn (per `getNextTurn`) is the lair step.

**Unit tests (`initiative.test.ts`):**
- Sorting: ties, tiebreak values and unrolled combatants.
- Bonus resolution order.
- `getNextTurn`:
  - Wraps and increments the round.
  - Skips defeated combatants.
  - Stops on the lair step only when `lairActions` is on.
  - Handles a missing active id.
  - Handles everyone defeated.
- `getPreviousTurn` at round 1 does nothing.
- `buildTurnView`:
  - Places `roundEnd` and both lair lines correctly.
  - When the active combatant is at 20, the lair line comes right after it.
- `rollInitiative` with a seeded rng.

## Combat actions: `apps/web/src/lib/components/Combat/combatActions.ts`

A thin layer over the writer. Every function takes `(write: SessionWriter, sceneId, snapshot)` and wraps its writes in
`write.transaction(...)`. The page passes `client.systemWrite`.

| Function | Effect |
| --- | --- |
| `startCombat(ids)` | Set `inCombat: true` on the ids, leaving any existing initiative. If no marker was already in combat, also set `combatRound: 0, combatActiveMarkerId: null, combatLairStep: false` |
| `addCombatants(ids)` | Set `inCombat: true` and `initiative: null` (only for ids not already in combat) |
| `removeCombatants(ids)` | If an id is active, first apply `getNextTurn`. Then set `inCombat: false, initiative: null, initiativeTiebreak: 0`. If nobody is left, call `endCombat` |
| `setInitiative(id, value: number \| null)` | Write `initiative`. Reset `initiativeTiebreak` to 0 when the value changes |
| `setInitiativeBonus(id, bonus: number \| null)` | Write the marker `initiativeBonus` (the page also saves it to the asset, see below) |
| `rollEmpty()` | For each combatant with `initiative === null`, roll `resolveInitiativeBonus` and set the total. Returns the roll texts for the toast |
| `rerollAll()` | Same, for every combatant (⋯ menu, behind a confirm) |
| `rollOne(id)` | Roll a single combatant (row d20 button), overwriting it |
| `nudgeTie(id, direction: 'up' \| 'down')` | Among combatants with the same `initiative`, give this one `max(tiebreak)+1` (up) or `min(tiebreak)-1` (down) |
| `beginCombat()` / `nextTurn()` / `previousTurn()` | Apply `getNextTurn` / `getPreviousTurn` and write `combatRound`, `combatActiveMarkerId`, `combatLairStep` |
| `endCombat()` | For every marker in combat: `inCombat: false, initiative: null, initiativeTiebreak: 0`. Scene: `combatRound: 0, combatActiveMarkerId: null, combatLairStep: false` |

Also test these with a fake writer that records calls (`combatActions.test.ts`):
- Removing the active combatant advances the turn.
- `endCombat` clears everything.

## Components (`apps/web/src/lib/components/Combat/`)

Files:
- `InitiativeTracker.svelte`
- `InitiativeRow.svelte`
- `InitiativeDivider.svelte`
- `InitiativeStrip.svelte`
- `combatActions.ts`
- `types.ts`
- `index.ts` (barrel)

### `InitiativeTracker.svelte` (Combat tab content)

Props:
```ts
{
  combatants: Combatant[];          // markers with inCombat, from the scene snapshot
  position: TurnPosition;           // from scene settings
  lairActions: boolean;
  showOnTv: boolean;
  selectedMarkerIds: string[];
  bucketUrl: string;                // for token thumbnails (same helper MarkerManager uses)
  onAction: (action: CombatAction) => void;   // see types.ts: discriminated union mirroring combatActions
  onSelectMarker: (id: string) => void;
  onBonusChange: (id: string, bonus: number | null) => void;
  onSettingsChange: (fields: { combatLairActions?: boolean; combatShowOnTv?: boolean }) => void;
}
```

The component only renders and emits. All writes happen in the page via `combatActions`.

**Layout** (BEM block `initiativeTracker`):
- `__header` (sticky top):
  - `__round`: "Round 2", or "Roll initiative" in the rolling phase. Uses `var(--font-size-4)`, bold.
  - `__controls`:
    - Rolling phase: primary `Button` **Roll for N empty**, plus a **Begin round 1** button. Begin is primary once nothing is
      empty; otherwise it is secondary. Begin is disabled when no combatant has rolled.
    - Running: an `IconButton` previous (`IconPlayerTrackPrev`, title "Previous turn (Shift+N)") and a primary
      `Button` **Next turn** with a `kbd` hint `N`.
  - A `⋯` `IconButton` opens a `Popover` with three rows:
    - "Lair actions at 20" (`InputCheckbox`).
    - "Show turn order on TV" (`InputCheckbox`).
    - "Re-roll everyone" (asks for confirmation inside the popover).
- `__list` (`role="list"`): renders `buildTurnView` entries.
  - `combatant` → `<InitiativeRow>`.
  - `lair` / `roundEnd` → `<InitiativeDivider>`.
  - Animate re-ordering with Svelte `animate:flip` (duration 180 ms), keyed by entry id (combatant id, `lair-a`/`lair-b`,
    `round-end`). The rotation on Next turn then reads as rows sliding, which is the "see them rearranged" feel.
- `__unrolled`: a "Not rolled" sub-header plus rows (only when some are unrolled).
- `__footer`:
  - Left: `Button` **Add N selected**, only shown when the selection has tokens not in combat.
  - Right: `ConfirmActionButton` **End combat**.
- **Empty state** (no combatants), `__empty`:
  - Text: "Select tokens on the map, then start combat."
  - Primary button **Start combat with N selected**, disabled when nothing is selected.
  - Hint "or press I".

### `InitiativeRow.svelte`

Props: `combatant`, `isActive`, `isDefeated`, `isSelected`, `actsNextRound`, `isTied`, `bonus`, `hp` (`{ current, max } | null`,
taken from `hitPoints` / `statBlock.hp.average`), `thumbUrl`, `onSelect`, `onInitiativeChange`, `onBonusChange`, `onRoll`,
`onNudge`, `onRemove`.

A 40px row in a grid with `grid-template-columns: 1.25rem 3rem 1.75rem 1fr auto auto`. Its cells:
1. **`__turn`:** a ▶ icon when active, coloured `var(--turnColor)`.
   Define `--turnColor: var(--yellow-500)` once on `.initiativeTracker` and `.initiativeStrip`. globals.css has no warning
   or gold token, and `--fgDanger` is yellow but means danger.
2. **`__initiative`:** a borderless numeric `<input>` with `inputmode="numeric"`, 3ch wide, bold, font-size 1.125rem.
   - Placeholder "—".
   - Enter/blur commits (empty → null). Escape reverts. Up/Down arrows change the value by ±1.
   - `aria-label="Initiative for {title}"`.
   - A click on the input must **not** select the row (`stopPropagation`).
3. **`__thumb`:** a 28px round thumbnail. With no image, a shape-colour circle with the token label.
4. **`__name`:** the title (ellipsis), plus up to 3 condition dots (reuse `resolveCondition` colours from COND; it is exported from `@tableslayer/stage` by W1-STAGE-TOKEN in the same wave, so import it by the name in `spec/marker-conditions.md` and expect it to resolve at the wave-1 gate), plus an
   eye-off icon when `visibility` hides the token from players.
5. **`__hp`:** "21/27" plus a 4px bar (reuse the `statBlock__hpBar` colour thresholds). Hidden when `hp` is null.
6. **`__bonus`:** a chip `+2`.
   - Clicking it turns it into a 4ch numeric input. Enter commits, an empty value resets to automatic (null).
   - Its title shows the source: "From stat block (Dex +2)" or "Set by GM".
   - A muted style when automatic, normal when set by the GM.

Hover actions (`__actions`, visible on hover and focus-within):
- A d20 roll `IconButton` (`IconDice5`, "Roll initiative").
- When `isTied`, ▲▼ tie `IconButton`s.
- Remove (`IconX`, "Remove from combat").

Row states and click behaviour:
- `--active`: background `color-mix(in srgb, var(--turnColor) 14%, transparent)`, a 3px left border
  `var(--turnColor)`, and `aria-current="step"`.
- `--defeated`: opacity 0.5, the name struck through, a ☠ icon, and the title "Skipped (dead)".
- `--selected`: outline `var(--borderThin)` in `var(--fgPrimary)`.
- `--nextRound`: no dimming. The divider already communicates that the row has acted.
- Clicking the row calls `onSelect(id)`.

### `InitiativeDivider.svelte`

Props: `kind: 'lair' | 'roundEnd'`, `round?`, `isActive?`, `isUpNext?`. A 20px flex row with a line and a label.

- **`roundEnd`:**
  - Solid 2px line `var(--fgMuted)`.
  - Label "End of round {round}", then a dot separator and "round {round+1}" in uppercase small caps.
  - `role="separator"`.
- **`lair`:**
  - Dashed 1px line.
  - Label "20 · lair actions".
  - Muted by default, `var(--turnColor)` when `isUpNext`, and filled gold with "▶ 20 · Lair action" when `isActive`.

### `InitiativeStrip.svelte` (TV / player view)

Props: `combatants`, `position`, `bucketUrl`.

- Rendered only when `position.round > 0 && showOnTv` and at least one combatant is visible.
- Filter out markers with `visibility === MarkerVisibility.DM || visibility === MarkerVisibility.Hover`.
- Positioned absolutely, top-centre over the stage (`top: 0.75rem`, `z-index` below the handout overlay and above the stage).
  Background `color-mix(in srgb, var(--bg) 80%, transparent)` with `backdrop-filter: blur(6px)`, radius `var(--radius-3)`,
  and padding 0.5rem 0.75rem.
- **Contents, left to right:**
  1. A "Round 2" badge.
  2. Portraits in `buildTurnView` order, at most 12. Overflow shows "+N".
     - The active portrait is 56px with a gold ring and its name below (one line, max 14ch).
     - Other portraits are 36px.
     - Defeated portraits are greyscale and 40% opacity.
  3. A thin vertical bar for `roundEnd`.
  4. A small "20" tick for the lair line. When `isActive`, show a gold "Lair" pill instead of a portrait.
- Animate with `animate:flip`.
- No interactivity (`pointer-events: none`), so it never blocks touch gestures on the TV.
- BEM: `initiativeStrip`, `__round`, `__portraits`, `__portrait`, `__portrait--active`, `__portrait--defeated`, `__name`,
  `__roundEnd`, `__lair`, `__lair--active`, `__more`.

## Stage: active-turn ring (packages/stage)

- `Stage.svelte` receives `activeTurnMarkerId` and passes it to `MarkerLayer` through the same context and prop route as
  `selectedMarkerIds` (PERF step 3). The owner is W1-STAGE-INPUT.
- `MarkerLayer.svelte` passes `isActiveTurn={marker.id === activeTurnMarkerId}` to `MarkerToken` (W1-STAGE-INPUT).
- In `MarkerToken.svelte` (W1-STAGE-TOKEN), add a second ring mesh beside the PERF highlight ring:
  - Geometry `getHighlightGeometry(shape)` scaled ×1.12.
  - Material `activeTurnRingMaterial` from `tokenRasterCache.ts`, a `MeshBasicMaterial` in gold (`getCssColor('--yellow-500')`)
    with `transparent` and `depthTest: false`.
  - `visible={isActiveTurn}`, `renderOrder = SceneLayerOrder.Marker + 1`.
  - Pulse: a single `useTask` inside `{#if isActiveTurn}`, so only one token ever runs it. It updates
    `material.opacity = 0.55 + 0.35 * Math.sin(t * 3)` and `scale = base * (1.08 + 0.04 * sin)`.
  - The material is shared, but only one token is active, so that is safe.
  - Never call `invalidate()`; `renderMode="always"` already redraws every frame.
- This must not trigger the token canvas redraw. `isActiveTurn` is never read by `drawMarker`.

## Page integration (W2)

**GM `+page.svelte`** (W2-PAGE-PANELS, after W2-PAGE-MARKERS):
- `const combatants = $derived(sceneMarkers.filter((m) => m.inCombat))`. Memoize like `pinnedMarkerIds`: return the previous
  array when the ids and the combat fields are equal, so the tracker does not re-render on unrelated marker moves.
- `const turnPosition = $derived({ round, activeId, lairStep })` from scene settings.
- Pass `activeTurnMarkerId={turnPosition.lairStep ? null : turnPosition.activeId}` to `<Stage>`.
- `SidePanelTabs` gains a `combat` tab with the label "Combat", the icon `IconSwords`, and a live dot when `combatants.length > 0`.
  The Combat panel stays mounted with `hidden` (same pattern as Library/Handout).
- `handleCombatAction(action)` runs the matching `combatActions` function with `client.systemWrite`. After `beginCombat`,
  `nextTurn` and `previousTurn`:
  - If the new active id is not null, call `setSelection([activeId])` (the quick stat card follows).
  - If the turn moved to the lair step, call `setSelection([])`.
  - Then show a toast only if the Combat tab is hidden: "Round 3 · Thorin's turn".
- `startCombat` also sets `sidePanelTab = 'combat'`.
- `onBonusChange(id, bonus)`:
  1. Run `combatActions.setInitiativeBonus`.
  2. If the marker has an `assetId`, call the existing assets `save` mutation with `{ id: assetId, initiativeBonus: bonus }`,
     fire-and-forget, with a toast on error only.
- **Marker delete:** before deleting markers that are in combat, call `removeCombatants(ids)` so the turn advances cleanly.
- **Hotkeys**, in `handleKeydown`, ignored while an input has focus (same guard as the existing keys):
  - `I`: start combat with the selection, or add it if combat is running.
  - `N`: next turn, or begin round 1 in the rolling phase.
  - `Shift+N`: previous turn.
- **Right-click `TokenContextPanel`** gets a "Combat" action row:
  - **Start combat (N)** when no combat is running.
  - **Add to combat (N)** when some targets are not in combat.
  - **Remove from combat** when some are.

**Play route `play/+page@.svelte`:**
- Derive `combatants` and `turnPosition` from `session.activeScene`.
- Pass `activeTurnMarkerId` to `<Stage>`, filtered: null if the active marker is hidden from players.
- Render `<InitiativeStrip>` inside the stage wrapper when `settings.combatShowOnTv`.

## Changes in other scopes (added to their agents in the overview)

| Scope / agent | Addition |
| --- | --- |
| W1-STAGE-INPUT | `activeTurnMarkerId` context + prop → `isActiveTurn` on `MarkerToken` |
| W1-STAGE-TOKEN | Active-turn ring mesh and pulse, `activeTurnRingMaterial` in `tokenRasterCache.ts` |
| W1-DATA | New scene and marker fields: `fromDb`, `wire`, `buildRenderProps`, demo data (all false/null/0), persist. Clipboard paste and scene duplicate **reset** `inCombat/initiative/initiativeTiebreak` (copy `initiativeBonus`). Game-session export keeps the fields; import resets combat |
| W1-5E-SERVER | Asset `initiativeBonus`: manage `fields` gains `initiativeBonus: z.number().int().min(-20).max(30).nullable().optional()`, saved on `save`. `assetPlacements` copies it to `marker.initiativeBonus` |
| W1-UI-PANEL | `SidePanelTabs`: the `combat` tab + `combatLive` prop. `AssetEditor`: an "Initiative bonus" numeric field (empty = automatic) |
| W1-UI-COMBAT | `TokenContextPanel`: the "Combat" action row (props `combatState: 'none' \| 'running'`, `targetsInCombat: number`, `onCombatAction`) |
| W1-UI-AOE | `Shortcuts.svelte`: a "Combat" group with I / N / Shift+N. `stageKeyCommands.ts` is untouched (combat keys live in the page) |
| W1-UI-INIT (new) | `utils/initiative.ts` (+ test), `components/Combat/*` (+ `combatActions.test.ts`) |
| W2-PAGE-PANELS | Page and play-route wiring above, plus e2e |

## Files

| File | Change |
| --- | --- |
| `apps/web/src/lib/db/app/schema.ts` | Scene, marker and asset columns (wave 0) |
| `apps/web/src/lib/realtime/types.ts` | `SceneSettings` and `MarkerRow` fields (wave 0) |
| `packages/stage/.../Stage/types.ts` | `activeTurnMarkerId` (wave 0) |
| `apps/web/src/lib/utils/initiative.ts` (+ test) | New: pure turn logic |
| `apps/web/src/lib/components/Combat/*` | New: tracker, row, divider, strip, actions, types, index |
| `packages/stage/.../MarkerLayer/MarkerLayer.svelte`, `MarkerToken.svelte`, `helpers/tokenRasterCache.ts`, `Stage/Stage.svelte` | Ring |
| Realtime and server files listed under W1-DATA / W1-5E-SERVER | Field plumbing |
| `SidePanelTabs.svelte`, `AssetEditor.svelte`, `TokenContextPanel.svelte`, `Shortcuts.svelte` | Small additions |
| GM `+page.svelte`, play `+page@.svelte` | Wiring |
| `.claude/skills/*` | SK-1: update the realtime skill (new scene/marker fields, `systemWrite` for combat) and the stage-rendering skill (active-turn ring) |

## Testing

- **Unit:** `initiative.test.ts`, `combatActions.test.ts`, `docSchema.test.ts` (scene snapshot includes the combat fields),
  and `tokenClipboard.test.ts` (paste resets combat).
- **Manual (GM + TV in two windows):**
  1. Select 4 tokens, press I, and confirm the Combat tab opens with 4 unrolled rows.
  2. Type two values, then click Roll for 2 empty. The toast shows the rolls and the stat-block monster used its Dex/initiative.
  3. Begin round 1. The ring appears on the GM screen and the TV, the token is selected, and the quick card shows it.
  4. Press N repeatedly. Rows slide, the "End of round" line moves, the round increments on wrap, and the TV strip mirrors it.
  5. Mark a token dead (COND) and confirm it is skipped. Turn on lair actions and confirm Next stops on "20 · Lair action".
  6. Edit the active combatant's initiative. It re-sorts and stays active.
  7. Edit a library character's bonus, place it again on another scene, and confirm the bonus carried over.
  8. Hide a token from players and confirm it is absent from the TV strip and gets no ring on the TV.
  9. Delete the active token and confirm the turn advances.
  10. End combat and confirm everything clears on both screens.
  11. Reload both windows mid-combat and confirm the state is restored (persisted).
  12. Ctrl+Z after Next turn does **not** change the turn.
- **Performance:** with 30 combatants, Next turn should cost under 4 ms of scripting (Performance panel), with no token
  canvas redraws.

## Edge cases

- **Two GM tabs pressing Next at the same time:** LWW on `combatActiveMarkerId` means one press can be lost. This is
  acceptable, because the result is still a valid turn.
- **Combat on a scene that is not active on the TV:** the strip shows only the active scene's combat (it derives from
  `session.activeScene`).
- **Switching scenes:** each scene keeps its own combat, so returning resumes it.
- **Everyone defeated:** Next does nothing. Show a muted hint "Everyone is down. End combat?" in the header.
- **Initiative input:** accepts integers −10…50 (decimals are rounded), and clamps out-of-range values.
- **Grid-mode transitions and coordinate upgrades:** these don't touch combat fields.
- **Player-side writes:** players never write combat fields. The play route renders them read-only.

## Out of scope (follow-ups)

- Grouped initiative for identical monsters.
- Effect and condition durations that expire per turn.
- Turn timers.
- Per-player "it's your turn" pings.
- Delay and ready actions.
