# ADR-0005: Cache the 2D map in a scale-keyed bitmap and blit it, rather than drawing less or moving to a GPU

- **Status:** Accepted
- **Date:** 2026-08-14
- **Deciders:** Amir Masri
- **Tracking issue / PR:** [#152](https://github.com/masriamir/crustyview/issues/152)

## Context and problem statement

Panning the 2D map on any modern megawad runs 3–6× over the 16.7 ms frame budget before a single
overlay is drawn: a fit-zoom redraw of Eviternity II MAP26 (64,782 lines) costs 95 ms with teleport
links off. Eviternity II MAP33 is the control that isolates it — 62,307 lines but only 118 links, so
its link cost is +11 ms and it still redraws in 76 ms. The base map is the problem, not any overlay.

Viewport culling (ADR-less, #153) does not help here: at fit zoom 60,459 of MAP26's 64,782 lines are
on screen, so there is nothing to skip, and culled measured 248 ms against 246 ms unculled. A
base/overlay canvas split does not help either, because the base layer changes on every pan frame by
definition.

How should the 2D map be rendered so that a megawad feels responsive, and how far from canvas 2D is
it worth moving to get there?

## Decision drivers

- **The cost is rasterization, not JavaScript.** A static MAP26 view reads 12 ms unflushed against
  249 ms flushed, and the same map at 8× culled reaches 4 ms while still running the full 64k-line
  loop. Optimizing the JavaScript path — for example building the `Path2D`s once in map space and
  letting `ctx.setTransform` project them — recovers roughly 10 ms of 95 ms.
- **Responsiveness is wanted generally, not only while panning.** The same 95 ms lands on opening a
  map, toggling a chip, resizing, and every frame of a wheel-zoom burst.
- **`Map2d.svelte` has a defect history in its effect wiring** (#127, #128, #131) and the browser
  test tier (#129) exists because nothing else observes it. Any new state must not enlarge that
  surface without also making it easier to reason about.
- **ADR-0002 places the 2D map in TypeScript on canvas 2D**, with `wgpu` reserved for the 3D
  viewport. Moving the 2D map onto a GPU is a decision about that ADR, not an implementation detail.

## Considered options

1. Draw less at low zoom — decimate or simplify geometry where many segments land on the same pixels.
2. Cache the drawn map in an offscreen bitmap keyed on everything except translation, and blit it.
3. Cache as in option 2, but render it in a worker via `OffscreenCanvas` so nothing ever blocks.
4. Replace the canvas-2D map with a GPU-backed (WebGL2) renderer.

## Decision outcome

Chosen option: **"2 — a scale-keyed bitmap cache"**, because it is the only option that both fixes
the measured problem and stays inside the existing draw path, and because option 1 was measured to be
incapable of fixing it.

`draw()` is a pure function of (map, scale, preferences, theme, translation), and during a pan **only
translation changes**. So the picture at a given scale is rendered once into an offscreen tile and
blitted; a wheel or pinch gesture blits the tile scaled and re-renders crisply once the scale settles.

Two properties made this preferable to the alternatives rather than merely cheaper:

- **The cache is cheapest exactly where it is needed.** At fit zoom a redraw costs 95 ms but the whole
  map at fit scale is about viewport-sized, so the tile can cover the entire map and panning never
  re-renders at all. As zoom increases the whole-map tile grows past any sane budget — but culling has
  already brought redraws to 4 ms at 8×. The two techniques cover opposite ends of the zoom range and
  hand off to each other.
- **The blit is positionally exact, even while zooming.** It places the tile where the *current*
  transform would put its content, so geometry is at the right place and the right size mid-gesture;
  only stroke widths and antialiasing are stale. That is the milder half of the trade-off #152
  anticipated as "momentary softness or stale line widths".

Option 3 is accepted as the follow-up, held in reserve, tracked as
[#156](https://github.com/masriamir/crustyview/issues/156). Option 4 is deferred to a spike,
[#157](https://github.com/masriamir/crustyview/issues/157), whose output is an ADR that supersedes,
amends or reaffirms ADR-0002.

### Consequences

- Good, because every continuous gesture — pan, pinch, wheel, resize drag — becomes a `drawImage` of
  roughly 1 ms, independent of line count.
- Good, because it forces a simplification the component already needed. `draw()` runs outside the
  redraw `$effect`'s tracking context, so that effect has to name every dependency by hand — fifteen
  of them before this change. The cache's invalidation key collapses ten of those (the preference,
  style and theme dependencies) into one derived value, leaving six: the canvas, the map data, the
  transform, the width, the height and the key. It also covers `game`, which the hand-written list
  never tracked at all. A preference missing from the key then fails to invalidate the cache *and*
  fails to schedule a redraw, so the symptom is a picture that does not change at all rather than one
  that changes everywhere except the cached layer — loud instead of silent.
- Bad, because first paint of a map and every preference toggle still cost one full ~95 ms blocking
  render. They invalidate the key by definition. Accepted because both are one-off moments where a
  pause reads as loading, and because #156 is additive on top of the same cache rather than a rewrite
  of it.
- Bad, because it introduces stateful caching into the component with the worst lifecycle record in
  the codebase. A missed invalidation shows a stale map, which is worse than a slow one.
- Neutral, because it does not close off option 4. Nothing here has to be undone to adopt a GPU
  renderer later; the cache simply becomes unnecessary.

## Pros and cons of the options

### 1 — Draw less at low zoom

- Good, because it would reduce *every* draw, including first paint and preference toggles, which the
  chosen option does not.
- Good, because it needs no new state and cannot go stale.
- **Bad, because it was measured and cannot fix the problem.** Projecting every line of six real maps
  at fit zoom and applying two safe rules — drop segments whose endpoints land on the same device
  pixel, drop segments duplicating another after quantizing to device pixels — keeps 87.0% of MAP26's
  segments and 93.5% of its ink at DPR 2. That is 95 ms → about 83 ms.
- Bad, because the reason is structural: doubling the device resolution halves the sub-pixel
  population, so the technique is weakest on the retina hardware the app is actually used on. At DPR 1
  it keeps 68.1%, still only a 1.5× lever.
- Bad, because the aggressive form that reaches 40% on MAP26 — dropping everything under 2 device
  pixels — visibly erases architecture, and still only reaches about 55 ms.

### 2 — Scale-keyed bitmap cache (chosen)

- Good, because it removes the dominant cost rather than reducing it, and does so without changing
  what the map looks like when at rest.
- Good, because it is contained to the draw path and introduces no new runtime surface.
- Good, because the tile is transparent and the grid stays live, so the existing paint order is
  preserved and the grid remains crisp during a scaled blit.
- Bad, because the blit offset must be rounded to whole device pixels or `drawImage` resamples on
  every pan and the map becomes permanently soft — strictly worse than today. The rounding costs up to
  half a device pixel of positional error.
- Bad, because a gesture's settle timer is exactly the shape of the #127 defect, and must not be
  cleaned up by the redraw effect that tracks `transform`.

### 3 — Cache rendered in a worker (`OffscreenCanvas`)

- Good, because nothing ever blocks the main thread, so first paint and preference toggles are covered
  too.
- Bad, because 64k lines cannot be structured-cloned per render; it needs a packed transferable
  representation and an owner for it.
- Bad, because the palette comes from `getComputedStyle` on CSS custom properties, which a worker
  cannot read — it has to be resolved on the main thread and re-passed on every theme change.
- Bad, because the browser test tier (#129) cannot see inside a worker, so the compensating control
  built for this component's timing bugs stops applying to the part doing the work.

### 4 — GPU-backed (WebGL2) 2D renderer

- Good, because 64k line segments is one instanced draw call, well under a millisecond, at every zoom,
  with no cache state, no invalidation surface, and no blit softness.
- Good, because it is the only option that scales with the map growing further — more overlays, more
  per-frame emphasis work (#148), higher line counts.
- Bad, because dashed overlays with three rhythms and a phase offset, quadratic-bezier link bows,
  rotated arrow glyphs and DPI-correct antialiasing are all trivial on canvas 2D and all real work in
  GL.
- Bad, because it would replace a thoroughly tested component, invalidating assertions from #66/#67,
  #72, #129 and #153.
- Bad, because a context-loss or no-WebGL2 fallback keeps the canvas-2D path alive permanently,
  doubling the renderer surface.

## More information

The decimation figures come from projecting every line of six maps at fit zoom in a 1010×700 viewport
— fit scale per `fitTransform` with its 24 px margin, times the device pixel ratio under test — then
counting segments whose endpoints round to the same device pixel and segments duplicating another
after the same rounding. It needs no browser; the node bundle
(`wasm-pack build crates/crustyview-web --target nodejs`) is enough. Frame timings come from #152's
harness, whose two methodology traps are recorded on that issue: Canvas 2D queues work, so the flush
must sit inside the timed region, and a pan route that swings far off screen measures nothing because
the canvas clips cheaply.

Revisit this decision if #156 lands and the two remaining blocking renders are still felt, or if
#157's spike shows the GPU path is cheaper to adopt than expected. Related: ADR-0002 (the 2D/3D
split this decision stays inside) and ADR-0003 (the viewer shell the map lives in).
