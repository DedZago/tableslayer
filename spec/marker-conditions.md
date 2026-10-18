# Spec: Token status conditions

Part of `spec/dnd-combat-polish.md`. Scope tag: **COND**.

## Problem

The GM needs to track D&D conditions (Stunned, Prone, …) on tokens during combat, apply them quickly to one or many tokens
via right-click, see them on the map (GM and players), and read their rules at a glance. Multiple conditions stack.
Custom conditions are allowed. Each condition can be GM-only.

## Decisions

- **Storage**: new JSON column `marker.conditions` (NOT NULL, default `'[]'`). A doc-only field would be dropped by the
  persist endpoint's zod schema, so a column is required. **Migration generated/run by the user.**
- **Shape** (shared type, exported by `@tableslayer/stage`):
  ```ts
  export type MarkerCondition = {
    id: string;          // catalog key ('prone', 'exhaustion', …) or 'custom:<uuid>'
    label?: string;      // custom only (≤ 24 chars)
    color?: string;      // custom only, '#rrggbb'
    value?: number;      // exhaustion level 1–6
    dmOnly?: boolean;    // hidden from players
  };
  ```
  Stored sorted by catalog order (custom ones last, by label) so `conditionsKey()` is stable.
- **Writes** only through a dedicated writer (`writeMarkerConditions`), never via `convertMarkerToDbFormat`/`upsertMarkerRow`
  (that path rewrites the whole row and would clobber concurrent condition edits).
- **Rendering**: per-token badge mesh (one small canvas texture) drawn only when the condition set changes. No Threlte `<HTML>`.
- **Right-click UI**: a web-only `TokenContextPanel` popover (chips grid + existing token actions). No `packages/ui` change → no changeset.
- **Bloodied**: automatic when the token has a stat block with HP tracking and `0 < hitPoints ≤ floor(maxHp / 2)` (see
  `spec/5etools-statblocks.md`). Also available as a manual condition for tokens without HP tracking.

## Condition catalog

New file `packages/stage/src/lib/components/Stage/helpers/markerConditions.ts` (no Three.js imports).

```ts
export type ConditionGroup = 'condition' | 'combat';
export type ConditionDefinition = { label: string; abbr: string; color: string; group: ConditionGroup; description: string; maxValue?: number };
export const MARKER_CONDITIONS: Record<string, ConditionDefinition> = { … };
export const MARKER_CONDITION_ORDER: string[] = Object.keys(MARKER_CONDITIONS);
export const resolveCondition = (c: MarkerCondition): { label: string; abbr: string; color: string; description: string; group: ConditionGroup | 'custom' } => …;
export const conditionsKey = (list: MarkerCondition[]): string => …; // e.g. "prone|exhaustion:2|custom:x:Hexed:#ff0:dm"
export const sortConditions = (list: MarkerCondition[]): MarkerCondition[] => …;
export const toggleCondition = (list: MarkerCondition[], id: string): MarkerCondition[] => …;
```

Entries (5e 2024 wording, one short line each — keep descriptions ≤ 140 chars):

