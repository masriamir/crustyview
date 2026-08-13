import { describe, it, expect, vi, beforeEach } from 'vitest';
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

beforeEach(() => {
  document.body.style.width = '800px';
  document.body.style.height = '600px';
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
    const api = screen.component as unknown as {
      zoomFactor: () => number;
      categoryCounts: () => Record<string, number> | null;
    };
    await new Promise((r) => setTimeout(r, 100));
    expect(typeof api.zoomFactor()).toBe('number');
    expect(api.categoryCounts()).not.toBeNull();
  });
});
