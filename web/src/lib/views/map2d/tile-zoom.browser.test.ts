import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import type { Map2d as Map2dPayload } from '../../format';
import { installMapSizing, painted } from './browser-test-helpers';
import {
  planTile,
  MAX_TILE_AREA_PX,
  MAX_TILE_SIDE_PX,
  TILE_MARGIN_FRACTION,
  type TileBudget,
} from './tile';
import { TILE_PAD_PX } from './render';
import { fitTransform } from './transform';

/**
 * State 4 of the cache (#152): a zoom blits the existing tile scaled and
 * re-renders it crisply once the scale settles.
 *
 * Two separate claims live here, and they fail in opposite directions:
 *
 * 1. The gesture must not rasterize, and the settle must still arrive. The
 *    interesting failure is not "the tile never re-renders" — it is the #127
 *    shape, where the settle timer is cleaned up by the redraw `$effect`. That
 *    effect tracks `transform`, so it re-runs on every zoom tick and Svelte runs
 *    a cleanup before each re-run; a gesture that keeps going would lose the
 *    crisp re-render entirely rather than delaying it. Hence the continued ticks
 *    below.
 * 2. The settled picture must be the one a crisp render at the settled scale
 *    produces, not a permanently stretched bitmap. Until this file existed
 *    nothing in the suite zoomed at all, so the `spec.transform.scale ===
 *    t.scale` clause was untested — and this task is precisely what changes what
 *    a scale mismatch does. `the settled picture is crisp, not a stretched blit`
 *    is the case that objects if that guard is ever weakened into "blit scaled
 *    forever".
 *
 * `control.disableCache` forces `planTile` to return a zero-sized tile, which
 * sends `draw()` down its direct fallback — that is how the same zoom gesture
 * can be run with and without the cache and the two pictures compared.
 */
const control = vi.hoisted(() => ({ disableCache: false, renders: 0 }));

vi.mock('./tile', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./tile')>();
  return {
    ...mod,
    planTile: (...args: Parameters<typeof mod.planTile>) => {
      if (control.disableCache) {
        return { transform: { ...args[0] }, width: 0, height: 0, wholeMap: false };
      }
      return mod.planTile(...args);
    },
  };
});

vi.mock('./render', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./render')>();
  return {
    ...mod,
    drawMapLayers: (...args: Parameters<typeof mod.drawMapLayers>) => {
      control.renders += 1;
      return mod.drawMapLayers(...args);
    },
  };
});

const SPAN = 4000;
/**
 * Lattice pitch. Every line spans the whole map in one axis, so several of them
 * cross the viewport at *any* zoom this file reaches — which is what lets the
 * ink measurement below compare the same geometry at fit zoom and at 6.7x.
 * A single cross through the center would leave one line of each orientation at
 * the deep end, and a fixture that only just has ink makes a weak measurement.
 */
const LATTICE_PITCH = 125;

/**
 * Nothing but one-sided walls: they are the only red ink `wallInk` can see, and
 * with no things, no marked lines and the grid off (below) the red channel
 * measures wall strokes and nothing else.
 */
function lattice(): Map2dPayload['lines'] {
  const lines: Map2dPayload['lines'] = [];
  for (let at = 0; at <= SPAN; at += LATTICE_PITCH) {
    lines.push({ x1: at, y1: 0, x2: at, y2: SPAN, kind: 'one_sided' });
    lines.push({ x1: 0, y1: at, x2: SPAN, y2: at, kind: 'one_sided' });
  }
  return lines;
}

const MAP: Map2dPayload = {
  name: 'MAP01',
  bounds: { min_x: 0, min_y: 0, max_x: SPAN, max_y: SPAN },
  lines: lattice(),
  things: [],
  secret_sectors: 0,
  damaging_sectors: 0,
};