| id | label | abbr | color | description |
| --- | --- | --- | --- | --- |
| blinded | Blinded | Bl | #6b7280 | Can't see; auto-fails sight checks. Attacks against have advantage; its attacks have disadvantage. |
| charmed | Charmed | Ch | #ec4899 | Can't attack the charmer or target them with harmful effects. Charmer has advantage on social checks. |
| deafened | Deafened | De | #9ca3af | Can't hear; auto-fails hearing checks. |
| exhaustion | Exhaustion | Ex | #92400e | Each level: −2 to d20 tests, −5 ft speed. Dies at level 6. (maxValue 6) |
| frightened | Frightened | Fr | #a855f7 | Disadvantage on checks/attacks while source is in sight; can't willingly move closer. |
| grappled | Grappled | Gr | #d97706 | Speed 0. Disadvantage on attacks against targets other than the grappler. |
| incapacitated | Incapacitated | In | #64748b | No actions, bonus actions or reactions. Concentration breaks. |
| invisible | Invisible | Iv | #a5b4fc | Can't be seen. Attacks against have disadvantage; its attacks have advantage. |
| paralyzed | Paralyzed | Pa | #eab308 | Incapacitated, speed 0. Fails Str/Dex saves. Attacks against have advantage; hits within 5 ft are crits. |
| petrified | Petrified | Pe | #78716c | Turned to stone: incapacitated, speed 0, resistance to all damage, immune to poison. |
| poisoned | Poisoned | Po | #22c55e | Disadvantage on attack rolls and ability checks. |
| prone | Prone | Pr | #b45309 | Crawl only. Disadvantage on attacks. Melee attacks against have advantage, ranged have disadvantage. |
| restrained | Restrained | Re | #0d9488 | Speed 0. Disadvantage on attacks and Dex saves. Attacks against have advantage. |
| stunned | Stunned | St | #facc15 | Incapacitated. Fails Str/Dex saves. Attacks against have advantage. |
| unconscious | Unconscious | Un | #1e3a8a | Incapacitated, prone, drops items. Fails Str/Dex saves. Hits within 5 ft are crits. |
| concentrating | Concentrating | Co | #38bdf8 | Maintaining a spell. Con save (DC 10 or half damage) when damaged. |
| bloodied | Bloodied | Bd | #dc2626 | At or below half hit points. |
| blessed | Blessed | Bs | #fde68a | +1d4 to attack rolls and saving throws. |
| baned | Baned | Bn | #7f1d1d | −1d4 to attack rolls and saving throws. |
| hasted | Hasted | Ha | #f97316 | +2 AC, advantage on Dex saves, double speed, one extra limited action. |
| slowed | Slowed | Sl | #60a5fa | −2 AC and Dex saves, half speed, no reactions, limited actions. |
| dodging | Dodging | Dg | #34d399 | Attacks against have disadvantage; advantage on Dex saves. |
| hidden | Hidden | Hd | #475569 | Unseen and unheard; attacks against have disadvantage. |
| raging | Raging | Ra | #b91c1c | Resistance to B/P/S damage, bonus melee damage, advantage on Str checks/saves. |
| marked | Marked | Mk | #e11d48 | Hunter's Mark / Hex: extra damage from the marker. |
| burning | Burning | Bu | #ea580c | Takes fire damage at the start of its turn until extinguished. |
| flying | Flying | Fl | #7dd3fc | Airborne. Falls if knocked prone or speed drops to 0. |
| dead | Dead | ☠ | #111827 | Dead. Rendered as a skull over the token. |

`dead` is special in rendering: draw a skull glyph centred on the token (dimmed token) instead of a pip.
Custom fallback: label → `abbr` = first two letters (title-cased), colour default `#8b5cf6`, description "Custom condition".

## Files

| File | Change |
| --- | --- |
| `apps/web/src/lib/db/app/schema.ts` | `conditions` column on `markerTable` |
| `packages/stage/.../MarkerLayer/types.ts` | `conditions?: MarkerCondition[]` on `Marker`, export `MarkerCondition` |
| `packages/stage/.../helpers/markerConditions.ts` (new) | catalog + helpers |
| `packages/stage/.../MarkerLayer/MarkerConditionBadges.svelte` (new) | badge mesh |
| `packages/stage/.../MarkerLayer/MarkerToken.svelte` | mount badges; dim token + skull when `dead` |
| `packages/stage/src/lib/components/MarkerTooltip/MarkerTooltip.svelte` | conditions list |
| `packages/stage/src/lib/components/Stage/index.ts` | exports |
| `apps/web/src/lib/realtime/types.ts` | `MarkerRow.conditions?` |
| `apps/web/src/lib/utils/buildSceneProps.ts` | map conditions (+ auto bloodied, + filter `dmOnly` for player mode) |
| `apps/web/src/lib/server/assets/assets.ts`, `server/assets/clipboard.ts`, `server/gameSession/demoSessionData.ts` | `conditions: []` in full-row builders |
| `apps/web/src/lib/utils/tokenClipboardSchema.ts` | optional `conditions` (z array max 32) |
| `apps/web/src/lib/components/GameSession/ConditionPicker.svelte` (new) | chip grid (popover + inline modes) |
| `apps/web/src/lib/components/GameSession/TokenContextPanel.svelte` (new) | right-click panel |
| `apps/web/src/lib/components/GameSession/MarkerManager.svelte` | conditions section in edit view, dots in list rows |
| GM `+page.svelte` | writer, right-click → TokenContextPanel |
| `.claude/skills/stage-rendering/SKILL.md`, `.claude/skills/web-data-patterns/SKILL.md` | document |

## Implementation steps

### 1. Badges: `MarkerConditionBadges.svelte`

Props: `conditions: MarkerCondition[]`, `size: number` (token world size), `mode: StageMode`.

- `const visible = $derived(mode === StageMode.Player ? conditions.filter((c) => !c.dmOnly) : conditions);`
- `const key = $derived(conditionsKey(visible));` — **the redraw effect reads only `key`** (and a `$derived` primitive for size),
  never `conditions`/`marker` (they change identity on every drag frame).
- One `OffscreenCanvas(512, 512)` + `CanvasTexture` created once; redraw into it and set `needsUpdate = true`.
- Layout: up to 8 pips evenly spaced along the top arc from −150° to −30° (canvas angles, 0° = right, clockwise is +y down),
  at radius ≈ 0.47 of the canvas; pip radius ≈ 0.075. If > 8, draw 7 + a "+N" pip.
