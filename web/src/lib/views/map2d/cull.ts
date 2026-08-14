import { screenToMap, type Transform } from './transform';

/** An axis-aligned rectangle in map space, normalized so min <= max. */
export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * The map-space rectangle currently visible in a `width`×`height` viewport,
 * inflated by `padPx` screen pixels.
 *
 * The padding matters because elements are drawn larger than the coordinates
 * they are drawn from — stroke widths, marker glyphs, and the teleport arc's
 * perpendicular bow — so geometry just outside the viewport can still put ink
 * inside it. Padding is given in pixels and divided by `scale`, which is
 * always positive: `fitTransform` falls back to 1 on degenerate bounds and
 * `zoomAt` clamps to a positive range.
 *
 * Normalized because screen Y grows downward while map Y grows north, so
 * inverting the corners yields the smallest map Y from the *bottom* corner.
 */
export function viewportRect(t: Transform, width: number, height: number, padPx: number): Rect {
  const a = screenToMap(t, 0, 0);
  const b = screenToMap(t, width, height);
  const pad = padPx / t.scale;
  return {
    minX: Math.min(a.x, b.x) - pad,
    maxX: Math.max(a.x, b.x) + pad,
    minY: Math.min(a.y, b.y) - pad,
    maxY: Math.max(a.y, b.y) + pad,
  };
}

/** Cohen–Sutherland region code: one bit per edge the point lies outside. */
function outcode(r: Rect, x: number, y: number): number {
  return (
    (x < r.minX ? 1 : 0) | (x > r.maxX ? 2 : 0) | (y < r.minY ? 4 : 0) | (y > r.maxY ? 8 : 0)
  );
}

/**
 * Whether a segment might touch the rect — the Cohen–Sutherland trivial
 * reject.
 *
 * Rejects only when both endpoints lie outside the SAME edge. A long line
 * whose endpoints are both off screen but which crosses the viewport has
 * endpoints on opposite sides, so the bitwise AND is zero and it survives.
 * Testing "is either endpoint inside" instead would drop it, which on a map
 * of 60,000 lines looks like nothing at all.
 *
 * Conservative in the safe direction: it can keep something invisible, never
 * drop something visible. A segment diagonally outside can share no single
 * edge and be kept without ever touching the rect; `cull.test.ts` pins that
 * as intended rather than leaving it to be "fixed" into exact intersection.
 */
export function segmentVisible(r: Rect, x1: number, y1: number, x2: number, y2: number): boolean {
  return (outcode(r, x1, y1) & outcode(r, x2, y2)) === 0;
}

/** Whether a point lies within the rect, boundary included. */
export function pointVisible(r: Rect, x: number, y: number): boolean {
  return x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY;
}
