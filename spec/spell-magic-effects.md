# Spell magic effects

## Problem statement

Players and the GM can draw AoE templates with an animated effect, but casting a D&D spell means picking a shape,
typing a size, choosing an effect and placing it by hand, and nothing on the table shows the moment of casting.
Summons (Spiritual Weapon, Find Steed, Find Familiar…) have no support at all: someone has to create a token and
find artwork mid-combat.

We want a **spell wheel**: pick a spell from a radial menu, aim it with the correct preset area, and watch a short
cinematic cast animation on every screen (TV and GM editor), after which the right lingering area or summoned
token stays on the map. Rules differ between the 2014 and 2024 rules, so each game session picks a **ruleset**
which becomes a shared, reusable concept for later ruleset-dependent behaviour.

## Decisions (agreed with the user)

| Topic            | Decision                                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| After an instant | A normal AoE template stays, labelled with the spell, and fades out after ~60 s (or can be deleted as usual)         |
| Lingering spells | Template stays until removed                                                                                         |
| Summon artwork   | Built-in glowing token icons shipped with the app (asset-library picking is a later follow-up, out of scope)         |
| GM UI            | The same `RadialMenu` spell wheel in the editor (opened from a toolbar button / shortcut, see "Editor")              |
| Origin           | From the caster token when one is chosen (token menu / selected token); otherwise a free point                       |
| Spells           | Instant blasts, lingering zones, token-attached auras, summons (lists below)                                         |
| Rules            | Both 2014 and 2024; chosen per **game session** at creation, changeable in game settings; a shared `Ruleset` concept |
| Permissions      | Anyone (TV + GM) casts from the full catalog; a "Recent" ring for reuse; no per-character lists                      |
| Animation        | Cinematic but short: 1–2.5 s, travel/charge → impact → settles into the lingering template; reduced on lower tiers   |

## Proposed solution — overview

```
RadialMenu (TV general/token menu, editor wheel)
   └─ "Cast spell" ─► category ring ─► spell (─► variant ring for summons, e.g. weapon shape)
                                         │
                                         ▼
                 AoeTemplateLayer "spell aiming" (preset shape/size locked, effect preview, caster origin)
                                         │  onSpellAimed(placement)
                                         ▼
          apps/web spellCasting.ts (pure) ─► CastEvent ─► presence (awareness) ─► every client on the scene
                                         │                                        └► <Stage spellCasts> ─► SpellCastLayer (FX)
                                         └─► doc writes: AoE template row (spellId, expiresAt, anchorMarkerId)
                                                         and/or summon marker row(s) (written when the FX lands)
```

Three independent pieces:

1. **Catalog + ruleset** (data): `Ruleset`, `SPELLS`, per-ruleset presets. THREE-free, unit-tested, exported from
   `@tableslayer/stage` like `markerConditions.ts`, so apps/web and the stage share one source.
2. **Cast FX** (rendering): a new transient `SpellCastLayer` in the stage plays one-shot animations. Casts are
   **ephemeral**: they travel through Y.js awareness (the existing `PresenceChannel`), never the doc or DB.
3. **Results** (persistent): ordinary AoE template rows and marker rows, so selection, grouping, undo, deletion,
   GM undo of TV edits, visibility and export all keep working with no new code paths.

## Data model

### Ruleset (new shared concept)

`packages/stage/src/lib/components/Stage/helpers/rulesets.ts` (THREE-free, exported from the package index):

```ts
export const RULESETS = ['dnd5e-2014', 'dnd5e-2024'] as const;
export type Ruleset = (typeof RULESETS)[number];
export const DEFAULT_RULESET: Ruleset = 'dnd5e-2024';
export const RULESET_LABELS: Record<Ruleset, string> = { 'dnd5e-2014': 'D&D 5e (2014)', 'dnd5e-2024': 'D&D 5e (2024)' };
export const isRuleset = (value: unknown): value is Ruleset => …;
/** Resolve a value that differs per ruleset: `byRuleset({ base, 'dnd5e-2014': {...} }, ruleset)` (shallow merge) */
export const byRuleset = <T extends object>(spec: { base: T } & Partial<Record<Ruleset, Partial<T>>>, ruleset: Ruleset): T => …;
```

`byRuleset` is the generic hook future features use for ruleset-dependent behaviour.

### DB (the user generates and runs the migration — do NOT run it)

- `game_session.ruleset` — `text('ruleset', { enum: RULESETS }).notNull().default('dnd5e-2024')` (import the
  tuple from `@tableslayer/stage` or mirror it as `VALID_RULESETS` next to `VALID_AOE_SHAPES`, whichever matches the
  existing schema pattern; add a check constraint like the others).
- `aoe_template.spell_id` — `text('spell_id')`, nullable. Catalog id of the spell that created the template.
- `aoe_template.expires_at` — `integer('expires_at', { mode: 'timestamp' })`, nullable. **Unix seconds** (D-5).
- `aoe_template.anchor_marker_id` already exists ("reserved for token-anchored emanations") — now used.

Markers need no new columns: a summon is a normal marker row (`title` = "Spiritual weapon", `label` = short label,
`imageLocation` = built-in icon URL, `visibility` = player-visible).

### Realtime doc / wire

- `AoeTemplateRow` gains `spellId?: string | null` and `expiresAt?: number | null` (Unix seconds, like `createdAt`).
  Optional fields, so old docs still parse. Follow the existing path for a new row field end to end: `types.ts`,
  `fromDb.ts`, `wire.ts`, PartyKit persistence back to the DB, `buildRenderProps.ts`, export/import, demo data, and
  tests in `docSchema.test.ts` / `wire.test.ts`. Read the `web-data-patterns` skill first; check whether
  `DOC_SCHEMA_VERSION` must bump (it should not for optional fields — verify, and say why in the PR).
- **Ruleset reaches clients** two ways: server loads (`[party]/[gameSession]/+layout.server.ts` already loads the
  game session; the play page loads `activeGameSession`), and live — add `ruleset` to the game session doc's `meta`
  map (or a small `session` map, whichever matches the hydration code) so a GM change shows up on the TV without a
  reload. The DB column is the source of truth; `updateGameSession` writes it and the editor mirrors it into the doc.

### Stage types

`AoeTemplate` (stage) gains:

```ts
/** Marker id this template follows (auras like Spirit Guardians); position is then the marker's */
anchorMarkerId?: string | null;
/** Epoch ms; the template fades out over the last FADE_MS and is hidden after it */
expiresAt?: number | null;
```

