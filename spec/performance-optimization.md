# Spec: Performance optimization pass

Scope tag: **PERF-2**. Follows `spec/perf-marker-selection.md` (token selection latency, already implemented).

## Problem statement

Measured or confirmed by reading the code on 2026-10-18:

| ID  | Finding                                                                                                                                                                                                                                                                                                                         | Impact   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| F1  | **Every page downloads ~3 MB of JS (≈840 KB gzip)**, including login and landing. The root layout (`routes/+layout.svelte`) imports `GlobalLoading` from the `$lib/components` barrel, which re-exports `GameSession/*` (→ three.js, stage, zod, troika, yjs: one 2.3 MB chunk). The `@tableslayer/ui` barrel drags TipTap + ProseMirror + Shiki (694 KB). Neither `packages/ui` nor `packages/stage` declares `sideEffects`, so the bundler can't drop unused re-exports. | HIGH     |
| F2  | The stage renders **continuously at the display refresh rate** (`<Canvas renderMode="always">`), even when nothing changes and nobody is interacting. The TV/playfield runs for hours this way. Ambient shaders (fog drift, light pulses) move slowly and look the same at 20–30 fps.                                                         | HIGH     |
| F3  | `Fog.frag` (fog of war) recomputes the **same feathered mask (8 mip levels × 2 texture fetches) once per noise layer**: 4× per pixel on the high tier. That is ~74 texture fetches per covered pixel, when ~26 would give the same result.                                                                                              | HIGH     |
| F4  | Every fog/annotation brush stroke end calls `toPng()` eagerly: a **synchronous full-resolution `readRenderTargetPixels`**, a canvas copy, a flip and a PNG encode. The editor **throws the blob away** (`_blob`). 500 ms later `toRLE()` does a second synchronous readback. For a 4096² map that is 64 MB read back twice, and the GPU pipeline stalls each time. | HIGH     |
| F5  | `encodeRLE` (packages/ui) pushes each byte into a JS `number[]` and then copies it into a `Uint8Array`. This is slow and allocates a lot for masks with millions of pixels.                                                                                                                                                      | MED      |
| F6  | `applySessionPersist` → `replaceRows` makes **one awaited DB round-trip per row**. A scene with 60 tokens means 60+ sequential round-trips to Turso on every persist (2–10 s cadence).                                                                                                                                           | MED-HIGH |
| F7  | Map images are decoded **on the main thread** (`THREE.TextureLoader` → `HTMLImageElement`). A 3000×3000 map blocks for 100–300 ms on every scene switch.                                                                                                                                                                    | MED      |
| F8  | Cloudflare image transforms never ask for modern formats (no `format=auto`), so maps and thumbnails are served as JPEG/PNG. The local-storage transform route re-encodes **PNG on every request** with `cache-control: no-cache`.                                                                                           | MED      |
| F9  | Every remote doc change rebuilds **every row object** (`rowsOf` → `yMapToObject`) for markers, lights, templates and annotations. `buildSceneProps` re-runs `chroma-js` gradient generation and `JSON.parse` of fog rooms each time. Remote token drags trigger this many times per second.                                         | MED      |
| F10 | Small per-frame waste: `Scene.svelte` `hasActiveEffects` is a `$derived` of a _function_, so it's recomputed every frame. `CursorLayer` writes a `$state` every frame even with zero cursors. `FogLayer` allocates new `Vector4`s for clipping planes. `LightToken` allocates a `THREE.Color` per update.                    | LOW      |
| F11 | `tokenRasterCache` keeps every decoded token `ImageBitmap` forever (unbounded memory on long sessions; also flagged by code review).                                                                                                                                                                       | MED      |
| F12 | Editor page load waterfall: `getScenes` → `getScene` → `Promise.all(5)` → `getUserChecklistState` run in sequence, which is 2 more round-trips than needed.                                                                                                                                                                 | LOW-MED  |
| F13 | Inter font files (345 KB + 380 KB) are not preloaded, so text reflows late.                                                                                                                                                                                                                                                         | LOW      |

### Considered and rejected / deferred

- **Rust/WASM**: rejected. No hot path is CPU-bound in a way WASM would fix. The costs are GPU stalls, bundle size, DOM/Svelte reactivity and network round-trips. The only tight loop (RLE) is memory-bound, and typed arrays already run near native speed.
- **Instanced tokens/lights, texture atlas**: deferred. Typical scenes have < 100 tokens, and draw calls are not the bottleneck. Revisit if the F9 overlay shows > 300 draw calls.
- **Rendering in a worker (OffscreenCanvas)**: rejected. It doesn't work with Threlte's component model.
- **KTX2/Basis compressed map textures, GIF→MP4 transcoding at upload**: deferred. Both are big GPU-memory/bandwidth wins, but they need a server transcoding pipeline. Good follow-ups.
- **Baking the feathered fog mask into a texture when the mask changes**: deferred follow-up to FOG-1.
- **RLE encode in a Web Worker**: deferred. Do MSK-1..3 first and measure.

