/**
 * Grid spacings in map units — Doom Builder's power-of-two ladder (#47).
 * The default matches DB's, as do the [ / ] adjustment keys bound in Map2d.
 */
export const GRID_SIZES = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512] as const;
export type GridSize = (typeof GRID_SIZES)[number];
export const DEFAULT_GRID_SIZE: GridSize = 32;

/** The next size up or down the ladder, clamped at both ends. */
export function stepGridSize(current: GridSize, direction: -1 | 1): GridSize {
  const at = GRID_SIZES.indexOf(current);
  const next = Math.min(Math.max(at + direction, 0), GRID_SIZES.length - 1);
  return GRID_SIZES[next];
}

/** Set-membership validator for stored pref values. */
export function isGridSize(value: unknown): value is GridSize {
  return (GRID_SIZES as readonly unknown[]).includes(value);
}

/** Minimum on-screen spacing, in CSS px, below which a grid is too dense to draw. */
export const MIN_GRID_PX = 8;

/**
 * The finest ladder member at or above `base` whose on-screen spacing clears
 * [`MIN_GRID_PX`], or `null` when even the largest cannot.
 *
 * Powers of two nest, so every line drawn at the returned size is also a line of
 * the `base` lattice — zooming in progressively reveals the finer ones. The
 * caller's stored grid preference is never changed by this (#76).
 */
export function effectiveGridSize(base: GridSize, scale: number): GridSize | null {
  for (const size of GRID_SIZES) {
    if (size < base) continue;
    // Positive test, so a NaN, zero, or negative scale satisfies nothing and
    // falls through to null — the same shape as the guard this replaces.
    if (size * scale >= MIN_GRID_PX) return size;
  }
  return null;
}

/**
 * The toolbar's three-state grid label: plain size, `→` coarsened, or a
 * below-the-floor hint. `drawn` is what `Map2d` actually drew — `undefined`
 * when nothing is known (no draw has resolved a transform yet, or the last one
 * bailed out), `null` when even the largest ladder member is too dense at this
 * zoom (#76).
 *
 * The two absent-ish states are distinct on purpose: `undefined` renders the
 * plain size, so a map open or a failed assembly cannot flash the
 * below-the-floor hint at a user who never zoomed anywhere.
 */
export function gridLabel(base: GridSize, drawn: GridSize | null | undefined): string {
  // `null` must be tested BEFORE any relational comparison: `null <= 32`
  // coerces to true in JS and would silently take the wrong branch.
  if (drawn === null) return `${base} · zoom in`;
  // `<=` rather than `===`: `gridSize` updates synchronously on a keypress while
  // `drawnGridSize` only catches up on the next rAF draw, so a press can be
  // observed with a stale finer `drawn`. Coarsening never goes finer than the
  // base, so anything at or below it means "drawn as chosen" (#76).
  if (drawn === undefined || drawn <= base) return `${base}`;
  return `${base}→${drawn}`;
}

/**
 * The spoken clause describing what is actually drawn, appended after a grid
 * size: `''` when the chosen size is what gets drawn, `, drawn as 128` when
 * coarsened, `, too small to draw at this zoom` when nothing can be (#127).
 *
 * Shared by the toolbar button's accessible name and the map's live-region
 * announcements, so the two cannot drift apart.
 *
 * `undefined` — nothing known yet — yields `''`: with no resolved draw there is
 * nothing truthful to say about drawing.
 */
export function gridDrawnSuffix(base: GridSize, drawn: GridSize | null | undefined): string {
  // `null` before any relational comparison, exactly as in `gridLabel`:
  // `null <= 32` coerces to true and would take the wrong branch.
  if (drawn === null) return ', too small to draw at this zoom';
  if (drawn === undefined || drawn <= base) return '';
  return `, drawn as ${drawn}`;
}
