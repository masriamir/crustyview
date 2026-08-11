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
 * before the first draw, `null` when even the largest ladder member is too
 * dense at this zoom (#76).
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