`AoeEffect` gets new values **appended** (persisted ints — never renumber):
`Thunder, Silence, HypnoticPattern, FaerieFire, Sleep, SpiritGuardians, Moonbeam, CloudOfDaggers, HungerOfHadar,
Entangle, SpikeGrowth`, each with a label, default colour and swatch (`AOE_EFFECT_DEFAULT_COLORS`,
`AOE_EFFECT_LABELS`, `aoeEffectSwatches.ts`, the effect lists in `playMenus.ts` / editor controls, docs playground).
Each new effect is a new `#if EFFECT_TYPE == n` block in `AoeTemplate.frag`: continuous `t` only (no
`floor(t*n)`), literal loop bounds, cheap. Existing effects are reused where they fit (Web, Grease, FogCloud,
Darkness, SleetStorm, PoisonGas for Stinking Cloud, Fire for Flaming Sphere).

## Spell catalog

`packages/stage/src/lib/components/Stage/helpers/spells.ts` (THREE-free, exported, unit-tested):

```ts
export type SpellCategory = 'blast' | 'zone-control' | 'zone-obscure' | 'zone-magic' | 'aura' | 'summon';
export type SpellCastFx = 'burst' | 'cone' | 'bolt' | 'wave' | 'zone' | 'aura' | 'summon' | 'rain';

export interface SpellArea { shape: AoeShape; size: number; width?: number } // feet, like AoeTemplate
export interface SpellSummon { variants: SpellSummonVariant[]; size: 1 | 2 | 3; count?: number }
export interface SpellSummonVariant { id: string; label: string; icon: string } // icon = built-in art id

export interface SpellPreset {
  level: number; // 0 = cantrip
  area?: SpellArea; // absent for pure summons
  effect: AoeEffect; // lingering template effect
  color: string;
  origin: 'caster' | 'point'; // caster: cones, lines, cubes, emanations start at the caster
  rangeFt: number; // shown as a range ring while aiming; 0 = self
  lingers: boolean; // false = instant: template gets expiresAt = now + INSTANT_TEMPLATE_TTL_S (60)
  anchored: boolean; // follows the caster token (Spirit Guardians)
  concentration: boolean;
  hint: string; // radial hub text, e.g. "20 ft sphere · 8d6 fire · Dex save"
  cast: { fx: SpellCastFx; durationMs: number; palette: [string, string]; projectile?: boolean; variant?: number };
  summon?: SpellSummon;
}

export interface SpellDefinition {
  id: string; // stable, persisted in aoe_template.spell_id — never rename
  name: string; // sentence case UI label
  category: SpellCategory;
  rulesets: readonly Ruleset[]; // which rulesets list it
  preset: { base: SpellPreset } & Partial<Record<Ruleset, Partial<SpellPreset>>>;
}

export const SPELLS: Record<string, SpellDefinition>;
export const SPELL_CATEGORIES: { id: SpellCategory; label: string; hint: string }[];
export const spellsInCategory = (category: SpellCategory, ruleset: Ruleset): SpellDefinition[];
export const resolveSpell = (id: string, ruleset: Ruleset): (SpellDefinition & { resolved: SpellPreset }) | null;
```

Every category ring holds ≤ 8 spells (the radial rule). Values below are the first version; the implementer must
double-check each against the 2014 and 2024 Player's Handbooks and fix any mismatch through the ruleset override,
noting it in the PR.

### Instant blasts (`blast`, `lingers: false`)

| Spell          | Area                        | Origin | Effect    | Cast FX                                                 |
| -------------- | --------------------------- | ------ | --------- | ------------------------------------------------------- |
| Burning hands  | 15 ft cone                  | caster | Fire      | `cone` — a fan of flame sweeping out from the caster    |
| Thunderwave    | 15 ft cube                  | caster | Thunder   | `wave` — a pressure front pushing out from the caster   |
| Shatter        | 10 ft sphere, range 60      | point  | Thunder   | `burst` — a ringing shockwave ring, no projectile       |
| Fireball       | 20 ft sphere, range 150     | point  | Fire      | `burst` + projectile — a bead flies, then a fiery bloom |
| Lightning bolt | 100 × 5 ft line             | caster | Lightning | `bolt` — a branching arc that strikes along the line    |
| Cone of cold   | 60 ft cone                  | caster | Frost     | `cone` — a frost fan with crystalline edges             |
| Ice storm      | 20 ft radius, range 300     | point  | Frost     | `rain` — hail streaks fall, then impacts                |
| Ice knife      | 5 ft radius burst, range 60 | point  | Frost     | `burst` + projectile — a shard, then a frost burst      |
| Color spray    | 15 ft cone (check 2024)     | caster | Radiant   | `cone` — prismatic rainbow fan                          |

### Lingering zones (`lingers: true`)

- **zone-control**: Web (20 ft cube), Grease (10 ft square), Entangle (20 ft square), Spike growth (20 ft radius),
  Sleet storm (40 ft radius)
- **zone-obscure**: Fog cloud (20 ft radius), Darkness (15 ft radius), Silence (20 ft radius), Stinking cloud
  (20 ft radius), Hunger of Hadar (20 ft radius)
- **zone-magic**: Moonbeam (5 ft radius), Cloud of daggers (5 ft cube), Hypnotic pattern (30 ft cube), Faerie fire
  (20 ft cube), Sleep (2014: 20 ft radius, 2024: 5 ft radius, instant in both)

Cast FX `zone` (variant per spell): the area grows in from its centre with a spell-coloured ripple, then hands off
to the persistent `AoeEffect` (Moonbeam: a pillar descends first; Ice storm style falling motes for Sleep).

### Auras (`aura`)

- **Spirit guardians** — 15 ft emanation, `anchored: true`, effect SpiritGuardians, FX `aura` (spirits swirl out of
  the caster). Requires a caster token; without one the item is `disabled` with the hint "Long-press a token to cast
  from it". The template's `anchorMarkerId` is the caster.
- **Flaming sphere** — a summon (Fire sphere icon, size 1) **plus** a 5 ft Fire circle anchored to the summoned token,
  so dragging the sphere token moves its burning area.

### Summons (`summon`, FX `summon`)

| Spell            | Variants (built-in icons)                                        | Notes                         |
| ---------------- | ---------------------------------------------------------------- | ----------------------------- |
| Spiritual weapon | Sword, mace, hammer, spear, axe, flail                           | range 60; 2024: concentration |
| Find steed       | Warhorse, pony, elk, camel, mastiff (2024: "Otherworldly steed") | size 2 for warhorse/elk/camel |
| Find familiar    | Owl, cat, raven, bat, snake, frog, spider, hawk                  |                               |
| Mage hand        | Hand                                                             | cantrip, range 30             |
| Unseen servant   | Wisp                                                             | range 60                      |

