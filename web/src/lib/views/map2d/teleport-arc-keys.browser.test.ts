import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushSync } from 'svelte';
import type { Map2d as Map2dPayload } from '../../format';
import { installMapSizing, painted } from './browser-test-helpers';

/**
 * #154 fix round 1, finding 3: a wiring test for the `,` / `.` arc-cap keys,
 * covering key handler -> `mapPrefs.teleportArcCap` -> the immediate
 * `role="status"` announcement -> its wording.
 *
 * Mirrors `grid-announcement.browser.test.ts`'s argument for the browser
 * tier: this is about *when* and *what* an announcement says, not a pure
 * computation, so no other gate can see it. Finding 1 in this same round (the
 * `null`/`0` conflation on the button's label) was exactly a wiring bug that
 * passed inspection — this file is the compensating control the coordinator
 * asked for instead.
 */

/**
 * Deliberately between the 50 and 100 rungs of `TELEPORT_ARC_CAPS`, so the
 * announced text genuinely differs across the ladder ("N of 60 drawn" below
 * 60, "cap N" at or above it) rather than every press coincidentally
 * producing the same string.
 */
const LINK_TOTAL = 60;

const MAP: Map2dPayload = {
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
  // Positions don't matter: these tests never inspect pixels, only the count.
  links: Array.from({ length: LINK_TOTAL }, (_, i) => ({
    from: [16, 16 + i] as [number, number],
    to: [64, 16 + i] as [number, number],
  })),
};

/** Fix round 2, finding 2: a map with no `links` field at all, for the
 *  zero-link decline test below. */
const NO_LINKS_MAP: Map2dPayload = { ...MAP, links: undefined };

let payload: Map2dPayload = MAP;

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

// `mapPrefs` is a module singleton, so a test that flips a preference and
// walks away leaves it flipped for whatever runs next in this file (and in
// files that share the page). Restore rather than reset-to-default, as
// `teleport-links.browser.test.ts` does. `payload` resets too, so a test that
// switches to `NO_LINKS_MAP` doesn't leak into the next.
const showTeleportArcsDefault = mapPrefs.showTeleportArcs;
const teleportArcCapDefault = mapPrefs.teleportArcCap;
afterEach(() => {
  mapPrefs.showTeleportArcs = showTeleportArcsDefault;
  mapPrefs.teleportArcCap = teleportArcCapDefault;
  payload = MAP;
});

interface Mounted {
  canvas: HTMLCanvasElement;
  /** The arc-cap live region — the SECOND `role="status"` element in the
   *  markup, after the grid's own (kept deliberately separate, see #154's
   *  brief). Selecting by index rather than a unique attribute mirrors how
   *  little distinguishes them in the DOM; both are `p.visually-hidden`. */
  live: HTMLElement;
}

async function mountPainted(): Promise<Mounted> {
  const screen = await render(Map2d, { name: 'MAP01' });
  const canvas = screen.container.querySelector('canvas');
  expect(canvas, 'Map2d should render a canvas').not.toBeNull();
  expect(await painted(canvas as HTMLCanvasElement)).toBe(true);
  const regions = screen.container.querySelectorAll('p.visually-hidden[role="status"]');
  expect(regions.length, 'Map2d should render both the grid and arc-cap live regions').toBe(2);
  return { canvas: canvas as HTMLCanvasElement, live: regions[1] as HTMLElement };
}

/** Dispatch a `,` or `.` keydown on the canvas, as a keyboard user would. */
function press(canvas: HTMLCanvasElement, key: ',' | '.'): void {
  canvas.focus();
  canvas.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  flushSync();
}

describe('teleport arc cap keys', () => {
  it('. raises the cap and , lowers it', async () => {
    mapPrefs.teleportArcCap = 100;
    const { canvas } = await mountPainted();

    press(canvas, '.');
    expect(mapPrefs.teleportArcCap).toBe(200);

    press(canvas, ',');
    expect(mapPrefs.teleportArcCap).toBe(100);
  });

  it('announces the new cap on every press, naming it in words', async () => {
    mapPrefs.teleportArcCap = 100;
    const { canvas, live } = await mountPainted();
    expect(live.textContent, 'nothing pending before any press').toBe('');

    press(canvas, '.');
    expect(live.textContent).toBe('Show teleport links, cap 200');

    press(canvas, ',');
    expect(live.textContent).toBe('Show teleport links, cap 100');

    press(canvas, ',');
    expect(live.textContent).toBe(`Show teleport links, 50 of ${LINK_TOTAL} drawn`);
  });

  it('still announces at the bottom of the ladder, with distinct clamped wording', async () => {
    mapPrefs.teleportArcCap = 25;
    const { canvas, live } = await mountPainted();

    press(canvas, ',');
    expect(
      live.textContent,
      'a clamped press must still announce, and distinctly from an unclamped one',
    ).toBe(`Show teleport links, 25 of ${LINK_TOTAL} drawn, limit reached`);
  });

  it('still announces at the top of the ladder, with distinct clamped wording', async () => {
    mapPrefs.teleportArcCap = 'all';
    const { canvas, live } = await mountPainted();

    press(canvas, '.');
    expect(
      live.textContent,
      'a clamped press must still announce, and distinctly from an unclamped one',
    ).toBe('Show teleport links, all drawn, limit reached');
  });

  it('turns the overlay on when pressing , or . while it is off', async () => {
    mapPrefs.showTeleportArcs = false;
    mapPrefs.teleportArcCap = 100;
    const { canvas } = await mountPainted();

    press(canvas, ',');
    expect(mapPrefs.showTeleportArcs).toBe(true);
  });

  it('declines on a map with no links: no toggle, no cap step, no persisted change — but still announces', async () => {
    // Mirrors the toolbar button's own `linkTotal !== 0` guard: a keyboard
    // press on a linkless map must not switch the overlay on or step the cap
    // for every OTHER map (the preference is a persisted singleton), the same
    // property the button's `aria-disabled` protects on click.
    payload = NO_LINKS_MAP;
    mapPrefs.showTeleportArcs = false;
    mapPrefs.teleportArcCap = 100;
    const { canvas, live } = await mountPainted();

    press(canvas, ',');
    expect(mapPrefs.showTeleportArcs, 'a linkless map must not turn the overlay on').toBe(false);
    expect(mapPrefs.teleportArcCap, 'a linkless map must not step the cap').toBe(100);
    expect(
      live.textContent,
      'a keyboard user pressing an inert key still needs feedback',
    ).toBe('Show teleport links, none on this map');
  });
});
