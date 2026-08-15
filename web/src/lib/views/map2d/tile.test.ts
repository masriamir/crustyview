import { describe, it, expect } from 'vitest';
import { blitRects, planTile, tileCovers, type TileBudget, type TileSpec } from './tile';
import { zoomAt, type Transform } from './transform';

/** Identity scale with no offset: screen (x, y) is map (x, -y). */
const IDENTITY: Transform = { scale: 1, tx: 0, ty: 0 };

/** Generous budget: nothing below is meant to hit a cap unless it says so. */
const BUDGET: TileBudget = {
  maxSidePx: 4096,
  maxAreaPx: 16_777_216,
  marginFraction: 0.5,
  padPx: 0,
};

const SMALL_MAP = { min_x: 0, min_y: 0, max_x: 100, max_y: 100 };
/** Wider than any tile the budget below can hold at scale 1. */
const HUGE_MAP = { min_x: 0, min_y: 0, max_x: 100_000, max_y: 100_000 };

describe('planTile', () => {
  it('covers the whole map when it fits the budget', () => {
    const spec = planTile(IDENTITY, 800, 600, 1, SMALL_MAP, BUDGET);
    expect(spec.wholeMap).toBe(true);
    expect(spec.width).toBe(100);
    expect(spec.height).toBe(100);
  });

  it('places the whole-map tile so map bounds land at its corners', () => {
    // The map's min_x/max_y corner is at screen (0, -100) under IDENTITY, so
    // the tile transform must shift by exactly that to put it at tile (0, 0).
    const spec = planTile(IDENTITY, 800, 600, 1, SMALL_MAP, BUDGET);
    expect(spec.transform).toEqual({ scale: 1, tx: 0, ty: 100 });
  });

  it('inflates the whole-map tile by the pad on every side', () => {
    const spec = planTile(IDENTITY, 800, 600, 1, SMALL_MAP, { ...BUDGET, padPx: 10 });
    expect(spec.width).toBe(120);
    expect(spec.height).toBe(120);
    expect(spec.transform).toEqual({ scale: 1, tx: 10, ty: 110 });
  });

  it('falls back to a viewport tile when the whole map is too big', () => {
    const spec = planTile(IDENTITY, 800, 600, 1, HUGE_MAP, BUDGET);
    expect(spec.wholeMap).toBe(false);
    // 0.5 margin on each side: 800 -> 1600, 600 -> 1200.
    expect(spec.width).toBe(1600);
    expect(spec.height).toBe(1200);
    // Tile origin sits half a viewport up and left of the screen origin.
    expect(spec.transform).toEqual({ scale: 1, tx: 400, ty: 300 });
  });

  it('shrinks the margin rather than exceeding the area budget', () => {
    // 800x600 at dpr 2 is 1600x1200 device px. An area cap of 1600*1200*4
    // permits exactly a factor of 2 on each axis, i.e. a margin of 0.5; halve
    // the cap and the largest factor becomes sqrt(2).
    const budget: TileBudget = { ...BUDGET, maxAreaPx: 1600 * 1200 * 2 };
    const spec = planTile(IDENTITY, 800, 600, 2, HUGE_MAP, budget);
    expect(spec.width).toBeCloseTo(800 * Math.SQRT2, 6);
    expect(spec.height).toBeCloseTo(600 * Math.SQRT2, 6);
  });

  it('shrinks the margin rather than exceeding the per-axis budget', () => {
    const budget: TileBudget = { ...BUDGET, maxSidePx: 1000 };
    const spec = planTile(IDENTITY, 800, 600, 1, HUGE_MAP, budget);
    // The width limit binds first: 1000/800 = 1.25 against 1000/600 = 1.667.
    expect(spec.width).toBeCloseTo(1000, 6);
    expect(spec.height).toBeCloseTo(750, 6);
  });

  it('floors the margin at zero instead of going negative', () => {
    // A budget smaller than the viewport itself cannot be honored. Returning
    // exactly the viewport reproduces today's behavior — every pan
    // re-renders — which is a no-op, where a negative margin would produce a
    // tile too small to cover what it is asked to draw.
    const budget: TileBudget = { ...BUDGET, maxSidePx: 100 };
    const spec = planTile(IDENTITY, 800, 600, 1, HUGE_MAP, budget);
    expect(spec.width).toBe(800);
    expect(spec.height).toBe(600);
  });

  it('returns a zero-sized tile for a degenerate viewport', () => {
    // The caller treats this as "no cache" and draws straight to the visible
    // canvas, so it must not be an exception or a 1x1 tile that silently
    // draws nothing.
    const spec = planTile(IDENTITY, 0, 600, 1, HUGE_MAP, BUDGET);
    expect(spec.width).toBe(0);
    expect(spec.height).toBe(0);
  });
});

