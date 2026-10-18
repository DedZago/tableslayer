# Spec: AoE spell templates with animated effects

Part of `spec/dnd-combat-polish.md`. Scope tag: **AOE**.

## Problem / goal

The GM needs to drop D&D area-of-effect templates fast: toggle the tool → pick shape + effect → press at the origin, move the
mouse to size/aim (live "15 ft cone" label, snapped to 5 ft) → click to commit. Templates persist, sync to players
(with a GM-only toggle — confirmed with user), and can be selected and edited (move, resize, rotate, effect, colour, delete).
Fills are animated shaders: fire, lightning, frost, poison gas, thorns, mud, darkness, fog, web, grease, radiant, necrotic,
force, water, sleet, insect swarm, acid.

## What exists (don't reuse directly)

- `MeasurementLayer` already draws line/beam/cone/circle/square with ft labels, but rebuilds canvas + texture + geometry every
  mousemove and is never persisted. Reuse only `createTextCanvas` (`MeasurementLayer/utils/canvasDrawing.ts`) and the label maths.
- `AnnotationLayer` effects (`shaders/AnnotationEffects.frag`) depend on a mipmapped painted mask (7–12 samples/pixel) — too heavy.
  **Port palettes and ideas** (fire ramp, web strands, vines) into a new cheap SDF shader.
- `LightLayer` is the pattern for input (own `LayerInput` + invisible input quad), selection, callbacks and grid-unit sizing.
- Feet: `buildSceneProps.ts` hard-codes `worldGridUnits: 'FT', worldGridSize: 5` → 1 cell = 5 ft. Pixels per cell = `getGridCellSize(grid, display)`.
- `snapToGrid(pos, grid, display, centerOnly, localScale)` snaps square grids to the half-cell lattice (intersections + centres) = the 5e legal origins.
- `<Canvas renderMode="always">` → animated fills need no invalidation logic.

## Data model

```ts
// packages/stage/src/lib/components/Stage/components/AoeTemplateLayer/types.ts  (created in wave 0)
export enum AoeShape {
  Circle = 'circle',
  Square = 'square',
  Cone = 'cone',
  Line = 'line'
}
export enum AoeEffect {
  None = 0,
  Fire,
  Lightning,
  Frost,
  PoisonGas,
  Thorns,
  Mud,
  Darkness,
  FogCloud,
  Web,
  Grease,
  Radiant,
  Necrotic,
  Force,
  Water,
  SleetStorm,
  InsectSwarm,
  Acid
}
export interface AoeTemplate {
  id: string;
  shape: AoeShape;
  position: { x: number; y: number }; // origin (centre for circle; apex for cone; face midpoint for square/line)
  angle: number; // degrees CCW from +x, layer-local
  size: number; // ft: radius | side | length
  width: number; // ft, line only (default 5)
  effect: AoeEffect;
  color: string;
  opacity: number; // 0..1
  visibility: StageMode; // DM = GM-only, Player = visible to players
  label?: string | null; // optional spell name
}
export interface AoeToolSettings {
  shape: AoeShape;
  effect: AoeEffect;
  color: string;
  opacity: number;
  lineWidth: number;
  snapToGrid: boolean;
  snapAngle: boolean;
  visibility: StageMode;
}
export interface AoeTemplateLayerProps {
  templates: AoeTemplate[];
  selectedId: string | null;
  showLabels: boolean;
  tool: AoeToolSettings;
}
export interface AoeTemplateLayerExports {
  cancelDraft(): void;
  hasDraft(): boolean;
}
```

Local frame for every shape: origin (0,0), +x = direction.

- Circle `|p| ≤ R` · Square `x ∈ [0,s], |y| ≤ s/2` (origin on a face; angle snaps to 90°) · Line `x ∈ [0,L], |y| ≤ w/2` ·
  Cone `x ∈ [0,L], |y| ≤ x/2` (5e: width at distance = distance, 53.13°).