Built-in art: `apps/web/static/spell-tokens/<icon>.svg` — clean, flat, glowing line icons on a transparent
background, tinted by the spell's palette. Keep each small (< 4 KB). If the existing token image loader
(`tokenRasterCache.loadTokenImage`) cannot decode SVG through `createImageBitmap` in every browser, add an SVG path
(decode with an `Image` element, draw onto a canvas, then `createImageBitmap(canvas)`) instead of shipping PNGs.
Summoned markers use the existing marker shape/colour so the token ring matches the palette.

## Cast events (ephemeral sync)

```ts
// packages/stage SpellCastLayer types
export interface SpellCast {
  id: string; // uuid
  spellId: string;
  fx: SpellCastFx;
  variant: number;
  palette: [string, string];
  area?: SpellArea & { angle: number };
  /** Marker-space (same space as AoeTemplate.position) */
  origin: { x: number; y: number }; // caster centre or the point
  target: { x: number; y: number }; // template origin / summon spot
  durationMs: number;
  startedAt: number; // local performance.now() on the receiving client — never a remote clock
}
```

- `PresenceChannel` gets `castSpell(cast: Omit<SpellCast, 'startedAt'> & { sceneId: string })`, which sets the local
  awareness field `spellCast`. On awareness change, each client compares the cast `id` per remote client with the
  last one it saw. When the id is new and the scene matches the scene it is showing, it appends the cast to a local
  `activeCasts` list with `startedAt = performance.now()`. The caster appends its own cast directly. Entries
  are pruned after `durationMs`. Clear the field after `durationMs` so a reconnecting peer cannot replay it. Never
  persisted.
- `activeCasts` is passed to `<Stage spellCasts={…}>` as an **interaction prop** (like `selectedMarkerIds`), and
  `Stage.svelte` copies it into the `'stage'` context. It must stay out of the `props` root, so a cast never
  invalidates effects chained to `props` (the "effects must key off prop values" gotcha).

## Rendering — `SpellCastLayer`

`packages/stage/src/lib/components/Stage/components/SpellCastLayer/` mounted with the anchored layers (inside
`mapAnchor` in MapDefined), `SceneLayerOrder.SpellCast = 36` (above AoE 35.5, below markers), `SceneLayer.Main`
so bloom applies when the composer is on (never change the composer because of a cast).

- One `T.Mesh` per active cast: a single quad sized to the bounds of origin ∪ target ∪ area (use
  `helpers/aoeTemplates.ts` bounds and feet↔layer conversion). Shared quad geometry.
- `shaders/SpellCast.frag` (+ a trivial vert): **the archetype is a compile-time `SPELL_FX` define** (one program per
  `SpellCastFx`, ≤ 8 programs). `variant` is a uniform-free define too only if it changes code paths, otherwise a
  uniform. Uniforms: `uProgress` 0..1, `uTime`, `uOrigin`, `uTarget`, `uArea` (shape params), `uColorA/B`, `uSeed`,
  `uPerformanceTier`. Reuse the SDFs from `AoeTemplate.frag` (`#include`-style shared chunk or copied function, as the
  codebase already does). Analytic shapes + value noise only, no textures, no per-pixel loops > 8 iterations.
- Materials link via `renderer.compileAsync` and stay `visible = false` until ready, like `AoeTemplateMaterial`.
  Add `StageExports.spells.prewarm(fx: SpellCastFx[])` and call it when the spell ring opens, so the program is ready
  before the cast. Materials are pooled per `SPELL_FX` (create once, reuse; uniforms per mesh via
  `onBeforeRender` or cloned uniform objects — never allocate per frame). Dispose on destroy.
- Timeline per archetype (normalised `uProgress`): travel/charge `0–0.4`, impact `0.4–0.6` (bright core, HDR
  values > 1 so bloom catches them), settle `0.6–1` (fades while the persistent template, written at cast start or
  at impact, shows underneath). Summon: an orb leaves the caster on a spiral ("twirl") to the target, then a
  conjuration ring flashes and the token appears (the marker row is written at impact time by the casting client).
- `framePacer.markActive()` from the layer's task while any cast is active.
- Tiers: **high** full FX + ≤ 6 px, 180 ms camera shake on blast impacts (implemented as a temporary camera offset
  inside the render task and restored after, never by touching scene/map offset props); **medium** no shake, no
  projectile trail; **low** duration × 0.6, travel phase skipped, impact + fade only.
- `prefers-reduced-motion`: the consumer passes a lower tier-like flag; stage skips shake and travel.

### Template additions in `AoeTemplateLayer`

- **Anchored**: when `anchorMarkerId` is set and the marker is in `props.marker.markers`, render (and hit-test) the
  template at the marker's **live** position (including mid-drag). The consumer updates the row's stored
  position on `onMarkersMoveEnd` so it persists correctly. Anchored templates move with their token and are not
  draggable by their own origin handle.
- **Expiry fade**: templates with `expiresAt` fade opacity over the last 5 s and are hidden after it. Clients
  with write access (the editor and the TV) run a sweep every 5 s that deletes expired templates in the active
  scene. The deletes are idempotent and must not create GM undo steps: use the same untracked origin that remote
  cleanup uses. If the doc layer has none, add one.
- **Spell aiming mode**: `AoeToolSettings` gains an optional `spell?: { spellId; area; effect; color; origin?;
rangeFt; lockSize: true }`. While set, the draft uses the preset shape and size (no resize), shows the effect
  preview at draft opacity, and (when `origin` is given) a dashed range ring from the caster.
  - `origin: 'point'` spells: the draft follows the pointer and a tap/click places it.
  - Caster-origin spells: the origin is fixed at the caster's edge and the press/drag direction sets the angle.
  - Spirit Guardians and other self-centred spells cast at once on selection, with no aiming.
  - Completion fires a new `onSpellAimed({ spellId, position, angle })` callback instead of `onAoeTemplateAdded`.
    Escape, a touch tap on the hub, or a layer change cancels it.
  - Snap to grid follows the tool's `snapToGrid`.

## App flow (apps/web)

- `apps/web/src/lib/utils/spellCasting.ts` (pure, tested) holds:
  - `buildSpellCast(spell, placement, casterMarker?)` → `SpellCast`.
  - `buildSpellTemplate(spell, placement, casterMarker?, now)` → `AoeTemplateRow`, with `label` = spell name,
    `spellId`, and `expiresAt` for instants. When there is a caster, `groupId` is null and `anchorMarkerId` is
    set for auras.
  - `buildSummonMarkers(spell, variant, placement, caster?)` → `MarkerRow[]`. Title "Spiritual weapon", label
    from the caster's label if any, placed at the target snapped to the grid, player-visible.
  - `castSpell(client, …)` orchestrates the broadcast, the doc writes (template immediately, summons at impact via
    `setTimeout(durationMs * 0.5)`) and `recentSpells`.
