# Spec: D&D combat polish (overview and execution plan)

Branch: `feature/dnd-combat-polish`. Goal: make Table Slayer a fast, pleasant in-person D&D combat tabletop.
Inspiration: Bag of Mapping release notes (read via the pullpush.io Reddit archive). It has AoE targeting, condition badges,
a focus panel for stats, and handout tokens. It has **no animated spell effects**, so those set Table Slayer apart.

## Scopes

| Tag | Spec | Summary |
| --- | --- | --- |
| PERF | `spec/perf-marker-selection.md` | Instant token selection: no panel remount, ring mesh instead of re-raster, selection outside props, drag threshold, caches |
| GROUP | `spec/group-token-drag.md` | Drag all selected tokens together, whole-cell snapping, one undo step, Ctrl+A |
| COND | `spec/marker-conditions.md` | 5e conditions + combat states + custom, stacked badges, right-click panel, GM-only, auto Bloodied |
| PANEL | `spec/sidepanel-library-handouts.md` | Tokens / Library / Handout tabs, thumbnail grid, drag-to-map, compact handout panel, live pill |
| 5E | `spec/5etools-statblocks.md` | Polished 5etools overlay, full stat-block import, StatBlockPanel + quick card, HP tracking |
| AOE | `spec/aoe-templates.md` | Circle/cube/cone/line templates with ft labels, 18 animated shader fills, persistence, editing |
| INIT | `spec/initiative-tracker.md` | **Must-have.** Combat tab: start from selection, roll d20 + bonus (stat block or GM-edited), editable initiative, rotating turn order with end-of-round and initiative-20 (lair) lines, active-token ring, TV strip |

## Decisions confirmed with the user

- Docked tabs in the right pane (no floating windows); 5etools search opens as an overlay from the Library tab.
- AoE templates and conditions are visible to players by default, each with a GM-only toggle.
- Stat blocks are read-only, plus per-token current/temp HP with quick damage/heal.
- One spec per scope, reviewed by the user before implementation.
- Initiative: a Combat tab in the right pane (auto-opens, live dot), plus a compact turn-order strip on the TV (GM can switch it off).
  Next turn selects the active token so the quick stat card follows. Combat writes use `systemWrite` (not on the Ctrl+Z stack).
- Rust/WASM considered: not used. The latency is caused by DOM/Svelte/GPU-upload work, not computation (see PERF).

## Database changes (one migration — generated and run by the user)

- `marker`: `conditions` json NOT NULL default `'[]'`, `stat_block` json, `hit_points` int, `temp_hit_points` int
- `asset`: `stat_block` json
- new table `aoe_template`
- `scene`: `combat_round` int NOT NULL default 0, `combat_active_marker_id` text, `combat_lair_step` / `combat_lair_actions` bool default false,
  `combat_show_on_tv` bool default true (INIT)
- `marker`: `in_combat` bool default false, `initiative` real, `initiative_bonus` int, `initiative_tiebreak` real default 0 (INIT)
- `asset`: `initiative_bonus` int (INIT)

After wave 0 lands, the user runs: `pnpm --filter web generate` (creates migration 0056), then applies it with the project's
migrate command. Agents never generate or run migrations (CLAUDE.md D-3/D-4).

## Changesets

`packages/ui` change: `Editor.svelte` `setContent(..., { emitUpdate: false })` (PERF). The user creates the changeset: **patch**.
No other `packages/ui` changes are planned.

## Execution waves and file ownership

Each agent edits **only** the files it owns. If a file outside the list needs a change, the agent stops and reports it.
Shared files touched by two agents in the same wave are marked ⚠. Those agents may edit only the region named, and must re-read
the file before each edit.

### Wave 0: contracts (orchestrator)
Shared types so wave-1 agents can work in parallel:
- `schema.ts`: all DB changes above.
- `packages/stage`:
  - `MarkerLayer/types.ts`: `MarkerCondition`, `Marker.conditions`.
  - `Stage/types.ts`: `onMarkersMoved`, `selectedMarkerIds`, `dropTargetMarkerId`, `activeTurnMarkerId`, `aoeTemplates` props, AoE callbacks and exports.
  - `AoeTemplateLayer/types.ts`.
  - `index.ts`: export the new types.
- `apps/web`:
  - `realtime/types.ts`: `MarkerRow` fields (incl. INIT combat fields), `SceneSettings` combat fields, `AoeTemplateRow`.
  - `utils/statBlock/types.ts`.

