import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import type { Map2d as Map2dPayload } from '../../format';
import { effectiveGridSize, type GridSize } from './grid';
import { fitTransform } from './transform';

/**
 * Regression test for #127, in the browser tier (#129).
 *
 * The grid's "too small to draw" announcement is debounced by 500 ms so a zoom
 * that overshoots and corrects announces once, at wherever it lands. The
 * original wiring canceled that pending timer from the redraw `$effect`'s
 * teardown — an effect that tracks `transform`, so it re-runs on every zoom
 * tick, and Svelte runs an effect's cleanup before each re-run. A gesture that
 * kept going past the crossing therefore lost the announcement entirely instead
 * of delaying it. The fix moved the cancel to `onDestroy`.
 *
 * Nothing in the gate could see this: it is reactivity wiring, not types, not a
 * pure function, and not something the E2E suite drives. That is the whole
 * argument for a real-browser component tier.
 */

/**
 * A 20000x20000 map, so the fit already coarsens the grid to 512 (14.1 px at
 * 800x600) — comfortably above the 8 px floor, which puts the test on the
 * drawable side of the boundary with room to cross it. A small map never
 * approaches the floor and no transition can occur at all.
 */
const MAP_SPAN = 20000;

const MAP: Map2dPayload = {
  name: 'MAP01',
  bounds: { min_x: 0, min_y: 0, max_x: MAP_SPAN, max_y: MAP_SPAN },
  lines: [
    { x1: 0, y1: 0, x2: MAP_SPAN, y2: 0, kind: 'one_sided' },
    { x1: MAP_SPAN, y1: 0, x2: MAP_SPAN, y2: MAP_SPAN, kind: 'one_sided' },
    { x1: MAP_SPAN, y1: MAP_SPAN, x2: 0, y2: MAP_SPAN, kind: 'two_sided' },
    { x1: 0, y1: MAP_SPAN, x2: 0, y2: 0, kind: 'secret' },
  ],
  things: [{ x: MAP_SPAN / 2, y: MAP_SPAN / 2, angle: 90, type_id: 1 }],
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

/** Mirrors of the component's own constants — a drift here is a real failure. */
const ZOOM_STEP = 1.1;
const GRID_ANNOUNCE_DELAY_MS = 500;
/** One faked animation frame; sinon's fake `requestAnimationFrame` runs at 16 ms. */
const FRAME_MS = 20;

const BASE_GRID: GridSize = 32;
/** `512 x scale < 8` from a fit scale of 0.0276 at 1.1 per press. */
const PRESSES_TO_CROSS = 6;
/**
 * The rest of the gesture: zoom ticks that arrive while the announcement is
 * pending. `CONTINUED_TICKS * FRAME_MS` must stay well under the debounce, so
 * the ticks land on a timer that is still armed. It cannot manufacture a false
 * pass — under the broken wiring the first tick clears the timer and nothing
 * ever fires — but at 500 ms or more of ticks the timer would fire during the
 * loop and the final assertion would then hold for a much weaker reason.
 */
const CONTINUED_TICKS = 4;
const TOO_SMALL = `Grid ${BASE_GRID}, too small to draw at this zoom`;

// `.map2d` takes its size from the layout around it, which a mounted-alone
// component does not have. Pin the box the fit is computed from so the zoom
// arithmetic below is the same on every machine. Sizing `document.body` instead
// would NOT work: the canvas is absolutely positioned and out of flow, leaving
// the container collapsed onto its 12rem `min-height`, which starts the grid
// already undrawable and makes the whole test vacuous. Scoped Svelte styles keep
// the authored class name, so this plain selector still matches. Never removed,
// deliberately: browser mode gives each test file its own page, and the selector
// names a class only this component uses.
const sizing = document.createElement('style');
sizing.textContent = '.map2d { width: 800px; height: 600px; }';
document.head.append(sizing);

beforeEach(() => {
  // `mapPrefs` is a singleton and tests in a file share one page, so state the
  // two preferences these tests depend on rather than inheriting whatever ran
  // before. Assigned directly rather than through `toggleGrid`/`setGridSize`
  // because those call `#persist()`: a bare assignment is still reactive but
  // writes nothing to `localStorage`, so no test leaves preferences behind.
  mapPrefs.showGrid = true;
  mapPrefs.gridSize = BASE_GRID;
});

afterEach(() => {
  vi.useRealTimers();
});

/** Wait for the ResizeObserver -> fit -> rAF draw chain to settle. */
async function painted(canvas: HTMLCanvasElement): Promise<boolean> {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const ctx = canvas.getContext('2d');
    if (!ctx || canvas.width === 0) continue;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const [r0, g0, b0, a0] = data;
    for (let p = 4; p < data.length; p += 4) {
      if (data[p] !== r0 || data[p + 1] !== g0 || data[p + 2] !== b0 || data[p + 3] !== a0) {
        return true;
      }
    }
  }
  return false;
}

