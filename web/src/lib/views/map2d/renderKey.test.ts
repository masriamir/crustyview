import { describe, it, expect } from 'vitest';
import { renderKey, tileKey, type RenderKeyInput } from './renderKey';
import { CATEGORIES, type ThingCategory } from './things';

const allShown = (): Record<ThingCategory, boolean> =>
  Object.fromEntries(CATEGORIES.map((c) => [c.id, true])) as Record<ThingCategory, boolean>;

const BASE: RenderKeyInput = {
  style: 'theme',
  theme: 'dark',
  game: 'doom2',
  showThings: true,
  alwaysShowPlayerStart: true,
  categories: allShown(),
  showTeleportLines: true,
  showSecretSectors: false,
  showDamagingSectors: false,
  showTeleportArcs: true,
  teleportArcCap: 100,
  showGrid: false,
  gridSize: 32,
  glFeather: true,
};

describe('tileKey', () => {
  it('is stable for equal input', () => {
    // A key that varied run to run would rebuild the tile every frame, which
    // is worse than having no cache at all.
    expect(tileKey({ ...BASE })).toBe(tileKey({ ...BASE }));
  });

  it.each<[string, Partial<RenderKeyInput>]>([
    ['style', { style: 'classic' }],
    ['theme', { theme: 'light' }],
    ['game', { game: 'doom' }],
    ['game becoming null', { game: null }],
    ['showThings', { showThings: false }],
    ['alwaysShowPlayerStart', { alwaysShowPlayerStart: false }],
    ['showTeleportLines', { showTeleportLines: false }],
    ['showTeleportArcs', { showTeleportArcs: false }],
    ['teleportArcCap', { teleportArcCap: 25 as const }],
    ['showSecretSectors', { showSecretSectors: true }],
    ['showDamagingSectors', { showDamagingSectors: true }],
  ])('changes when %s changes', (_name, patch) => {
    // One case per baked input. A field omitted from the key would leave the
    // tile stale after that preference changes — the failure this whole
    // module exists to make impossible.
    expect(tileKey({ ...BASE, ...patch })).not.toBe(tileKey(BASE));
  });

  it.each(CATEGORIES.map((c) => c.id))('changes when the %s category is hidden', (id) => {
    const categories = { ...allShown(), [id]: false };
    expect(tileKey({ ...BASE, categories })).not.toBe(tileKey(BASE));
  });

  it('does not change when a grid preference changes', () => {
    // The grid is drawn live on the visible canvas, never baked into the
    // tile, so a grid change must not throw the bitmap away.
    //
    // Bound to typed locals rather than written inline: `tileKey` takes the
    // narrower `TileKeyInput`, and TypeScript's excess-property check applies
    // to properties SPELLED OUT in a fresh object literal — so
    // `tileKey({ ...BASE, showGrid: true })` is a compile error even though
    // passing a `RenderKeyInput` variable is fine. `npm run check` catches
    // this; `npm test` does not, because Vitest never type-checks.
    const gridShown: RenderKeyInput = { ...BASE, showGrid: true };
    const gridCoarser: RenderKeyInput = { ...BASE, gridSize: 128 };
    expect(tileKey(gridShown)).toBe(tileKey(BASE));
    expect(tileKey(gridCoarser)).toBe(tileKey(BASE));
  });
});

describe('renderKey', () => {
  it('changes when a grid preference changes', () => {
    // The mirror of the test above: grid changes must still schedule a
    // redraw even though they do not invalidate the tile.
    expect(renderKey({ ...BASE, showGrid: true })).not.toBe(renderKey(BASE));
    expect(renderKey({ ...BASE, gridSize: 128 })).not.toBe(renderKey(BASE));
  });

  it('changes when a baked preference changes', () => {
    expect(renderKey({ ...BASE, showSecretSectors: true })).not.toBe(renderKey(BASE));
  });

  it('changes when glFeather changes', () => {
    // Feather is a live GL uniform, not baked into any tile, so it belongs
    // in renderKey (schedules a redraw) but must NOT reach tileKey.
    expect(renderKey({ ...BASE, glFeather: false })).not.toBe(renderKey(BASE));
  });

  it('does not add glFeather to tileKey', () => {
    // tileKey accepts a wider object at runtime due to TypeScript structural
    // typing, so this assertion is a real runtime guard that extra RenderKey-only
    // fields — glFeather here — never leak into tileKey's output. TypeScript's
    // narrower TileKeyInput type enforces the compile-time half of the guarantee.
    const featherOn: RenderKeyInput = { ...BASE, glFeather: true };
    const featherOff: RenderKeyInput = { ...BASE, glFeather: false };
    expect(tileKey(featherOn)).toBe(tileKey(featherOff));
  });

  it('separates its fields so adjacent values cannot collide', () => {
    // Concatenating without a delimiter lets ("ab", "c") and ("a", "bc")
    // produce the same key. JSON encoding is what prevents that; this test
    // fails if someone "simplifies" it into a plain join.
    const a = renderKey({ ...BASE, theme: 'a', game: 'bc' });
    const b = renderKey({ ...BASE, theme: 'ab', game: 'c' });
    expect(a).not.toBe(b);
  });
});
