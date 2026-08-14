import type { MapStyle } from '../../stores/mapPrefs.svelte';
import type { GridSize } from './grid';
import { CATEGORIES, type ThingCategory } from './things';

/**
 * Everything baked into the cached tile (#152).
 *
 * Deliberately absent: **scale**, so that "same content, different zoom" is
 * expressible and a wheel notch can blit the existing tile scaled rather than
 * rebuild it; **translation**, which is the entire point of the cache; the
 * **map identity**, compared by reference instead; and the **device pixel
 * ratio**, which `window.devicePixelRatio` reports non-reactively, so a
 * `$derived` key could never observe a change to it. The tile records the
 * ratio it was rendered at and that value is compared at draw time.
 */
export interface TileKeyInput {
  style: MapStyle;
  theme: string;
  game: string | null;
  showThings: boolean;
  alwaysShowPlayerStart: boolean;
  categories: Record<ThingCategory, boolean>;
  showTeleportLines: boolean;
  showSecretSectors: boolean;
  showDamagingSectors: boolean;
}

/** The tile's inputs plus the two the visible canvas draws live. */
export interface RenderKeyInput extends TileKeyInput {
  showGrid: boolean;
  gridSize: GridSize;
}

/**
 * The tile's identity. A change here means the bitmap is stale and must be
 * re-rendered.
 *
 * JSON rather than a delimiter join: `style`, `theme` and `game` are strings
 * whose contents are not ours to constrain — `game` comes out of the WAD — and
 * an unescaped join lets two different inputs produce one key, which shows a
 * stale map.
 */
export function tileKey(input: TileKeyInput): string {
  return JSON.stringify([
    input.style,
    input.theme,
    input.game,
    input.showThings,
    input.alwaysShowPlayerStart,
    // Fixed order from the shared category list, so a key never depends on
    // property insertion order.
    CATEGORIES.map((c) => input.categories[c.id]),
    input.showTeleportLines,
    input.showSecretSectors,
    input.showDamagingSectors,
  ]);
}

/**
 * Everything a draw depends on except the transform and the canvas size — the
 * single dependency the redraw `$effect` tracks in place of naming fifteen
 * fields by hand.
 *
 * This is the load-bearing property: a preference missing from `tileKey` is
 * also missing here, so it fails to invalidate the cache *and* fails to
 * schedule a redraw. The symptom is a picture that does not change at all,
 * rather than one that changes everywhere except the cached layer.
 */
export function renderKey(input: RenderKeyInput): string {
  return JSON.stringify([tileKey(input), input.showGrid, input.gridSize]);
}
