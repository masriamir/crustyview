import { describe, it, expect } from 'vitest';
import type { Map2d } from '../../../format';
import type { Palette } from '../render';
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
    feather: true,
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

describe('createGlRenderer', () => {
  it('returns null when the canvas is already bound to a 2D context', () => {
    const canvas = makeCanvas(10, 10);
    const ctx2d = canvas.getContext('2d');
    expect(ctx2d, 'the fixture must actually bind 2d first').not.toBeNull();

    const renderer = createGlRenderer(canvas, { msaa: false, feather: true });
    expect(renderer).toBeNull();
  });
});