## Goals / acceptance

- Login/landing pages: no three.js, TipTap or Shiki code in the chunks loaded by the root layout (node `0`) or `entry/app`.
- Idle editor/playfield on medium/low tiers renders ≤ 30/20 fps (F9 overlay), and goes back to full rate within one frame of any input or doc change.
- Fog of war: the same image as before (pixel-identical up to float rounding), with fewer texture fetches.
- Fog/annotation stroke end: no synchronous `readRenderTargetPixels` on the main thread in the editor.
- Persisting a 60-token scene costs 1 DB round-trip per changed collection, not 60.
- All gates pass: `pnpm run check`, `pnpm run format-check`, and the unit tests named below.

## ⚠️ Rules for implementers (read first)

1. **Never run `pnpm build` / `pnpm turbo run build` at the repo root or in apps/web.** The turbo pipeline runs `web#migrate` against the database first. To measure the bundle, use the exact commands in BND-4.
2. Never run migrations, `pnpm run push`, `pnpm changeset`, or any release command. Never commit, stage (`git add`) or push.
3. Only edit the files listed for your area. Other areas are being edited in parallel.
4. After editing, run `npx prettier --write <each file you changed>` from the repo root.
5. Follow `CLAUDE.md`: arrow functions, BEM, sentence-case UI text, no chatty comments.
6. Stage unit tests run with: `cd packages/stage && ../../apps/web/node_modules/.bin/vitest run <path-to-test>`.
   Web unit tests run with: `cd apps/web && npx vitest run <path-to-test>`.
7. Type-check only the package you touched: `pnpm --filter @tableslayer/stage check`, `pnpm --filter web check`, `pnpm --filter @tableslayer/ui check`.

---

## Area 1 — Bundle splitting (BND) · fixes F1, F13

**Files:** `apps/web/src/routes/+layout.svelte`, any other `+layout.svelte` under `apps/web/src/routes` (audit only),
`packages/stage/package.json`, `packages/ui/package.json`, `apps/web/src/app.html`.

### BND-1 Root layout must not import barrels that reach the stage

In `apps/web/src/routes/+layout.svelte` replace

```ts
import { GlobalLoading } from '$lib/components';
```

with

```ts
import GlobalLoading from '$lib/components/GlobalLoading.svelte';
```

### BND-2 Let the bundler drop unused package exports

Add a `sideEffects` field to **both** `packages/stage/package.json` and `packages/ui/package.json`, next to `"type"`:

```json
"sideEffects": ["**/*.css"]
```

The packages are consumed as `.svelte` source through `dist/`. Svelte component CSS is emitted as virtual
`*.css` modules, so this glob keeps all styles. `packages/ui` changes **need a changeset**: do not create it.
List it in your final report so the user can run `pnpm changeset` (`patch`).

Check that no module in `packages/stage/src` or `packages/ui/src` relies on import-time side effects that would
be lost. Grep each package for top-level calls that register something globally:
`grep -rn "^customElements\|^window\.\|^document\.\|^if (typeof window" packages/*/src/lib`. Note anything you find in your report. Don't change it.

### BND-3 Audit the other layouts

Run `grep -rn "from '\$lib/components'" apps/web/src/routes --include=+layout.svelte`. For each hit that is a
layout above the game-session/play routes, switch the import to the direct file path, as in BND-1.

### BND-4 Verify (required)

```bash
cd /path/to/repo
pnpm --filter @tableslayer/ui package
pnpm --filter @tableslayer/stage build
cd apps/web && npx svelte-kit sync && npx vite build
cd .svelte-kit/output/client/_app/immutable
# chunks loaded by the root layout and the app entry, with sizes
for f in nodes/0.*.js entry/app.*.js; do echo "== $f"; grep -o '\./[A-Za-z0-9_-]*\.js\|chunks/[A-Za-z0-9_-]*\.js' $f | sed 's#.*/##' | sort -u | while read c; do [ -f chunks/$c ] && echo "$(stat -c %s chunks/$c) $c"; done | sort -n | tail -5; done
grep -l "WebGLRenderer" chunks/*.js   # which chunk holds three.js
grep -l "ProseMirror" chunks/*.js     # which chunk holds TipTap
```