- `apps/web/src/lib/utils/spellMenus.ts` (pure, tested) holds `spellMenuItem(state)`, a "Cast spell" item with
  rings for Recent (≤ 8, local per device, `localStorage` wrapped in try/catch) plus the six categories. Each spell
  item shows `label` = name and `hint` = preset hint for the current ruleset, plus an accent colour from the palette.
  Summons open a variant ring. Spell items are leaves that start aiming. Both `playMenus.ts` and the editor use it.
- **TV** (`play/`):
  - `generalMenu` gets "Cast spell" with no caster. `tokenMenu` gets it with the pressed token as caster
    (single token only).
  - `usePlayTools` holds the aiming state, wires `onSpellAimed`, and passes `spellCasts` to the Stage.
  - The ruleset comes from `activeGameSession.ruleset` plus the doc mirror.
- **Editor**:
  - Add a "Spells" toolbar button in `SceneControls`, plus a keyboard shortcut. Pick a free key from
    `Shortcuts.svelte` and register it there.
  - It opens the stage-package `RadialMenu` at the button, or at the last cursor position when the shortcut is
    used. The caster is the single selected token, if there is one.
  - Right-click is **not** used: it already toggles fog rooms and opens AoE context panels.
  - Editor casts go through the same `castSpell`. GM-cast templates use the tool's current visibility.
- **Ruleset UI**:
  - Add a ruleset select to the game session creation form (`GameSessionCard` "New game session" flow), defaulting
    to 2024.
  - Add the same select to the game session settings wherever the name is edited (via `updateGameSession` and a
    `mutationFactory` mutation, C-5/C-6).
  - Sentence case labels throughout.

## Performance budget

- Idle cost of the feature with no casts: zero (no meshes, no task work: `useTask` with `running: () => casts.length > 0`).
- At most 8 cast programs ever linked, all prewarmed when a spell ring opens. No program links during a cast.
- A cast allocates nothing per frame. Concurrent casts are capped at 6 (oldest dropped).
- New AoE effects follow the existing `EFFECT_TYPE` define rule, so each template program contains only its effect.
- Verify with F9 (`Programs` stays flat across repeated casts; frame time on the docs playground with 6 casts).

## Files

Stage (`packages/stage/src/lib/components/Stage/`):

- new `helpers/rulesets.ts`, `helpers/spells.ts` (+ `.test.ts` each)
- new `components/SpellCastLayer/` (`SpellCastLayer.svelte`, `SpellCastMesh.svelte`, `SpellCastMaterial.ts`, `types.ts`)
- new `shaders/SpellCast.frag`, `shaders/SpellCast.vert`
- edit `shaders/AoeTemplate.frag` (new effects), `AoeTemplateLayer/*` (anchor, expiry fade, spell aiming), `types.ts`
- edit `Scene/Scene.svelte`, `Scene/types.ts` (order), `Stage/Stage.svelte`, `Stage/types.ts` (interaction prop,
  callback, exports), package `index.ts`, `helpers/aoeTemplates.ts` (+ tests) for anchored position/bounds,
  `helpers/tokenRasterCache.ts` if SVG decoding needs it

Web (`apps/web/`):

- `src/lib/db/app/schema.ts` (3 columns), realtime `types.ts`, `fromDb.ts`, `wire.ts`, `docSchema.ts`,
  `buildRenderProps.ts`, `presence.svelte.ts`, PartyKit persistence, export/import, demo data
- new `src/lib/utils/spellCasting.ts`, `spellMenus.ts` (+ tests), `static/spell-tokens/*.svg`
- `routes/(app)/[party]/play/` (`playMenus.ts`, `usePlayTools.svelte.ts`, `+page@.svelte`)
- editor: `GameSession/SceneControls.svelte`, `Shortcuts.svelte`, the editor page that hosts `<Stage>`
- game session create/update forms, `createGameSession`/`updateGameSession` endpoints, `lib/queries`

Docs: `apps/docs/.../stage/+page.svelte` + `defaults.ts`: a tweakpane "Spells" folder with spell select, "Cast at
centre" button and tier override, to exercise `spellCasts` (required for new stage props).

Docs/skills (SK-1): `.claude/skills/stage-rendering/SKILL.md` (new layer, interaction prop, aiming, anchored/expiry),
`web-data-patterns` skill if the doc row/field process changes, `docs/tv-radial-menu-architecture.md` (spell ring).

`packages/ui` should not need changes. If it does, the user generates a changeset (CS-1..4).

## Testing strategy

- Unit tests:
  - `rulesets` (`byRuleset` merge).
  - `spells`: every spell resolves in each listed ruleset, has a valid area/effect/fx, each category has ≤ 8
    spells, and ids are unique.
  - `aoeTemplates`: anchored position and expiry opacity.
  - `spellCasting` builders: instant → expiresAt, aura → anchor, summons → marker rows and grid snap.
  - `spellMenus`: disabled Spirit Guardians without a caster, recent ring.
  - Docs/wire round-trip of `spellId`/`expiresAt`/`ruleset`.
- `pnpm run check`, `pnpm run format-check`, and the stage + web test suites pass.
- Manual (the user): the docs playground casts each FX on each tier; then the TV and the editor side by side on one
  scene. Cast from the TV and check the GM sees the animation, the template and the summon. Change the ruleset
  in settings and check the hints update on the TV live.

## Edge cases

- Casts arriving for another scene, or while paused/asleep: ignored. Casts arriving while the tab is hidden are
  dropped when `startedAt + durationMs` has already passed on return.
- The caster token is deleted mid-aim: aiming cancels. The anchor token is deleted: the template falls back to
  its stored position (the GM can delete it).
- The expiry sweep runs on several clients at once: deletes are idempotent. GM undo must not resurrect an
  expired instant template through the TV's sweep. If untracked deletes can't be made safe, only the editor
  sweeps, and the TV sweeps only when no editor is present (check presence).
- MapDefined vs FillSpace coordinates: all cast and template positions are marker-space. Reuse the existing
  conversion helpers; never invent a new space.
- Rooms on old docs without the new fields: everything optional, with defaults (`expiresAt` null, ruleset 2024).
- Low-end TV GPUs: the low tier path, plus the 6-cast cap.
- Spell ids are persisted: append-only, never rename. Removing a spell must keep `resolveSpell` returning null
  gracefully. The template still renders from its own row data.

## Implementation phases (for the implementing agent)

1. **Foundations**: rulesets + spells catalog + tests; DB columns (schema only — **stop and ask the user to
   generate/run the migration**); row fields end to end; ruleset UI and live mirror; new `AoeEffect` values +
   shaders; anchored templates; expiry fade + sweep.
