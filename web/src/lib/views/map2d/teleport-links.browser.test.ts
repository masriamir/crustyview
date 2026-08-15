import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Map2d as Map2dPayload } from '../../format';
import { installMapSizing, painted } from './browser-test-helpers';
import type { TeleportArcCap } from './teleportArcs';

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
const showTeleportArcsDefault = mapPrefs.showTeleportArcs;
const teleportArcCapDefault = mapPrefs.teleportArcCap;
const styleDefault = mapPrefs.style;
afterEach(() => {
  mapPrefs.showTeleportLines = showTeleportLinesDefault;
  mapPrefs.showTeleportArcs = showTeleportArcsDefault;
  mapPrefs.teleportArcCap = teleportArcCapDefault;
  mapPrefs.style = styleDefault;
});

describe('teleport links', () => {
  it('draw only when the payload carries them and the overlay is on', async () => {
    // Both preferences: since #154 the arcs have their own toggle, so the
    // source-line toggle alone no longer decides whether a link draws.
    mapPrefs.showTeleportLines = true;
    mapPrefs.showTeleportArcs = true;

    payload = BASE;
    const without = await snapshot();
    payload = withLink;
    const withIt = await snapshot();
    expect(withIt, 'a link in the payload must change what is drawn').not.toBe(without);

    // And they belong to the teleport overlay, not to the base map.
    mapPrefs.showTeleportLines = false;
    mapPrefs.showTeleportArcs = false;
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
    mapPrefs.showTeleportArcs = true;
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
    mapPrefs.showTeleportArcs = true;
    payload = BASE;
    const without = await snapshot();
    payload = ANCHORED_LINK;
    const withAnchored = await snapshot();
    expect(withAnchored, 'a link anchored in view must still draw').not.toBe(without);
  });

  /**
   * #154. Links of clearly different lengths, all with both endpoints on screen
   * at fit zoom so culling drops none of them and the CAP is the only thing
   * under test.
   *
   * The count must exceed the ladder's smallest rung (`TELEPORT_ARC_CAPS[0]` is
   * 25), or `selectArcs` returns every candidate and the capped and uncapped
   * renders are pixel-identical — a test that passes whatever the cap does.
   */
  const MANY_LINKS: Map2dPayload = {
    ...BASE,
    links: Array.from({ length: 40 }, (_, i) => ({
      from: [16, 16 + i * 12] as [number, number],
      to: [40 + i * 11, 16 + i * 12] as [number, number],
    })),
  };

  /** Pixels within tolerance of the classic teleport color. */
  function linkPixels(canvas: HTMLCanvasElement): number {
    const ctx = canvas.getContext('2d');
    expect(ctx, 'a 2D context is required to inspect the canvas').not.toBeNull();
    const { data } = (ctx as CanvasRenderingContext2D).getImageData(
      0,
      0,
      canvas.width,
      canvas.height,
    );
    const [r, g, b] = [0x5e, 0x5c, 0xe6];
    let found = 0;
    for (let p = 0; p < data.length; p += 4) {
      if (
        Math.abs(data[p] - r) <= 24 &&
        Math.abs(data[p + 1] - g) <= 24 &&
        Math.abs(data[p + 2] - b) <= 24
      ) {
        found += 1;
      }
    }
    return found;
  }

  async function paintWithCap(cap: TeleportArcCap): Promise<number> {
    mapPrefs.style = 'classic';
    mapPrefs.showTeleportArcs = true;
    // Pinned, not left to its default: `linkPixels` counts every pixel of the
    // teleport color and the source-line overlay strokes in that same color, so
    // the isolation must be stated rather than resting on `MANY_LINKS`'s walls
    // happening to carry no `teleport` flag.
    mapPrefs.showTeleportLines = false;
    mapPrefs.teleportArcCap = cap;
    payload = MANY_LINKS;
    const screen = await render(Map2d, { name: 'MAP01' });
    const canvas = screen.container.querySelector('canvas') as HTMLCanvasElement;
    expect(await painted(canvas)).toBe(true);
    return linkPixels(canvas);
  }

  it('draws fewer arcs when the cap bites', async () => {
    // A cap below the link count must paint strictly less teleport ink. Both
    // runs are the same map at the same zoom, so the only difference is the cap.
    const capped = await paintWithCap(25);
    const uncapped = await paintWithCap('all');
    expect(uncapped, 'the uncapped run must paint some teleport ink at all').toBeGreaterThan(0);
    expect(capped).toBeLessThan(uncapped);
  });

  it('re-renders through the cache when the cap changes', async () => {
    // The cap is baked into the tile, so stepping it must invalidate rather
    // than leave a stale bitmap. Panning first guarantees a tile is in use.
    mapPrefs.style = 'classic';
    mapPrefs.showTeleportArcs = true;
    mapPrefs.showTeleportLines = false;
    mapPrefs.teleportArcCap = 'all';
    payload = MANY_LINKS;
    const screen = await render(Map2d, { name: 'MAP01' });
    const canvas = screen.container.querySelector('canvas') as HTMLCanvasElement;
    expect(await painted(canvas)).toBe(true);
    for (let i = 0; i < 2; i++) {
      canvas.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
      );
    }
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    const before = linkPixels(canvas);
    mapPrefs.teleportArcCap = 25;
    await expect.poll(() => linkPixels(canvas)).toBeLessThan(before);
  });
});
