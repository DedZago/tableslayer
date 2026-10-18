# Spec: 5etools search polish, stat block import and quick reference

Part of `spec/dnd-combat-polish.md`. Scope tag: **5E**. Supersedes the "stat blocks out of scope" notes in
`spec/assets-tokens-and-handouts.md` (update that spec's scope lines when this lands).

## Problem

1. The 5etools search UI (`Assets/AssetImport.svelte`) is three nested `<details>` levels deep, every control shares one
   style (buttons look like inputs), results are text-only, the flow needs two similar lists (search → "Add to import
   preview" → checkbox list → "Import selected"), and ~10 actions sit at the same level.
2. The import keeps only name/source/artwork: `adapter.ts` `recordSchema` is a plain `z.object`, so every stat key is
   stripped at parse time. The GM can't see AC/HP/actions when running combat.

## Decisions

- **Stats live on the asset (master) and are snapshotted onto each placed marker.** Markers keep working if the asset is
  deleted, co-GMs can see them, clipboard works offline. Current HP lives only on the marker.
- **HP tracking (confirmed with user)**: read-only stat block + editable current HP and temp HP per token, quick damage/heal.
  Drives the automatic "Bloodied" condition (COND spec).
- New DB columns (**user generates/runs the migration**):
  - `asset.stat_block` json nullable
  - `marker.stat_block` json nullable, `marker.hit_points` integer nullable, `marker.temp_hit_points` integer nullable
- Stats/HP are written via `client.write.setMarkerFields(...)` directly — **never** through `convertMarkerToDbFormat`/stageProps.
- Stat snapshot reaches player clients through the shared doc (already true for notes). Acceptable for v1; documented.
- No `packages/ui` changes (5e-specific UI lives in apps/web) → no changeset.

## Types (created in wave 0 — `apps/web/src/lib/utils/statBlock/types.ts`, client-safe)

```ts
export type Ability = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'hit'; bonus: number }                 // {@hit 5}
  | { kind: 'damage'; formula: string }            // {@damage 1d6+3}
  | { kind: 'dice'; formula: string }              // {@dice 1d10}, {@d20 +5}
  | { kind: 'dc'; dc: number }                     // {@dc 13}
  | { kind: 'attack'; label: string }              // {@atk mw} → "Melee Weapon Attack:"
  | { kind: 'ref'; refType: 'spell' | 'condition' | 'item' | 'creature' | 'skill' | 'action' | 'status' | 'sense' | 'other'; text: string }
  | { kind: 'recharge'; min: number }
  | { kind: 'em'; text: string };
export type StatEntry = {
  name: string; nameInlines: Inline[]; body: Inline[][];
  attack?: { toHit: number; kind: string; reach?: string; range?: string; damage: { formula: string; average?: number; type?: string }[] };
  save?: { dc: number; ability?: Ability }; recharge?: number; cost?: number;
};
export type StatSpellcasting = {
  name: string; header: Inline[][]; displayAs: 'trait' | 'action' | 'bonus' | 'reaction' | 'legendary';
  dc?: number; toHit?: number; ability?: Ability;
  groups: { label: string; slots?: number; spells: string[] }[]; footer: Inline[][];
};
export type StatBlock = {
  version: 1;
  source: { provider: '5etools'; name: string; source: string; page?: number; adapterVersion: string };
  name: string; size: string[]; type: string; alignment: string;
  ac: { value: number; note?: string }[];
  hp: { average: number | null; formula?: string; note?: string };
  speed: { mode: 'walk' | 'fly' | 'swim' | 'climb' | 'burrow'; feet: number; note?: string }[]; canHover?: boolean;
  abilities: Record<Ability, { score: number; mod: number; save?: number }>;
  skills: { name: string; bonus: string }[]; senses: string[]; passive?: number; languages: string[];
  cr: { display: string; value: number; xp?: number; pb: number; lair?: string };
  initiative?: number;
  vulnerable: string[]; resist: string[]; immune: string[]; conditionImmune: string[];
  traits: StatEntry[]; actions: StatEntry[]; bonusActions: StatEntry[]; reactions: StatEntry[];
  legendary: StatEntry[]; legendaryHeader?: Inline[][]; legendaryCount?: number; mythic: StatEntry[];
  spellcasting: StatSpellcasting[]; warnings: string[];
};
```

## Phase A — utilities and parser (pure, unit-tested)

### A1. `apps/web/src/lib/utils/statBlock/`
- `schema.ts`: `statBlockSchema` (zod mirror of the types; strings ≤ 2000, arrays ≤ 100; `superRefine` rejecting
  `JSON.stringify(value).length > 65536`). Export `inlineSchema`, `statEntrySchema`.
- `format.ts`: `formatModifier(n)` → "+2" / "−1" (U+2212), `abilityMod(score) = Math.floor((score - 10) / 2)`,
  `crToNumber('1/8') → 0.125`, `crToXp(cr)` table, `crToProficiency(cr)` (`Math.max(2, Math.floor((cr - 1) / 4) + 2)` for cr ≥ 1; 2 below),
  `averageDamage('2d6+3') → 10`, `formatSpeed(speed)`, `inlinesToPlainText(inlines)`.
- `dice.ts`: `parseDiceFormula(f)` → `{ terms: { count, sides }[]; modifier }`; `rollFormula(f, rng = Math.random)` →
  `{ total, rolls: number[], modifier, text: '2d6+8 → [6, 9] + 8 = 23' }`. Supports `XdY`, `+/-N`, multiple dice terms, `d20 +5`.
- `index.ts` barrel.
- Tests `format.test.ts`, `dice.test.ts` (seeded rng).

### A2. `apps/web/src/lib/server/assets/fivetools/statblock/`
Each file exports pure arrow functions; nothing throws on unknown shapes — push to `warnings` and continue.

1. `raw.ts` — `rawMonsterSchema = z.object({ name: z.string(), source: z.string(), … }).passthrough()`; unknown-shaped fields typed `unknown`.
2. `copy.ts` — `applyCopy(record, index: Map<string, RawMonster>, depth = 0): { record: RawMonster; warnings: string[] }`.
   Deep-clone the base (`structuredClone`), drop `_copy`, `_versions`, and base `srd`/`page`/`otherSources` unless `_preserve` lists them,
   merge child keys, then apply `_mod` via `applyMod(target, prop, op)`. Supported modes: `replaceTxt` (regex `replace`/`with`/`flags`
   over all entry strings), `appendArr`, `prependArr`, `insertArr`, `replaceArr` (match by `replace` name), `removeArr` (by `names`/`items`),
   `replaceOrAppendArr`, `appendIfNotExistsArr`, `addSkills`, `addSaves`, `addSenses`, `addSpells`, `replaceSpells`, `removeSpells`,
   `scalarAddHit` / `scalarAddDc` (rewrite `{@hit n}` / `{@dc n}`), `maxSize`, `scalarMultXp`. `prop: '*'` = every entries array.
   Unknown modes, `_trait`, `_appendCopy` → warning. Identity key = `${name.toLowerCase()}|${source.toLowerCase()}`. Depth guard 32 / cycle guard.
3. `tags.ts` — `parseInlineTags(text): Inline[]`, a **tokenizer** (not regex soup): scan for `{@`, track brace depth (tags nest),
   split tag name / body at the first space, pipe-split body into `[display/target, source, displayText]`. Mapping:
   `hit`→hit · `damage`→damage · `dice`/`d20`→dice (d20 gets "+n" text) · `dc`→dc · `atk`/`atkr`→attack with labels
   (`mw` "Melee Weapon Attack:", `rw` "Ranged Weapon Attack:", `ms` "Melee Spell Attack:", `rs` "Ranged Spell Attack:",
   `mw,rw` "Melee or Ranged Weapon Attack:", 2024 `m` "Melee Attack Roll:", `r` "Ranged Attack Roll:", `m,r` "Melee or Ranged Attack Roll:") ·
   `h`→em "Hit: " · `hom`→em "Hit or Miss: " · `recharge`→recharge (default 6) · `actSave <ab>`→em "<Ability> Saving Throw:" ·
   `actSaveFail`→em "Failure:" · `actSaveSuccess`→em "Success:" · `actSaveSuccessOrFail`→em "Failure or Success:" ·
   `actTrigger`→em "Trigger:" · `actResponse`→em "Response:" · `spell|condition|item|creature|skill|action|status|sense`→ref
   (display text = 3rd pipe segment if present, else 1st) · `chance n`→text "n percent" · `b`/`i`/`note`→recurse ·
   unknown → text of display part. **Never emit raw `{@`.** Merge adjacent text nodes.
4. `entries.ts` — `parseEntries(entries: unknown[], warnings): Inline[][]`: strings; `{type:'entries', name, entries}` (name as em prefix);
   `{type:'list', items}` (each item a paragraph prefixed "• "); `{type:'item', name, entry|entries}`; `inset`/`inline`/`inlineBlock`;
   `table` → skipped with warning. Depth limit 8.
5. `entry.ts` — `parseStatEntry(raw: { name: string; entries: unknown[] }, warnings): StatEntry`. Derive from first paragraph:
   first `hit` → `attack.toHit`; attack label → `kind`; regex `reach (\d+) ft\.` / `range ([\d/]+) ft\.`; each `damage` inline + the
   preceding text number (`/(\d+) \($/`) → `average`, following word before " damage" → `type`; first `dc` → `save.dc` + ability word
   that follows ("Wisdom saving throw") or `actSave` tag; `recharge` from name inline; `cost` from `/\(Costs (\d) Actions\)/`.
6. `fields.ts` — `parseAc`, `parseHp`, `parseSpeed`, `parseType`, `parseSize` (T/S/M/L/H/G table → "Tiny"…), `parseAlignment`
   (codes L, N, NX, NY, C, G, E, U, A + `{alignment, chance}` + `{special}`), `parseCr` (string | `{cr, lair, coven, xp}`),
   `parseSaves`, `parseSkills`, `parseDamageList` (recursive `{resist:[…], note, preNote, cond}` → "bludgeoning, piercing, and slashing from nonmagical attacks"),
   `parseConditionImmune`, `parseInitiative(raw, dexMod, pb)` (2024 `{proficiency: 1|2}` or number).
7. `spellcasting.ts` — `parseSpellcasting(arr, warnings): StatSpellcasting[]`: `will` → "At will"; `daily` keys (`'1'` → "1/day", `'2e'` → "2/day each");
   `spells` levels (`'0'` → "Cantrips", n → "Level n (k slots)"); `rest`, `weekly`, `recharge`, `ritual`. Spells → plain text names.
   DC / to-hit pulled from header `{@dc}` / `{@hit}` tags. `displayAs` default `'trait'`.
8. `index.ts` — `buildStatBlock(raw: unknown, adapterVersion: string): StatBlock` orchestrates 6/7, maps
   `trait`/`action`/`bonus`/`reaction`/`legendary`/`mythic` with `parseStatEntry`, `legendaryActions` (default 3 when legendary exists),
   `legendaryHeader`; ends with `statBlockSchema.parse()`. Also re-export `applyCopy`, `parseInlineTags`.

Tests (`statblock/*.test.ts`, vitest). Fixtures: if `.local-data/5etools-upstream/bestiary-mm.json` exists use it (`describe.skipIf`),
plus a committed trimmed fixture `statblock/__fixtures__/monsters.json` with Goblin, Lich, Adult Red Dragon, one `_copy`+`_mod`
example and one 2024 (XMM-style) monster written by hand from the formats above. Assertions:
Goblin AC 15 note "leather armor, shield", HP 7 "2d6", scimitar `toHit 4`, damage `{ formula: '1d6 + 2', average: 5, type: 'slashing' }`;
Lich spell DC 20, immune includes "from nonmagical attacks", CR "21 (22 in lair)"; Dragon Fire Breath `recharge 5`, Wing Attack `cost 2`;
no `{@` survives `inlinesToPlainText` for any fixture monster.

## Phase B — DB and import pipeline

1. `schema.ts`: columns above (`$type<StatBlock>()`). Wave 0 adds them; user runs `pnpm --filter web generate` then migrate.
2. `fivetools/types.ts`: `FiveToolsPreview` gains `cr?: string; creatureType?: string; size?: string; statBlock?: StatBlock | null`.
3. `adapter.ts`: `recordSchema` → `.passthrough()` (keep validated fields); compute `cr`/`creatureType`/`size` badges cheaply in
   `normalizeFiveToolsDocuments`; uploaded JSON path builds `statBlock` via `applyCopy` + `buildStatBlock` with an index of the
   uploaded documents. Bump `FIVETOOLS_ADAPTER_VERSION = 'bestiary-stats-v1'`.
4. `catalog.ts`: during load keep `fileByIdentity: Map<identity, filename>` (no raw monsters in memory) and the badges.
   New `fiveToolsCatalogStatBlock(identity): Promise<StatBlock | null>` reading the file via `cachedFiveToolsJson(url)` (cache hit),
   building an index of that file + `_copy` base files (via `fileByIdentity`), `applyCopy` → `buildStatBlock`.
   Small LRU (8 parsed files, a `Map` with delete/re-set on access). Export from `fivetools/index.ts`.
5. `import.ts`: resolve the stat block per item (catalog → `fiveToolsCatalogStatBlock`; upload → `statBlockSchema.parse(record.statBlock)`);
   add a stat-block hash to `fingerprintItem`; set `statBlock` on insert and on `update` policy.
6. Routes (apiFactory):
   - `api/assets/import`: `recordSchema` + `statBlock: statBlockSchema.nullable().optional()`, `cr`, `creatureType`, `size`.
   - `api/assets/catalog`: new union member `{ action: 'statBlock', identity: z.string().max(1000) }` → `{ statBlock }`.
   - `api/assets/manage`: `fields.statBlock: statBlockSchema.nullable().optional()`; `saveMarker` snapshot copies `statBlock`.
7. `queries/assetImport.ts`: `createCatalogStatBlockQuery(identity: () => string | null)` with `createQuery`
   (key `['assetCatalogStatBlock', identity]`, `enabled: !!identity()`, `staleTime: Infinity`).
8. `server/assets/assets.ts`: `assetPlacements` → `statBlock: asset.statBlock ?? null, hitPoints: asset.statBlock?.hp.average ?? null, tempHitPoints: null`;
   `assetFromMarker` copies `marker.statBlock`; `listAssets` also returns a `statSummary` `{ cr, type, size }` (via `json_extract`) instead of the full block;
   update `assets.test.ts` (it currently asserts no stat blocks).
9. Realtime: `MarkerRow` gains `statBlock?`, `hitPoints?`, `tempHitPoints?` (wave 0). `fromDb.ts` passes through. Persist uses
   `insertMarkerSchema` (picks up columns automatically) — verify.
10. Clipboard: `tokenClipboardSchema.ts` optional `statBlock` (`statBlockSchema`), `hitPoints`, `tempHitPoints`; copy in `server/assets/clipboard.ts`; update `tokenClipboard.test.ts`.
11. `buildSceneProps.ts`: no stat data on the stage `Marker` (keeps stage props light); the page reads stats from the doc row.

## Phase C — search UI ("Add from 5etools" overlay)

Opened from the Library tab (`onOpenCatalog`). Rendered by the page as an overlay over the stage area.

```
┌ Add creatures from 5etools ─────────────────────────────────────── [✕] ┐
│ [🔍 Search 3,812 creatures…                       ]   [⋯ Upload JSON / Refresh]│
│ Source: (All)(MM)(XMM)(VGM)(MPMM)(MotM)(+ more ▾)   CR [any ▾]  Type [any ▾]   │
├──────────────────────────────────────────┬────────────────────────────────────┤
│ ☐ [img] Goblin             CR ¼  ·  S    │ [img] Goblin                       │
│         Humanoid · MM    [In library]    │ Small humanoid (goblinoid), NE     │
│ ☑ [img] Goblin Boss        CR 1  ·  S    │ AC 15 · HP 7 (2d6) · 30 ft.        │
│ …                                        │ STR DEX CON INT WIS CHA ...        │
│ [‹ Prev]   1–100 of 1,204   [Next ›]     │ Actions: Scimitar +4 · 1d6+2 slash  │
│                                          │ [Add to library]  [Add & place] ●  │
├──────────────────────────────────────────┴────────────────────────────────────┤
│ 2 selected · If already in library [Skip ▾]                [Add 2 to library] ●│
└────────────────────────────────────────────────────────────────────────────────┘
```

Files (apps/web/src/lib/components/Assets/):
- `AssetCatalogOverlay.svelte` — the shell: `role="dialog" aria-modal="true" aria-labelledby`, `position: fixed`, covers the stage area
  (`inset: 3rem` desktop, full-screen < 768px), backdrop `color-mix(in srgb, var(--bg) 60%, transparent)`, panel `var(--bg)`,
  `var(--shadow-3)`, `var(--radius-3)`. Esc / ✕ / backdrop click closes. Focus trapped (first focus = search input). Holds state
  `rows`, `selected: Set<string>`, `previewIdentity`, `duplicatePolicy`.
- `AssetCatalogBrowser.svelte` — toolbar (search `Input` debounced 200 ms, overflow `IconDots` menu with "Upload bestiary JSON" and
  "Refresh catalog" (confirm)), source chips (`<button aria-pressed>`; top 6 sources by count + "More" popover), CR `Select`
  (any, 0–1/2, 1–4, 5–10, 11–16, 17+), Type `Select`, results list, pager, loading bar (`Loading`) while the catalog builds,
  warnings collapsed to one "N files skipped" link.
- `AssetCatalogRow.svelte` — two hit areas: checkbox (`InputCheckbox`, selects) and the row body button (previews). Thumbnail 40px
  (`tokenUrl` via a server proxy if CSP blocks — see risk), name (600 weight), meta line (type · source), right-aligned CR badge and
  size badge, "In library" muted badge for duplicates. `assetCatalog__row--previewing` highlight `background: var(--contrastLow)`.
- `AssetStatPreview.svelte` — uses `createCatalogStatBlockQuery`; renders `StatBlockPanel` (readonly) + primary "Add & place" and
  ghost "Add to library".
- `AssetImportFooter.svelte` — "N selected", duplicate policy `Select` (Skip / Update / Add another), primary `Button` "Add N to library",
  retry link only when failures exist; per-row result icons (`IconCircleCheck` `--fgSuccess` / `IconAlertTriangle` `--fgDanger` + tooltip).
- `AssetImport.svelte` — becomes a thin wrapper re-exporting the overlay (or delete and update imports).
- Layout: `.assetCatalog__layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(18rem, 24rem); }` and a container query
  stacking the preview under the list below 48rem.
- Rule: **exactly one primary button per view**; secondary = ghost; tertiary = link. Chips are toggles with `aria-pressed` and outlined style.
- BEM block `assetCatalog`: `__toolbar`, `__search`, `__chips`, `__chip`, `__chip--active`, `__filters`, `__layout`, `__results`, `__row`,
  `__row--previewing`, `__rowCheck`, `__rowBody`, `__rowThumb`, `__rowName`, `__rowMeta`, `__badge`, `__badge--cr`, `__badge--owned`,
  `__preview`, `__footer`, `__pager`, `__status`.
- "Add & place": import mutation → `placeAsset` at the viewport centre (PANEL spec `assetPlacement.ts`) → close overlay.

Server-side search additions: `searchFiveToolsCatalog` accepts optional `crRange` and `creatureType` filters and returns
`cr`/`creatureType`/`size` on each result plus `sources: { source, count }[]`.

## Phase D — stat block viewer

Files `apps/web/src/lib/components/StatBlock/`: `StatBlockPanel.svelte`, `StatBlockInline.svelte`, `StatBlockQuickCard.svelte`, `types.ts`, `index.ts`.

`StatBlockPanel` props: `statBlock: StatBlock; hitPoints?: number | null; tempHitPoints?: number | null; readonly?: boolean;
onHitPointsChange?: (f: { hitPoints?: number | null; tempHitPoints?: number | null }) => void; onRoll?: (label: string, formula: string) => void`.

```
┌ statBlock ───────────────────────────────────────────────┐
│ Goblin                         CR 1/4 · 50 XP · PB +2  [▾]│
│ Small humanoid (goblinoid), neutral evil                 │
│ [AC 15]   [HP ( 5 )/7  −  +  temp 0 ]   [30 ft.]          │
│ ▓▓▓▓▓▓▓░░░ hp bar                                         │
│ STR  DEX  CON  INT  WIS  CHA                              │
│  8   14   10   10    8    8                               │
│ −1   +2   +0   +0   −1   −1                               │
│ Skills Stealth +6 · Senses darkvision 60 ft., PP 9        │
│ Languages Common, Goblin                                   │
│ ▾ Actions                                                  │
│   Scimitar  [🎲 +4] [🎲 1d6+2 slashing] reach 5 ft.        │
│ ▸ Traits  ▸ Bonus actions  ▸ Reactions  ▸ Legendary (3)    │
│ ▸ Spellcasting  DC 20 · +12                               │
└──────────────────────────────────────────────────────────┘
```
- HP block: number `Input` for current HP; `−`/`+` IconButtons (±1); a "damage / heal" quick input: type a number, Enter = damage,
  Shift+Enter = heal (buttons "Damage" danger-ghost and "Heal" ghost next to it). Damage consumes temp HP first. Clamp to `[0, max]`.
  Temp HP small input. Bar `statBlock__hpBar` `var(--fgSuccess)`, `--low` (≤ 50%) `var(--orange-6)`, `--critical` (≤ 25%) `var(--fgDanger)`.
- Ability grid 6 columns; proficient saves in `var(--fgPrimary)` with tooltip "Save +N".
- Sections as `<details>` with `statBlock__section` (Actions open by default).
- Only dice chips are buttons (`statBlock__roll`, die icon `IconDice5`, hover background, `cursor: pointer`). Click → `rollFormula` →
  `onRoll(label, formula)`; the page shows `addToast({ data: { title: 'Scimitar: 7', body: '1d6+2 → [5] + 2 = 7' } })`. `hit` chips roll `1d20+N`.
  Everything else is plain text, so "button vs label" is never ambiguous.
- Refs (spells/conditions) render as `statBlock__ref` (italic, dotted underline, `title` with the ref type) — not buttons.
- `StatBlockInline.svelte` renders `Inline[]` paragraphs.
- Collapsed state remembered with the existing game-session preferences util (check it accepts new keys).
- BEM: `statBlock`, `--collapsed`, `__header`, `__title`, `__subtitle`, `__crBadge`, `__toggle`, `__vitals`, `__vital`, `__vitalLabel`,
  `__vitalValue`, `__hp`, `__hpInput`, `__hpBar`, `__hpBar--low`, `__hpBar--critical`, `__abilities`, `__ability`, `__abilityName`,
  `__abilityScore`, `__abilityMod`, `__abilitySave--proficient`, `__props`, `__prop`, `__section`, `__sectionTitle`, `__entry`, `__entryName`,
  `__entryChips`, `__chip`, `__chip--hit`, `__chip--damage`, `__chip--dc`, `__entryText`, `__roll`, `__ref`, `__em`.
- CSS vars: `--surfaceBg`/`--bg`, `--contrastLow`, `--borderThin`, `--fg`, `--fgMuted`, `--fgPrimary`, `--fgDanger`, `--fgSuccess`,
  `--inputBg`, `--inputBorderColor`, `--radius-2`, `--shadow-1`. Font sizes 0.75rem labels / 0.875rem body.

`StatBlockQuickCard.svelte` — **quick reference while selecting tokens on the map** (GM only):
- Shown over the stage, bottom-left (`position: absolute; left: 1rem; bottom: 1rem; z-index: 2; width: min(22rem, 40vw); max-height: 45vh; overflow-y: auto`)
  whenever exactly one selected token has a stat block. Contents: name + CR, AC / HP (with −/+ and damage input) / speed, ability mods row,
  Actions list with roll chips (other sections collapsed). Header buttons: collapse (persists), "Full stat block" (opens the pane on the Tokens tab
  showing MarkerManager's full `StatBlockPanel`).
- It reuses `StatBlockPanel` with a `variant: 'full' | 'compact'` prop (compact hides traits/props, shows actions only) rather than duplicating markup.
- Never mounted while nothing with stats is selected (zero cost).

Wiring (page integration wave):
- `const selectedMarkerRow = $derived(selectedMarkerIds.length === 1 ? session.client?.scene(selectedSceneId)?.markers.find((m) => m.id === selectedMarkerIds[0]) : undefined);`
  (match the real accessor for scene rows used elsewhere in the page.)
- `onHitPointsChange = (fields) => session.client?.write.setMarkerFields(selectedSceneId, id, fields)` (discrete edit → normal undo step).
- MarkerManager edit view: `{#if statBlock}<StatBlockPanel …/>{/if}` first; existing appearance form inside a collapsed
  `<details class="markerManager__appearance"><summary>Appearance</summary>…</details>` when a stat block exists (open otherwise).
- DM hover tooltip content may append "HP 5/7" (optional).

## Phase E — docs

Update `.claude/skills/web-data-patterns/SKILL.md` (5etools bullet: stat blocks, new columns, "write stats/HP via `setMarkerFields`, never stageProps"),
bump "last verified". Update `spec/assets-tokens-and-handouts.md` scope lines.

## Testing

- Parser unit tests (Phase A). `assets.test.ts`, `tokenClipboard.test.ts` updated.
- Manual: search "goblin" → thumbnails, CR badges; click row → stat preview; check 3 → "Add 3 to library"; "Add & place" places a goblin with
  HP 7/7; select it → quick card appears; type 5 + Enter → HP 2/7, Bloodied pip appears; Ctrl+Z restores 7; delete the asset → token keeps stats.

## Risks

- `5e.tools` thumbnails may be blocked (403/CSP). If so add `GET /api/assets/catalog/thumbnail?identity=` proxy that reuses `download.ts`
  (SSRF-safe) with a `Cache-Control: public, max-age=604800` response and an in-memory/R2 cache.
- Cross-file `_copy` requires base files cached — they are after a full catalog load.
- Doc size: ~5 KB per placed monster; don't copy fluff/lore.