2. **Cast FX**: `SpellCastLayer`, shaders, prewarm, tiers, presence sync, docs playground panel.
3. **Casting UX**: spell aiming mode, `spellCasting.ts`/`spellMenus.ts`, TV menus, summons + SVG art, editor wheel
   and shortcut, Recent ring; skill/doc updates.

---

# Phase 4 — attached effects, concentration, targeted spells, lazy FX

Requested after reviewing phases 1–3. Decisions agreed with the user (2026-11-01):

- Lasting self, touch and targeted spells draw an **attached effect** on the bound token. It is **not** a marker:
  it reuses the anchored `aoe_template` row (`anchorMarkerId` = bound token, `spellId` = spell), so it moves with
  the token, isn't separately selectable on the stage, and is removable from the existing AoE list/panels.
- **Concentration**: the caster token shows an animated "concentrating" outline. Casting a new concentration spell
  ends the caster's previous one (5e rule) with a short toast. "End concentration" is in the caster's TV token
  menu and in the editor token menu/panel. Deleting the caster (or removing it from the scene) also ends it.
  Tapping the outline itself does nothing.
- **Targeted spells** (new category `target`, label "Targeted"): Hold person, Hold monster (chains); Bless, Bane,
  Shield of faith (motes / haze / ward); Hex, Hunter's mark (sigil); Banishment (rift), Charm person, Command
  (charm glyph). **Visual only**: no condition is added to the token.
- **Lazy FX**: no spell program is compiled, and no spell layer code is loaded, until it is needed.

## Data model

- New nullable JSON column `marker.concentration` (the user generates/runs ONE migration that also covers the
  phase 1 columns — do not run it):
  ```ts
  interface MarkerConcentration {
    spellId: string;
    /** Unix seconds */
    startedAt: number;
    /** Rows that end with the concentration */
    templateIds: string[];
    markerIds: string[];
  }
  ```
  End to end like `conditions`: schema, `MarkerRow.concentration?`, `fromDb`, `wire`, `docSchema`, PartyKit
  persistence, export/import, `buildSceneProps` → stage `Marker.concentrating?: { color: string }`.
- Concentration is **active** when the field is set and at least one listed id still exists (derived, no write
  needed). The existing 5 s sweep (`templateExpiry.ts`, same untracked origin) also: clears `concentration` when
  nothing listed remains; deletes attached-effect rows (any template with `spellId` whose preset has `tokenFx`)
  whose `anchorMarkerId` no longer exists; ends the concentration of casters that no longer exist (deletes the
  listed rows). Idempotent across clients.
- `endConcentration(client, casterId)` in `spellCasting.ts`: deletes listed templates + markers and clears the
  field in one doc transaction (normal GM-tracked origin when the GM triggers it, so undo restores it).
- Casts with no caster token track no concentration; their rows persist until removed (or expire, for instants).

## Catalog (`helpers/spells.ts`)

- `SpellPreset` gains `tokenFx?: TokenFx`, `targets?: number` (max targets per cast, default 1) and
  `aim?: 'target'`. `area` stays optional; presets with `tokenFx` and no `area` are effect-only rows (stored with
  `shape` circle, `size` = bound token footprint in feet, `effect` None).
- `TokenFx = 'orbit' | 'glow' | 'shimmer' | 'ghosts' | 'ward' | 'chains' | 'motes' | 'haze' | 'sigil' | 'rift' |
'charm'` plus the internal `'concentration'` ring. Persisted ids stay append-only.
- New/changed spells (both rulesets unless noted; fill 2014/2024 hints from the rules):
  - Spirit guardians: keeps its 15 ft anchored area (fill opacity lowered so it reads as a boundary) **plus**
    `tokenFx: 'orbit'` — glowing spirits circling the caster inside the radius.
  - Light (cantrip, touch, 1 h, not concentration): `glow`, 20 ft bright + 20 ft dim soft light. Visual only — it
    does not change fog/vision (note in hint-free docs).
  - Blur (L2 self, conc): `shimmer`. Mirror image (L2 self, not conc): `ghosts` (3 drifting afterimages).
  - Protection from evil and good (L1 touch, conc): `ward`.
  - Targeted (`aim: 'target'`): Hold person L2 60 ft conc `chains`; Hold monster L5 90 ft conc `chains`;
    Bless L1 30 ft ×3 conc `motes` (gold, rising); Bane L1 30 ft ×3 conc `haze` (dark); Shield of faith L1 60 ft
    conc `ward` (blue); Hex L1 90 ft conc `sigil` (purple); Hunter's mark L1 90 ft conc `sigil` (green
    crosshair variant); Banishment L4 60 ft conc `rift`; Charm person L1 30 ft (1 h, not conc) `charm`;
    Command L1 60 ft (instant → `expiresAt` = INSTANT_TEMPLATE_TTL_S) `charm` (glyph variant).
  - Existing concentration spells (zones, Flaming sphere, 2024 Spiritual weapon) now register on the caster.
- Category caps (≤ 8 per ring) still hold; split `target` into two rings if needed (e.g. "Holds and marks",
  "Blessings and wards").

## Stage

- **`TokenEffectLayer`** (`components/TokenEffectLayer/`, `shaders/TokenEffect.frag/.vert`):
  - Props slice `tokenEffects: { id; markerId; fx: TokenFx; color: string; radius?: number (feet, orbit/glow);
variant?: number; startedAt: number }[]` (the consumer derives it from template rows + concentrating markers).
  - Positions follow the bound token **live, including mid-drag** — reuse the same live-position source the
    anchored AoE templates already use (`AoeTemplateLayer` "Live token positions"). Effects of hidden or missing
    tokens are not drawn. Size follows the token footprint (and `radius` for orbit/glow).
  - **One `InstancedMesh` per `TokenFx` kind present**, one shared quad, per-instance attributes (centre, size,
    color, seed, startedAt, variant) → one draw call per kind. Program per kind via a compile-time `TOKEN_FX`
    define (rule from the skill: never a uniform switch); `compileAsync` + `visible = false` until linked.
  - Effects are ambient loops: they **do not** call `framePacer.markActive()`, so idle pacing still applies.
    Low tier: half the particles/sigil detail and `uTime` quantised to 15 fps; `prefers-reduced-motion` → static
    pose. Render order: just under markers for `glow`/`orbit`/`haze`/`concentration`, just above markers for
    `chains`/`sigil`/`charm`/`rift`/`ward` (add `SceneLayerOrder` entries; keep the enum sorted).
  - Shaders: analytic SDF + value noise only, literal loop bounds ≤ 8, no textures. Chains = 2–3 crossing link
    bands wrapping the token with a slow tighten pulse and glint; concentration = thin rotating rune ring at the
    token edge in the caster's spell colour.