- Pip: filled circle in the condition colour, 3 px dark stroke `rgba(0,0,0,0.75)`, centered white bold text = `abbr`
  (exhaustion shows its level number). Font: `bold 38px system-ui`.
- Mesh: `<T.Mesh geometry={sharedQuad} scale={[size * 1.3, size * 1.3, 1]} renderOrder={SceneLayerOrder.Marker + 0.5} layers={[SceneLayer.Main]}>`
  with `MeshBasicMaterial({ map: texture, transparent: true, depthTest: false })`.
- Dispose texture + material in `onDestroy`.
- Skip `dead` in pips (handled by MarkerToken).

### 2. `MarkerToken.svelte`

- `{#if marker.conditions?.length}<MarkerConditionBadges conditions={marker.conditions} size={tokenWorldSize} mode={stage.mode} />{/if}` inside the token `T.Group` (it inherits the counter-rotation).
- `const isDead = $derived(marker.conditions?.some((c) => c.id === 'dead') ?? false);` → token material `opacity` × 0.45 and a
  skull overlay mesh (draw "☠" once into a shared module-level canvas texture; reuse for all dead tokens).

### 3. Tooltip

`MarkerTooltip.svelte`: add `conditions?: MarkerCondition[]` to its `MarkerData`; render guard also true when conditions exist.
Markup:
```svelte
<ul class="markerTooltip__conditions">
  {#each resolved as c (c.key)}
    <li class="markerTooltip__condition">
      <span class="markerTooltip__conditionSwatch" style:background={c.color}></span>
      <span class="markerTooltip__conditionLabel">{c.label}{c.value ? ` ${c.value}` : ''}</span>
      <span class="markerTooltip__conditionDescription">{c.description}</span>
    </li>
  {/each}
</ul>
```
Player mode: filter `dmOnly`. Styles use `var(--fg)`, `var(--fgMuted)`, `var(--borderThin)`; description `font-size: 0.75rem`.

### 4. Web data plumbing

- `schema.ts` `markerTable`: `conditions: text('conditions', { mode: 'json' }).$type<MarkerCondition[]>().notNull().default(sql\`'[]'\`)`.
- `realtime/types.ts` `MarkerRow`: `conditions?: MarkerCondition[] | null`.
- `buildSceneProps.ts` marker mapping:
  ```ts
  conditions: withAutoConditions(Array.isArray(marker.conditions) ? marker.conditions : [], marker)
  ```
  where `withAutoConditions` (same file, small) appends `{ id: 'bloodied' }` when `marker.statBlock?.hp.average` and
  `marker.hitPoints != null && marker.hitPoints > 0 && marker.hitPoints <= Math.floor(max / 2)` and not already present.
  (Player-mode `dmOnly` filtering happens in the stage, not here.)
- Full-row builders: add `conditions: []`.
- `tokenClipboardSchema.ts`: `conditions: z.array(conditionSchema).max(32).optional()` with
  `conditionSchema = z.object({ id: z.string().max(64), label: z.string().max(24).optional(), color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), value: z.number().int().min(1).max(6).optional(), dmOnly: z.boolean().optional() }).strict()`; copy through in `server/assets/clipboard.ts`.

### 5. Writer (GM `+page.svelte`, next to `setMarkerVisibility`)

```ts
const conditionTargets = (markerId: string) =>
  selectedMarkerIds.includes(markerId) && selectedMarkerIds.length > 1 ? selectedMarkerIds : [markerId];

const writeMarkerConditions = (updates: Record<string, MarkerCondition[]>) => {
  const client = session.client;
  if (!client) return;
  for (const [id, conditions] of Object.entries(updates)) {
    const m = stageProps.marker.markers.find((x) => x.id === id);
    if (m) m.conditions = conditions; // instant local feedback (same pattern as onPinToggle)
  }
  client.stopCapturing();
  client.write.transaction(() => {
    for (const [id, conditions] of Object.entries(updates)) client.write.setMarkerFields(selectedSceneId, id, { conditions });
  });
  client.stopCapturing();
};

const toggleConditionOn = (targetIds: string[], condition: MarkerCondition) => {
  const markers = targetIds.map((id) => stageProps.marker.markers.find((m) => m.id === id)).filter(Boolean);
  const allHave = markers.every((m) => m!.conditions?.some((c) => c.id === condition.id));
  writeMarkerConditions(Object.fromEntries(markers.map((m) => {
    const rest = (m!.conditions ?? []).filter((c) => c.id !== condition.id);
    return [m!.id, sortConditions(allHave ? rest : [...rest, condition])];
  })));
};
```
Plus `setConditionValue(targetIds, id, value)` (exhaustion; `0` removes) and `clearConditions(targetIds)`.
Strip the auto-added `bloodied` before writing if it isn't in the stored row (read the stored list from
`session.client.scene(selectedSceneId)` rows, not from stageProps, when computing the new array).