vi.mock('../../stores/wad.svelte', () => ({
  wad: {
    phase: 'loaded',
    summary: { kind: 'PWAD', lump_count: 6, map_count: 1, game: null },
    map2d: () => MAP,
    map2dError: () => null,
  },
}));

const { render } = await import('vitest-browser-svelte');
const Map2d = (await import('./Map2d.svelte')).default;
const { mapPrefs } = await import('../../stores/mapPrefs.svelte');

installMapSizing();

/** Mirrors of the component's own constants — a drift here is a real failure. */
const TILE_SETTLE_MS = 120;
const ZOOM_STEP = 1.1;
/**
 * Advance per tick. Sinon's fake `requestAnimationFrame` fires on a 16 ms
 * cadence, so 20 ms guarantees at least one rAF callback per tick rather than
 * landing exactly on a frame boundary. Copied from
 * `grid-announcement.browser.test.ts`; not a mirror of any component constant.
 */
const FRAME_MS = 20;

/**
 * The gesture: `BURST_TICKS` frames, each carrying `PRESSES_PER_TICK` zoom
 * steps. `BURST_TICKS * FRAME_MS` must stay under `TILE_SETTLE_MS`, or the
 * settle fires mid-loop and every assertion below holds for a weaker reason.
 * Several presses per tick buy zoom depth without buying elapsed time: the
 * stretched blit's strokes are `ZOOM_STEP ** ZOOM_PRESSES` times too thick, and
 * that ratio is the whole signal `the settled picture is crisp` measures.
 */
const BURST_TICKS = 5;
const PRESSES_PER_TICK = 4;
const ZOOM_PRESSES = BURST_TICKS * PRESSES_PER_TICK;
/** ~6.73. Comfortably inside the component's 20x zoom ceiling. */
const ZOOM_RATIO = ZOOM_STEP ** ZOOM_PRESSES;
/**
 * How the gesture continues after the last zoom step: a drag, which is what a
 * user does next and what makes the #127 shape reachable at all.
 *
 * A pan re-runs the redraw `$effect` — it tracks `transform` — at an *unchanged*
 * scale, so the draw it schedules does not re-arm the settle. That is the only
 * window in which a cancel wired into that effect's teardown is not immediately
 * undone, and it is why these cases end with a pan rather than with the zoom.
 * The settle window opens at the last zoom tick, so `PAN_TICKS * FRAME_MS` must
 * stay under `TILE_SETTLE_MS` — otherwise the settle fires mid-pan and every
 * assertion below holds for a weaker reason.
 */
const PAN_TICKS = 1;

/**
 * Zoom depth that forces a **viewport** tile: the whole map at this scale
 * outgrows the tile budget, so `planTile` falls back to a margin-bounded tile —
 * the only kind a zoom-out can escape. Asserted rather than assumed in the case
 * that uses it, since a whole-map tile short-circuits `tileCovers` and would
 * make that case silently vacuous.
 */
const ZOOM_IN_TO_VIEWPORT_TILE = 25;
/**
 * Zoom-out steps that escape it. A viewport tile spans `1 + 2m` viewports at
 * its own scale and `blitRects` maps the whole of it onto a destination scaled
 * by `k`, so the canvas stays covered only while `k >= 1 / (1 + 2m)`. At the
 * nominal margin of 0.5 that is a 2x zoom-out, and `1.1 ** 8 = 2.14` clears it.
 */
const ZOOM_OUT_PAST_MARGIN = 8;

/**
 * The component's own tile budget, built from the same exported constants it
 * builds its own from, so the precondition below cannot drift from what `Map2d`
 * actually plans with.
 */
const BUDGET: TileBudget = {
  maxSidePx: MAX_TILE_SIDE_PX,
  maxAreaPx: MAX_TILE_AREA_PX,
  marginFraction: TILE_MARGIN_FRACTION,
  padPx: TILE_PAD_PX,
};

