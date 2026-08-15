import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Map2d as Map2dPayload } from '../../format';
import { installMapSizing, painted } from './browser-test-helpers';
import { fitTransform, screenToMap } from './transform';

/** Shared bounds for every fixture below: small enough, relative to the fit
 *  viewport, that geometry placed well outside them lands off screen at fit
 *  zoom without touching the zoom keys (`fitTransform` fits `bounds`, not the
 *  geometry itself). */
const BOUNDS = { min_x: 0, min_y: 0, max_x: 1000, max_y: 1000 };

/**
 * #153: a line whose endpoints are both far outside the viewport but which
 * crosses it must still draw.
 *
 * Comparing two renders — one payload with the crossing line, one without —
 * isolates the cull outcome instead of relying on `showGrid`'s default
 * staying `false`: at this fixture's fit scale a 32-unit grid would draw at
 * 17.6 px, well above `MIN_GRID_PX`, so a single-render `painted()` check
 * would still pass with the line entirely culled if that default ever
 * flipped, because the grid alone would paint the canvas non-uniform.
 */
const CROSSING: Map2dPayload = {
  name: 'MAP01',
  bounds: BOUNDS,
  lines: [{ x1: -50000, y1: 500, x2: 60000, y2: 500, kind: 'one_sided' }],
  things: [],
  secret_sectors: 0,
  damaging_sectors: 0,
};
const WITHOUT_CROSSING: Map2dPayload = { ...CROSSING, lines: [] };

/** A line comfortably inside the viewport, so every pad fixture below paints
 *  something even before its near-edge element is added — the two-render
 *  comparison then isolates that element specifically, the same technique
 *  the crossing-line test above uses. */
const CENTER_LINE = { x1: 400, y1: 400, x2: 600, y2: 600, kind: 'two_sided' as const };
const PAD_BASE: Map2dPayload = {
  name: 'MAP01',
  bounds: BOUNDS,
  lines: [CENTER_LINE],
  things: [],
  secret_sectors: 0,
  damaging_sectors: 0,
};

let payload: Map2dPayload = CROSSING;

/**
 * Forces `draw()` down its direct fallback, exactly as
 * `tile-cache.browser.test.ts` does: `planTile` returning a zero-sized tile is
 * read by the component as "no cache".
 *
 * The pad fixtures below need it. The tile spans `bounds ∪ viewportRect`
 * inflated by `TILE_PAD_PX` (52), so an element 0.5–3 px outside the viewport
 * is deep inside the tile and draws no matter what the per-pass pads are —
 * these four cases would pass at pad 0, which is the opposite of what they were
 * written to prove. Rendering straight to the visible canvas puts the per-pass
 * cull rects back in charge (#152).
 */
const control = vi.hoisted(() => ({ disableCache: false }));

vi.mock('./tile', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./tile')>();
  return {
    ...mod,
    planTile: (...args: Parameters<typeof mod.planTile>) => {
      if (control.disableCache) {
        return { transform: { ...args[0] }, width: 0, height: 0, wholeMap: false };
      }
      return mod.planTile(...args);
    },
  };
});

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

