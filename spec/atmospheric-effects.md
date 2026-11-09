# Atmospheric effects 2.0

Status: approved design, implementation in progress on `feat/atmospheric-effects`.

## 1. Problem

The current weather (`WeatherLayer` + `ParticleSystem`) is 8 presets of stateless, closed-form particles
(`pos = f(age)`) rendered through a perspective camera into a display-sized render target. It has no wind,
no physics, no interaction with the map, no lighting, no events (lightning), every client runs its own
clock (TV and GM are out of phase), it draws under tokens, re-renders its target even on frames the frame
pacer skips, never calls `markAmbient()`, rebuilds geometry on every intensity change, and ignores `0`
overrides (truthiness checks).

Goal: a large catalog (45 options) of good-looking, physically-motivated atmospheric effects, mundane and
fantasy, that a GM can apply with one click, without hurting the frame rate on TV boxes.

## 2. Decisions (confirmed with the user)

| Topic        | Decision                                                                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Composition  | **3 independent slots**: Weather, Lighting, Ambience. "Quick scenes" fill all three.                                                            |
| Darkness     | Lighting darkens the map fully and tokens partially (`tokenDarkness`, default 0.6); **placed lights cut through** the darkness.                 |
| Layering     | Airborne weather draws **over tokens, under fog of war**. Ground effects live in the map material, under tokens.                                |
| Sync         | **Seeded only**: every screen derives events (lightning, gusts, meteors) from a shared seed + wall clock. No network traffic, no "strike now".  |
| Scope        | All effects in this branch, **in two phases** (engine + core effects, then the fantasy catalog).                                                |
| Ground FX    | Yes, all, with **slow accumulation** (wetness/puddles/snow build over ~1 min, dry/melt afterwards).                                             |
| Particle art | **Procedural shapes** in the shader; existing leaves/ash/snow atlases kept where they look better.                                              |
| Controls     | Editor panel + GM radial menu. **Not** the TV radial.                                                                                           |
| Flash safety | Flash brightness capped by default, per-scene "reduce flashes", shake off by default (high tier only), both off under `prefers-reduced-motion`. |
| Wind frame   | **Map space** (rotates with the map).                                                                                                           |
| Regions      | Whole-map only now; shaders must take an optional shelter mask later without rework (reserve a `#define ATMO_SHELTER` hook, unused).            |
| Legacy       | Keep `fog_*` columns + FogLayer, keep `Custom = 99` (legacy ParticleSystem path, docs only).                                                    |

## 3. Architecture

```
            ┌──────────────── Web Worker (atmosphere.worker.js) ─────────────────┐
            │ Rust→WASM weather_sim (no_std, raw extern "C")  | TS fallback same API│
            │  • stable-fluids wind/density field 64²–128², 10–30 Hz               │
            │  • accumulation map 128² (wetness, puddles, snow, scorch) at 2 Hz    │
            │  • lightning bolt geometry (branching midpoint/DBM-lite polylines)   │
            └──────── transferable ArrayBuffers (ping-pong, no SAB) ──────────────┘
                                        │
 Main thread: AtmosphereController (context 'atmosphere') owns the shared uniform object,
 deterministic clock, event schedule (pure TS), DataTextures, compose(weather, lighting, ambience)
                                        │
   ┌──────────────┬──────────────────┬──┴────────────────┬───────────────────┬──────────────┐
   Map material    AmbienceGround      AtmosphereDarkness   AirLayer            LightningLayer
   (order 10)      (order 21)          (order 37.8)         (order 38.5)        (order 38.6)
   wet, puddles,   dense fog, smoke,   multiply quad over   offscreen RT:       HDR ribbons on
   ripples, snow,  miasma, tentacle    tokens; lights cut   particles + density  Main (bloom),
   clouds, haze,   shadows, caustics   through; flash lifts  (sand, whiteout,    flash envelope
   caustics, tint, (map-anchored)                           wisps), composited
   flash, darkness                                          premultiplied
```

Fog of war (40) renders after all of these, so a lightning flash never reveals hidden areas. Grid,
measurement and other Overlay layers are untouched.

### 3.1 Why WASM only for fields

