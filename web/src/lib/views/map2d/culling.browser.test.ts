import { describe, it, expect, vi } from 'vitest';
import type { Map2d as Map2dPayload } from '../../format';
import { installMapSizing, painted } from './browser-test-helpers';

/**
 * #153: a line whose endpoints are both far outside the viewport but which
 * crosses it must still draw. `fitTransform` fits the payload's `bounds`, not
 * its geometry, so declaring small bounds around a very long line puts both
 * endpoints off screen at fit zoom with no need to drive the zoom keys.
 *
 * An endpoint-containment cull drops this line and leaves the canvas at a
 * uniform background fill, which is exactly what `painted()` detects.
 */
const CROSSING: Map2dPayload = {
  name: 'MAP01',
  bounds: { min_x: 0, min_y: 0, max_x: 1000, max_y: 1000 },
  lines: [{ x1: -50000, y1: 500, x2: 60000, y2: 500, kind: 'one_sided' }],
  things: [],
  secret_sectors: 0,
  damaging_sectors: 0,
};

vi.mock('../../stores/wad.svelte', () => ({
  wad: {
    phase: 'loaded',
    summary: { kind: 'PWAD', lump_count: 6, map_count: 1, game: null },
    map2d: () => CROSSING,
    map2dError: () => null,
  },
}));

const { render } = await import('vitest-browser-svelte');
const Map2d = (await import('./Map2d.svelte')).default;

installMapSizing();

describe('viewport culling', () => {
  it('keeps a line that crosses the viewport with both ends far outside', async () => {
    const screen = await render(Map2d, { name: 'MAP01' });
    const canvas = screen.container.querySelector('canvas');
    // Assert before casting: without this a missing canvas throws an opaque
    // null dereference inside `painted()` instead of naming what went wrong.
    expect(canvas, 'Map2d should render a canvas').not.toBeNull();
    expect(
      await painted(canvas as HTMLCanvasElement),
      'the crossing line must survive culling',
    ).toBe(true);
  });
});
