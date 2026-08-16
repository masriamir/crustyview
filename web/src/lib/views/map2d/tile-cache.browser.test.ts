import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Map2d as Map2dPayload } from '../../format';
import { installMapSizing, painted } from './browser-test-helpers';
import { CLASSIC_LINE_SECTOR_SECRET, CLASSIC_LINE_TELEPORT } from './lines';
import { CLASSIC_THING_COLORS } from './things';

/**
 * The cache's load-bearing claims, in the browser tier (#129): a preference
 * change must reach the bitmap, a pan must not rebuild it, and the blit must
 * put geometry where a direct render would.
 *
 * `control.disableCache` forces `planTile` to return a zero-sized tile, which
 * sends `draw()` down its direct fallback — that is how the same sequence can
 * be run with and without the cache and the two compared.
 */
const control = vi.hoisted(() => ({ disableCache: false, renders: 0 }));

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

vi.mock('./render', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./render')>();
  return {
    ...mod,
    drawMapLayers: (...args: Parameters<typeof mod.drawMapLayers>) => {
      control.renders += 1;
      return mod.drawMapLayers(...args);
    },
  };
});

const SPAN = 4000;

/**
 * A border plus two INTERIOR marked lines and an interior monster.
 *
 * Interior on purpose: a marked line on the border can be panned off screen,
 * which would make its color absent for a reason that has nothing to do with
 * the cache and turn a passing test into a lie.
 */
const MAP: Map2dPayload = {
  name: 'MAP01',
  bounds: { min_x: 0, min_y: 0, max_x: SPAN, max_y: SPAN },
  lines: [
    { x1: 0, y1: 0, x2: SPAN, y2: 0, kind: 'one_sided' },
    { x1: SPAN, y1: 0, x2: SPAN, y2: SPAN, kind: 'one_sided' },
    { x1: SPAN, y1: SPAN, x2: 0, y2: SPAN, kind: 'one_sided' },
    { x1: 0, y1: SPAN, x2: 0, y2: 0, kind: 'one_sided' },
    { x1: 1000, y1: 2000, x2: 3000, y2: 2000, kind: 'two_sided', secret_sector: true },
    { x1: 1000, y1: 1600, x2: 3000, y2: 1600, kind: 'two_sided', teleport: true },
  ],
  things: [
    { x: 2000, y: 2000, angle: 90, type_id: 1 },
    // 3004 is a former human, so this lands in `monsters`.
    { x: 2000, y: 2400, angle: 0, type_id: 3004 },
  ],
  secret_sectors: 1,
  damaging_sectors: 0,
};

/**
 * The zero-area bounds `bounds_of` produces when a single coordinate is
 * non-finite, with the geometry still at real coordinates.
 *
 * `fitTransform` falls back to scale 1 centered on the origin for degenerate
 * bounds, so map (0, 0) is the viewport center and screen x is map x plus half
 * the canvas width: the near group straddles the center and the far group
 * starts ~600 px right of it, off screen until panned to.
 */
const NEAR_HALF_SPAN = 150;
const FAR_X = 600;
const DEGENERATE: Map2dPayload = {
  name: 'MAP01',
  bounds: { min_x: 0, min_y: 0, max_x: 0, max_y: 0 },
  lines: [
    { x1: -NEAR_HALF_SPAN, y1: 0, x2: NEAR_HALF_SPAN, y2: 0, kind: 'one_sided' },
    {
      x1: FAR_X,
      y1: -NEAR_HALF_SPAN,
      x2: FAR_X,
      y2: NEAR_HALF_SPAN,
      kind: 'two_sided',
      teleport: true,
    },
  ],
  things: [],
  secret_sectors: 0,
  damaging_sectors: 0,
};

/**
 * Two maps sharing one bounds. `fitTransform` is a pure function of bounds and
 * viewport, so both fit at exactly the same scale — which is what makes map
 * identity the only clause in `usable` that can notice the switch.
 */
const SWITCH_BOUNDS = { min_x: 0, min_y: 0, max_x: SPAN, max_y: SPAN };
const SWITCH_BORDER = [
  { x1: 0, y1: 0, x2: SPAN, y2: 0, kind: 'one_sided' as const },
  { x1: SPAN, y1: 0, x2: SPAN, y2: SPAN, kind: 'one_sided' as const },
  { x1: SPAN, y1: SPAN, x2: 0, y2: SPAN, kind: 'one_sided' as const },
  { x1: 0, y1: SPAN, x2: 0, y2: 0, kind: 'one_sided' as const },
];
const PLAIN_MAP: Map2dPayload = {
  name: 'MAP01',
  bounds: SWITCH_BOUNDS,
  lines: SWITCH_BORDER,
  things: [],
  secret_sectors: 0,
  damaging_sectors: 0,
};
const MARKED_MAP: Map2dPayload = {
  ...PLAIN_MAP,
  name: 'MAP02',
  lines: [
    ...SWITCH_BORDER,
    { x1: 1000, y1: 2000, x2: 3000, y2: 2000, kind: 'two_sided', secret_sector: true },
  ],
  secret_sectors: 1,
};