Particles stay on the GPU (stateless, field-sampled in the vertex shader). Simulating particles in WASM
would require uploading N×16 B per frame from the main thread, which costs more than the physics. WASM
owns small, branchy state: the coarse fluid field, accumulation, bolt geometry. Uploads are ≤ 64 KB at
10–30 Hz, interpolated on the GPU (`uFieldBlend` between previous and current texture).

### 3.2 Deterministic clock and events

- `atmoTime = (Date.now() / 1000) mod 3600` (seconds, float32-safe), identical on every client. Every
  animated shader uses it instead of an accumulated `uTime += dt`.
- `seed: number` comes from the consumer (apps/web: a 32-bit hash of the scene id) via `props.weather.seed`.
- Event schedule (`helpers/atmosphereEvents.ts`, pure, THREE-free, unit-tested): time is cut into slots
  of `slotSec` (0.5 s). For slot `k`: `h = hash32(seed ^ Math.imul(k, 0x9E3779B9) ^ kindSalt)` (lowbias32,
  integer-only so it is bit-identical everywhere). An event fires if `h / 2^32 < ratePerSlot`; further
  hashes give position (map UV), intensity, branch seed and hue. Gust strength is a smooth function of
  `(seed, floor(t / 6 s))` with smoothstep blending. The fluid sim's forcing is an analytic function of
  `(seed, atmoTime)` and the sim is dissipative, so clients converge visually within seconds; the worker
  runs ~2 s of warm-up steps on start.

### 3.3 Shared uniform contract (`'atmosphere'` context)

Created once in `Scene.svelte` by `createAtmosphereController()` (`components/AtmosphereLayer/atmosphereController.svelte.ts`). Every
layer reads the **same uniform objects** (never copies) and mutates nothing it does not own.

```ts
export const MAX_ATMO_LIGHTS = 32;
export interface AtmosphereUniforms {
  uAtmoTime: { value: number }; // seconds, wall-clock synced (3.2)
  uWindDir: { value: THREE.Vector2 }; // unit vector, MAP UV space (u right, v up)
  uWindStrength: { value: number }; // 0..1 (incl. current gust)
  uField: { value: THREE.Texture }; // current field RGBA8, see 3.4
  uFieldPrev: { value: THREE.Texture };
  uFieldBlend: { value: number }; // 0..1 between prev and current
  uAccum: { value: THREE.Texture }; // RGBA8: r wetness, g puddle fill, b snow depth, a scorch
  uAmbientTint: { value: THREE.Color }; // multiplicative tint at full darkness
  uAmbientExposure: { value: number }; // 0..1.5
  uDarkness: { value: number }; // 0..1 (map)
  uTokenDarkness: { value: number }; // 0..1 fraction of darkness applied to tokens
  uFlash: { value: number }; // 0..~2, already safety-capped
  uFlashColor: { value: THREE.Color };
  uFlashOrigin: { value: THREE.Vector2 }; // map UV
  uLightCount: { value: number };
  uLights: { value: THREE.Vector4[] }; // xy map UV, z radius (map-height units), w intensity
  uLightColors: { value: THREE.Color[] };
  uMapSize: { value: THREE.Vector2 }; // map image px
  uTier: { value: number }; // 0 low, 1 medium, 2 high
}
```

Light positions are converted from marker space to map UV with the existing `helpers/mapSpace.ts`
contract (MapDefined = center-relative map px; FillSpace = display px). Lights beyond 32 are dropped by
distance-to-map-center order.

### 3.4 Field texture encoding

- `uField` RGBA8, linear filtering, `ClampToEdge`, covers map UV `[0,1]²`. Size: low 64², medium 96², high 128².
  - R,G: velocity in map-UV units/s: `v = (byte/255*2-1) * FIELD_VMAX`, `FIELD_VMAX = 0.25`.
  - B: density 0..1 (dust, snow whiteout, smoke, fog).
  - A: signed curl `(byte/255*2-1)` (drives particle tumble and wisp curl).
- `uAccum` RGBA8 128² (low: 64²), updated at 2 Hz. Rise/decay time constants come from the composed
  preset (wetness rise ~45 s, dry ~180 s; snow rise ~60 s, melt ~240 s). On low tier the worker still
  integrates it (cheap), but at 64².
