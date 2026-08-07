<script lang="ts">
  import type { Map2d } from '../../format';
  import { wad } from '../../stores/wad.svelte';
  import { mapPrefs } from '../../stores/mapPrefs.svelte';
  import { theme } from '../../stores/theme.svelte';
  import { fitTransform, mapToScreen, screenToMap, type Transform } from './transform';

  interface Props {
    name: string;
  }
  let { name }: Props = $props();

  type LineKind = Map2d['lines'][number]['kind'];

  /** Every color one draw needs, resolved once per draw. */
  interface Palette {
    bg: string;
    grid: string;
    wall: string;
    twoSided: string;
    secret: string;
    thing: string;
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
    thing: '#c7c7cc',
    player: '#34c759',
  };

  /** Grid spacing in map units, and the smallest on-screen spacing worth drawing. */
  const GRID_STEP = 128;
  const MIN_GRID_PX = 8;
  /** Fixed CSS-pixel sizes — screen-space glyphs, so they don't scale with zoom. */
  const THING_PX = 3;
  const PLAYER_ARROW_PX = 10;
  const PLAYER_THING_TYPE = 1;
  /** Back-to-front, so the rarer kinds stay legible where lines overlap. */
  const KIND_ORDER = ['two_sided', 'one_sided', 'secret'] as const satisfies readonly LineKind[];
  const KIND_WIDTH: Record<LineKind, number> = { two_sided: 1, one_sided: 2, secret: 1.5 };

  let container = $state<HTMLDivElement>();
  let canvas = $state<HTMLCanvasElement>();
  let transform = $state<Transform | null>(null); // null until the first fit
  let width = $state(0);
  let height = $state(0);

  // `wad.map2d` caches per name behind non-reactive fields, so depend on `phase`
  // explicitly: loading another WAD must re-derive rather than serve a stale map.
  const data = $derived.by((): Map2d | null => {
    void wad.phase;
    return wad.map2d(name);
  });
  const isEmpty = $derived(data !== null && data.lines.length === 0 && data.things.length === 0);

  /** The map this instance has already fitted — plain bookkeeping, not reactive state. */
  let fittedFor: Map2d | null = null;

  function token(style: CSSStyleDeclaration, property: string, fallback: string): string {
    const value = style.getPropertyValue(property).trim();
    return value === '' ? fallback : value;
  }

  /**
   * Resolve the palette once per draw — `getComputedStyle` flushes style, so it
   * must never be called per line. Missing tokens fall back to the classic
   * palette, which is at least internally consistent.
   */
  function palette(el: HTMLCanvasElement): Palette {
    if (mapPrefs.style === 'classic') return CLASSIC;
    const style = getComputedStyle(el);
    return {
      bg: token(style, '--map2d-bg', CLASSIC.bg),
      grid: token(style, '--map2d-grid', CLASSIC.grid),
      wall: token(style, '--map2d-wall', CLASSIC.wall),
      twoSided: token(style, '--map2d-two-sided', CLASSIC.twoSided),
      secret: token(style, '--map2d-secret', CLASSIC.secret),
      thing: token(style, '--map2d-thing', CLASSIC.thing),
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

  function drawGrid(ctx: CanvasRenderingContext2D, t: Transform, color: string): void {
    // Written as a positive test so a non-finite scale also bails out here.
    if (!(GRID_STEP * t.scale >= MIN_GRID_PX)) return;
    // Invert the viewport corners: only the visible map rect needs grid lines.
    const corners = [screenToMap(t, 0, 0), screenToMap(t, width, height)];
    const minX = Math.min(corners[0].x, corners[1].x);
    const maxX = Math.max(corners[0].x, corners[1].x);
    const minY = Math.min(corners[0].y, corners[1].y);
    const maxY = Math.max(corners[0].y, corners[1].y);
    const path = new Path2D();
    for (let x = Math.ceil(minX / GRID_STEP) * GRID_STEP; x <= maxX; x += GRID_STEP) {
      const from = mapToScreen(t, x, minY);
      const to = mapToScreen(t, x, maxY);
      path.moveTo(from.x, from.y);
      path.lineTo(to.x, to.y);
    }
    for (let y = Math.ceil(minY / GRID_STEP) * GRID_STEP; y <= maxY; y += GRID_STEP) {
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

  function drawThings(
    ctx: CanvasRenderingContext2D,
    map: Map2d,
    t: Transform,
    color: string,
  ): void {
    const path = new Path2D();
    const half = THING_PX / 2;
    for (const thing of map.things) {
      const at = mapToScreen(t, thing.x, thing.y);
      path.rect(at.x - half, at.y - half, THING_PX, THING_PX);
    }
    ctx.fillStyle = color;
    ctx.fill(path);
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
    if (!el) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    sizeCanvas(el, ctx);
    const colors = palette(el);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);
    const map = data;
    const t = transform;
    if (!map || !t) return;
    if (mapPrefs.showGrid) drawGrid(ctx, t, colors.grid);
    drawLines(ctx, map, t, colors);
    if (mapPrefs.showThings) drawThings(ctx, map, t, colors.thing);
    drawPlayerStart(ctx, map, t, colors.player);
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

  // Fit once per map, as soon as there's a real viewport. Later resizes keep the
  // current view, so a layout shift won't throw away a pan/zoom the user chose.
  $effect(() => {
    const map = data;
    if (!map || width <= 0 || height <= 0 || fittedFor === map) return;
    fittedFor = map;
    transform = fitTransform(map.bounds, width, height);
  });

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
    void mapPrefs.showGrid;
    void mapPrefs.style;
    void theme.resolved;
    scheduleDraw();
    return () => {
      if (frame === 0) return;
      cancelAnimationFrame(frame);
      frame = 0;
    };
  });
</script>

{#if data === null}
  <p class="error">Could not assemble {name}.</p>
{:else}
  <div class="map2d" bind:this={container}>
    <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
    <canvas bind:this={canvas} role="img" aria-label={`2D map of ${name}`} tabindex="0"></canvas>
    {#if isEmpty}<p class="empty">Empty map.</p>{/if}
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
