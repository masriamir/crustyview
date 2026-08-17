import { describe, it, expect, afterEach, vi } from 'vitest';
import type { Map2d } from '../../../format';
import { LINK_ALPHA, LINK_MARK_ALPHA } from '../linkGeometry';
import type { Palette } from '../render';
import type { TeleportLink } from '../teleportArcs';
import type { Transform } from '../transform';
import { createGlRenderer, parsePalette, type GlFrame, type GlMapRenderer } from './renderer';

/**
 * Raw-canvas suite (#177 Task 2): no component, no store — a bare canvas
 * element and the renderer directly, `preserveDrawingBuffer: true` so a frame
 * survives long enough to `readPixels`. Mirrors `render.browser.test.ts`'s
 * shape for the canvas-2D path.
 */

const PALETTE: Palette = {
  bg: '#0a0a0a',
  grid: '#2c2c2e',
  wall: '#ff3b30',
  twoSided: '#8e8e93',
  secret: '#ffd60a',
  lineTeleport: '#5e5ce6',
  lineSectorSecret: '#ff4fd8',
  lineSectorDamage: '#7ddb1e',
  things: {
    monsters: '#ff375f',
    coop: '#2f9e50',
    deathmatch: '#ff8fa3',
    weapons: '#ff9f0a',
    ammo: '#c8a765',
    health: '#63e6be',
    powerups: '#bf5af2',
    keys: '#64d2ff',
    teleports: '#5e5ce6',
    decorations: '#8e8e93',
    other: '#c7c7cc',
  },
  player: '#34c759',
};
const GL_PALETTE = parsePalette(PALETTE);

const SHOW_ALL: GlFrame['show'] = {
  teleportLines: true,
  secretSectors: true,
  damagingSectors: true,
  things: true,
  playerStart: true,
  categories: {
    monsters: true,
    coop: true,
    deathmatch: true,
    weapons: true,
    ammo: true,
    health: true,
    powerups: true,
    keys: true,
    teleports: true,
    decorations: true,
    other: true,
  },
};

const WIDTH = 400;
const HEIGHT = 200;
/** Identity CSS px == device px (dpr 1); map (0, 0) sits at screen (0, 100),
 *  the canvas's vertical center. */
const T: Transform = { scale: 1, tx: 0, ty: 100 };

function baseFrame(overrides: Partial<GlFrame> = {}): GlFrame {
  return {
    transform: T,
    widthCss: WIDTH,
    heightCss: HEIGHT,
    dpr: 1,
    palette: GL_PALETTE,
    feather: true,
    grid: null,
    show: SHOW_ALL,
    arcs: [],
    ...overrides,
  };
}

function makeCanvas(width = WIDTH, height = HEIGHT): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function makeRenderer(canvas: HTMLCanvasElement): GlMapRenderer {
  const renderer = createGlRenderer(canvas, {
    msaa: false,
    preserveDrawingBuffer: true,
  });
  expect(renderer, 'WebGL2 is required for this test').not.toBeNull();
  return renderer as GlMapRenderer;
}

/**
 * The framebuffer's pixels, re-ordered top-down (screen-space) so the row
 * math in this file reads the same way as `render.browser.test.ts`'s
 * `getImageData`-based probes. `readPixels` itself returns bottom-up rows.
 */
function readScreenPixels(canvas: HTMLCanvasElement): Uint8Array {
  const gl = canvas.getContext('webgl2') as WebGL2RenderingContext;
  const raw = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
  const stride = canvas.width * 4;
  const flipped = new Uint8Array(raw.length);
  for (let row = 0; row < canvas.height; row++) {
    flipped.set(raw.subarray(row * stride, row * stride + stride), (canvas.height - 1 - row) * stride);
  }
  return flipped;
}

function rowPixels(pixels: Uint8Array, row: number, width: number): Uint8Array {
  const stride = width * 4;
  return pixels.subarray(row * stride, row * stride + stride);
}

/** A `w`×`h` sub-rectangle of a top-down `readScreenPixels` buffer, starting
 *  at screen `(x0, y0)`. Lets a test scope a color search to one corner of
 *  the canvas instead of the whole frame. */