- A GLSL helper chunk `shaders/atmosphere/field.glsl` decodes both (`atmoWind(uv)`, `atmoDensity(uv)`,
  `atmoCurl(uv)`, `atmoAccum(uv)`), plus `shaders/atmosphere/noise.glsl` (hash, value noise, fbm with a
  literal octave bound selected by define, curl noise, flow-map two-phase advection helper).

### 3.5 Worker / WASM interface

Rust crate `packages/stage/sim/` (`#![no_std]`, zero dependencies, `crate-type = ["cdylib"]`, pinned
`rust-toolchain.toml` 1.92.0 + `wasm32-unknown-unknown`, static buffers sized for 128², no `memory.grow`).

```
init(seed: u32, field_size: u32, accum_size: u32)
set_params(wind_angle_rad: f32, wind_strength: f32, gustiness: f32, turbulence: f32,
           density_mode: u32, density_amount: f32,
           wet_rate: f32, snow_rate: f32, dry_rate: f32, melt_rate: f32)
step(atmo_time: f64, dt: f32)              // forcing(seed,t) → advect → project (Jacobi, literal iters) → vorticity confinement → encode
accum_step(dt: f32)
field_ptr() -> *const u8 ; accum_ptr() -> *const u8
bolt(seed: u32, x0: f32, y0: f32, x1: f32, y1: f32, detail: u32) -> u32   // vertex count; writes (x,y,width,brightness) f32 quads
bolt_ptr() -> *const f32
add_scorch(x: f32, y: f32, radius: f32)     // burn mark into accum alpha, fades over ~60 s
```

The TypeScript contract is `components/AtmosphereLayer/sim/types.ts` (`AtmosphereSim`, `createAtmosphereSim(opts)` in `sim/atmosphereSim.ts`).
`density_mode`: 0 none, 1 edge inflow upwind (sandstorm fronts), 2 everywhere (fog/whiteout), 3 plumes (smoke sources at hashed points).

Worker protocol (`components/AtmosphereLayer/sim/atmosphere.worker.ts`, loaded with
`new Worker(new URL('./atmosphere.worker.js', import.meta.url), { type: 'module' })`; the `.wasm` with
`?url`; `instantiateStreaming` with `instantiate` fallback; `WebAssembly.validate` gate; TS fallback
`weatherSimFallback.ts` implements the same functions):

- main → worker: `{type:'init', seed, tier}`, `{type:'params', ...}`, `{type:'bolt', id, seed, x0,y0,x1,y1}`,
  `{type:'return', buffer}` (ping-pong buffers back), `{type:'pause'}`, `{type:'resume'}`, `{type:'dispose'}`.
- worker → main: `{type:'field', atmoTime, buffer}` (transfer), `{type:'accum', buffer}` (transfer),
  `{type:'bolt', id, vertices: Float32Array}` (transfer), `{type:'ready', backend: 'wasm'|'ts'}`.
- The worker paces itself with `setTimeout` at the tier's sim rate, catches up at most 3 steps, pauses on
  `document.hidden` and when all slots are None. If workers fail entirely, the controller falls back to an
  analytic wind (uniform direction + seeded travelling gust sines) and a constant accumulation driven by
  uniforms; the field textures then stay at their neutral value.

### 3.6 Preset model and composition

Catalog metadata (label, hint, category, slot, GM params with min/max/default, tier notes) lives in
`helpers/atmosphereEffects.ts` (THREE-free, exported, like `annotationEffects.ts`). Render config lives
in declarative presets `components/AtmosphereLayer/presets/{weather,lighting,ambience}/*.ts`:

```ts
interface AtmospherePreset {
  particles?: ParticleLayerSpec[]; // ≤ 3 per slot, ≤ 4 total after compose (drop lowest priority)
  density?: DensitySpec; // colour ramp (2 stops), scale, octaves, coverage, overTokens 0..1, mode
  ground?: GroundSpec; // wetRate, puddles, ripples, snowRate, clouds {coverage, darkness, scale, speed},
  // haze, caustics, tint, groundFog {color, density}, shadows 'tentacles'|null
  lighting?: LightingSpec; // tint, exposure, darkness, sunAngle, shafts {count,color,strength}, aurora, rimVignette
  events?: EventSpec[]; // kind 'lightning'|'meteor'|'surge'|'flicker'|'tremor'|'pulse', ratePerMin, bolts, hueMode
  wind?: { strengthScale: number; gustiness: number; turbulence: number };
}
interface ParticleLayerSpec {
  shape:
    | 'streak'
    | 'drop'
    | 'flake'
    | 'atlasSnow'
    | 'atlasLeaves'
    | 'atlasAsh'
    | 'grit'
    | 'hail'
    | 'mote'
    | 'ember'
    | 'petal'
    | 'bubble'
    | 'spore'
    | 'wisp'
    | 'star'
    | 'meteor';
  count: number; // at intensity 1, high tier
  depthLayers: 1 | 2 | 3; // parallax depth (size/speed/alpha by depth)
  fall: number; // toward-viewer speed (rain high, snow low, bubbles/embers negative = rising)
  windInfluence: number; // 0..1 how strongly the field advects it
  size: [number, number];
  stretch: number; // streak length factor from velocity
  colorA: string;
  colorB: string;
  alpha: number;
  blend: 'normal' | 'additive';
  lifetime: [number, number];
  flicker?: number;
  tumble?: number;
  wander?: number;
  overTokens?: boolean; // default true (air layer); false = render into ground pass
}
```

`composeAtmosphere(weather, lighting, ambience, overrides)` (`helpers/atmosphereCompose.ts`, pure,
unit-tested) merges the three slot presets with slot intensities and GM params into one
`ComposedAtmosphere` (concatenate particle layers by priority; density = max coverage with colour of the
stronger; ground rates add with clamps; lighting multiplies tints, takes max darkness; events concatenate;
wind takes the max strength scale). Only `ComposedAtmosphere` reaches the layers. Its **feature
signature** (sorted list of enabled shader features) drives defines; everything else drives uniforms, so
moving a slider never relinks a program.

### 3.7 Rendering details per layer

All new programs follow the stage rules: feature selection by `#define`, literal loop bounds, link via
`renderer.compileAsync` before becoming visible (keep the previous program visible until the new one is
ready), `$state.raw` for THREE objects, uniforms created once and mutated in place, every effect input
routed through `$derived` or a last-value comparison (props root identity changes on every remote edit),
materials disposed in `onDestroy`. Ambient animation calls `framePacer.markAmbient()` only while
something is animating; lightning calls `markActive()` for the ~400 ms of a strike.

**Frame pacing hook (fixes the wasted renders)**: Scene's render task gets a pre-render registry (context
`'preRender'`: `register(fn) → unregister`). Registered callbacks run only after `shouldRender()` said
yes, before pass 1. The AirLayer renders its offscreen target there, never in its own `useTask`.

1. **Map material (ground)** — `MapLayer`'s `MeshBasicMaterial` is patched via `onBeforeCompile` with
   `customProgramCacheKey` = feature signature. Defines: `ATMO_WET`, `ATMO_RIPPLES`, `ATMO_SNOW`,
   `ATMO_CLOUDS`, `ATMO_HAZE`, `ATMO_CAUSTICS`, `ATMO_LIGHTING`, `ATMO_FLASH`, `ATMO_SHELTER` (reserved).
   No defines → identical to today (zero cost without weather).
   - Haze/caustics/ripple refraction offset the map UV before the texture fetch (0.5–2 px).
   - Wet: albedo × 0.65–0.8 (luminance-weighted), saturation +10%, fake normal from 2 luminance taps → broad sky specular × wetness.
   - Puddles: low-frequency noise thresholded by `accum.g`, biased to darker areas; inside: stronger darkening, sky-tint reflection (flash colour during lightning), ripples at full strength.
   - Ripples: hashed cells ≈ 0.4 grid squares, expanding ring SDF `(1-r)²`, 3×3 neighbourhood on high, 2×2 medium, 1 low.
   - Snow: `cover = smoothstep(c-0.1, c+0.1, accum.b + noise*0.3 - edgeness*bias)` toward `#eef3f8` with blue in shadow; flat areas whiten first.
   - Clouds: thresholded fbm (2–3 oct) translated by mean wind; cloud ≈ 10–30 grid squares; multiplies.
   - Lighting: `ambient = mix(1, tint*exposure, darkness)`, `lit = max(ambient, lightMask*lightColor)`; the map applies `lit_map / lit_token` so the darkness quad above (which multiplies tokens AND map by `lit_token`) yields `lit_map` on the map. Flash is added after (`+ flash * flashColor * directional falloff`).