beforeEach(() => {
  control.disableCache = false;
  control.renders = 0;
  // `mapPrefs` is a module singleton and `localStorage` can carry state in from
  // another file, so pin what the measurement depends on rather than trusting
  // the defaults. Assigned directly rather than through the toggles because
  // those call `#persist()`: a bare assignment is still reactive but writes
  // nothing back, so this file leaves no preferences behind.
  // The grid is drawn live and crisply at every zoom, so leaving it on would add
  // ink that is identical in all three runs — harmless to the ratios, but it
  // would stop `wallInk` being a measurement of wall strokes alone.
  mapPrefs.showGrid = false;
  // The classic palette is a constant rather than CSS tokens, so it resolves
  // identically without this file loading the app stylesheet.
  mapPrefs.style = 'classic';
});

afterEach(() => {
  vi.useRealTimers();
});

/** Fake everything the settle and the redraw schedule themselves on. */
function fakeTimers(): void {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
  });
}

/** Let a pending effect run, then let its scheduled frame draw. */
function settleFrame(): void {
  flushSync();
  vi.advanceTimersByTime(FRAME_MS);
  flushSync();
}

/** Real animation frames — for the mount chain, before timers are faked. */
async function frames(n = 3): Promise<void> {
  for (let i = 0; i < n; i++) {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }
}

/**
 * Mount and run the fit -> first-paint chain to completion, under REAL timers.
 *
 * `ResizeObserver` is browser-scheduled rather than timer-driven, so faking
 * timers before the mount leaves the fit with nothing to advance and hangs the
 * setup. `grid-announcement.browser.test.ts` establishes the same order for the
 * same reason.
 *
 * The render count is polled to a fixed point rather than sampled once: the
 * theme store settles asynchronously, and a re-render landing after the sample
 * would be attributed to the gesture.
 */
interface Mounted {
  el: HTMLCanvasElement;
  /** The sized `.map2d` box, so a case can measure the fit it will get. */
  box: HTMLElement;
  renders: number;
  unmount: () => Promise<void>;
}

async function mountPainted(): Promise<Mounted> {
  const screen = await render(Map2d, { name: 'MAP01' });
  const canvas = screen.container.querySelector('canvas');
  expect(canvas, 'Map2d should render a canvas').not.toBeNull();
  const el = canvas as HTMLCanvasElement;
  const box = screen.container.querySelector('.map2d');
  expect(box, 'Map2d should render its sized box').not.toBeNull();
  expect(await painted(el), 'the map must fit and paint before timers are faked').toBe(true);
  let previous = -1;
  for (let i = 0; i < 20 && control.renders !== previous; i++) {
    previous = control.renders;
    await frames(2);
  }
  expect(control.renders, 'the first paint must have drawn the map').toBeGreaterThan(0);
  return { el, box: box as HTMLElement, renders: control.renders, unmount: screen.unmount };
}

/** One zoom-in step. `=` is the keyboard zoom the component binds. */
function zoomIn(el: HTMLCanvasElement, times = 1): void {
  el.focus();
  for (let i = 0; i < times; i++) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: '=', bubbles: true, cancelable: true }));
  }
}

/** Run the burst, one frame per tick, without letting the settle fire. */
function zoomBurst(el: HTMLCanvasElement): void {
  for (let i = 0; i < BURST_TICKS; i++) {
    zoomIn(el, PRESSES_PER_TICK);
    settleFrame();
  }
}

/** One zoom-out step. */
function zoomOut(el: HTMLCanvasElement, times = 1): void {
  el.focus();
  for (let i = 0; i < times; i++) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true, cancelable: true }));
  }
}

/** Carry the gesture on as a drag: `transform` moves, the scale does not. */
function panOn(el: HTMLCanvasElement): void {
  for (let i = 0; i < PAN_TICKS; i++) {
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
    settleFrame();
  }
}

/** Let the settle timer fire and its scheduled redraw land. */
function letItSettle(): void {
  flushSync();
  vi.advanceTimersByTime(TILE_SETTLE_MS + FRAME_MS * 3);
  flushSync();
}