Acceptance: neither the three.js chunk nor the ProseMirror chunk shows up in the node `0` / entry lists. Record
before/after sizes in your report. If it still fails, find which import pulls them in. Open
`nodes/0.*.js`, follow the imports, and fix it with direct-path imports in **apps/web** only. Don't
restructure the packages.

### BND-5 Preload the main font

In `apps/web/src/app.html`, inside `<head>` before `%sveltekit.head%`, add:

```html
<link rel="preload" href="/InterVariable.woff2" as="font" type="font/woff2" crossorigin />
```

(Font subsetting is optional. Only do it if the user approved it. See "Open decisions".)

---

## Area 2 — Stage frame pacing (FRM) · fixes F2, F10

**Files:** new `packages/stage/src/lib/components/Stage/helpers/framePacing.ts` + `framePacing.test.ts`,
`components/Scene/Scene.svelte`, `components/CursorLayer/CursorLayer.svelte`, `components/FogLayer/FogLayer.svelte`,
`components/LightLayer/LightToken.svelte`, `components/MeasurementLayer/MeasurementManager.svelte`.

Background: the frame loop keeps running (Threlte `renderMode="always"`, tasks still tick, `uTime` keeps
advancing). We only **skip the GPU work in Scene's render task** while idle. Skipping a frame with no GL calls
leaves the canvas showing the previous frame. That is standard WebGL behaviour and needs no
`preserveDrawingBuffer`.

### FRM-1 Pure pacing helper

Create `helpers/framePacing.ts`:

```ts
import type { PerformanceTier } from '../components/Stage/types';

// Frames per second while nothing is interacting or changing. null = uncapped.
export const IDLE_FRAME_RATE: Record<PerformanceTier, number | null> = {
  high: null,
  medium: 30,
  low: 20
};

export const ACTIVE_WINDOW_MS = 1500;
// rAF timestamps jitter by ~1 ms; without slack a 30 fps cap on a 60 Hz display would drop to 20 fps
const FRAME_SLACK_MS = 1.5;

export type FramePacer = ReturnType<typeof createFramePacer>;

export const createFramePacer = () => {
  let activeUntil = 0;
  let lastRenderAt = Number.NEGATIVE_INFINITY;

  const markActive = (now = performance.now(), windowMs = ACTIVE_WINDOW_MS) => {
    activeUntil = Math.max(activeUntil, now + windowMs);
  };

  const shouldRender = (now: number, idleFps: number | null) => {
    const due = idleFps === null || now < activeUntil || now - lastRenderAt >= 1000 / idleFps - FRAME_SLACK_MS;
    if (due) lastRenderAt = now;
    return due;
  };

  return { markActive, shouldRender };
};
```

