import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import type { Map2d as Map2dPayload } from '../../format';
import { installMapSizing, painted } from './browser-test-helpers';
import { effectiveGridSize, type GridSize } from './grid';
import { fitTransform } from './transform';

/**
 * The `renderer` prop's seam (#177 Task 4): `Map2d` mounted on the WebGL2
 * backend, and every way it is supposed to fall back to the canvas one.
 *
 * Cribs `map2d-mount.browser.test.ts`'s mocked-`wad` shape — mocking the store
 * rather than booting wasm is what makes the component mountable at all — and
 * adds a mock of the GL factory that delegates to the real implementation, so
 * only the one test that needs an init failure gets one.
 *
 * Every GL mount passes `glProbe: true`: without `preserveDrawingBuffer` the
 * drawing buffer is cleared after each composite and `painted()`'s `readPixels`
 * sees nothing but zeros (browser-test-helpers.ts).
 *
 * The assertion that keeps these tests honest is `getContext('webgl2')` after
 * the paint. A silent fallback paints exactly as convincingly as the GL path
 * does, so "it painted" alone would pass on a component that ignored the prop
 * entirely; a canvas bound to 2d answers `null` to a WebGL2 request, and a
 * canvas bound to WebGL2 answers `null` to a 2d one.
 */

const BOUNDS = { min_x: 0, min_y: 0, max_x: 256, max_y: 256 };

/** A square outline, fitted well clear of the middle of the viewport — so the
 *  center probe below reads background until MAP02's diagonal crosses it. */
const OUTLINE: Map2dPayload['lines'] = [
  { x1: 0, y1: 0, x2: 256, y2: 0, kind: 'one_sided' },
  { x1: 256, y1: 0, x2: 256, y2: 256, kind: 'one_sided' },
  { x1: 256, y1: 256, x2: 0, y2: 256, kind: 'two_sided' },
  { x1: 0, y1: 256, x2: 0, y2: 0, kind: 'secret' },
];

/**
 * A 20000x20000 map, borrowed from `grid-announcement.browser.test.ts`: the fit
 * already coarsens the grid to 512 (14.1 px at 800x600), which puts the grid on
 * the drawable side of the 8 px floor with room to zoom across it. A 256-unit
 * map never approaches the floor, so no crossing could be announced at all.
 */
const MAP_SPAN = 20000;

const MAPS: Record<string, Map2dPayload> = {
  MAP01: {
    name: 'MAP01',
    bounds: BOUNDS,
    lines: OUTLINE,
    things: [],
    secret_sectors: 0,
    damaging_sectors: 0,
  },
  // Identical bounds, so both maps fit to the same transform and the only
  // difference in the picture is the diagonal — which runs corner to corner
  // through the exact middle of the viewport.
  MAP02: {
    name: 'MAP02',
    bounds: BOUNDS,
    lines: [...OUTLINE, { x1: 0, y1: 0, x2: 256, y2: 256, kind: 'one_sided' }],
    things: [],
    secret_sectors: 0,
    damaging_sectors: 0,
  },
  BIGMAP: {
    name: 'BIGMAP',
    bounds: { min_x: 0, min_y: 0, max_x: MAP_SPAN, max_y: MAP_SPAN },
    lines: [
      { x1: 0, y1: 0, x2: MAP_SPAN, y2: 0, kind: 'one_sided' },
      { x1: MAP_SPAN, y1: 0, x2: MAP_SPAN, y2: MAP_SPAN, kind: 'one_sided' },
      { x1: MAP_SPAN, y1: MAP_SPAN, x2: 0, y2: MAP_SPAN, kind: 'two_sided' },
      { x1: 0, y1: MAP_SPAN, x2: 0, y2: 0, kind: 'secret' },
    ],
    things: [],
    secret_sectors: 0,
    damaging_sectors: 0,
  },
};

vi.mock('../../stores/wad.svelte', () => ({
  wad: {
    phase: 'loaded',
    summary: { kind: 'PWAD', lump_count: 6, map_count: 3, game: null },
    map2d: (name: string) => MAPS[name] ?? null,
    map2dError: () => null,
  },
}));

// Delegates to the real factory, so every test here drives actual WebGL2; the
// fallback test overrides a single call with `mockReturnValueOnce(null)`, which
// is the shape a device without WebGL2 produces and the only one this
// always-has-WebGL2 Chromium cannot produce on its own.
vi.mock('./gl/renderer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./gl/renderer')>();
  return { ...actual, createGlRenderer: vi.fn(actual.createGlRenderer) };
});

