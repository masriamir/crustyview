import type { Map2d } from '../../format';
import { viewportRect } from './cull';
import { mapToScreen, type Transform } from './transform';

/**
 * The cached bitmap's geometry (#152).
 *
 * `width` and `height` are **CSS** pixels: the tile's 2D context is scaled by
 * the device pixel ratio exactly as the visible canvas is, so every draw pass
 * works in the same units on either surface.
 */
export interface TileSpec {
  /** The transform the tile's content was drawn with. */
  transform: Transform;
  width: number;
  height: number;
  /**
   * Whether the tile holds the entire map. A whole-map tile is valid at any
   * translation; a viewport tile is valid only while it contains the viewport.
   */
  wholeMap: boolean;
}

export interface TileBudget {
  /** Device-pixel cap per axis. */
  maxSidePx: number;
  /** Device-pixel cap on the total. */
  maxAreaPx: number;
  /** How far a viewport tile extends past the viewport on each side. */
  marginFraction: number;
  /** CSS-pixel inflation of the map's bounds, covering ink drawn outside them. */
  padPx: number;
}

/** Source rect in tile **device** px; destination rect in visible-canvas **CSS** px. */
export interface BlitRects {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/** Device pixels per axis. Below the universal canvas limit and below the
 *  per-canvas ceiling on older mobile hardware. */
export const MAX_TILE_SIDE_PX = 4096;
/** Device pixels total — 64 MB at RGBA. Bounds the worst case when only one
 *  axis is near its cap. */
export const MAX_TILE_AREA_PX = 16_777_216;
/** Starting margin for a viewport tile; shrunk when the budget binds. */
export const TILE_MARGIN_FRACTION = 0.5;

function fits(width: number, height: number, dpr: number, budget: TileBudget): boolean {
  const w = width * dpr;
  const h = height * dpr;
  return w <= budget.maxSidePx && h <= budget.maxSidePx && w * h <= budget.maxAreaPx;
}

/** A tile whose top-left corner sits at screen `(left, top)` under `t`. */
function specAt(
  t: Transform,
  left: number,
  top: number,
  width: number,
  height: number,
  wholeMap: boolean,
): TileSpec {
  return {
    transform: { scale: t.scale, tx: t.tx - left, ty: t.ty - top },
    width,
    height,
    wholeMap,
  };
}

/**
 * Choose the tile to render for the current view.
 *
 * Prefers a tile covering the **whole map**, which never needs re-rendering as
 * the view pans. That is affordable exactly where it matters: at fit zoom the
 * map at fit scale is about viewport-sized, which is also where a redraw is
 * most expensive. As zoom climbs the whole-map tile outgrows the budget, but by
 * then viewport culling (#153) has already made redraws cheap, so the two
 * techniques hand off to each other.
 *
 * "The whole map" is whatever `bounds` the caller passes, and the component
 * passes more than `map.bounds`: it supplies `bounds ∪ viewportRect`, so a view
 * panned outside the map still gets a tile covering what is on screen. It also
 * clears the returned `wholeMap` itself when `map.bounds` is degenerate, since
 * a zero-area bounds cannot promise to contain the geometry
 * (`Map2d.svelte`, `renderTile`).
 */
export function planTile(
  t: Transform,
  width: number,
  height: number,
  dpr: number,
  bounds: Map2d['bounds'],
  budget: TileBudget,
): TileSpec {
  if (!(width > 0) || !(height > 0) || !(dpr > 0)) {
    // No viewport to plan against. The caller reads a zero-sized tile as "no
    // cache" and draws straight to the visible canvas.
    return { transform: { ...t }, width: 0, height: 0, wholeMap: false };
  }

  // Screen Y grows downward while map Y grows north, so the corners have to be
  // normalized rather than assumed in order.
  const a = mapToScreen(t, bounds.min_x, bounds.min_y);
  const b = mapToScreen(t, bounds.max_x, bounds.max_y);
  const left = Math.min(a.x, b.x) - budget.padPx;
  const top = Math.min(a.y, b.y) - budget.padPx;
  const wholeWidth = Math.abs(b.x - a.x) + 2 * budget.padPx;
  const wholeHeight = Math.abs(b.y - a.y) + 2 * budget.padPx;
  if (wholeWidth > 0 && wholeHeight > 0 && fits(wholeWidth, wholeHeight, dpr, budget)) {
    return specAt(t, left, top, wholeWidth, wholeHeight, true);
  }

  // Largest factor `1 + 2m` the budget allows, solved directly rather than
  // stepped down in a loop: one bound per axis, one from the area cap.
  const maxFactor = Math.min(
    budget.maxSidePx / dpr / width,
    budget.maxSidePx / dpr / height,
    Math.sqrt(budget.maxAreaPx / (width * height * dpr * dpr)),
  );
  const margin = Math.max(0, Math.min(budget.marginFraction, (maxFactor - 1) / 2));
  return specAt(
    t,
    -margin * width,
    -margin * height,
    width * (1 + 2 * margin),
    height * (1 + 2 * margin),
    false,
  );
}

/**
 * Whether `spec` holds everything the view will show — at any scale.
 *
 * Three paths, and the first two are kept apart deliberately.
 *
 * A **whole-map** tile short-circuits: there is nothing outside it to be
 * missing, and it is often smaller than the viewport, which a containment test
 * would reject.
 *
 * At **equal scale** the question is answered in screen pixels against the
 * tile's own offset. That formulation is kept exactly as written rather than
 * rerouted through the map-space arithmetic below, because its four edge cases
 * sit precisely on the margin boundary and would be exposed to floating-point
 * drift by the extra divisions.
 *
 * At **unequal scale** the same question is answered in map space: everything
 * the viewport shows under `t` must lie inside the map rect the tile actually
 * holds. This path is not a nicety — `blitRects` maps the *whole* tile onto a
 * destination scaled by `t.scale / spec.transform.scale`, so a zoom-out shrinks
 * that destination, and once the zoom passes the tile's margin the destination
 * is narrower than the canvas and leaves unpainted bands at the edges (#152).
 */
export function tileCovers(spec: TileSpec, t: Transform, width: number, height: number): boolean {
  if (spec.wholeMap) return true;
  if (t.scale === spec.transform.scale) {
    // Screen coordinates are tile coordinates plus this offset.
    const dx = t.tx - spec.transform.tx;
    const dy = t.ty - spec.transform.ty;
    return -dx >= 0 && -dy >= 0 && width - dx <= spec.width && height - dy <= spec.height;
  }
  // The tile is its own viewport under its own transform, so one function
  // describes both rects — including the corner normalization screen-down /
  // map-north makes necessary.
  const view = viewportRect(t, width, height, 0);
  const held = viewportRect(spec.transform, spec.width, spec.height, 0);
  return (
    view.minX >= held.minX &&
    view.maxX <= held.maxX &&
    view.minY >= held.minY &&
    view.maxY <= held.maxY
  );
}

/**
 * The `drawImage` arguments that put the tile's content where `t` says it
 * belongs.
 *
 * Two branches. At equal scale the source **offset** is rounded to whole device
 * pixels while the source **extent** is not, and both halves of that are
 * load-bearing. Rounding the offset is what makes the blit land on a device
 * pixel grid; leaving the extent unrounded is what keeps it 1:1. The
 * destination is given in CSS px into a context already scaled by `dpr`, so its
 * device extent is `width * dpr` exactly — rounding the source to match a
 * *different* number would ask `drawImage` for a scale factor a hair off 1 and
 * resample the whole image. At dpr 1 or 2 the rounding is invisible because
 * `width * dpr` is already an integer; at 1.25, 1.5 or 1.75 — Windows display
 * scaling, and browser zoom on any platform — an odd `clientWidth` makes it
 * 1201 device px onto a 1201.25 px destination, and the map goes permanently
 * soft on every pan. So the invariant to hold is `sw === dw * dpr` and
 * `sh === dh * dpr`, exactly, with `sx`/`sy` still integers.
 *
 * At unequal scale the whole tile is mapped onto a scaled destination, so
 * geometry still lands in the right place at the right size and only stroke
 * weights and antialiasing go stale. Resampling is the point there, so that
 * branch reads the whole backing store and rounds to it.
 *
 * A source rect reaching past the tile is fine and expected for a whole-map
 * tile panned toward its edge: the canvas specification clips source and
 * destination together, so the visible part composites correctly and the rest
 * is simply absent.
 */
export function blitRects(
  spec: TileSpec,
  t: Transform,
  width: number,
  height: number,
  dpr: number,
): BlitRects {
  if (t.scale === spec.transform.scale) {
    return {
      sx: Math.round((spec.transform.tx - t.tx) * dpr),
      sy: Math.round((spec.transform.ty - t.ty) * dpr),
      sw: width * dpr,
      sh: height * dpr,
      dx: 0,
      dy: 0,
      dw: width,
      dh: height,
    };
  }
  const k = t.scale / spec.transform.scale;
  return {
    sx: 0,
    sy: 0,
    sw: Math.round(spec.width * dpr),
    sh: Math.round(spec.height * dpr),
    dx: t.tx - spec.transform.tx * k,
    dy: t.ty - spec.transform.ty * k,
    dw: spec.width * k,
    dh: spec.height * k,
  };
}