/**
 * Which payload each map name serves, so a case can swap the fixture or serve
 * two maps at once. Reset in `beforeEach`; a case that forgets to assign
 * inherits the default rather than whatever ran before it.
 */
let payloads: Record<string, Map2dPayload> = { MAP01: MAP };

vi.mock('../../stores/wad.svelte', () => ({
  wad: {
    phase: 'loaded',
    summary: { kind: 'PWAD', lump_count: 6, map_count: 1, game: null },
    map2d: (name: string) => payloads[name] ?? null,
    map2dError: () => null,
  },
}));

const { render } = await import('vitest-browser-svelte');
const Map2d = (await import('./Map2d.svelte')).default;
const { mapPrefs } = await import('../../stores/mapPrefs.svelte');

installMapSizing();

/** Classic one-sided wall, mirroring `render.ts`'s `CLASSIC` palette. */
const CLASSIC_WALL = '#ff3b30';
/**
 * Per-channel tolerance. Strokes are opaque, so their interior pixels are
 * exact; this only has to absorb display color management. It must stay well
 * below the distance between any two colors asserted here — the closest pair
 * is the classic wall `#ff3b30` against the themed dark wall `#ff6a33`, which
 * differ by 47 in green.
 */
const TOL = 8;
/** Arrow keys pan by a tenth of the viewport. */
const PAN_PRESSES = 2;

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function pixels(el: HTMLCanvasElement): ImageData {
  const ctx = el.getContext('2d');
  expect(ctx, 'a 2D context is required to inspect the canvas').not.toBeNull();
  return (ctx as CanvasRenderingContext2D).getImageData(0, 0, el.width, el.height);
}

function countColor(el: HTMLCanvasElement, hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  const { data } = pixels(el);
  let found = 0;
  for (let p = 0; p < data.length; p += 4) {
    if (
      Math.abs(data[p] - r) <= TOL &&
      Math.abs(data[p + 1] - g) <= TOL &&
      Math.abs(data[p + 2] - b) <= TOL
    ) {
      found += 1;
    }
  }
  return found;
}

/** Device-pixel bounding box of everything matching `hex`, or null if absent. */
function colorBounds(
  el: HTMLCanvasElement,
  hex: string,
): { minRow: number; minCol: number; maxRow: number; maxCol: number } | null {
  const [r, g, b] = hexToRgb(hex);
  const { data, width } = pixels(el);
  let minRow = Infinity;
  let minCol = Infinity;
  let maxRow = -Infinity;
  let maxCol = -Infinity;
  for (let p = 0; p < data.length; p += 4) {
    if (
      Math.abs(data[p] - r) > TOL ||
      Math.abs(data[p + 1] - g) > TOL ||
      Math.abs(data[p + 2] - b) > TOL
    ) {
      continue;
    }
    const index = p / 4;
    const row = Math.floor(index / width);
    const col = index % width;
    if (row < minRow) minRow = row;
    if (row > maxRow) maxRow = row;
    if (col < minCol) minCol = col;
    if (col > maxCol) maxCol = col;
  }
  return maxRow < 0 ? null : { minRow, minCol, maxRow, maxCol };
}

/** Let the effect schedule and the rAF draw land. */
async function frames(n = 3): Promise<void> {
  for (let i = 0; i < n; i++) {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }
}

/** Mount and wait for the fit and first paint. */
async function mount(name = 'MAP01') {
  const screen = await render(Map2d, { name });
  const canvas = screen.container.querySelector('canvas');
  expect(canvas, 'Map2d should render a canvas').not.toBeNull();
  const el = canvas as HTMLCanvasElement;
  expect(await painted(el), 'the map must fit and paint').toBe(true);
  return { screen, el };
}

/** Pan right by `presses` keypresses and let the resulting draw land. */
async function panRight(el: HTMLCanvasElement, presses: number): Promise<void> {
  for (let i = 0; i < presses; i++) {
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );
  }
  await frames();
}

/** Mount, wait for the fit and first paint, then pan. */
async function mountAndPan(): Promise<HTMLCanvasElement> {
  const { el } = await mount();
  await panRight(el, PAN_PRESSES);
  return el;
}

beforeEach(() => {
  control.disableCache = false;
  control.renders = 0;
  payloads = { MAP01: MAP };
  // `mapPrefs` is a module singleton shared by every case in this file, and
  // `localStorage` can carry state in from another file, so pin the starting
  // point rather than trusting the defaults. Assigned directly rather than
  // through the `toggle*` methods because those call `#persist()`: a bare
  // assignment is still reactive but writes nothing to `localStorage`, so this
  // file leaves no preferences behind for whatever spec runs next in the same
  // browser context.
  mapPrefs.showThings = true;
  mapPrefs.showTeleportLines = true;
  mapPrefs.showSecretSectors = false;
  mapPrefs.showDamagingSectors = false;
  mapPrefs.alwaysShowPlayerStart = true;
  mapPrefs.showCategories.monsters = true;
  mapPrefs.style = 'classic';
});