2. **AmbienceGround (21)** — map-anchored quad (map size, inside `mapAnchor`), flow-map advected fbm
   density for ground fog / smoke / miasma / freezing mist, tentacle shadow SDFs, spore glow. Premultiplied.
3. **AtmosphereDarkness (37.8)** — map-anchored quad, `CustomBlending` with `blendSrc=ZeroFactor,
blendDst=SrcColorFactor` (dst × src). Writes `lit_token = mix(1, ambient, tokenDarkness)` raised by
   the light mask and by the flash. Not mounted when darkness = 0 and no tint.
4. **AirLayer (38.5)** — replaces WeatherLayer's internals. Offscreen RT sized to the map's on-screen
   pixel footprint (clamped to the display, × tier scale: high 1, medium 0.5, low 0.5) with an
   orthographic camera over map UV. Particles: one `InstancedMesh` per `ParticleLayerSpec` with a quad
   geometry, per-instance seed attribute only; position is stateless:
   `spawn(seed, cycle) + age * (fall/parallax + wind(midpoint) * windInfluence)`; depth layers scale size,
   speed and alpha around a vanishing point offset downwind (the overhead "rain slant" cue); streaks
   stretch along screen velocity. Shapes are procedural SDFs selected by `PARTICLE_SHAPE` define (atlas
   shapes sample the existing PNG atlases). Count changes adjust `instanceCount`, never rebuild buffers
   (allocate the high-tier maximum once per spec). Density pass (sandstorm walls, whiteout, wisps,
   over-token fog share) is drawn first into a quarter-resolution RT. The composite quad (map-anchored,
   premultiplied `One, OneMinusSrcAlpha`) samples both RTs, applies `ambient` tint and flash so airborne
   weather darkens with the scene. Visibility occlusion over tokens is capped (`maxOcclusion` 0.7).
5. **LightningLayer (38.6, SceneLayer.Main)** — ribbons from worker bolt polylines (triangle strip,
   fwidth-feathered core, HDR rgb on high tier only), branch fade, 1-frame ring + scorch write
   (`accum.a` via a `scorch` param sent to the worker). Flash envelope: 2–4 sub-strokes over 150–400 ms
   (attack 16 ms, decay τ 60–120 ms), afterimage dip 0.5–1 s. Safety: `flashBrightness` default 0.6,
   `reduceFlashes` → ×0.3 and no afterimage, `prefers-reduced-motion` → ×0.3 and no shake; shake only if
   `settings.shake` and tier high (reuse the `cameraShake` context, 2–4 px).

### 3.8 Performance budgets

| Tier            | Weather GPU     | Main thread | Worker       | Notes                                                                            |
| --------------- | --------------- | ----------- | ------------ | -------------------------------------------------------------------------------- |
| high (60 fps)   | ≤ 2.0 ms @1080p | ≤ 0.3 ms    | 128² @ 30 Hz | 3 depth layers, 3×3 ripples, HDR bolts, optional shake                           |
| medium (30 fps) | ≤ 2.5 ms        | ≤ 0.3 ms    | 96² @ 20 Hz  | 2 depth layers, half-res air RT, quarter-res density                             |
| low (24 fps)    | ≤ 3.0 ms        | ≤ 0.2 ms    | 64² @ 12 Hz  | 1 depth layer, particle ×0.25, density 1 octave, 1-tap ripples, no HDR, no shake |

Add tier knobs to `PERFORMANCE_TIER_SETTINGS`: `atmoFieldSize`, `atmoSimHz`, `atmoDepthLayers`,
`atmoRippleTaps`, `atmoDensityScale`, `atmoNoiseOctaves`, `atmoHdrBolts`. Nothing runs (no worker, no
RT, no defines) when all three slots are None.

## 4. Catalog (append-only enums; never renumber)

