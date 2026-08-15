import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Map2d as Map2dPayload } from '../../format';
import { installMapSizing, painted } from './browser-test-helpers';

/**
 * #66: the links are drawn inside the same overlay as the teleport source
 * lines, so the E2E chip spec cannot distinguish them. Comparing two renders
 * of the same map — one whose payload carries a link, one whose does not —
 * isolates `drawTeleportLinks` and nothing else.
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

const withLink: Map2dPayload = { ...BASE, links: [{ from: [64, 64], to: [448, 448] }] };

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
const showTeleportLinesDefault = mapPrefs.showTeleportLines;
afterEach(() => {
  mapPrefs.showTeleportLines = showTeleportLinesDefault;
});

describe('teleport links', () => {
  it('draw only when the payload carries them and the overlay is on', async () => {
    mapPrefs.showTeleportLines = true;

    payload = BASE;
    const without = await snapshot();
    payload = withLink;
    const withIt = await snapshot();
    expect(withIt, 'a link in the payload must change what is drawn').not.toBe(without);

    // And they belong to the teleport overlay, not to the base map.
    mapPrefs.showTeleportLines = false;
    payload = BASE;
    const offWithout = await snapshot();
    payload = withLink;
    const offWith = await snapshot();
    expect(offWith, 'with the overlay off, a link must change nothing').toBe(offWithout);
  });

  /**
   * #162. Links are culled on their ENDPOINTS, not on whether their chord
   * crosses the view — a deliberate departure from #153's trivial-reject rule,
   * which every other pass still uses.
   *
   * The rule differs because a link is an annotation about a pair of places
   * rather than map geometry. Dropping a wall that crosses the view destroys
   * structure; dropping a link whose two ends are both off screen removes an
   * arc that says nothing about where it goes or where it came from. On
   * Eviternity II MAP26 that distinction is 1,668 uncullable arcs against a
   * handful, and it is why high zoom cost MORE than fit before this change.
   *
   * Both fixtures place endpoints outside the declared `bounds`, which
   * `fitTransform` fits instead of the geometry — the standard trick here for
   * putting things off screen without driving the zoom keys.
   */
  const CROSSING_LINK: Map2dPayload = {
    ...BASE,
    // Both ends far outside, on OPPOSITE edges, so the chord sweeps straight
    // across the viewport. This is exactly the shape trivial reject keeps.
    links: [{ from: [-50000, 256], to: [60000, 256] }],
  };
  const ANCHORED_LINK: Map2dPayload = {
    ...BASE,
    // One end inside the view, the other far outside: still readable, so it
    // must survive.
    links: [{ from: [256, 256], to: [60000, 256] }],
  };

  it('skip a link whose two endpoints are both off screen', async () => {
    mapPrefs.showTeleportLines = true;
    payload = BASE;
    const without = await snapshot();
    payload = CROSSING_LINK;
    const withCrossing = await snapshot();
    expect(
      withCrossing,
      'a link with both ends off screen carries no information and must not draw',
    ).toBe(without);
  });

  it('still draw a link with one endpoint on screen', async () => {
    // The other half of the rule, and the one that keeps it from being "drop
    // every link that leaves the view": a visible terminus is readable.
    mapPrefs.showTeleportLines = true;
    payload = BASE;
    const without = await snapshot();
    payload = ANCHORED_LINK;
    const withAnchored = await snapshot();
    expect(withAnchored, 'a link anchored in view must still draw').not.toBe(without);
  });
});