describe('tileCovers', () => {
  /** A viewport tile for an 800x600 view at a 0.5 margin, unpanned. */
  const VIEWPORT_TILE: TileSpec = {
    transform: { scale: 1, tx: 400, ty: 300 },
    width: 1600,
    height: 1200,
    wholeMap: false,
  };

  it('covers the viewport it was planned for', () => {
    expect(tileCovers(VIEWPORT_TILE, IDENTITY, 800, 600)).toBe(true);
  });

  it('still covers a pan inside the margin', () => {
    // Panning right by 300 px is inside the 400 px margin.
    expect(tileCovers(VIEWPORT_TILE, { scale: 1, tx: 300, ty: 0 }, 800, 600)).toBe(true);
  });

  it.each([
    ['right past the margin', 401, 0],
    ['left past the margin', -401, 0],
    ['down past the margin', 0, 301],
    ['up past the margin', 0, -301],
  ])('stops covering a pan %s', (_where, tx, ty) => {
    // One case per edge: a sign error on a single axis fails exactly one of
    // these rather than being masked by the others.
    expect(tileCovers(VIEWPORT_TILE, { scale: 1, tx, ty }, 800, 600)).toBe(false);
  });

  it('covers any translation when the tile holds the whole map', () => {
    // The whole-map tile is often SMALLER than the viewport — at fit zoom on a
    // map narrower than the window — so a naive containment test would reject
    // it. It is still complete: outside the map bounds there is nothing to
    // draw but the live grid.
    const wholeMap: TileSpec = {
      transform: { scale: 1, tx: 0, ty: 100 },
      width: 100,
      height: 100,
      wholeMap: true,
    };
    expect(tileCovers(wholeMap, { scale: 1, tx: 9999, ty: -9999 }, 800, 600)).toBe(true);
  });

  /**
   * Zoom about the viewport center, exactly as the component's keyboard and
   * wheel handlers do. Derived through `zoomAt` rather than hand-written, so
   * these cases cannot disagree with the transform the app would actually
   * produce.
   */
  const zoomedView = (factor: number): Transform =>
    zoomAt(IDENTITY, 400, 300, factor, 0, Number.POSITIVE_INFINITY);

  it('still covers a zoom-in, which shrinks the view inside the tile', () => {
    expect(tileCovers(VIEWPORT_TILE, zoomedView(2), 800, 600)).toBe(true);
  });

  it('covers a zoom-out exactly to the margin', () => {
    // `blitRects` maps the whole tile onto a destination scaled by the zoom
    // factor, so a tile spanning `1 + 2 * margin` viewports still fills the
    // canvas down to `1 / (1 + 2 * margin)` — 0.5 at the 0.5 margin above.
    expect(tileCovers(VIEWPORT_TILE, zoomedView(0.5), 800, 600)).toBe(true);
  });

  it('stops covering a zoom-out past the margin', () => {
    // One notch further and the scaled destination is narrower than the canvas,
    // which used to blit anyway and leave bare background at the edges (#152).
    expect(tileCovers(VIEWPORT_TILE, zoomedView(0.49), 800, 600)).toBe(false);
  });

  it('covers any scale when the tile holds the whole map', () => {
    // The `wholeMap` short-circuit runs ahead of both range tests, so a
    // whole-map tile is never rejected for a scale change either.
    const wholeMap: TileSpec = {
      transform: { scale: 1, tx: 0, ty: 100 },
      width: 100,
      height: 100,
      wholeMap: true,
    };
    expect(tileCovers(wholeMap, zoomedView(0.01), 800, 600)).toBe(true);
  });
});