- **Targeted aiming**: `SpellAimSettings.mode?: 'area' | 'target'`. In `target` mode the stage draws the range ring,
  highlights the token under the pointer when it is in range (reuse the drop-target highlight), and a click/tap
  on a token fires `Callbacks.onSpellTargeted({ spellId, markerId })`. Multi-target spells stay in aiming mode
  until `targets` tokens are picked, Esc/hub tap/right-click; each pick commits immediately and all picks share
  one concentration entry. A tap on empty map does nothing.
- **New cast FX `'beam'`** (SPELL_FX 8): a short streak/ribbon from caster to target ending in a bloom on the
  token (no caster → bloom only). Used by targeted and touch spells.

## Lazy loading and performance

- Remove `prewarm(SPELL_FX_LIST)` on ring/editor-wheel open. Instead:
  - Opening a **category** ring prewarms only the FX archetypes (cast + token fx) used by that ring's spells; the
    Recent ring prewarms its spells' FX. Highlighting a spell (touch hold / hover) prewarms just that spell.
  - A cast whose program is not linked yet waits for `compileAsync` and starts its timeline when ready (the
    `startedAt` shift is local; never block the frame loop). Same for token effects (appear when linked).
- `SpellCastLayer` and `TokenEffectLayer` are **not imported eagerly**: Scene loads each with a dynamic
  `import()` the first time it has something to draw (or is prewarmed) and keeps it mounted after. Shader source
  comes with that chunk. Must work in the packaged build (`svelte-package` output consumed by apps/web).
- Materials pooled per define and disposed with the layer; no per-frame allocation; F9 `Programs` grows by at
  most one per FX kind actually used.
- With no casts and no effects: zero meshes, no task work, no layer code loaded.

## App (apps/web)

