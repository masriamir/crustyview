import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import type { Map2d as Map2dPayload } from '../../format';
import { installMapSizing, painted } from './browser-test-helpers';
import { effectiveGridSize } from './grid';
import { fitTransform } from './transform';

/**
 * #131: selecting a different map must not announce the grid's drawable state.
 * `Map2d` is reused across an in-place switch, so without a reset the outgoing
 * map's baseline compares against the incoming map's initial state — reporting
 * a transition that never happened to the grid, and inconsistently, since the
 * first map opened is silent for want of any baseline.
 */
const MAP_SPAN = 20000;

function mapNamed(name: string): Map2dPayload {
  return {
    name,
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
}

vi.mock('../../stores/wad.svelte', () => ({
  wad: {
    phase: 'loaded',
    summary: { kind: 'PWAD', lump_count: 6, map_count: 2, game: null },
    map2d: (name: string) => mapNamed(name),
    map2dError: () => null,
  },
}));

const { render } = await import('vitest-browser-svelte');
const Map2d = (await import('./Map2d.svelte')).default;
const { mapPrefs } = await import('../../stores/mapPrefs.svelte');

const BASE_GRID = 32;
const PRESSES_TO_CROSS = 6;
const FRAME_MS = 20;
const GRID_ANNOUNCE_DELAY_MS = 500;
/** Identical for both maps — which is exactly what step 2's `toBe('')` guards. */
const TOO_SMALL = `Grid ${BASE_GRID}, too small to draw at this zoom`;

installMapSizing();

beforeEach(() => {
  mapPrefs.showGrid = true;
  mapPrefs.gridSize = BASE_GRID;
});

afterEach(() => {
  vi.useRealTimers();
});

function pressZoomOut(canvas: HTMLCanvasElement, times: number): void {
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

describe('grid announcement across a map switch', () => {
  it('stays silent on the switch, and still announces transitions on the new map', async () => {
    const screen = await render(Map2d, { name: 'MAP01' });
    const canvas = screen.container.querySelector('canvas') as HTMLCanvasElement;
    expect(await painted(canvas), 'the map must paint before timers are faked').toBe(true);
    const live = screen.container.querySelector('p.visually-hidden[role="status"]') as HTMLElement;
    expect(live, 'Map2d should render a live region').not.toBeNull();

    // Measure the geometry rather than trusting it. Both maps share this span so
    // that MAP01 ends undrawable while MAP02 starts drawable — if that stops
    // holding, the switch is no longer a state difference and step 2 would pass
    // for the wrong reason. Named preconditions make that drift legible instead
    // of surfacing as a bare string mismatch three assertions later.
    const box = screen.container.querySelector('.map2d') as HTMLElement;
    const fit = fitTransform(mapNamed('MAP01').bounds, box.clientWidth, box.clientHeight);
    expect(effectiveGridSize(BASE_GRID, fit.scale), 'both maps must start drawable').not.toBeNull();
    expect(
      effectiveGridSize(BASE_GRID, fit.scale / 1.1 ** PRESSES_TO_CROSS),
      `${PRESSES_TO_CROSS} zoom-out presses must cross the drawability floor`,
    ).toBeNull();

    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
    });

    // 1. A real transition on MAP01 still announces.
    pressZoomOut(canvas, PRESSES_TO_CROSS);
    settleFrame();
    await vi.advanceTimersByTimeAsync(GRID_ANNOUNCE_DELAY_MS + FRAME_MS);
    expect(live.textContent, 'a genuine crossing on the first map must announce').toBe(TOO_SMALL);

    // 2. Switching maps must not. MAP01 ends undrawable and MAP02 starts
    //    drawable, so this is a real state difference — it would announce
    //    without the reset.
    //
    //    Asserting the region is *empty*, rather than merely unchanged, is what
    //    guards the same-string trap: both maps produce the byte-identical
    //    "too small" text, so a stale value left here would make the next
    //    genuine crossing a no-op write that the DOM — and therefore the
    //    screen reader — never sees. Verified: dropping `gridAnnouncement = ''`
    //    from the reset fails this assertion.
    await screen.rerender({ name: 'MAP02' });
    settleFrame();
    await vi.advanceTimersByTimeAsync(GRID_ANNOUNCE_DELAY_MS + FRAME_MS);
    expect(live.textContent, 'a map switch is not a grid transition').toBe('');

    // 3. And a genuine transition on MAP02 announces again — proving the reset
    //    suppressed the switch without disabling announcements on the new map.
    pressZoomOut(canvas, PRESSES_TO_CROSS);
    settleFrame();
    await vi.advanceTimersByTimeAsync(GRID_ANNOUNCE_DELAY_MS + FRAME_MS);
    expect(live.textContent, 'a crossing on the second map must still announce').toBe(TOO_SMALL);
  });
});