Phase 1 = engine + **bold** entries; phase 2 = the rest.

**Weather** (`WeatherType`, existing 1–8 re-implemented on the new engine)

| id     | name             | category      | look / behaviour                                                  |
| ------ | ---------------- | ------------- | ----------------------------------------------------------------- |
| 0      | None             |               |                                                                   |
| **1**  | Rain             | Rain & storms | 2-layer streaks, wind slant, ripples, wetness builds              |
| **2**  | Snow             | Cold          | slow flakes in 3 depths, curl drift, snow cover builds            |
| **3**  | Leaves           | Wind          | leaf atlas tumbling on the field, curl-driven spin                |
| **4**  | Ash              | Fire          | slow grey flakes, warm grey tint                                  |
| **5**  | Dust storm       | Wind          | grit streaks + density fronts rolling across                      |
| **6**  | Embers           | Fire          | additive rising embers, flicker, warm glow                        |
| **7**  | Blizzard         | Cold          | fast flakes, whiteout density, wind lines, snow builds fast       |
| **8**  | Fireflies        | Nature        | additive wandering motes, slow pulse                              |
| **9**  | Drizzle          | Rain & storms | sparse fine streaks, slow wetness                                 |
| **10** | Heavy rain       | Rain & storms | dense 3-layer sheets in gusts, puddles grow                       |
| **11** | Thunderstorm     | Rain & storms | heavy rain + lightning (bolts + flash) + overcast darkening       |
| **12** | Hail             | Rain & storms | fast bright pellets, impact pops on ground                        |
| **13** | Sandstorm        | Wind          | severe: dense ochre walls, low visibility, gust fronts            |
| **14** | Gale             | Wind          | sparse wind-line ribbons + debris, strong gusts                   |
| 15     | Acid rain        | Fantasy       | green-yellow streaks, rising fizz vapour, sickly tint             |
| 16     | Blood rain       | Fantasy       | dark red heavy drops, red puddles                                 |
| 17     | Cherry blossoms  | Nature        | pink petals tumbling on the wind                                  |
| 18     | Volcanic ashfall | Fire          | ash + distant red glow pulses, rumble tremor events               |
| 19     | Meteor shower    | Fantasy       | streaking meteors (events), occasional impact flash               |
| 20     | Arcane storm     | Fantasy       | violet swirling motes, coloured lightning (random hue per strike) |
| 21     | Spore drift      | Fantasy       | glowing spores rising, slow bloom pulse                           |
| 22     | Sleet            | Cold          | mixed streaks + small flakes, wet + thin snow                     |

**Lighting** (`LightingType`)

| id    | name         | look                                            |
| ----- | ------------ | ----------------------------------------------- |
| 0     | None (day)   |                                                 |
| **1** | Dawn         | cool-pink grade, low-angle warm shafts          |
| **2** | Dusk         | golden-orange grade, long shafts                |
| **3** | Night        | dark blue grade (moon tint param), lights pop   |
| **4** | Overcast     | flat desaturated, slight darkening              |
| **5** | Sunbeams     | god-ray light pools + dust motes                |
| 6     | Eclipse      | deep dim, red rim vignette, slow totality pulse |
| 7     | Pitch dark   | near-black, only lights reveal (dungeons)       |
| 8     | Aurora night | night + slow undulating aurora ribbons          |

**Ambience** (`AmbienceType`)

| id    | name              | look                                                                     |
| ----- | ----------------- | ------------------------------------------------------------------------ |
| 0     | None              |                                                                          |
| **1** | Ground fog        | flow-advected banks, dense under tokens, wisps over them                 |
| **2** | Cloud shadows     | large soft shadows drifting with the wind                                |
| **3** | Heat haze         | map shimmer, warm grade                                                  |
| **4** | Wildfire smoke    | brown-grey plumes with orange underglow, embers                          |
| **5** | Underwater        | caustics, rising bubbles, teal grade, gentle wobble                      |
| 6     | Swamp miasma      | sickly green low fog, buzzing motes                                      |
| 7     | Feywild lights    | multicolour bobbing motes, petals, saturated grade                       |
| 8     | Ghost wisps       | pale additive wisps fading in and out, cold grade                        |
| 9     | Divine radiance   | golden shafts and motes, breathing brightness                            |
| 10    | Shadowfell gloom  | desaturated, black-green fog creep, falling grey motes                   |
| 11    | Infernal hellfire | red grade, embers + ash, heat haze, fire flicker events                  |
| 12    | Astral starfield  | dark violet, parallax twinkling stars, nebula density                    |
| 13    | Abyssal tentacles | huge slow tentacle shadows under the map, purple vignette, twitch events |
| 14    | Freezing mist     | ice sparkles, low blue fog, frost rim                                    |
| 15    | Sandworm tremors  | ground ripple rings + dust puffs at seeded spots, tremor shake           |

