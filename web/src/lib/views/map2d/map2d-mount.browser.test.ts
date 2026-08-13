import { describe, it, expect, vi } from 'vitest';
import type { Map2d as Map2dPayload } from '../../format';

/**
 * The template for browser-tier tests (#129). Mocking the `wad` store rather
 * than booting wasm is the correct isolation for a component test, and it is
 * what makes `Map2d` mountable at all.
 */
const MAP: Map2dPayload = {
  name: 'MAP01',
  bounds: { min_x: 0, min_y: 0, max_x: 256, max_y: 256 },
  lines: [
    { x1: 0, y1: 0, x2: 256, y2: 0, kind: 'one_sided' },
    { x1: 256, y1: 0, x2: 256, y2: 256, kind: 'one_sided' },
    { x1: 256, y1: 256, x2: 0, y2: 256, kind: 'two_sided' },
    { x1: 0, y1: 256, x2: 0, y2: 0, kind: 'secret' },
  ],
  things: [{ x: 128, y: 128, angle: 90, type_id: 1 }],
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

/** One keypress zoom step, mirroring `Map2d`'s own constant. */
const ZOOM_STEP = 1.1;

// Size the component's own box, NOT `document.body`: the canvas is absolutely
// positioned and out of flow, so a body height leaves `.map2d` collapsed onto
// its 12rem `min-height` and every test computes its fit from ~192px. Copy this
// rule, not a body style. Svelte's scoped styles keep the authored class name,
// so this plain selector matches, and the component sets `min-height` rather
// than `height`, so there is no specificity fight. Appended for the lifetime of
// the file: browser-mode gives each test file its own page, and the selector
// names a class only this component uses.
const sizing = document.createElement('style');
sizing.textContent = '.map2d { width: 800px; height: 600px; }';
document.head.append(sizing);

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

describe('Map2d in the browser tier', () => {
  it('mounts, sizes itself, and paints more than a background fill', async () => {
    const screen = await render(Map2d, { name: 'MAP01' });
    const canvas = screen.container.querySelector('canvas');
    expect(canvas, 'Map2d should render a canvas').not.toBeNull();
    // The same "more than one distinct pixel" assertion the E2E suite uses, so a
    // solid background fill cannot pass for a drawn map.
    expect(await painted(canvas as HTMLCanvasElement)).toBe(true);
  });

  it('exposes its view controls to a caller', async () => {
    const screen = await render(Map2d, { name: 'MAP01' });
    const canvas = screen.container.querySelector('canvas') as HTMLCanvasElement;
    const api = screen.component as unknown as {
      zoomFactor: () => number;
      categoryCounts: () => Record<string, number> | null;
    };
    // `zoomFactor()` returns its 1 fallback both before a fit resolves and right
    // after one, so its type — or its value on its own — cannot tell "fitted"
    // from "never fitted". A readout that MOVES can: the zoom keys no-op while
    // `transform` is null, so a press that lands proves the fit resolved.
    // Waiting on a real paint is what makes the press land; a fixed sleep would
    // only be waiting on the same thing, less reliably.
    expect(await painted(canvas), 'the map must fit and paint before it can zoom').toBe(true);
    canvas.dispatchEvent(
      new KeyboardEvent('keydown', { key: '-', bubbles: true, cancelable: true }),
    );
    await expect.poll(() => api.zoomFactor()).toBeCloseTo(1 / ZOOM_STEP, 5);

    const counts = api.categoryCounts();
    expect(counts, 'counts resolve as soon as the map does').not.toBeNull();
    expect(
      Object.values(counts as Record<string, number>).reduce((a, b) => a + b, 0),
      'every thing in the map is counted into some category',
    ).toBe(MAP.things.length);
  });
});
