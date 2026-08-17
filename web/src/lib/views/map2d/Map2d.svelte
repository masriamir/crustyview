<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { Map2d } from '../../format';
  import { wad } from '../../stores/wad.svelte';
  import { mapCursor } from '../../stores/mapCursor.svelte';
  import { mapPrefs } from '../../stores/mapPrefs.svelte';
  import { theme } from '../../stores/theme.svelte';
  import { fitTransform, panBy, screenToMap, zoomAt, type Transform } from './transform';
  import { countByCategory, type ThingCategory } from './things';
  import { effectiveGridSize, gridDrawnSuffix, stepGridSize, type GridSize } from './grid';
  import { arcCapName, selectArcs, stepArcCap } from './teleportArcs';
  import { LINK_CULL_PAD_PX, visibleLinks } from './linkGeometry';
  import { viewportRect } from './cull';
  import { renderKey, tileKey, type TileKeyInput } from './renderKey';
  import {
    blitRects,
    planTile,
    tileCovers,
    MAX_TILE_AREA_PX,
    MAX_TILE_SIDE_PX,
    TILE_MARGIN_FRACTION,
    type TileBudget,
    type TileSpec,
  } from './tile';
  import { drawGrid, drawMapLayers, resolvePalette, TILE_PAD_PX, type Palette } from './render';
  import { createGridAnnouncer } from './gridAnnouncer';
  import {
    createGlRenderer,
    parsePalette,
    type GlFrame,
    type GlMapRenderer,
    type GlPalette,
  } from './gl/renderer';

  interface Props {
    name: string;
    /**
     * The ladder size actually drawn: `undefined` when nothing is known — no
     * draw has resolved a transform yet, or the last one bailed out at one of
     * `draw()`'s early returns — and `null` when even the largest ladder member
     * is too dense at this zoom. Map2d owns the value; the parent only reads
     * it, for the toolbar label (#76).
     */
    drawnGridSize?: GridSize | null;
    /**
     * Which backend draws the map (#177). `'canvas'` — the default, and what
     * every caller gets until PR 3 introduces the auto choice — is the 2D path
     * this component has always had. `'gl'` selects the WebGL2 renderer, which
     * falls back to the canvas path by itself when its context cannot be
     * created or is lost for good, so a caller never has to handle that.
     *
     * Mount-time, not a live setting: switching it replaces the canvas element
     * (see the `{#key}` block below), because a canvas keeps its first context
     * for life.
     */
    renderer?: 'gl' | 'canvas';
    /**
     * Test mounts only: threads `preserveDrawingBuffer: true` into the GL
     * context so a browser test can `readPixels` a frame after the browser has
     * composited it. Off in production, where nothing reads the buffer back
     * and the flag costs a copy per frame.
     */
    glProbe?: boolean;
  }
  let {
    name,
    drawnGridSize = $bindable(undefined),
    renderer = 'canvas',
    glProbe = false,
  }: Props = $props();

  /** aria-describedby target for the canvas operating instructions. */
  const instructionsId = $props.id();

  /** One wheel notch / keypress zoom step, and the zoom range as multiples of the fit scale. */
  const ZOOM_STEP = 1.1;
  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 20;
  /** Keyboard pan step, as a fraction of the viewport. */
  const PAN_FRACTION = 0.1;

  let container = $state<HTMLDivElement>();
  let canvas = $state<HTMLCanvasElement>();
  let transform = $state<Transform | null>(null); // null until the first fit
  let width = $state(0);
  let height = $state(0);
  /** Scale of the most recent fit — both the zoom clamp and the readout are relative to it. */
  let fitScale = $state(1);
  /** A pointer is down and panning/pinching, so the canvas shows a closed-hand cursor. */
  let dragging = $state(false);
  /** Polite live-region text for grid size changes ("Grid 64"). */
  let gridAnnouncement = $state('');
  /** Polite live-region text for arc-cap changes. Separate from the grid's
   *  region deliberately: that one carries a debounce and three defect fixes
   *  (#127/#128/#131), and this announcement is immediate — a keypress, not a
   *  gesture — so it has nothing to share with it. */
  let arcCapAnnouncement = $state('');
  // The announcer owns the timer/baseline; this component owns the reactive
  // sink. dispose() runs in onDestroy and nowhere else in the reactive graph —
  // NOT the redraw effect's teardown, which re-runs per transform tick (#127).
  const gridAnnouncer = createGridAnnouncer((text) => {
    gridAnnouncement = text;
  });

  /**
   * The live WebGL2 renderer, or `null` on the canvas path. Deliberately NOT
   * reactive: one effect creates and tears it down, and `draw()` — which runs
   * inside a rAF callback, outside any tracking context — is the only reader.
   * `glActive` is the reactive signal, so nothing has to observe this handle.
   */
  let glRenderer: GlMapRenderer | null = null;
  /**
   * GL was asked for and is unusable: `createGlRenderer` returned `null`, or a
   * lost context never came back. One-way for the life of the component —
   * a device that cannot give us a context will not give us one on retry, and
   * a retry loop would be invisible except as a stutter.
   */
  let glFailed = $state(false);
  /** The backend actually in force. */
  const glActive = $derived(renderer === 'gl' && !glFailed);
  /**
   * The map already uploaded into the CURRENT `glRenderer`, compared by
   * identity. Plain bookkeeping, like `fittedFor`: it keeps the two upload
   * sites (a fresh renderer, and a map switch) from packing the same map
   * twice, which costs ~20 ms on a large one.
   */
  let glLoadedMap: Map2d | null = null;

  // `wad.map2d` caches per name behind non-reactive fields, so depend on `phase`
  // explicitly: loading another WAD must re-derive rather than serve a stale map.
  const data = $derived.by((): Map2d | null => {
    void wad.phase;
    return wad.map2d(name);
  });
  const isEmpty = $derived(data !== null && data.lines.length === 0 && data.things.length === 0);

  // Same `phase` dependency discipline as `data`: a new WAD must re-derive.
  const assembleError = $derived.by((): string | null => {
    void wad.phase;
    return wad.map2dError(name);
  });

  /** The map this instance has already fitted — plain bookkeeping, not reactive state. */
  let fittedFor: Map2d | null = null;

  /** Last resolved palette, kept with the `style:theme` key it was resolved for. */
  let cached: { key: string; colors: Palette } | null = null;
  /** The same, for the GL path's parsed floats. */
  let cachedGl: { key: string; colors: GlPalette } | null = null;

  /**
   * The only two things either palette depends on. Spelled once so the two
   * memos below cannot key on different things — the drift that produces a
   * picture updating on one path and not the other (#152's shape).
   */
  function paletteKey(): string {
    return `${mapPrefs.style}:${theme.resolved}`;
  }

  /**
   * Resolve the palette, memoized on the only two things it depends on — the
   * style preference and the resolved theme. `getComputedStyle` flushes style,
   * which would otherwise cost a forced layout on every frame of a pan or zoom.
   * Missing tokens fall back to the classic palette, which is at least
   * internally consistent.
   */
  function palette(el: HTMLCanvasElement): Palette {
    const key = paletteKey();
    if (cached !== null && cached.key === key) return cached.colors;
    const colors = resolvePalette(el, mapPrefs.style);
    cached = { key, colors };
    return colors;
  }

  /**
   * The GL renderer's palette: the same resolved colors, parsed to floats.
   * Memoized beside `palette()` and on the same key, and derived from it
   * rather than from the tokens directly, so the two can never describe
   * different colors. `parsePalette` is deliberately unmemoized itself (it is
   * a plain function of its input); this is the caller that knows when the
   * input actually changed.
   */
  function glPalette(el: HTMLCanvasElement): GlPalette {
    const key = paletteKey();
    if (cachedGl !== null && cachedGl.key === key) return cachedGl.colors;
    const colors = parsePalette(palette(el));
    cachedGl = { key, colors };
    return colors;
  }

  /** Back the canvas with device pixels, then scale the context so drawing is in CSS px. */
  function sizeCanvas(el: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
    const dpr = window.devicePixelRatio || 1;
    const backingWidth = Math.max(1, Math.round(width * dpr));
    const backingHeight = Math.max(1, Math.round(height * dpr));
    // Assigning width/height clears the canvas and resets context state, so only
    // touch them on a real size change.
    if (el.width !== backingWidth) el.width = backingWidth;
    if (el.height !== backingHeight) el.height = backingHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /**
   * `sizeCanvas` for the GL path: the same device-pixel backing store and the
   * same only-on-change rule (assigning either dimension reallocates and
   * clears the drawing buffer), minus the context transform — GL takes `dpr`
   * as a uniform and does the scaling in the vertex shader.
   */
  function sizeGlCanvas(el: HTMLCanvasElement): void {
    const dpr = window.devicePixelRatio || 1;
    const backingWidth = Math.max(1, Math.round(width * dpr));
    const backingHeight = Math.max(1, Math.round(height * dpr));
    if (el.width !== backingWidth) el.width = backingWidth;
    if (el.height !== backingHeight) el.height = backingHeight;
  }

  /** What a rendered tile carries besides its pixels. */
  interface TileState {
    spec: TileSpec;
    key: string;
    map: Map2d;
    /** The ratio the tile was rendered at, compared per draw: `devicePixelRatio`
     *  is not reactive, so it cannot live in the key (#152). */
    dpr: number;
  }

  /** The offscreen surface. One per component, resized rather than recreated. */
  let tileCanvas: HTMLCanvasElement | null = null;
  let tileState: TileState | null = null;

  const TILE_BUDGET = {
    maxSidePx: MAX_TILE_SIDE_PX,
    maxAreaPx: MAX_TILE_AREA_PX,
    marginFraction: TILE_MARGIN_FRACTION,
    padPx: TILE_PAD_PX,
  } satisfies TileBudget;

  /**
   * How long after the last scale change the tile is re-rendered crisply. Long
   * enough to span a wheel burst, short enough that the soft state reads as
   * transient.
   */
  const TILE_SETTLE_MS = 120;
  /** Pending crisp re-render; 0 when none is armed. */
  let tileSettleTimer = 0;
  /**
   * The scale the previous draw ran at, so a draw can tell a zoom tick from a
   * pan. `NaN` before the first draw, which compares unequal to everything and
   * so reads as "moved" — harmless, since the first draw has no tile to keep.
   */
  let lastDrawnScale = Number.NaN;

  /**
   * Arm the crisp re-render, restarting the window on every scale change so a
   * continuing gesture keeps blitting.
   *
   * Cleared in `onDestroy` and nowhere else in the reactive graph. NOT in the
   * redraw `$effect`'s teardown: that effect tracks `transform`, so it re-runs
   * on every wheel notch, pinch move and pan keypress, and Svelte runs a
   * cleanup before each re-run — clearing there would cancel the settle during
   * the exact gesture it exists to serve. That is #127's defect, in a new
   * place, and `zoom, then drag` is where it lands: the drag re-runs the effect
   * at an unchanged scale, so the cancel would never be undone and the map
   * would stay soft until the user let go.
   */
  function scheduleTileSettle(): void {
    if (tileSettleTimer !== 0) window.clearTimeout(tileSettleTimer);
    tileSettleTimer = window.setTimeout(() => {
      tileSettleTimer = 0;
      // Drop the tile and redraw: `draw()` then renders a fresh one at the
      // scale the gesture landed on.
      tileState = null;
      scheduleDraw();
    }, TILE_SETTLE_MS);
  }

  /** A tile re-render for any other reason supersedes a pending settle. */
  function cancelTileSettle(): void {
    if (tileSettleTimer === 0) return;
    window.clearTimeout(tileSettleTimer);
    tileSettleTimer = 0;
  }

  /**
   * Render every scale-dependent layer into the offscreen tile, replacing
   * whatever was there. Returns `null` when no usable tile can be made, which
   * the caller reads as "draw straight to the visible canvas" — the cache is an
   * optimization and must never be the only path to a picture.
   */
  function renderTile(
    map: Map2d,
    t: Transform,
    colors: Palette,
    game: string | null,
    dpr: number,
    key: string,
  ): TileState | null {
    // Plan against the union of the map's bounds and what the view can
    // currently see, never the bounds alone. Every pass culls against the
    // surface it is drawing onto, and the tile is that surface, so a tile
    // clipped to the bounds silently deletes anything outside them — where a
    // direct render draws it. crustywad derives `bounds` from the very lines
    // and things being drawn, so this costs a slightly larger tile on a map
    // smaller than the viewport and changes nothing on a megawad, which is
    // where the cache earns its keep. `culling.browser.test.ts`'s pad fixtures
    // are the case that proves it: they place geometry outside the bounds they
    // declare, and go red against a bounds-clipped tile.
    //
    // The union carries a second consequence that is easy to lose, because the
    // reasoning above is entirely about correctness: it also guarantees the tile
    // is at least viewport-sized on **both** axes, and Chrome has a slow path
    // for exactly the case that would break that guarantee. Measured at dpr 2
    // onto a 1010×700 canvas (#161), a tile smaller than the source rect on
    // both axes blits at ~13 ms against ~2 ms for every larger tile — five
    // times slower while copying fewer pixels than any other case #161
    // measured. Overhanging on one axis only is normal-speed, so it takes
    // both. A tile clipped to `map.bounds` on a map smaller than the viewport
    // would land precisely there, which means this union is load-bearing for
    // frame time as well as for what gets drawn.
    const view = viewportRect(t, width, height, 0);
    const covered = {
      min_x: Math.min(map.bounds.min_x, view.minX),
      min_y: Math.min(map.bounds.min_y, view.minY),
      max_x: Math.max(map.bounds.max_x, view.maxX),
      max_y: Math.max(map.bounds.max_y, view.maxY),
    };
    const planned = planTile(t, width, height, dpr, covered, TILE_BUDGET);
    // `wholeMap` promises validity at any translation, which rests entirely on
    // `bounds` containing every line and thing. crustywad derives it that way —
    // except that `bounds_of` collapses to a zero-area rect at the origin when
    // any side is non-finite (a pathological UDMF coordinate), leaving the
    // finite geometry where it is. Trusting the flag there blits a tile
    // covering only the first viewport and silently drops whatever pans in,
    // with no re-render to correct it. A zero-area bounds is precisely that
    // signal, so fall back to the range-checked tile, which re-renders as soon
    // as the viewport leaves it.
    const boundsAreReal =
      map.bounds.max_x > map.bounds.min_x && map.bounds.max_y > map.bounds.min_y;
    const spec = boundsAreReal ? planned : { ...planned, wholeMap: false };
    if (!(spec.width > 0) || !(spec.height > 0)) return null;
    const el = tileCanvas ?? document.createElement('canvas');
    // Before the surface is adopted or resized: a context failure must not
    // leave a reallocated, unusable canvas behind.
    const tileCtx = el.getContext('2d');
    if (!tileCtx) return null;
    tileCanvas = el;
    const backingWidth = Math.max(1, Math.round(spec.width * dpr));
    const backingHeight = Math.max(1, Math.round(spec.height * dpr));
    // Same rule as `sizeCanvas`: assigning width/height clears the surface and
    // resets context state, so only touch them on a real size change.
    if (el.width !== backingWidth) el.width = backingWidth;
    if (el.height !== backingHeight) el.height = backingHeight;
    tileCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Transparent, not filled: the visible canvas paints the background and the
    // grid underneath, and the tile composites over them.
    tileCtx.clearRect(0, 0, spec.width, spec.height);
    drawMapLayers(tileCtx, map, spec.transform, spec.width, spec.height, colors, game);
    return { spec, key, map, dpr };
  }

  /** Put the tile's content where `t` says it belongs. */
  function blitTile(
    ctx: CanvasRenderingContext2D,
    state: TileState,
    t: Transform,
    dpr: number,
  ): void {
    const el = tileCanvas;
    if (!el) return;
    const r = blitRects(state.spec, t, width, height, dpr);
    // A zero-extent source throws IndexSizeError rather than drawing nothing.
    if (r.sw <= 0 || r.sh <= 0) return;
    ctx.drawImage(el, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh);
  }

  /**
   * What this draw paints through. A discriminated union rather than two
   * nullable locals, so the canvas half of `draw()` keeps a non-null `ctx`
   * after the GL branch returns without an assertion propping it up.
   */
  type DrawSurface =
    | { kind: 'gl'; renderer: GlMapRenderer }
    | { kind: '2d'; ctx: CanvasRenderingContext2D };

  /**
   * The GL path must never ask for a 2D context. A canvas keeps its first
   * context for life, so `getContext('2d')` on a WebGL2-bound canvas answers
   * `null` — which the canvas path reads as "no context available" and bails
   * on, drawing nothing and resetting `drawnGridSize`. Deciding the surface up
   * front is what keeps the GL path clear of that guard.
   *
   * The fall-through below (GL wanted, no renderer yet) stays closed by
   * DECLARATION ORDER: the init effect is declared before the redraw effect,
   * so a mount or a `{#key}` swap re-creates the renderer earlier in the same
   * flush than any draw the redraw effect schedules. Swapping those two
   * effects reopens the window, and it would show up as a silent downgrade to
   * canvas — this line binds the element to 2d, after which GL init on it can
   * only fail — rather than as anything that looks like a bug.
   */
  function resolveSurface(el: HTMLCanvasElement): DrawSurface | null {
    if (glActive && glRenderer !== null) return { kind: 'gl', renderer: glRenderer };
    const ctx = el.getContext('2d');
    return ctx === null ? null : { kind: '2d', ctx };
  }

  /**
   * Everything one GL frame needs, read from the same state the canvas path
   * draws from — the renderer holds no preferences of its own.
   *
   * `arcs` runs the identical cull-then-cap pipeline `drawTeleportLinks`
   * (render.ts) runs, in the same order (#154): cull by endpoint first, then
   * cap what survived. The renderer takes the arcs pre-selected, so a hidden
   * overlay is expressed as an empty array rather than a flag it would have to
   * know about.
   */
  function glFrame(
    el: HTMLCanvasElement,
    map: Map2d,
    t: Transform,
    gridStep: GridSize | null,
  ): GlFrame {
    return {
      transform: t,
      widthCss: width,
      heightCss: height,
      dpr: window.devicePixelRatio || 1,
      palette: glPalette(el),
      // A live uniform: it arrives per frame, which is why the init effect
      // below must not treat it as a reason to rebuild the renderer.
      feather: mapPrefs.glFeather,
      grid: mapPrefs.showGrid ? gridStep : null,
      show: {
        teleportLines: mapPrefs.showTeleportLines,
        secretSectors: mapPrefs.showSecretSectors,
        damagingSectors: mapPrefs.showDamagingSectors,
        things: mapPrefs.showThings,
        playerStart: mapPrefs.showPlayerStart,
        categories: mapPrefs.showCategories,
      },
      arcs:
        mapPrefs.showTeleportArcs && map.links
          ? selectArcs(
              visibleLinks(map.links, viewportRect(t, width, height, LINK_CULL_PAD_PX)),
              mapPrefs.teleportArcCap,
            )
          : [],
    };
  }

  function draw(): void {
    const el = canvas;
    if (!el) {
      drawnGridSize = undefined;
      return;
    }
    const surface = resolveSurface(el);
    if (surface === null) {
      drawnGridSize = undefined;
      return;
    }
    if (surface.kind === 'gl') sizeGlCanvas(el);
    else sizeCanvas(el, surface.ctx);
    const colors = palette(el);
    if (surface.kind === '2d') {
      surface.ctx.fillStyle = colors.bg;
      surface.ctx.fillRect(0, 0, width, height);
    }
    const map = data;
    const t = transform;
    if (!map || !t) {
      // The canvas path already filled its background above; the GL path has
      // to fill its own here, because an `alpha: false` drawing buffer that
      // has never been cleared composites opaque black. Without this, the
      // frame between mount and the first fit flashes black — against a light
      // theme, a visible white-black-map flicker on every GL mount.
      if (surface.kind === 'gl') surface.renderer.clear(glPalette(el).bg);
      drawnGridSize = undefined;
      return;
    }
    const gridStep = effectiveGridSize(mapPrefs.gridSize, t.scale);
    // Assigned whenever a draw actually resolves a transform (i.e. it gets past
    // all three early returns above), including when the grid is hidden: the
    // toolbar label reports what *would* be drawn, and the button is how you
    // turn it on. Reset to `undefined` on every early return instead, so a bail
    // (no canvas, no context, or no map/transform) reports "nothing known"
    // rather than leaving a stale value from whatever was drawn last (#76).
    drawnGridSize = gridStep;
    gridAnnouncer.observeMap(name);
    if (mapPrefs.showGrid) {
      gridAnnouncer.observe(
        true,
        gridStep !== null,
        `Grid ${mapPrefs.gridSize}${gridDrawnSuffix(mapPrefs.gridSize, gridStep)}`,
      );
    } else {
      gridAnnouncer.observe(false, false, '');
    }
    // Everything above this line is renderer-independent and has to stay that
    // way: the `drawnGridSize` contract (#76) and the announcement machine
    // (#127/#128/#131) must behave identically on both backends. That is why
    // the GL branch returns HERE rather than at the top of `draw()` —
    // returning any earlier silently drops the toolbar label and the live
    // region on the GL path, with no test on either that would notice.
    if (surface.kind === 'gl') {
      surface.renderer.draw(glFrame(el, map, t, gridStep));
      return;
    }
    // Narrowed to the 2d surface by the return above; everything below is the
    // canvas path exactly as it was.
    const ctx = surface.ctx;
    if (mapPrefs.showGrid && gridStep !== null)
      drawGrid(ctx, t, width, height, colors.grid, gridStep);

    const game = wad.summary?.game ?? null;
    const dpr = window.devicePixelRatio || 1;
    const key = tileKeyValue;
    const live =
      tileState !== null &&
      tileState.key === key &&
      tileState.map === map &&
      tileState.dpr === dpr
        ? tileState
        : null;
    // Whether the scale MOVED since the previous draw — not whether it differs
    // from the tile's. A pan after a zoom still blits a stale-scale tile, but
    // the gesture that produced it is over: re-arming on every stale-scale draw
    // would hold the map soft for as long as the user kept dragging. It would
    // also make the settle level-armed — re-armed by the next draw no matter
    // what canceled it — which silently neutralizes the #127 rule the timer's
    // cleanup follows, since the redraw `$effect` always schedules a draw.
    const scaleMoved = t.scale !== lastDrawnScale;
    lastDrawnScale = t.scale;
    let usable: TileState | null;
    // Coverage is asked FIRST, at either scale. A scaled blit maps the whole
    // tile onto a scaled destination, so a zoom-out shrinks it: past the tile's
    // margin the destination is smaller than the canvas and the edges show bare
    // background. Blank is worse than soft, so an escaped tile re-renders.
    if (live !== null && tileCovers(live.spec, t, width, height)) {
      usable = live;
      if (live.spec.transform.scale !== t.scale) {
        // Scale changed mid-gesture: blit what we have, scaled. Geometry still
        // lands in the right place at the right size; only stroke weights and
        // antialiasing are stale until the gesture settles.
        if (scaleMoved) scheduleTileSettle();
      } else {
        // An exact-scale hit is already crisp, so a settle armed by an earlier
        // zoom has nothing left to fix — letting it fire would null a good tile
        // and pay a full re-render for nothing. Reachable whenever a gesture
        // lands back on the tile's own scale, which the MIN_ZOOM / MAX_ZOOM
        // clamps make easy: every notch past the stop resolves to the same
        // scale.
        cancelTileSettle();
      }
    } else {
      cancelTileSettle();
      usable = renderTile(map, t, colors, game, dpr, key);
    }
    if (usable) {
      tileState = usable;
      blitTile(ctx, usable, t, dpr);
    } else {
      // No usable tile — degenerate viewport, or no 2D context for the
      // offscreen surface. Draw directly: slower, but never blank.
      tileState = null;
      drawMapLayers(ctx, map, t, width, height, colors, game);
    }
  }

  // Track the container's content box — the canvas is styled to fill it exactly.
  $effect(() => {
    const el = container;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      width = el.clientWidth;
      height = el.clientHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  });

  /** Fit `map` to the viewport, remembering the scale the zoom range is measured against. */
  function fitToViewport(map: Map2d): void {
    const t = fitTransform(map.bounds, width, height);
    fitScale = t.scale;
    transform = t;
  }

  /** Re-fit the current map. Exported so the map bar's Fit button can drive it. */
  export function refit(): void {
    const map = data;
    if (!map || width <= 0 || height <= 0) return;
    fitToViewport(map);
  }

  /** Current zoom as a multiple of the fit scale — the map bar renders it as a readout. */
  export function zoomFactor(): number {
    const t = transform;
    if (!t || !(fitScale > 0)) return 1;
    return t.scale / fitScale;
  }

  /** Per-category thing totals for the chip row; null until the map is available. */
  export function categoryCounts(): Record<ThingCategory, number> | null {
    const map = data;
    if (!map) return null;
    return countByCategory(map.things, wad.summary?.game ?? null);
  }

  /** Count of teleport source lines for the line-filter chip; null until the map is available. */
  export function teleportLineCount(): number | null {
    const map = data;
    if (!map) return null;
    let count = 0;
    for (const line of map.lines) if (line.teleport) count += 1;
    return count;
  }

  /** Teleport link count for the arc button's label; null until the map is available. */
  export function linkCount(): number | null {
    const map = data;
    if (!map) return null;
    return map.links?.length ?? 0;
  }

  /** Classified-sector counts for the overlay chips; null until the map is available. */
  export function sectorCounts(): { secrets: number; damage: number } | null {
    const map = data;
    if (!map) return null;
    return { secrets: map.secret_sectors, damage: map.damaging_sectors };
  }

  // Fit once per map, as soon as there's a real viewport. Later resizes keep the
  // current view, so a layout shift won't throw away a pan/zoom the user chose;
  // Fit / double-click / `0` are the way back to the whole map.
  $effect(() => {
    const map = data;
    if (!map || width <= 0 || height <= 0 || fittedFor === map) return;
    fittedFor = map;
    fitToViewport(map);
  });

  /** The zoom clamp, as absolute scales — recomputed per gesture from the last fit. */
  function zoomRange(): { min: number; max: number } {
    return { min: MIN_ZOOM * fitScale, max: MAX_ZOOM * fitScale };
  }

  /**
   * Pointers currently down on the canvas, in insertion order and in canvas
   * coordinates: one pans, two pinch. Plain bookkeeping — nothing renders from it.
   */
  const pointers = new Map<number, { x: number; y: number }>();
  /** The previous pinch measurement, so a move can scale by the change since it. */
  let pinch: { dist: number; x: number; y: number } | null = null;

  /** Distance and midpoint of the two oldest active pointers. */
  function measurePinch(): { dist: number; x: number; y: number } | null {
    const active = pointers.values();
    const a = active.next().value;
    const b = active.next().value;
    if (a === undefined || b === undefined) return null;
    return { dist: Math.hypot(b.x - a.x, b.y - a.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function handlePointerDown(e: PointerEvent): void {
    const el = canvas;
    // Primary button only. A right-click would otherwise capture the pointer and
    // join the active set, and the native context menu can swallow the matching
    // `pointerup` — leaving bare mouse moves panning the map. Touch and pen
    // contact both report button 0, so this does not cost us pinch.
    if (!el || e.button !== 0) return;
    // Keep receiving moves once the drag leaves the canvas, and take focus so the
    // keyboard controls work without a separate tab stop hunt.
    el.setPointerCapture(e.pointerId);
    el.focus({ preventScroll: true });
    pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    // A pointer joining changes what the midpoint and distance mean; the next
    // move re-measures rather than scaling against a stale baseline.
    pinch = null;
    dragging = true;
  }

  function handlePointerMove(e: PointerEvent): void {
    const t = transform;
    const previous = pointers.get(e.pointerId);
    const point = { x: e.offsetX, y: e.offsetY };
    if (previous === undefined) {
      // Hovering, not dragging: report the map coordinate under the cursor.
      if (t) {
        const at = screenToMap(t, point.x, point.y);
        mapCursor.set(Math.round(at.x), Math.round(at.y));
      }
      return;
    }
    pointers.set(e.pointerId, point);
    if (!t) return;
    if (pointers.size === 1) {
      transform = panBy(t, point.x - previous.x, point.y - previous.y);
      return;
    }
    const now = measurePinch();
    const before = pinch;
    pinch = now;
    if (now === null || before === null || before.dist <= 0 || now.dist <= 0) return;
    // Zoom about the *old* midpoint so the map under the fingers stays put, then
    // pan by the midpoint's own movement — together that pins map to fingers.
    const range = zoomRange();
    const zoomed = zoomAt(t, before.x, before.y, now.dist / before.dist, range.min, range.max);
    transform = panBy(zoomed, now.x - before.x, now.y - before.y);
  }

  function handlePointerUp(e: PointerEvent): void {
    pointers.delete(e.pointerId);
    pinch = null;
    dragging = pointers.size > 0;
    const el = canvas;
    if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  }

  function handleWheel(e: WheelEvent): void {
    const t = transform;
    // A horizontal-only wheel (trackpad swipe) is not a zoom gesture; leave it alone.
    if (!t || e.deltaY === 0) return;
    // The canvas owns wheel gestures over itself — the listener is on the canvas,
    // so scrolling anywhere else on the page is untouched.
    e.preventDefault();
    const range = zoomRange();
    const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    transform = zoomAt(t, e.offsetX, e.offsetY, factor, range.min, range.max);
  }

  /** Step the grid, turning it on if hidden — adjusting is immediate feedback. */
  function adjustGridSize(direction: -1 | 1): void {
    if (!mapPrefs.showGrid) mapPrefs.toggleGrid();
    const next = stepGridSize(mapPrefs.gridSize, direction);
    const clamped = next === mapPrefs.gridSize;
    mapPrefs.setGridSize(next);
    // A clamped press still announces — with distinct wording, since
    // identical live-region text is skipped by both Svelte and screen
    // readers.
    const limit = clamped ? `, ${direction === 1 ? 'largest' : 'smallest'} size` : '';
    // With no transform there is no view to describe, so say nothing about
    // drawing rather than claim the grid is too small. (Barely reachable: the
    // key only arrives when the canvas has focus, which means a map is drawn.)
    if (transform) {
      const drawn = effectiveGridSize(next, transform.scale);
      const shown = gridDrawnSuffix(next, drawn);
      gridAnnouncer.announceNow(`Grid ${next}${limit}${shown}`, drawn !== null);
    } else {
      gridAnnouncer.announceNow(`Grid ${next}${limit}`);
    }
  }

  /** Step the arc cap, turning the overlay on if hidden — adjusting is
   *  immediate feedback, exactly as it is for the grid. */
  function adjustArcCap(direction: -1 | 1): void {
    // `data` is guaranteed non-null here: `handleKeyDown` is wired on the
    // canvas, and the canvas only exists in the `{#if data === null}` else
    // branch below, so a press can never observe an unresolved map. `?? 0`
    // is therefore never masking "unknown" as "zero" — teleportArcs.ts's
    // `number | null` contract is about the button, which CAN render before
    // a map resolves; this handler cannot fire that early.
    const total = data?.links?.length ?? 0;
    if (total === 0) {
      // Mirror the toolbar button's own decline on a linkless map: no
      // toggle, no cap step, no persisted change. Still announce — a
      // keyboard user pressing a key that does nothing gets no other
      // feedback, and `arcCapName(cap, 0)` already says the right thing.
      arcCapAnnouncement = arcCapName(mapPrefs.teleportArcCap, 0);
      return;
    }
    if (!mapPrefs.showTeleportArcs) mapPrefs.toggleTeleportArcs();
    const next = stepArcCap(mapPrefs.teleportArcCap, direction);
    const clamped = next === mapPrefs.teleportArcCap;
    mapPrefs.setTeleportArcCap(next);
    // A clamped press still announces, with distinct wording: identical
    // live-region text is skipped by both Svelte and screen readers.
    arcCapAnnouncement = clamped
      ? `${arcCapName(next, total)}, limit reached`
      : arcCapName(next, total);
  }

  function handleKeyDown(e: KeyboardEvent): void {
    // Brackets first: many layouts type them with AltGr (reported as ctrl+alt)
    // or Option, which the blanket modifier guard below would swallow. Only
    // meta stays reserved — Cmd+[ / Cmd+] are browser history navigation.
    if ((e.key === '[' || e.key === ']') && !e.metaKey) {
      e.preventDefault();
      adjustGridSize(e.key === ']' ? 1 : -1);
      return;
    }
    // Leave modified keys to the browser and the OS.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // `,` and `.` are the unshifted `<` and `>`, so they read as less/more.
    // They sit AFTER the blanket guard on purpose: unlike `[` / `]` above they
    // are not typed via AltGr or Option on common layouts, so they need no
    // exception of their own — and claiming one would swallow Ctrl+, which is
    // a real browser shortcut.
    if (e.key === ',' || e.key === '.') {
      e.preventDefault();
      adjustArcCap(e.key === '.' ? 1 : -1);
      return;
    }
    if (e.key === '0') {
      e.preventDefault();
      refit();
      return;
    }
    const t = transform;
    if (!t) return;
    const dx = width * PAN_FRACTION;
    const dy = height * PAN_FRACTION;
    const range = zoomRange();
    let next: Transform;
    switch (e.key) {
      // Arrows move the viewport, so the map slides the opposite way.
      case 'ArrowLeft':
        next = panBy(t, dx, 0);
        break;
      case 'ArrowRight':
        next = panBy(t, -dx, 0);
        break;
      case 'ArrowUp':
        next = panBy(t, 0, dy);
        break;
      case 'ArrowDown':
        next = panBy(t, 0, -dy);
        break;
      case '+':
      case '=':
        next = zoomAt(t, width / 2, height / 2, ZOOM_STEP, range.min, range.max);
        break;
      case '-':
        next = zoomAt(t, width / 2, height / 2, 1 / ZOOM_STEP, range.min, range.max);
        break;
      default:
        return;
    }
    e.preventDefault();
    transform = next;
  }

  // The cursor readout is global state, so hand it back when this view goes away —
  // `pointerleave` never fires if the map is unmounted from under the pointer.
  $effect(() => () => mapCursor.clear());

  let frame = 0;

  /**
   * Draw on the next frame rather than inline. Two reasons: the theme attribute
   * that `palette()` reads is applied by another component's effect, and effect
   * order is not ours to rely on — by rAF time the style is settled either way;
   * and a burst of changes (resize + prefs + theme) collapses into one draw.
   */
  function scheduleDraw(): void {
    if (frame !== 0) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
    });
  }

  /**
   * Everything baked into the tile, named exactly once.
   *
   * Both keys derive from this object rather than repeating the field list.
   * Spelling it out twice would mean a new preference could reach one key and
   * miss the other — reintroducing the very invalidation/redraw drift the key
   * exists to prevent (#152), in the code meant to prevent it. `satisfies`
   * rather than a type annotation so a missing or mistyped field fails here,
   * at the declaration, instead of at a call site.
   */
  const bakedInput = $derived({
    style: mapPrefs.style,
    theme: theme.resolved,
    game: wad.summary?.game ?? null,
    showThings: mapPrefs.showThings,
    alwaysShowPlayerStart: mapPrefs.alwaysShowPlayerStart,
    categories: mapPrefs.showCategories,
    showTeleportLines: mapPrefs.showTeleportLines,
    showTeleportArcs: mapPrefs.showTeleportArcs,
    teleportArcCap: mapPrefs.teleportArcCap,
    showSecretSectors: mapPrefs.showSecretSectors,
    showDamagingSectors: mapPrefs.showDamagingSectors,
  } satisfies TileKeyInput);
  /** The tile's identity — everything baked into the bitmap. */
  const tileKeyValue = $derived(tileKey(bakedInput));
  /** The tile's identity plus the two layers drawn live. */
  const renderKeyValue = $derived(
    renderKey({
      ...bakedInput,
      showGrid: mapPrefs.showGrid,
      gridSize: mapPrefs.gridSize,
      glFeather: mapPrefs.glFeather,
    }),
  );

  /**
   * Pack and upload the current map into `instance`, skipping a map that is
   * already in there. Both upload sites go through this so the `game` argument
   * — which decides how every thing is categorized — cannot differ between
   * them.
   *
   * The identity guard assumes `game` cannot change without `data` changing.
   * True today: both come out of one WAD load, and `data` re-derives on
   * `wad.phase`, so a new WAD always hands over a new `Map2d` object. Note
   * that the canvas path does NOT rest on that assumption — `game` is a field
   * of `bakedInput`, so it invalidates the tile and the redraw on its own. If
   * the store ever lets the game change in place, this is the site that goes
   * stale.
   */
  function uploadGlMap(instance: GlMapRenderer): void {
    const map = data;
    if (map === null || glLoadedMap === map) return;
    instance.loadMap(map, wad.summary?.game ?? null);
    glLoadedMap = map;
  }

  // Bind the GL context AT MOUNT, never inside a draw. A canvas keeps its first
  // context for life, and the browser tier's `painted()` probe can request a 2D
  // context on a still-unsized canvas before the first rAF — so a renderer
  // created inside the first rAF draw would find the canvas already taken and
  // silently exercise the fallback (browser-test-helpers.ts).
  //
  // The three `void` reads ARE this effect's reactive surface: the body runs
  // inside `untrack`, so nothing can join it by accident. That matters most for
  // `glFeather`, a live uniform delivered per frame through `GlFrame` —
  // tracking it here would rebuild the programs, the buffers and the map upload
  // every time an antialiasing toggle moved. `data` is likewise untracked; the
  // upload effect below owns that dependency.
  $effect(() => {
    void canvas;
    void glActive;
    void mapPrefs.glMsaa;
    return untrack(() => {
      const el = canvas;
      if (!glActive || !el) return;
      const instance = createGlRenderer(el, {
        msaa: mapPrefs.glMsaa,
        preserveDrawingBuffer: glProbe,
      });
      if (instance === null) {
        // No usable WebGL2 here. `glActive` goes false, the `{#key}` block
        // hands the canvas path a fresh element, and this effect re-runs into
        // the early return above rather than retrying.
        glFailed = true;
        return;
      }
      glRenderer = instance;
      // A fresh renderer holds no map, whatever the last one held.
      glLoadedMap = null;
      // Fires only when a lost context did NOT come back inside the renderer's
      // grace period; a blip that restores is handled in there and never
      // reaches us.
      instance.onContextLost(() => {
        glFailed = true;
      });
      // A re-run at an unchanged map — an MSAA change, which replaces the
      // element and so this renderer — gets no help from the upload effect
      // below, whose dependencies did not move. So upload here too.
      uploadGlMap(instance);
      return () => {
        instance.dispose();
        glRenderer = null;
        glLoadedMap = null;
      };
    });
  });

  // Re-upload when the map changes. Separate from the init effect so a map
  // switch costs a buffer upload rather than a whole new context — and so the
  // init effect never has to track `data`.
  $effect(() => {
    void data;
    void glActive;
    untrack(() => {
      if (!glActive || glRenderer === null) return;
      uploadGlMap(glRenderer);
    });
  });

  // Redraw on anything the picture depends on. `draw()` runs outside this
  // effect's tracking context, so its dependencies have to be named here — but
  // every preference, the style and the theme now arrive through one derived
  // key, so the ten lines that used to name them by hand are down to the six
  // below. The key also covers `game`, which the old list never tracked at all.
  // That is what stops the cache's invalidation drifting from the redraw
  // trigger: a field missing from the key fails to do both, so the symptom is a
  // picture that never changes rather than one that changes everywhere except
  // the cached layer (#152).
  $effect(() => {
    void canvas;
    void data;
    void transform;
    void width;
    void height;
    void renderKeyValue;
    scheduleDraw();
    return () => {
      if (frame === 0) return;
      cancelAnimationFrame(frame);
      frame = 0;
    };
  });

  // Not the redraw effect's teardown: that effect tracks `transform` and so re-runs
  // on every wheel tick, pinch move, pan and zoom keypress, and Svelte runs an
  // effect's cleanup before each re-run. Canceling there killed the pending
  // announcement mid-gesture — the exact case it exists to cover (#127). The
  // tile settle below is armed by a scale change and so lives on exactly the
  // same ticks: it is unmount-only for the same reason (#152).
  onDestroy(() => {
    gridAnnouncer.dispose();
    cancelTileSettle();
    // Sizing to zero releases the backing store immediately rather than
    // waiting on the collector; the tile can be tens of megabytes.
    if (tileCanvas) {
      tileCanvas.width = 0;
      tileCanvas.height = 0;
      tileCanvas = null;
    }
    tileState = null;
  });
</script>

{#if data === null}
  {#if assembleError !== null}
    <p class="error" role="alert">Could not assemble {name}: {assembleError}</p>
  {:else}
    <p class="error" role="alert">Could not assemble {name}.</p>
  {/if}
{:else}
  <div class="map2d" bind:this={container}>
    <!-- A canvas keeps its first context for life, and `getContext` with
         different attributes silently returns that context rather than a new
         one — so changing backend, or changing MSAA (a context-creation
         attribute), needs a NEW element rather than a new call. On the canvas
         path this key is constant, so the element is never replaced. -->
    {#key [glActive, mapPrefs.glMsaa].join(':')}
      <!-- ARIA files `application` under structure, so Svelte's tables call it
           non-interactive; for this keyboard-operated canvas it is the correct
           role (ARIA authoring practices), making the warning below noise. -->
      <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
      <canvas
        bind:this={canvas}
        role="application"
        aria-roledescription="2D map"
        aria-label={`2D map of ${name}`}
        aria-describedby={instructionsId}
        tabindex="0"
        class:dragging
        onwheel={handleWheel}
        onpointerdown={handlePointerDown}
        onpointermove={handlePointerMove}
        onpointerup={handlePointerUp}
        onpointercancel={handlePointerUp}
        onlostpointercapture={handlePointerUp}
        onpointerleave={() => mapCursor.clear()}
        ondblclick={refit}
        onkeydown={handleKeyDown}
      ></canvas>
    {/key}
    <p id={instructionsId} class="visually-hidden">
      Drag or use the arrow keys to pan. Zoom with the scroll wheel, a pinch, or the plus
      and minus keys. Press 0 or double-click to fit the whole map. Press [ or ] to shrink
      or grow the grid, or , and . to change how many teleport links draw.
    </p>
    <p class="visually-hidden" role="status">{gridAnnouncement}</p>
    <p class="visually-hidden" role="status">{arcCapAnnouncement}</p>
    {#if isEmpty}<p class="empty" role="status">Empty map.</p>{/if}
  </div>
{/if}

<style>
  .map2d {
    position: relative;
    min-height: 12rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--map2d-bg);
    overflow: hidden;
  }
  canvas {
    position: absolute;
    inset: 0;
    display: block;
    /* Required, not redundant: a replaced element with `width: auto` takes its
       intrinsic (backing-store) size, so on a hi-DPI display the canvas would
       lay out at devicePixelRatio times the box it is supposed to fill. */
    width: 100%;
    height: 100%;
    /* Pointer Events own every gesture here (ADR-0003): without this the browser
       claims touch drags for scrolling and pinches for page zoom. */
    touch-action: none;
    cursor: grab;
  }
  canvas.dragging {
    cursor: grabbing;
  }
  /* The canvas fills its container exactly and `.map2d` clips overflow, so the
     global focus ring (drawn outside the border box) would be invisible. Pull it
     inside instead — a keyboard tab stop must show where focus is. */
  canvas:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    margin: 0;
    color: var(--text-muted);
    pointer-events: none;
  }
  .error {
    display: grid;
    place-items: center;
    margin: 0;
    min-height: 12rem;
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    color: var(--danger);
  }
</style>