function pixels(el: HTMLCanvasElement): ImageData {
  const ctx = el.getContext('2d');
  expect(ctx, 'a 2D context is required to inspect the canvas').not.toBeNull();
  return (ctx as CanvasRenderingContext2D).getImageData(0, 0, el.width, el.height);
}

/**
 * Wall ink on the canvas, in device pixels of full coverage.
 *
 * Deliberately a *mass* rather than a count of matching pixels. Every stroke
 * here is axis-aligned, and the blit rounds its source offset to whole device
 * pixels, so a settled tile can sit up to half a device pixel from a direct
 * render — which flips a 2 px stroke between "two fully covered rows" and "one
 * covered row plus two half-covered ones" and halves any count. Antialiasing and
 * bilinear resampling both conserve coverage, so summing coverage is invariant
 * to that shift while staying exactly proportional to stroke width.
 *
 * Coverage is read off the red channel: an opaque wall (`#ff3b30`) composited at
 * fraction `a` over the background gives `bg + a * (wall - bg)`, and with no
 * other red ink on the canvas the excess over the background *is* `a`. The
 * background level is measured rather than assumed, so display color management
 * cannot shift the zero point.
 */
function wallInk(el: HTMLCanvasElement): number {
  const { data } = pixels(el);
  let floor = 255;
  for (let p = 0; p < data.length; p += 4) if (data[p] < floor) floor = data[p];
  expect(floor, 'some background must be visible for the zero point to be real').toBeLessThan(64);
  let mass = 0;
  for (let p = 0; p < data.length; p += 4) mass += data[p] - floor;
  return mass / (255 - floor);
}

/**
 * Canvas columns and rows carrying no wall ink at all.
 *
 * Every lattice line spans the whole map on one axis, so at any zoom that keeps
 * the viewport inside the map, each horizontal line crosses every column and
 * each vertical line crosses every row: a correct picture leaves both counts at
 * zero. A blit whose destination is smaller than the canvas leaves bare
 * background at the edges, which is exactly a band of empty columns and rows.
 */
function unpaintedBands(el: HTMLCanvasElement): { columns: number; rows: number } {
  const { data, width, height } = pixels(el);
  let floor = 255;
  for (let p = 0; p < data.length; p += 4) if (data[p] < floor) floor = data[p];
  // Well clear of the background and well below a wall stroke, so a partly
  // covered edge pixel still counts as ink.
  const inked = floor + 40;
  const columnHasInk = new Array<boolean>(width).fill(false);
  const rowHasInk = new Array<boolean>(height).fill(false);
  for (let p = 0; p < data.length; p += 4) {
    if (data[p] <= inked) continue;
    const index = p / 4;
    rowHasInk[Math.floor(index / width)] = true;
    columnHasInk[index % width] = true;
  }
  return {
    columns: columnHasInk.filter((has) => !has).length,
    rows: rowHasInk.filter((has) => !has).length,
  };
}

/** The picture the burst leaves behind, before and after the settle. */
async function measureBurst(): Promise<{
  during: number;
  settled: number;
  unmount: () => Promise<void>;
}> {
  const { el, unmount } = await mountPainted();
  fakeTimers();
  zoomBurst(el);
  const during = wallInk(el);
  letItSettle();
  return { during, settled: wallInk(el), unmount };
}

