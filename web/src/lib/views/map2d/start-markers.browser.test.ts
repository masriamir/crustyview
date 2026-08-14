import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Map2d as Map2dPayload } from '../../format';
import { installMapSizing, painted } from './browser-test-helpers';

/**
 * #72: start markers are drawn straight to the canvas, so no DOM query can see
 * them. Comparing two renders of the same map — one whose payload carries a
 * start, one whose does not — isolates a single draw call and nothing else.
 */
const BASE: Map2dPayload = {
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
};

const withPlayer1: Map2dPayload = {
  ...BASE,
  things: [{ x: 256, y: 256, angle: 90, type_id: 1 }],
};

const AT = { x: 256, y: 256, angle: 0 };
const withCoop: Map2dPayload = { ...BASE, things: [{ ...AT, type_id: 2 }] };
const withDeathmatch: Map2dPayload = { ...BASE, things: [{ ...AT, type_id: 11 }] };
/** Type 2001 is a shotgun: `weapons`, and so still drawn as a 3 px rect. */
const withWeapon: Map2dPayload = { ...BASE, things: [{ ...AT, type_id: 2001 }] };

let payload: Map2dPayload = BASE;

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

/** The canvas's pixels, once it has painted. */
async function snapshot(): Promise<string> {
  const screen = await render(Map2d, { name: 'MAP01' });
  const canvas = screen.container.querySelector('canvas');
  // Assert before casting: without this a missing canvas throws an opaque null
  // dereference inside `painted()` instead of naming what went wrong.
  expect(canvas, 'Map2d should render a canvas').not.toBeNull();
  expect(await painted(canvas as HTMLCanvasElement)).toBe(true);
  return (canvas as HTMLCanvasElement).toDataURL();
}

/** Raw pixels of the painted canvas. */
async function pixels(): Promise<Uint8ClampedArray> {
  const screen = await render(Map2d, { name: 'MAP01' });
  const canvas = screen.container.querySelector('canvas');
  expect(canvas, 'Map2d should render a canvas').not.toBeNull();
  const el = canvas as HTMLCanvasElement;
  expect(await painted(el)).toBe(true);
  const ctx = el.getContext('2d');
  expect(ctx, 'the canvas should have a 2D context').not.toBeNull();
  return (ctx as CanvasRenderingContext2D).getImageData(0, 0, el.width, el.height).data;
}

/** How many pixels the marker paints, measured against the same map without it. */
async function markerArea(map: Map2dPayload): Promise<number> {
  payload = BASE;
  const before = await pixels();
  payload = map;
  const after = await pixels();
  let n = 0;
  for (let p = 0; p < after.length; p += 4) {
    if (
      after[p] !== before[p] ||
      after[p + 1] !== before[p + 1] ||
      after[p + 2] !== before[p + 2] ||
      after[p + 3] !== before[p + 3]
    ) {
      n++;
    }
  }
  return n;
}

// `mapPrefs` is a module singleton, so a test that flips a preference and walks
// away leaves it flipped for whatever runs next in this file. Restore rather
// than reset-to-default: the point is to leave no trace, not to assert one.
const showThingsDefault = mapPrefs.showThings;
const alwaysShowPlayerStartDefault = mapPrefs.alwaysShowPlayerStart;
const coopShownDefault = mapPrefs.showCategories.coop;
const deathmatchShownDefault = mapPrefs.showCategories.deathmatch;
afterEach(() => {
  payload = BASE;
  mapPrefs.showThings = showThingsDefault;
  mapPrefs.alwaysShowPlayerStart = alwaysShowPlayerStartDefault;
  mapPrefs.showCategories.coop = coopShownDefault;
  mapPrefs.showCategories.deathmatch = deathmatchShownDefault;
});

describe('the player 1 arrow', () => {
  it('draws with things hidden when the Start override is on', async () => {
    mapPrefs.showThings = false;
    mapPrefs.alwaysShowPlayerStart = true;

    payload = BASE;
    const without = await snapshot();
    payload = withPlayer1;
    const withIt = await snapshot();
    expect(withIt, 'the Start override must draw the arrow on its own').not.toBe(without);
  });

  it('stays hidden when things are off and the override is off', async () => {
    mapPrefs.showThings = false;
    mapPrefs.alwaysShowPlayerStart = false;

    payload = BASE;
    const without = await snapshot();
    payload = withPlayer1;
    const withIt = await snapshot();
    expect(withIt, 'with both controls off nothing should mark the start').toBe(without);
  });
});