**Quick scenes** (UI shortcuts, not persisted as such): Stormy night (Thunderstorm + Night + Cloud
shadows), Winter pass (Blizzard + Overcast + Freezing mist), Desert noon (Dust storm + None + Heat haze),
Feywild glade (Cherry blossoms + Sunbeams + Feywild lights), Haunted moor (Drizzle + Night + Ghost wisps),
Sunken temple (None + Sunbeams + Underwater), Hellscape (Embers + Dusk + Infernal hellfire), Volcanic
wastes (Volcanic ashfall + Overcast + Wildfire smoke), Shadowfell (Ash + Pitch dark + Shadowfell gloom),
Astral sea (None + Night + Astral starfield).

GM params (shared): slot intensity 0..1, wind angle (deg, map space, 0 = toward map right, 90 = toward
map top) and strength 0..1, flash brightness, reduce flashes, shake, token darkness, accumulation on/off.
Per-effect extras (≤ 3 each, e.g. `strikeRate`, `moonTint`, `hue`) live in `params`.

## 5. Data model (apps/web)

Keep `weather_type`, `weather_intensity`, `weather_opacity` (0..1 checks stay valid), keep `weather_fov`
(ignored by the new engine; still used by Custom 99). Add to `scene` in `schema.ts`:

| column                       | type                | default | check |
| ---------------------------- | ------------------- | ------- | ----- |
| `weather_lighting_type`      | integer             | 0       |       |
| `weather_lighting_intensity` | real                | 1       | 0..1  |
| `weather_ambience_type`      | integer             | 0       |       |
| `weather_ambience_intensity` | real                | 1       | 0..1  |
| `weather_wind_angle`         | real                | 45      |       |
| `weather_wind_strength`      | real                | 0.35    | 0..1  |
| `weather_settings`           | text json, nullable | null    |       |

`weather_settings` = `{ v: 1, flashBrightness?, reduceFlashes?, shake?, tokenDarkness?, accumulation?, params?: Record<string, number> }`,
stored in Y.js as a JSON string (like `fogOfWarRooms`). Flat columns for what the radial toggles
(types, intensities, wind) so concurrent edits merge per field. `SceneSettings` gains optional fields
read with defaults in `buildSceneProps`. No doc schema version bump. **The user generates and applies the
migration** (CLAUDE.md D-3/D-4). Seed = 32-bit hash of the scene id, computed in `buildSceneProps`.

DM view: lighting darkness on the editor is capped at 0.5 so the GM can read the map (a constant in
`buildSceneProps` mode `'editor'`).

## 6. UI

- Editor: `WeatherControls.svelte` becomes an Atmosphere panel: quick-scene chips; three sections
  (Weather / Lighting / Ambience), each with category tabs and a tile grid (CSS gradient + tabler icon
  from `apps/web/src/lib/utils/atmosphereIcons.ts`; no live WebGL previews); per-slot intensity; wind
  compass (angle dial + strength); effect-specific sliders generated from the catalog's param schema;
  safety toggles. `selectedWeather` becomes `$derived` from the props (fixes remote changes). Sentence case.
- GM radial (`editorGeneralMenu`): `Atmosphere` → Weather / Lighting / Ambience / Quick scenes → category
  rings (≤ 8 items) → effects; `Off`; intensity ± with `keepOpen`. Ids prefixed `gm-atmo:`; writes only the
  changed fields.
- Docs playground: tweakpane folders for the three slots, wind, settings, params, and a tier switch.

## 7. Workstreams (file ownership — agents must not edit files owned by another stream)