### Wave 1: parallel implementation (Haiku agents)
| Agent | Scope | Owns |
| --- | --- | --- |
| W1-STAGE-INPUT | PERF 3–4, GROUP 1–2 (stage side), INIT active-turn prop | `MarkerLayer/MarkerLayer.svelte`; `Stage/Stage.svelte` ⚠ (context-sync effect only) |
| W1-STAGE-TOKEN | PERF 2, COND 1–3, INIT active-turn ring | `MarkerLayer/MarkerToken.svelte`, new `helpers/tokenRasterCache.ts`, new `helpers/markerConditions.ts` (+ test), new `MarkerLayer/MarkerConditionBadges.svelte`, `MarkerTooltip/MarkerTooltip.svelte`; `Stage/index.ts` ⚠ (append exports only) |
| W1-AOE-STAGE | AOE 2–12 | new `AoeTemplateLayer/*` (except `types.ts`, which it may extend), new `helpers/aoeTemplates.ts` (+ test), new shaders, `Scene/Scene.svelte`, `Scene/types.ts`, `MapLayer/types.ts`, apps/docs stage playground; `Stage/Stage.svelte` ⚠ (exports delegation only); `Stage/index.ts` ⚠ (append exports only) |
| W1-DATA | AOE 13–20, GROUP 3, COND 4, 5E B9–B10, INIT field plumbing | `realtime/docSchema.ts` (+ test), `realtime/fromDb.ts`, `realtime/wire.ts` (+ test), `realtime/buildRenderProps.ts`, `realtime/coordinateUpgrade.ts`, `realtime/SessionDocClient.svelte.ts`, `partykit/gameSession.ts`, `routes/api/internal/persistSession/+server.ts`, `server/realtime/index.ts`, `utils/buildSceneProps.ts` (+ test), `utils/gridModeTransition.ts`, `utils/tokenClipboardSchema.ts` (+ test), `server/assets/clipboard.ts`, `server/gameSession/demoSessionData.ts`, game-session export/import endpoints |
| W1-5E-PARSER | 5E A1–A2 | new `utils/statBlock/*` (except `types.ts`), new `server/assets/fivetools/statblock/*` |
| W1-5E-SERVER | 5E B2–B8, INIT asset `initiativeBonus` | `server/assets/fivetools/{adapter,catalog,import,types,index}.ts`, `routes/api/assets/{import,catalog,manage}/+server.ts`, `queries/assetImport.ts`, `server/assets/assets.ts` (+ test) |
| W1-UI-COMBAT | 5E D, COND 6–7, INIT context-panel combat row | new `components/StatBlock/*`, new `GameSession/ConditionPicker.svelte`, new `GameSession/TokenContextPanel.svelte` |
| W1-UI-PANEL | PANEL 1, 4–8, INIT combat tab + asset bonus field | new `GameSession/SidePanelTabs.svelte`, `Assets/AssetLibrary.svelte`, new `Assets/AssetEditor.svelte`, new `Assets/assetPlacement.ts`, `Assets/types.ts`, `Assets/index.ts` ⚠ (append), `Handouts/*` |
| W1-UI-CATALOG | 5E C | new `Assets/AssetCatalog*.svelte`, `Assets/AssetStatPreview.svelte`, `Assets/AssetImportFooter.svelte`, `Assets/AssetImport.svelte`; `Assets/index.ts` ⚠ (append) |
| W1-UI-AOE | AOE 21–23, GROUP 5 + INIT (Shortcuts docs) | new `GameSession/AoeTemplateControls.svelte`, new `GameSession/AoeTemplateManager.svelte`, new `utils/aoeEffectSwatches.ts`, `GameSession/SceneControls.svelte`, `utils/stageKeyCommands.ts`, `GameSession/Shortcuts.svelte`, `GameSession/SceneSelector.svelte` |
| W1-UI-INIT | INIT logic + components | new `utils/initiative.ts` (+ test), new `components/Combat/*` (`InitiativeTracker`, `InitiativeRow`, `InitiativeDivider`, `InitiativeStrip`, `combatActions.ts` + test, `types.ts`, `index.ts`) |

Gate after wave 1: `pnpm run check` (errors limited to page wiring that wave 2 fixes), unit tests.

### Wave 2: GM page integration (sequential, one agent at a time on `+page.svelte`)
| Agent | Scope | Owns |
| --- | --- | --- |
| W2-PAGE-MARKERS | PERF 1, 3.4, 4.6; GROUP 4–5; COND 5, 7–8; 5E D wiring | GM `+page.svelte`, `GameSession/MarkerManager.svelte`, `packages/ui/.../Editor/Editor.svelte` |
| W2-PAGE-PANELS (after W2-PAGE-MARKERS) | PANEL 2–3, 9; 5E overlay mount; AOE 24; INIT page + play-route wiring and hotkeys; play route | GM `+page.svelte`, `GameSession/MarkerManager.svelte` (handout button only), play `+page@.svelte`, e2e tests |

### Wave 3: verification (orchestrator + Opus reviewers)
`pnpm run check`, `pnpm run format-check`, unit tests, code review per scope, fixes, skill/doc freshness (SK-1),
and the architecture-doc question (ARCH-1).

## Out of scope / follow-ups (from the Bag of Mapping research)

- Initiative extras: grouped initiative for identical monsters, delay/ready, per-player turn pings (core tracker is in scope: INIT).
- Effect expiry per turn.
- Auto-distance labels (M) from the selected token.
- Picker for overlapping tokens.
- Map day/night states.
- TV zoom lock.
