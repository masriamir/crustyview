<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Map2d } from '../../format';
  import { wad } from '../../stores/wad.svelte';
  import { mapCursor } from '../../stores/mapCursor.svelte';
  import { mapPrefs } from '../../stores/mapPrefs.svelte';
  import { theme } from '../../stores/theme.svelte';
  import { fitTransform, panBy, screenToMap, zoomAt, type Transform } from './transform';
  import { countByCategory, type ThingCategory } from './things';
  import { effectiveGridSize, gridDrawnSuffix, stepGridSize, type GridSize } from './grid';
  import { arcCapName, stepArcCap } from './teleportArcs';
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
  }
  let { name, drawnGridSize = $bindable(undefined) }: Props = $props();

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
  /** Debounce for the drawable-state announcement; 0 when none is pending. */
  let gridAnnounceTimer = 0;
  /**
   * The text a pending timer will announce when it fires. Refreshed on every
   * draw while a timer is pending (not just on a crossing that restarts the
   * timer), so the callback always announces the latest observed state
   * rather than a stale snapshot from whichever crossing scheduled it (#127).
   */
  let gridAnnounceText = '';
  /**
   * Whether the grid was drawable at the previous draw, or `null` when no
   * baseline is established. `null` suppresses the next comparison, so opening
   * a map — or re-showing the grid — settles silently instead of announcing.
   */
  let gridDrawable: boolean | null = null;
  /**
   * The map the announcement baseline belongs to. Plain `let`, like
   * `gridDrawable` — only ever read and written inside `draw()`.
   */
  let announcedFor: string | null = null;
  /**
   * Debounce window: collapses a rapid re-crossing of the drawable boundary
   * (e.g. a pinch that overshoots and corrects) into a single announcement of
   * wherever the zoom ends up. Ticks that don't cross back don't restart it,
   * so this does not require the zoom/pinch gesture itself to come to rest.
   */
  const GRID_ANNOUNCE_DELAY_MS = 500;

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

  /**
   * Resolve the palette, memoized on the only two things it depends on — the
   * style preference and the resolved theme. `getComputedStyle` flushes style,
   * which would otherwise cost a forced layout on every frame of a pan or zoom.
   * Missing tokens fall back to the classic palette, which is at least
   * internally consistent.
   */
  function palette(el: HTMLCanvasElement): Palette {
    const key = `${mapPrefs.style}:${theme.resolved}`;
    if (cached !== null && cached.key === key) return cached.colors;
    const colors = resolvePalette(el, mapPrefs.style);
    cached = { key, colors };
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

  function draw(): void {
    const el = canvas;
    if (!el) {
      drawnGridSize = undefined;
      return;
    }
    const ctx = el.getContext('2d');
    if (!ctx) {
      drawnGridSize = undefined;
      return;
    }
    sizeCanvas(el, ctx);
    const colors = palette(el);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);
    const map = data;
    const t = transform;
    if (!map || !t) {
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
    // A map switch is not a grid transition. `Map2d` is reused across an
    // in-place switch, so the outgoing map's baseline would otherwise compare
    // against the incoming map's initial state and report a change that never
    // happened to the grid — and only from the second map onward, since the
    // first has no baseline at all. Clearing the live region is load-bearing,
    // not tidiness: both maps produce the identical "too small" string, so a
    // stale value would make the next genuine crossing a no-op write that
    // announces nothing (#131).
    if (name !== announcedFor) {
      announcedFor = name;
      gridDrawable = null;
      gridAnnouncement = '';
      gridAnnounceText = '';
      if (gridAnnounceTimer !== 0) {
        window.clearTimeout(gridAnnounceTimer);
        gridAnnounceTimer = 0;
      }
    }
    if (mapPrefs.showGrid) {
      const drawable = gridStep !== null;
      const text = `Grid ${mapPrefs.gridSize}${gridDrawnSuffix(mapPrefs.gridSize, gridStep)}`;
      // Only a change from an established baseline announces. The text is
      // composed HERE rather than in the callback, and refreshed below on every
      // draw while a timer is pending — not just on a restart — so the text
      // that survives to fire always describes the most recently observed
      // state, which is where the zoom actually landed. Only a genuine crossing
      // restarts the timer itself; a non-crossing refresh never extends the
      // debounce window. The only other places that touch this timer are the
      // hide branch below, the immediate press in `adjustGridSize`, and the
      // unmount cleanup in `onDestroy` — deliberately NOT the redraw effect's
      // teardown, which re-runs on every transform change and would cancel this
      // mid-gesture (#127).
      if (gridDrawable !== null && gridDrawable !== drawable) {
        gridAnnounceText = text;
        if (gridAnnounceTimer !== 0) window.clearTimeout(gridAnnounceTimer);
        gridAnnounceTimer = window.setTimeout(() => {
          gridAnnounceTimer = 0;
          gridAnnouncement = gridAnnounceText;
        }, GRID_ANNOUNCE_DELAY_MS);
      } else if (gridAnnounceTimer !== 0) {
        // A non-crossing draw while a timer is pending: refresh the text so the
        // callback announces the latest state, but leave the timer itself
        // alone — ordinary zoom ticks must not extend the debounce window.
        gridAnnounceText = text;
      }
      gridDrawable = drawable;
    } else {
      // Hidden: there is no drawable state to track, and showing the grid again
      // re-establishes the baseline silently rather than announcing on toggle.
      // Hiding also stands down a pending transition: it would land after the
      // toggle's own announcement, describing a grid that is no longer shown.
      if (gridAnnounceTimer !== 0) {
        window.clearTimeout(gridAnnounceTimer);
        gridAnnounceTimer = 0;
      }
      gridDrawable = null;
    }
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
    const limit = clamped ? `, ${direction === 1 ? 'largest' : 'smallest'} size` : '';
    // With no transform there is no view to describe, so say nothing about
    // drawing rather than claim the grid is too small. (Barely reachable: the
    // key only arrives when the canvas has focus, which means a map is drawn.)
    let shown = '';
    if (transform) {
      const drawn = effectiveGridSize(next, transform.scale);
      shown = gridDrawnSuffix(next, drawn);
      // This press announces immediately, so a debounced transition message must
      // not land on top of it, and the baseline moves to what this describes.
      if (gridAnnounceTimer !== 0) {
        window.clearTimeout(gridAnnounceTimer);
        gridAnnounceTimer = 0;
      }
      gridDrawable = drawn !== null;
    }
    // A clamped press still announces — with distinct wording, since identical
    // live-region text is skipped by both Svelte and screen readers.
    gridAnnouncement = `Grid ${next}${limit}${shown}`;
  }

  /** Step the arc cap, turning the overlay on if hidden — adjusting is
   *  immediate feedback, exactly as it is for the grid. */
  function adjustArcCap(direction: -1 | 1): void {
    if (!mapPrefs.showTeleportArcs) mapPrefs.toggleTeleportArcs();
    const next = stepArcCap(mapPrefs.teleportArcCap, direction);
    const clamped = next === mapPrefs.teleportArcCap;
    mapPrefs.setTeleportArcCap(next);
    const total = data?.links?.length ?? 0;
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
    // `,` and `.` are the unshifted `<` and `>`, so they read as less/more, and
    // unlike `[` / `]` they are not typed via AltGr or Option on common
    // layouts — which is why that branch above needs its own modifier handling.
    if ((e.key === ',' || e.key === '.') && !e.metaKey) {
      e.preventDefault();
      adjustArcCap(e.key === '.' ? 1 : -1);
      return;
    }
    // Leave modified keys to the browser and the OS.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
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
    renderKey({ ...bakedInput, showGrid: mapPrefs.showGrid, gridSize: mapPrefs.gridSize }),
  );

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
    if (gridAnnounceTimer !== 0) {
      window.clearTimeout(gridAnnounceTimer);
      gridAnnounceTimer = 0;
    }
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