describe('blitRects', () => {
  const TILE: TileSpec = {
    transform: { scale: 1, tx: 400, ty: 300 },
    width: 1600,
    height: 1200,
    wholeMap: false,
  };

  it('reads the viewport out of the tile at 1:1 when the scale matches', () => {
    const r = blitRects(TILE, IDENTITY, 800, 600, 2);
    // Screen (0,0) sits at tile (400, 300) in CSS px, so (800, 600) in device.
    expect(r).toEqual({ sx: 800, sy: 600, sw: 1600, sh: 1200, dx: 0, dy: 0, dw: 800, dh: 600 });
  });

  it('rounds the source offset to whole device pixels', () => {
    // Load-bearing. An unrounded source offset makes drawImage resample on
    // every pan, so the map would be permanently soft — strictly worse than
    // having no cache. The cost is up to half a device pixel of position.
    const r = blitRects(TILE, { scale: 1, tx: 0.3, ty: -0.4 }, 800, 600, 2);
    expect(Number.isInteger(r.sx)).toBe(true);
    expect(Number.isInteger(r.sy)).toBe(true);
    expect(r.sx).toBe(Math.round((400 - 0.3) * 2));
    expect(r.sy).toBe(Math.round((300 + 0.4) * 2));
  });

  /**
   * A fractional device pixel ratio with an odd viewport, so `width * dpr` and
   * `height * dpr` are both non-integers: 961 * 1.25 = 1201.25 and
   * 601 * 1.25 = 751.25. This is Windows display scaling and browser zoom on
   * any platform — headless Chromium runs at dpr 1, so no browser-tier test
   * can reach it.
   */
  const FRACTIONAL_DPR = 1.25;
  const ODD_WIDTH = 961;
  const ODD_HEIGHT = 601;

  it('keeps the source and destination device extents equal at a fractional dpr', () => {
    // The invariant, stated as the thing that actually matters: the destination
    // is CSS px into a context scaled by `dpr`, so its device extent is
    // `dw * dpr` unrounded. Round the source to a different number and
    // `drawImage` gets a scale factor a hair off 1, filters the whole image,
    // and the map is permanently soft on every pan.
    const r = blitRects(TILE, IDENTITY, ODD_WIDTH, ODD_HEIGHT, FRACTIONAL_DPR);
    expect(r.sw).toBe(r.dw * FRACTIONAL_DPR);
    expect(r.sh).toBe(r.dh * FRACTIONAL_DPR);
    // And the extents really are fractional here, so the case cannot pass by
    // the rounding being a no-op the way it is at dpr 1 and 2.
    expect(Number.isInteger(r.sw)).toBe(false);
    expect(Number.isInteger(r.sh)).toBe(false);
  });

  it('still rounds the source offset at a fractional dpr', () => {
    // The offset rounding is not collateral damage of the fix above: it is what
    // puts the blit on the device pixel grid, and it stays.
    const r = blitRects(
      TILE,
      { scale: 1, tx: 0.3, ty: -0.4 },
      ODD_WIDTH,
      ODD_HEIGHT,
      FRACTIONAL_DPR,
    );
    expect(Number.isInteger(r.sx)).toBe(true);
    expect(Number.isInteger(r.sy)).toBe(true);
    expect(r.sw).toBe(r.dw * FRACTIONAL_DPR);
    expect(r.sh).toBe(r.dh * FRACTIONAL_DPR);
  });

  it('maps the whole tile onto a scaled destination when the scale differs', () => {
    // A map point must land where the CURRENT transform puts it, so the
    // destination is derived from both transforms rather than from the
    // viewport. Only stroke weights and antialiasing go stale, never position.
    const t: Transform = { scale: 2, tx: 100, ty: 50 };
    const r = blitRects(TILE, t, 800, 600, 2);
    const k = 2;
    expect(r.sx).toBe(0);
    expect(r.sy).toBe(0);
    expect(r.sw).toBe(3200);
    expect(r.sh).toBe(2400);
    expect(r.dx).toBeCloseTo(100 - 400 * k, 6);
    expect(r.dy).toBeCloseTo(50 - 300 * k, 6);
    expect(r.dw).toBeCloseTo(1600 * k, 6);
    expect(r.dh).toBeCloseTo(1200 * k, 6);
  });

  it('puts a map point in the same screen place either way', () => {
    // The invariant behind both branches, stated directly: take a map point,
    // find where the tile drew it, and confirm the blit lands it where the
    // current transform says it belongs.
    const t: Transform = { scale: 2, tx: 100, ty: 50 };
    const r = blitRects(TILE, t, 800, 600, 2);
    const mapX = 37;
    const inTile = TILE.transform.tx + mapX * TILE.transform.scale;
    const onScreen = r.dx + (inTile / TILE.width) * r.dw;
    expect(onScreen).toBeCloseTo(t.tx + mapX * t.scale, 6);
  });
});
