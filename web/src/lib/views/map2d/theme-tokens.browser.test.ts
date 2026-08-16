import { describe, it, expect, afterEach } from 'vitest';
import type { Map2d as Map2dPayload } from '../../format';
import { drawMapLayers, resolvePalette } from './render';
import type { Transform } from './transform';

/**
 * The browser tier can see the themed palette (#158).
 *
 * Until `browser-test-setup.ts` began loading `app.css`, no `--map2d-*` token
 * was defined in any spec's page, so `resolvePalette` fell through to its
 * classic fallbacks for BOTH styles. Every browser spec was therefore asserting
 * the classic palette regardless of the style it selected, and — the part that
 * matters — deleting a token from `app.css` would have broken the app while the
 * suite stayed green, because the fallback silently covered for it.
 *
 * This file is the check that the tier is no longer blind to that. It is
 * deliberately written against the public API only: `resolvePalette(el,
 * 'classic')` returns the fallback palette, so the themed values can be
 * compared against it without exporting `CLASSIC` just for a test.
 *
 * **What makes it a real check rather than a restatement.** The load-bearing
 * assertion is that the themed color DIFFERS from the classic one. Remove
 * `--map2d-wall` from `app.css` and `resolvePalette` returns `CLASSIC.wall`,
 * the two become equal, and this goes red — which is exactly the regression the
 * old tier could not see. Verified by doing it: with the token deleted, the
 * first case fails on `expected '#ff3b30' not to be '#ff3b30'`.
 *
 * It asserts a *difference* rather than the literal `#bf3a1e` on purpose. The
 * specific hue is a design decision that may be retuned; that the themed style
 * is distinguishable from classic at all is the contract.
 */

/** Identity scale, no offset: map (x, y) draws at screen (x, -y). */
const T: Transform = { scale: 1, tx: 0, ty: 400 };

/** One horizontal wall at map y = -300, i.e. screen y = 700. */
const MAP: Map2dPayload = {
  name: 'MAP01',
  bounds: { min_x: 0, min_y: -400, max_x: 400, max_y: 0 },
  lines: [{ x1: 20, y1: -300, x2: 380, y2: -300, kind: 'one_sided' }],
  things: [],
  secret_sectors: 0,
  damaging_sectors: 0,
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.trim().replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/**
 * A canvas attached to the document, which `getComputedStyle` requires in order
 * to inherit the custom properties defined on `:root`.
 */
function attachedCanvas(width: number, height: number): HTMLCanvasElement {
  const el = document.createElement('canvas');
  el.width = width;
  el.height = height;
  document.body.append(el);
  return el;
}

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.removeAttribute('data-theme');
});

describe('themed palette in the browser tier', () => {
  it('resolves --map2d-* tokens instead of falling back to classic', () => {
    const el = attachedCanvas(10, 10);
    const classic = resolvePalette(el, 'classic');
    const themed = resolvePalette(el, 'theme');

    // If `app.css` were not loaded — or the token were removed from it — every
    // one of these would equal its classic counterpart.
    expect(themed.wall).not.toBe(classic.wall);
    expect(themed.bg).not.toBe(classic.bg);
    expect(themed.grid).not.toBe(classic.grid);
    expect(themed.player).not.toBe(classic.player);
    expect(themed.wall).toMatch(/^#[0-9a-f]{3,8}$/i);
  });

  it('puts the themed wall color on the canvas, not the classic one', () => {
    const width = 400;
    const height = 800;
    const el = attachedCanvas(width, height);
    const ctx = el.getContext('2d');
    expect(ctx, 'a 2D context is required for this test').not.toBeNull();
    const c = ctx as CanvasRenderingContext2D;

    const classic = resolvePalette(el, 'classic');
    const themed = resolvePalette(el, 'theme');
    c.fillStyle = themed.bg;
    c.fillRect(0, 0, width, height);
    drawMapLayers(c, MAP, T, width, height, themed, null);

    // Sample the band the wall sits on rather than the whole canvas, so the
    // assertion is about that line and not about anything else that painted.
    const { data } = c.getImageData(0, 698, width, 5);
    const want = hexToRgb(themed.wall);
    const classicRgb = hexToRgb(classic.wall);
    let themedPixels = 0;
    let classicPixels = 0;
    for (let p = 0; p < data.length; p += 4) {
      const px: [number, number, number] = [data[p], data[p + 1], data[p + 2]];
      if (px.every((v, i) => v === want[i])) themedPixels++;
      if (px.every((v, i) => v === classicRgb[i])) classicPixels++;
    }
    expect(themedPixels, 'the wall should be drawn in the themed color').toBeGreaterThan(0);
    expect(classicPixels, 'no pixel should carry the classic fallback color').toBe(0);
  });

  it('follows the data-theme attribute, so dark is a different palette again', () => {
    const el = attachedCanvas(10, 10);
    const light = resolvePalette(el, 'theme');
    document.documentElement.setAttribute('data-theme', 'dark');
    const dark = resolvePalette(el, 'theme');

    // `app.css` gates dark on this attribute and defines no
    // `prefers-color-scheme` query, so the tier is deterministic regardless of
    // the runner's appearance settings — this pins that.
    expect(dark.bg).not.toBe(light.bg);
    expect(dark.wall).not.toBe(light.wall);
  });
});