const { render } = await import('vitest-browser-svelte');
const Map2d = (await import('./Map2d.svelte')).default;
const { mapPrefs } = await import('../../stores/mapPrefs.svelte');
const { createGlRenderer } = await import('./gl/renderer');

/** Mirrors of the component's and the renderer's own constants — a drift here
 *  is a real failure, which is the point of restating rather than importing
 *  the private ones. */
const ZOOM_STEP = 1.1;
const GRID_ANNOUNCE_DELAY_MS = 500;
const CONTEXT_LOST_GRACE_MS = 3000;
/** Sinon's fake `requestAnimationFrame` fires on a 16 ms cadence; 20 ms is a
 *  deliberate margin over one frame. Not a mirror of anything. */
const FRAME_MS = 20;
const BASE_GRID: GridSize = 32;
/** `512 * scale < 8` from a fit scale of 0.0276 at 1.1 per press. */
const PRESSES_TO_CROSS = 6;
const TOO_SMALL = `Grid ${BASE_GRID}, too small to draw at this zoom`;

// See browser-test-helpers.ts for why this targets `.map2d` and not
// `document.body`.
installMapSizing();

beforeEach(() => {
  // `mapPrefs` is a singleton and every test in this file shares one page, so
  // state what these tests depend on rather than inheriting the previous test's
  // leftovers. Assigned directly rather than through the toggles, which
  // persist to `localStorage`. The grid stays OFF by default here: a drawn grid
  // would put ink in the center probe below and make the map-switch test pass
  // for the wrong reason.
  mapPrefs.showGrid = false;
  mapPrefs.gridSize = BASE_GRID;
  mapPrefs.glMsaa = false;
  mapPrefs.glFeather = true;
  vi.mocked(createGlRenderer).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

/** The component's grid live region — the first of its two `role="status"`
 *  paragraphs, as in every other announcement test here. */
function liveRegion(container: HTMLElement): HTMLElement {
  const live = container.querySelector('p.visually-hidden[role="status"]');
  expect(live, 'Map2d should render a live region').not.toBeNull();
  return live as HTMLElement;
}

function canvasIn(container: HTMLElement): HTMLCanvasElement {
  const canvas = container.querySelector('canvas');
  expect(canvas, 'Map2d should render a canvas').not.toBeNull();
  return canvas as HTMLCanvasElement;
}

/**
 * Whether the middle of the frame carries anything but the background clear.
 *
 * Reads the WebGL2 drawing buffer directly rather than through `painted()`:
 * `painted()` answers "did anything at all draw", which is true for both maps,
 * and the question here is whether the picture became the SECOND map's.
 * `readPixels` rows are bottom-up, which the centered probe box makes
 * irrelevant — the diagonal crosses the center either way up.
 */
function centerHasInk(canvas: HTMLCanvasElement): boolean {
  const gl = canvas.getContext('webgl2');
  if (!gl || canvas.width === 0 || canvas.height === 0) return false;
  const side = 60;
  const x = Math.round(canvas.width / 2 - side / 2);
  const y = Math.round(canvas.height / 2 - side / 2);
  const box = new Uint8Array(side * side * 4);
  gl.readPixels(x, y, side, side, gl.RGBA, gl.UNSIGNED_BYTE, box);
  // The frame's own corner pixel is the background clear color — no palette
  // knowledge needed, and it tracks a theme change for free.
  const bg = new Uint8Array(4);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bg);
  for (let p = 0; p < box.length; p += 4) {
    if (box[p] !== bg[0] || box[p + 1] !== bg[1] || box[p + 2] !== bg[2]) return true;
  }
  return false;
}

/** `-` zooms out one step. Dispatched on the canvas, where the handler lives. */
function pressZoomOut(canvas: HTMLCanvasElement, times = 1): void {
  canvas.focus();
  for (let i = 0; i < times; i++) {
    canvas.dispatchEvent(
      new KeyboardEvent('keydown', { key: '-', bubbles: true, cancelable: true }),
    );
  }
}

/** Let the pending redraw effect run, then let its scheduled frame draw. */
function settleFrame(): void {
  flushSync();
  vi.advanceTimersByTime(FRAME_MS);
  flushSync();
}

describe('Map2d on the WebGL2 backend', () => {
  it('mounts, sizes itself, and paints more than a background fill', async () => {
    const screen = await render(Map2d, { name: 'MAP01', renderer: 'gl', glProbe: true });
    const canvas = canvasIn(screen.container);
    expect(await painted(canvas)).toBe(true);
    expect(
      canvas.getContext('webgl2'),
      'the paint above must have come from WebGL2, not a silent fallback',
    ).not.toBeNull();
    expect(vi.mocked(createGlRenderer)).toHaveBeenCalledTimes(1);
  });

  it('paints the new map after an in-place switch (#128 boundary, on GL)', async () => {
    const screen = await render(Map2d, { name: 'MAP01', renderer: 'gl', glProbe: true });
    const canvas = canvasIn(screen.container);
    expect(await painted(canvas)).toBe(true);
    expect(canvas.getContext('webgl2'), 'this test must run on the GL path').not.toBeNull();
    expect(
      centerHasInk(canvas),
      'MAP01 must leave the middle of the view empty, or the switch proves nothing',
    ).toBe(false);

    // The MapView instance stays alive across a sidebar map switch, so this is
    // the shape #128's stale-label defect had: a prop change that must reach
    // the renderer's uploaded buffers, not just the redraw.
    await screen.rerender({ name: 'MAP02' });
    await expect.poll(() => centerHasInk(canvas), { timeout: 2000 }).toBe(true);
    expect(
      canvas.getContext('webgl2'),
      'the map switch must not have cost the GL context',
    ).not.toBeNull();
  });

  it('rebuilds the renderer for an MSAA change and not for a feather change', async () => {
    // The init effect's tracked surface, from the outside. Everything the
    // renderer can consume live must reach it through the frame instead: a
    // dependency that re-creates the context throws away the programs, the
    // buffers and the map upload, and does it on a preference toggle.
    const screen = await render(Map2d, { name: 'MAP01', renderer: 'gl', glProbe: true });
    const canvas = canvasIn(screen.container);
    expect(await painted(canvas)).toBe(true);
    expect(vi.mocked(createGlRenderer)).toHaveBeenCalledTimes(1);

    mapPrefs.glFeather = !mapPrefs.glFeather;
    flushSync();
    expect(
      vi.mocked(createGlRenderer),
      'feather is a live uniform — it must not re-create the renderer',
    ).toHaveBeenCalledTimes(1);
    expect(canvasIn(screen.container), 'feather must not replace the element').toBe(canvas);

    // MSAA is a context-creation attribute, so it has to do the opposite: a
    // second `getContext` on the same element would silently hand back the
    // context created with the old attributes.
    mapPrefs.glMsaa = !mapPrefs.glMsaa;
    flushSync();
    expect(
      vi.mocked(createGlRenderer),
      'MSAA must re-create the renderer',
    ).toHaveBeenCalledTimes(2);
    const replaced = canvasIn(screen.container);
    expect(replaced, 'MSAA must re-create it on a FRESH element').not.toBe(canvas);
    expect(await painted(replaced)).toBe(true);
  });

  it('announces a grid-size keypress on the GL path', async () => {
    mapPrefs.showGrid = true;
    const screen = await render(Map2d, { name: 'MAP01', renderer: 'gl', glProbe: true });
    const canvas = canvasIn(screen.container);
    expect(await painted(canvas)).toBe(true);
    expect(canvas.getContext('webgl2'), 'this test must run on the GL path').not.toBeNull();

    const live = liveRegion(screen.container);
    canvas.focus();
    canvas.dispatchEvent(
      new KeyboardEvent('keydown', { key: ']', bubbles: true, cancelable: true }),
    );
    flushSync();
    // 64 map units at the fit scale (2.16 px/unit on a 256-unit map in an
    // 800x600 box) is far above the drawable floor, so no suffix.
    expect(live.textContent, 'the grid keys must still speak on the GL path').toBe('Grid 64');
  });

  it('announces the debounced drawability crossing on the GL path', async () => {
    // The announcement machine lives in draw(), BEFORE the GL branch returns.
    // Nothing else pins that ordering: move the return one line earlier and
    // this is the test that goes red (#127/#128/#131 all landed in that block).
    mapPrefs.showGrid = true;
    const screen = await render(Map2d, { name: 'BIGMAP', renderer: 'gl', glProbe: true });
    const canvas = canvasIn(screen.container);
    expect(await painted(canvas), 'the map must paint before timers are faked').toBe(true);
    expect(canvas.getContext('webgl2'), 'this test must run on the GL path').not.toBeNull();
    const live = liveRegion(screen.container);
    expect(live.textContent, 'nothing is announced before a crossing').toBe('');

    // Measure the geometry rather than trusting it: a viewport that starts on
    // the wrong side of the floor would make the whole test vacuous.
    const box = screen.container.querySelector('.map2d') as HTMLElement;
    const fit = fitTransform(MAPS.BIGMAP.bounds, box.clientWidth, box.clientHeight);
    expect(effectiveGridSize(BASE_GRID, fit.scale), 'the grid must start drawable').not.toBeNull();
    expect(
      effectiveGridSize(BASE_GRID, fit.scale / ZOOM_STEP ** PRESSES_TO_CROSS),
      `${PRESSES_TO_CROSS} zoom-out presses must cross the drawability floor`,
    ).toBeNull();

    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
    });
    pressZoomOut(canvas, PRESSES_TO_CROSS);
    settleFrame();
    expect(live.textContent, 'the announcement is debounced, not immediate').toBe('');

    vi.advanceTimersByTime(GRID_ANNOUNCE_DELAY_MS);
    flushSync();
    expect(live.textContent).toBe(TOO_SMALL);
    expect(
      vi.mocked(createGlRenderer),
      'a gesture must redraw, never re-create the renderer',
    ).toHaveBeenCalledTimes(1);
  });
});