interface Mounted {
  canvas: HTMLCanvasElement;
  /** The component's `role="status"` live region. */
  live: HTMLElement;
  zoomFactor: () => number;
}

/**
 * Mount, paint, and check the setup this test rests on. The paint must happen
 * under real timers: `ResizeObserver` is browser-scheduled rather than
 * timer-driven, so faking timers first hangs the setup with nothing to advance.
 */
async function mountPainted(): Promise<Mounted> {
  const screen = await render(Map2d, { name: 'MAP01' });
  const canvas = screen.container.querySelector('canvas');
  expect(canvas, 'Map2d should render a canvas').not.toBeNull();
  expect(
    await painted(canvas as HTMLCanvasElement),
    'the map must paint before timers are faked, or no baseline is established',
  ).toBe(true);

  // Measure the geometry rather than trusting it: the announcement only fires on
  // a crossing from an established baseline, so a viewport that starts on the
  // wrong side of the floor would make the whole test vacuous.
  const box = screen.container.querySelector('.map2d') as HTMLElement;
  const fit = fitTransform(MAP.bounds, box.clientWidth, box.clientHeight);
  expect(effectiveGridSize(BASE_GRID, fit.scale), 'the grid must start drawable').not.toBeNull();
  expect(
    effectiveGridSize(BASE_GRID, fit.scale / ZOOM_STEP ** PRESSES_TO_CROSS),
    `${PRESSES_TO_CROSS} zoom-out presses must cross the drawability floor`,
  ).toBeNull();

  const live = screen.container.querySelector('p.visually-hidden[role="status"]');
  expect(live, 'Map2d should render a live region').not.toBeNull();
  const api = screen.component as unknown as { zoomFactor: () => number };
  return {
    canvas: canvas as HTMLCanvasElement,
    live: live as HTMLElement,
    zoomFactor: api.zoomFactor,
  };
}

/** Fake everything the debounce and the redraw schedule themselves on. */
function fakeTimers(): void {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
  });
}

/**
 * `-` zooms out by one step. The handler is declared on the canvas, so that is
 * where the key is dispatched — though delivery does not actually depend on it:
 * Svelte delegates `keydown` to the mount root and the event bubbles, so focus
 * is not what routes it. The `focus()` call below just keeps the gesture honest
 * to how a user reaches these keys. `[` / `]` are deliberately not used, since
 * `adjustGridSize` announces immediately and would bypass the debounce under
 * test.
 */
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

describe('grid drawability announcement', () => {
  it('announces the crossing once the debounce elapses', async () => {
    const { canvas, live } = await mountPainted();
    expect(live.textContent, 'nothing is announced before a crossing').toBe('');
    fakeTimers();

    pressZoomOut(canvas, PRESSES_TO_CROSS);
    settleFrame();
    expect(live.textContent, 'the announcement is debounced, not immediate').toBe('');

    vi.advanceTimersByTime(GRID_ANNOUNCE_DELAY_MS);
    flushSync();
    expect(live.textContent).toBe(TOO_SMALL);
  });

  it('survives zoom ticks that keep arriving after the crossing (#127)', async () => {
    const { canvas, live, zoomFactor } = await mountPainted();
    fakeTimers();

    pressZoomOut(canvas, PRESSES_TO_CROSS);
    settleFrame();

    // The gesture continues. Each tick re-runs the redraw effect — which tracks
    // `transform` — and Svelte runs an effect's cleanup before every re-run.
    // With the cancel wired there, these ticks silently discard the pending
    // announcement instead of delaying it.
    for (let i = 0; i < CONTINUED_TICKS; i++) {
      pressZoomOut(canvas);
      settleFrame();
    }
    expect(
      zoomFactor(),
      'the keypresses must actually reach the component, or nothing is under test',
    ).toBeCloseTo(ZOOM_STEP ** -(PRESSES_TO_CROSS + CONTINUED_TICKS), 5);

    vi.advanceTimersByTime(GRID_ANNOUNCE_DELAY_MS);
    flushSync();
    expect(
      live.textContent,
      'the continued gesture must delay the announcement, not cancel it',
    ).toBe(TOO_SMALL);
  });
});