### 6. `ConditionPicker.svelte` (apps/web, GameSession)

Props: `active: MarkerCondition[]` (union for multi-select; a chip is "active" when **all** targets have it, "mixed" when some),
`mixed: Set<string>`, `customSuggestions: MarkerCondition[]` (unique custom conditions found on other tokens in the scene),
`onToggle(c: MarkerCondition)`, `onSetValue(id, value)`, `onToggleDmOnly(id)`, `onClear()`.

Layout:
```
Conditions                                   [Clear]
[Bl][Ch][De][Fr][Gr][In][Iv][Pa][Pe][Po][Pr][Re][St][Un]   ← chips: swatch dot + label, wrap
Exhaustion  [−] 2 [+]
Combat
[Concentrating][Bloodied][Blessed][Baned][Hasted][Slowed][Dodging][Hidden][Raging][Marked][Burning][Flying][Dead]
Custom
[Hexed ×]  [+ name______][● color][Add]
```
- Chip = `<button class="conditionPicker__chip" aria-pressed={isActive}>` with `conditionPicker__chip--active`
  (background = condition colour at 25% via `color-mix(in srgb, <color> 25%, transparent)`, border = colour) and
  `conditionPicker__chip--mixed` (dashed border). Chip `title` = description. Chips are clearly buttons: border
  `var(--borderThin)`, `cursor: pointer`, hover `background: var(--menuItemHover)`.
- Each active chip shows a tiny eye-off toggle on hover (`IconEyeOff`, 12px) → `onToggleDmOnly`; GM-only chips render with
  an eye-off icon permanently and italic label.
- Custom row: `Input` (max 24 chars) + 8 preset colour swatches (radio) + "Add" `Button size="sm"`; Enter submits.
- BEM: `conditionPicker`, `__header`, `__group`, `__groupTitle`, `__chips`, `__chip`, `__chip--active`, `__chip--mixed`,
  `__chip--dmOnly`, `__swatch`, `__exhaustion`, `__custom`, `__customColor`.

### 7. `TokenContextPanel.svelte` (apps/web, GameSession)

Replaces the flat marker `ContextMenu` on right-click (keep `markerContextMenuItems` data for the action rows).
- Positioned at the click point with `@floating-ui/dom` (`computePosition` + `flip` + `shift`, `strategy: 'fixed'`), portal to `body`,
  `z-index` above the stage, closes on outside pointerdown, `Escape`, scroll-wheel on stage, or after a destructive action.
- Content: header "Goblin" or "4 tokens", then `<ConditionPicker>`, then a divider and the existing actions as compact rows
  (Visibility ▸ radio row, Pin tooltip toggle, Show as handout, Save to library, Delete — danger).
- INIT adds a "Combat" action row above Delete: **Start combat (N)** / **Add to combat (N)** / **Remove from combat**
  (props `combatState: 'none' | 'running'`, `targetsInCombat: number`, `onCombatAction`). See `spec/initiative-tracker.md`.
- Width 22rem, max-height 70vh, internal scroll. Uses `var(--bg)`, `var(--borderThin)`, `var(--shadow-2)`, `var(--radius-2)`.
- BEM: `tokenContextPanel`, `__header`, `__title`, `__body`, `__actions`, `__action`, `__action--danger`.
- In `+page.svelte` `onMarkerContextMenu`: keep the selection if the clicked token is already selected; otherwise select it
  alone (`setSelection([id])`); open the panel with `targets = conditionTargets(id)`.
- Touch GMs use the MarkerManager section (right-click handler returns early for touch today — keep that).

### 8. MarkerManager

- Edit view: new section "Conditions" (between size and notes) rendering `<ConditionPicker>` inline (no popover), wired to the
  same writer via a new prop `onConditionsChange(markerIds: string[], update: (list) => list)` or the specific callbacks above.
- List rows: up to 4 coloured dots `markerManager__listConditions` + "+N".

## Testing

- Unit: `markerConditions.test.ts` (stable order, `conditionsKey`, custom fallback, toggle).
- `docSchema.test.ts`: multi-token conditions write is one undo step.
- Manual: right-click a token → toggle Stunned + Prone → pips appear on GM and player view; GM-only Hidden doesn't show on
  player view; select 3 tokens, right-click one → toggling applies to all 3; tooltip shows descriptions; drag a token with
  conditions → no badge redraw per frame (F9 overlay: texture count stable).

## Edge cases

- Old rows without the column value → `[]`.
- Bloodied auto + manual both present → render once.
- Pinned tooltip on a player view shows non-dmOnly conditions only.