function regionPixels(
  pixels: Uint8Array,
  x0: number,
  y0: number,
  w: number,
  h: number,
  canvasWidth: number,
): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  const srcStride = canvasWidth * 4;
  const dstStride = w * 4;
  for (let row = 0; row < h; row++) {
    const srcStart = (y0 + row) * srcStride + x0 * 4;
    out.set(pixels.subarray(srcStart, srcStart + dstStride), row * dstStride);
  }
  return out;
}

function hexToRgb255(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** The framebuffer color a `fgHex` stroke/fill at `alpha` produces over a
 *  `bgHex` background — this suite's link passes are the first ones in this
 *  file drawn below full alpha (`LINK_ALPHA`/`LINK_MARK_ALPHA`), so matching
 *  against the raw palette hex (as every other test here does) would miss by
 *  more than any reasonable tolerance once GL's SRC_ALPHA/ONE_MINUS_SRC_ALPHA
 *  blends it against the background. */
function blend(fgHex: string, alpha: number, bgHex: string): [number, number, number] {
  const [fr, fg, fb] = hexToRgb255(fgHex);
  const [br, bgc, bb] = hexToRgb255(bgHex);
  return [
    Math.round(fr * alpha + br * (1 - alpha)),
    Math.round(fg * alpha + bgc * (1 - alpha)),
    Math.round(fb * alpha + bb * (1 - alpha)),
  ];
}

function countMatching(pixels: Uint8Array, [r, g, b]: [number, number, number], tolerance = 16): number {
  let count = 0;
  for (let p = 0; p < pixels.length; p += 4) {
    if (
      Math.abs(pixels[p] - r) <= tolerance &&
      Math.abs(pixels[p + 1] - g) <= tolerance &&
      Math.abs(pixels[p + 2] - b) <= tolerance
    ) {
      count++;
    }
  }
  return count;
}

function anyMatch(pixels: Uint8Array, rgb: [number, number, number]): boolean {
  return countMatching(pixels, rgb) > 0;
}

/** A one-sided wall along map y = -90, near the bottom of a -100..100 map —
 *  screen y = ty - y*scale = 100 - (-90) = 190, ten CSS px clear of the
 *  canvas's bottom edge. */
const ROW_LINE_Y = -90;
const ROW = 190;
const ABOVE_ROW = ROW - 10;

const ROW_PROBE_MAP: Map2d = {
  name: 'MAP01',
  bounds: { min_x: 0, min_y: -100, max_x: 400, max_y: 100 },
  lines: [{ x1: 20, y1: ROW_LINE_Y, x2: 380, y2: ROW_LINE_Y, kind: 'one_sided' }],
  things: [],
  secret_sectors: 0,
  damaging_sectors: 0,
};

describe('GlMapRenderer line pass', () => {
  it('paints a one-sided line and leaves the row above it as background', () => {
    const canvas = makeCanvas();
    const renderer = makeRenderer(canvas);
    renderer.loadMap(ROW_PROBE_MAP, null);
    renderer.draw(baseFrame());

    const pixels = readScreenPixels(canvas);
    const lineRow = rowPixels(pixels, ROW, WIDTH);
    const aboveRow = rowPixels(pixels, ABOVE_ROW, WIDTH);

    expect(countMatching(lineRow, hexToRgb255(PALETTE.wall))).toBeGreaterThan(0);
    expect(countMatching(aboveRow, hexToRgb255(PALETTE.wall))).toBe(0);
    expect(countMatching(aboveRow, hexToRgb255(PALETTE.bg))).toBeGreaterThan(0);

    renderer.dispose();
  });

  it('still paints the line with feather off — the apron collapses without zeroing the quad', () => {
    const canvas = makeCanvas();
    const renderer = makeRenderer(canvas);
    renderer.loadMap(ROW_PROBE_MAP, null);
    renderer.draw(baseFrame({ feather: false }));

    const lineRow = rowPixels(readScreenPixels(canvas), ROW, WIDTH);
    expect(countMatching(lineRow, hexToRgb255(PALETTE.wall))).toBeGreaterThan(0);

    renderer.dispose();
  });
});

const DASH_LINE_MAP: Map2d = {
  name: 'MAP01',
  bounds: { min_x: 0, min_y: -100, max_x: 400, max_y: 100 },
  lines: [
    {
      x1: 20,
      y1: ROW_LINE_Y,
      x2: 380,
      y2: ROW_LINE_Y,
      kind: 'two_sided',
      secret_sector: true,
      damaging_sector: true,
    },
  ],
  things: [],
  secret_sectors: 1,
  damaging_sectors: 1,
};
/** x2 - x1 of the fixture line above, i.e. its full lit extent in device px
 *  at the identity transform this suite uses. */
const LINE_EXTENT_PX = 360;

describe('GlMapRenderer dashed overlays', () => {
  it('interleaves the secret- and damaging-sector phases instead of one hiding the other', () => {
    const canvas = makeCanvas();
    const renderer = makeRenderer(canvas);
    renderer.loadMap(DASH_LINE_MAP, null);
    renderer.draw(baseFrame());

    const row = rowPixels(readScreenPixels(canvas), ROW, WIDTH);
    const secretCount = countMatching(row, hexToRgb255(PALETTE.lineSectorSecret));
    const damageCount = countMatching(row, hexToRgb255(PALETTE.lineSectorDamage));

    expect(secretCount).toBeGreaterThan(0);
    expect(damageCount).toBeGreaterThan(0);
    // The two dashes are exact-complement phases of the same [4, 4] period
    // (DAMAGE_DASH_OFFSET is half the period), so together they should tile
    // essentially the whole lit extent. If the offset were lost and both
    // dashes shared a phase, this sum would land near half the extent
    // instead — this bound catches that regression without pinning an exact
    // pixel count to the shader's sub-pixel AA.
    expect(secretCount + damageCount).toBeGreaterThan(LINE_EXTENT_PX * 0.85);
    expect(secretCount + damageCount).toBeLessThanOrEqual(LINE_EXTENT_PX + 20);

    renderer.dispose();
  });

  it('skips the secret-sector overlay draw call when show.secretSectors is false', () => {
    const canvas = makeCanvas();
    const renderer = makeRenderer(canvas);
    renderer.loadMap(DASH_LINE_MAP, null);
    renderer.draw(baseFrame({ show: { ...SHOW_ALL, secretSectors: false } }));

    const row = rowPixels(readScreenPixels(canvas), ROW, WIDTH);
    expect(countMatching(row, hexToRgb255(PALETTE.lineSectorSecret))).toBe(0);
    // The damaging overlay is still gated on, so its own color remains — this
    // pins that gating skips only the draw call, not the shared buffers.
    expect(countMatching(row, hexToRgb255(PALETTE.lineSectorDamage))).toBeGreaterThan(0);

    renderer.dispose();
  });
});

describe('GlMapRenderer grid pass', () => {
  const GRID_MAP: Map2d = {
    name: 'MAP01',
    bounds: { min_x: 0, min_y: 0, max_x: 128, max_y: 128 },
    lines: [],
    things: [],
    secret_sectors: 0,
    damaging_sectors: 0,
  };
  const GRID_T: Transform = { scale: 1, tx: 0, ty: 128 };

  it('paints grid-color pixels at frame.grid spacing, and none when grid is null', () => {
    const canvas = makeCanvas(128, 128);
    const renderer = makeRenderer(canvas);
    renderer.loadMap(GRID_MAP, null);
    const gridColor = hexToRgb255(PALETTE.grid);

    renderer.draw(baseFrame({ transform: GRID_T, widthCss: 128, heightCss: 128, grid: 64 }));
    expect(anyMatch(readScreenPixels(canvas), gridColor)).toBe(true);

    renderer.draw(baseFrame({ transform: GRID_T, widthCss: 128, heightCss: 128, grid: null }));
    expect(anyMatch(readScreenPixels(canvas), gridColor)).toBe(false);

    renderer.dispose();
  });

  it('draws grid lines across the whole visible viewport, not clipped to a small map\'s bounds', () => {
    // Parity with the canvas drawGrid (render.ts): it clips only to
    // viewportRect, never to map.bounds, so a view that hangs off the edge
    // of a small map still gets a full grid. Zoom the same 128x128-bounded
    // map out into a 256x256 canvas at the same transform — the visible map
    // rect (viewportRect) becomes x:[0,256], y:[-128,128], well past the
    // map's own x:[0,128], y:[0,128].
    const canvas = makeCanvas(256, 256);
    const renderer = makeRenderer(canvas);
    renderer.loadMap(GRID_MAP, null);
    renderer.draw(baseFrame({ transform: GRID_T, widthCss: 256, heightCss: 256, grid: 64 }));

    const pixels = readScreenPixels(canvas);
    // Screen (186..198, 178..228) sits on the map x = 192 grid line (192 =
    // 3 * 64, outside bounds.max_x = 128) at map y in about [-100, -50]
    // (outside bounds.min_y = 0) — doubly outside the map's bounds, so this
    // band is grid-colored only without a bounds intersection.
    const region = regionPixels(pixels, 186, 178, 12, 50, 256);
    expect(countMatching(region, hexToRgb255(PALETTE.grid))).toBeGreaterThan(0);

    renderer.dispose();
  });
});

/** Monster doomednum 3004 (`things.ts`'s `TABLE.monsters`) — any id from that
 *  list would do; this one just needs to resolve to the `monsters` category. */
const MONSTER_THING_MAP: Map2d = {
  name: 'MAP01',
  bounds: { min_x: 0, min_y: -100, max_x: 400, max_y: 100 },
  lines: [],
  things: [{ x: 50, y: 0, angle: 0, type_id: 3004 }],
  secret_sectors: 0,
  damaging_sectors: 0,
};

describe('GlMapRenderer thing pass', () => {
  it('paints a monster thing in its category color', () => {
    const canvas = makeCanvas();
    const renderer = makeRenderer(canvas);
    renderer.loadMap(MONSTER_THING_MAP, null);
    renderer.draw(baseFrame());

    expect(countMatching(readScreenPixels(canvas), hexToRgb255(PALETTE.things.monsters))).toBeGreaterThan(0);

    renderer.dispose();
  });

  it('hides the category once its chip is off', () => {
    const canvas = makeCanvas();
    const renderer = makeRenderer(canvas);
    renderer.loadMap(MONSTER_THING_MAP, null);
    renderer.draw(
      baseFrame({ show: { ...SHOW_ALL, categories: { ...SHOW_ALL.categories, monsters: false } } }),
    );

    expect(countMatching(readScreenPixels(canvas), hexToRgb255(PALETTE.things.monsters))).toBe(0);

    renderer.dispose();
  });

  it('hides every thing when show.things is false', () => {
    const canvas = makeCanvas();
    const renderer = makeRenderer(canvas);
    renderer.loadMap(MONSTER_THING_MAP, null);
    renderer.draw(baseFrame({ show: { ...SHOW_ALL, things: false } }));

    expect(countMatching(readScreenPixels(canvas), hexToRgb255(PALETTE.things.monsters))).toBe(0);

    renderer.dispose();
  });
});

/** Three well-separated things, each drawn in its own palette color, so one
 *  frame yields all three pixel masses to compare — mirrors
 *  `start-markers.browser.test.ts`'s `markerArea` idea (self-calibrating
 *  size comparisons rather than pinned pixel counts) ported onto `readPixels`
 *  instead of the canvas 2D diffing that test needs (no component here to
 *  diff against). */
const RELATIVE_SIZE_MAP: Map2d = {
  name: 'MAP01',
  bounds: { min_x: 0, min_y: -100, max_x: 400, max_y: 100 },
  lines: [],
  things: [
    { x: 50, y: 0, angle: 0, type_id: 2001 }, // shotgun: `weapons`, the plain 3 px rect
    { x: 150, y: 0, angle: 0, type_id: 2 }, // co-op start: a 7 px dart
    { x: 250, y: 0, angle: 0, type_id: 1 }, // player 1 start: a 10 px dart, drawn last
  ],
  secret_sectors: 0,
  damaging_sectors: 0,
};

describe('GlMapRenderer start-marker size', () => {
  it('lights more pixels for the player dart than a co-op dart, and more for the co-op dart than a thing square', () => {
    const canvas = makeCanvas();
    const renderer = makeRenderer(canvas);
    renderer.loadMap(RELATIVE_SIZE_MAP, null);
    renderer.draw(baseFrame());

    const pixels = readScreenPixels(canvas);
    const thingCount = countMatching(pixels, hexToRgb255(PALETTE.things.weapons));
    const coopCount = countMatching(pixels, hexToRgb255(PALETTE.things.coop));
    const playerCount = countMatching(pixels, hexToRgb255(PALETTE.player));

    expect(thingCount).toBeGreaterThan(0);
    expect(coopCount).toBeGreaterThan(thingCount);
    expect(playerCount).toBeGreaterThan(coopCount);

    renderer.dispose();
  });
});

describe('GlMapRenderer teleport link pass', () => {
  const LINK_MAP: Map2d = {
    name: 'MAP01',
    bounds: { min_x: 0, min_y: -100, max_x: 400, max_y: 100 },
    lines: [],
    things: [],
    secret_sectors: 0,
    damaging_sectors: 0,
  };
  // Screen (50, 100) -> (350, 100): a 300 px horizontal chord. The bow caps at
  // LINK_BOW_MAX (42 px, linkGeometry.ts) since 300 * LINK_BOW_RATIO (0.18) =
  // 54 > 42, displacing the control point — and so the curve's midpoint — well
  // south of the chord (worked out to screen y ~= 121 at t = 0.5, ~21 px below
  // the y = 100 chord).
  const ONE_ARC: TeleportLink[] = [{ from: [50, 0], to: [350, 0] }];
  const ARC_COLOR = blend(PALETTE.lineTeleport, LINK_ALPHA, PALETTE.bg);
  const MARK_COLOR = blend(PALETTE.lineTeleport, LINK_MARK_ALPHA, PALETTE.bg);
  const BLEND_TOLERANCE = 10;

  it('bows the arc off the straight chord and rings the source', () => {
    const canvas = makeCanvas();
    const renderer = makeRenderer(canvas);
    renderer.loadMap(LINK_MAP, null);
    renderer.draw(baseFrame({ arcs: ONE_ARC }));

    const pixels = readScreenPixels(canvas);

    // The straight chord itself, away from either endpoint: the actual curve
    // has bowed well clear of this row by its midpoint, so nothing here
    // should be teleport-colored.
    const chordRow = regionPixels(pixels, 170, 99, 60, 3, WIDTH);
    expect(countMatching(chordRow, ARC_COLOR, BLEND_TOLERANCE)).toBe(0);

    // The bow itself: a generous box around the curve's computed midpoint —
    // LINK_DASH means only a fraction of the curve is lit, so this needs
    // enough width/height to be sure of catching an "on" dash segment
    // rather than pinning the exact sub-pixel spot one happens to land.
    const bow = regionPixels(pixels, 150, 105, 100, 30, WIDTH);
    expect(countMatching(bow, ARC_COLOR, BLEND_TOLERANCE)).toBeGreaterThan(0);

    // The ring at `from` (50, 100), sampled on the side facing away from the
    // arc's departure direction (increasing x) so no arc pixel can leak in.
    const ring = regionPixels(pixels, 40, 94, 10, 12, WIDTH);
    expect(countMatching(ring, MARK_COLOR, BLEND_TOLERANCE)).toBeGreaterThan(0);

    renderer.dispose();
  });

  it('draws nothing when there are no arcs', () => {
    const canvas = makeCanvas();
    const renderer = makeRenderer(canvas);
    renderer.loadMap(LINK_MAP, null);
    renderer.draw(baseFrame({ arcs: [] }));

    const pixels = readScreenPixels(canvas);
    expect(countMatching(pixels, ARC_COLOR, BLEND_TOLERANCE)).toBe(0);
    expect(countMatching(pixels, MARK_COLOR, BLEND_TOLERANCE)).toBe(0);

    renderer.dispose();
  });

  it('dashes the arc rather than drawing it solid', () => {
    const canvas = makeCanvas();
    const renderer = makeRenderer(canvas);
    renderer.loadMap(LINK_MAP, null);
    renderer.draw(baseFrame({ arcs: ONE_ARC }));

    const litCount = countMatching(readScreenPixels(canvas), ARC_COLOR, BLEND_TOLERANCE);
    const chordLength = Math.hypot(350 - 50, 0 - 0);

    // A solid stroke the length of the chord (a lower bound on the curve's
    // own length) would light close to `chordLength` px at this LINK_WIDTH-1,
    // dpr-1 identity transform. LINK_DASH's [2, 3] on/off period lights
    // roughly 40% of that; well under 70% pins that the dash survived
    // tessellation instead of the 24 segments quietly re-joining into a
    // solid curve.
    expect(litCount).toBeGreaterThan(0);
    expect(litCount).toBeLessThan(chordLength * 0.7);

    renderer.dispose();
  });

  it('draws the arrowhead at the destination endpoint', () => {
    const canvas = makeCanvas();
    const renderer = makeRenderer(canvas);
    renderer.loadMap(LINK_MAP, null);
    renderer.draw(baseFrame({ arcs: ONE_ARC }));

    const pixels = readScreenPixels(canvas);

    // The arrowhead is at the destination (350, 100) with barbs extending
    // ~7px behind the tip. Probe a 12x12 device-px box centered on the
    // destination, positioned clear of the ring's radius (the ring is at
    // from=(50,100), far away).
    const arrowhead = regionPixels(pixels, 344, 94, 12, 12, WIDTH);
    expect(countMatching(arrowhead, MARK_COLOR, BLEND_TOLERANCE)).toBeGreaterThanOrEqual(5);

    renderer.dispose();
  });
});

describe('GlMapRenderer clear', () => {
  const CLEAR_SIDE = 32;

  it('fills the whole buffer with the color it is given, with no map loaded', () => {
    const canvas = makeCanvas(CLEAR_SIDE, CLEAR_SIDE);
    const renderer = makeRenderer(canvas);
    // Deliberately no `loadMap`: the frames `clear` exists for are exactly the
    // ones before a map or a transform arrives, which `draw` returns early on.
    const pixelCount = CLEAR_SIDE * CLEAR_SIDE;

    expect(
      countMatching(readScreenPixels(canvas), [0, 0, 0], 2),
      'an untouched alpha:false buffer reads back opaque BLACK — the flash this method prevents',
    ).toBe(pixelCount);

    // A color nothing in this renderer draws and nothing defaults to, so a
    // matching buffer can only have come from `clear` itself.
    renderer.clear([1, 0, 1]);
    expect(countMatching(readScreenPixels(canvas), [255, 0, 255], 2)).toBe(pixelCount);

    renderer.dispose();
  });
});

/**
 * Poll `check` across animation frames rather than timers.
 *
 * The restore test below fakes `setTimeout` (see there for why), so anything
 * waiting on it would wait forever — including, in the failing case, the
 * runner's own timeout. Animation frames are left real, which makes this a
 * watchdog that still expires.
 */
async function waitFrames(check: () => boolean, frames = 120): Promise<boolean> {
  for (let i = 0; i < frames; i++) {
    if (check()) return true;
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  }
  return check();
}

describe('GlMapRenderer context restore', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('fires the fallback itself when the rebuild after a restore fails', async () => {
    const canvas = makeCanvas(32, 32);
    const renderer = makeRenderer(canvas);
    renderer.loadMap(ROW_PROBE_MAP, null);
    const lose = (canvas.getContext('webgl2') as WebGL2RenderingContext).getExtension(
      'WEBGL_lose_context',
    );
    expect(lose, 'headless Chromium must expose WEBGL_lose_context').not.toBeNull();

    let fellBack = false;
    renderer.onContextLost(() => {
      fellBack = true;
    });
    let lost = false;
    canvas.addEventListener('webglcontextlost', () => {
      lost = true;
    });

    // Fake the grace timer and never advance it, so the ONLY route left to the
    // fallback is the failed rebuild below. Otherwise this would pass just as
    // well on the ordinary "no restore ever arrived" path, which is a
    // different mechanism and already covered by the component's own test.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    (lose as WEBGL_lose_context).loseContext();
    expect(await waitFrames(() => lost), 'the simulated loss must be delivered').toBe(true);

    // Deny the rebuild its context — what a GPU that is gone for good does.
    // `initContext` throws, and the restore handler has already cleared the
    // grace timer by then, so nothing but the handler's own catch can fire.
    vi.spyOn(canvas, 'getContext').mockReturnValue(null);
    (lose as WEBGL_lose_context).restoreContext();
    expect(
      await waitFrames(() => fellBack),
      'a failed rebuild leaves a renderer painting nothing — it must hand the caller back',
    ).toBe(true);

    renderer.dispose();
  });
});

describe('createGlRenderer', () => {
  it('returns null when the canvas is already bound to a 2D context', () => {
    const canvas = makeCanvas(10, 10);
    const ctx2d = canvas.getContext('2d');
    expect(ctx2d, 'the fixture must actually bind 2d first').not.toBeNull();

    const renderer = createGlRenderer(canvas, { msaa: false });
    expect(renderer).toBeNull();
  });
});