**Phase 1**

- **WS-W Toolchain + simulation** — `packages/stage/sim/**` (crate, cargo tests), `packages/stage/scripts/build-sim.mjs`,
  `packages/stage/package.json` (`build:sim` script only), `containers/Dockerfile` (rustup in base, curl),
  `compose.dev.yaml` (cargo volumes, `CARGO_TARGET_DIR`), `containers/dev.sh` (build + staleness loop),
  `.github/workflows/ci.yml` (`wasm-fresh` job), committed `components/AtmosphereLayer/sim/weather_sim.wasm`,
  `components/AtmosphereLayer/sim/*` (worker, TS fallback, client), `docs/local-container-hosting.md` note.
- **WS-F Foundation (stage)** — types/enums, `helpers/atmosphereEffects.ts`, `helpers/atmosphereCompose.ts`,
  `helpers/atmosphereEvents.ts` (+ tests), `components/AtmosphereLayer/atmosphereController.svelte.ts`,
  `AtmosphereLayer.svelte` (mount point owning sub-layers as stubs), preset type + phase-1 preset data,
  shader chunks `shaders/atmosphere/{noise,field}.glsl`, `Scene.svelte` mounts + `'preRender'` registry,
  `Scene/types.ts` orders, `Stage/types.ts` (props + tier knobs), `index.ts` exports, removal of the old
  WeatherLayer path for types ≠ Custom.

**Phase 1b (parallel, after WS-F and WS-W land)**

- **WS-G Ground + lighting** — MapLayer material patch, `AmbienceGround`, `AtmosphereDarkness`, light mask
  uniforms, flash application on map.
- **WS-A Air + lightning** — `AirLayer`, particle shapes/shaders, density pass, composite, `LightningLayer`,
  flash envelope + shake + safety.
- **WS-U App + UI** — schema, realtime types, settings plumbing, `buildSceneProps`, defaults/demo data,
  fixtures, editor panel, GM radial, docs playground controls.

**Phase 2** — **WS-P Catalog** — the remaining presets (weather 15–22, lighting 6–8, ambience 6–15) and
quick scenes, plus any small per-effect shader feature they need (tentacle SDF, aurora, stars, meteors)
inside the files WS-G/WS-A created.

**Review** after each phase (lead): efficiency, frame cost, program-link counts (F9 overlay `Programs`),
leaks/disposal, determinism across two tabs, correctness of layer order vs fog of war, tier fallbacks,
`pnpm run check`, `pnpm run format-check`, `pnpm lint`, unit tests, `cargo test`.

## 8. Testing

- `cargo test` in `packages/stage/sim` (field stays bounded, divergence after projection < ε, deterministic
  output for equal seed/time, bolt endpoints and vertex counts).
- Vitest: `atmosphereEvents` (bit-exact fixtures, rate statistics), `atmosphereCompose` (merge rules,
  feature signature stability), catalog integrity (unique ids, categories ≤ 8 items for the radial, params
  in range), web `buildSceneProps` + settings round trip.
- Visual: docs playground `/stage` route; headless Chromium (Playwright from apps/web, SwiftShader) to
  compile every feature-define combination of phase-1 programs and capture contact sheets.
- Perf: F9 overlay on each tier; confirm no renders on skipped frames, `markAmbient` cap holds, Programs
  count stable while moving sliders.

## 9. Edge cases

- Map not loaded / mapSize 0 → atmosphere layers not mounted.
- Video maps: map material patch must keep working with Video/Gif data sources.
- Thumbnails (`generateThumbnail`): atmosphere excluded (or frozen) so thumbnails are clean.
- Map rotation/zoom: everything map-anchored, wind in map space.
- FillSpace vs MapDefined: map-anchored layers mount next to `MapLayer` inside `mapAnchor` in both modes.
- Worker unavailable (CSP, old browser) → analytic fallback, no crash, console warn once.
- Tab hidden → worker paused; on resume, warm-up steps.
- 0 values for intensity/opacity must be honoured (no truthiness checks).
- Old rows/rooms without new fields → defaults; unknown enum id → None.
- Context loss: DataTextures re-upload on restore (three handles), worker unaffected.