(The values above assume the user's answer to Open decision 1 is "medium/low only". If they chose to also cap high, set `high: 30`.)

Write `framePacing.test.ts` (vitest) that covers: uncapped always renders, `markActive` forces rendering for the
window, 30 fps cap renders every 2nd frame of a simulated 60 Hz loop (timestamps `i * 16.667`), 20 fps cap renders
every 3rd frame, and the 120 Hz case (`i * 8.333`) at 30 fps renders every 4th frame.

### FRM-2 Integrate in `Scene.svelte`

1. Imports: `createFramePacer, IDLE_FRAME_RATE` from `../../helpers/framePacing`; `PERFORMANCE_TIER_SETTINGS` is not needed.
   `setContext` from `svelte`.
2. Near the other top-level `const`s: `const framePacer = createFramePacer(); setContext('framePacer', framePacer);`
3. In the render `useTask`, right after `if (!scene || !renderer || !camera) return;` add:
   ```ts
   const now = performance.now();
   if (needsResize) framePacer.markActive(now);
   if (!framePacer.shouldRender(now, IDLE_FRAME_RATE[props.performanceTier ?? 'high'])) return;
   ```
   Keep `beginFrame()` **after** this check, so the F9 overlay reports rendered fps.
4. Activity sources (each calls `framePacer.markActive()`):
   - A `$effect` that reads the `props` root, `cursors` and `receivedMeasurement`:
     ```ts
     $effect(() => {
       void props;
       void cursors;
       void receivedMeasurement;
       untrack(() => framePacer.markActive());
     });
     ```
     (apps/web replaces the props root on every doc change, so this fires on every remote or local edit.)
   - In `onMount`, add **passive** `window` listeners for `pointerdown`, `pointermove`, `wheel` and `keydown` that call
     `framePacer.markActive()`. Remove them in the returned cleanup. Both `return` paths of the existing
     `onMount` must remove them. The simplest way is to register them before the `if (trackLocalCursor…)` branch and
     remove them in both cleanups.
   - Wherever Scene receives the map-loaded callback (`onMapLoaded` handler passed to `MapLayer`), call `framePacer.markActive()`.
5. Fix F10 here as well: change
   `const hasActiveEffects = $derived(() => hasActivePostProcessing(props.postProcessing, props.performanceTier));`
   to `const hasActiveEffects = $derived(hasActivePostProcessing(props.postProcessing, props.performanceTier));` and
   replace the call `hasActiveEffects()` with `hasActiveEffects`.

### FRM-3 Transient animations keep full rate

- `MeasurementManager.svelte`: `const framePacer = getContext<FramePacer | undefined>('framePacer');`. Inside the
  existing `useTask`, when `isFading` is true, call `framePacer?.markActive()`.
- `CursorLayer.svelte`: change the task to
  `useTask(() => { currentTime = Date.now(); framePacer?.markActive(); }, { running: () => props.cursors.length > 0 });`
  (get `framePacer` from context the same way).

### FRM-4 Small per-frame fixes (F10)

- `FogLayer.svelte`: in the effect that updates uniforms, replace the `uClippingPlanes.value = clippingPlaneStore.value.map(new Vector4…)`
  line with an in-place loop (same as `FogOfWarMaterial.svelte` does):
  ```ts
  const planes = clippingPlaneStore.value;
  for (let i = 0; i < planes.length; i++) {
    const p = planes[i];
    material.uniforms.uClippingPlanes.value[i].set(p.normal.x, p.normal.y, p.normal.z, p.constant);
  }
  ```
  Add `{ stage: renderStage, running: () => props.enabled }` to its `useTask` options. Only add `running` if `props.enabled`
  exists on the fog props type. Check `FogLayer/types.ts`.
- `LightToken.svelte`: in the effect, replace `lightMaterial.uniforms.uColor.value = new THREE.Color(light.color);` with
  `lightMaterial.uniforms.uColor.value.set(light.color);`. Before changing it, confirm in `lightShader.ts` that `uColor` starts as a `THREE.Color`.

### FRM-5 Verify

- `framePacing.test.ts` passes. `pnpm --filter @tableslayer/stage check` passes.
- Manual check (user): docs stage route, F9 overlay, medium tier → idle ~30 fps, mouse move → 60.

---

## Area 3 — Fog of war shader (FOG) · fixes F3

**File:** `packages/stage/src/lib/components/Stage/shaders/Fog.frag` only.

### FOG-1 Compute the feathered mask once per pixel

Today `mask(uv, size, amplitude, frequency)` runs the mip loop and the base-mask fetch, and `main()` calls it
4 times with identical `uv`. The only per-layer inputs are `amplitude` and `frequency` (edge noise).

1. Change `mask` to take the precomputed values:
   ```glsl
   float mask(vec2 size, float amplitude, float frequency, float featheredMask, float baseMask) {
     vec2 noiseUV = vUv * size;
     float edgeNoise = snoise(frequency * noiseUV + uTime * uEdgeSpeed) + uEdgeOffset;
     float edgeWidth = 0.2;
     float edgeMask = smoothstep(0.0, edgeWidth, featheredMask) * (1.0 - smoothstep(1.0 - edgeWidth, 1.0, featheredMask));
     float finalMask = featheredMask + edgeNoise * amplitude * edgeMask;
     return amplitude * finalMask + (1.0 - amplitude) * baseMask;
   }
   ```
2. In `main()`, after the early `discard` and the `texSize` line, compute once:
   ```glsl
   float featheredMask = 0.0;
   for(int i = uEdgeMinMipMapLevel; i <= uEdgeMaxMipMapLevel; i++) {
     featheredMask += combinedMaskLod(vUv, float(i));
   }
   featheredMask = clamp(featheredMask / float(uEdgeMaxMipMapLevel - uEdgeMinMipMapLevel + 1), 0.0, 1.0);
   float baseMask = combinedMask(texture2D(uRoomsTexture, vUv), texture2D(uMaskTexture, vUv).a);
   ```
3. Replace all four `mask(vUv, texSize, uEdgeAmplitude.N, uEdgeFrequency.N)` calls with
   `mask(texSize, uEdgeAmplitude.N, uEdgeFrequency.N, featheredMask, baseMask)`.
4. Remove the unused `totalWeight` variable.

Don't change anything else: no loop bounds, uniforms or noise. Output must be the same.
Verify: `pnpm --filter @tableslayer/stage check`. The user checks visually in the docs stage route (fog of war layer).

---

## Area 4 — Mask readback and RLE pipeline (MSK) · fixes F4, F5

**Files:** `packages/stage/src/lib/components/Stage/components/Stage/types.ts` (Callbacks only),
`components/DrawingLayer/DrawingMaterial.svelte`, `components/AnnotationLayer/AnnotationLayer.svelte`,
`components/FogOfWarLayer/FogOfWarLayer.svelte`, `packages/ui/src/lib/utils/rle.ts` (+ new `rle.test.ts` beside it),
`apps/web/src/routes/(app)/[party]/[gameSession]/[[selectedScene]]/+page.svelte` (only the two handlers named below),
`apps/web/src/routes/(app)/[party]/play/usePlayTools.svelte.ts`, `apps/docs/src/routes/(components)/stage/+page.svelte`.

### MSK-1 Make the update blobs lazy

1. `types.ts` `Callbacks`:
   ```ts
   onAnnotationUpdate: (layerId: string, getBlob: () => Promise<Blob>, endPosition?: { x: number; y: number }) => void;
   onFogUpdate: (getBlob: () => Promise<Blob>) => void;
   ```
2. In `AnnotationLayer.svelte` (3 call sites) and `FogOfWarLayer.svelte` (3 call sites), pass the function instead of calling it:
   `onFogUpdate(toPng())` → `onFogUpdate(toPng)`, `onAnnotationUpdate(id, toPng(), pos)` → `onAnnotationUpdate(id, toPng, pos)`.
   For `converted.toPng()` use `() => converted.toPng()`.
   Before changing a call site, check that the referenced `toPng` takes no arguments that are currently passed. If it does, wrap it: `() => toPng(arg)`.
3. Consumers:
   - Editor `+page.svelte`: `onAnnotationUpdate = (layerId: string, _getBlob: () => Promise<Blob>) =>` and
     `onFogUpdate = (_getBlob: () => Promise<Blob>) =>`. Rename the parameter type only; the bodies stay the same.
   - `usePlayTools.svelte.ts` `onAnnotationUpdate`: rename the param to `getBlob` and change `blob.then(` to `getBlob().then(`.
     `onFogUpdate` takes no args, so no change.
   - docs `+page.svelte` `onAnnotationUpdate`: same rename, `getBlob().then(`.

### MSK-2 Asynchronous GPU readback

In `DrawingMaterial.svelte`, `toPng()` and `toRLE()` are already `async`. Replace both
`renderer.readRenderTargetPixels(...)` calls with `await renderer.readRenderTargetPixelsAsync(...)` and the same arguments.
three r186 issues the GPU read immediately and only waits on a fence, so the snapshot is taken at call time.
Callers already re-check `isDrawing()` after awaiting.

### MSK-3 Faster RLE encode (packages/ui)

Rewrite `encodeRLE` in `packages/ui/src/lib/utils/rle.ts` to write into a preallocated `Uint8Array`. The output is
never longer than `data.length + 1` bytes: a run of length 1 takes one byte, and a run of ≥128 takes at most
`ceil(bits/7)` bytes, which is still fewer than the pixels it covers.

```ts
export function encodeRLE(data: Uint8Array): Uint8Array {
  if (data.length === 0) return new Uint8Array(0);
  const out = new Uint8Array(data.length + 1);
  let o = 0;
  let currentValue = data[0];
  let runLength = 1;
  out[o++] = currentValue === 0 ? 0 : 1;
  const writeVarint = (value: number) => {
    while (value > 127) {
      out[o++] = (value & 0x7f) | 0x80;
      value >>>= 7;
    }
    out[o++] = value;
  };
  for (let i = 1; i < data.length; i++) {
    if (data[i] === currentValue) {
      runLength++;
    } else {
      writeVarint(runLength);
      currentValue = data[i];
      runLength = 1;
    }
  }
  writeVarint(runLength);
  return out.slice(0, o);
}
```

First check that `pushVarint` uses exactly this varint layout (LSB-first 7-bit groups, MSB continuation). If it
differs, mirror the existing layout. The output must be **byte-identical** to the old encoder, because persisted masks
are decoded by the existing `decodeRLE`. Keep `pushVarint` if anything else uses it; otherwise delete it.

In `decodeRLE`, replace the inner `for` fill loop with `result.fill(currentValue, position, end);`.

Add `packages/ui/src/lib/utils/rle.test.ts`. Run it with `cd packages/ui && ../../apps/web/node_modules/.bin/vitest run src/lib/utils/rle.test.ts`.
Copy the **old** `encodeRLE` implementation into the test as `legacyEncode` and assert byte equality on: empty, all-zero
1000, all-255 1000, alternating 0/255 1001, random 0/255 100k (seeded LCG), and a run of 300 000. Also round-trip through
`decodeRLE`. This is a `packages/ui` change: list it in your report for a changeset (`patch`).

### MSK-4 Verify

`pnpm --filter @tableslayer/ui package && pnpm --filter @tableslayer/stage build`, then
`pnpm --filter @tableslayer/stage check`, `pnpm --filter web check`, `pnpm --filter docs check`, and the rle test.

---

## Area 5 — Realtime snapshot pipeline (RT) · fixes F9

**Files:** `apps/web/src/lib/realtime/docSchema.ts`, `apps/web/src/lib/realtime/SessionDocClient.svelte.ts`,
`apps/web/src/lib/utils/buildSceneProps.ts`.

### RT-1 Reuse unchanged row objects

In `docSchema.ts`:

1. Add a module-level cache keyed by the Y.Map instance (garbage-collected with it):
   ```ts
   const rowObjectCache = new WeakMap<Y.Map<unknown>, unknown>();
   export const invalidateRowObject = (map: unknown) => {
     if (map instanceof Y.Map) rowObjectCache.delete(map);
   };
   ```
2. In `rowsOf`, use the cache **only when `omit` is undefined**:
   ```ts
   map?.forEach((row) => {
     if (omit !== undefined) return rows.push(yMapToObject<T>(row, omit));
     let obj = rowObjectCache.get(row) as T | undefined;
     if (!obj) {
       obj = yMapToObject<T>(row);
       rowObjectCache.set(row, obj);
     }
     rows.push(obj);
   });
   ```
3. Cached row objects are shared between snapshots, so **nobody may mutate them**. Grep `apps/web/src` for code that
   mutates snapshot rows (`snapshot.markers[`, `.markers.forEach(`, `for (const m of snapshot`) and check each hit only reads.
   `buildSceneProps` maps rows into new objects, which is fine. Note in your report any place that mutates rows. If you find
   one, make it copy first.

In `SessionDocClient.svelte.ts`, in the `observeDeep` handler on `'scenes'`, invalidate before classifying:

```ts
this.doc.getMap('scenes').observeDeep((events, transaction) => {
  for (const event of events) invalidateRowObject(event.target);
  …existing code…
});
```

A field change inside a row has `event.target === rowMap`, so its cache entry is dropped. Added or removed rows are new or
gone Y.Map instances. Import `invalidateRowObject` from `./docSchema`.

Add a unit test in `apps/web/src/lib/realtime/docSchema.test.ts`, appended to the existing file and following its setup
pattern. It checks that two `getSceneSnapshot` calls with no change return the **same** marker object (`toBe`), and that after
setting one marker field (and calling `invalidateRowObject` on that row's Y.Map, the way the client does) only that marker is a
new object.

### RT-2 Memoize the expensive pure helpers in `buildSceneProps`

At module level in `buildSceneProps.ts`:

```ts
let gradientMemo: { key: string; value: ReturnType<typeof generateGradientColors> } | null = null;
const gradientColorsFor = (color: string) => {
  if (gradientMemo?.key !== color) gradientMemo = { key: color, value: generateGradientColors(color) };
  return gradientMemo.value;
};
let fogRoomsMemo: { key: unknown; value: ReturnType<typeof parseFogRooms> } | null = null;
const fogRoomsFor = (raw: unknown) => {
  if (!fogRoomsMemo || fogRoomsMemo.key !== raw) fogRoomsMemo = { key: raw, value: parseFogRooms(raw as never) };
  return fogRoomsMemo.value;
};
```

Use `gradientColorsFor(...)` and `fogRoomsFor(activeScene.fogOfWarRooms)` in place of the direct calls. Match the
`parseFogRooms` parameter type exactly (look at its signature in `packages/stage/.../helpers/fogRooms.ts`) instead of casting with `never`.
**Important:** the returned arrays/objects are reused across builds, and stageProps is deep `$state`, so a shared reference could
be mutated through the proxy. Return copies for safety: `rooms: fogRoomsFor(...).map((room) => ({ ...room, points: [...room.points] }))`
and spread the gradient array: `const fogColors = [...gradientColorsFor(...)]`. These copies are cheap. The saving is the parse and
chroma work.

### RT-3 Verify

`cd apps/web && npx vitest run src/lib/realtime src/lib/utils` and `pnpm --filter web check`.

---

## Area 6 — Server, persistence and image delivery (SRV/IMG) · fixes F6, F8, F12

**Files:** `apps/web/src/lib/server/realtime/index.ts`, `apps/web/src/routes/(app)/[party]/[gameSession]/[[selectedScene]]/+page.server.ts`,
`apps/web/src/routes/assets/[...path]/+server.ts`, `apps/web/src/lib/utils/generateR2Url.ts`.

### SRV-1 Batch the row persistence

`replaceRows` in `server/realtime/index.ts`: build all statements, then send them in **one** `db.batch` (drizzle libsql
batch = one round-trip, executed atomically; `resilientClient.ts` already passes `batch` through with retry, and every statement
here is idempotent, so a retry is safe):

```ts
const replaceRows = async <T extends { id: string; sceneId: string }>(table: …, sceneId: string, rows: T[]) => {
  if (rows.length === 0) {
    await db.delete(table).where(eq(table.sceneId, sceneId));
    return;
  }
  const ids = rows.map((row) => row.id);
  await db.batch([
    db.delete(table).where(and(eq(table.sceneId, sceneId), notInArray(table.id, ids))),
    ...rows.map((row) => db.insert(table).values(row).onConflictDoUpdate({ target: table.id, set: row }))
  ]);
};
```

`db.batch` needs a non-empty tuple type. If TypeScript complains, type the array as
`[BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]` (import `BatchItem` from `drizzle-orm/batch`). Check how other code in
the repo calls `db.batch` first (`grep -rn "db.batch" apps/web/src`) and follow that pattern.

### SRV-2 Flatten the editor load waterfall

In `+page.server.ts`, after `sceneFromList` is resolved, fetch `getScene` and `getUserChecklistState` in the **same**
`Promise.all` as the markers/lights/annotations/masks. All of them only need `sceneFromList.id` / `user.id`:

```ts
const [selectedScene, selectedSceneMarkers, selectedSceneLights, selectedSceneAnnotations, fogMaskResult, annotationMasks, checklistState] =
  await Promise.all([
    getScene(sceneFromList.id),
    getMarkersForScene(sceneFromList.id),
    …same as today but with sceneFromList.id…,
    getUserChecklistState(user.id)
  ]);
```

Then delete the later `await getUserChecklistState(...)` line. Behaviour is otherwise unchanged.

### IMG-1 Modern image formats

In `generateR2Url.ts`, when there are transforms (`transforms.length > 0`), also push `format=auto`, so Cloudflare serves
AVIF/WebP based on the browser's `Accept` header. Do this inside the `if (transforms.length > 0)` branch, after the other
options. Video/GIF and the default map are already excluded earlier, so leave that as it is.

### SRV-3 Local asset route (self-hosted mode)

In `routes/assets/[...path]/+server.ts`:

1. When `options.get('format') === 'auto'` (or `'webp'`), encode the resized image with `.webp({ quality: 85 })` and
   `content-type: image/webp`. Otherwise keep `.png()`. The existing `format === 'json'` branch must keep working.
2. Add a small in-memory LRU for transformed outputs. Use a module-level `Map<string, { body: Uint8Array; type: string; etag: string }>`
   with max 100 entries. The key is `${key}|${w}|${h}|${fit}|${format}`. On a hit, move the entry to the end (delete + set). On insert, evict the
   oldest when the map is over 100. Only cache bodies under 5 MB.
3. Caching headers: keys starting with `originals/` are immutable (fresh key per upload, see web-data-patterns skill), so
   send `cache-control: public, max-age=31536000, immutable` for them and their transforms. Keep `no-cache` for every other key.
   Add an `etag` (sha1 of the body, hex, quoted). If the request's `if-none-match` equals it, return `new Response(null, { status: 304, headers })`.
   You'll need `request` from the handler event for this.
   Keep the existing security headers (`x-content-type-options`, `content-security-policy`) on every response.

### SRV-4 Verify

`pnpm --filter web check`, `cd apps/web && npx vitest run src/lib/server src/lib/utils`.

---

## Area 7 — Stage textures and memory (TEX) · fixes F7, F11

**Files:** `packages/stage/src/lib/components/Stage/components/MapLayer/dataSources/ImageDataSource.ts`,
`packages/stage/src/lib/components/Stage/helpers/tokenRasterCache.ts`.

### TEX-1 Decode maps off the main thread

Rewrite `ImageDataSource.load` to use `THREE.ImageBitmapLoader`:

```ts
private loader = new THREE.ImageBitmapLoader().setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none' });

async load(url: string): Promise<void> {
  this.dispose();
  this.loader.setCrossOrigin('anonymous');
  const bitmap = await this.loader.loadAsync(url);
  const texture = new THREE.Texture(bitmap);
  texture.flipY = false; // already flipped by createImageBitmap
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  this.texture = texture;
  this.size = { width: bitmap.width, height: bitmap.height };
}
```

In `dispose()`, also call `(this.texture.image as ImageBitmap | undefined)?.close?.()` before `texture.dispose()`.
Check:

- `TextureLoader` sets `crossOrigin` to `'anonymous'` by default. Keep that, or CORS-tainted textures will fail.
- `ImageBitmapLoader` caches results in `THREE.Cache` only when `THREE.Cache.enabled`. It is off by default; leave it off.
- `Scene.svelte` `generateThumbnail` reads `texture.image.width/height` and calls `texture.clone()`. `ImageBitmap` has
  `width/height`, so it works unchanged. Do **not** close the bitmap while the texture is in use.
- Error path: keep the `console.error('Failed to load image:', error)` and rethrow.

### TEX-2 Bound the token image cache

In `tokenRasterCache.ts`, make `imageCache` an LRU capped at 128 entries. On a hit in `loadTokenImage`, `delete` and re-`set`
the entry to mark it recently used. After inserting, while `imageCache.size > 128`, delete the oldest key (`imageCache.keys().next().value`).
**Do not call `bitmap.close()`** on eviction. A token may still be about to draw it. Dropping the reference is enough, and
the GC frees it once no token holds it.

### TEX-3 Verify

`pnpm --filter @tableslayer/stage check`. The user checks visually that maps (JPEG, PNG with transparency) render the right
way up and in the right colours in the docs stage route and the editor.

---

## Implementation plan and ownership (parallel, disjoint files)

| Agent | Area                            | Packages touched                       | Changeset?  |
| ----- | ------------------------------- | -------------------------------------- | ----------- |
| A     | 1 BND                           | apps/web, packages/ui, packages/stage  | ui: `patch` |
| B     | 2 FRM                           | packages/stage                         | –           |
| C     | 3 FOG + 7 TEX                   | packages/stage                         | –           |
| D     | 4 MSK                           | packages/stage, packages/ui, web, docs | ui: `patch` |
| E     | 5 RT                            | apps/web                               | –           |
| F     | 6 SRV/IMG                       | apps/web                               | –           |
| Lead  | skill/doc updates + full gates  | `.claude/skills`, `docs/`              | –           |

Only agent D rebuilds `packages/stage/dist` and `packages/ui/dist` (needed for `web check`). The others run `check` on
their own package. After all agents finish, the lead runs the full gates (`pnpm run check`, `pnpm run format-check`, all unit
tests), updates `.claude/skills/stage-rendering/SKILL.md` (frame pacing, lazy blobs, async readback, ImageBitmap maps, shader
hoist) and `docs/stage-performance-guide.md`, and bumps "last verified".

## Testing strategy

- Unit: `framePacing.test.ts` (new), `rle.test.ts` (new, byte-identical to the legacy encoder), `docSchema.test.ts` (row identity),
  existing stage/web suites.
- Bundle: BND-4 script before and after.
- Manual (user):
  1. Docs stage route, F9 overlay: idle fps by tier; fog of war looks identical; draw fog/annotation strokes with no hitch at stroke end.
  2. Editor: scene switch with a large map (no long task > 100 ms in a DevTools performance trace); remote token drag from a second window stays smooth.
  3. Playfield TV: idle GPU usage lower (OS GPU monitor) on medium tier.
  4. Network tab: map/thumbnail responses are `image/avif` or `image/webp`.

## Edge cases

- Frame pacing: a texture that finishes loading asynchronously while idle (token art) shows up on the next idle frame (≤ 50 ms). That's fine.
- Frame pacing: thumbnail generation (`generateThumbnail`) renders directly and is not affected by pacing.
- Async readback: the scene switches during an in-flight `toRLE`. Existing callers capture `sceneId` before awaiting. Keep that.
- `format=auto` doubles CDN cache variants. Cloudflare keys on Accept automatically.
- RLE: the output must stay byte-identical, because older clients and persisted data decode it.
- Row cache: cached snapshot rows must never be mutated (RT-1 step 3).

## Decisions (user, 2026-10-18)

1. Idle frame cap: **medium/low tiers only** (`high: null`, as written in FRM-1).
2. Fonts: **preload only**, no subsetting.
3. Implement in the current working tree on top of the uncommitted `feature/dnd-combat-polish` work. Nothing gets staged or committed.