describe('a preference change reaches the cached bitmap', () => {
  it.each<[string, string, () => void, 'appears' | 'disappears']>([
    [
      'the secret-sector overlay',
      CLASSIC_LINE_SECTOR_SECRET,
      () => mapPrefs.toggleSecretSectors(),
      'appears',
    ],
    [
      'the teleport overlay',
      CLASSIC_LINE_TELEPORT,
      () => mapPrefs.toggleTeleportLines(),
      'disappears',
    ],
    ['monster markers', CLASSIC_THING_COLORS.monsters, () => mapPrefs.toggleThings(), 'disappears'],
    [
      'monster markers, by category',
      CLASSIC_THING_COLORS.monsters,
      () => mapPrefs.toggleCategory('monsters'),
      'disappears',
    ],
    ['the classic palette', CLASSIC_WALL, () => mapPrefs.toggleStyle(), 'disappears'],
  ])('%s %s after the toggle', async (_layer, color, mutate, direction) => {
    const el = await mountAndPan();
    // Assert the starting state too. Without it a case that never painted the
    // color would pass its 'disappears' assertion for the wrong reason.
    const before = countColor(el, color);
    if (direction === 'appears') expect(before).toBe(0);
    else expect(before).toBeGreaterThan(0);

    mutate();
    await frames();

    const after = countColor(el, color);
    // This is the stale-tile assertion. If the preference is missing from
    // `tileKey`, the pan left a cached bitmap in place and the toggle changes
    // nothing on screen.
    if (direction === 'appears') expect(after).toBeGreaterThan(0);
    else expect(after).toBe(0);
  });
});

describe('the blit lands geometry where a direct render would', () => {
  it('matches the direct render within a device pixel or two', async () => {
    // Not byte equality: the source offset is rounded to whole device pixels,
    // so a blit may sit up to half a device pixel from a direct render and its
    // antialiasing differs. A wiring error — the wrong transform, a sign flip —
    // is off by hundreds, so this tolerance still bites.
    const cached = colorBounds(await mountAndPan(), CLASSIC_WALL);
    control.disableCache = true;
    const direct = colorBounds(await mountAndPan(), CLASSIC_WALL);
    expect(cached, 'the cached run must paint walls').not.toBeNull();
    expect(direct, 'the direct run must paint walls').not.toBeNull();
    const a = cached as NonNullable<typeof cached>;
    const b = direct as NonNullable<typeof direct>;
    for (const edge of ['minRow', 'minCol', 'maxRow', 'maxCol'] as const) {
      expect(Math.abs(a[edge] - b[edge]), `${edge} should agree`).toBeLessThanOrEqual(2);
    }
  });
});

describe('the cache decides correctly when to rasterize', () => {
  it('does not re-render the tile while panning', async () => {
    const screen = await render(Map2d, { name: 'MAP01' });
    const el = screen.container.querySelector('canvas') as HTMLCanvasElement;
    expect(await painted(el)).toBe(true);
    const before = control.renders;
    for (let i = 0; i < PAN_PRESSES + 2; i++) {
      el.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
      );
      await frames(1);
    }
    // The whole point: several frames drew and none of them rasterized.
    expect(control.renders).toBe(before);
  });

  it('re-renders the tile when a preference changes', async () => {
    const screen = await render(Map2d, { name: 'MAP01' });
    const el = screen.container.querySelector('canvas') as HTMLCanvasElement;
    expect(await painted(el)).toBe(true);
    const before = control.renders;
    mapPrefs.toggleSecretSectors();
    await expect.poll(() => control.renders).toBeGreaterThan(before);
  });

  it('keeps re-rendering when the bounds are degenerate', async () => {
    // A zero-area bounds cannot contain the geometry, so `wholeMap` — which
    // promises validity at any translation — must not be honored: the tile
    // holds only the first viewport, and everything panned into view
    // afterwards would be missing from it forever.
    payloads = { MAP01: DEGENERATE };
    const { el } = await mount();
    expect(
      countColor(el, CLASSIC_LINE_TELEPORT),
      'the far group starts off screen',
    ).toBe(0);
    // Each press pans by a tenth of the viewport, so six clears the ~600 px
    // the far group starts out beyond the right edge.
    await panRight(el, 6);
    expect(
      countColor(el, CLASSIC_LINE_TELEPORT),
      'geometry panned into view must be rasterized, not read from a tile that never held it',
    ).toBeGreaterThan(0);
  });

  it('drops the tile when the map changes under an identical fit', async () => {
    // The two maps share one bounds, so the fit — and therefore the scale
    // clause in `usable` — is identical across the switch, and `MapView` keeps
    // this component alive through it. Map identity is the only thing left
    // that can tell the bitmap is the wrong map's.
    payloads = { MAP01: PLAIN_MAP, MAP02: MARKED_MAP };
    mapPrefs.toggleSecretSectors();
    const { screen, el } = await mount('MAP01');
    expect(countColor(el, CLASSIC_LINE_SECTOR_SECRET), 'MAP01 has no secret sector').toBe(0);

    await screen.rerender({ name: 'MAP02' });
    await frames();

    expect(
      countColor(el, CLASSIC_LINE_SECTOR_SECRET),
      "the switch must repaint, not blit the previous map's tile",
    ).toBeGreaterThan(0);
  });
});