- Emanation (anchored to a token) is phase 2; the DB column `anchor_marker_id` is reserved now.

DB table `aoe_template` (wave 0; **migration generated/run by the user**):
`id, scene_id (fk cascade), shape text enum, position_x, position_y, angle, size (ft, >0), width (ft, >0), effect int, color,
opacity (0..1), visibility int (0..1), label, anchor_marker_id, created_at`.

Y.js: new per-scene collection `aoeTemplates` mirroring `lights` (per-field LWW). **Bump `DOC_SCHEMA_VERSION` to 3** so hydrated rooms
rehydrate with the new collection (don't lazily create the map — concurrent creation loses rows).

## Rendering

- Layer order: add `SceneLayerOrder.AoeTemplate = 35.5` (above painted effects/lights, below tokens and fog).
  Fill on `SceneLayer.Main`; outline/handles/label on `SceneLayer.Overlay` at `SceneLayerOrder.Measurement`, DM only.
- Mount `<AoeTemplateLayer>` in `Scene.svelte`'s `anchoredLayers` snippet between `LightLayer` and `MarkerLayer`.
- One mesh per template: shared module-level `PlaneGeometry(1,1)` + `ShaderMaterial`. A `T.Group` at the origin rotated by `angle`; the
  mesh is offset to the bbox centre and scaled to bbox + feather. Move/resize/rotate = transform + uniforms only.
- Effect = compile-time define `EFFECT_TYPE` (ANGLE/Windows rule from the stage skill); shape = `int` uniform. three's program cache
  shares programs: 10 fire templates = 1 program.
- Compile gate: copy `AnnotationMaterial`'s `compileAsync` + `material.visible=false` gate; module-level `Set` of compiled
  `"effect|composer"` keys so a second template of an effect appears instantly.
- Shared time: the layer owns `sharedTime = { value: 0 }`; every material's `uniforms.uTime` **is** that object; one
  `useTask((d) => (sharedTime.value += d))`. Per-template `uSeed` = hash of id.
- Label: canvas text sprite via `createTextCanvas`, rebuilt **only when the label string changes**; constant screen size
  `scale = 1 / (sceneZoom * localScale)`; counter-rotate by `sceneRotation - mapRotation`.
  Text: "20 ft radius", "15 ft cone", "10 ft cube", "30 × 5 ft line"; with label: "Fireball · 20 ft radius".
- Re-render storms: `{#each templates as t (t.id)}` keyed; in the mesh component route every field through `$derived`, update uniforms
  in one batched `$effect`; recompile only when the derived `effect` changes. Templates sorted stably (createdAt, id) because
  `reuseUnchanged` matches by index.
- Performance: early `discard` when `d > feather`; hash value noise (no simplex); fbm octaves from `uPerformanceTier` (4/3/2) with literal
  loop bounds + `break`; voronoi literal 3×3; noise in cell units (`p / 5`) so density is size/zoom independent.
- Effect picker swatches are **static CSS gradients**, never live WebGL previews (context limit).

### Shader `shaders/AoeTemplate.frag` (outline)

```glsl
precision highp float;
#ifndef EFFECT_TYPE
#define EFFECT_TYPE 0
#endif
uniform float uTime, uSeed, uSpeed, uOpacity, uSize, uWidth, uFeather;   // ft
uniform int uShape, uPerformanceTier;
uniform vec2 uQuadSize, uQuadCenter;                                       // ft, origin-local
uniform vec3 uColor;
uniform vec4 uClippingPlanes[NUM_CLIPPING_PLANES];
varying vec2 vUv; varying vec3 vWorldPosition;

float hash12(vec2 p){vec3 q=fract(p.xyx*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),u.x),mix(hash12(i+vec2(0,1)),hash12(i+1.),u.x),u.y);}
float fbm(vec2 p){int o=uPerformanceTier==0?4:(uPerformanceTier==1?3:2);float s=0.,a=.5;
  for(int i=0;i<4;i++){if(i>=o)break;s+=a*vnoise(p);p=p*2.03+17.;a*=.5;}return s;}
vec2 voronoi(vec2 p,float t){ /* literal 3x3 loop; returns (F1, F2-F1); jitter animated by t */ }
float sdBox(vec2 p,vec2 b){vec2 d=abs(p)-b;return length(max(d,0.))+min(max(d.x,d.y),0.);}
float sdTriIso(vec2 p,vec2 q){ /* iq isosceles triangle, apex at origin, base at y=q.y */ }
float sdShape(vec2 p){
  if(uShape==0) return length(p)-uSize;
  if(uShape==1) return sdBox(p-vec2(uSize*.5,0.),vec2(uSize*.5));
  if(uShape==2) return sdTriIso(vec2(p.y,p.x),vec2(.5*uSize,uSize));
  return sdBox(p-vec2(uSize*.5,0.),vec2(uSize*.5,uWidth*.5));
}
void main(){
  /* clipping-plane discard loop copied from AnnotationEffects.frag */
  vec2 p=(vUv-.5)*uQuadSize+uQuadCenter;
  float d=sdShape(p); if(d>uFeather) discard;
  float aa=fwidth(d), inside=1.-smoothstep(-aa,aa,d);
  float depth=clamp(-d/5.,0.,1.);
  float t=uTime*uSpeed+uSeed*97.; vec2 c=p/5.;
  vec4 col=effect(c,d,depth,inside,t);   // #if EFFECT_TYPE == n dispatch
  float rim=1.-smoothstep(0.,aa*1.5,abs(d)-.12);
  col.rgb=mix(col.rgb,uColor,rim*.5); col.a=max(col.a,rim*.7*inside+rim*.4);
  gl_FragColor=vec4(col.rgb,col.a*uOpacity);
}
```

Effect bodies (each in its own `#if EFFECT_TYPE == n` block; default colours in `AOE_EFFECT_DEFAULT_COLORS`):

| #   | Effect       | Recipe                                                                                                                                                                                                                                                                |
| --- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | None         | `vec4(uColor, .35*inside)` + rim                                                                                                                                                                                                                                      |
| 1   | Fire         | `n=fbm(c*1.5+vec2(0,-t*.8)+fbm(c*3.+t)*.6)`; heat `h=n*(.6+.4*depth)+.15*sin(t*9.+hash12(floor(c*4.))*6.)`; ported `getFireColor(h)` ramp (dark red→orange→yellow→white, HDR >1 for bloom); alpha `inside*smoothstep(.15,.35,h)` + outer glow `exp(-max(d,0.)*.6)*.4` |
| 2   | Lightning    | `v=voronoi(c*1.2, floor(t*12.))`; arcs `smoothstep(.06,0.,v.y)*step(.5,hash12(floor(c*1.2)+floor(t*12.)))`; deep blue base `.25*inside`; colour `mix(vec3(.2,.4,1),vec3(1.2,1.3,1.6),a)`; flicker `.7+.3*hash12(vec2(floor(t*20.)))`                                  |
| 3   | Frost        | `v=voronoi(c*2.,0.)`; facets `.6+.4*v.x`; cracks `smoothstep(.05,0.,v.y)`; sparkle `step(.985,hash12(floor(c*16.)+floor(t*3.)))`; pale cyan; thicker at rim `mix(1.,.7,depth)`                                                                                        |
| 4   | Poison gas   | `g=fbm(c*.8+vec2(t*.15,t*.07))*fbm(c*1.6-t*.1)`; green (.35,.8,.2); alpha `smoothstep(-2.5,0.,-d)*(.35+.5*g)`; feather 2.5 ft                                                                                                                                         |
| 5   | Thorns       | per cell `id=floor(c*2.)`, `q=fract(c*2.)-.5`; star spikes `smoothstep(.02,0.,r-.35*pow(abs(cos(ang*(3.+floor(hash12(id)*3.)))),8.))`; sway `ang+=.05*sin(t+hash12(id)*6.)`; brown/green over dark fbm ground                                                         |
| 6   | Mud          | `m=fbm(c*1.3)`; puddles `smoothstep(.55,.6,m)` + ripples `sin(length(fract(c)-.5)*20.-t*2.)*.05`; browns; difficult-terrain hatching `step(.9,fract((c.x+c.y)*2.))*.15`                                                                                               |
| 7   | Darkness     | near-black (.02,0,.04) alpha `.92*inside`; purple wisps `fbm(c+fbm(c*2.+t*.2))*.15`; tendrils past edge `smoothstep(1.5,0.,d)*fbm(c*3.+t*.3)`                                                                                                                         |
| 8   | Fog cloud    | grey-white fbm at two drift speeds; alpha `.75*inside*(.6+.4*fbm)`; feather 2.5 ft                                                                                                                                                                                    |
| 9   | Web          | port `webMesh` strands (`abs(fract(c*k)-.5)` lines rotated per cell); static; alpha only on strands                                                                                                                                                                   |
| 10  | Grease       | dark base + thin-film iridescence `0.5+0.5*cos(6.28*(fbm(c*2.+t*.05)*2.+vec3(0,.33,.67)))*.35`                                                                                                                                                                        |
| 11  | Radiant      | golden; rays `pow(.5+.5*sin(atan(p.y,p.x)*12.+t*1.5),6.)*(1.-depth*.3)`; motes `step(.99,hash12(floor(c*10.+vec2(0,t))))`; HDR                                                                                                                                        |
| 12  | Necrotic     | sickly green-black; veins `smoothstep(.07,0.,voronoi(c*1.5,0.).y)` pulsing `.6+.4*sin(t*2.-length(p)*.3)`                                                                                                                                                             |
| 13  | Force        | hex lattice lines in `uColor` (violet), shimmer `sin(t*3.+c.x*2.)`, strong rim                                                                                                                                                                                        |
| 14  | Water        | caustics `pow(abs(sin(c.x*3.+fbm(c+t*.2)*4.)*sin(c.y*3.+fbm(c-t*.2)*4.)),.5)`; teal                                                                                                                                                                                   |
| 15  | Sleet storm  | icy grey base `.4`; streaks `col=floor(c.x*12.)`, `s=fract(c.y*3.+t*4.+hash12(vec2(col)))`, `smoothstep(.95,1.,s)` on skewed axis `c+=c.yx*.3`                                                                                                                        |
| 16  | Insect swarm | `id=floor(c*3.)`; one orbiting dot per cell `o=.5+.3*vec2(cos(t*3.+h*6.),sin(t*4.+h*9.))`; dark brown + faint haze                                                                                                                                                    |
| 17  | Acid         | as poison gas with acid yellow-green (.7,.9,.1) and bubbling `step(.97,hash12(floor(c*6.)+floor(t*2.)))`                                                                                                                                                              |

## Interaction

- Tool active: crosshair cursor.
- **Mousedown**: hit selected template's handles → edit; else hit any template's origin handle (disc ≈ 0.35 cell) → select; else start
  a draft at the snapped origin with `props.tool` settings (go to `dragging`).
- **Mousemove**: draft `size` = `round(distFt / 5) * 5`, min 5 ft (cone/line/square: projection on direction; circle: euclidean);
  angle free for cone/line (45° snap when `snapAngle`), 90° for square. `Alt` disables snapping.
- **Mouseup**: moved ≥ 1 cell → commit (`onAoeTemplateAdded`, new uuid). Otherwise go to `aiming`: the next click commits
  (supports both click-move-click and press-drag-release).
- Edit: origin handle drag = move; end handle drag = resize + rotate (resize only for circles). Throttle `onAoeTemplateUpdated` to 50 ms + final on mouseup.
- Keys (in `stageKeyCommands.ts`): `a` toggles the AoE tool; `Shift+A` cycles shape while active; Escape cancels draft else deselects;
  Delete/Backspace deletes selected; `[` / `]` rotate selected by 15° (Shift: 45°). **No right-click cancel** (right-click toggles fog rooms).
- Touch: touchstart origin, touchmove size, touchend commits if ≥ 1 cell.
- Stretch (do last, optional): count tokens inside the draft with `templateSdf` and append "· 3 tokens" to the draft label; highlight them
  with the hover ring.

## Files and steps

### Stage (`packages/stage/src/lib/components/Stage/`)

1. `components/AoeTemplateLayer/types.ts` (wave 0) + `AOE_EFFECT_DEFAULT_COLORS`, `AOE_EFFECT_LABELS` (added by the AoE agent).
2. `helpers/aoeTemplates.ts` (THREE-free): `getTemplateLocalBounds(t, featherFt)`, `templateSdf(t, localPointFt)`,
   `worldToTemplateLocal(t, point, ftPerPx)`, `sizeFromCursor(shape, origin, cursor, ftPerPx, angleDeg, snap)`,
   `angleFromCursor(origin, cursor, shape, snapAngle)`, `formatTemplateLabel(t)`. Unit tests `aoeTemplates.test.ts`.
3. `Scene/types.ts`: `SceneLayerOrder.AoeTemplate = 35.5`; `SceneExports.aoeTemplates`.
4. `MapLayer/types.ts`: `MapLayerType.AoeTemplate`.
5. `Stage/types.ts` (wave 0): optional `aoeTemplates?: AoeTemplateLayerProps` on `StageProps`; callbacks `onAoeTemplateAdded?(t)`,
   `onAoeTemplateUpdated?(id, patch)`, `onAoeTemplateSelected?(id | null)`, `onAoeTemplateDeleted?(id)`; `StageExports.aoeTemplates`.
   `Stage.svelte` + `Scene.svelte` delegate exports with `?.`.
6. `shaders/AoeTemplate.vert` (like `default.vert`, pass `vUv`, `vWorldPosition`) and `shaders/AoeTemplate.frag`.
7. `AoeTemplateLayer/AoeTemplateMaterial.ts` — `createAoeTemplateMaterial(effect, sharedTime, clippingPlanes)`:
   `transparent: true, depthWrite: false, toneMapped: true, defines: { NUM_CLIPPING_PLANES: 4, EFFECT_TYPE }`.
8. `AoeTemplateLayer/AoeTemplateMesh.svelte` — props `template, ftToPx, sharedTime, isDraft, isSelected, performanceTier`. Never set
   `renderer.clippingPlanes = []`; use `$state.raw` for Three objects. Dispose material in `onDestroy`.
9. `AoeTemplateLayer/AoeTemplateHandles.svelte` — Overlay layer, DM only: origin disc, end disc, dashed outline for drafts, label sprite.
10. `AoeTemplateLayer/AoeTemplateLayer.svelte` — props `props, mode, isActive, grid, display (anchoredDisplay), realDisplay, sceneZoom,
localScale, sceneRotation, mapRotation`; `ftToPx = getGridCellSize(grid, display) / (grid.worldGridSize || 5)`; input like `LightLayer`;
    state machine `idle | aiming | dragging | editMove | editHandle`; filters `visibility === DM` templates out in Player mode;
    exports `cancelDraft`, `hasDraft`; clears draft when `isActive` goes false or scene changes.
11. `Scene.svelte` mount + exports; `index.ts` exports types/helpers/enums.
12. Docs playground `apps/docs/src/routes/(components)/stage/` defaults + tweakpane folder (shape, effect, colour, opacity, snap) + key.

### Web realtime (`apps/web/src/lib/`)

13. `realtime/types.ts` (wave 0): `AoeTemplateRow`; add to `SceneSnapshot`, hydration data, `ScenePart`.
14. `realtime/docSchema.ts`: collection union, `rowsOf<AoeTemplateRow>(scene, 'aoeTemplates')` sorted (createdAt, id), `createScene` loop,
    `SCENE_PARTS`; writers `upsertAoeTemplate`, `setAoeTemplateFields`, `deleteAoeTemplate`; `DOC_SCHEMA_VERSION = 3`.
15. `realtime/fromDb.ts` `aoeTemplateRowFromDb`; `realtime/wire.ts` `SceneWire` + parts filtering.
16. `partykit/gameSession.ts` `ALL_PARTS`; `routes/api/internal/persistSession/+server.ts` zod + parts enum;
    `lib/server/realtime/index.ts` snapshot load + `replaceRows(aoeTemplateTable, …)`.
17. `utils/buildSceneProps.ts` + `realtime/buildRenderProps.ts`: rows → `AoeTemplate` via `toStagePosition(positionX, positionY)` like lights;
    `aoeTemplates` prop block with local overrides for `tool` / `selectedId`.
18. `realtime/coordinateUpgrade.ts`, `utils/gridModeTransition.ts`: convert positions with lights; rotate angle (display→map `angle -= map.rotation`).
19. Scene duplicate (`SceneSelector.svelte` ≈ line 274), game-session export/import endpoints.
20. Tests: `docSchema.test.ts` (create/upsert/delete/undo), `wire.test.ts`.

### Web UI

21. `components/GameSession/AoeTemplateControls.svelte` in `SceneControls.svelte` next to measurement: tool IconButton (`IconCone2`),
    `SelectorMenu` for shape (Circle `IconCircle`, Cube `IconSquare`, Cone `IconCone2`, Line `IconRectangleVertical`) — copy
    `MeasurementControls`; effect swatch button → `Popover` with 4-column grid of 28px swatches (CSS gradients from
    `lib/utils/aoeEffectSwatches.ts`, tooltip names); GM-only toggle (`IconEyeOff`). Add to `drawingOverflowItems` for compact layout.
22. `components/GameSession/AoeTemplateManager.svelte` (like `LightManager`): list of templates (click selects), and for the selected one:
    effect swatches, colour, opacity slider, size (ft, step 5), line width, angle, players/GM-only toggle, spell name, delete.
23. `utils/stageKeyCommands.ts` + `Shortcuts.svelte` entries.
24. GM page: `'aoe'` control → `activeLayer = MapLayerType.AoeTemplate`; callbacks (`onAoeTemplateAdded` → local push + `upsertAoeTemplate` +
    select; `onAoeTemplateUpdated` → patch + `setAoeTemplateFields`; delete); `tool` + `selectedId` local state; tool defaults persisted via
    game-session preferences (`aoeTool`); side panel `{:else if activeControl === 'aoe'}<AoeTemplateManager/>`.
25. Play route: nothing beyond props — read-only render, GM-only filtered in the layer.

### Docs

26. `.claude/skills/stage-rendering/SKILL.md` (layer order, shared time, define pattern) and `docs/yjs-sync-architecture.md` (collection, v3).

## Testing

- `pnpm run check`, `pnpm run format-check`, unit tests.
- Docs playground: every shape × effect in FillSpace and MapDefined, map rotated 0/90/180/270; a 20 ft radius spans 4 cells.
- F9: programs +1 per distinct effect; draw calls +1 per template; FPS flat with ~20 templates on medium tier.
- Two browsers: create/move/delete syncs; undo works; survives reload; GM-only templates hidden on the player view.

## Risks

- Effect selection must stay a define; loop bounds literal (ANGLE).
- `DOC_SCHEMA_VERSION` bump forces open rooms to rehydrate (expected).
- `worldGridSize` hard-coded to 5; feet-based storage keeps spells correct if it becomes configurable.