describe('zooming against the tile cache', () => {
  it('blits scaled during the gesture and re-renders after it settles', async () => {
    const { el, renders: afterFirstPaint } = await mountPainted();
    fakeTimers();

    // Zoom ticks well inside the settle window: the scale changes on every one,
    // and none of them may rasterize.
    zoomBurst(el);
    expect(control.renders, 'a zoom gesture must blit, not rasterize').toBe(afterFirstPaint);

    // The gesture carries on as a drag. Each pan tick re-runs the redraw effect
    // — which tracks `transform` — and Svelte runs an effect's cleanup before
    // every re-run. With the cancel wired there, these ticks silently discard
    // the pending settle instead of delaying it, and the map stays soft.
    panOn(el);
    expect(control.renders, 'a pan must not rasterize either').toBe(afterFirstPaint);

    letItSettle();
    expect(control.renders, 'the settled scale must be rendered crisply').toBeGreaterThan(
      afterFirstPaint,
    );
  });

  it('renders exactly once for a whole gesture, not once per tick', async () => {
    const { el, renders: afterFirstPaint } = await mountPainted();
    fakeTimers();
    zoomBurst(el);
    panOn(el);
    letItSettle();
    // Twenty zoom steps and a drag, one rasterization. Restarting the window on
    // each scale change is what makes a long gesture cost one render rather
    // than twenty.
    expect(control.renders).toBe(afterFirstPaint + 1);
  });

  it('the settled picture is crisp, not a stretched blit', async () => {
    // The reference: the same gesture with the cache forced off, so every frame
    // is a direct render at the scale it is drawn for. Run first, with its own
    // mount, so the comparison is against a picture the cache never touched.
    control.disableCache = true;
    const reference = await measureBurst();
    const direct = reference.settled;
    // Unmount before the second mount: two live instances would both keep
    // drawing, and the next person to crib this file should not inherit that as
    // a pattern. Real timers first, so the teardown is not waiting on a clock
    // nothing advances.
    vi.useRealTimers();
    await reference.unmount();

    control.disableCache = false;
    const { during, settled } = await measureBurst();

    // The gesture really did stretch the tile — without this the case could pass
    // by never reaching state 4 at all.
    expect(during / direct, 'the mid-gesture blit must be visibly stretched').toBeGreaterThan(
      ZOOM_RATIO / 2,
    );
    // And the settle really did undo it. A guard weakened into "blit scaled
    // forever" leaves `settled` at `during`, which is `ZOOM_RATIO` times too
    // much ink; a crisp re-render puts it back on the direct render's stroke
    // weight. Measured on this fixture at dpr 1: `during / direct` is 6.38
    // against a `ZOOM_RATIO` ideal of 6.73 (bilinear resampling loses a little
    // at the line ends), and `settled / direct` is 1.000006. The band below is
    // headroom for another machine's device pixel ratio, not the observed
    // spread.
    expect(settled / direct, 'the settled picture must match a direct render').toBeGreaterThan(0.8);
    expect(settled / direct, 'the settled picture must match a direct render').toBeLessThan(1.25);
  });

  it('re-renders rather than blitting a tile the zoom-out has escaped', async () => {
    const { el, box } = await mountPainted();
    const fit = fitTransform(MAP.bounds, box.clientWidth, box.clientHeight);
    expect(
      planTile(
        { ...fit, scale: fit.scale * ZOOM_STEP ** ZOOM_IN_TO_VIEWPORT_TILE },
        box.clientWidth,
        box.clientHeight,
        window.devicePixelRatio || 1,
        MAP.bounds,
        BUDGET,
      ).wholeMap,
      'the setup must reach a viewport tile — a whole-map tile short-circuits tileCovers',
    ).toBe(false);

    fakeTimers();
    zoomIn(el, ZOOM_IN_TO_VIEWPORT_TILE);
    settleFrame();
    letItSettle();
    expect(unpaintedBands(el), 'the freshly rendered viewport tile must fill the canvas').toEqual({
      columns: 0,
      rows: 0,
    });

    // Out past the margin in one burst, and measured before the settle fires:
    // this is the frame that used to blit a destination smaller than the canvas.
    zoomOut(el, ZOOM_OUT_PAST_MARGIN);
    settleFrame();
    expect(
      unpaintedBands(el),
      'a zoom-out past the tile margin must re-render, not leave bare bands at the edges',
    ).toEqual({ columns: 0, rows: 0 });
  });
});
