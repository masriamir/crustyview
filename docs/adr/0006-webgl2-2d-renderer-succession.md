# ADR-0006: Keep the 2D map on canvas 2D, with a measured WebGL2 renderer recorded as its successor

- **Status:** Proposed
- **Date:** 2026-08-16
- **Deciders:** Amir Masri
- **Tracking issue / PR:** [#157](https://github.com/masriamir/crustyview/issues/157)

## Context and problem statement

[ADR-0005](0005-scale-keyed-render-cache-for-the-2d-map.md) fixed the 2D map's pan cost with a
scale-keyed bitmap cache and deferred its option 4 — a GPU-backed (WebGL2) renderer — to spike
#157, listing three unpriced costs: the drawing treatment is "all real work in GL", the swap
"would replace a thoroughly tested component", and a fallback "doubles the renderer surface
permanently". [ADR-0002](0002-hybrid-portable-core-svelte-shell.md) draws the line "`wgpu` = 3D
only; everything 2D and DOM = TypeScript", and #157 is explicit that a GPU 2D map must not arrive
by quietly reinterpreting it. The spike built the prototype and priced the questions. What should
the 2D map's renderer be now, and what does the answer do to ADR-0002?

## Decision drivers

- **The remaining canvas-2D cost is confined to rebuilds.** Panning and settled zooming are a
  ~3 ms blit at every zoom. What still costs 150–200 ms is rendering the tile itself: map open,
  preference toggle, and the crisp re-render ~120 ms after a zoom settles. ADR-0005 accepted the
  first two as one-off moments where a pause reads as loading; nothing shipped or queued is
  blocked by them today.
- **ADR-0002's boundary must be moved deliberately or reaffirmed deliberately** — its crisp line
  reads as "the 2D map is a canvas-2D/DOM concern", and a WebGL2 renderer in TypeScript honors
  the letter while cutting against that reading.
- **The component's test surface is an asset with a defect history behind it** (#127, #128,
  #131 — the browser tier exists because of them). What a renderer swap does to those assertions
  is a first-order cost, not a footnote.
- **A GPU renderer needs an answer for WebGL2-unavailable and context-loss**, and every answer
  shapes the renderer surface permanently.

## Considered options

1. Adopt the WebGL2 renderer now, replacing the canvas-2D draw path and the ADR-0005 cache.
2. **Keep canvas 2D + the cache shipped; record the WebGL2 renderer as the successor, amend
   ADR-0002's line, and name the adoption triggers.** *(Chosen.)*
3. Reaffirm ADR-0002 as-is and close the GPU question — canvas 2D indefinitely.
4. Move the 2D map into the portable Rust/`wgpu` core (reopen ADR-0002's reuse boundary for 2D).

## Decision outcome

Chosen option: **2**. The spike removed the *feasibility* question — the GPU path works, holds
60 Hz on the worst fixture on weak hardware, and its hard parts are bounded, not open-ended. What
it did not produce is a reason to pay the adoption cost now: no shipped or queued feature is
blocked by the two accepted one-off hitches, and the pan path a GPU cannot improve is already
3 ms. So the decision is to bank the evidence and move the boundary explicitly rather than adopt
under no pressure.

### What the spike measured

Prototype: a WebGL2 instanced renderer (~300 lines plus a harness page) drawing the base
linedefs — three kinds, per-kind widths and colors, painted back-to-front — and all three dashed
overlays with their rhythms and the damage phase offset in a fragment shader, at DPI-correct
feathered antialiasing, full-map redraw every frame, no cache, no tiles, no culling. Measured
with the #152 harness's methodology (same canvas, pan route, schedule, priming sweep, percentile
math; honest flush = 1×1 `readPixels`) on Eviternity II MAP26 (64,782 lines), Chrome 151 headed,
dpr 2, on an Intel UHD 630 — an iGPU chosen by circumstance and useful as a conservative floor.

| what | canvas 2D (same session) | WebGL2 prototype |
|---|---|---|
| full redraw, fit | 131.5 ms median | every frame, at 60 Hz |
| tile rebuild | 159 ms at fit · 197 ms at 4× | concept does not exist |
| pan frame | 2.7 ms (blit) · p95 196 ms at 4× (rebuilds) | same 60 Hz frame |
| rAF interval, fit/4×/8× | — | median 16.7 ms; p95 18.5 ms (MSAA off) |
| CPU submit per frame | — | 0.0–0.1 ms |
| GPU frame, serialized | — | ~2 ms (MSAA off, net of instrument) |
| one-time per map | first paint = one rebuild | pack 21.7 ms + upload 1.6 ms |

Two hardware-shaped findings worth keeping: 4× MSAA cost ~5% dropped frames (p95 ~33 ms) on the
two ≥62k-line fixtures on the UHD 630, while shader-feather antialiasing alone held both 60 Hz
and line quality — so MSAA is a quality knob, not a requirement. And a per-frame `readPixels`
sync reads 12–15 ms regardless of scene size; it measures pipeline-drain latency, not rendering,
which is why the 60 Hz claim rests on rAF intervals under continuous redraw.

### The four questions, answered

1. **How much of the treatment survives a shader?** All of it, at bounded cost. The parts
   ADR-0005 flagged hardest — three dash rhythms with a phase offset — are implemented and
   verified: dashes parameterized by arc length per segment reproduce canvas semantics (each
   segment is its own subpath, so phase starts at 0), including the secret/damage interleave on
   shared edges. Arrowheads and start darts are computed triangles in the existing code, not
   canvas transforms — they instance directly. Link bows are quadratics evaluable in a vertex
   shader (~100 capped instances). Antialiasing at arbitrary DPI is a one-pixel feather in the
   fragment shader, demonstrated. What GL does not give back is the platform's leverage: the
   ~540-line `render.ts` becomes more code that does less per line, and `globalAlpha`-style
   compositing must be re-derived as blend state.
2. **What happens to the tested behavior?** The unit tier (96 blocks across 7 map2d modules)
   survives untouched — it is pure math. `tile.test.ts` and `renderKey.test.ts` become obsolete
   with their subject matter, not broken. The browser tier fails at one choke point first: the
   shared `painted()` helper calls `getContext('2d')`, which returns `null` on a WebGL-bound
   canvas — silently, so nine files would redden at setup until it is ported to `readPixels`.
   After that, the a11y-observing files (#127's announcement tests among them) pass unchanged;
   roughly eight pixel-counting files need rewrites against `readPixels` with re-derived ink
   constants; the two tile-cache files die with the cache. E2E's `toDataURL` comparisons carry a
   false-green trap: on a WebGL canvas without `preserveDrawingBuffer` they compare blank to
   blank and pass vacuously.
3. **What is the fallback?** Keep the canvas-2D renderer — it exists, it is tested, and the
   product position (a viewer that works everywhere, per ADR-0002's error ethos) rules out a
   GPU-required 2D map. That is the permanent-double-surface cost ADR-0005 predicted, and it is
   the main standing argument of this ADR: the swap is not a replacement but an addition, and
   both paths must keep passing their tests.
4. **Does this reopen the `wgpu` question?** No. ADR-0002's boundary is drawn by cost-to-rebuild
   and cost-to-marshal, and both still point at TypeScript for the 2D map: its data is small
   derived JSON, and a TS WebGL2 renderer is an afternoon-scale prototype where a `wgpu`-core 2D
   renderer would couple the shipped 2D map to the phase-3 renderer that does not exist yet,
   inverting the staging that ADR-0002 chose ("3D must not gate the early wins"). GPU ≠ `wgpu`:
   the amendment below moves the GPU line, not the language line.

### The amendment to ADR-0002

ADR-0002's crisp line — "`wgpu` = 3D only; everything 2D and DOM = TypeScript" — stays, with one
clause made explicit: *TypeScript may target WebGL2 for the 2D map when measured performance
demands it.* GPU use is no longer definitionally 3D-only; `wgpu` and portable Rust remain 3D-only.
ADR-0002 is **amended, not superseded** — every other decision in it (crate split, boundary rule,
Svelte shell, staging) is untouched.

### Adoption triggers

Adopt the WebGL2 renderer — as the fast path in front of the kept canvas-2D fallback — when any
of these becomes true, rather than re-litigating from scratch:

- A feature needs **per-frame full-map redraws** that the live-overlay-atop-the-blit pattern
  cannot express (dynamic emphasis baked into the base layer, animated overlays, or line counts
  that outgrow the tile budget).
- The one-off rebuild hitch **stops reading as loading** — treatment growth pushes it far past
  ~200 ms, or it starts landing inside continuous interactions.
- **#156 (worker rendering) is about to be built.** Its entire value is hiding a cost the GPU
  deletes; at that decision point, this is the better spend of a comparable lift.

### Consequences

- Good, because the GPU path is now priced by working code and measured numbers rather than
  feared — the next decision at a trigger point is an execution decision, not a research one.
- Good, because ADR-0002's boundary moved in the open: a future WebGL2 renderer arrives as this
  ADR's planned successor, not as a reinterpretation.
- Good, because nothing shipped changes — the cache, the tests, and the queued features (#148's
  live-emphasis pattern included) proceed exactly as ADR-0005 set up.
- Bad, because the prototype's evidence will age: browsers, hardware, and the treatment all
  move, and a trigger firing years from now should re-verify the headline numbers before
  building on them.
- Bad, because "successor recorded, triggers named" is still a deferred cost: when a trigger
  fires, the test-surface rewrite (question 2) and the double renderer surface (question 3) are
  paid in full then.
- Neutral, because #156 remains open as ADR-0005 left it, now with a recorded comparison to
  weigh at its decision point.

## Pros and cons of the options

### 1 — Adopt the WebGL2 renderer now

- Good, because it deletes the rebuild concept, the cache state, the settle timer, and the blit
  softness in one move, with measured headroom on weak hardware.
- Bad, because nothing currently shipped or queued needs it — the cost it removes is two
  accepted one-off hitches — and it spends a large test-surface rewrite plus a permanent second
  renderer surface to remove them.

### 2 — Keep canvas 2D; record the successor and its triggers (chosen)

- Good, because it converts the spike's evidence into a standing decision at zero product risk.
- Bad, because the adoption cost is deferred, not avoided, and the evidence decays.

### 3 — Reaffirm ADR-0002 as-is, canvas 2D indefinitely

- Good, because it is the simplest reading and today's renderer genuinely suffices.
- Bad, because it discards what the spike proved and guarantees the next performance wall
  re-runs this investigation from zero — the exact waste the spike exists to prevent.

### 4 — Move the 2D map into the portable Rust/`wgpu` core

- Good, because one renderer stack could eventually serve both 2D and 3D.
- Bad, because it couples the shipped 2D map to the unbuilt phase-3 renderer, marshals nothing
  worth marshaling (the 2D payload is small JSON), and spends ADR-0002's reuse budget on the
  part it deliberately classed as cheap.

## More information

The prototype and its measurement page live with the gitignored benchmark harness
(`web/gl.html`, `web/src/bench/gl/`, `web/gl-run.mjs`; committing that family is #164) and
follow the harness's methodology contract — priming sweep, explicit query-string configuration,
median beside p95, instrument-cost control rows. The full measurement matrix and both rendered
screenshots are on #157. Related: ADR-0002 (amended by this ADR), ADR-0005 (whose §More
information anticipated this spike), #148/#156 (the queued work the triggers reference).

Revisit if a trigger fires — re-verify the measurements before building — or if `wgpu`'s phase-3
viewport lands with line-rendering machinery that changes option 4's economics.