- `spellCasting.ts`: `buildTokenEffectRow`, `buildTokenEffects(templates, markers)` (→ stage slice, includes
  concentration rings), `concentrationAfterCast`, `endConcentration`; `castSpell` handles `aim: 'target'` and
  registers concentration (ending the previous one + toast via the app's existing toast helper).
- TV `tokenMenu`: "End concentration" item when the token is concentrating (check the ring item limit).
  Editor: same action in the token context menu / marker panel.
- Self/touch spells (Light, Blur, Mirror image, Protection, Spirit guardians) with a caster bind to the caster at
  once (touch spells: target aiming within 5 ft, or the caster when chosen from its own menu — keep it simple:
  touch spells use target mode with range 5 ft).
- Docs playground: add token effects (fx select on a sample token) and the concentration ring.
- Skills/docs (SK-1): stage-rendering (TokenEffectLayer, lazy layers, target aiming), web-data-patterns (new
  marker field), `docs/tv-radial-menu-architecture.md`.

## Tests

- Catalog: every `tokenFx`/`aim` spell resolves per ruleset; `targets ≥ 1`; ring caps.
- `spellCasting`: target cast → effect row anchored to target; concentration registration replaces the previous
  one; `endConcentration` deletes exactly the listed rows; `buildTokenEffects` drops effects of missing tokens.
- Sweep: orphaned effect rows deleted; stale concentration cleared; removed caster ends its spells.
- Wire/doc round-trip of `concentration`.

## Edge cases

- Target token deleted → its effect rows swept; caster's list pruned.
- Same spell cast twice on one target → two rows are fine for different casters; the same caster recasting a
  concentration spell ends the old one first.
- Summon markers listed in a concentration (Flaming sphere) are deleted when it ends.
- Old clients without phase 4 ignore `concentration` and render effect-only rows as tiny None-effect templates —
  acceptable; all fields optional.

---

# Phase 5 — fixes, removal, labels, blast fade, fire, performance, signature FX

Requested after testing phase 4 on the TV (2026-11-02). Decisions agreed with the user:

| Topic                | Decision                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| Concentration look   | A **scalloped seal** (wax-seal rosette edge) around the token in the spell colour, with a slow glow            |
| Ending concentration | Token menu (TV radial + editor panel) has "End concentration"; must actually show up on the TV                 |
| Spell areas          | No dimensions ("15 ft cloud") on spell areas, ever. Selected spell area shows a styled name + description card |
| Instant blasts       | Full strength through the cast, then fade over **3 s**, then the row is deleted                                |
| Token-bound effects  | Removed from the token menu: a "Spell effects" entry lists each effect with remove                             |
| Summoned tokens      | Deleting/dismissing a summoned token ends its spell (its anchored area, its caster's concentration entry)      |
| Fire                 | Smooth, natural flames for the **lingering Fire area** and the **Fire drawing effect**; cheap per pixel        |
| Performance          | Animated areas and token effects must stay smooth on integrated GPUs (TV laptop)                               |
| Signature FX         | Fireball visibly flies from the caster and explodes; Hold person chains anchor to the ground beyond the token  |

## 1. Concentration seal not visible / not removable on the TV (bug)

Observed: Emric (TV) cast Moonbeam; the DB row has `marker.concentration` set, so the doc write works, but no ring was
seen and neither the token nor the area long-press offered a way to end it.

Approach: reproduce first (TV page + docs playground in headless Chromium), then fix the actual cause. Suspects to
rule in or out, in order:

1. Ring drawn under the token (`TokenEffectUnder`) and covered by the token quad / selection ring meshes.
2. The TV's `buildSceneProps` existing-row set misses the template (player-filtered rows), so the ring and
   `concentratingOn` are both derived as inactive — this would explain both symptoms at once.
3. The `TokenEffectLayer` lazy import never triggers when the only effect is `concentration`.

Then:

- Replace the `concentration` kind's ring with a **scalloped seal**: rosette SDF `r - (R + A·cos(N·θ))` with
  N ≈ 14 lobes just outside the token edge, a soft inner glow and a slow rotation; drawn **over** the token
  (moves to `OVER_MARKERS`) but only outside `|q| ≥ 0.98`, so it frames the token without covering its art.
- The token's own round border stays (no raster change), the seal reads as the new outline.
- Tests: `buildTokenEffects` with player-mode rows; `tokenMenu` shows "End concentration" for a live concentration
  built from a player-mode snapshot.

## 2. Removing spells

- **TV area menu**: for a template with a `spellId`, "Delete" reads "End <spell>" and also clears the caster's
  concentration entry when that template was its last row (the derived rule already makes it inactive; the write
  keeps the field tidy).
- **Token menu "Spell effects"** (TV radial ring + editor `TokenContextPanel`): one item per effect-only row anchored
  to the token (Bless, Hold person, Blur…) — label = spell name, hint "Remove <spell> from <token>", danger. A
  removed row that ends a concentration clears it.
- **Summoned tokens**: TV token menu gets "Dismiss <spell>" on a token that a concentration or spell lists (and on
  any token whose image is a built-in `/spell-tokens/` art). Dismiss = delete the token plus templates anchored to
  it, in one transaction. The editor's Delete key / panel delete does the same cascade for summoned tokens.
- Deleting a caster in the editor ends its concentration (already swept; make it immediate in the same
  transaction so undo restores everything as one step).
- New pure helper `spellRowsOwnedBy(snapshot, markerId)` in `spellCasting.ts` (tested) feeds all of the above.

## 3. Area labels

- `formatTemplateLabel`: templates with a spell (`label` set by a cast, plus a new optional stage field
  `AoeTemplate.spellId`) never include dimensions. Hand-drawn templates keep dimensions only on the draft
  while sizing.
- Selected spell area: a **label card** instead of plain text — canvas-drawn rounded panel, spell-colour accent bar,
  name (bold) and a one-line description from a new `SpellDefinition.description` (plain words, no numbers, e.g.
  "Silvery beam of moonlight that burns those inside"). Built once per text change (same cache rule as today).
- `buildSceneProps` passes `spellId`; the card text comes from `resolveSpellAnyRuleset`.

## 4. Instant blast fade

- `buildSpellTemplate`: instants get `expiresAt = now + cast.durationMs + INSTANT_FADE_MS` (3 s), rounded up to
  whole seconds (the column is Unix seconds).
- The fade window becomes per template: `expiryOpacity(expiresAt, now, fadeMs)` with `fadeMs = INSTANT_FADE_MS`
  for spell instants (others keep `EXPIRY_FADE_MS`). The fade starts after the cast impact so the blast is seen.
- After expiry the layer stops drawing and hit-testing at once (already), and the sweep deletes the row
  (sweep interval 5 s → 2 s, still idempotent and outside undo).
- `INSTANT_TEMPLATE_TTL_S` is removed (nothing outside the package used it).

## 5. Fire

- **AoE Fire (EFFECT_TYPE 1)**: replace the `hash12(floor(c * 4.0))` block flicker (the "pixelated" look) with a
  top-down flame model: two value-noise layers advected outward from the shape centre (flame tongues), domain
  warped once, shaped by the existing `depth`, colour from `fireRamp`, embers as soft points from one hashed
  lattice with smooth falloff. Budget: ≤ 6 `vnoise` calls per pixel on high, ≤ 3 on low.
- **Annotation Fire**: same flame model ported into the `EFFECT_TYPE == Fire` block of `AnnotationEffects.frag`,
  replacing the four-layer domain-warp stack (≈ 30 noise calls per pixel today). Keeps `uIntensity`, `uBorder`,
  `uOpacity` semantics so saved drawings look like flames still.
- No uniform-switched code; literal loop bounds; continuous `t`.

## 6. Performance on integrated GPUs

- **Ambient pacing**: animated AoE areas stop calling `framePacer.markActive()` every frame. Ambient animation
  renders at a new `AMBIENT_FRAME_RATE` per tier (high 60, medium 30, low 24); user input, drags and spell casts
  still mark active. Today one Spirit Guardians area keeps the stage at uncapped fps forever.
- **Cheaper Spirit Guardians**: effect 23 drops its per-pixel `fbm` (1–4 octaves) for one `vnoise` swirl, and
  the comet lane is computed once; orbit token fx keeps ≤ 6 spirits on high, 3 on low.
- **Audit every spell effect** (AoE 18–28, token fx 0–11, cast fx 0–8) for per-pixel cost: count noise calls,
  remove `fbm` where one octave reads the same, early-out (`discard`) outside the shape bounds before any noise.
- Verify with F9 (frame time, Programs) on the docs playground at low tier with Spirit Guardians + Moonbeam + 4
  token effects, before and after; numbers go in the PR.

## 7. Signature cast FX

- **Fireball**: a bright bead with an ember trail visibly travels caster → target (0–0.45), a white flash and
  expanding fire ball (0.45–0.65) with shockwave ring, then the 20 ft area. Without a caster the bead falls from
  above (scale-in). Cast always passes the caster centre when cast from a token (check the `length(uOrigin) > 2`
  guard against marker-space origin).
- **Hold person / Hold monster**: chains extend beyond the token to 3–4 ground anchors (stakes with glowing runes)
  at ~1.6 token radii, links taut between token and stakes, tightening pulse. Quad extent grows to fit
  (`tokenFxExtent('chains')`).
- **Every spell distinct**: each spell gets a `cast.variant` that changes something visible (colour palette,
  shape, motion) within its archetype; the list of per-spell looks goes in `spells.ts` comments-free as data.
  Priorities: Lightning bolt (branching jagged arc), Cone of cold (crystal shards), Shatter (cracking rings),
  Thunderwave (pressure cube push), Ice storm (hail), Moonbeam (descending pillar), Spirit guardians (spirits
  spiral out), summons (twirling orb + rune circle).

## Files (expected)

Stage: `shaders/TokenEffect.frag`, `shaders/AoeTemplate.frag`, `shaders/AnnotationEffects.frag`,
`shaders/SpellCast.frag`, `helpers/tokenEffects.ts`, `helpers/aoeTemplates.ts`, `helpers/spells.ts`,
`helpers/framePacing.ts`, `AoeTemplateLayer/AoeTemplateLayer.svelte`, `AoeTemplateHandles.svelte`, `types.ts`
(+ tests). Web: `utils/spellCasting.ts`, `utils/templateExpiry.ts`, `utils/buildSceneProps.ts`, `play/playMenus.ts`,
`play/usePlayTools.svelte.ts`, `GameSession/TokenContextPanel.svelte`, editor `+page.svelte` (+ tests). Docs: the
stage playground spell panel. Skills: stage-rendering (pacing, seal, label card), web-data-patterns (removal rules).
No DB change; no `packages/ui` change.

## Testing

- Unit: seal kind over markers; `spellRowsOwnedBy`; menus (End concentration, Spell effects, Dismiss); instant
  `expiresAt`; per-template fade; label without dimensions; ambient pacing.
- Visual: headless Chromium contact sheets of Fire (AoE + drawing), seal, chains, Fireball progress steps.
- Gates: `pnpm run check`, `pnpm run format-check`, stage + web tests.
- Manual (user): TV long-press on a concentrating token and on a spell area; cast Fireball from a token.

# Phase 6 — pick any number of targets, name-only ring, more targeted spells

Requested 2026-11-02. Decisions agreed with the user:

| Topic          | Decision                                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| Target picking | Every targeted spell: tap tokens to toggle them (no cap), then Enter or Cast applies the spell to all picks |
| Spell ring hub | Shows only the spell name; no area, shape, save or duration hint (the "needs a caster" hint stays)          |
| New spells     | Slow, Haste, Aid, Heroism, Invisibility, Fly, Blindness/deafness, each with its own token effect            |

## Approach

- `SpellPreset.targets` and `spellTargetCount` are gone: the cast level decides the count, the table knows it.
- `castSpell` takes `targets: TargetMarker[]` (replacing `target` + `continueConcentration`). Each target gets its
  own beam on the presence channel and its own effect row; all rows are written in one transaction (one undo step)
  and listed in a single concentration on the caster.
- Picks toggle with `toggleSpellTarget`; the stage outlines them as selected through `SpellAimSettings.pickedMarkerIds`
  → `stageContext.spellPickedMarkerIds` → `MarkerLayer`.
- `SpellAimBar` (`GameSession/SpellAimBar.svelte`) shows the prompt with Cast (once a token is picked) and Cancel, in
  the editor (`md`) and on the TV (`lg`, replacing the old aiming notice). Enter confirms on both, Esc cancels.
- The targeted spells now fill four rings under "Targeted": Holds and charms, Curses and marks, Blessings and wards,
  Enhancements (each ≤ 8 options).
- Token FX 12–17: `clock` (Slow), `streaks` (Haste), `halo` (Aid / Heroism variant 1), `veil` (Invisibility),
  `wind` (Fly), `blind` (Blindness/deafness). Cheap per pixel: vnoise only, loop counts drop on the low tier.

## Edge cases

- A picked token deleted before confirming is skipped; with no picks left Cast does nothing.
- Tapping a picked token again unpicks it.
- Casting replaces the caster's previous concentration once, not once per target.

# Phase 7 — area-picked spells (place an area, then pick the creatures in it)

Requested 2026-11-02. Decisions agreed with the user:

| Topic       | Decision                                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| Flow        | Place the area by the rules (range, shape, size), then pick creatures inside it, then Enter / Cast             |
| Spells      | "Choose" spells (nobody starts picked) and "save" spells (everyone inside starts picked, GM unticks the saves) |
| Map         | Effects only on the affected creatures; the area is never persisted (it flashes during the cast, then fades)   |
| Moving      | The placed area can be dragged until Cast; who is eligible updates live, cheaply                               |
| Inside rule | A token is inside when its drawn circle overlaps the area by more than a small tolerance (not a hairline)      |
| Cast look   | The area plays the spell's cast animation once, then each affected token fades in its effect; no beams         |

## Spells

| Spell            | Pick   | Area (ruleset)                        | Range | Conc.             | Token FX (new kind) | Category     |
| ---------------- | ------ | ------------------------------------- | ----- | ----------------- | ------------------- | ------------ |
| Slow             | choose | 40 ft cube                            | 120   | yes               | `clock` (existing)  | target-hold  |
| Calm emotions    | choose | 20 ft sphere                          | 60    | yes               | `calm`              | target-hold  |
| Mass cure wounds | choose | 30 ft sphere                          | 60    | no, instant       | `heal`              | target-boon  |
| Hypnotic pattern | saves  | 30 ft cube                            | 120   | yes               | `trance`            | zone-magic   |
| Faerie fire      | saves  | 20 ft cube                            | 60    | yes               | `outline`           | zone-magic   |
| Fear             | saves  | 30 ft cone from the caster            | self  | yes               | `dread`             | target-curse |
| Sleep            | saves  | 2014: 20 ft sphere; 2024: 5 ft sphere | 90/60 | 2014 no, 2024 yes | `slumber`           | zone-magic   |

## Approach

Stage (`packages/stage`):

- `SpellAimSettings.mode: 'area-targets'`, with `placement?: { position, angle }` (consumer-owned, so the placed area
  is drawn from props), `pickedMarkerIds`, and `eligibleMarkerIds`-free design: the stage computes eligibility itself.
- Before placement the AoE layer aims exactly like an area spell (point or direction, range ring, snapping). The
  commit fires `onSpellAreaTargets({ spellId, placement, markerIds })` instead of `onSpellAimed`.
- With `placement` set, the layer draws the placed draft and keeps the inside set as a `$derived` of placement +
  marker positions/sizes + viewer mode. It fires `onSpellAreaTargets` again only when the placement or the id set
  changes (compare, never per frame). Tokens moved by anyone update the set the same way.
- Inside test: `markersInSpellArea` in `helpers/spellTargets.ts`, pure and tested. Per token: bounding-box early out,
  then `templateSdf` of the token centre in template-local feet `< tokenRadiusFt - AREA_OVERLAP_TOLERANCE_FT`
  (≈ 0.5 ft; token radius = drawn circle, 90 % footprint). One pass, no per-call allocations beyond the result.
  Only tokens this viewer can see.
- Gestures while placed: press + release without crossing the drag threshold on an inside token → `onSpellTargeted`
  (toggle). Press + drag (anywhere) moves the area: point aim keeps the grab offset and snaps like placement;
  direction aim with a fixed origin re-aims the angle. Each move fires `onSpellAreaTargets` (deduped). Right-click /
  `onSpellAimCancelled` as today.
- Highlight: inside tokens outlined like a hover/drop target (`spellEligibleMarkerIds` in the stage context), picked
  ones as selected (`spellPickedMarkerIds`, existing).

Web (`apps/web`):

- Preset field `areaPick: 'choose' | 'saves'` on the 7 spells; `spellAimMode` returns `'area-targets'` for them and
  `buildSpellAim` builds the matching settings (with `placement` and `pickedMarkerIds` from screen state).
- Aim state on both screens gains `placement` and `inside: string[]`; `toggled: string[]` replaces `picked` for these
  spells. Picks are derived by a pure helper: choose → `toggled ∩ inside`; saves → `inside − toggled`. So moving the
  area away and back never loses the GM's choices.
- `castSpell` with `targets` and `areaPlacement`: one presence cast of the spell's own area fx at the placement (no
  beams), then one effect row per target in one transaction, one concentration, one undo step. Instant spells
  (Mass cure wounds) use the existing instant expiry. No area row is written.
- `SpellAimBar` prompts: "Place Slow" → "Slow: 2 of 4 creatures · drag to move"; Cast shows once something is picked.
- Old area rows of Hypnotic pattern / Faerie fire / Sleep already in documents must keep rendering as areas
  (an area row with no `anchorMarkerId` is never treated as an effect-only row).

## Edge cases

- Area placed over nobody: bar stays, Cast hidden, the area can be dragged or the cast cancelled.
- A picked token leaves the area (dragged by someone, or the area moved): it drops out of the picks; it comes back
  picked (saves) or chosen (choose) if it re-enters.
- Tokens deleted mid-pick are skipped; a hidden token is never eligible on the TV.
- The caster inside a save spell's area starts picked (rules); the GM unticks it.
- Out-of-range placement is refused like any aimed area.