describe('Map2d falling back to the canvas backend', () => {
  it('falls back when GL init returns null', async () => {
    vi.mocked(createGlRenderer).mockReturnValueOnce(null);
    const screen = await render(Map2d, { name: 'MAP01', renderer: 'gl', glProbe: true });
    // The {#key} block hands the canvas path a FRESH element (a canvas is
    // single-context for life), so the element queried before the fallback is
    // not the one that ends up drawing.
    flushSync();
    const canvas = canvasIn(screen.container);
    expect(await painted(canvas)).toBe(true);
    expect(canvas.getContext('webgl2'), 'the fallback must draw through 2d').toBeNull();
    expect(
      vi.mocked(createGlRenderer),
      'a failed init must not be retried in a loop',
    ).toHaveBeenCalledTimes(1);
  });

  it('falls back when a lost context does not come back', async () => {
    const screen = await render(Map2d, { name: 'MAP01', renderer: 'gl', glProbe: true });
    const glCanvas = canvasIn(screen.container);
    expect(await painted(glCanvas)).toBe(true);
    const gl = glCanvas.getContext('webgl2');
    expect(gl, 'the loss test needs a real GL context to lose').not.toBeNull();
    const lose = (gl as WebGL2RenderingContext).getExtension('WEBGL_lose_context');
    expect(lose, 'headless Chromium must expose WEBGL_lose_context').not.toBeNull();

    const lost = new Promise<void>((resolve) => {
      glCanvas.addEventListener('webglcontextlost', () => resolve(), { once: true });
    });
    // Fake ONLY the timer the renderer's grace period runs on. Animation frames
    // stay real, so `painted()` below still observes actual ones — faking those
    // too would leave its poll with nothing to advance it.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    (lose as WEBGL_lose_context).loseContext();
    await lost;
    // A simulated loss is never restored (only `restoreContext()` does that),
    // so the renderer's grace period expires and the component gives up on GL.
    vi.advanceTimersByTime(CONTEXT_LOST_GRACE_MS);
    flushSync();
    vi.useRealTimers();

    const canvas = canvasIn(screen.container);
    expect(canvas, 'the {#key} block must replace the element on the way down').not.toBe(glCanvas);
    expect(await painted(canvas)).toBe(true);
    expect(canvas.getContext('webgl2'), 'the fallback must draw through 2d').toBeNull();
  });

  it('still paints when the renderer prop asks for canvas', async () => {
    const screen = await render(Map2d, { name: 'MAP01', renderer: 'canvas' });
    const canvas = canvasIn(screen.container);
    expect(await painted(canvas)).toBe(true);
    expect(canvas.getContext('webgl2'), 'the canvas path must not touch WebGL2').toBeNull();
    expect(
      vi.mocked(createGlRenderer),
      'the canvas path must not even try to create a GL renderer',
    ).not.toHaveBeenCalled();
  });
});