describe.each([
  { label: 'co-op', category: 'coop' as const, map: () => withCoop },
  { label: 'deathmatch', category: 'deathmatch' as const, map: () => withDeathmatch },
])('$label start markers', ({ category, map }) => {
  it('paint an arrow, not the 3 px dot every other category gets', async () => {
    mapPrefs.showThings = true;
    mapPrefs.showCategories[category] = true;
    // showThings alone already implies showPlayerStart (mapPrefs.svelte.ts), so
    // the player 1 arrow below draws too, but set it explicitly so this stays
    // true regardless of that implication.
    mapPrefs.alwaysShowPlayerStart = true;

    const arrow = await markerArea(map());
    const dot = await markerArea(withWeapon);
    // Self-calibrating, so it holds at any device pixel ratio: whatever a 3 px
    // rect costs on this canvas, a 7 px arrow must cost more.
    expect(arrow, 'a start marker should be larger than an ordinary thing dot').toBeGreaterThan(
      dot,
    );

    // The entire rationale for COOP_ARROW_PX/DEATHMATCH_ARROW_PX (Map2d.svelte)
    // being smaller than PLAYER_ARROW_PX is that the flagship arrow stays
    // dominant (#72) — nothing above asserts that. Verified to fail when
    // COOP_ARROW_PX is raised to 20 (restored to 7 afterward).
    const player = await markerArea(withPlayer1);
    expect(
      arrow,
      'a co-op/deathmatch marker should stay smaller than the player 1 arrow',
    ).toBeLessThan(player);
  });
});

describe.each([
  { label: 'co-op', category: 'coop' as const, map: () => withCoop },
  { label: 'deathmatch', category: 'deathmatch' as const, map: () => withDeathmatch },
])('$label rect-batch skip', ({ category, map }) => {
  it('never lets an arrow category into the drawThings rect batch', async () => {
    mapPrefs.showThings = true;
    mapPrefs.showCategories[category] = true;

    // `Path2D.prototype.rect` is the one call site drawThings uses to add a
    // thing to the shared rect batch (Map2d.svelte). This payload's only thing
    // is the arrow-category start itself, so if `ARROW_CATEGORIES` (things.ts)
    // stopped gating that loop, this is the call that would appear. Pixel
    // diffing can't see this: the 3 px rect is the same color as the arrow and
    // sits almost entirely under it, so it only grows a `toBeGreaterThan`
    // measurement by a sub-pixel sliver. Verified to fail when the `if
    // (ARROW_CATEGORIES.has(category)) continue;` skip is deleted from
    // drawThings (restored afterward).
    const rectSpy = vi.spyOn(Path2D.prototype, 'rect');
    payload = map();
    await snapshot();
    // Assert before restoring: `mockRestore` also clears the recorded calls
    // (it includes a `mockReset`), so checking after it would always see zero
    // regardless of what actually happened.
    try {
      expect(rectSpy).not.toHaveBeenCalled();
    } finally {
      rectSpy.mockRestore();
    }
  });
});

describe.each([
  { label: 'co-op', category: 'coop' as const, map: () => withCoop },
  { label: 'deathmatch', category: 'deathmatch' as const, map: () => withDeathmatch },
])('$label start marker visibility', ({ category, map }) => {
  it('draws when things are shown and the category is on', async () => {
    mapPrefs.showThings = true;
    mapPrefs.showCategories[category] = true;

    payload = BASE;
    const without = await snapshot();
    payload = map();
    const withIt = await snapshot();
    expect(withIt, 'a start in the payload must change what is drawn').not.toBe(without);
  });

  it('stays hidden when the category is off', async () => {
    mapPrefs.showThings = true;
    mapPrefs.showCategories[category] = false;

    payload = BASE;
    const without = await snapshot();
    payload = map();
    const withIt = await snapshot();
    expect(withIt, 'the chip must hide the marker completely').toBe(without);
  });

  it('does not follow the player 1 Start override', async () => {
    // The override is documented as player-1 only. Were these markers wired to
    // `showPlayerStart` instead of `showThings`, this is the case that catches
    // it — and nothing else would.
    mapPrefs.showThings = false;
    mapPrefs.alwaysShowPlayerStart = true;
    mapPrefs.showCategories[category] = true;

    payload = BASE;
    const without = await snapshot();
    payload = map();
    const withIt = await snapshot();
    expect(withIt, 'the Start override governs player 1 alone').toBe(without);
  });
});
