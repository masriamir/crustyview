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