interface Snap {
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * Renders once, waits for the ResizeObserver -> fit -> rAF draw chain to
 * settle, and returns the canvas's data URL alongside its measured CSS-pixel
 * box. The pad fixtures below place elements by an exact screen offset from
 * the canvas edge, so they read the real box here rather than assuming the
 * border/box-sizing arithmetic `installMapSizing`'s 800x600 (border-box, with
 * `.map2d`'s own 1px border) produces.
 *
 * `expectPainted` is `false` for a baseline that may legitimately stay blank
 * (`WITHOUT_CROSSING` has no lines and the grid defaults off) — asserting
 * `painted()` there would defeat the point of comparing two renders instead
 * of trusting a single one.
 */
async function snapshot(expectPainted: boolean): Promise<Snap> {
  const screen = await render(Map2d, { name: 'MAP01' });
  const canvas = screen.container.querySelector('canvas');
  // Assert before casting: without this a missing canvas throws an opaque
  // null dereference inside `painted()` instead of naming what went wrong.
  expect(canvas, 'Map2d should render a canvas').not.toBeNull();
  const el = canvas as HTMLCanvasElement;
  const didPaint = await painted(el);
  if (expectPainted) {
    expect(didPaint, 'expected the canvas to paint something').toBe(true);
  }
  const rect = el.getBoundingClientRect();
  return { dataUrl: el.toDataURL(), width: rect.width, height: rect.height };
}

// `mapPrefs` is a module singleton, so a test that flips a preference and
// walks away leaves it flipped for whatever runs next in this file.
const showThingsDefault = mapPrefs.showThings;
const showTeleportLinesDefault = mapPrefs.showTeleportLines;
const coopShownDefault = mapPrefs.showCategories.coop;
afterEach(() => {
  // `payload` is module-level and every test currently assigns it before
  // rendering, so nothing reads a stale one today. Reset it anyway, as
  // `start-markers.browser.test.ts` does: a test added later that forgets to
  // assign would otherwise inherit whichever fixture happened to run before
  // it, and pass or fail for a reason that has nothing to do with itself.
  payload = CROSSING;
  control.disableCache = false;
  mapPrefs.showThings = showThingsDefault;
  mapPrefs.showTeleportLines = showTeleportLinesDefault;
  mapPrefs.showCategories.coop = coopShownDefault;
});

describe('viewport culling', () => {
  it('keeps a line that crosses the viewport with both ends far outside', async () => {
    payload = WITHOUT_CROSSING;
    const without = await snapshot(false);
    payload = CROSSING;
    const withIt = await snapshot(true);
    expect(withIt.dataUrl, 'the crossing line must survive culling').not.toBe(without.dataUrl);
  });

  /**
   * Each pad below is pinned by placing an element just outside the *raw*
   * (unpadded) viewport but within the pad's reach, at an exact screen offset
   * computed via `fitTransform`/`screenToMap` rather than guessed. Coverage
   * gap this closes: the existing teeth-checks (`cull.test.ts`) only prove a
   * destroyed rect (`-100000`) culls everything, and every fixture elsewhere
   * in this suite places its geometry dead center, so a merely-too-small pad
   * (negated or just reduced) is currently invisible to the whole browser
   * suite.
   *
   * Each fixture avoids `pointVisible`/`segmentVisible`'s inclusive boundary
   * on purpose (per its own comment below), and each was verified by hand to
   * go red when its pad is *reduced* — not merely negated, which any of them
   * would survive. The reductions used: `LINE_CULL_PAD_PX` 2 to 0.3,
   * `THING_CULL_PAD_PX` 3 to 0.7, `ARROW_CULL_PAD_PX` 7 to 2 and
   * `LINK_CULL_PAD_PX` 52 to 15.
   *
   * All four run with the tile cache disabled, which is what keeps that true:
   * the tile is inflated by `TILE_PAD_PX` (52) and would swallow every offset
   * used here. See `control` above.
   *
   * Each test can only discriminate down to its element's true ink reach,
   * which is roughly half of each pad — the pads are deliberately
   * conservative, so no drawn pixel reaches the rest of the budget and
   * nothing can distinguish, say, a 52 from a 40. That ceiling is geometry,
   * not a gap in the tests.
   */
  it('keeps a line whose coordinate sits just outside the raw viewport, within LINE_CULL_PAD_PX', async () => {
    control.disableCache = true;
    payload = PAD_BASE;
    const without = await snapshot(true);
    const t = fitTransform(BOUNDS, without.width, without.height);
    // LINE_CULL_PAD_PX is 2 (the widest of KIND_WIDTH and OVERLAY_WIDTH, both
    // 2). A `one_sided` stroke is 2 px wide, so its own reach past the
    // coordinate is 1 px; 0.5 sits inside that reach without landing on the
    // boundary the cull rect's inclusive comparison would also accept.
    const edgeX = without.width + 0.5;
    const p1 = screenToMap(t, edgeX, without.height / 2 - 100);
    const p2 = screenToMap(t, edgeX, without.height / 2 + 100);
    payload = {
      ...PAD_BASE,
      lines: [...PAD_BASE.lines, { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, kind: 'one_sided' }],
    };
    const withIt = await snapshot(true);
    expect(
      withIt.dataUrl,
      'a line just outside the raw viewport must still draw',
    ).not.toBe(without.dataUrl);
  });

  it('keeps a thing whose coordinate sits just outside the raw viewport, within THING_CULL_PAD_PX', async () => {
    control.disableCache = true;
    mapPrefs.showThings = true;
    payload = PAD_BASE;
    const without = await snapshot(true);
    const t = fitTransform(BOUNDS, without.width, without.height);
    // THING_CULL_PAD_PX is 3 (== THING_PX). The marker is a THING_PX square
    // centered on its coordinate, so its own reach past the coordinate is
    // THING_PX / 2 = 1.5; 1.0 sits inside that reach without landing on the
    // boundary.
    const p = screenToMap(t, without.width + 1.0, without.height / 2);
    // type_id 2001 is a shotgun: `weapons`, drawn as the plain 3 px dot
    // (not an arrow category), so this exercises `drawThings` specifically.
    payload = { ...PAD_BASE, things: [{ x: p.x, y: p.y, angle: 0, type_id: 2001 }] };
    const withIt = await snapshot(true);
    expect(
      withIt.dataUrl,
      'a thing just outside the raw viewport must still draw',
    ).not.toBe(without.dataUrl);
  });

  it('keeps a start marker whose coordinate sits just outside the raw viewport, within ARROW_CULL_PAD_PX', async () => {
    control.disableCache = true;
    mapPrefs.showThings = true;
    mapPrefs.showCategories.coop = true;
    payload = PAD_BASE;
    const without = await snapshot(true);
    const t = fitTransform(BOUNDS, without.width, without.height);
    // ARROW_CULL_PAD_PX is 7 (== COOP_ARROW_PX/DEATHMATCH_ARROW_PX, the
    // largest ARROW_SIZES member). drawStartArrow's barb vertices sit at
    // local x = -size/2 exactly, so at angle 0 the glyph's own reach in the
    // direction that matters here is size/2 = 3.5 (its true maximum radial
    // reach, size*0.64 = 4.482, needs a specific rotation this fixture
    // doesn't bother with). 3.0 sits inside the reach this angle achieves,
    // without landing on the boundary.
    const p = screenToMap(t, without.width + 3.0, without.height / 2);
    // type_id 2 is a co-op start.
    payload = { ...PAD_BASE, things: [{ x: p.x, y: p.y, angle: 0, type_id: 2 }] };
    const withIt = await snapshot(true);
    expect(
      withIt.dataUrl,
      'a start marker just outside the raw viewport must still draw',
    ).not.toBe(without.dataUrl);
  });

  it('keeps a teleport link whose chord sits just outside the raw viewport, its bow reaching onto the canvas', async () => {
    control.disableCache = true;
    mapPrefs.showTeleportLines = true;
    payload = PAD_BASE;
    const without = await snapshot(true);
    const t = fitTransform(BOUNDS, without.width, without.height);
    const w = without.width;
    const h = without.height;
    // LINK_CULL_PAD_PX (unchanged by this pass, 52 = LINK_BOW_MAX 42 +
    // LINK_ARROW_SIZE 7 + LINK_RING_RADIUS 3) is deliberately conservative: a
    // quadratic Bezier's peak deviates from its OWN CHORD by only half the
    // bow (21 px at bow = 42), not the full 42. A 500 px-tall vertical chord
    // saturates the bow at LINK_BOW_MAX (`len * LINK_BOW_RATIO` = 90 > 42),
    // and ordering `to` below `from` bows the arc toward smaller X — toward
    // the canvas, since the chord sits to its right. Offsetting the chord by
    // 18 puts the arc's peak 3 px inside the canvas (21 - 18), which is
    // inside the true 21 px reach without landing on the boundary; the ring
    // (3 px) and arrowhead (7 px), both anchored at the chord's own
    // endpoints, stay off canvas at this offset, so only the bow contributes
    // ink here.
    const edgeX = w + 18;
    const from = screenToMap(t, edgeX, h / 2 - 250);
    const to = screenToMap(t, edgeX, h / 2 + 250);
    payload = { ...PAD_BASE, links: [{ from: [from.x, from.y], to: [to.x, to.y] }] };
    const withIt = await snapshot(true);
    expect(
      withIt.dataUrl,
      "a link's bow reaching onto the canvas must still draw",
    ).not.toBe(without.dataUrl);
  });
});
