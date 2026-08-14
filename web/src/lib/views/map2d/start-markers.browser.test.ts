import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Map2d as Map2dPayload } from '../../format';
import { installMapSizing, painted } from './browser-test-helpers';

/**
 * #72: start markers are drawn straight to the canvas, so no DOM query can see
 * them. Comparing two renders of the same map — one whose payload carries a
 * start, one whose does not — isolates a single draw call and nothing else.
 */
const BASE: Map2dPayload = {
  name: 'MAP01',
  bounds: { min_x: 0, min_y: 0, max_x: 512, max_y: 512 },
  lines: [
    { x1: 0, y1: 0, x2: 512, y2: 0, kind: 'one_sided' },
    { x1: 512, y1: 0, x2: 512, y2: 512, kind: 'one_sided' },
    { x1: 512, y1: 512, x2: 0, y2: 512, kind: 'two_sided' },
    { x1: 0, y1: 512, x2: 0, y2: 0, kind: 'secret' },
  ],
  things: [],
  secret_sectors: 0,
  damaging_sectors: 0,
};

const withPlayer1: Map2dPayload = {
  ...BASE,
  things: [{ x: 256, y: 256, angle: 90, type_id: 1 }],
};

let payload: Map2dPayload = BASE;

vi.mock('../../stores/wad.svelte', () => ({
  wad: {
    phase: 'loaded',
    summary: { kind: 'PWAD', lump_count: 6, map_count: 1, game: null },
    map2d: () => payload,
    map2dError: () => null,
  },
}));

const { render } = await import('vitest-browser-svelte');
const Map2d = (await import('./Map2d.svelte')).default;
const { mapPrefs } = await import('../../stores/mapPrefs.svelte');

installMapSizing();

/** The canvas's pixels, once it has painted. */
async function snapshot(): Promise<string> {
  const screen = await render(Map2d, { name: 'MAP01' });
  const canvas = screen.container.querySelector('canvas');
  // Assert before casting: without this a missing canvas throws an opaque null
  // dereference inside `painted()` instead of naming what went wrong.
  expect(canvas, 'Map2d should render a canvas').not.toBeNull();
  expect(await painted(canvas as HTMLCanvasElement)).toBe(true);
  return (canvas as HTMLCanvasElement).toDataURL();
}

// `mapPrefs` is a module singleton, so a test that flips a preference and walks
// away leaves it flipped for whatever runs next in this file. Restore rather
// than reset-to-default: the point is to leave no trace, not to assert one.
const showThingsDefault = mapPrefs.showThings;
const alwaysShowPlayerStartDefault = mapPrefs.alwaysShowPlayerStart;
afterEach(() => {
  payload = BASE;
  mapPrefs.showThings = showThingsDefault;
  mapPrefs.alwaysShowPlayerStart = alwaysShowPlayerStartDefault;
});

describe('the player 1 arrow', () => {
  it('draws with things hidden when the Start override is on', async () => {
    mapPrefs.showThings = false;
    mapPrefs.alwaysShowPlayerStart = true;

    payload = BASE;
    const without = await snapshot();
    payload = withPlayer1;
    const withIt = await snapshot();
    expect(withIt, 'the Start override must draw the arrow on its own').not.toBe(without);
  });

  it('stays hidden when things are off and the override is off', async () => {
    mapPrefs.showThings = false;
    mapPrefs.alwaysShowPlayerStart = false;

    payload = BASE;
    const without = await snapshot();
    payload = withPlayer1;
    const withIt = await snapshot();
    expect(withIt, 'with both controls off nothing should mark the start').toBe(without);
  });
});
