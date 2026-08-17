import { expect, type Locator, type Page } from '@playwright/test';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repo-root fixture directory populated by `just fetch-freedoom`. */
export const FIXTURES = path.resolve(here, '../../.freedoom');

export const haveFixtures = ['freedoom1.wad', 'freedoom2.wad'].every((wad) =>
  fs.existsSync(path.join(FIXTURES, wad)),
);

/**
 * Navigate to the app and wait for the wasm bootstrap to mount the shell.
 *
 * `?glprobe=1` is appended for every navigation, not just map ones: GL
 * pixels are unreadable post-composite without `preserveDrawingBuffer`;
 * `?glprobe=1` opts tests in; production never sets it. This is the app's
 * only navigation entry point (no URL router, so the param rides in
 * `location.search` for the whole SPA session — `page.reload()` included),
 * so applying it here covers the map specs without needing a second helper
 * for the non-map ones, which don't read it and are unaffected by its
 * presence.
 */
export async function gotoApp(page: Page): Promise<void> {
  await page.goto('/?glprobe=1');
  await expect(page.getByRole('heading', { name: 'crustyview' })).toBeVisible();
}

/** Load a fixture WAD through the header Open input. */
export async function loadWad(page: Page, wadName: string): Promise<void> {
  await page
    .locator('header input[type="file"]')
    .setInputFiles(path.join(FIXTURES, wadName));
}

/** Feed a non-WAD payload (≥12 bytes, bad magic) through the header Open input. */
export async function loadJunk(page: Page): Promise<void> {
  await page.locator('header input[type="file"]').setInputFiles({
    name: 'junk.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('this is definitely not a wad'),
  });
}

/** Feed a payload shorter than the 12-byte WAD header through the header Open input. */
export async function loadTinyJunk(page: Page): Promise<void> {
  await page.locator('header input[type="file"]').setInputFiles({
    name: 'tiny.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('tiny'),
  });
}

/** Upload a crafted PWAD whose MAP01 group is missing the required VERTEXES lump. */
export async function loadBrokenMapWad(page: Page): Promise<void> {
  const lumps = ['MAP01', 'THINGS', 'LINEDEFS', 'SIDEDEFS', 'SECTORS'];
  // 12-byte header + one 16-byte directory entry per (empty) lump.
  const buf = Buffer.alloc(12 + 16 * lumps.length);
  buf.write('PWAD', 0, 'ascii');
  buf.writeInt32LE(lumps.length, 4);
  buf.writeInt32LE(12, 8); // directory sits right after the header
  lumps.forEach((name, i) => {
    const at = 12 + 16 * i;
    // filepos past the directory (never read: size 0) so entries don't
    // point into directory bytes.
    buf.writeInt32LE(12 + 16 * lumps.length, at);
    buf.writeInt32LE(0, at + 4); // size
    buf.write(name, at + 8, 'ascii');
  });
  await page.locator('header input[type="file"]').setInputFiles({
    name: 'broken-map.wad',
    mimeType: 'application/octet-stream',
    buffer: buf,
  });
}

/** Assert the Textures view's first-texture canvas has non-blank pixels. */
export async function expectTextureCanvasPainted(page: Page): Promise<void> {
  const canvas = page.getByRole('img', { name: 'Composited first-texture preview' });
  await expect(canvas).toBeVisible();
  await expect
    .poll(() =>
      canvas.evaluate((element) => {
        const c = element as HTMLCanvasElement;
        const ctx = c.getContext('2d');
        if (!ctx || c.width === 0 || c.height === 0) return false;
        return ctx.getImageData(0, 0, c.width, c.height).data.some((v) => v !== 0);
      }),
    )
    .toBe(true);
}

/** The 2D map canvas — an application-role widget (keyboard-operable), not an img. */
export function mapCanvas(page: Page): Locator {
  return page.getByRole('application', { name: /2D map of/ });
}

/**
 * Assert the 2D map view's canvas has painted more than its background fill.
 * The map always fills the backing buffer with a solid color first, so
 * "painted" here means at least two distinct pixel colors — a single-color
 * buffer (the any-nonzero check `expectTextureCanvasPainted` uses would still
 * pass on a solid non-black fill) would be a false positive for this canvas.
 *
 * Context-agnostic (#178): the GL default (#177) binds the canvas to
 * `webgl2` rather than `2d`, so `getContext('2d')` returns null and would
 * poll forever. Reads pixels from whichever context the canvas is actually
 * bound to, mirroring `surfacePixels` in
 * `web/src/lib/views/map2d/browser-test-helpers.ts` (which documents why
 * this dual read is safe). The GL read only returns real pixels because
 * every map navigation goes through `gotoApp`'s `?glprobe=1`, which turns on
 * `preserveDrawingBuffer` — see that helper's comment.
 */
export async function expectMapCanvasPainted(page: Page): Promise<void> {
  const canvas = mapCanvas(page);
  await expect(canvas).toBeVisible();
  await expect
    .poll(() =>
      canvas.evaluate((element) => {
        const c = element as HTMLCanvasElement;
        if (c.width === 0 || c.height === 0) return false;
        let data: Uint8ClampedArray | Uint8Array | null = null;
        const ctx = c.getContext('2d');
        if (ctx) {
          data = ctx.getImageData(0, 0, c.width, c.height).data;
        } else {
          const gl = c.getContext('webgl2');
          if (gl) {
            data = new Uint8Array(c.width * c.height * 4);
            gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
          }
        }
        if (!data) return false;
        const [r0, g0, b0, a0] = data;
        for (let i = 4; i < data.length; i += 4) {
          if (data[i] !== r0 || data[i + 1] !== g0 || data[i + 2] !== b0 || data[i + 3] !== a0) {
            return true;
          }
        }
        return false;
      }),
    )
    .toBe(true);
}

/**
 * Full-canvas pixel hash of the 2D map, for before/after comparisons.
 *
 * Replaces the former `mapCanvasDataUrl`: `toDataURL()` returns a blank PNG
 * on a GL canvas without `preserveDrawingBuffer` (the browser clears the
 * drawing buffer right after each composite), which would make every
 * before/after comparison a false green. This reads the full RGBA surface
 * from whichever context the canvas is bound to — same dual-context shape as
 * `expectMapCanvasPainted` above — and folds the bytes into a 32-bit FNV-1a
 * hash rather than shipping the whole surface across the Playwright bridge
 * as a data URL. GL rendering is deterministic within a session, so equal
 * pixels still hash equal and unequal pixels still (overwhelmingly) hash
 * unequal — the restore-to-exact-pixels assertions this feeds stay just as
 * strict as they were against a raw data URL.
 */
export async function mapCanvasPixelHash(page: Page): Promise<number> {
  return mapCanvas(page).evaluate((element) => {
    const c = element as HTMLCanvasElement;
    let data: Uint8ClampedArray | Uint8Array;
    const ctx = c.getContext('2d');
    if (ctx) {
      data = ctx.getImageData(0, 0, c.width, c.height).data;
    } else {
      const gl = c.getContext('webgl2');
      if (!gl) throw new Error('map canvas has neither a 2d nor a webgl2 context');
      data = new Uint8Array(c.width * c.height * 4);
      gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
    }
    // FNV-1a, 32-bit.
    let hash = 0x811c9dc5;
    for (let i = 0; i < data.length; i++) {
      hash ^= data[i];
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  });
}
