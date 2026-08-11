<script lang="ts">
  import type { Map2d } from '../../format';
  import { wad } from '../../stores/wad.svelte';
  import { mapCursor } from '../../stores/mapCursor.svelte';
  import { mapPrefs } from '../../stores/mapPrefs.svelte';
  import { theme } from '../../stores/theme.svelte';
  import {
    fitTransform,
    mapToScreen,
    panBy,
    screenToMap,
    zoomAt,
    type Transform,
  } from './transform';
  import {
    CATEGORIES,
    CLASSIC_THING_COLORS,
    categoryOf,
    countByCategory,
    type ThingCategory,
  } from './things';
  import {
    CLASSIC_LINE_SECTOR_DAMAGE,
    CLASSIC_LINE_SECTOR_SECRET,
    CLASSIC_LINE_TELEPORT,
  } from './lines';
  import { effectiveGridSize, gridDrawnSuffix, stepGridSize, type GridSize } from './grid';

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

  type LineKind = Map2d['lines'][number]['kind'];

  /** Every color one draw needs, resolved once per draw. */
  interface Palette {
    bg: string;
    grid: string;
    wall: string;
    twoSided: string;
    secret: string;
    lineTeleport: string;
    lineSectorSecret: string;
    lineSectorDamage: string;
    things: Record<ThingCategory, string>;
    player: string;
  }

  /**
   * Classic Doom automap colors. Deliberately a constant rather than tokens: the
   * classic style is theme-independent — it looks the same in light and dark.
   */
  const CLASSIC: Palette = {
    bg: '#0a0a0a',
    grid: '#2c2c2e',
    wall: '#ff3b30',
    twoSided: '#8e8e93',
    secret: '#ffd60a',
    lineTeleport: CLASSIC_LINE_TELEPORT,
    lineSectorSecret: CLASSIC_LINE_SECTOR_SECRET,
    lineSectorDamage: CLASSIC_LINE_SECTOR_DAMAGE,
    things: CLASSIC_THING_COLORS,
    player: '#34c759',
  };

  /** Fixed CSS-pixel sizes — screen-space glyphs, so they don't scale with zoom. */
  const THING_PX = 3;
  const PLAYER_ARROW_PX = 10;
  const PLAYER_THING_TYPE = 1;
  /** Back-to-front, so the rarer kinds stay legible where lines overlap. */
  const KIND_ORDER = ['two_sided', 'one_sided', 'secret'] as const satisfies readonly LineKind[];
  const KIND_WIDTH: Record<LineKind, number> = { two_sided: 1, one_sided: 2, secret: 1.5 };
  /** Dashed overlay strokes above the base kind colors. Teleport keeps its
   *  own rhythm; the two sector overlays share [4,4] with the damage pass
   *  phase-shifted, so a line bordering both a secret and a damaging sector
   *  interleaves the two colors instead of one hiding the other. */
  const TELEPORT_DASH = [6, 4];
  const SECTOR_DASH = [4, 4];
  const OVERLAY_WIDTH = 2;
  const DAMAGE_DASH_OFFSET = 4;

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
  /** Debounce for the drawable-state announcement; 0 when none is pending. */
  let gridAnnounceTimer = 0;
  /**
   * Whether the grid was drawable at the previous draw, or `null` when no
   * baseline is established. `null` suppresses the next comparison, so opening
   * a map — or re-showing the grid — settles silently instead of announcing.
   */
  let gridDrawable: boolean | null = null;
  /** Long enough that a continuous wheel or pinch zoom announces once, at rest. */
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

  function token(style: CSSStyleDeclaration, property: string, fallback: string): string {
    const value = style.getPropertyValue(property).trim();
    return value === '' ? fallback : value;
  }

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
    const colors = resolvePalette(el);
    cached = { key, colors };
    return colors;
  }

  function resolvePalette(el: HTMLCanvasElement): Palette {
    if (mapPrefs.style === 'classic') return CLASSIC;
    const style = getComputedStyle(el);
    return {
      bg: token(style, '--map2d-bg', CLASSIC.bg),
      grid: token(style, '--map2d-grid', CLASSIC.grid),
      wall: token(style, '--map2d-wall', CLASSIC.wall),
      twoSided: token(style, '--map2d-two-sided', CLASSIC.twoSided),
      secret: token(style, '--map2d-secret', CLASSIC.secret),
      lineTeleport: token(style, '--map2d-line-teleport', CLASSIC.lineTeleport),
      lineSectorSecret: token(style, '--map2d-line-sector-secret', CLASSIC.lineSectorSecret),
      lineSectorDamage: token(style, '--map2d-line-sector-damage', CLASSIC.lineSectorDamage),
      things: Object.fromEntries(
        CATEGORIES.map((c) => [c.id, token(style, `--map2d-thing-${c.id}`, CLASSIC_THING_COLORS[c.id])]),
      ) as Record<ThingCategory, string>,
      player: token(style, '--map2d-player', CLASSIC.player),
    };
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

  function drawGrid(
    ctx: CanvasRenderingContext2D,
    t: Transform,
    color: string,
    step: number,
  ): void {
    // Precondition: `step` cleared `MIN_GRID_PX` at this scale — the sole caller
    // resolves it through `effectiveGridSize`, which owns the density rule (#76).
    // Invert the viewport corners: only the visible map rect needs grid lines.
    const corners = [screenToMap(t, 0, 0), screenToMap(t, width, height)];
    const minX = Math.min(corners[0].x, corners[1].x);
    const maxX = Math.max(corners[0].x, corners[1].x);
    const minY = Math.min(corners[0].y, corners[1].y);
    const maxY = Math.max(corners[0].y, corners[1].y);
    const path = new Path2D();
    for (let x = Math.ceil(minX / step) * step; x <= maxX; x += step) {
      const from = mapToScreen(t, x, minY);
      const to = mapToScreen(t, x, maxY);
      path.moveTo(from.x, from.y);
      path.lineTo(to.x, to.y);
    }
    for (let y = Math.ceil(minY / step) * step; y <= maxY; y += step) {
      const from = mapToScreen(t, minX, y);
      const to = mapToScreen(t, maxX, y);
      path.moveTo(from.x, from.y);
      path.lineTo(to.x, to.y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke(path);
  }

  function drawLines(
    ctx: CanvasRenderingContext2D,
    map: Map2d,
    t: Transform,
    colors: Palette,
  ): void {
    // One path per kind, filled in a single pass, so each kind strokes once
    // regardless of how the WAD interleaves them.
    const paths: Record<LineKind, Path2D> = {
      two_sided: new Path2D(),
      one_sided: new Path2D(),
      secret: new Path2D(),
    };
    for (const line of map.lines) {
      const path = paths[line.kind];
      if (!path) continue; // defensive: an unknown kind must not break the draw
      const from = mapToScreen(t, line.x1, line.y1);
      const to = mapToScreen(t, line.x2, line.y2);
      path.moveTo(from.x, from.y);
      path.lineTo(to.x, to.y);
    }
    const kindColor: Record<LineKind, string> = {
      two_sided: colors.twoSided,
      one_sided: colors.wall,
      secret: colors.secret,
    };
    for (const kind of KIND_ORDER) {
      ctx.strokeStyle = kindColor[kind];
      ctx.lineWidth = KIND_WIDTH[kind];
      ctx.stroke(paths[kind]);
    }
  }

  /** One dashed overlay pass above the base kind strokes. */
  interface OverlayStroke {
    color: string;
    dash: number[];
    dashOffset?: number;
    marked: (line: Map2d['lines'][number]) => boolean;
  }

  function drawLineOverlay(
    ctx: CanvasRenderingContext2D,
    map: Map2d,
    t: Transform,
    overlay: OverlayStroke,
  ): void {
    const path = new Path2D();
    let any = false;
    for (const line of map.lines) {
      if (!overlay.marked(line)) continue;
      any = true;
      const from = mapToScreen(t, line.x1, line.y1);
      const to = mapToScreen(t, line.x2, line.y2);
      path.moveTo(from.x, from.y);
      path.lineTo(to.x, to.y);
    }
    if (!any) return;
    ctx.strokeStyle = overlay.color;
    ctx.lineWidth = OVERLAY_WIDTH;
    ctx.setLineDash(overlay.dash);
    ctx.lineDashOffset = overlay.dashOffset ?? 0;
    ctx.stroke(path);
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }

  function drawThings(
    ctx: CanvasRenderingContext2D,
    map: Map2d,
    t: Transform,
    colors: Palette,
    game: string | null,
  ): void {
    // One path per visible category, mirroring drawLines' per-kind batching;
    // hidden categories are skipped before any path work.
    const paths = new Map<ThingCategory, Path2D>();
    const half = THING_PX / 2;
    for (const thing of map.things) {
      const category = categoryOf(thing.type_id, game);
      if (!mapPrefs.isCategoryShown(category)) continue;
      let path = paths.get(category);
      if (path === undefined) {
        path = new Path2D();
        paths.set(category, path);
      }
      const at = mapToScreen(t, thing.x, thing.y);
      path.rect(at.x - half, at.y - half, THING_PX, THING_PX);
    }
    // Reverse chip order: the list's top categories paint last, on top.
    for (let i = CATEGORIES.length - 1; i >= 0; i--) {
      const path = paths.get(CATEGORIES[i].id);
      if (path === undefined) continue;
      ctx.fillStyle = colors.things[CATEGORIES[i].id];
      ctx.fill(path);
    }
  }

  /** The player-1 start, as an arrow pointing the way the player faces. */
  function drawPlayerStart(
    ctx: CanvasRenderingContext2D,
    map: Map2d,
    t: Transform,
    color: string,
  ): void {
    const start = map.things.find((thing) => thing.type_id === PLAYER_THING_TYPE);
    if (!start) return;
    const at = mapToScreen(t, start.x, start.y);
    const half = PLAYER_ARROW_PX / 2;
    ctx.save();
    ctx.translate(at.x, at.y);
    // Thing angles are degrees counter-clockwise from east in map space; screen Y
    // points the other way, so the same turn is a negative canvas rotation.
    ctx.rotate((-start.angle * Math.PI) / 180);
    ctx.beginPath();
    ctx.moveTo(half, 0);
    ctx.lineTo(-half, -half * 0.8);
    ctx.lineTo(-half * 0.4, 0);
    ctx.lineTo(-half, half * 0.8);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
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
    if (mapPrefs.showGrid) {
      const drawable = gridStep !== null;
      // Only a change from an established baseline announces. The text is
      // composed HERE rather than in the callback: a restart clears the previous
      // timer, so the text that survives to fire is always the most recent
      // transition's — which is where the zoom actually landed — and no separate
      // "latest value" bookkeeping is needed (#127).
      if (gridDrawable !== null && gridDrawable !== drawable) {
        const text = `Grid ${mapPrefs.gridSize}${gridDrawnSuffix(mapPrefs.gridSize, gridStep)}`;
        if (gridAnnounceTimer !== 0) window.clearTimeout(gridAnnounceTimer);
        gridAnnounceTimer = window.setTimeout(() => {
          gridAnnounceTimer = 0;
          gridAnnouncement = text;
        }, GRID_ANNOUNCE_DELAY_MS);
      }
      gridDrawable = drawable;
    } else {
      // Hidden: there is no drawable state to track, and showing the grid again
      // re-establishes the baseline silently rather than announcing on toggle.
      gridDrawable = null;
    }
    if (mapPrefs.showGrid && gridStep !== null) drawGrid(ctx, t, colors.grid, gridStep);
    drawLines(ctx, map, t, colors);
    if (mapPrefs.showSecretSectors)
      drawLineOverlay(ctx, map, t, {
        color: colors.lineSectorSecret,
        dash: SECTOR_DASH,
        marked: (l) => l.secret_sector === true,
      });
    if (mapPrefs.showDamagingSectors)
      drawLineOverlay(ctx, map, t, {
        color: colors.lineSectorDamage,
        dash: SECTOR_DASH,
        dashOffset: DAMAGE_DASH_OFFSET,
        marked: (l) => l.damaging_sector === true,
      });
    if (mapPrefs.showTeleportLines)
      drawLineOverlay(ctx, map, t, {
        color: colors.lineTeleport,
        dash: TELEPORT_DASH,
        marked: (l) => l.teleport === true,
      });
    if (mapPrefs.showThings) drawThings(ctx, map, t, colors, wad.summary?.game ?? null);
    if (mapPrefs.showPlayerStart) drawPlayerStart(ctx, map, t, colors.player);
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

  // Redraw on anything the picture depends on. Every dependency is listed here
  // because `draw()` runs outside this effect's tracking context.
  $effect(() => {
    void canvas;
    void data;
    void transform;
    void width;
    void height;
    void mapPrefs.showThings;
    void mapPrefs.alwaysShowPlayerStart;
    for (const c of CATEGORIES) void mapPrefs.showCategories[c.id];
    void mapPrefs.showTeleportLines;
    void mapPrefs.showSecretSectors;
    void mapPrefs.showDamagingSectors;
    void mapPrefs.showGrid;
    void mapPrefs.gridSize;
    void mapPrefs.style;
    void theme.resolved;
    scheduleDraw();
    return () => {
      if (gridAnnounceTimer !== 0) {
        window.clearTimeout(gridAnnounceTimer);
        gridAnnounceTimer = 0;
      }
      if (frame === 0) return;
      cancelAnimationFrame(frame);
      frame = 0;
    };
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
      or grow the grid.
    </p>
    <p class="visually-hidden" role="status">{gridAnnouncement}</p>
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
